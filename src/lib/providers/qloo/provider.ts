import type {
  DataSource,
  DemographicResultSet,
  EntityResultSet,
  SearchResultSet,
  TagResultSet,
} from "@/lib/contracts/domain";
import { ProviderError } from "@/lib/contracts/domain";
import type { QlooConfig } from "@/lib/env";
import { cacheKey, cacheThrough, type KeyValueCache } from "@/lib/cache/cache";
import type {
  CapabilityName,
  CulturalIntelligenceProvider,
  ProviderCapabilities,
  ProviderHealth,
  RecommendRequest,
  ScoreRequest,
  SearchRequest,
} from "@/lib/providers/provider";

import { QlooClient } from "./client";
import {
  mapDemographicResultSet,
  mapEntityResultSet,
  mapSearchResponse,
  mapTagResultSet,
} from "./mapper";
import { buildInsightsParams, buildSearchParams } from "./requests";

/**
 * The live Qloo adapter.
 *
 * It is a THIN layer: build validated params → cached HTTP GET → parse through
 * the zod contract → map to the domain. No scoring, no product logic, no
 * invention. Everything interpretive lives above the boundary so it can be
 * tested against the synthetic provider.
 *
 * Inert without a key. `QlooClient` throws `not_configured` if constructed
 * without one, and the factory in `src/lib/providers/index.ts` never selects
 * this provider unless a key is present — so the application cannot make an
 * unverified live call by accident.
 */

const QLOO_SOURCE: DataSource = {
  mode: "live",
  providerId: "qloo",
  label: "Qloo Insights API (live)",
  isIllustrative: false,
};

const CACHED_SOURCE: DataSource = { ...QLOO_SOURCE, mode: "cached", label: "Qloo Insights API (cached)" };

/**
 * Capabilities, with the unverified set spelled out.
 *
 * Doc 03 §9 warns the two Qloo references disagree, and §11 warns that
 * unsupported parameters are SILENTLY IGNORED. So a capability can be "expected
 * to work" and still need runtime confirmation. Anything in `unverified` must
 * degrade gracefully rather than be trusted blindly (doc 04 §4.5).
 */
const CAPABILITIES: ProviderCapabilities = {
  supported: {
    search: true,
    entityRecommendations: true,
    entityScoring: true,
    tagRecommendations: true,
    tagScoring: true,
    demographics: true,
    explainability: true,
    // Per-entity weights require POST, and doc 03 §2 records the hackathon guide
    // saying a POST with a JSON body "will fail". Decision: GET for everything.
    perEntityWeights: false,
    crossDomainBackfill: true,
  },
  unverified: [
    // A3 / contradiction #1: the Entity Type Parameter Guide lists NO signals for
    // `urn:tag`, while the Taste Analysis page says the opposite.
    "tagRecommendations",
    "tagScoring",
    // Doc 03 §5: absent from every per-type table, and possibly key-entitlement
    // gated. Could be a silent no-op.
    "explainability",
    // Doc 03 §8 step 3: the response may not flag which results were backfilled.
    "crossDomainBackfill",
    // A4/A5: the `/v2/audiences` endpoint is marked deprecated in its own OpenAPI.
    "demographics",
  ],
  // A10 RESOLVED, and the answer mattered. `filter.results.entities` does not
  // merely restrict: it scores. Verified live 2026-10-26 — requesting a candidate
  // set against DIFFERENT signals returned per-entity affinities (0.8803/0.8769/
  // 0.8643 and, on a second signal set, 0.8428/0.7095), and requesting it with no
  // signals at all returned the entities with their full descriptor sets and no
  // affinity. What it will NOT do is return an entity that was also sent as a
  // signal: Qloo excludes its own inputs from its results, so the two lists must
  // not be the same list. That collision is why `scoreDeclaredEntities` sends no
  // signals, and it is recorded here rather than left as folklore because it is a
  // provider behaviour, not a product choice.
  unsupportedReasons: {
    perEntityWeights:
      "Per-entity and per-tag weights are POST-only, and doc 03 §2 records that a POST with a JSON body fails on this endpoint. The 45/20/15/10/10 scoring model does not require them.",
  },
  maxTake: 50,
};

export interface QlooProviderOptions {
  config: QlooConfig;
  cache: KeyValueCache;
  ttlSeconds?: number;
  fetchImpl?: typeof fetch;
}

export class QlooProvider implements CulturalIntelligenceProvider {
  readonly id = "qloo" as const;
  readonly source: DataSource = QLOO_SOURCE;

  private readonly client: QlooClient;
  private lastError: ProviderError | undefined;
  private reachable: boolean | undefined;

  constructor(private readonly options: QlooProviderOptions) {
    this.client = new QlooClient({ config: options.config, fetchImpl: options.fetchImpl });
  }

  capabilities(): ProviderCapabilities {
    return CAPABILITIES;
  }

  async health(): Promise<ProviderHealth> {
    return {
      ok: this.options.config.apiKey !== undefined && this.lastError === undefined,
      configured: this.options.config.apiKey !== undefined,
      reachable: this.reachable,
      lastError: this.lastError,
      source: this.source,
      capabilities: CAPABILITIES,
    };
  }

  async search(request: SearchRequest): Promise<SearchResultSet> {
    const built = buildSearchParams(request);
    return this.cached(
      "search",
      built.params,
      async () => mapSearchResponse(await this.client.search(built.params), QLOO_SOURCE),
    );
  }

  async recommendEntities(request: RecommendRequest): Promise<EntityResultSet> {
    const built = buildInsightsParams({ ...request, sortBy: request.sortBy ?? "affinity" });
    return this.cached(
      "insights:entities",
      built.params,
      async () =>
        mapEntityResultSet(await this.client.insights(built.params), QLOO_SOURCE, {
          // This call asked for a type, so the answer is checked against it.
          // `filter.type` is the request boundary; verifying what actually came
          // back is the application boundary, and a recommendation list that
          // trusts the first without the second is a list that will eventually
          // contain something else.
          requestedType: request.filterType,
          explainabilityRequested: request.explainability === true,
        }),
    );
  }

  async scoreEntities(request: ScoreRequest): Promise<EntityResultSet> {
    if (!request.candidateEntityIds?.length) {
      // Without candidates this is indistinguishable from recommendEntities, and
      // pretending otherwise would produce a score with no basis.
      throw new ProviderError(
        "invalid_request",
        "scoreEntities requires candidateEntityIds. Without them there is no specific set to score, and the result would be an ordinary recommendation list.",
        { recoverable: false },
      );
    }
    const built = buildInsightsParams({ ...request, sortBy: request.sortBy ?? "affinity" });
    return this.cached(
      "insights:score-entities",
      built.params,
      // NO `requestedType` here, deliberately. This call names the entities it
      // wants by id, so the caller has already fixed the set; its `filterType` is
      // only there because the wire requires a valid enum member. Filtering the
      // readback of the creator's OWN confirmed interests by that nominal type
      // would discard every interest that is not of the dominant type — which is
      // most of them for any creator with a mixed profile.
      async () =>
        mapEntityResultSet(await this.client.insights(built.params), QLOO_SOURCE, {
          explainabilityRequested: request.explainability === true,
        }),
    );
  }

  async recommendTags(request: RecommendRequest): Promise<TagResultSet> {
    const built = buildInsightsParams({ ...request, filterType: "urn:tag" });
    return this.cached(
      "insights:tags",
      built.params,
      async () => mapTagResultSet(await this.client.insights(built.params), QLOO_SOURCE),
    );
  }

  async scoreTags(request: ScoreRequest): Promise<TagResultSet> {
    if (!request.candidateTagIds?.length) {
      throw new ProviderError(
        "invalid_request",
        "scoreTags requires candidateTagIds. Doc 03 §8 step 2(b): filter.results.tags is the scoring hook, and without candidates there is nothing to score.",
        { recoverable: false },
      );
    }
    const built = buildInsightsParams({ ...request, filterType: "urn:tag" });
    return this.cached(
      "insights:score-tags",
      built.params,
      async () => mapTagResultSet(await this.client.insights(built.params), QLOO_SOURCE),
    );
  }

  async demographics(request: RecommendRequest): Promise<DemographicResultSet> {
    if (!request.signals.entityIds.length && !request.signals.tagIds?.length) {
      // Doc 03 §6: demographics requires filter.type=urn:demographics PLUS one of
      // signal.interests.entities or signal.interests.tags. Failing here beats a
      // guaranteed 400.
      throw new ProviderError(
        "invalid_request",
        "Demographic insights require at least one entity or tag signal.",
        { recoverable: true },
      );
    }
    const built = buildInsightsParams({ ...request, filterType: "urn:demographics" });
    return this.cached(
      "insights:demographics",
      built.params,
      async () => mapDemographicResultSet(await this.client.insights(built.params), QLOO_SOURCE),
    );
  }

  /**
   * Cache-through wrapper. Doc 03 §8: cache every response server-side, keyed by
   * the sorted parameter set. Qloo permits indefinite retention (fact F23), so
   * the TTL comes from configuration rather than being hard-coded short.
   */
  private async cached<T>(
    namespace: string,
    params: Record<string, string>,
    work: () => Promise<T>,
  ): Promise<T> {
    const key = cacheKey(namespace, params);
    try {
      const { value, fromCache } = await cacheThrough(this.options.cache, key, work, {
        ttlSeconds: this.options.ttlSeconds,
      });
      this.reachable = true;
      this.lastError = undefined;
      return fromCache ? withCachedSource(value) : value;
    } catch (error) {
      this.reachable = false;
      if (error instanceof ProviderError) this.lastError = error;
      throw error;
    }
  }
}

/** Re-label a result set as cache-served, so the UI can say so honestly. */
function withCachedSource<T>(value: T): T {
  if (typeof value !== "object" || value === null) return value;
  const candidate = value as { meta?: { source?: DataSource } };
  if (!candidate.meta?.source) return value;
  return {
    ...value,
    meta: { ...candidate.meta, source: CACHED_SOURCE },
  } as T;
}

export type { CapabilityName };
