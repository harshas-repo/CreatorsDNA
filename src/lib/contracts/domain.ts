/**
 * Internal domain contract.
 *
 * Everything downstream of the provider boundary speaks these types. They are
 * deliberately NOT the Qloo wire shape: the mapper normalises ambiguity (scale,
 * rank, backfill origin) once, so the scoring engine, the visualisations and the
 * copy templates never have to guess.
 *
 * The four provenance classes come straight from doc 05 §13, which requires the
 * product to distinguish:
 *   1. data returned directly by Qloo
 *   2. creator-provided information
 *   3. CreatorsDNA-derived scores and classifications
 *   4. illustrative or synthetic examples
 * and to NEVER present class 4 as class 1.
 */

/** Where a value came from. Drives both colour role (doc 05 §12) and copy. */
export type Provenance = "qloo" | "creator" | "derived" | "synthetic";

/** How a result set was obtained. `synthetic` is a hard UI-labelling trigger. */
export type DataMode = "live" | "cached" | "synthetic";

export interface DataSource {
  mode: DataMode;
  providerId: string;
  /** Human-readable label rendered in the UI banner, e.g. "Synthetic development data". */
  label: string;
  /** True when the data must never be described as a Qloo discovery. */
  isIllustrative: boolean;
}

// ---------------------------------------------------------------------------
// Affinity scale — the single most consequential normalisation (doc 03 §15)
// ---------------------------------------------------------------------------

/**
 * Qloo's concept documentation says affinity is 0–100. The JSON encoding was
 * never verified (assumption A2). Rather than hard-coding one answer, the mapper
 * DETECTS the scale from what actually arrived and records it. When the real key
 * lands, the recorded observation answers A2 without any code change.
 */
export type AffinityScale =
  | "percent" // observed values in (1, 100]
  | "unit" // observed values all within [0, 1]
  | "mixed" // both ranges present — contradictory, must be flagged
  | "absent"; // no affinity field arrived at all (assumption A1 fails)

export interface AffinityReading {
  /** Value exactly as returned, or `undefined` when absent. Never rescaled here. */
  raw: number | undefined;
  /**
   * Value mapped to 0..1 using the detected scale. `undefined` when `raw` is
   * undefined. This is comparable WITHIN one result set only — doc 03 §15:
   * scores are normalised per query, so cross-call comparison is invalid.
   */
  scaled: number | undefined;
  scale: AffinityScale;
}

/**
 * A value normalised across a whole result set. This — and only this — may be
 * combined with values from another result set (doc 03 §15 rule 1).
 */
export interface NormalisedScore {
  /** 0..1 min-max within the result set; falls back to rank when all values tie. */
  value: number;
  /**
   * Which method produced `value`. Surfaced in the methodology disclosure.
   *
   * `declared` is not a normalisation at all: the entity is one the creator
   * confirmed themselves, so it carries full weight and was never ranked against
   * anything. It exists as its own value because min-maxing a creator's own stated
   * interests against each other would hand the last of them a weight of zero,
   * and because a disclosure that called an assertion "min-max normalised" would be
   * describing arithmetic that never happened.
   */
  method: "minmax" | "rank" | "declared" | "unavailable";
  /** Rank position within the set, 0-based. Derived from `index` when present. */
  rank: number;
  /** Size of the set the value was normalised against. */
  setSize: number;
  /**
   * The affinity `value` was derived from, EXACTLY as the provider returned it.
   *
   * Carried beside the normalised value rather than left behind by it. Min-max
   * normalisation destroys the one fact a reader most needs in order to judge the
   * result — how much the provider actually distinguished these candidates — so a
   * `value` of 1.00 is meaningless without the raw figure it was stretched from.
   * Observed live: a brand set spanning raw affinities 0.8211–0.8382 normalises to
   * 1.00 … 0.00, which reads as a total spread where the provider reported almost
   * none.
   */
  raw?: number;
  /** The scale detected for the set, so `raw` can be interpreted rather than guessed. */
  scale?: AffinityScale;
  /**
   * `max − min` of the scaled affinities across the whole set.
   *
   * This is the exaggeration guard: when the spread is tiny, `value` encodes
   * ordering inside a near-tie, and no claim of absolute fit can rest on it.
   */
  setSpread?: number;
}

// ---------------------------------------------------------------------------
// Explainability
// ---------------------------------------------------------------------------

export interface ExplainabilityContribution {
  /** Qloo entity id of the input signal that contributed. */
  signalEntityId: string;
  /** Resolved display name, filled in by the pipeline from the creator profile. */
  signalName?: string;
  /** 0..1, as documented in doc 03 §5. */
  score: number;
  provenance: Provenance;
}

export type ExplainabilityStatus =
  | "available" // Qloo returned usable per-entity contributions
  | "warning" // `query.explainability.warning` was present
  | "unavailable" // nothing returned — deterministic fallback required
  | "synthetic"; // produced by the synthetic provider

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

export interface CulturalTag {
  id: string;
  name: string;
  /** e.g. `urn:tag:genre:media`. Used for the doc 03 §17 allow/deny-listing. */
  namespace?: string;
  provenance: Provenance;
}

/** Where a result came from within a single Insights response. */
export type ResultOrigin =
  | "primary"
  | "cross_domain_backfill" // `backfill.cross_domain.take` — API-sourced "beyond your niche"
  | "content_based_backfill" // `backfill.content_based.take`
  | "unknown"; // response did not flag it (doc 03 §8 step 3: may need inference)

export interface GeoSummary {
  city?: string;
  metro?: string;
}

export interface CulturalEntity {
  id: string;
  name: string;
  /** Qloo URN, e.g. `urn:entity:movie`. */
  type: string;
  /** Finer URN when present; used to group the Taste DNA by category. */
  subtype?: string;
  disambiguation?: string;
  description?: string;
  /**
   * Qloo `properties.industries` (brand entities). Used to derive a descriptive
   * category for discovered brands that are not in the curated registry.
   */
  industries?: string[];
  imageUrl?: string;
  releaseYear?: number;
  geo?: GeoSummary;
  /** External handles/websites, Qloo-sourced and therefore verifiable (doc 03 §6). */
  websites: string[];
  socialHandles: Record<string, string[]>;
  /** 0..1 catalogue popularity, independent of the query (doc 03 §15). */
  popularity: number | undefined;
  affinity: AffinityReading;
  rank: NormalisedScore;
  tags: CulturalTag[];
  explainability: {
    status: ExplainabilityStatus;
    contributions: ExplainabilityContribution[];
    warning?: string;
  };
  origin: ResultOrigin;
  provenance: Provenance;
}

export interface ResultSetMeta {
  source: DataSource;
  /** What the mapper observed. Feeds the probe report and the honesty UI. */
  observations: ProviderObservation[];
  affinityScale: AffinityScale;
  resultCount: number;
  durationMs?: number;
  /** True when every result tied, meaning ranking carries no information. */
  scoresClustered: boolean;
}

/**
 * Something the adapter noticed that a human should know about — e.g. affinity
 * was absent, or a signalled call returned the same ordering as the baseline
 * (which would mean signals were silently ignored, doc 03 §11 / fact F22).
 */
export interface ProviderObservation {
  code: ObservationCode;
  detail: string;
  severity: "info" | "warning" | "critical";
}

export type ObservationCode =
  | "affinity_absent" // A1 would fail
  | "affinity_scale_percent" // A2 resolved: 0–100
  | "affinity_scale_unit" // A2 resolved: 0–1
  | "affinity_scale_mixed"
  | "explainability_warning"
  | "explainability_absent"
  | "tag_results_unscored" // M1 unusable → Taste DNA relies on M2/M3
  | "signals_appear_ignored" // F22 / fallback level L4 — HARD FAIL
  | "scores_clustered"
  | "backfill_unflagged"
  | "type_substituted" // e.g. videogame vs video_game
  | "empty_result_set"
  // Some wire items failed validation and were dropped, so the set is PARTIAL.
  // Recorded rather than thrown: the surviving items are still verified evidence
  // and discarding them would waste a call, but a run that silently used 9 of 10
  // results would be reporting a completeness it does not have.
  | "items_rejected"
  // Results whose actual entity type was not the type the call asked for. Qloo
  // honours `filter.type`, but the answer is only trustworthy if it is checked,
  // and a brand list assembled from whatever came back is how a venue ends up
  // being recommended as a brand partner.
  | "entity_type_excluded"
  | "synthetic_data";

export interface EntityResultSet {
  kind: "entities";
  entities: CulturalEntity[];
  meta: ResultSetMeta;
}

export interface ScoredTasteTag {
  tag: CulturalTag;
  /** 0..1 affinity-weighted co-occurrence across the entity results (method M3). */
  score: number;
  /** Number of distinct entity results carrying this tag. Must be ≥2 to surface. */
  support: number;
  /** Entities that contributed, strongest first — this is the provenance trail. */
  contributedBy: Array<{ entityId: string; entityName: string; weight: number }>;
  provenance: Provenance;
}

export interface TagResultSet {
  kind: "tags";
  tags: ScoredTasteTag[];
  /** Raw tag rows as returned, before M3 aggregation. May be unscored. */
  unscored: boolean;
  meta: ResultSetMeta;
}

/**
 * Demographic deltas. Values are SIGNED and must never be rendered as a
 * percentage of people (doc 03 §6, §15).
 */
export interface DemographicDelta {
  bucket: string;
  /** Signed delta vs average, e.g. +0.43 / −0.28. */
  delta: number;
  provenance: Provenance;
}

export interface DemographicResultSet {
  kind: "demographics";
  /** Keyed by the input signal's `entity_id`, which may be a tag URN. */
  rows: Array<{
    signalEntityId: string;
    age: DemographicDelta[];
    gender: DemographicDelta[];
  }>;
  meta: ResultSetMeta;
}

/**
 * `/search` result. Carries no affinity — `sort_by=match` ranks by textual
 * relevance, which is a different quantity and must not be conflated with it
 * (doc 03 §15: four scales in one response).
 */
export interface SearchResultSet {
  kind: "search";
  matches: Array<{
    entity: CulturalEntity;
    /** 0-based textual match rank, from the order Qloo returned. */
    matchRank: number;
    /** True when more than one hit shared the query, so the user must choose
     *  rather than the app guessing (doc 02 §7). */
    ambiguous: boolean;
  }>;
  meta: ResultSetMeta;
}

export type AnyResultSet = EntityResultSet | TagResultSet | DemographicResultSet | SearchResultSet;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type ProviderErrorCode =
  | "not_configured" // no API key
  | "unauthorized"
  | "forbidden_type" // 403 "You do not have permission to access urn:entity:…"
  | "invalid_request" // 400, incl. "at least one valid signal or filter is required"
  | "not_found" // 404 — legitimate empty state on /search
  | "rate_limited" // 429
  | "quota_exhausted"
  | "timeout"
  | "network"
  | "malformed_response" // schema validation failed
  | "unsupported" // provider cannot perform this intent at all
  | "unknown";

/**
 * Facts only the PIPELINE knows, kept deliberately out of `ObservationCode`.
 *
 * `ObservationCode` is the provider layer's own honesty ledger: every member is
 * something an adapter noticed about a response it was handed. These are
 * different in kind — "nothing was substituted for the empty brand list", "the
 * silent-ignore canary could not run because only one interest resolved" — and
 * forcing them into that union would make a pipeline-level fact masquerade as
 * something the API said, which is a lie about provenance rather than a
 * convenience.
 *
 * They are a closed union anyway, and that is the point of declaring them here:
 * `mergeObservations` flattens all three families into one list whose `code` is
 * typed `string`, and the creator-facing copy in `explainObservation` is keyed on
 * each family separately so that adding a ninth code is a compile error in the
 * copy layer until somebody has written what it means to the person reading the
 * result. A free `string` would let a new diagnostic surface as a bare snake_case
 * key, in production, on the first run that hit it.
 */
export type PipelineObservationCode =
  | "no_resolved_signals"
  | "no_mappable_entity_type"
  | "brand_discovery_empty"
  | "brand_discovery_failed"
  | "entity_scoring_unsupported"
  | "declared_readback_empty"
  | "ignore_check_unavailable"
  | "ignore_check_inconclusive";

export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly status?: number;
  readonly upstreamMessage?: string;
  /** True when the UI should render a degraded state rather than an error. */
  readonly recoverable: boolean;

  constructor(
    code: ProviderErrorCode,
    message: string,
    options: { status?: number; upstreamMessage?: string; recoverable?: boolean; cause?: unknown } = {},
  ) {
    super(message);
    this.name = "ProviderError";
    this.code = code;
    this.status = options.status;
    this.upstreamMessage = options.upstreamMessage;
    this.recoverable = options.recoverable ?? false;
    if (options.cause !== undefined) this.cause = options.cause;
  }
}
