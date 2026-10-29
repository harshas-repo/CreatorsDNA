import type {
  DataSource,
  DemographicResultSet,
  EntityResultSet,
  ProviderError,
  SearchResultSet,
  TagResultSet,
} from "@/lib/contracts/domain";
import type { QlooFilterType, SortBy } from "@/lib/contracts/qloo";

/**
 * The provider boundary.
 *
 * This interface is the ONLY seam between the application and the source of
 * cultural data. Two implementations exist:
 *
 *   `SyntheticProvider` — clearly-labelled development data. Default. No key.
 *   `QlooProvider`      — the researched live adapter. Inert without a key.
 *
 * Everything above this seam (scoring, Taste DNA assembly, opportunity
 * derivation, copy generation, all six visualisations) is provider-agnostic and
 * is tested against the synthetic implementation. Dropping in the real client
 * later changes no downstream code.
 *
 * Hard rule from the current execution decision: synthetic results are never
 * presented as Qloo discoveries. `source.isIllustrative` is therefore part of
 * the contract, not a convenience — every layer that renders data must read it.
 */

export type ProviderId = "synthetic" | "qloo";

export const PROVIDER_IDS: readonly ProviderId[] = ["synthetic", "qloo"];

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export interface SearchRequest {
  query: string;
  /** `/search` `types` — note this list differs from Insights `filter.type`. */
  types?: string[];
  take?: number;
  /** Optional tag narrowing. */
  tagIds?: string[];
}

export interface SignalBlock {
  entityIds: string[];
  tagIds?: string[];
  demographics?: {
    ageBuckets?: string[];
    gender?: string;
    audienceIds?: string[];
  };
  location?: {
    query?: string;
    localityId?: string;
  };
}

export interface RecommendRequest {
  /** Always required by `/v2/insights`. */
  filterType: QlooFilterType;
  signals: SignalBlock;
  take?: number;
  page?: number;
  sortBy?: SortBy;
  /** `feature.explainability` — needed for the "why this brand?" panel. */
  explainability?: boolean;
  /** Restrict to entities carrying these tags. Operator is set explicitly. */
  filterTagIds?: string[];
  /** Tag namespaces for `filter.type=urn:tag` (doc 03 §17 curation). */
  tagTypes?: string[];
  /** Cap results per subtype — `urn:tag` only. */
  diversifyBySubtype?: number;
  /** `backfill.cross_domain.take` — the API-sourced "beyond your niche" signal. */
  crossDomainBackfill?: boolean;
  /**
   * Caller-supplied cache-busting/scoping key. Not sent upstream; used to key
   * the cache deterministically from the sorted parameter set (doc 03 §8).
   */
  scope?: string;
}

export interface ScoreRequest extends RecommendRequest {
  /**
   * `filter.results.entities` — score a SPECIFIC candidate set rather than
   * hoping it appears in a top-N. Doc 03 §8 step 5(b): the strongest available
   * basis for the 45% Taste Fit weight.
   */
  candidateEntityIds?: string[];
  /** `filter.results.tags` — the tag-scoring hook (method M3 verification). */
  candidateTagIds?: string[];
}

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

export type CapabilityName =
  | "search"
  | "entityRecommendations"
  | "entityScoring"
  | "tagRecommendations"
  | "tagScoring"
  | "demographics"
  | "explainability"
  | "perEntityWeights"
  | "crossDomainBackfill";

/**
 * What a provider can do, and — crucially — which of those abilities are
 * documented but NOT yet verified against the live hackathon host.
 *
 * The `unverified` list is what drives the L0–L4 fallback hierarchy: a
 * capability that is `true` but `unverified` must degrade gracefully rather
 * than be trusted blindly (doc 04 §4.5).
 */
export interface ProviderCapabilities {
  supported: Record<CapabilityName, boolean>;
  /** Capabilities expected to work but unconfirmed live. */
  unverified: CapabilityName[];
  /** Capabilities known NOT to work, with the reason surfaced to the user. */
  unsupportedReasons: Partial<Record<CapabilityName, string>>;
  /** Hard ceiling on `take`. 50 per doc 03 §4 (contradiction #15). */
  maxTake: number;
}

export interface ProviderHealth {
  ok: boolean;
  /** True when the credentials needed for live operation are present. */
  configured: boolean;
  /** Only known after an actual call; `undefined` means "never attempted". */
  reachable?: boolean;
  lastError?: ProviderError;
  source: DataSource;
  capabilities: ProviderCapabilities;
}

// ---------------------------------------------------------------------------
// The interface
// ---------------------------------------------------------------------------

export interface CulturalIntelligenceProvider {
  readonly id: ProviderId;
  /** Provenance/label carried by every result set this provider produces. */
  readonly source: DataSource;

  capabilities(): ProviderCapabilities;

  /** Cheap, side-effect-free check used by the status UI and the health route. */
  health(): Promise<ProviderHealth>;

  /** Resolve free text to entities (doc 03 §8 step 1). */
  search(request: SearchRequest): Promise<SearchResultSet>;

  /**
   * Cross-category entity recommendations for a signal set.
   * Method M2 — the primary Taste DNA source (doc 04 §4.2).
   */
  recommendEntities(request: RecommendRequest): Promise<EntityResultSet>;

  /**
   * Score a specific candidate set against the signals.
   * Used for the curated brand registry (doc 03 §8 step 5b).
   */
  scoreEntities(request: ScoreRequest): Promise<EntityResultSet>;

  /**
   * Tag-level taste (method M1). Expected to return UNSCORED tags — the
   * documented example has `"query": {}` — so callers must check
   * `TagResultSet.unscored` and fall back to M3.
   */
  recommendTags(request: RecommendRequest): Promise<TagResultSet>;

  /** Tag scoring via `filter.results.tags` (doc 03 §8 step 2b). */
  scoreTags(request: ScoreRequest): Promise<TagResultSet>;

  /** Signed demographic deltas. Optional by design (doc 02 §39). */
  demographics(request: RecommendRequest): Promise<DemographicResultSet>;
}

/**
 * Type guard used by the API route and the tests to assert that whatever the
 * factory returned really is a provider. Catches a mis-wired environment early
 * instead of at render time.
 */
export function isProvider(value: unknown): value is CulturalIntelligenceProvider {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.capabilities === "function" &&
    typeof candidate.search === "function" &&
    typeof candidate.recommendEntities === "function" &&
    typeof candidate.scoreEntities === "function" &&
    typeof candidate.recommendTags === "function" &&
    typeof candidate.scoreTags === "function" &&
    typeof candidate.demographics === "function"
  );
}
