import type {
  CulturalEntity,
  CulturalTag,
  DataSource,
  DemographicResultSet,
  EntityResultSet,
  ExplainabilityContribution,
  ExplainabilityStatus,
  GeoSummary,
  NormalisedScore,
  ProviderObservation,
  ResultOrigin,
  SearchResultSet,
  TagResultSet,
} from "@/lib/contracts/domain";
import {
  insightsTypeFor,
  partitionValid,
  qlooDemographicResultSchema,
  qlooEntityResultSchema,
  qlooTagResultSchema,
  type QlooEntityResult,
  type QlooInsightsResponse,
  type QlooProperties,
  type QlooSearchResponse,
  type QlooTagResult,
} from "@/lib/contracts/qloo";
import { detectAffinityScale, detectClustering, normalizeWithinSet, toAffinityReading } from "@/lib/scoring/affinity";
import { clamp, round } from "@/lib/utils/deterministic";

import { isSurfaceableTag, namespaceOf } from "./tagCuration";

/**
 * Wire → domain mapper.
 *
 * This is the only place that reads Qloo JSON. Its job is to absorb every
 * documented ambiguity once, so nothing downstream has to:
 *
 *  - affinity scale (0–100 vs 0–1) is DETECTED per result set, not assumed
 *  - rank comes from `index` when present, array order otherwise
 *  - backfill origin is read if flagged, otherwise recorded as unknown
 *  - explainability is extracted defensively because its JSON layout is undocumented
 *  - unscored tag results are reported as unscored, never silently zero-filled
 *  - result items are validated ONE AT A TIME, so a divergent sibling cannot
 *    discard a whole call, and the discards are counted rather than hidden
 *  - an entity's actual type is resolved and, when the caller asked for a
 *    specific type, checked against it before the result is used at all
 *
 * Every ambiguity resolved here emits a `ProviderObservation`, so running the
 * real adapter against the live host produces the answer to the doc 04 §6 probe
 * as a side effect.
 */

const BACKFILL_MARKER_KEYS = ["backfill", "origin", "source", "result_source", "is_backfill"] as const;

/**
 * Zod `.nullish()` yields `number | null | undefined`, but the domain contract
 * uses `undefined` alone for "absent". Collapsing null here keeps the mapper's
 * output type-clean without loosening the contract.
 */
function num(value: number | null | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

// ---------------------------------------------------------------------------
// Wire-field readers
// ---------------------------------------------------------------------------
//
// `properties` is the least-documented and most variable part of the payload, so
// it is validated as `unknown` and read through these helpers. Each one states
// what it will and will not turn into a value: a shape it cannot read yields
// `undefined`, never a guess, and never an exception.

/** A string field, or nothing. Non-strings are dropped rather than coerced. */
function readString(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  return undefined;
}

/**
 * A list of strings from a field the documentation types as `string[]`.
 *
 * Accepts three shapes because the live host sends all three: `string[]`
 * (brands), `[{ name, count }]` (places — observed live 2026-10-26 on six of ten
 * `urn:entity:place` results), and a single bare string or object. Reading
 * `name` out of `{ name, count }` is not guesswork: it is the same datum in a
 * wrapper, and the wrapper is Qloo's own. Anything else — numbers, nested
 * objects, arrays of arrays — is dropped, so a list can only ever contain
 * strings that the provider actually sent.
 */
function readStringList(value: unknown): string[] {
  const items = Array.isArray(value) ? value : value === null || value === undefined ? [] : [value];
  const out: string[] = [];
  for (const item of items) {
    if (typeof item === "string") {
      const trimmed = item.trim();
      if (trimmed.length > 0) out.push(trimmed);
      continue;
    }
    if (item !== null && typeof item === "object") {
      const record = item as Record<string, unknown>;
      const name = readString(record.name ?? record.value ?? record.label);
      if (name !== undefined) out.push(name);
    }
  }
  return out;
}

/** A finite number field, or nothing. Strings that look numeric are NOT coerced. */
function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** `properties.image.url`. The live host sends `image: {}` when there is no artwork. */
function readImageUrl(properties: QlooProperties | null | undefined): string | undefined {
  const image = properties?.image;
  if (image === null || typeof image !== "object") return undefined;
  return readString((image as Record<string, unknown>).url);
}

/** `properties.geocode`, which the live host may send empty. */
function readGeocode(properties: QlooProperties | null | undefined): GeoSummary {
  const geocode = properties?.geocode;
  if (geocode === null || typeof geocode !== "object") return {};
  const record = geocode as Record<string, unknown>;
  return { city: readString(record.city), metro: readString(record.metro) };
}

/**
 * `index` may live at result level or inside `query` — its exact location is
 * unverified, so both are checked (doc 03 §15 documents the field, not the path).
 */
function readIndex(raw: QlooEntityResult | QlooTagResult, fallback: number): number {
  const atResult = raw.index;
  if (typeof atResult === "number" && Number.isFinite(atResult)) return atResult;
  const atQuery = raw.query?.index;
  if (typeof atQuery === "number" && Number.isFinite(atQuery)) return atQuery;
  return fallback;
}

/**
 * The entity type Qloo actually returned, resolved to the MOST SPECIFIC form.
 *
 * Every live `/v2/insights` result carries `type: "urn:entity"` — the generic
 * marker — with the concrete type in `subtype` (`urn:entity:brand`,
 * `urn:entity:place`, …), while `/search` puts it in `types[]`. The old
 * precedence `type ?? subtype ?? types[0]` therefore recorded `"urn:entity"` for
 * every insights result, which made it structurally impossible to check whether
 * a brand recommendation was a brand.
 *
 * Specificity is decided by URN depth, not by a list of known types: `urn:entity`
 * is the root and every concrete type extends it, so the candidate with the most
 * segments is the most specific. That keeps this correct for entity types this
 * project has never seen, instead of silently degrading to the generic marker
 * the day Qloo adds one. Ties resolve to the earlier candidate, and the candidate
 * order is fixed, so the result is deterministic.
 */
export function resolveEntityType(item: QlooEntityResult): string {
  const candidates = [item.subtype, item.type, ...(item.types ?? [])].filter(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  );
  if (candidates.length === 0) return "urn:entity";
  return candidates.reduce((best, candidate) =>
    candidate.split(":").length > best.split(":").length ? candidate : best,
  );
}

/**
 * Whether `actual` satisfies a request for `requested`.
 *
 * Compared after `insightsTypeFor` so the documented naming traps cancel out:
 * `urn:entity:video_game` and `urn:entity:videogame` are the same type, and an
 * `urn:entity:album` resolved by search counts as the `urn:entity:artist` the
 * insights enum would have asked for. An `actual` that cannot be mapped at all
 * (the generic `urn:entity`) is compared as-is, so it only matches a request for
 * `urn:entity` — which nothing asks for. Absence of a specific type is treated as
 * absence of evidence, not as a match.
 */
export function entityTypeMatches(requested: string, actual: string): boolean {
  if (requested === actual) return true;
  // A hierarchical refinement of the requested type IS that type. Qloo's URNs
  // nest the same way its tag namespaces do, so `urn:entity:place:restaurant`
  // answers a request for `urn:entity:place`. The reverse is not accepted: a
  // request for a specific type answered with its parent carries no evidence of
  // the specific type, and accepting it would be the same guess the check exists
  // to prevent.
  if (actual.startsWith(`${requested}:`)) return true;
  const left = insightsTypeFor(requested) ?? requested;
  const right = insightsTypeFor(actual) ?? actual;
  return left === right;
}

/** Detect whether Qloo flagged a result as backfilled. Usually it does not. */
function readOrigin(raw: QlooEntityResult): ResultOrigin {
  const record = raw as unknown as Record<string, unknown>;
  for (const key of BACKFILL_MARKER_KEYS) {
    const value = record[key];
    if (typeof value === "string") {
      const lowered = value.toLowerCase();
      if (lowered.includes("cross_domain") || lowered.includes("cross-domain")) return "cross_domain_backfill";
      if (lowered.includes("content_based") || lowered.includes("content-based")) return "content_based_backfill";
    }
    if (typeof value === "boolean" && value === true) return "cross_domain_backfill";
  }
  return "unknown";
}

function readTags(raw: QlooEntityResult): CulturalTag[] {
  if (!raw.tags) return [];
  return raw.tags.flatMap((tag) => {
    // The documented example carries `id`; the LIVE hackathon host carries
    // `tag_id` (and echoes the same string as `value`). Reconcile in a fixed
    // precedence so a real payload is never dropped for a key-name divergence.
    const id = tag.id ?? tag.tag_id ?? tag.value ?? undefined;
    const name = tag.name ?? undefined;
    // The live host also emits tags with a `type` but no name/id/value at all
    // (e.g. a valueless `urn:tag:voice_type:qloo`). `CulturalTag` requires both
    // an id and a name, so drop a tag that carries nothing to surface rather
    // than mint an empty one.
    if (id === undefined && name === undefined) return [];
    const resolvedId = id ?? (name as string);
    const resolvedName = name ?? (id as string);
    return [
      {
        id: resolvedId,
        name: resolvedName,
        namespace: namespaceOf(tag.type ?? resolvedId),
        // Tags arrive from Qloo, so they are Qloo-sourced. Whether they are
        // SURFACEABLE is a separate curation decision (doc 03 §17).
        provenance: "qloo" as const,
      },
    ];
  });
}

function readSocialHandles(raw: QlooEntityResult): Record<string, string[]> {
  const external = raw.external;
  if (!external) return {};
  const handles: Record<string, string[]> = {};
  for (const [network, value] of Object.entries(external)) {
    // The live host nests some networks as a single `{ id }` object rather than
    // an array; normalise both to a list before reading ids.
    const list = Array.isArray(value) ? value : value ? [value] : [];
    const ids = list
      .map((entry) => (entry && typeof entry === "object" && "id" in entry ? String(entry.id ?? "") : ""))
      .filter((id) => id.length > 0);
    if (ids.length > 0) handles[network] = ids;
  }
  return handles;
}

// ---------------------------------------------------------------------------
// Explainability — defensive extraction
// ---------------------------------------------------------------------------

/**
 * Doc 03 §5 confirms `query.explainability` exists, that per-entity scores are
 * normalised 0–1, that entities scoring ≥0.1 are always included, and that a
 * failure surfaces as `query.explainability.warning`. It does NOT document the
 * key layout, so the shape is walked generically.
 *
 * A `warning` is returned as a status rather than thrown: doc 03 §5 says results
 * still return normally, so the analysis must continue with a deterministic
 * fallback instead of failing.
 */
export function extractExplainability(
  raw: unknown,
): { status: ExplainabilityStatus; contributions: ExplainabilityContribution[]; warning?: string } {
  if (raw === null || raw === undefined) {
    return { status: "unavailable", contributions: [] };
  }
  if (typeof raw !== "object") {
    return { status: "unavailable", contributions: [] };
  }

  const record = raw as Record<string, unknown>;
  const warning = typeof record.warning === "string" ? record.warning : undefined;
  const contributions: ExplainabilityContribution[] = [];

  collect(record, contributions, 0);

  if (warning) return { status: "warning", contributions, warning };
  if (contributions.length === 0) return { status: "unavailable", contributions };
  return { status: "available", contributions: dedupeContributions(contributions) };
}

const SCORE_KEYS = ["score", "affinity", "value", "weight", "influence", "contribution"] as const;
const ID_KEYS = ["id", "entity_id", "entityId", "key", "name"] as const;

function collect(node: Record<string, unknown>, out: ExplainabilityContribution[], depth: number): void {
  if (depth > 4) return; // the aggregate object nests top-3/5/10 subsets; cap the walk

  for (const [key, value] of Object.entries(node)) {
    if (key === "warning") continue;

    // `{ "<entityId>": 0.42 }`
    if (typeof value === "number" && Number.isFinite(value)) {
      out.push({ signalEntityId: key, score: clamp(value), provenance: "qloo" });
      continue;
    }

    // `{ "<entityId>": { score: 0.42 } }` or `{ id, score }`
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const nested = value as Record<string, unknown>;
      const score = firstNumber(nested, SCORE_KEYS);
      if (score !== undefined) {
        const id = firstString(nested, ID_KEYS) ?? key;
        out.push({ signalEntityId: id, score: clamp(score), provenance: "qloo" });
        continue;
      }
      collect(nested, out, depth + 1);
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === "object" && !Array.isArray(item)) {
          const nested = item as Record<string, unknown>;
          const score = firstNumber(nested, SCORE_KEYS);
          const id = firstString(nested, ID_KEYS);
          if (score !== undefined && id) {
            out.push({ signalEntityId: id, score: clamp(score), provenance: "qloo" });
          }
        }
      }
    }
  }
}

function firstNumber(record: Record<string, unknown>, keys: readonly string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
}

function firstString(record: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

/** The aggregate object repeats an entity across top-3/5/10 subsets; keep the max. */
function dedupeContributions(items: ExplainabilityContribution[]): ExplainabilityContribution[] {
  const best = new Map<string, ExplainabilityContribution>();
  for (const item of items) {
    const existing = best.get(item.signalEntityId);
    if (!existing || item.score > existing.score) best.set(item.signalEntityId, item);
  }
  return [...best.values()].sort((a, b) => b.score - a.score || a.signalEntityId.localeCompare(b.signalEntityId));
}

// ---------------------------------------------------------------------------
// Entity results
// ---------------------------------------------------------------------------

export interface MapEntityResultSetOptions {
  /**
   * The `filter.type` this call asked for.
   *
   * When supplied, results whose ACTUAL entity type is not that type are
   * excluded and the exclusion is recorded. Qloo honours `filter.type` in
   * practice, but "the provider usually agrees with us" is not validation, and
   * an application that never checks is one that will publish a venue as a brand
   * partner the first time the catalogue changes underneath it.
   *
   * Not supplied for `scoreEntities`: that call names the entities it wants by
   * id, so the caller has already decided the set, and filtering by the nominal
   * `filterType` would discard exactly the results that were asked for.
   */
  requestedType?: string;
  /**
   * Whether `feature.explainability` was actually sent on this call.
   *
   * Passed as `false` to suppress the `explainability_absent` observation. Without
   * it, a call that never asked for contributions reports that the parameter "was
   * silently ignored or the key is not entitled" — a warning that blames the
   * provider for something we did not request. `undefined` keeps the old
   * behaviour, so callers that do not know are not silently exempted.
   */
  explainabilityRequested?: boolean;
}

export function mapEntityResultSet(
  response: QlooInsightsResponse,
  source: DataSource,
  options: MapEntityResultSetOptions = {},
): EntityResultSet {
  const rawItems = response.results?.entities ?? [];
  const observations: ProviderObservation[] = [];

  // Per-item validation. The client has already established that at least one
  // item is usable (otherwise the call failed as `malformed_response`), so a
  // partial set here is a recorded limitation rather than a failure — but it is
  // recorded, because a run that used 9 of 10 results is not the same run as one
  // that used all 10, and the difference is exactly what the profile's
  // completeness claim rests on.
  const { valid, rejected } = partitionValid(qlooEntityResultSchema, rawItems);
  if (rejected.length > 0) {
    observations.push({
      code: "items_rejected",
      detail: `${rejected.length} of ${rawItems.length} entities in this response did not match the documented contract and were excluded (first at index ${rejected[0]?.index}: ${rejected[0]?.issues.join("; ") || "unknown"}). The remaining ${valid.length} are used. This result set is PARTIAL.`,
      severity: "warning",
    });
  }

  // Entity-type validation (§3.1's application boundary). Done before any
  // scoring so an out-of-type result cannot influence the normalisation of the
  // set it does not belong to.
  const requestedType = options.requestedType;
  let items = valid;
  if (requestedType !== undefined) {
    const accepted: QlooEntityResult[] = [];
    const excluded: Array<{ name: string; type: string }> = [];
    for (const item of valid) {
      const actual = resolveEntityType(item);
      if (entityTypeMatches(requestedType, actual)) accepted.push(item);
      else excluded.push({ name: item.name, type: actual });
    }
    if (excluded.length > 0) {
      observations.push({
        code: "entity_type_excluded",
        detail: `${excluded.length} of ${valid.length} entities returned for filter.type=${requestedType} were not of that type and were excluded: ${excluded
          .slice(0, 3)
          .map((entry) => `${entry.name} (${entry.type})`)
          .join(", ")}${excluded.length > 3 ? `, and ${excluded.length - 3} more` : ""}. A result is used as evidence of its own type only.`,
        severity: "warning",
      });
    }
    items = accepted;
  }

  const rawAffinities = items.map((item) => num(item.query?.affinity));
  const detection = detectAffinityScale(rawAffinities);

  if (detection.scale === "absent" && items.length > 0) {
    observations.push({
      code: "affinity_absent",
      detail: `${items.length} results returned with no query.affinity field. Assumption A1 would fail; Taste DNA falls back to level L2.`,
      severity: "critical",
    });
  } else if (detection.scale === "percent") {
    observations.push({
      code: "affinity_scale_percent",
      detail: `Observed affinity range ${detection.observedMin}–${detection.observedMax}, consistent with the documented 0–100 scale. Resolves assumption A2.`,
      severity: "info",
    });
  } else if (detection.scale === "unit") {
    observations.push({
      code: "affinity_scale_unit",
      detail: detection.ambiguous
        ? `All ${detection.sampleSize} observed affinities fall within [0,1] (range ${detection.observedMin}–${detection.observedMax}, a spread of ${round((detection.observedMax ?? 0) - (detection.observedMin ?? 0), 4)}). This is AMBIGUOUS: it may be a 0–1 encoding, or a 0–100 encoding with uniformly low scores. Assumption A2 remains unresolved, so no absolute meaning is claimed for any score derived from it.`
        : `Observed affinities within [0,1]; treating as a unit scale.`,
      severity: detection.ambiguous ? "warning" : "info",
    });
  } else if (detection.scale === "mixed") {
    observations.push({
      code: "affinity_scale_mixed",
      detail: `Observed affinities outside both documented ranges (${detection.observedMin}–${detection.observedMax}). Values are NOT rescaled and are treated as unusable.`,
      severity: "critical",
    });
  }

  const ranks = items.map((item, i) => readIndex(item, i));
  const scaled = rawAffinities.map((value) => toAffinityReading(value, detection.scale).scaled);
  const normalized = normalizeWithinSet(scaled, ranks);

  const entities: CulturalEntity[] = items.map((item, i) => {
    const explainability = extractExplainability(item.query?.explainability);
    const normalizedScore = normalized[i] ?? {
      value: 0,
      method: "unavailable" as const,
      rank: i,
      setSize: items.length,
    };
    return buildEntity(item, i, ranks[i] ?? i, detection.scale, normalizedScore, explainability, source);
  });

  if (entities.some((e) => e.explainability.status === "warning")) {
    observations.push({
      code: "explainability_warning",
      detail: "Qloo returned query.explainability.warning. Results are still valid; the deterministic rationale fallback is used.",
      severity: "warning",
    });
  }
  if (
    options.explainabilityRequested !== false &&
    entities.length > 0 &&
    entities.every((e) => e.explainability.contributions.length === 0)
  ) {
    observations.push({
      code: "explainability_absent",
      detail: "feature.explainability produced no per-entity contributions. Either the parameter was silently ignored (doc 03 §11) or the key is not entitled. Deterministic fallback required.",
      severity: "warning",
    });
  }
  if (entities.some((e) => e.origin === "unknown")) {
    observations.push({
      code: "backfill_unflagged",
      detail: "Results are not flagged by origin, so cross-domain backfill cannot be distinguished from primary results. Unexpected affinities therefore rely on the set-difference method, not on an API flag.",
      severity: "info",
    });
  }
  if (entities.length === 0) {
    // Distinguish "Qloo returned nothing" from "Qloo returned things we could
    // not use". Both end here, but only the first is an answer about the
    // catalogue; the second is a defect in our contract and must not be allowed
    // to read as a calm empty result.
    observations.push({
      code: "empty_result_set",
      detail:
        rawItems.length > 0
          ? `Qloo returned ${rawItems.length} entities but none survived validation, so no result is available from this call. This is a contract failure, not an empty catalogue answer.`
          : "No entities returned. Check that at least one valid signal or filter was supplied (doc 03 §4).",
      severity: "warning",
    });
  }

  // Clustering is measured on the SCALED affinities. Measuring it on the
  // normalised values — which is what this used to do — inverts the answer:
  // min-max stretches any non-zero spread across the full 0..1 range, so the
  // tightest possible provider cluster scored as "not clustered".
  const scoresClustered = detectClustering(scaled);
  if (scoresClustered) {
    observations.push({
      code: "scores_clustered",
      detail: `Top results are within a negligible score gap of one another (scaled spread ${normalized[0]?.setSpread ?? 0}). Doc 03 §15: this is an expected cluster of strong matches, not a failure, and no single winner should be manufactured. Ordering inside this set therefore carries no reliable meaning.`,
      severity: "info",
    });
  }

  return {
    kind: "entities",
    entities,
    meta: {
      source,
      observations,
      affinityScale: detection.scale,
      resultCount: entities.length,
      durationMs: num(response.results?.duration) ?? num(response.duration),
      scoresClustered,
    },
  };
}

function buildEntity(
  item: QlooEntityResult,
  position: number,
  rank: number,
  scale: ReturnType<typeof detectAffinityScale>["scale"],
  normalizedScore: NormalisedScore,
  explainability: { status: ExplainabilityStatus; contributions: ExplainabilityContribution[]; warning?: string },
  source: DataSource,
): CulturalEntity {
  const origin = readOrigin(item);
  const properties = item.properties ?? undefined;
  const industries = readStringList(properties?.industries);
  const rawAffinity = num(item.query?.affinity);
  return {
    id: item.entity_id,
    name: item.name,
    // The MOST SPECIFIC type Qloo reported. Every live insights result carries
    // `type: "urn:entity"` with the real type in `subtype`, so the old
    // `type ?? subtype` precedence stored the generic marker for everything and
    // no downstream check could tell a brand from a venue.
    type: resolveEntityType(item),
    subtype: item.subtype ?? undefined,
    disambiguation: item.disambiguation ?? undefined,
    description: readString(properties?.description),
    industries: industries.length > 0 ? industries : undefined,
    imageUrl: readImageUrl(properties),
    releaseYear: readNumber(properties?.release_year),
    geo: readGeocode(properties),
    websites: readStringList(properties?.websites),
    socialHandles: readSocialHandles(item),
    popularity: typeof item.popularity === "number" ? clamp(item.popularity) : undefined,
    affinity: toAffinityReading(rawAffinity, scale),
    // `position` is kept distinct from `rank`: position is array order, rank is
    // Qloo's `index`. They usually agree but must not be assumed to.
    //
    // `raw` and `scale` travel with the normalised value so that nothing
    // downstream can present `value` without the figure it was stretched from.
    rank: {
      ...normalizedScore,
      rank: rank === -1 ? position : rank,
      raw: rawAffinity,
      scale,
    },
    tags: readTags(item),
    explainability: {
      status: source.mode === "synthetic" ? "synthetic" : explainability.status,
      contributions: explainability.contributions,
      warning: explainability.warning,
    },
    origin,
    provenance: source.mode === "synthetic" ? "synthetic" : "qloo",
  };
}

// ---------------------------------------------------------------------------
// /search
// ---------------------------------------------------------------------------

export function mapSearchResponse(
  response: QlooSearchResponse,
  source: DataSource,
): SearchResultSet {
  const rawItems = response.results ?? [];
  const observations: ProviderObservation[] = [];

  // Per-item validation, for the same reason as the insights path: one hit whose
  // `properties` diverge must not turn a whole Review-stage lookup into `error`,
  // which would leave the creator unable to confirm an interest the catalogue
  // does in fact hold.
  const { valid, rejected } = partitionValid(qlooEntityResultSchema, rawItems);
  if (rejected.length > 0) {
    observations.push({
      code: "items_rejected",
      detail: `${rejected.length} of ${rawItems.length} search hits did not match the documented contract and were excluded (first at index ${rejected[0]?.index}: ${rejected[0]?.issues.join("; ") || "unknown"}). The creator sees ${valid.length} candidate${valid.length === 1 ? "" : "s"} for this phrase instead of the full list.`,
      severity: "warning",
    });
  }
  const raw = valid;
  const ambiguous = raw.length > 1;

  if (rawItems.length === 0) {
    observations.push({
      code: "empty_result_set",
      detail: "Search returned no matches. Qloo answers 404 for this, which is a legitimate empty state rather than an error.",
      severity: "info",
    });
  } else if (raw.length === 0) {
    observations.push({
      code: "empty_result_set",
      detail: `Search returned ${rawItems.length} hits but none survived validation, so the outcome for this phrase is UNKNOWN rather than "no match". The two must not be presented alike: one is an answer from the catalogue, the other is our failure to read it.`,
      severity: "warning",
    });
  }

  const normalized = normalizeWithinSet(
    raw.map(() => undefined),
    raw.map((_, i) => i),
  );

  const matches = raw.map((item, i) => ({
    entity: buildEntity(
      item,
      i,
      i,
      "absent",
      normalized[i] ?? { value: 0, method: "unavailable" as const, rank: i, setSize: raw.length },
      { status: "unavailable" as const, contributions: [] },
      source,
    ),
    matchRank: i,
    ambiguous,
  }));

  return {
    kind: "search",
    matches,
    meta: {
      source,
      observations,
      // `/search` ranks by textual match. There is no affinity here, and doc 03
      // §15 warns against conflating the two quantities.
      affinityScale: "absent",
      resultCount: matches.length,
      durationMs: num(response.duration),
      scoresClustered: false,
    },
  };
}

// ---------------------------------------------------------------------------
// Tag results
// ---------------------------------------------------------------------------

export function mapTagResultSet(
  response: QlooInsightsResponse,
  source: DataSource,
): TagResultSet {
  const rawItems = response.results?.tags ?? [];
  const observations: ProviderObservation[] = [];

  const { valid, rejected } = partitionValid(qlooTagResultSchema, rawItems);
  if (rejected.length > 0) {
    observations.push({
      code: "items_rejected",
      detail: `${rejected.length} of ${rawItems.length} tag results did not match the documented contract and were excluded (first at index ${rejected[0]?.index}: ${rejected[0]?.issues.join("; ") || "unknown"}). This tag set is PARTIAL.`,
      severity: "warning",
    });
  }

  const rawAffinities = valid.map((item) => num(item.query?.affinity));
  const detection = detectAffinityScale(rawAffinities);
  const unscored = detection.scale === "absent";

  if (unscored && valid.length > 0) {
    observations.push({
      code: "tag_results_unscored",
      detail: `${valid.length} tag results returned with an empty query object. This matches the documented example and confirms method M1 cannot rank tags on its own — the Taste DNA must use M3 (tags harvested from scored entity results).`,
      severity: "critical",
    });
  }

  const ranks = valid.map((item, i) => readIndex(item, i));
  const scaled = rawAffinities.map((value) => toAffinityReading(value, detection.scale).scaled);
  const normalized = normalizeWithinSet(scaled, ranks);

  const tags = valid
    .map((item, i) => {
      const id = item.tag_id ?? item.tag_value ?? undefined;
      // `name` is validated as `unknown` so one nameless row cannot discard the
      // set. A row with neither a name nor an id has nothing to surface, so it
      // is dropped rather than minted from a placeholder.
      const name = readString(item.name) ?? readString(id);
      if (name === undefined) return undefined;
      const resolvedId = id ?? name;
      const namespace = namespaceOf(item.subtype ?? item.type ?? resolvedId);
      const tag: CulturalTag = {
        id: resolvedId,
        name,
        namespace,
        provenance: source.mode === "synthetic" ? "synthetic" : "qloo",
      };
      return {
        tag,
        score: normalized[i]?.value ?? 0,
        // A tag returned once has support 1. Doc 04 §4.2 requires support ≥ 2
        // before a tag may be surfaced, so single-occurrence tags are kept here
        // and filtered by the caller.
        support: 1,
        contributedBy: [],
        provenance: tag.provenance,
        surfaceable: isSurfaceableTag(tag),
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== undefined)
    .filter((entry) => entry.surfaceable)
    .map(({ surfaceable: _surfaceable, ...entry }) => entry);

  if (tags.length < valid.length) {
    observations.push({
      code: "tag_results_unscored",
      detail: `${valid.length - tags.length} of ${valid.length} tags were withheld — either by the namespace policy (doc 03 §17: plot-keyword namespaces such as urn:tag:keyword:* are never surfaced as cultural taste) or because the row carried no usable name.`,
      severity: "info",
    });
  }

  return {
    kind: "tags",
    tags,
    unscored,
    meta: {
      source,
      observations,
      affinityScale: detection.scale,
      resultCount: tags.length,
      durationMs: num(response.results?.duration) ?? num(response.duration),
      scoresClustered: false,
    },
  };
}

// ---------------------------------------------------------------------------
// Demographics
// ---------------------------------------------------------------------------

/**
 * Demographic values are SIGNED deltas, not 0–100 affinities (doc 03 §6).
 * They are passed through unchanged and clamped nowhere — clamping a signed
 * delta to [0,1] would destroy the information that a group is BELOW average.
 */
export function mapDemographicResultSet(
  response: QlooInsightsResponse,
  source: DataSource,
): DemographicResultSet {
  const rawItems = response.results?.demographics ?? [];
  const observations: ProviderObservation[] = [];
  const provenance = source.mode === "synthetic" ? ("synthetic" as const) : ("qloo" as const);

  const { valid: raw, rejected } = partitionValid(qlooDemographicResultSchema, rawItems);
  if (rejected.length > 0) {
    observations.push({
      code: "items_rejected",
      detail: `${rejected.length} of ${rawItems.length} demographic rows did not match the documented contract and were excluded (first at index ${rejected[0]?.index}: ${rejected[0]?.issues.join("; ") || "unknown"}). The audience dimension is computed from fewer signals than were returned.`,
      severity: "warning",
    });
  }

  if (rawItems.length === 0) {
    observations.push({
      code: "empty_result_set",
      detail: "No demographic rows returned. filter.type=urn:demographics additionally requires signal.interests.entities or signal.interests.tags.",
      severity: "warning",
    });
  }

  const rows = raw.map((item) => ({
    signalEntityId: item.entity_id,
    age: Object.entries(item.query?.age ?? {}).map(([bucket, delta]) => ({
      bucket,
      delta: typeof delta === "number" ? delta : 0,
      provenance,
    })),
    gender: Object.entries(item.query?.gender ?? {}).map(([bucket, delta]) => ({
      bucket,
      delta: typeof delta === "number" ? delta : 0,
      provenance,
    })),
  }));

  return {
    kind: "demographics",
    rows,
    meta: {
      source,
      observations,
      affinityScale: "absent",
      resultCount: rows.length,
      durationMs: num(response.results?.duration) ?? num(response.duration),
      scoresClustered: false,
    },
  };
}

/**
 * Read the aggregate explainability object. Doc 03 §5 calls it "top-level"
 * without saying whether that means the response root or inside `results`, so
 * both locations are checked.
 */
export function readAggregateExplainability(response: QlooInsightsResponse): unknown {
  const root = response as unknown as Record<string, unknown>;
  const results = (response.results ?? {}) as unknown as Record<string, unknown>;
  return root.query ?? root.explainability ?? results.query ?? results.explainability;
}
