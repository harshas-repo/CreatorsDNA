import { z } from "zod";

/**
 * Qloo wire contract.
 *
 * These schemas describe **what Qloo actually sends**, as documented in
 * `docs/03-qloo-api-reference.md` §3–§6 and §15. They are deliberately
 * permissive at the edges (`.passthrough()`, most fields optional) because
 * the OpenAPI declares result items as untyped `{}` and several fields
 * remain unverified against the live hackathon host.
 *
 * Rules enforced here:
 *  - Nothing downstream may touch `unknown` JSON. It is parsed once, here.
 *  - Unverified fields are `nullish()`, never required, so their absence is
 *    recorded rather than crashing (assumptions A1–A16).
 *  - `/search` returns a FLAT `results` array while `/v2/insights` returns
 *    `results.entities`. Doc 03 §6 warns these must not share one parser, so
 *    they have separate schemas.
 */

// ---------------------------------------------------------------------------
// Entity types (doc 03 §3)
// ---------------------------------------------------------------------------

/** `filter.type` values present in the Insights OpenAPI enum. */
export const QLOO_INSIGHTS_ENTITY_TYPES = [
  "urn:entity:artist",
  "urn:entity:book",
  "urn:entity:brand",
  "urn:entity:locality",
  "urn:entity:movie",
  "urn:entity:person",
  "urn:entity:place",
  "urn:entity:podcast",
  "urn:entity:tv_show",
  "urn:entity:videogame",
] as const;

export type QlooInsightsEntityType = (typeof QLOO_INSIGHTS_ENTITY_TYPES)[number];

/**
 * Non-enum `filter.type` values documented on the use-case pages.
 * `urn:tag` support for signals is contradiction #1 / assumption A3.
 */
export const QLOO_SPECIAL_FILTER_TYPES = ["urn:tag", "urn:demographics", "urn:heatmap"] as const;
export type QlooSpecialFilterType = (typeof QLOO_SPECIAL_FILTER_TYPES)[number];

export type QlooFilterType = QlooInsightsEntityType | QlooSpecialFilterType;

/**
 * Accepted by `/search` but NOT valid as an Insights `filter.type` (doc 03 §3).
 * An entity resolved via search may carry one of these, so it must be mapped
 * onto the Insights set before use as a signal type.
 */
export const QLOO_SEARCH_ONLY_TYPES = [
  "urn:entity:actor",
  "urn:entity:album",
  "urn:entity:author",
  "urn:entity:director",
  "urn:entity:locality",
] as const;
export type QlooSearchOnlyType = (typeof QLOO_SEARCH_ONLY_TYPES)[number];

/**
 * Contradiction #4: the Insights enum says `videogame`, the hackathon guide
 * says `video_game`. Both are emitted by the request builder and both are
 * accepted by the parser until the live host settles it.
 */
export const VIDEOGAME_TYPE_VARIANTS = ["urn:entity:videogame", "urn:entity:video_game"] as const;

/**
 * Search-only type → the nearest Insights `filter.type`.
 *
 * `/search` returns types that Insights will not accept as `filter.type`, so an
 * entity resolved by search cannot be used to choose a recommendation type
 * without this mapping (doc 03 §3). The mappings collapse onto the closest
 * Insights enum member: people onto `person`, albums onto `artist`.
 *
 * `locality` is listed in `QLOO_SEARCH_ONLY_TYPES` above but is ALSO in the
 * Insights enum. That is a redundancy in the source documentation rather than a
 * contradiction; `insightsTypeFor` checks the Insights enum first, so locality
 * resolves to itself either way. Flagged, not silently rewritten.
 */
const SEARCH_TO_INSIGHTS_TYPE: Record<string, QlooInsightsEntityType> = {
  "urn:entity:actor": "urn:entity:person",
  "urn:entity:director": "urn:entity:person",
  "urn:entity:author": "urn:entity:person",
  "urn:entity:album": "urn:entity:artist",
  "urn:entity:video_game": "urn:entity:videogame",
};

/**
 * Map any entity type onto the Insights `filter.type` enum.
 *
 * Returns `undefined` for a type that has no Insights equivalent. Callers must
 * handle that: substituting a guess would mean recommending in a category the
 * creator never asked about, and the resulting numbers would be about something
 * else entirely.
 */
export function insightsTypeFor(type: string | undefined): QlooInsightsEntityType | undefined {
  if (type === undefined) return undefined;
  const direct = QLOO_INSIGHTS_ENTITY_TYPES.find((candidate) => candidate === type);
  if (direct !== undefined) return direct;
  return SEARCH_TO_INSIGHTS_TYPE[type];
}

/** Weight strings accepted by `*.weight` and `bias.*` params (doc 03 §16). */
export const QLOO_WEIGHT_LEVELS = [
  "very_low",
  "low",
  "mid",
  "medium",
  "high",
  "very_high",
] as const;
export type QlooWeightLevel = (typeof QLOO_WEIGHT_LEVELS)[number];

/**
 * `operator.*` values. Doc 03 §16: the defaults are ASYMMETRIC
 * (`operator.filter.tags` defaults to `union`, but
 * `operator.signal.interests.tags` defaults to `intersection`), so every
 * operator is always set explicitly by the request builder.
 */
export const QLOO_OPERATORS = ["union", "intersection"] as const;
export type QlooOperator = (typeof QLOO_OPERATORS)[number];

/** Age buckets. Contradiction #13 — three sources disagree; this is the Insights set. */
export const QLOO_AGE_BUCKETS = [
  "24_and_younger",
  "25_to_29",
  "30_to_34",
  "35_to_44",
  "45_to_54",
  "55_and_older",
] as const;
export type QlooAgeBucket = (typeof QLOO_AGE_BUCKETS)[number];

/**
 * Age buckets as a person would read them.
 *
 * Declared beside the union rather than inside the onboarding form, for the same
 * reason `PLATFORM_LABEL` sits beside `CONTENT_PLATFORMS`: the raw ids are the
 * wire format, and showing `24_and_younger` to a creator is showing them our
 * encoding. Keyed by the closed union with no fallback lookup, so adding a bucket
 * is a compile error here until it is given a label — a `Record<string, string>`
 * with a `?? bucket` default would silently print the raw id instead.
 */
export const AGE_BUCKET_LABEL: Record<QlooAgeBucket, string> = {
  "24_and_younger": "24 and younger",
  "25_to_29": "25–29",
  "30_to_34": "30–34",
  "35_to_44": "35–44",
  "45_to_54": "45–54",
  "55_and_older": "55 and older",
};

export const QLOO_GENDERS = ["male", "female"] as const;
export type QlooGender = (typeof QLOO_GENDERS)[number];

export const SORT_BY_VALUES = ["affinity", "distance", "rating", "quality"] as const;
export type SortBy = (typeof SORT_BY_VALUES)[number];

/** `take` is documented default 20, hard max 50 (contradiction #15). */
export const QLOO_TAKE_MAX = 50;
export const QLOO_TAKE_DEFAULT = 20;
export const QLOO_PAGE_MAX = 100;

// ---------------------------------------------------------------------------
// Shared fragments
// ---------------------------------------------------------------------------

/** `{ id, name, type }` as seen in an entity result's `tags[]` (doc 03 §6). */
export const qlooTagRefSchema = z
  .object({
    // The documented example uses `id`; the LIVE hackathon host returns `tag_id`
    // (and echoes it as `value`). All three are accepted and reconciled by the
    // mapper, because requiring the documented key alone rejects every real
    // payload.
    id: z.string().nullish(),
    tag_id: z.string().nullish(),
    value: z.string().nullish(),
    // The LIVE host emits some tags with a `type` but NO name/id/value at all
    // (e.g. a valueless `urn:tag:voice_type:qloo`). Requiring `name` would let
    // one empty tag reject an entire result set, so it is optional here and the
    // mapper drops tags that carry nothing to surface.
    name: z.string().nullish(),
    type: z.string().nullish(),
  })
  .passthrough();
export type QlooTagRef = z.infer<typeof qlooTagRefSchema>;

const externalIdEntrySchema = z
  .object({
    id: z.string().nullish(),
    user_rating: z.union([z.number(), z.string()]).nullish(),
    user_rating_count: z.union([z.number(), z.string()]).nullish(),
    critic_rating: z.union([z.number(), z.string()]).nullish(),
  })
  .passthrough();

const externalIdListSchema = z.array(externalIdEntrySchema);

// The documented example nests each network as an ARRAY of id objects; the LIVE
// hackathon host nests several of them as a SINGLE object (`{ id, ... }`, e.g.
// facebook/instagram/lastfm/spotify). Both shapes are accepted per network so a
// real payload is never rejected for the array-vs-object divergence.
const externalIdSchema = z.union([externalIdListSchema, externalIdEntrySchema]);

export const qlooExternalSchema = z
  .object({
    instagram: externalIdSchema.nullish(),
    twitter: externalIdSchema.nullish(),
    facebook: externalIdSchema.nullish(),
    wikidata: externalIdSchema.nullish(),
    imdb: externalIdSchema.nullish(),
    metacritic: externalIdSchema.nullish(),
    rottentomatoes: externalIdSchema.nullish(),
    letterboxd: externalIdSchema.nullish(),
  })
  .passthrough();
export type QlooExternal = z.infer<typeof qlooExternalSchema>;

export const qlooPropertiesSchema = z
  .object({
    // Every field in this bag is read as `unknown` and reconciled by the mapper
    // (`readString` / `readStringList` / `readNumber`). The reason is structural,
    // not laziness: `properties` is the part of the payload whose shape the
    // documentation describes least and the live host varies most, and because
    // Zod validates an array as a whole, ONE unexpected member of ONE unconsumed
    // field used to reject an entire result set and surface as a
    // `malformed_response`.
    //
    // Observed live 2026-10-26 on `filter.type=urn:entity:place`: 6 of 10
    // entities carried `properties.keywords` as `[{ name, count }]` and one
    // carried it as a bare object, while every `filter.type=urn:entity:brand`
    // entity carried `keywords: string[]`. The documented shape is `string[]`.
    // That single divergence discarded all ten place results — which is how one
    // failed call came to look like a provider outage for that whole entity type.
    description: z.unknown().nullish(),
    // Brand entities carry `industries` (and often `keywords`/`tagline`). The
    // pipeline uses `industries` to derive a DESCRIPTIVE category for discovered
    // brands that are absent from the curated registry (doc 02 §21 amendment).
    // Absent for most non-brand entities, so all three stay optional.
    industries: z.unknown().nullish(),
    keywords: z.unknown().nullish(),
    tagline: z.unknown().nullish(),
    // Documented as `{ url }`, but the LIVE hackathon host sends `image: {}` for
    // entities with no artwork. `nullish()` on the object does not cover that: an
    // empty object is present, so `url` was still required and its absence failed
    // the item. Observed live on "dream pop" (a videogame with no artwork) and
    // "lo-fi".
    image: z.unknown().nullish(),
    release_year: z.unknown().nullish(),
    release_date: z.unknown().nullish(),
    content_rating: z.unknown().nullish(),
    // Documented as a number of minutes/seconds, but the LIVE hackathon host
    // sends `{}` for entities with no duration. Nothing surfaces it.
    duration: z.unknown().nullish(),
    production_companies: z.unknown().nullish(),
    // Documented as an array of country codes, but the LIVE hackathon host
    // returns a single display string (e.g. `"Japan"`). Not surfaced downstream.
    release_country: z.unknown().nullish(),
    websites: z.unknown().nullish(),
    geocode: z.unknown().nullish(),
    // `akas` and `short_descriptions` are documented as verbose and
    // multilingual and cannot be suppressed. Parsed but never surfaced.
    akas: z.unknown().nullish(),
    short_descriptions: z.unknown().nullish(),
  })
  .passthrough();
export type QlooProperties = z.infer<typeof qlooPropertiesSchema>;

/**
 * `query.explainability`. Doc 03 §5 confirms it exists, that per-entity scores
 * are normalised 0–1, that entities ≥0.1 are always included, and that failure
 * surfaces as `query.explainability.warning` — but the exact JSON key layout is
 * NOT documented. It is therefore captured as unknown and interpreted
 * defensively by `extractExplainability()`.
 */
export const qlooExplainabilitySchema = z
  .object({
    warning: z.string().nullish(),
  })
  .passthrough();
export type QlooExplainability = z.infer<typeof qlooExplainabilitySchema>;

/**
 * The per-result `query` block. Note the four coexisting scales documented in
 * doc 03 §15:
 *   affinity        0–100 (concept docs; JSON encoding unverified — A2)
 *   measurements.*  signed decimals
 *   age/gender.*    signed deltas
 *   explainability  0–1
 */
export const qlooResultQuerySchema = z
  .object({
    // A1: presence unverified. A2: range unverified. Both are optional so the
    // adapter can RECORD what actually arrived instead of asserting a guess.
    affinity: z.number().nullish(),
    // `index` = rank position, "a lower index means higher relevance" (§15).
    // Its exact location (result-level vs query-level) is unverified, so both
    // are accepted and reconciled by the mapper.
    index: z.number().int().nullish(),
    measurements: z.record(z.string(), z.number()).nullish(),
    explainability: qlooExplainabilitySchema.nullish(),
    age: z.record(z.string(), z.number()).nullish(),
    gender: z.record(z.string(), z.number()).nullish(),
    locality: z.unknown().nullish(),
  })
  .passthrough();
export type QlooResultQuery = z.infer<typeof qlooResultQuerySchema>;

// ---------------------------------------------------------------------------
// /v2/insights — entity results
// ---------------------------------------------------------------------------

export const qlooEntityResultSchema = z
  .object({
    name: z.string(),
    // Contradiction #17: `entity_id` is a GUID in the documented example but
    // a URN slug for demographic rows. Typed as string, never as a UUID.
    entity_id: z.string(),
    type: z.string().nullish(),
    // `/search` returns `types` (an array) rather than a singular `type`. Both
    // are accepted; the mapper prefers the singular then the first array entry.
    types: z.array(z.string()).nullish(),
    subtype: z.string().nullish(),
    disambiguation: z.string().nullish(),
    popularity: z.number().nullish(),
    index: z.number().int().nullish(),
    properties: qlooPropertiesSchema.nullish(),
    tags: z.array(qlooTagRefSchema).nullish(),
    query: qlooResultQuerySchema.nullish(),
    external: qlooExternalSchema.nullish(),
  })
  .passthrough();
export type QlooEntityResult = z.infer<typeof qlooEntityResultSchema>;

// ---------------------------------------------------------------------------
// /v2/insights — tag results
// ---------------------------------------------------------------------------

/**
 * Doc 03 §6: the documented tag-insights example returns `"query": {}` — no
 * scores at all. That is the entire reason the Taste DNA design is entity-first
 * (M2/M3) with tag insights as method M1. The empty object must parse cleanly.
 */
export const qlooTagResultSchema = z
  .object({
    tag_id: z.string().nullish(),
    tag_value: z.string().nullish(),
    // Relaxed from `z.string()`: a single nameless tag row used to reject every
    // tag result in the response, because Zod validates an array as a whole. The
    // mapper drops rows it cannot name.
    name: z.unknown().nullish(),
    subtype: z.string().nullish(),
    type: z.string().nullish(),
    types: z.array(z.string()).nullish(),
    popularity: z.number().nullish(),
    query: qlooResultQuerySchema.nullish(),
  })
  .passthrough();
export type QlooTagResult = z.infer<typeof qlooTagResultSchema>;

// ---------------------------------------------------------------------------
// /v2/insights — demographic results
// ---------------------------------------------------------------------------

/**
 * Scores here are SIGNED deltas (e.g. `+0.43`, `-0.28`), not 0–100 affinities.
 * Doc 03 §6: they must be normalised before feeding the 20% audience dimension
 * and must never be rendered as a percentage.
 */
export const qlooDemographicResultSchema = z
  .object({
    entity_id: z.string(),
    name: z.string().nullish(),
    query: qlooResultQuerySchema.nullish(),
  })
  .passthrough();
export type QlooDemographicResult = z.infer<typeof qlooDemographicResultSchema>;

// ---------------------------------------------------------------------------
// Response envelopes
// ---------------------------------------------------------------------------

export const qlooInsightsResultsSchema = z
  .object({
    // `unknown[]`, NOT `qlooEntityResultSchema[]`. Zod validates an array as a
    // whole, so one divergent item used to reject every item beside it and the
    // client surfaced the entire call as `malformed_response` — observed live on
    // `filter.type=urn:entity:place`, where 6 of 10 entities carried
    // `properties.keywords` as `[{ name, count }]`. Items are validated
    // individually by `partitionValid` instead, so a good result survives a bad
    // neighbour. The diagnostic distinction is preserved, not dropped: see
    // `unusableResultArray`, which still fails the call when NOTHING is usable.
    entities: z.array(z.unknown()).nullish(),
    tags: z.array(z.unknown()).nullish(),
    demographics: z.array(z.unknown()).nullish(),
    duration: z.number().nullish(),
  })
  .passthrough();

/**
 * `/v2/insights` envelope. Doc 03 §5 places the AGGREGATE explainability
 * object "top-level"; whether that means the response root or inside `results`
 * is unverified, so both are captured.
 */
export const qlooInsightsResponseSchema = z
  .object({
    success: z.boolean().nullish(),
    results: qlooInsightsResultsSchema.nullish(),
    duration: z.number().nullish(),
    query: qlooResultQuerySchema.nullish(),
    meta: z.record(z.string(), z.unknown()).nullish(),
  })
  .passthrough();
export type QlooInsightsResponse = z.infer<typeof qlooInsightsResponseSchema>;

/**
 * `/search` envelope — `results` is a FLAT ARRAY, not an object.
 * Doc 03 §6 explicitly warns against sharing a parser with `/v2/insights`.
 * Items are `unknown` for the same reason as above: one odd hit must not turn a
 * whole Review-stage lookup into an `error` state.
 */
export const qlooSearchResponseSchema = z
  .object({
    success: z.boolean().nullish(),
    duration: z.number().nullish(),
    results: z.array(z.unknown()),
  })
  .passthrough();
export type QlooSearchResponse = z.infer<typeof qlooSearchResponseSchema>;

/** `/v2/tags` envelope. */
export const qlooTagsResponseSchema = z
  .object({
    success: z.boolean().nullish(),
    duration: z.number().nullish(),
    results: z
      .object({
        tags: z.array(z.unknown()),
      })
      .passthrough()
      .nullish(),
  })
  .passthrough();
export type QlooTagsResponse = z.infer<typeof qlooTagsResponseSchema>;

// ---------------------------------------------------------------------------
// Item-level validation
// ---------------------------------------------------------------------------

/** One wire item that did not satisfy the contract, with the reason. */
export interface WireRejection {
  /** Position in the array Qloo returned. */
  index: number;
  /** Up to three Zod issue paths + messages, for the diagnostic detail. */
  issues: string[];
}

export interface PartitionedWireItems<T> {
  valid: T[];
  rejected: WireRejection[];
}

/**
 * Validate a raw wire array ONE ITEM AT A TIME.
 *
 * This is the mechanism that stops a single divergent field on a single result
 * from discarding a whole provider call. It deliberately keeps the rejects
 * instead of dropping them: `mapEntityResultSet` turns them into an observation
 * so the run records that it is working from a partial set rather than a
 * complete one.
 */
export function partitionValid<T>(
  schema: z.ZodType<T>,
  raw: readonly unknown[],
): PartitionedWireItems<T> {
  const valid: T[] = [];
  const rejected: WireRejection[] = [];
  raw.forEach((item, index) => {
    const parsed = schema.safeParse(item);
    if (parsed.success) {
      valid.push(parsed.data);
      return;
    }
    rejected.push({ index, issues: describeIssues(parsed.error) });
  });
  return { valid, rejected };
}

/** First few Zod issues as `path: message`, capped so a detail string stays readable. */
export function describeIssues(error: z.ZodError, limit = 3): string[] {
  return error.issues.slice(0, limit).map((issue) => {
    const path = issue.path.join(".") || "(root)";
    return `${path}: ${issue.message}`;
  });
}

/**
 * The result arrays an insights body may carry, by JSON path.
 *
 * Kept beside the schemas rather than in the client because which keys hold
 * result arrays is contract knowledge, and a client that guessed would silently
 * stop checking the day Qloo renamed one.
 */
function insightsResultArrays(body: unknown): Array<{ path: string; items: unknown[]; schema: z.ZodTypeAny }> {
  if (body === null || typeof body !== "object") return [];
  const results = (body as Record<string, unknown>).results;
  if (results === null || typeof results !== "object") return [];
  const record = results as Record<string, unknown>;
  const out: Array<{ path: string; items: unknown[]; schema: z.ZodTypeAny }> = [];
  if (Array.isArray(record.entities)) {
    out.push({ path: "results.entities", items: record.entities, schema: qlooEntityResultSchema });
  }
  if (Array.isArray(record.tags)) {
    out.push({ path: "results.tags", items: record.tags, schema: qlooTagResultSchema });
  }
  if (Array.isArray(record.demographics)) {
    out.push({ path: "results.demographics", items: record.demographics, schema: qlooDemographicResultSchema });
  }
  return out;
}

/** A result array where every item failed validation, plus why. */
export interface UnusableResultArray {
  path: string;
  count: number;
  issues: string[];
}

/**
 * Find a NON-EMPTY result array in which not one item satisfies the contract.
 *
 * That case must stay a `malformed_response` rather than becoming an empty
 * result set. Doc 03 §7 names `200 + empty entities` the hardest case to
 * interpret from outside, and a provider that returned ten entities we could
 * not read one of is genuinely different from a catalogue that has nothing:
 * the first is our contract being wrong, the second is a real answer. Collapsing
 * them would let a parsing bug present itself as "Qloo found no brands".
 *
 * Returns `undefined` when at least one item is usable, so a partially divergent
 * response is downgraded to a recorded observation instead of a failure.
 */
export function unusableResultArray(endpoint: "insights" | "search" | "tags", body: unknown): UnusableResultArray | undefined {
  const arrays =
    endpoint === "insights"
      ? insightsResultArrays(body)
      : endpoint === "search"
        ? (Array.isArray((body as Record<string, unknown> | null)?.results)
            ? [{
                path: "results",
                items: (body as Record<string, unknown>).results as unknown[],
                schema: qlooEntityResultSchema as z.ZodTypeAny,
              }]
            : [])
        : (Array.isArray(((body as Record<string, unknown> | null)?.results as Record<string, unknown> | undefined)?.tags)
            ? [{
                path: "results.tags",
                items: ((body as Record<string, unknown>).results as Record<string, unknown>).tags as unknown[],
                schema: qlooTagResultSchema as z.ZodTypeAny,
              }]
            : []);

  for (const entry of arrays) {
    if (entry.items.length === 0) continue;
    const { rejected } = partitionValid(entry.schema, entry.items);
    if (rejected.length < entry.items.length) continue;
    return { path: entry.path, count: entry.items.length, issues: rejected[0]?.issues ?? [] };
  }
  return undefined;
}

/**
 * Error body: `{ code, reason, message }` (doc 03 §6/§7).
 * 404 on `/search` means "no results", which is a legitimate empty state and
 * must not be surfaced as a failure.
 */
export const qlooErrorSchema = z
  .object({
    code: z.union([z.string(), z.number()]).nullish(),
    reason: z.string().nullish(),
    message: z.string().nullish(),
  })
  .passthrough();
export type QlooError = z.infer<typeof qlooErrorSchema>;
