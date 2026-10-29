import type { DataSource } from "@/lib/contracts/domain";
import type {
  QlooEntityResult,
  QlooInsightsResponse,
  QlooSearchResponse,
  QlooTagResult,
} from "@/lib/contracts/qloo";
import type { RegistryBrand } from "@/lib/contracts/brand";
import { brandEntityId } from "@/lib/contracts/brand";
import { cacheKey, cacheThrough, type KeyValueCache } from "@/lib/cache/cache";
import type {
  CulturalIntelligenceProvider,
  ProviderCapabilities,
  ProviderHealth,
  RecommendRequest,
  ScoreRequest,
  SearchRequest,
} from "@/lib/providers/provider";
import { createRandom, round } from "@/lib/utils/deterministic";

import {
  culturalTagsForTraits,
  SYNTHETIC_CATALOGUE_NOTICE,
  TRAITS,
  type SyntheticEntity,
  type Trait,
  type TraitVector,
} from "./catalogue";
import {
  aggregateTraits,
  allSyntheticEntities,
  cosineSimilarity,
  registerSyntheticEntities,
  resolveSyntheticEntity,
  syntheticAffinityPercent,
  syntheticExplainability,
} from "./engine";
import {
  mapDemographicResultSet,
  mapEntityResultSet,
  mapSearchResponse,
  mapTagResultSet,
} from "../qloo/mapper";

/**
 * The synthetic provider.
 *
 * ⚠️ NOTHING THIS PRODUCES IS REAL. Every entity, affinity, tag and demographic
 * delta is generated locally. `source.isIllustrative` is true, every value is
 * stamped `provenance: "synthetic"`, and the UI renders a persistent banner.
 * Doc 05 §13 and the current execution decision both forbid presenting this as
 * Qloo output.
 *
 * Design decision worth stating: this provider emits **Qloo wire-shaped JSON**
 * and passes it through the SAME mapper as the live adapter. Two consequences:
 *
 *   1. The mapper — scale detection, rank handling, explainability extraction,
 *      tag curation — is exercised by the test suite, not just by production.
 *   2. Both providers are guaranteed to produce byte-identical domain shapes, so
 *      swapping in the real client later cannot change what the UI receives.
 *
 * Affinities are emitted on the documented 0–100 scale, so the normalisation
 * path sees the same distribution it will see live.
 */

export const SYNTHETIC_SOURCE: DataSource = {
  mode: "synthetic",
  providerId: "synthetic",
  label: "Synthetic development data",
  isIllustrative: true,
};

/**
 * Tag results are emitted UNSCORED by default, matching the documented Qloo
 * example where the tag row carries `"query": {}` (doc 03 §6).
 *
 * This is deliberate: it forces the Taste DNA to be built on method M3 (tags
 * harvested from scored entity results), which is the design that will actually
 * ship. `scored` exists so the alternative path can be tested, not as a default.
 */
export type SyntheticTagScoringMode = "unscored" | "scored";

const CAPABILITIES: ProviderCapabilities = {
  supported: {
    search: true,
    entityRecommendations: true,
    entityScoring: true,
    tagRecommendations: true,
    tagScoring: true,
    demographics: true,
    explainability: true,
    perEntityWeights: false,
    crossDomainBackfill: true,
  },
  unverified: [],
  unsupportedReasons: {
    perEntityWeights:
      "Mirrors the live adapter: per-entity weights are POST-only and are not used by the scoring model.",
  },
  maxTake: 50,
};

/**
 * Trait profiles per brand category, so registry brands score plausibly against
 * related creators. Variation within a category is derived per-brand rather than
 * random, so two brands in the same category do not score identically.
 */
const CATEGORY_TRAITS: Record<string, Array<[string, number]>> = {
  apparel: [["streetwear", 0.9], ["design_craft", 0.6], ["pop_culture", 0.5]],
  footwear: [["sneaker_culture", 0.95], ["streetwear", 0.7], ["running", 0.5]],
  beauty: [["wellness", 0.8], ["pop_culture", 0.6], ["design_craft", 0.45]],
  food_beverage: [["specialty_food", 0.85], ["coffee_culture", 0.7], ["cooking", 0.6]],
  consumer_tech: [["consumer_technology", 0.95], ["ai_tooling", 0.7], ["design_craft", 0.5]],
  gaming: [["gaming_competitive", 0.85], ["gaming_indie", 0.7], ["electronic_music", 0.4]],
  automotive: [["motorsport", 0.95], ["consumer_technology", 0.5], ["design_craft", 0.45]],
  finance: [["personal_finance", 0.95], ["consumer_technology", 0.4], ["wellness", 0.25]],
  travel: [["travel_culture", 0.9], ["outdoor_adventure", 0.65], ["photography", 0.55]],
  fitness: [["strength_training", 0.9], ["running", 0.7], ["wellness", 0.65]],
  media_entertainment: [["film_craft", 0.85], ["pop_culture", 0.7], ["comedy", 0.45]],
  home_lifestyle: [["diy_making", 0.85], ["design_craft", 0.7], ["sustainability", 0.55]],
  other: [["design_craft", 0.6], ["pop_culture", 0.5]],
};

/**
 * The commerce category as Qloo actually reports it: a string in
 * `properties.industries`, not a genre tag.
 *
 * Kept separate from `TRAIT_TAGS` on purpose. An industry says what a brand
 * SELLS and is worth 0.7 of a tag in the brand taste profile; a cultural tag says
 * what a brand sits IN and is the only descriptor comparable by id with the
 * creator's taste. Conflating the two is what made the intersection impossible —
 * `urn:tag:genre:media:apparel` looked like a taste and matched nothing.
 */
const CATEGORY_INDUSTRY: Record<string, string> = {
  apparel: "Apparel",
  footwear: "Footwear",
  beauty: "Beauty",
  food_beverage: "Food & Beverage",
  consumer_tech: "Consumer Technology",
  gaming: "Gaming",
  automotive: "Automotive",
  finance: "Financial Services",
  travel: "Travel & Hospitality",
  fitness: "Fitness",
  media_entertainment: "Media & Entertainment",
  home_lifestyle: "Home & Lifestyle",
  other: "Consumer Goods",
};

export interface SyntheticProviderOptions {
  /** Registry brands are injected so brand scoring works against real names. */
  brands?: readonly RegistryBrand[];
  cache?: KeyValueCache;
  tagScoringMode?: SyntheticTagScoringMode;
  /**
   * When true, `recommendTags` returns the SAME tags regardless of the signals,
   * simulating doc 03 §11's silent-ignore failure. Used to prove the pipeline
   * detects it and refuses to render (fallback level L4).
   */
  simulateSilentIgnore?: boolean;
}

export class SyntheticProvider implements CulturalIntelligenceProvider {
  readonly id = "synthetic" as const;
  readonly source: DataSource = SYNTHETIC_SOURCE;

  private readonly brands: readonly RegistryBrand[];
  private readonly tagScoringMode: SyntheticTagScoringMode;
  private readonly simulateSilentIgnore: boolean;

  constructor(private readonly options: SyntheticProviderOptions = {}) {
    this.brands = options.brands ?? [];
    this.tagScoringMode = options.tagScoringMode ?? "unscored";
    this.simulateSilentIgnore = options.simulateSilentIgnore ?? false;
    registerSyntheticEntities(this.brands.map(toSyntheticBrandEntity));
  }

  capabilities(): ProviderCapabilities {
    return CAPABILITIES;
  }

  async health(): Promise<ProviderHealth> {
    return {
      ok: true,
      // "Configured" means no credentials are needed — synthetic always works.
      configured: true,
      reachable: true,
      source: this.source,
      capabilities: CAPABILITIES,
    };
  }

  async search(request: SearchRequest) {
    return this.cached("synthetic:search", request, () => {
      const needle = request.query.trim().toLowerCase();
      const candidates = this.candidatePool(request.types);
      const scored = candidates
        .map((entity) => ({ entity, score: textMatch(needle, entity) }))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score || a.entity.name.localeCompare(b.entity.name))
        .slice(0, Math.max(1, Math.min(200, request.take ?? 10)));

      const response: QlooSearchResponse = {
        success: true,
        duration: 1,
        results: scored.map(({ entity }) => toWireEntity(entity)),
      };
      return mapSearchResponse(response, SYNTHETIC_SOURCE);
    });
  }

  async recommendEntities(request: RecommendRequest) {
    return this.cached("synthetic:insights", request, () => {
      // Under simulation the response must be INDEPENDENT of the signals, which
      // is what doc 03 §11's "wrong-but-200" failure actually looks like. Both
      // inputs to affinity have to be pinned: the trait vector (what the signals
      // mean) and the seed (which ids were sent). Pinning only one would leave a
      // residual dependency and the detector would never fire.
      const seed = this.simulateSilentIgnore
        ? signalSeed([])
        : signalSeed(request.signals.entityIds);
      const vector = this.simulateSilentIgnore ? ({} as TraitVector) : this.signalVector(request);
      const basePool = this.candidatePool([request.filterType]).filter(
        // Recommendations must not simply echo the creator's own inputs back.
        (entity) => !request.signals.entityIds.includes(entity.id),
      );
      // Brand discovery also surfaces a few invented brands that are NOT in the
      // curated registry, so the synthetic path exercises the same
      // "discovered, registry-absent" branch the live path hits (doc 02 §21
      // amendment). Injected here rather than registered globally, so tag
      // harvesting, search and every other filter type stay unaffected.
      const pool =
        request.filterType === "urn:entity:brand"
          ? [...basePool, ...DISCOVERED_SYNTHETIC_BRANDS]
          : basePool;

      const scored = pool
        .map((entity) => ({ entity, affinity: syntheticAffinityPercent(vector, entity, seed) }))
        .sort((a, b) => b.affinity - a.affinity || a.entity.name.localeCompare(b.entity.name));

      const take = Math.min(Math.max(1, request.take ?? 20), 50);
      const page = Math.max(1, request.page ?? 1);
      const slice = scored.slice((page - 1) * take, page * take);

      return mapEntityResultSet(
        this.toInsightsResponse(request, slice.map(({ entity, affinity }) =>
          this.toWireResult(entity, affinity, request, vector),
        )),
        SYNTHETIC_SOURCE,
        // Parity with the live adapter: the same type check runs on the same
        // call, so a test written against synthetic exercises the validation the
        // live path performs rather than a simplified version of it.
        { requestedType: request.filterType },
      );
    });
  }

  async scoreEntities(request: ScoreRequest) {
    return this.cached("synthetic:score-entities", request, () => {
      const seed = signalSeed(request.signals.entityIds);
      const vector = this.signalVector(request);
      const ids = request.candidateEntityIds ?? [];

      // `filter.results.entities` scores a SPECIFIC set. Unresolvable ids are
      // simply absent from the response, exactly as Qloo would behave.
      const scored = ids
        .map((id) => {
          const entity = resolveSyntheticEntity(id);
          return { entity, affinity: syntheticAffinityPercent(vector, entity, seed) };
        })
        .sort((a, b) => b.affinity - a.affinity || a.entity.name.localeCompare(b.entity.name))
        .slice(0, Math.min(Math.max(1, request.take ?? 50), 50));

      return mapEntityResultSet(
        this.toInsightsResponse(request, scored.map(({ entity, affinity }) =>
          this.toWireResult(entity, affinity, request, vector),
        )),
        SYNTHETIC_SOURCE,
      );
    });
  }

  async recommendTags(request: RecommendRequest) {
    return this.cached("synthetic:tags", request, () => {
      const vector = this.simulateSilentIgnore
        ? ({} as TraitVector)
        : this.signalVector(request);
      const tags = this.harvestTags(request.filterType === "urn:tag" ? undefined : [request.filterType]);
      const seed = signalSeed(request.signals.entityIds);

      const wire: QlooTagResult[] = tags
        .map((tag) => ({
          tag,
          // Popularity-ordered when signals are ignored, which is exactly the
          // "generic popular tags presented as personalised" failure doc 03 §11
          // warns about.
          affinity:
            this.tagScoringMode === "scored"
              ? syntheticAffinityPercent(vector, { traits: tagTraits(tag.id) } as SyntheticEntity, seed)
              : undefined,
        }))
        .sort((a, b) => (b.affinity ?? 0) - (a.affinity ?? 0) || a.tag.name.localeCompare(b.tag.name))
        .slice(0, Math.min(Math.max(1, request.take ?? 20), 50))
        .map(({ tag, affinity }) => ({
          tag_id: tag.id,
          tag_value: tag.id,
          name: tag.name,
          subtype: tag.type,
          types: [],
          // Doc 03 §6: the documented tag response carries an EMPTY query object.
          query: affinity === undefined ? {} : { affinity },
        }));

      return mapTagResultSet(this.toInsightsResponse(request, wire, "tags"), SYNTHETIC_SOURCE);
    });
  }

  async scoreTags(request: ScoreRequest) {
    return this.cached("synthetic:score-tags", request, () => {
      const vector = this.signalVector(request);
      const seed = signalSeed(request.signals.entityIds);
      const ids = request.candidateTagIds ?? [];

      const wire: QlooTagResult[] = ids
        .map((id) => ({
          id,
          name: tagNameFromId(id),
          type: tagNamespaceFromId(id),
        }))
        .map((tag) => ({
          tag_id: tag.id,
          tag_value: tag.id,
          name: tag.name,
          subtype: tag.type,
          types: [],
          query: {
            affinity: syntheticAffinityPercent(
              vector,
              { traits: tagTraits(tag.id) } as SyntheticEntity,
              seed,
            ),
          },
        }));

      return mapTagResultSet(this.toInsightsResponse(request, wire, "tags"), SYNTHETIC_SOURCE);
    });
  }

  async demographics(request: RecommendRequest) {
    return this.cached("synthetic:demographics", request, () => {
      const vector = this.signalVector(request);
      // Doc 03 §6: one demographics block per input signal, keyed by entity_id,
      // and the values are SIGNED deltas rather than 0–100 affinities.
      const rows = request.signals.entityIds.slice(0, 12).map((id) => {
        const entity = resolveSyntheticEntity(id);
        const seed = `${id}:${entity.name}`;
        return {
          entity_id: entity.id,
          query: {
            age: signedBuckets(AGE_BUCKETS, vector, seed),
            gender: signedBuckets(["male", "female"], vector, `${seed}:gender`),
          },
        };
      });

      const response: QlooInsightsResponse = {
        success: true,
        duration: 2,
        results: { demographics: rows },
      };
      return mapDemographicResultSet(response, SYNTHETIC_SOURCE);
    });
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private signalVector(request: RecommendRequest): TraitVector {
    const fromEntities = aggregateTraits(request.signals.entityIds);
    if (!request.signals.tagIds?.length) return fromEntities;
    // Tag signals contribute too, weighted lower than entity signals.
    const merged: TraitVector = { ...fromEntities };
    for (const tagId of request.signals.tagIds) {
      for (const [trait, weight] of Object.entries(tagTraits(tagId))) {
        const key = trait as keyof TraitVector;
        merged[key] = ((merged[key] ?? 0) + (weight ?? 0) * 0.5);
      }
    }
    return merged;
  }

  private candidatePool(types?: readonly string[]): SyntheticEntity[] {
    const all = allSyntheticEntities();
    const wanted = (types ?? []).filter((type) => type !== "urn:tag" && type !== "urn:demographics");
    if (wanted.length === 0) return all;
    return all.filter((entity) => wanted.includes(entity.type));
  }

  private toWireResult(
    entity: SyntheticEntity,
    affinity: number,
    request: RecommendRequest,
    vector: TraitVector,
  ): QlooEntityResult {
    const explainability = request.explainability
      ? { contributions: syntheticExplainability(request.signals.entityIds, entity) }
      : undefined;
    return {
      name: entity.name,
      entity_id: entity.id,
      type: entity.type,
      subtype: entity.subtype,
      disambiguation: entity.disambiguation,
      popularity: entity.popularity,
      properties: {
        description: entity.description,
        industries: entity.industries,
        release_year: undefined,
        geocode: undefined,
        websites: [],
      },
      tags: entity.tags,
      query: {
        affinity,
        explainability: explainability
          ? Object.fromEntries(
              explainability.contributions.map((c) => [c.signalEntityId, c.score]),
            )
          : undefined,
      },
      // Unused by the mapper but present so the vector is demonstrably driving
      // the score in debugging output.
      _syntheticCosine: round(cosineSimilarity(vector, entity.traits), 4),
    } as QlooEntityResult;
  }

  private toInsightsResponse(
    request: RecommendRequest,
    results: unknown[],
    bucket: "entities" | "tags" = "entities",
  ): QlooInsightsResponse {
    return {
      success: true,
      duration: 3,
      results: bucket === "tags" ? { tags: results as QlooTagResult[] } : { entities: results as QlooEntityResult[] },
      // Echo the requested type so a wrong-but-200 response is diagnosable.
      meta: { requestedFilterType: request.filterType },
    } as QlooInsightsResponse;
  }

  /** Distinct tags across the pool, so M3 has something to aggregate. */
  private harvestTags(types?: readonly string[]): Array<{ id: string; name: string; type: string }> {
    const seen = new Map<string, { id: string; name: string; type: string }>();
    for (const entity of this.candidatePool(types)) {
      for (const tag of entity.tags) {
        if (!seen.has(tag.id)) seen.set(tag.id, tag);
      }
    }
    return [...seen.values()];
  }

  private async cached<T>(namespace: string, request: unknown, work: () => T): Promise<T> {
    const cache = this.options.cache;
    if (!cache) return work();
    const key = cacheKey(namespace, request);
    const { value } = await cacheThrough(cache, key, async () => work());
    return value;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const AGE_BUCKETS = ["24_and_younger", "25_to_29", "30_to_34", "35_to_44", "45_to_54", "55_and_older"];

/** Stable ordering key for a signal set, so caching and jitter are reproducible. */
function signalSeed(entityIds: readonly string[]): string {
  return [...entityIds].sort().join("|");
}

function toWireEntity(entity: SyntheticEntity): QlooEntityResult {
  return {
    name: entity.name,
    entity_id: entity.id,
    type: entity.type,
    subtype: entity.subtype,
    disambiguation: entity.disambiguation,
    popularity: entity.popularity,
    properties: {
      description: entity.description,
      industries: entity.industries,
      websites: [],
    },
    tags: entity.tags,
  } as QlooEntityResult;
}

/**
 * A few invented brands that are NOT in the curated registry.
 *
 * The live path discovers brands Qloo associates with a creator's taste, most of
 * which have no curated entry; the pipeline then synthesises a minimal registry
 * shell and derives a category from Qloo metadata (doc 02 §21 amendment). These
 * exist so the SYNTHETIC path exercises that same registry-absent branch rather
 * than only ever overlapping the registry. They are injected into the brand
 * recommendation pool alone (see `recommendEntities`), never registered globally,
 * so tag harvesting and search are untouched. Descriptions and industries carry
 * category keywords so `deriveBrandCategory` classifies them; every value stays
 * synthetic.
 *
 * Their cultural tags are DERIVED from their trait vector by the same function
 * registry brands go through, rather than written by hand. Hand-written brand
 * tags are how the fixture ended up with `urn:tag:genre:media:audio_gear` — an id
 * no creator entity carries, so it could never intersect with anything.
 */
const DISCOVERED_BRAND_SEEDS: Array<Omit<SyntheticEntity, "tags">> = [
  {
    id: "syn:brand:discovered-waveform-audio",
    name: "Waveform Audio",
    type: "urn:entity:brand",
    subtype: "urn:entity:brand",
    category: "Brand",
    disambiguation: "Synthetic discovered brand (consumer electronics)",
    description: "Invented consumer electronics and audio hardware brand used for development data.",
    traits: { consumer_technology: 0.9, electronic_music: 0.65, design_craft: 0.4 },
    popularity: 0.58,
    industries: ["Consumer Electronics"],
  },
  {
    id: "syn:brand:discovered-apex-motoring",
    name: "Apex Motoring",
    type: "urn:entity:brand",
    subtype: "urn:entity:brand",
    category: "Brand",
    disambiguation: "Synthetic discovered brand (automotive)",
    description: "Invented automotive and performance vehicle brand used for development data.",
    traits: { motorsport: 0.95, consumer_technology: 0.4, design_craft: 0.35 },
    popularity: 0.64,
    industries: ["Automotive"],
  },
  {
    id: "syn:brand:discovered-pixel-forge",
    name: "Pixel Forge",
    type: "urn:entity:brand",
    subtype: "urn:entity:brand",
    category: "Brand",
    disambiguation: "Synthetic discovered brand (gaming)",
    description: "Invented video game and interactive entertainment studio used for development data.",
    traits: { gaming_indie: 0.9, gaming_competitive: 0.7, electronic_music: 0.3 },
    popularity: 0.51,
    industries: ["Video Games"],
  },
  {
    id: "syn:brand:discovered-verdant-supply",
    name: "Verdant Supply",
    type: "urn:entity:brand",
    subtype: "urn:entity:brand",
    category: "Brand",
    disambiguation: "Synthetic discovered brand (apparel)",
    description: "Invented sustainable outdoor apparel and gear brand used for development data.",
    traits: { sustainability: 0.85, outdoor_adventure: 0.6, streetwear: 0.5 },
    popularity: 0.44,
    industries: ["Apparel"],
  },
];

const DISCOVERED_SYNTHETIC_BRANDS: SyntheticEntity[] = DISCOVERED_BRAND_SEEDS.map((seed) => ({
  ...seed,
  tags: culturalTagsForTraits(seed.traits),
}));

/** Turn a curated registry brand into a synthetic entity with plausible traits. */
function toSyntheticBrandEntity(brand: RegistryBrand): SyntheticEntity {
  const base = CATEGORY_TRAITS[brand.category] ?? CATEGORY_TRAITS.other ?? [];
  const random = createRandom(`brand:${brand.slug}`);
  const traits: TraitVector = {};
  for (const [trait, weight] of base) {
    // ±0.12 per-brand variation so two brands in one category are not identical.
    traits[trait as keyof TraitVector] = round(Math.max(0.05, Math.min(1, weight + (random() - 0.5) * 0.24)), 3);
  }
  return {
    // The synthetic id is derived from the registry id when known, otherwise from
    // the slug. Either way it is stable, so cached scores stay valid. It MUST go
    // through `brandEntityId()` — the pipeline matches scored entities back to
    // registry brands by this id, so a provider-local naming scheme would orphan
    // every brand score.
    id: brandEntityId(brand),
    name: brand.displayName,
    type: "urn:entity:brand",
    subtype: "urn:entity:brand",
    category: "Brand",
    disambiguation: `Curated registry brand (${brand.category.replace(/_/g, " ")})`,
    description: brand.notes ?? `${brand.displayName} — brand entry from the CreatorsDNA curated registry.`,
    traits,
    popularity: round(0.4 + random() * 0.55, 3),
    industries: [CATEGORY_INDUSTRY[brand.category] ?? brand.category.replace(/_/g, " ")],
    // Cultural tags, in the catalogue's own vocabulary and derived from the trait
    // vector above — so they are deterministic per brand, and so a brand can only
    // share a taste the creator side is actually capable of carrying. A category
    // whose traits the catalogue has no tag for yields NO tag here, which is the
    // honest sparse case rather than a fabricated match.
    tags: culturalTagsForTraits(traits),
  };
}

/** Simple token-overlap relevance for the disambiguation picker. */
function textMatch(needle: string, entity: SyntheticEntity): number {
  if (!needle) return 0;
  const name = entity.name.toLowerCase();
  if (name === needle) return 1;
  if (name.startsWith(needle)) return 0.9;
  if (name.includes(needle)) return 0.75;
  const tokens = needle.split(/\s+/).filter(Boolean);
  const hits = tokens.filter((token) => name.includes(token)).length;
  if (hits > 0) return 0.4 * (hits / tokens.length);
  const category = entity.category.toLowerCase();
  if (category.includes(needle)) return 0.3;
  return 0;
}

/**
 * Deterministic SIGNED deltas in roughly [−0.5, +0.5].
 *
 * Driven by the signal vector so different creators get different demographic
 * shapes, and signed rather than 0–1 because doc 03 §6 is explicit that these
 * are deltas from average, not affinities.
 */
function signedBuckets(
  buckets: readonly string[],
  vector: TraitVector,
  seed: string,
): Record<string, number> {
  const density = Object.values(vector).reduce((sum, value) => sum + (value ?? 0), 0);
  const out: Record<string, number> = {};
  buckets.forEach((bucket, i) => {
    const random = createRandom(`${seed}:${bucket}`)();
    // Centred on zero, tilted by how strong the signal profile is.
    const tilt = Math.sin((i + 1) * 1.7) * Math.min(0.35, density * 0.12);
    out[bucket] = round(Math.max(-0.6, Math.min(0.6, tilt + (random - 0.5) * 0.3)), 3);
  });
  return out;
}

/** Derive a trait vector for a tag id, so tag signals influence results. */
function tagTraits(tagId: string): TraitVector {
  const pool = allSyntheticEntities();
  // A tag's meaning is the average of the entities carrying it — the same
  // aggregation M3 performs in reverse.
  const carriers = pool.filter((entity) => entity.tags.some((tag) => tag.id === tagId));
  if (carriers.length > 0) {
    return aggregateTraits(carriers.map((entity) => entity.id));
  }
  // Unknown tag: deterministically adopt three REAL traits from the vocabulary.
  // The keys must come from TRAITS — cosineSimilarity iterates that list, so an
  // invented key would be invisible to it and every unknown tag would score zero.
  const random = createRandom(`tag:${tagId}`);
  const traits: TraitVector = {};
  const chosen = new Set<Trait>();
  while (chosen.size < 3) {
    const trait = TRAITS[Math.floor(random() * TRAITS.length)] as Trait;
    if (chosen.has(trait)) continue;
    chosen.add(trait);
    traits[trait] = round(0.4 + random() * 0.45, 3);
  }
  return traits;
}

function tagNameFromId(tagId: string): string {
  const last = tagId.split(":").pop() ?? tagId;
  return last.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function tagNamespaceFromId(tagId: string): string {
  const parts = tagId.split(":");
  return parts.length >= 4 ? parts.slice(0, 4).join(":") : tagId;
}

export { SYNTHETIC_CATALOGUE_NOTICE };
