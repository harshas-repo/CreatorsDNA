import {
  QLOO_INSIGHTS_ENTITY_TYPES,
  QLOO_TAKE_DEFAULT,
  QLOO_TAKE_MAX,
  type QlooFilterType,
  type QlooOperator,
  type SortBy,
} from "@/lib/contracts/qloo";
import type { RecommendRequest, ScoreRequest, SearchRequest } from "@/lib/providers/provider";
import { stableKey } from "@/lib/utils/deterministic";

/**
 * Request building and validation — doc 03 §9, §10, §11.
 *
 * Doc 03 §11 identifies the single most dangerous Qloo behaviour:
 *
 *   "invalid parameters are silently ignored rather than returning an error"
 *
 * The failure mode is plausible-looking but WRONG output, not an exception. Pass
 * `signal.interests.entities` with `filter.type=urn:tag` and it may be ignored,
 * returning generic popular tags that would then be presented as a personalised
 * Taste DNA — violating doc 02 §16 and doc 01 §50 while returning HTTP 200.
 *
 * Required mitigation #1 is implemented here: an explicit allow-list of
 * parameters per `filter.type`, with every outgoing request validated against
 * it. A caller can never pass an arbitrary parameter through.
 *
 * Two tiers, because doc 03 §9 shows the two Qloo references disagree:
 *
 *   CORE      listed in the Entity Type Parameter Guide for this type
 *   EXTENDED  documented in the Parameter Reference and the Insights OpenAPI but
 *             ABSENT from the per-type table. Sent, but every use is recorded as
 *             a warning so a wrong-but-200 response stays diagnosable (§11 #3).
 */

export type ParamTier = "core" | "extended";

export interface RequestWarning {
  param: string;
  tier: ParamTier;
  filterType: string;
  detail: string;
}

export interface BuiltRequest {
  /** Ordered, validated query parameters. Ready to serialise. */
  params: Record<string, string>;
  warnings: RequestWarning[];
  /** Stable cache key derived from the sorted parameter set (doc 03 §8). */
  cacheKey: string;
}

// ---------------------------------------------------------------------------
// Allow-lists
// ---------------------------------------------------------------------------

/** Params doc 03 §9 lists as common to all ten Insights entity types. */
const ENTITY_CORE = [
  "filter.type",
  "signal.interests.entities",
  "signal.interests.tags",
  "signal.demographics.age",
  "signal.demographics.age.weight",
  "signal.demographics.gender",
  "signal.demographics.gender.weight",
  "signal.demographics.audiences",
  "signal.demographics.audiences.weight",
  "filter.tags",
  "operator.filter.tags",
  "filter.exclude.entities",
  "filter.exclude.tags",
  "operator.exclude.tags",
  "filter.results.entities",
  "filter.results.entities.query",
  "filter.parents.types",
  "filter.popularity.min",
  "filter.popularity.max",
  "filter.external.exists",
  "operator.filter.external.exists",
  "bias.trends",
  "offset",
  "take",
] as const;

/**
 * Doc 03 §9's warning, verbatim in substance: `feature.explainability`,
 * `backfill.*`, `bias.content_based`, `signal.location*`, `sort_by`, `page`,
 * `diversify.*` and the `.weight` variants appear in the Parameter Reference and
 * the Insights OpenAPI but in NONE of the per-type tables. Treat the per-type
 * guide as necessary-but-not-sufficient.
 */
const ENTITY_EXTENDED = [
  "feature.explainability",
  "backfill.cross_domain.take",
  "backfill.content_based.take",
  "bias.content_based",
  "sort_by",
  "page",
  "diversify.by",
  "diversify.take",
  "signal.location",
  "signal.location.query",
  "signal.location.weight",
  "signal.interests.entities.weight",
  "signal.interests.tags.weight",
  "signal.interests.entities.include",
  "filter.results.tags",
] as const;

/** Type-specific additions from doc 03 §9's exceptions table. */
const TYPE_SPECIFIC_CORE: Record<string, readonly string[]> = {
  "urn:entity:movie": ["filter.release_year.min", "filter.release_year.max", "filter.release_country", "filter.content_rating", "filter.rating.min", "filter.rating.max"],
  "urn:entity:tv_show": ["filter.release_year.min", "filter.release_year.max", "filter.finale_year.min", "filter.finale_year.max", "filter.release_country", "filter.content_rating", "filter.rating.min", "filter.rating.max"],
  "urn:entity:book": ["filter.publication_year.min", "filter.publication_year.max"],
  "urn:entity:person": ["filter.gender", "filter.date_of_birth.min", "filter.date_of_birth.max", "filter.date_of_death.min", "filter.date_of_death.max"],
  "urn:entity:place": ["bias.quality", "sort_by", "filter.location", "filter.geocode.city", "filter.geocode.metro", "filter.address", "filter.references_brand", "filter.hours"],
};

/**
 * `urn:tag`. Doc 03 §9: the per-type table lists ONLY `filter.type`,
 * `diversify.by`, `diversify.take`, `offset`, `take` — **no signals at all** —
 * while the Taste Analysis page says the opposite. That is contradiction #1, and
 * it is the whole reason the Taste DNA design is entity-first (M2/M3) with tag
 * insights demoted to M1.
 */
const TAG_CORE = ["filter.type", "diversify.by", "diversify.take", "offset", "take"] as const;
const TAG_EXTENDED = [
  "signal.interests.entities",
  "signal.interests.tags",
  "operator.signal.interests.tags",
  "filter.tag.types",
  "filter.results.tags",
  "filter.parents.types",
  "filter.popularity.min",
  "filter.popularity.max",
  "page",
  "feature.explainability",
] as const;

/** `urn:demographics` requires signals — doc 03 §6. */
const DEMOGRAPHIC_CORE = [
  "filter.type",
  "signal.interests.entities",
  "signal.interests.tags",
  "signal.demographics.age",
  "signal.demographics.gender",
  "take",
  "page",
] as const;

function allowlistFor(filterType: QlooFilterType): { core: readonly string[]; extended: readonly string[] } {
  if (filterType === "urn:tag") return { core: TAG_CORE, extended: TAG_EXTENDED };
  if (filterType === "urn:demographics") return { core: DEMOGRAPHIC_CORE, extended: [] };
  return {
    core: [...ENTITY_CORE, ...(TYPE_SPECIFIC_CORE[filterType] ?? [])],
    extended: ENTITY_EXTENDED,
  };
}

// ---------------------------------------------------------------------------
// Insights
// ---------------------------------------------------------------------------

/**
 * `operator.*` values are set explicitly wherever the allow-list permits.
 *
 * Doc 03 §16 documents asymmetric defaults: `operator.filter.tags` defaults to
 * `union`, but `operator.signal.interests.tags` defaults to `intersection` —
 * meaning results must contain ALL supplied tags. Relying on that default is how
 * a request silently returns an empty set.
 *
 * The two are not equally reachable, and pretending otherwise would mislead the
 * next reader. `operator.filter.tags` is in `ENTITY_CORE`, so it goes on the wire.
 * `operator.signal.interests.tags` appears in NO per-type table in doc 03 §9, so
 * the allow-list drops it with a warning — the intersection default cannot be
 * overridden from here at all. What actually prevents the empty-set failure today
 * is that no caller populates `coverage.coveredTagIds`, so `signal.interests.tags`
 * is never built and its operator is never needed. If tag signals are ever wired
 * up, that is the moment to re-read doc 03 §16 and decide whether to send the
 * operator anyway (silently ignored) or to stop relying on tag-signal semantics.
 */
export const DEFAULT_FILTER_TAGS_OPERATOR: QlooOperator = "union";
export const DEFAULT_SIGNAL_TAGS_OPERATOR: QlooOperator = "union";

function list(value: readonly string[] | undefined): string | undefined {
  if (!value || value.length === 0) return undefined;
  return value.join(",");
}

export function buildInsightsParams(request: RecommendRequest | ScoreRequest): BuiltRequest {
  const { filterType } = request;
  const { core, extended } = allowlistFor(filterType);
  const params: Record<string, string> = {};
  const warnings: RequestWarning[] = [];

  const candidate: Record<string, string | undefined> = {
    "filter.type": filterType,

    // ---- signals ----
    "signal.interests.entities": list(request.signals.entityIds),
    "signal.interests.tags": list(request.signals.tagIds),
    // Explicit, never defaulted (see DEFAULT_SIGNAL_TAGS_OPERATOR above).
    "operator.signal.interests.tags": request.signals.tagIds?.length
      ? DEFAULT_SIGNAL_TAGS_OPERATOR
      : undefined,
    "signal.demographics.age": list(request.signals.demographics?.ageBuckets),
    "signal.demographics.gender": request.signals.demographics?.gender,
    "signal.demographics.audiences": list(request.signals.demographics?.audienceIds),
    "signal.location.query": request.signals.location?.query,
    "signal.location": request.signals.location?.localityId,

    // ---- filters ----
    "filter.results.entities": list((request as ScoreRequest).candidateEntityIds),
    "filter.results.tags": list((request as ScoreRequest).candidateTagIds),
    "filter.tags": list(request.filterTagIds),
    "operator.filter.tags": request.filterTagIds?.length ? DEFAULT_FILTER_TAGS_OPERATOR : undefined,
    "filter.tag.types": list(request.tagTypes),

    // ---- output & ranking ----
    take: String(clampTake(request.take)),
    page: request.page !== undefined ? String(clampPage(request.page)) : undefined,
    sort_by: request.sortBy,
    "feature.explainability": request.explainability ? "true" : undefined,
    "diversify.by": request.diversifyBySubtype !== undefined && filterType === "urn:tag" ? "subtype" : undefined,
    "diversify.take":
      request.diversifyBySubtype !== undefined && filterType === "urn:tag"
        ? String(request.diversifyBySubtype)
        : undefined,
    // Doc 03 §8 step 3: cross-domain backfill is an API-sourced "beyond your
    // niche" signal. Max 20, and it only APPENDS when primary results are short.
    "backfill.cross_domain.take": request.crossDomainBackfill ? "20" : undefined,
    // `low` rather than the `medium` default: doc 03 §4 suggests it for stable
    // demo output, and stable output matters for the archetype tests.
    "bias.trends": "low",
  };

  for (const [param, value] of Object.entries(candidate)) {
    if (value === undefined || value === "") continue;

    if (core.includes(param)) {
      params[param] = value;
      continue;
    }
    if (extended.includes(param)) {
      params[param] = value;
      warnings.push({
        param,
        tier: "extended",
        filterType,
        detail: `Documented in the Parameter Reference and Insights OpenAPI but absent from the Entity Type Parameter Guide for ${filterType}. It may be silently ignored (doc 03 §11).`,
      });
      continue;
    }
    // Never pass an unlisted parameter through. Dropping it is the point.
    warnings.push({
      param,
      tier: "core",
      filterType,
      detail: `Dropped: not permitted for ${filterType}. Unsupported parameters are silently ignored by Qloo, so sending one risks a wrong-but-200 response (doc 03 §11).`,
    });
  }

  assertHasSignalOrFilter(params, filterType, warnings);

  return { params, warnings, cacheKey: cacheKeyFor("insights", params) };
}

/**
 * Doc 03 §4: `filter.type` is always required, PLUS at least one valid signal or
 * filter. Missing that returns
 * `"at least one valid signal or filter is required"` — and doc 03 §11 warns
 * that an INVALID signal is silently dropped, producing exactly this error.
 */
function assertHasSignalOrFilter(
  params: Record<string, string>,
  filterType: QlooFilterType,
  warnings: RequestWarning[],
): void {
  const hasSignal = Object.keys(params).some(
    (key) => key.startsWith("signal.") && !key.endsWith(".weight"),
  );
  const hasFilter = Object.keys(params).some(
    (key) => key.startsWith("filter.") && key !== "filter.type",
  );
  if (hasSignal || hasFilter) return;

  warnings.push({
    param: "signal.*",
    tier: "core",
    filterType,
    detail:
      "No signal or filter present. Qloo requires filter.type plus at least one valid signal or filter; this request would be rejected with 400.",
  });
}

export function clampTake(take: number | undefined): number {
  if (take === undefined) return QLOO_TAKE_DEFAULT;
  return Math.max(1, Math.min(QLOO_TAKE_MAX, Math.floor(take)));
}

function clampPage(page: number): number {
  return Math.max(1, Math.min(100, Math.floor(page)));
}

// ---------------------------------------------------------------------------
// /search
// ---------------------------------------------------------------------------

/**
 * `/search` parameters. Note `types` (plural, comma-separated) is NOT the same
 * list as Insights `filter.type` — doc 03 §3 shows search additionally accepts
 * legacy types such as `urn:entity:actor` that Insights rejects.
 */
export function buildSearchParams(request: SearchRequest): BuiltRequest {
  const warnings: RequestWarning[] = [];
  const params: Record<string, string> = {
    query: request.query,
    // Doc 03 §8 step 1: `match` ranks by textual relevance, which is what a
    // disambiguation picker needs. Affinity is not available here.
    sort_by: "match",
    // Search allows up to 200, but a picker only needs a handful; 10 keeps the
    // disambiguation list usable (doc 02 §7).
    take: String(Math.max(1, Math.min(200, request.take ?? 10))),
  };
  const types = list(request.types);
  if (types) params.types = types;
  const tags = list(request.tagIds);
  if (tags) {
    params["filter.tags"] = tags;
    params["operator.filter.tags"] = DEFAULT_FILTER_TAGS_OPERATOR;
  }
  if (request.query.trim().length === 0) {
    warnings.push({
      param: "query",
      tier: "core",
      filterType: "/search",
      detail: "Empty search query.",
    });
  }
  return { params, warnings, cacheKey: cacheKeyFor("search", params) };
}

// ---------------------------------------------------------------------------
// Cache keys & serialisation
// ---------------------------------------------------------------------------

/**
 * Cache key from the SORTED parameter set (doc 03 §8). Two logically identical
 * requests must share one cache entry regardless of assembly order.
 */
export function cacheKeyFor(endpoint: string, params: Record<string, string>): string {
  return `${endpoint}:${stableKey(params)}`;
}

export function toQueryString(params: Record<string, string>): string {
  const search = new URLSearchParams();
  // Sorted for deterministic URLs, which keeps logs and cache keys comparable.
  for (const key of Object.keys(params).sort()) {
    search.append(key, params[key] as string);
  }
  return search.toString();
}

/**
 * Map a `/search` result type onto the Insights-supported set.
 *
 * Doc 03 §3: an entity resolved via search may carry a type that cannot be used
 * as a `filter.type`, and the relationship is not 1:1. This is that mapping.
 */
const SEARCH_TO_INSIGHTS_TYPE: Record<string, QlooFilterType> = {
  "urn:entity:actor": "urn:entity:person",
  "urn:entity:author": "urn:entity:person",
  "urn:entity:director": "urn:entity:person",
  "urn:entity:album": "urn:entity:artist",
  "urn:entity:video_game": "urn:entity:videogame",
};

export function toInsightsType(searchType: string): QlooFilterType | undefined {
  const mapped = SEARCH_TO_INSIGHTS_TYPE[searchType];
  if (mapped) return mapped;
  if ((QLOO_INSIGHTS_ENTITY_TYPES as readonly string[]).includes(searchType)) {
    return searchType as QlooFilterType;
  }
  if (searchType === "urn:tag" || searchType === "urn:demographics") {
    return searchType as QlooFilterType;
  }
  // A search-only legacy type with no Insights equivalent. Returning undefined
  // forces the caller to handle it rather than sending a 403-bound request.
  return undefined;
}

/** SortBy re-export so callers do not need to import from two places. */
export type { SortBy };
