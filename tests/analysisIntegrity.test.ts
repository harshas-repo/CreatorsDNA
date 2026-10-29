// @vitest-environment node
/**
 * §12 regression tests — the integrity of the analysis itself.
 *
 * Everything pinned here was a real defect found by running the product against
 * the live catalogue, not a hypothetical. The short version of the four that
 * shaped this file:
 *
 *   - A live place recommendation returned ten entities and six of them carried
 *     `properties.keywords` as `[{name, count}]` instead of `[string]`. Zod
 *     validated the array as a whole, so one divergent sibling discarded nine
 *     usable results and the call surfaced as `malformed_response`.
 *   - The headline then announced a tattoo-and-music creator as "Pizza, Indian,
 *     Mediterranean, South Indian, … and Farmstay". Every word was a real tag on a
 *     real returned result. None of them traced to anything the creator confirmed.
 *   - A live brand call returned affinities spanning 0.8211–0.8382. Min-max
 *     stretched a spread of 0.017 across 0–1, the leader became `taste_fit = 1.00`,
 *     renormalisation handed it 75% of the weight, and the card read "Clear
 *     alignment" for a brand with no verified shared taste at all.
 *   - The creator's declared tags and the brands' tags live in disjoint tag
 *     namespaces. An exact-id comparison across them cannot match, and the zero it
 *     produced was being reported as "no shared taste found" — a finding about the
 *     brand, built out of a gap in our data.
 *
 * WHICH §12 CASES LIVE WHERE
 * --------------------------
 * §12 says "at minimum, cover these cases", and several were already covered before
 * this file existed. They are not duplicated here; they are named so a reviewer can
 * check compliance without hunting:
 *
 *   Review stage — `none` vs `error` separate, ambiguous results requiring an
 *     explicit choice, failed lookups not erasing input, and re-lookup preserving
 *     confirmations and rejections are all in `discovery.test.ts` and
 *     `flowTypes.test.ts`. Only extraction determinism, strategy-metadata
 *     completeness and the manual/extracted distinction were untested.
 *   Brand discovery — "empty responses do not trigger a fabricated fallback list"
 *     and "registry enrichment cannot create candidates" are in
 *     `brandSignals.test.ts`. Only entity-type validation was untested.
 *   Output integrity — "unexpected affinities are genuinely supported" is in
 *     `brandSignals.test.ts`.
 *
 * No network and no mocks of our own code: the wire payloads below are built
 * locally and pushed through the real schemas, the real mapper and the real
 * pipeline. Where a fixture is hand-built it is hand-built at the contract boundary
 * (`ScoredTasteTag`, `DimensionEvidence`) rather than by stubbing a calculator.
 */

import { describe, expect, it } from "vitest";

// `brandComparableTags` takes a `BrandTasteDNA`; `scoring/dimensions` exports a
// near-namesake `comparableBrandTags` that takes a `CulturalEntity` instead. They
// are not interchangeable, and because vitest transpiles without typechecking,
// importing the wrong one fails at runtime as a ReferenceError rather than at
// compile time — worth knowing before trusting a green run of this file alone.
import { brandComparableTags, buildBrandTasteDna } from "@/lib/analysis/brandTaste";
import { buildBrandFitViewModel } from "@/lib/analysis/buildersBrand";
import {
  extractCandidateTerms,
  capitalisedSpans,
  enumeratedSegments,
  hashtagTokens,
  MAX_CANDIDATES,
  quotedSpans,
  type CandidateStrategy,
} from "@/lib/analysis/extractTerms";
import {
  BROAD_OVERLAP_COUNT,
  CLEAR_OVERLAP,
  compareIntersections,
  distinctConcepts,
  intersectTaste,
  intersectionRankValue,
  STRONG_OVERLAP,
} from "@/lib/analysis/intersection";
import { brandIsUntapped, compareOpportunities, rankOpportunities } from "@/lib/analysis/opportunities";
import { partitionTasteDna } from "@/lib/analysis/tasteDna";
import { filterTypesFor, runAnalysis, type PipelineOutcome } from "@/lib/analysis/pipeline";
import { isBrandEntity } from "@/lib/contracts/brand";
import { ProviderError } from "@/lib/contracts/domain";
import { qlooInsightsResponseSchema } from "@/lib/contracts/qloo";
import { OVERLAP_STATE_LABEL, OVERLAP_STATE_RANK } from "@/lib/contracts/viewModels";
import {
  describeTasteDna,
  explainObservation,
  OBSERVATION_CONSEQUENCE,
  PIPELINE_FAILURE_CONSEQUENCE,
  PROVIDER_ERROR_CONSEQUENCE,
  sourceVoice,
} from "@/lib/copy/generate";
import { getAllBrands } from "@/lib/data/brandRegistry";
import { archetypeProfile, FIXED_TIMESTAMP } from "@/lib/demo/archetypes";
import { mapEntityResultSet } from "@/lib/providers/qloo/mapper";
import { SyntheticProvider } from "@/lib/providers/synthetic/provider";
import { detectAffinityScale, normalizeWithinSet } from "@/lib/scoring/affinity";
import {
  CULTURAL_DIMENSIONS,
  NOT_ENOUGH_EVIDENCE_LABEL,
  PARTIAL_ASSESSMENT_LABEL,
  alignmentLabel,
  scoreBrandFit,
  type BrandFitEvidence,
} from "@/lib/scoring/brandFit";
import {
  brandDiscoveryEvidence,
  classifyOverlap,
  opportunityGapEvidence,
  sharedTasteOverlap,
  tasteFitEvidence,
  type DimensionEvidence,
} from "@/lib/scoring/dimensions";

import type {
  CulturalEntity,
  DataSource,
  EntityResultSet,
  Provenance,
  ScoredTasteTag,
} from "@/lib/contracts/domain";
import type { QlooInsightsResponse } from "@/lib/contracts/qloo";
import type { CulturalIntelligenceProvider } from "@/lib/providers/provider";
import type {
  BrandDiscoveryEvidence,
  BrandOpportunity,
  BrandTasteDNA,
  FallbackLevel,
  OverlapState,
  TasteIntersection,
} from "@/lib/contracts/viewModels";

const registry = getAllBrands();

const LIVE_SOURCE: DataSource = {
  mode: "live",
  providerId: "qloo",
  label: "Live Qloo data",
  isIllustrative: false,
};

const BASE_PROFILE = archetypeProfile("electronic");

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * A creator-side taste tag.
 *
 * Hand-built rather than produced by running the M3 aggregation, because these
 * tests are about what the intersection does with a tag set, not about how the tag
 * set was counted. `support: 2` is the documented floor for surfacing, and
 * `contributedBy` carries a real shape so the provenance sentences have something
 * to name.
 */
function tasteTag(id: string, name: string, score: number, provenance: Provenance = "qloo"): ScoredTasteTag {
  return {
    tag: { id, name, provenance },
    score,
    support: 2,
    contributedBy: [{ entityId: "urn:entity:place:confirmed-1", entityName: "The Confirmed Venue", weight: score }],
    provenance,
  };
}

/**
 * A real `CulturalEntity`, obtained by pushing a wire payload through the real
 * schema and the real mapper.
 *
 * Deliberately not a literal. `CulturalEntity` carries an `AffinityReading` and a
 * `NormalisedScore`, and building those by hand would mean the tests assert
 * against a shape the mapper might never produce — the failure mode this file
 * exists to prevent, one level down.
 */
function entityFromWire(raw: Record<string, unknown>, requestedType?: string): CulturalEntity {
  const payload = qlooInsightsResponseSchema.parse({
    success: true,
    results: { entities: [raw] },
  }) as QlooInsightsResponse;
  const mapped = mapEntityResultSet(payload, LIVE_SOURCE, { requestedType });
  const entity = mapped.entities[0];
  if (entity === undefined) {
    throw new Error(
      `fixture produced no entity. Observations: ${mapped.meta.observations
        .map((observation) => `${observation.code}: ${observation.detail}`)
        .join(" | ") || "(none)"}`,
    );
  }
  return entity;
}

/** The wire shape Qloo actually sends for a brand, including its descriptor tags. */
function brandWireEntity(
  id: string,
  name: string,
  options: { affinity?: number; tagIds?: string[]; type?: string; industries?: string[] } = {},
): Record<string, unknown> {
  return {
    name,
    entity_id: id,
    type: options.type ?? "urn:entity:brand",
    subtype: options.type ?? "urn:entity:brand",
    properties: {
      description: `${name}, a brand.`,
      industries: options.industries,
    },
    tags: options.tagIds?.map((tagId) => ({ id: tagId, name: tagId.split(":").pop() ?? tagId })),
    query: { affinity: options.affinity ?? 0.82 },
  };
}

function brandDnaFromWire(
  id: string,
  name: string,
  options: { affinity?: number; tagIds?: string[]; type?: string; industries?: string[] } = {},
): BrandTasteDNA {
  return buildBrandTasteDna(entityFromWire(brandWireEntity(id, name, options)));
}

/** A brand whose cultural profile is a name and a classification, and nothing else. */
function descriptorlessBrand(brandId: string): BrandTasteDNA {
  return {
    brandId,
    descriptors: [],
    density: "sparse",
    evidenceLimited: true,
    basis: "Test fixture: a brand the catalogue returned no descriptors for.",
    provenance: "qloo",
  };
}

function intersect(
  brand: BrandTasteDNA,
  creatorTags: readonly ScoredTasteTag[],
  declaredIds: readonly string[] = [],
): TasteIntersection {
  return intersectTaste({ brandId: brand.brandId, brand, creatorTags, declaredIds });
}

/** A `DimensionEvidence` that contributed a value. */
function scored(value: number, basis = "Test fixture."): DimensionEvidence {
  return { value, basis, provenance: "derived", unavailableReason: "" };
}

/** A `DimensionEvidence` that could not be computed, with the reason attached. */
function withheld(reason: string, basis = "Test fixture."): DimensionEvidence {
  return { value: undefined, basis, provenance: "derived", unavailableReason: reason };
}

// ---------------------------------------------------------------------------
// §12 Review stage
//
// The four cases already covered elsewhere are listed in the file header. These
// three are the ones that were not, and they guard §1.1's "do not change the
// extraction algorithm merely for stylistic reasons" from the other side: an
// algorithm nobody has pinned can be changed by accident.
// ---------------------------------------------------------------------------

describe("§12 review stage — extraction is structural, and stays that way", () => {
  /**
   * One description per strategy, plus one that exercises all four at once.
   *
   * Written the way creators actually write, with no cultural vocabulary in them:
   * nothing below names a genre, a cuisine or a category the code could look up.
   */
  const DESCRIPTIONS: ReadonlyArray<{ name: string; text: string; strategy: CandidateStrategy }> = [
    {
      name: "quoted",
      text: 'I run a small studio and people keep calling the work "slow craft" which I have adopted.',
      strategy: "quoted",
    },
    { name: "hashtag", text: "Posting mostly #letterpress and #bookbinding these days.", strategy: "hashtag" },
    {
      name: "capitalised",
      text: "Trained at the Royal College under Tom Hull, then moved to Lisbon.",
      strategy: "capitalised",
    },
    {
      // "including" is one of the module's ENUMERATION_MARKERS. A bare colon is
      // NOT one, and that is worth remembering when writing a fixture here: the
      // strategy fires on an introducing phrase, not on list punctuation.
      name: "enumerated",
      text: "The studio takes commissions including paper marbling, foil blocking, and edition binding.",
      strategy: "enumerated",
    },
  ];

  it("extracts the same candidates from the same description, every time", () => {
    for (const { name, text } of DESCRIPTIONS) {
      const first = extractCandidateTerms(text);
      const second = extractCandidateTerms(text);
      const third = extractCandidateTerms(text);

      // Deep equality, not a length check: a reordering or a changed strategy tag
      // would both survive one.
      expect(second, `${name}: second run differs`).toEqual(first);
      expect(third, `${name}: third run differs`).toEqual(first);
      expect(first.length, `${name}: extraction found nothing at all`).toBeGreaterThan(0);
    }
  });

  it("attributes each description to the strategy that actually found something in it", () => {
    // Each extractor is called on its own so the aggregate cannot pass by finding
    // the phrase through a different route than the one being claimed.
    expect(quotedSpans(DESCRIPTIONS[0]!.text).length).toBeGreaterThan(0);
    expect(hashtagTokens(DESCRIPTIONS[1]!.text).length).toBeGreaterThan(0);
    expect(capitalisedSpans(DESCRIPTIONS[2]!.text).length).toBeGreaterThan(0);
    expect(enumeratedSegments(DESCRIPTIONS[3]!.text).length).toBeGreaterThan(0);

    for (const { name, text, strategy } of DESCRIPTIONS) {
      const strategies = extractCandidateTerms(text).map((candidate) => candidate.strategy);
      expect(strategies, `${name}: expected strategy absent`).toContain(strategy);
    }
  });

  it("labels every candidate with one of exactly the four structural strategies", () => {
    const allowed: readonly CandidateStrategy[] = ["quoted", "hashtag", "capitalised", "enumerated"];
    const everything = DESCRIPTIONS.flatMap(({ text }) => extractCandidateTerms(text));

    expect(everything.length).toBeGreaterThan(0);
    for (const candidate of everything) {
      expect(allowed, `unexpected strategy "${candidate.strategy}" on "${candidate.term}"`).toContain(
        candidate.strategy,
      );
      // §1.2: the reason travels with the phrase, so a fifth strategy appearing
      // without a label is a UI hole rather than a cosmetic one.
      expect(candidate.term.trim().length, "empty phrase reached the review list").toBeGreaterThan(0);
    }
    // §1.1's cap. Asserted as a ceiling on a deliberately over-long description
    // rather than on the fixtures above, which are all short.
    const noisy = Array.from({ length: 60 }, (_, i) => `#tag${i}`).join(" ");
    expect(extractCandidateTerms(noisy).length).toBeLessThanOrEqual(MAX_CANDIDATES);
  });

  it("finds nothing in prose with no structure, because there is no vocabulary to fall back on", () => {
    // The guarantee §1.1 asks for and the one a vocabulary would silently break:
    // all lower case, no quotes, no hashtags, no list punctuation, and several
    // words that a cultural lexicon would jump on.
    const unstructured =
      "i make things in a small room and mostly i am interested in how ordinary materials age over time";

    expect(extractCandidateTerms(unstructured)).toEqual([]);
  });

  it("never emits the manual strategy, so a hand-added phrase stays distinguishable", () => {
    // `"manual"` exists in the review list's vocabulary but not in the extractor's.
    // If extraction could ever produce it, a phrase the creator typed by hand would
    // be indistinguishable from one the algorithm suggested — which is the
    // distinction §1.2 exists to keep visible.
    const everything = DESCRIPTIONS.flatMap(({ text }) => extractCandidateTerms(text));
    const strategies = new Set<string>(everything.map((candidate) => candidate.strategy));

    expect(strategies.has("manual")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// §12 Provider response integrity
// ---------------------------------------------------------------------------

describe("§12 provider response integrity", () => {
  /**
   * The divergence that broke the observed run, transcribed from the captured
   * payload: `properties.keywords` as an array of `{name, count}` objects on some
   * entities and as a bare object on another, where the documented shape is an
   * array of strings.
   *
   * These are now READABLE, and that is the fix rather than a relaxation of the
   * test. `properties.keywords` is an unconsumed field — nothing downstream reads
   * it — so it is typed `unknown` and reconciled by the mapper. What used to happen
   * is that Zod validated `entities` as a whole array, so these six items failed the
   * array and took four perfectly good siblings down with them; the call surfaced as
   * `malformed_response` and an entire entity type looked like a provider outage.
   * The assertions below pin the corrected behaviour: nothing is lost, and nothing
   * is invented from the field either.
   */
  const KEYWORDS_AS_OBJECTS = {
    name: "Seafood Counter",
    entity_id: "kw-objects",
    types: ["urn:entity:place"],
    properties: { keywords: [{ name: "seafood", count: 12 }, { name: "market", count: 4 }] },
    popularity: 0.4,
  };
  const KEYWORDS_AS_BARE_OBJECT = {
    name: "Cake Counter",
    entity_id: "kw-bare",
    types: ["urn:entity:place"],
    properties: { keywords: { seafood: 3 } },
    popularity: 0.3,
  };
  const WELL_FORMED_SIBLING = {
    name: "Tattoo Studio",
    entity_id: "clean-1",
    types: ["urn:entity:place"],
    properties: { description: "A studio." },
    popularity: 0.5,
    tags: [{ name: "Body Art", tag_id: "urn:tag:genre:place:bodyart", value: "urn:tag:genre:place:bodyart" }],
  };

  /**
   * Items that genuinely CANNOT be read. The entity contract requires `name` and
   * `entity_id` as strings, and these break that in the two ways a real payload
   * does: one omits `name` entirely, the other sends it as a number. Unlike the
   * keyword divergence above there is nothing recoverable here — a result with no
   * readable name cannot be shown, traced, or attributed — so it is excluded, and
   * its exclusion is recorded rather than absorbed silently.
   */
  const UNREADABLE_NO_NAME = {
    entity_id: "bad-1",
    types: ["urn:entity:place"],
    properties: { description: "No name field at all." },
  };
  const UNREADABLE_WRONG_TYPE = {
    // A number where the contract requires a string.
    name: 4242,
    entity_id: "bad-2",
    types: ["urn:entity:place"],
  };

  it("parses and maps a documented response shape in full", () => {
    const parsed = qlooInsightsResponseSchema.safeParse({
      success: true,
      duration: 2.5,
      results: {
        entities: [
          {
            name: "Verified Brand",
            entity_id: "doc-1",
            types: ["urn:entity:brand"],
            properties: {
              description: "A documented brand.",
              industries: ["Apparel"],
              image: { url: "https://images.qloo.com/i/doc-1.jpg" },
            },
            popularity: 0.61,
            tags: [
              {
                name: "Streetwear",
                tag_id: "urn:tag:genre:brand:fashion",
                type: "urn:tag:genre:brand",
                value: "urn:tag:genre:brand:fashion",
              },
            ],
            query: { affinity: 87.5, index: 0 },
          },
        ],
      },
    });

    expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues)).toBe(true);
    if (!parsed.success) return;

    const mapped = mapEntityResultSet(parsed.data, LIVE_SOURCE, { requestedType: "urn:entity:brand" });
    const [entity] = mapped.entities;

    expect(mapped.entities).toHaveLength(1);
    expect(entity?.name).toBe("Verified Brand");
    expect(entity?.type).toBe("urn:entity:brand");
    expect(entity?.industries).toEqual(["Apparel"]);
    expect(entity?.imageUrl).toBe("https://images.qloo.com/i/doc-1.jpg");

    // Tags and affinities retain valid provenance: a live source must not produce
    // an illustrative badge, and the affinity must survive as the raw figure the
    // catalogue sent rather than only as its normalised position.
    expect(entity?.provenance).toBe("qloo");
    expect(mapped.meta.observations.map((o) => o.code)).not.toContain("synthetic_data");
    expect(entity?.tags.map((tag) => tag.provenance)).toEqual(["qloo"]);
    expect(entity?.rank.raw).toBe(87.5);
    expect(mapped.meta.affinityScale).toBe("percent");
  });

  it("loses nothing when a field nobody reads diverges from the documented shape", () => {
    const parsed = qlooInsightsResponseSchema.safeParse({
      success: true,
      results: { entities: [KEYWORDS_AS_OBJECTS, WELL_FORMED_SIBLING, KEYWORDS_AS_BARE_OBJECT] },
    });

    // The relaxation has to survive at the envelope level first: `entities` is
    // validated as `unknown[]` precisely so one item cannot fail the array.
    expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues)).toBe(true);
    if (!parsed.success) return;

    const mapped = mapEntityResultSet(parsed.data, LIVE_SOURCE, { requestedType: "urn:entity:place" });

    // This is the regression that mattered. All three were always usable; the old
    // whole-array validation returned NONE of them and reported a provider failure.
    expect(mapped.entities.map((entity) => entity.name)).toEqual([
      "Seafood Counter",
      "Tattoo Studio",
      "Cake Counter",
    ]);
    expect(mapped.meta.observations.map((o) => o.code)).not.toContain("items_rejected");

    // Tolerating the field is not licence to interpret it. The divergent keywords
    // carry "seafood" and "market", and neither may surface as a taste descriptor:
    // §13 forbids inventing cultural vocabulary, and a keyword bag whose shape we
    // could not read is not evidence of anything.
    const divergent = mapped.entities.find((entity) => entity.id === "kw-objects");
    expect(divergent?.tags).toEqual([]);
    const everyTagName = mapped.entities.flatMap((entity) => entity.tags.map((tag) => tag.name.toLowerCase()));
    expect(everyTagName).not.toContain("seafood");
    expect(everyTagName).not.toContain("market");
  });

  it("keeps the readable siblings when an item genuinely cannot be parsed, and says the set is partial", () => {
    const mapped = mapEntityResultSet(
      qlooInsightsResponseSchema.parse({
        success: true,
        results: { entities: [UNREADABLE_NO_NAME, WELL_FORMED_SIBLING, UNREADABLE_WRONG_TYPE] },
      }) as QlooInsightsResponse,
      LIVE_SOURCE,
      { requestedType: "urn:entity:place" },
    );
    const rejected = mapped.meta.observations.filter((o) => o.code === "items_rejected");

    expect(rejected).toHaveLength(1);
    // The observation must state which items were lost and that the set is PARTIAL.
    // A warning that says "some items were dropped" without the count or the
    // word "partial" would let a reader assume completeness anyway.
    expect(rejected[0]!.detail).toMatch(/PARTIAL/);
    expect(rejected[0]!.detail).toMatch(/2 of 3/);
    expect(rejected[0]!.severity).toBe("warning");
    expect(mapped.entities.map((entity) => entity.name)).toEqual(["Tattoo Studio"]);

    // §2.2: this is NOT a malformed response that failed the call, and it is not a
    // clean success either. It is a third thing, and it is labelled as one.
    expect(mapped.entities.length).toBeGreaterThan(0);
    expect(mapped.entities.length).toBeLessThan(3);
  });

  it("distinguishes an unreadable response from a genuinely empty one", () => {
    const allUnreadable = mapEntityResultSet(
      qlooInsightsResponseSchema.parse({
        success: true,
        results: { entities: [UNREADABLE_NO_NAME, UNREADABLE_WRONG_TYPE] },
      }) as QlooInsightsResponse,
      LIVE_SOURCE,
      { requestedType: "urn:entity:place" },
    );
    const genuinelyEmpty = mapEntityResultSet(
      qlooInsightsResponseSchema.parse({ success: true, results: { entities: [] } }) as QlooInsightsResponse,
      LIVE_SOURCE,
      { requestedType: "urn:entity:place" },
    );

    // Both end up with no entities. If nothing else differs, a failure to read has
    // been silently converted into "the catalogue had nothing", which is the exact
    // collapse §2.2 forbids.
    expect(allUnreadable.entities).toEqual([]);
    expect(genuinelyEmpty.entities).toEqual([]);
    expect(allUnreadable.meta.observations.map((o) => o.code)).toContain("items_rejected");
    expect(genuinelyEmpty.meta.observations.map((o) => o.code)).not.toContain("items_rejected");
  });

  it("does not let a failed entity-type call contaminate the signals that succeeded", async () => {
    // The scenario §2.2 names: one entity type fails, the others succeed, and the
    // failure must not take their evidence with it.
    //
    // The type that fails is the SECOND one the pipeline would request, not the
    // first. That is deliberate rather than arbitrary — `filterTypes[0]` is reused
    // by the demographics call and by the silent-ignore canary, so breaking it
    // would disable three things at once and the test would pass for the wrong
    // reason, having proved nothing about isolation.
    const filterTypes = filterTypesFor(BASE_PROFILE.selectedInterests);
    expect(filterTypes.length, `profile resolved to [${filterTypes.join(", ")}]`).toBeGreaterThanOrEqual(2);
    const failingType = filterTypes[1]!;

    const base = new SyntheticProvider({ brands: registry });
    const provider: CulturalIntelligenceProvider = {
      // Explicit delegation, never `...base`. A class instance keeps its methods on
      // the prototype, so spreading copies the fields alone and yields a provider
      // with no `capabilities()` — which fails on the pipeline's first line and
      // tells you nothing about the behaviour under test.
      id: base.id,
      source: base.source,
      capabilities: () => base.capabilities(),
      health: () => base.health(),
      search: (request) => base.search(request),
      scoreEntities: (request) => base.scoreEntities(request),
      recommendTags: (request) => base.recommendTags(request),
      scoreTags: (request) => base.scoreTags(request),
      demographics: (request) => base.demographics(request),
      recommendEntities: (request) =>
        request.filterType === failingType
          ? Promise.reject(
              new ProviderError(
                "malformed_response",
                `recommendEntities:${failingType} — no usable entity in the response`,
                { recoverable: true },
              ),
            )
          : base.recommendEntities(request),
    };

    const outcome = await runAnalysis({
      profile: BASE_PROFILE,
      provider,
      brands: registry,
      resolveInterests: false,
      generatedAt: FIXED_TIMESTAMP,
    });

    // The failure is recorded, with the code the live run produced.
    expect(outcome.failures.map((failure) => failure.code)).toContain("malformed_response");
    expect(outcome.analysis.observations.map((o) => o.code)).toContain("malformed_response");

    // ...and it did not take the rest of the analysis with it. §2.2: "a failure for
    // one entity type must not contaminate Taste DNA derived from other successful
    // calls."
    expect(outcome.analysis.tasteDna.coreTastes.length).toBeGreaterThan(0);
    expect(outcome.analysis.tasteDna.categories.length).toBeGreaterThan(0);

    // Every surviving taste still traces to an entity that actually arrived.
    for (const taste of outcome.analysis.tasteDna.coreTastes) {
      expect(taste.contributedBy.length, `"${taste.tag.name}" has no provenance trail`).toBeGreaterThan(0);
    }
  });

  it("cannot let a wrong-typed result enter Taste DNA silently", () => {
    // A venue whose NAME reads like a brand. §3.1: type decides, never the name.
    const mapped = mapEntityResultSet(
      qlooInsightsResponseSchema.parse({
        success: true,
        results: {
          entities: [
            brandWireEntity("venue-1", "Nike Store Mumbai", { type: "urn:entity:place" }),
            brandWireEntity("brand-1", "Actual Brand", { type: "urn:entity:brand" }),
          ],
        },
      }) as QlooInsightsResponse,
      LIVE_SOURCE,
      { requestedType: "urn:entity:brand" },
    );

    expect(mapped.entities.map((entity) => entity.name)).toEqual(["Actual Brand"]);
    const excluded = mapped.meta.observations.filter((o) => o.code === "entity_type_excluded");
    expect(excluded).toHaveLength(1);
    expect(excluded[0]!.detail).toMatch(/Nike Store Mumbai/);
    // Recorded rather than thrown: the surviving brand is still usable evidence.
    expect(excluded[0]!.severity).toBe("warning");
  });
});

// ---------------------------------------------------------------------------
// §12 Brand discovery
//
// "Empty responses do not trigger a fabricated fallback list" and "registry
// enrichment cannot create candidates" are pinned in `brandSignals.test.ts`. What
// was untested is the type validation the whole brand-only guarantee rests on.
// ---------------------------------------------------------------------------

describe("§12 brand discovery — only validated brands", () => {
  it("accepts an entity the catalogue types as a brand", () => {
    expect(isBrandEntity(entityFromWire(brandWireEntity("b1", "Typed Brand")))).toBe(true);
  });

  it("rejects venues, people, restaurants and media titles", () => {
    const wrongTypes = [
      "urn:entity:place",
      "urn:entity:person",
      "urn:entity:restaurant",
      "urn:entity:movie",
      "urn:entity:album",
      "urn:entity:character",
    ];

    for (const type of wrongTypes) {
      const entity = entityFromWire(brandWireEntity(`x-${type}`, "Something Brand Shaped", { type }));
      expect(entity.type, "the fixture did not carry the type under test").toBe(type);
      expect(isBrandEntity(entity), `${type} was accepted as a brand`).toBe(false);
    }
  });

  it("rejects a brand-like name on a wrong-typed entity, because the name is not the evidence", () => {
    // The specific §3.1 prohibition: no name-based heuristic. A venue called
    // "Supreme" is a venue.
    const namedLikeABrand = entityFromWire(
      brandWireEntity("v-1", "Supreme", { type: "urn:entity:place", industries: ["Apparel", "Fashion"] }),
    );

    expect(namedLikeABrand.name).toBe("Supreme");
    expect(namedLikeABrand.industries).toEqual(["Apparel", "Fashion"]);
    expect(isBrandEntity(namedLikeABrand)).toBe(false);
  });

  it("keeps a wrongly-typed result out of the brand list end to end, and records why", async () => {
    const base = new SyntheticProvider({ brands: registry });
    const intruder = brandWireEntity("intruder", "Intruding Venue", {
      type: "urn:entity:place",
      affinity: 99, // top of the set, so a name- or affinity-based leak would surface it
    });
    const provider: CulturalIntelligenceProvider = {
      // Delegated rather than spread, for the reason given above. `source` is the
      // live one here because the brand entities this provider returns were mapped
      // from `LIVE_SOURCE`, and a live-mapped result under a synthetic badge would
      // misstate its own provenance.
      id: "qloo",
      source: LIVE_SOURCE,
      capabilities: () => base.capabilities(),
      health: () => base.health(),
      search: (request) => base.search(request),
      scoreEntities: (request) => base.scoreEntities(request),
      recommendTags: (request) => base.recommendTags(request),
      scoreTags: (request) => base.scoreTags(request),
      demographics: (request) => base.demographics(request),
      recommendEntities: (request) =>
        request.filterType === "urn:entity:brand"
          ? Promise.resolve(
              mapEntityResultSet(
                qlooInsightsResponseSchema.parse({
                  success: true,
                  results: {
                    entities: [
                      intruder,
                      brandWireEntity("real-1", "Genuinely A Brand", {
                        affinity: 10,
                        tagIds: ["urn:tag:genre:brand:fashion"],
                      }),
                    ],
                  },
                }) as QlooInsightsResponse,
                LIVE_SOURCE,
                { requestedType: "urn:entity:brand" },
              ),
            )
          : base.recommendEntities(request),
    };

    const outcome = await runAnalysis({
      profile: BASE_PROFILE,
      provider,
      brands: registry,
      resolveInterests: false,
      generatedAt: FIXED_TIMESTAMP,
    });

    const names = outcome.analysis.opportunities.map((opportunity) => opportunity.name);
    expect(names).not.toContain("Intruding Venue");
    expect(names).toContain("Genuinely A Brand");
    expect(outcome.analysis.observations.map((o) => o.code)).toContain("entity_type_excluded");
  });
});

// ---------------------------------------------------------------------------
// §12 Cultural intersection
//
// Nothing in this group had a test before this file. `intersectTaste`,
// `sharedTasteOverlap`, `classifyOverlap`, `distinctConcepts` and the private
// `strengthLabelFor` between them carry the whole of the §5 fix, and the four-way
// overlap state §5.2 calls mandatory was reachable only through them — so the
// distinction between "we compared and found nothing" and "we could not compare"
// was unpinned, in the one place where collapsing them is most damaging.
//
// Fixtures are built at the contract boundary: wire payload → real schema → real
// mapper → real `buildBrandTasteDna`. A hand-written `BrandTasteDNA` literal would
// let these tests assert against descriptor weights and namespaces the real
// producer never emits, which is the failure mode this file exists to prevent, one
// level down.
// ---------------------------------------------------------------------------

describe("§12 cultural intersection", () => {
  // Realistic depths, all inside namespaces `isSurfaceableTag` allows.
  const PUNK = "urn:tag:genre:music:punk";
  const SHOEGAZE = "urn:tag:genre:music:shoegaze";
  const TECHNO = "urn:tag:genre:music:techno";
  const BRAND_FASHION = "urn:tag:genre:brand:fashion";
  const SKATE_STREET = "urn:tag:theme:skate:street";

  /** The entity `tasteTag` attributes every creator-side tag to. */
  const CONFIRMED_ENTITY = "urn:entity:place:confirmed-1";

  /**
   * Five ids one live brand entity actually carried. Five distinct identifiers and
   * one idea — the case `distinctConcepts` exists for, transcribed rather than
   * invented so the test and the doc comment beside `conceptOf` stay in agreement.
   */
  const FASHION_HIERARCHY = [
    "urn:tag:genre:brand:fashion",
    "urn:tag:genre:brand:fashion:footwear",
    "urn:tag:genre:brand:fashion:footwear:other",
    "urn:tag:genre:brand:fashion:formalwear",
    "urn:tag:genre:brand:fashion:casual",
  ];

  it("matches two descriptors only when their catalogue identifiers are identical", () => {
    const brand = brandDnaFromWire("b-punk", "Punk Brand", { tagIds: [PUNK, TECHNO] });
    const creator = [tasteTag(PUNK, "Punk", 1), tasteTag(SHOEGAZE, "Shoegaze", 1)];

    const result = intersect(brand, creator, [CONFIRMED_ENTITY]);

    expect(result.state).toBe("verified_overlap");
    expect(result.shared).toHaveLength(1);
    expect(result.shared[0]!.id).toBe(PUNK);
    expect(result.shared[0]!.matchBasis).toBe("descriptor");
    // One of two creator-side weight units, so a half — a figure with a denominator
    // a reader can see rather than a normalised position with none.
    expect(result.strength).toBe(0.5);
    expect(result.classificationMatches).toBe(0);

    // §10: the dimension names the entities that produced it, which is what keeps
    // "why the catalogue returned this" separable from "what overlap we verified".
    expect(result.shared[0]!.tracedTo).toEqual([CONFIRMED_ENTITY]);
    expect(result.shared[0]!.kind).toBe("direct");
    expect(result.kind).toBe("direct");

    const overlap = sharedTasteOverlap(creator, brandComparableTags(brand));
    expect(overlap.comparableNamespaces).toEqual(["urn:tag:genre:music"]);
    expect(overlap.matched.map((tag) => tag.tag.id)).toEqual([PUNK]);
  });

  it("accepts a classification the catalogue itself stated, but claims no number for it", () => {
    // The brand's recorded INDUSTRY matched against a creator taste by normalised
    // name. This is the only non-identity bridge the model supports, and it is
    // supported because it is the provider's own field — not because we authored a
    // table saying the two words mean the same thing (§5.1, §13).
    const brand = brandDnaFromWire("b-industry", "Industry Brand", { tagIds: [], industries: ["Punk"] });
    const creator = [tasteTag(PUNK, "Punk", 1)];

    const result = intersect(brand, creator, [CONFIRMED_ENTITY]);

    expect(result.state).toBe("verified_overlap");
    expect(result.classificationMatches).toBe(1);
    expect(result.shared[0]!.matchBasis).toBe("classification");
    // §5.4: an industry label is too coarse to carry a numeric share, so none is
    // claimed. `undefined`, not 0 — which makes the dimension unavailable rather
    // than reporting a measured absence of taste.
    expect(result.strength).toBeUndefined();
    expect(tasteFitEvidence(result).value).toBeUndefined();
    // No comparable tag of its own, so the brand is flagged and the label says so
    // instead of borrowing the confidence a descriptor match would have earned.
    expect(result.evidenceLimited).toBe(true);
    expect(result.strengthLabel).toBe("Limited evidence, but some shared ground");
  });

  it("refuses to match two labels that merely read alike", () => {
    // Same namespace, so the two profiles ARE comparable, and the labels are one
    // word apart. Matching them anyway would be exactly the unjustified inference
    // §5 names: the ids differ, so nothing matched.
    const brand = brandDnaFromWire("b-revival", "Revival Brand", {
      tagIds: ["urn:tag:genre:music:punkrevival"],
    });
    const creator = [tasteTag(PUNK, "Punk Rock", 1)];

    const result = intersect(brand, creator, [CONFIRMED_ENTITY]);

    expect(result.shared).toEqual([]);
    expect(result.state).toBe("no_overlap");
    expect(result.strength).toBeUndefined();
    expect(result.strengthLabel).toBe("No shared taste found");

    const overlap = sharedTasteOverlap(creator, brandComparableTags(brand));
    // Comparability was established, which is what makes this a finding rather than
    // a gap: both sides had descriptors in a namespace the other also carried.
    expect(overlap.comparableNamespaces).toEqual(["urn:tag:genre:music"]);
    expect(overlap.matched).toEqual([]);
  });

  it("reports incomparable rather than a measured zero when the profiles share no tag namespace", () => {
    // The live situation, and the defect behind §5: creator taste in
    // `urn:tag:genre:music:*`, brand descriptors in `urn:tag:genre:brand:*`. Doc 03
    // states no relationship between those catalogues of ideas, so §5.1's honest
    // branch applies and no bridge is invented.
    const brand = brandDnaFromWire("b-fashion", "Fashion Brand", { tagIds: [BRAND_FASHION] });
    const creator = [tasteTag(PUNK, "Punk", 1)];

    const overlap = sharedTasteOverlap(creator, brandComparableTags(brand));
    expect(overlap.comparableNamespaces).toEqual([]);
    expect(overlap.creatorNamespaces).toEqual(["urn:tag:genre:music"]);
    expect(overlap.brandNamespaces).toEqual(["urn:tag:genre:brand"]);

    const result = intersect(brand, creator, [CONFIRMED_ENTITY]);
    expect(result.state).toBe("incomparable");
    expect(result.shared).toEqual([]);
    expect(result.strength).toBeUndefined();
    expect(result.strengthLabel).toBe("Could not establish shared taste");
    // §9.8: the reason describes what WE could not establish. It must not read as a
    // claim that the brand has no relationship to the creator's topic, which is what
    // the old "no shared taste found" wording did with this exact evidence.
    expect(result.stateReason).toMatch(/namespace/i);
    expect(result.stateReason).not.toMatch(/no descriptor matched/i);
  });

  it("scores a genuine zero when comparable descriptors were examined and none matched", () => {
    const brand = brandDnaFromWire("b-techno", "Techno Brand", { tagIds: [TECHNO] });
    const creator = [tasteTag(PUNK, "Punk", 1)];

    const result = intersect(brand, creator, [CONFIRMED_ENTITY]);
    expect(result.state).toBe("no_overlap");
    expect(result.strengthLabel).toBe("No shared taste found");
    // The intersection claims no strength...
    expect(result.strength).toBeUndefined();
    // ...but the DIMENSION is a measured 0 rather than an omission. Withholding it
    // would renormalise a real negative finding away and rank this brand ABOVE one
    // we could not compare at all, which is the inversion §6.1 rules out.
    const evidence = tasteFitEvidence(result);
    expect(evidence.value).toBe(0);
    expect(evidence.unavailableReason).toBe("");
    expect(evidence.basis).toMatch(/zero here is the measurement/i);
  });

  it("keeps all four overlap states distinct, including the two that share a sentence", () => {
    const creator = [tasteTag(PUNK, "Punk", 1)];

    const verified = intersect(brandDnaFromWire("b1", "B1", { tagIds: [PUNK] }), creator, [CONFIRMED_ENTITY]);
    const noOverlap = intersect(brandDnaFromWire("b2", "B2", { tagIds: [TECHNO] }), creator, [CONFIRMED_ENTITY]);
    const incomparable = intersect(
      brandDnaFromWire("b3", "B3", { tagIds: [BRAND_FASHION] }),
      creator,
      [CONFIRMED_ENTITY],
    );
    const noBrandEvidence = intersect(descriptorlessBrand("b4"), creator, [CONFIRMED_ENTITY]);
    const noCreatorEvidence = intersect(brandDnaFromWire("b5", "B5", { tagIds: [PUNK] }), [], [CONFIRMED_ENTITY]);

    expect(
      [verified, noOverlap, incomparable, noBrandEvidence, noCreatorEvidence].map((result) => result.state),
    ).toEqual(["verified_overlap", "no_overlap", "incomparable", "insufficient_evidence", "insufficient_evidence"]);

    // The two `insufficient_evidence` cases are different facts about DIFFERENT
    // subjects — one is a gap in the brand's data, one in the creator's — and the
    // third gap is not an absence of data at all. Three distinct sentences.
    expect(noBrandEvidence.stateReason).not.toBe(noCreatorEvidence.stateReason);
    expect(incomparable.stateReason).not.toBe(noBrandEvidence.stateReason);
    expect(incomparable.stateReason).not.toBe(noCreatorEvidence.stateReason);

    // No gap may score, and each must say why rather than leaving a blank.
    for (const gap of [incomparable, noBrandEvidence, noCreatorEvidence]) {
      const evidence = tasteFitEvidence(gap);
      expect(evidence.value, `${gap.state} produced a score`).toBeUndefined();
      expect(evidence.unavailableReason.length).toBeGreaterThan(0);
      expect(gap.strengthLabel).toBe("Could not establish shared taste");
      expect(gap.strength).toBeUndefined();
    }

    // `incomparable` and `insufficient_evidence` deliberately share one LABEL, so the
    // state itself and not the prose is what the data model, the view models and the
    // UI must key on (§5.2's "consistent in the data model, API/view models, and
    // UI"). Pinning the collision is what keeps the `data-state` edge distinction in
    // the stylesheet load-bearing instead of decorative.
    expect(OVERLAP_STATE_LABEL.incomparable).toBe(OVERLAP_STATE_LABEL.insufficient_evidence);
    expect(OVERLAP_STATE_LABEL.no_overlap).not.toBe(OVERLAP_STATE_LABEL.insufficient_evidence);
    expect(OVERLAP_STATE_LABEL.verified_overlap).not.toBe(OVERLAP_STATE_LABEL.no_overlap);

    // Ranking orders by evidence quality, never by how the labels happen to read.
    expect(OVERLAP_STATE_RANK.verified_overlap).toBeGreaterThan(OVERLAP_STATE_RANK.no_overlap);
    expect(OVERLAP_STATE_RANK.no_overlap).toBeGreaterThan(OVERLAP_STATE_RANK.incomparable);
    expect(OVERLAP_STATE_RANK.incomparable).toBeGreaterThan(OVERLAP_STATE_RANK.insufficient_evidence);
    // And `compareIntersections` follows that order rather than the numeric value.
    expect(compareIntersections(verified, noOverlap)).toBeLessThan(0);
    expect(compareIntersections(noOverlap, incomparable)).toBeLessThan(0);
    expect(compareIntersections(incomparable, noBrandEvidence)).toBeLessThan(0);
    expect(compareIntersections(undefined, noBrandEvidence)).toBeGreaterThan(0);
    expect(intersectionRankValue(undefined)).toBe(-1);
  });

  it("does not let a tiny overlap wear a positive label or earn the untapped badge", () => {
    // One descriptor in ten, carrying a hundredth of the weight the others do. The
    // overlap is real, non-zero, and means very little.
    const creator = [
      tasteTag(PUNK, "Punk", 0.01),
      ...Array.from({ length: 9 }, (_, index) =>
        tasteTag(`urn:tag:genre:music:filler${index}`, `Filler ${index}`, 1),
      ),
    ];
    const brand = brandDnaFromWire("b-tiny", "Tiny Overlap Brand", { tagIds: [PUNK] });

    const result = intersect(brand, creator, [CONFIRMED_ENTITY]);

    expect(result.state).toBe("verified_overlap");
    expect(result.strength).toBeGreaterThan(0);
    expect(result.strength!).toBeLessThan(CLEAR_OVERLAP);
    // §5.4. "Some shared taste" is named explicitly because it is the label that
    // used to appear for an overlap of 0.0004: its return IS the regression.
    expect(result.strengthLabel).toBe("One shared descriptor");
    expect(result.strengthLabel).not.toBe("Some shared taste");
    expect(result.strengthLabel).not.toMatch(/strong|clear|broad/i);

    // Nor can it buy the untapped badge, however low the creator's coverage is —
    // `CLEAR_OVERLAP` is a documented line already published on /methodology, so no
    // new threshold is being introduced to make this pass.
    expect(brandIsUntapped(result, 0)).toBe(false);
    expect(brandIsUntapped(result, undefined)).toBe(false);
  });

  it("counts five representations of one concept as one concept", () => {
    const creator = FASHION_HIERARCHY.map((id, index) => tasteTag(id, `Descriptor ${index}`, 1));
    const repeated = intersect(
      brandDnaFromWire("b-fashion-5", "Five Ids One Idea", { tagIds: FASHION_HIERARCHY }),
      creator,
      [CONFIRMED_ENTITY],
    );

    expect(repeated.state).toBe("verified_overlap");
    expect(repeated.shared).toHaveLength(FASHION_HIERARCHY.length);
    // The count breadth is decided by. Five ids, one idea.
    expect(distinctConcepts(repeated.shared)).toBe(1);
    // A full share of the creator's weight, and still no breadth claim: intensity
    // without spread is exactly what §5.4 refuses to call strong or broad.
    expect(repeated.strength).toBe(1);
    expect(repeated.strength!).toBeGreaterThanOrEqual(STRONG_OVERLAP);
    expect(repeated.strengthLabel).not.toBe("Broad shared taste");
    expect(repeated.strengthLabel).not.toBe("Strong shared taste");

    // The contrast that proves the gate is breadth rather than general conservatism:
    // three genuinely distinct concepts at the SAME overlap strength do earn it.
    const distinctIds = [PUNK, BRAND_FASHION, SKATE_STREET];
    const spread = intersect(
      brandDnaFromWire("b-three", "Three Real Concepts", { tagIds: distinctIds }),
      distinctIds.map((id, index) => tasteTag(id, `Descriptor ${index}`, 1)),
      [CONFIRMED_ENTITY],
    );

    expect(spread.shared).toHaveLength(distinctIds.length);
    expect(distinctConcepts(spread.shared)).toBe(distinctIds.length);
    expect(spread.strength).toBe(repeated.strength);
    expect(spread.strengthLabel).toBe("Strong shared taste");
    expect(spread.strengthLabel).not.toBe(repeated.strengthLabel);
    // Why the first brand could not be called broad: the label needs at least
    // `BROAD_OVERLAP_COUNT` DISTINCT concepts, and one idea said five times is one.
    expect(distinctConcepts(repeated.shared)).toBeLessThan(BROAD_OVERLAP_COUNT);
  });

  it("classifies missing data before it classifies a namespace mismatch", () => {
    // The four states come out of one function whose CHECK ORDER is the logic:
    // `no_overlap` is the only state that makes a claim about the brand, so it may
    // be reached only once both sides demonstrably had comparable evidence. Each
    // case below satisfies the state it asserts while ALSO satisfying every
    // later condition, so a reordering is what fails the test rather than a value.
    const classify = (input: {
      creatorCount: number;
      brandCount: number;
      comparableNamespaces: readonly string[];
      matchedCount: number;
    }): OverlapState => classifyOverlap(input).state;

    // No creator-side tags AND no comparable namespaces AND no matches.
    expect(classify({ creatorCount: 0, brandCount: 3, comparableNamespaces: [], matchedCount: 0 })).toBe(
      "insufficient_evidence",
    );
    // No brand-side descriptors AND no comparable namespaces AND no matches.
    expect(classify({ creatorCount: 3, brandCount: 0, comparableNamespaces: [], matchedCount: 0 })).toBe(
      "insufficient_evidence",
    );
    // Both sides had descriptors, but no namespace in common.
    expect(classify({ creatorCount: 3, brandCount: 3, comparableNamespaces: [], matchedCount: 0 })).toBe(
      "incomparable",
    );
    // Comparable, and something matched.
    expect(
      classify({ creatorCount: 3, brandCount: 3, comparableNamespaces: ["urn:tag:genre:music"], matchedCount: 1 }),
    ).toBe("verified_overlap");
    // Comparable, nothing matched. The only case entitled to be a finding.
    expect(
      classify({ creatorCount: 3, brandCount: 3, comparableNamespaces: ["urn:tag:genre:music"], matchedCount: 0 }),
    ).toBe("no_overlap");

    // §9.8, at the level of the sentence itself: the two gap reasons describe what
    // WE could not establish. Neither may read as "this brand has nothing to do
    // with your topic", which is what the old single message did with both.
    const gapReasons = [
      classifyOverlap({ creatorCount: 0, brandCount: 3, comparableNamespaces: [], matchedCount: 0 }).reason,
      classifyOverlap({ creatorCount: 3, brandCount: 0, comparableNamespaces: [], matchedCount: 0 }).reason,
      classifyOverlap({ creatorCount: 3, brandCount: 3, comparableNamespaces: [], matchedCount: 0 }).reason,
    ];
    for (const reason of gapReasons) {
      expect(reason).not.toMatch(/no shared taste/i);
      expect(reason).toMatch(/gap|nothing on the|no comparison/i);
    }
    // Three distinct gaps, three distinct sentences — a reader has to be able to
    // tell a thin creator profile from a thin brand record from an unbridgeable
    // taxonomy, because only the first of those is something they can act on.
    expect(new Set(gapReasons).size).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// §12 Scoring and ranking
//
// Nothing in this group had a test before this file either: `normalizeWithinSet`,
// `brandDiscoveryEvidence`, `scoreBrandFit`, `opportunityGapEvidence`,
// `compareOpportunities` and `rankOpportunities` between them carry the whole of
// §4, §6 and §7.
//
// The live defect, in one sentence: a brand call returned affinities spanning
// 0.8211–0.8382, min-max stretched that 0.0171 across the whole of 0–1, the leader
// was awarded `taste_fit = 1.00`, renormalisation then handed that single dimension
// 75% of the weighting because the other four were unavailable, and the card read
// "Clear alignment" beside "No shared taste found".
//
// Every part of that was arithmetically true. So the tests below pin the arithmetic
// and the PERMISSION separately — that the normalisation still happens exactly as
// doc 04 §4.4 specifies, and that its output is no longer allowed to wear a cultural
// label or decide an order.
// ---------------------------------------------------------------------------

describe("§12 scoring and ranking", () => {
  const PUNK = "urn:tag:genre:music:punk";
  const TECHNO = "urn:tag:genre:music:techno";
  const BRAND_FASHION = "urn:tag:genre:brand:fashion";
  const CONFIRMED_ENTITY = "urn:entity:place:confirmed-1";
  const BRAND_ENDPOINT = "recommendEntities:urn:entity:brand";

  /**
   * The affinities a live brand recommendation actually returned, transcribed.
   *
   * Kept as the real figures rather than a convenient round spread, because the
   * whole point is how little the provider distinguished these candidates.
   */
  const LIVE_BRAND_AFFINITIES = [0.8382, 0.8312, 0.8253, 0.8211];

  /**
   * A brand candidate set, built the way the product builds one: wire payload →
   * real schema → real mapper. Every entity's `rank` then comes from the real
   * `normalizeWithinSet`, so nothing below asserts against a normalisation this
   * file invented.
   */
  function brandResultSet(affinities: readonly number[]): EntityResultSet {
    return mapEntityResultSet(
      qlooInsightsResponseSchema.parse({
        success: true,
        results: {
          entities: affinities.map((affinity, index) =>
            brandWireEntity(`urn:entity:brand:live-${index}`, `Live Brand ${index}`, { affinity }),
          ),
        },
      }) as QlooInsightsResponse,
      LIVE_SOURCE,
      { requestedType: "urn:entity:brand" },
    );
  }

  /** Ten candidates with a comfortably descending spread, for ranking tests. */
  const DISCOVERY_SET = brandResultSet([0.9, 0.88, 0.86, 0.84, 0.82, 0.8, 0.78, 0.76, 0.74, 0.72]);

  /** The real discovery evidence for the entry at `position`, 0-based. */
  function discoveryAt(position: number): BrandDiscoveryEvidence {
    const entity = DISCOVERY_SET.entities[position];
    if (entity === undefined) throw new Error(`fixture produced no entity at position ${position}`);
    const evidence = brandDiscoveryEvidence(DISCOVERY_SET, entity.id, BRAND_ENDPOINT);
    if (evidence === undefined) throw new Error(`fixture produced no discovery evidence for ${entity.id}`);
    return evidence;
  }

  /**
   * A minimal but CONTRACT-SHAPED `BrandOpportunity`.
   *
   * `fit` is built by the real `scoreBrandFit` and the real
   * `buildBrandFitViewModel` rather than hand-written, because
   * `compareOpportunities` reads `fit.overall.renderable` — a field decided by the
   * cultural-evidence gate, not by the arithmetic. Hand-writing it would let a
   * ranking test pass against a renderability the product never produces.
   */
  function opportunity(input: {
    name: string;
    intersection?: TasteIntersection;
    coverageKnown?: boolean;
    isUntapped?: boolean;
    discovery?: BrandDiscoveryEvidence;
    evidence?: BrandFitEvidence;
    level?: FallbackLevel;
  }): BrandOpportunity {
    const brandId = `urn:entity:brand:${input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    const fit = scoreBrandFit(input.evidence ?? {});
    return {
      brandId,
      name: input.name,
      fit: buildBrandFitViewModel({
        brandId,
        brandName: input.name,
        fit,
        source: LIVE_SOURCE,
        level: input.level ?? "L0",
      }),
      partnership: { available: false },
      isUntapped: input.isUntapped ?? false,
      coverageKnown: input.coverageKnown,
      intersection: input.intersection,
      discovery: input.discovery,
    };
  }

  it("keeps min-max normalisation for ordering, and refuses to let it be a cultural fit", () => {
    // The detection first. These figures all sit inside [0, 1], so the scale is
    // genuinely ambiguous and stays RECORDED as ambiguous rather than resolved by
    // assumption — §4.1's "if the scale is unresolved, record the limitation".
    const detection = detectAffinityScale(LIVE_BRAND_AFFINITIES);
    expect(detection.scale).toBe("unit");
    expect(detection.ambiguous).toBe(true);
    expect(detection.observedMin).toBe(0.8211);
    expect(detection.observedMax).toBe(0.8382);

    // Then the exaggeration itself. Nothing here is a bug: min-max is doing exactly
    // what doc 04 §4.4 specifies, and the set must still be ORDERABLE.
    const normalized = normalizeWithinSet(LIVE_BRAND_AFFINITIES, [0, 1, 2, 3]);
    expect(normalized.map((entry) => entry.method)).toEqual(["minmax", "minmax", "minmax", "minmax"]);
    expect(normalized[0]!.value).toBe(1);
    expect(normalized[3]!.value).toBe(0);
    expect(normalized.map((entry) => entry.setSize)).toEqual([4, 4, 4, 4]);

    // §4.1: the raw spread travels on EVERY entry, so a reader of one score can see
    // how little the provider distinguished the set it came from. `setSpread` is
    // what turns a `value` of 1.00 from a claim back into an ordering.
    for (const entry of normalized) {
      expect(entry.setSpread).toBeCloseTo(0.0171, 6);
    }

    // And the refusal. A perfect position in that set scores NO taste fit at all
    // when nothing was verified: `undefined`, not 1, and not 0 either.
    const evidence = tasteFitEvidence(undefined, discoveryAt(0));
    expect(evidence.value).toBeUndefined();
    expect(evidence.unavailableReason).toMatch(/rank 1 of 10/);
    expect(evidence.unavailableReason).toMatch(/not how well it fits/);
  });

  it("preserves the raw affinity, the unresolved scale and the set-relativity beside the position", () => {
    const set = brandResultSet(LIVE_BRAND_AFFINITIES);
    const discovery = brandDiscoveryEvidence(set, "urn:entity:brand:live-0", BRAND_ENDPOINT);

    expect(discovery, "the mapped set produced no discovery evidence").toBeDefined();
    const evidence = discovery!;
    expect(evidence.rank).toBe(1);
    expect(evidence.setSize).toBe(4);
    // §4.1: the raw value is NOT discarded after normalisation.
    expect(evidence.rawAffinity).toBe(0.8382);
    expect(evidence.normalisedPosition).toBe(1);
    expect(evidence.setSpread).toBeCloseTo(0.0171, 6);
    // The scale is recorded as detected and flagged unresolved, which is what stops
    // the raw figure being rendered to a creator as a percentage.
    expect(evidence.affinityScale).toBe("unit");
    expect(evidence.scaleResolved).toBe(false);
    expect(evidence.method).toBe("min-max normalised across the candidate set");
    expect(evidence.endpoint).toBe(BRAND_ENDPOINT);
    expect(evidence.provenance).toBe("qloo");

    // §4.2: the reading states what the figure is and what it is not in the same
    // breath, because a caveat in a footnote is a caveat nobody reads.
    expect(evidence.meaning).toMatch(/Why this brand appeared in the candidate set, not how well it fits/);
    expect(evidence.meaning).toMatch(/0\.8382/);
    expect(evidence.meaning).toMatch(/scale it does not document/);
    expect(evidence.meaning).toMatch(/close to a tie/);
    expect(evidence.meaning).toMatch(/not comparable to another analysis or another call/);
    // And it never states the figure as a percentage of anything.
    expect(evidence.meaning).not.toMatch(/\d+(\.\d+)?%/);
  });

  it("withholds the overall score when nothing cultural contributed, however good the arithmetic is", () => {
    // Audience, geography and coverage all measured, all strong. None of them says
    // anything about whether these two occupy the same cultural ground (§6.2).
    const fit = scoreBrandFit({
      audience_demographic: scored(0.9),
      geographic: scored(1),
      opportunity_gap: scored(0.8),
    });

    expect(fit.overall.value).toBeCloseTo(0.9, 4);
    expect(fit.overall.componentsUsed).toBe(3);
    expect(fit.overall.evidence.culturalEvidence).toBe(false);
    expect(fit.overall.evidence.culturalDimensionsAvailable).toEqual([]);
    // The value is still carried, for the diagnostic panel. What changed is that it
    // may not be RENDERED as a fit score.
    expect(fit.overall.renderable).toBe(false);
    expect(fit.overall.label).toBe(NOT_ENOUGH_EVIDENCE_LABEL);
    // §6.3: a score resting on logistics cannot wear an alignment word, so the label
    // and the band the value would have earned are deliberately different strings.
    expect(alignmentLabel(fit.overall.value)).toBe("Strong alignment");
    expect(fit.overall.label).not.toBe(alignmentLabel(fit.overall.value));
    expect(fit.overall.label).not.toMatch(/alignment/i);
    expect(fit.overall.disclosure).toMatch(/none of the dimensions that contributed measures cultural compatibility/i);

    // The view model agrees with the aggregator, so a card cannot render a number
    // the score withheld.
    const viewModel = buildBrandFitViewModel({
      brandId: "urn:entity:brand:logistics",
      brandName: "Logistics Only",
      fit,
      source: LIVE_SOURCE,
      level: "L0",
    });
    expect(viewModel.overall.renderable).toBe(false);
    expect(viewModel.overall.label).toBe(NOT_ENOUGH_EVIDENCE_LABEL);
    expect(viewModel.rationale.length, "an unrenderable score shipped with no explanation").toBeGreaterThan(0);
  });

  it("renormalises the dimensions that are missing instead of defaulting them", () => {
    const fit = scoreBrandFit({
      taste_fit: withheld("No verified overlap was established for this brand."),
      content_compatibility: withheld("Content format could not be compared."),
      audience_demographic: scored(0.9),
      geographic: scored(1),
      opportunity_gap: scored(0.8),
    });
    const byDimension = new Map(fit.components.map((component) => [component.dimension, component]));

    for (const dimension of CULTURAL_DIMENSIONS) {
      const component = byDimension.get(dimension);
      expect(component, `${dimension} vanished from the breakdown entirely`).toBeDefined();
      // §6.1: an unavailable dimension must not silently become zero, and must not
      // become a neutral 0.5 either. It is absent, visibly.
      expect(component!.available).toBe(false);
      expect(component!.value).toBeUndefined();
      expect(component!.effectiveWeight).toBe(0);
      // The NOMINAL weight survives beside it, so a reader can see what was lost
      // rather than having to know the model by heart.
      expect(component!.weight).toBeGreaterThan(0);
    }

    // What renormalisation means: the weights that did apply make up a whole.
    const applied = fit.components
      .filter((component) => component.available)
      .reduce((sum, component) => sum + component.effectiveWeight, 0);
    expect(applied).toBeCloseTo(1, 4);
    // And the nominal weighting they cover is stated rather than left to be added up.
    expect(fit.coverage).toBeCloseTo(0.4, 4);
    expect(fit.overall.evidence.coveredWeighting).toBeCloseTo(0.4, 4);
  });

  it("explains the size of the gap instead of leaving it to be reconstructed", () => {
    const fit = scoreBrandFit({
      taste_fit: withheld("No verified overlap was established for this brand."),
      content_compatibility: withheld("Content format could not be compared."),
      audience_demographic: scored(0.9),
      geographic: scored(1),
      opportunity_gap: scored(0.8),
    });

    // §6.4 asks for five things on the object the UI renders: nominal weights,
    // dimensions evaluated, effective weights, the reason each missing one is
    // missing, and the evidence behind each evaluated one. All five, without a
    // diagnostic panel.
    expect(fit.overall.componentsUsed).toBe(3);
    expect(fit.overall.componentsTotal).toBe(5);
    expect(fit.overall.evidence.partial).toBe(true);
    expect(fit.overall.evidence.coverageNote).toMatch(/3 of 5 dimensions contributed/);
    expect(fit.overall.evidence.coverageNote).toMatch(/40% of the intended weighting/);
    expect(fit.overall.evidence.coverageNote).toMatch(/not a full assessment/);
    expect(fit.overall.evidence.coverageNote).toMatch(/no alignment label is claimed/);
    for (const component of fit.components) {
      expect(component.basis.length, `${component.dimension} shipped with no basis`).toBeGreaterThan(0);
      expect(component.effectiveWeight).toBeDefined();
      expect(component.weight).toBeDefined();
    }

    const unavailable = fit.overall.evidence.unavailable;
    expect(unavailable.map((entry) => entry.dimension).sort()).toEqual(["content_compatibility", "taste_fit"]);
    // Each carries the REASON it was withheld, which is the difference between
    // "missing" and "we could not establish this".
    expect(unavailable.find((entry) => entry.dimension === "taste_fit")!.reason).toBe(
      "No verified overlap was established for this brand.",
    );
    expect(unavailable.find((entry) => entry.dimension === "content_compatibility")!.reason).toBe(
      "Content format could not be compared.",
    );
    // The disclosure names the dimensions by their human labels and says plainly
    // that the omission was not a default.
    expect(fit.overall.disclosure).toMatch(/3 of 5 dimensions/);
    expect(fit.overall.disclosure).toMatch(/Taste fit/);
    expect(fit.overall.disclosure).toMatch(/Content compatibility/);
    expect(fit.overall.disclosure).toMatch(/not set to a default/);
  });

  it("does not vouch for a renormalisation that never happened when nothing contributed", () => {
    // Live run, 2026-10-27: all twelve discovered brands came back 0 of 5, and the
    // panel still read "the rest were renormalised into the ones that did. The
    // figure is arithmetically correct over the available dimensions". At zero
    // contributors there is no "ones that did" and no figure — and `Overall` says
    // the opposite in the same breath ("A zero here would be a fabricated verdict").
    // ScoreBreakdown renders this note whenever the assessment is partial,
    // unrenderable scores included, so the contradiction was user-facing.
    const fit = scoreBrandFit({
      taste_fit: withheld("No verified overlap was established for this brand."),
      audience_demographic: withheld("No audience demographics were declared."),
      content_compatibility: withheld("Content format could not be compared."),
      geographic: withheld("No declared country to compare against."),
      opportunity_gap: withheld("Coverage for this category is unknown."),
    });

    expect(fit.overall.componentsUsed).toBe(0);
    expect(fit.overall.evidence.partial).toBe(true);
    expect(fit.overall.renderable).toBe(false);
    expect(fit.overall.label).toBe(NOT_ENOUGH_EVIDENCE_LABEL);

    const note = fit.overall.evidence.coverageNote;
    expect(note).toMatch(/None of the 5 dimensions could be computed/);
    expect(note).toMatch(/no figure and nothing was renormalised/);
    expect(note).not.toMatch(/renormalised into the ones that did/);
    expect(note).not.toMatch(/arithmetically correct/);
    // The label refusal is still stated — it is the one claim this note can make.
    expect(note).toMatch(/no alignment label is claimed/);

    // Withholding the total must not withhold the explanation (§6.4): every
    // dimension is still listed with its own reason.
    expect(fit.overall.evidence.unavailable).toHaveLength(5);
    expect(fit.overall.evidence.coveredWeighting).toBe(0);
  });

  it("caps the label at a partial assessment when cultural evidence exists but taste fit does not", () => {
    const fit = scoreBrandFit({
      content_compatibility: scored(0.9),
      audience_demographic: scored(0.9),
      geographic: scored(1),
      opportunity_gap: scored(0.8),
    });

    expect(fit.overall.evidence.culturalEvidence).toBe(true);
    expect(fit.overall.evidence.culturalDimensionsAvailable).toEqual(["content_compatibility"]);
    expect(fit.overall.renderable).toBe(true);
    // The number is high enough for the strongest band...
    expect(fit.overall.value).toBeGreaterThan(0.8);
    expect(alignmentLabel(fit.overall.value)).toBe("Strong alignment");
    // ...and it is still not allowed to wear it. Breadth of content format is not
    // intensity of shared taste, and renormalisation cannot promote one into the
    // other (§6.3). A partial subset has to be identified as a partial subset.
    expect(fit.overall.label).toBe(PARTIAL_ASSESSMENT_LABEL);
    expect(fit.overall.label).not.toBe(alignmentLabel(fit.overall.value));
  });

  it("never lets a discovery rank outrank a verified cultural intersection", () => {
    const creator = [tasteTag(PUNK, "Punk", 1)];
    const verified = intersect(
      brandDnaFromWire("b-verified", "Verified Brand", { tagIds: [PUNK] }),
      creator,
      [CONFIRMED_ENTITY],
    );
    const incomparable = intersect(
      brandDnaFromWire("b-fashion", "Fashion Brand", { tagIds: [BRAND_FASHION] }),
      creator,
      [CONFIRMED_ENTITY],
    );
    expect(verified.state).toBe("verified_overlap");
    expect(incomparable.state).toBe("incomparable");

    // Top of the discovery set, and nothing we could compare. Tenth of the set, and
    // a verified shared descriptor. §7.1: the intersection leads.
    const topOfSet = opportunity({
      name: "Top Of Discovery Set",
      intersection: incomparable,
      discovery: discoveryAt(0),
      evidence: { audience_demographic: scored(0.95), geographic: scored(1), opportunity_gap: scored(0.9) },
    });
    const verifiedFit = opportunity({
      name: "Verified Shared Taste",
      intersection: verified,
      discovery: discoveryAt(9),
      evidence: { taste_fit: scored(0.4), content_compatibility: scored(0.3) },
    });
    expect(topOfSet.discovery!.rank).toBe(1);
    expect(verifiedFit.discovery!.rank).toBe(10);
    // The unverified brand even has the higher arithmetic, so this cannot pass by
    // the fit key happening to decide it.
    expect(topOfSet.fit.overall.value).toBeGreaterThan(verifiedFit.fit.overall.value);

    expect(compareOpportunities(topOfSet, verifiedFit)).toBeGreaterThan(0);
    expect(compareOpportunities(verifiedFit, topOfSet)).toBeLessThan(0);
    expect(rankOpportunities([topOfSet, verifiedFit]).map((entry) => entry.name)).toEqual([
      "Verified Shared Taste",
      "Top Of Discovery Set",
    ]);
    // Same answer from the other input order, which is what "leads" has to mean.
    expect(rankOpportunities([verifiedFit, topOfSet]).map((entry) => entry.name)).toEqual([
      "Verified Shared Taste",
      "Top Of Discovery Set",
    ]);
  });

  it("does not let a missing intersection fall through to a fit-score sort", () => {
    const creator = [tasteTag(PUNK, "Punk", 1)];
    const noOverlap = intersect(
      brandDnaFromWire("b-techno", "Techno Brand", { tagIds: [TECHNO] }),
      creator,
      [CONFIRMED_ENTITY],
    );
    expect(noOverlap.state).toBe("no_overlap");

    // A brand with no intersection at all, carrying an excellent-looking score built
    // entirely from logistics. Beside it, a brand we compared and found nothing in,
    // scored zero on both cultural dimensions.
    const unintersected = opportunity({
      name: "Never Compared",
      intersection: undefined,
      evidence: { audience_demographic: scored(0.95), geographic: scored(1), opportunity_gap: scored(0.9) },
    });
    const measured = opportunity({
      name: "Compared And Found Nothing",
      intersection: noOverlap,
      evidence: { taste_fit: scored(0), content_compatibility: scored(0) },
    });

    expect(unintersected.fit.overall.value).toBeGreaterThan(measured.fit.overall.value);
    expect(unintersected.fit.overall.renderable).toBe(false);
    expect(measured.fit.overall.renderable).toBe(true);

    // §7.1: an invalid or unavailable overall fit score must not act as a fallback
    // ranking advantage, and an empty intersection must not tie silently into the
    // keys below it and be decided by one.
    expect(rankOpportunities([unintersected, measured]).map((entry) => entry.name)).toEqual([
      "Compared And Found Nothing",
      "Never Compared",
    ]);
    // Nor is the un-compared brand dropped. Removing it would hide a real brand
    // behind a gap in OUR data about it.
    expect(rankOpportunities([unintersected, measured])).toHaveLength(2);
  });

  it("keeps the opportunity gap unavailable, and the untapped badge unearned, when coverage is unknown", () => {
    // §7.2. The observed run had NO declared coverage categories, so coverage was
    // unknown — and unknown must not be read as "uncovered".
    const gap = opportunityGapEvidence(0.8, undefined, "unavailable");
    expect(gap.value).toBeUndefined();
    expect(gap.unavailableReason).toMatch(/coverage for the relevant category is unknown/i);
    expect(gap.unavailableReason).toMatch(/never inferred from nothing/i);
    expect(gap.unavailableReason).toMatch(/renormalised/i);
    // A relevance figure does not rescue it: with no coverage there is nothing to
    // multiply by.
    expect(opportunityGapEvidence(undefined, 0, "creator_declared").value).toBeUndefined();

    const creator = [tasteTag(PUNK, "Punk", 1)];
    const verified = intersect(
      brandDnaFromWire("b-punk", "Punk Brand", { tagIds: [PUNK] }),
      creator,
      [CONFIRMED_ENTITY],
    );
    expect(verified.state).toBe("verified_overlap");
    expect(verified.strength!).toBeGreaterThanOrEqual(CLEAR_OVERLAP);

    // Missing coverage yields false — but that false is a missing answer, not a
    // measured "already covered".
    expect(brandIsUntapped(verified, undefined)).toBe(false);
    expect(brandIsUntapped(verified, 0)).toBe(true);

    // The second half of §7.2, and the easy half to miss: that false must neither
    // promote nor demote. The names are chosen so the alphabetical tie-break runs
    // OPPOSITE to the untapped flag — if the flag leaked into the order, the
    // unknown-coverage brand would come first.
    const sharedEvidence: BrandFitEvidence = { taste_fit: scored(0.8), content_compatibility: scored(0.6) };
    const knownUntapped = opportunity({
      name: "Zebra Known Untapped",
      intersection: verified,
      coverageKnown: true,
      isUntapped: true,
      evidence: sharedEvidence,
    });
    const unknownCoverage = opportunity({
      name: "Apple Unknown Coverage",
      intersection: verified,
      coverageKnown: false,
      isUntapped: false,
      evidence: sharedEvidence,
    });
    expect(rankOpportunities([knownUntapped, unknownCoverage]).map((entry) => entry.name)).toEqual([
      "Apple Unknown Coverage",
      "Zebra Known Untapped",
    ]);
    expect(rankOpportunities([unknownCoverage, knownUntapped]).map((entry) => entry.name)).toEqual([
      "Apple Unknown Coverage",
      "Zebra Known Untapped",
    ]);

    // The contrast that proves the key does fire when coverage IS known on both
    // sides: untapped then decides, against the same alphabetical tie-break.
    const knownCovered = opportunity({
      name: "Apple Known Covered",
      intersection: verified,
      coverageKnown: true,
      isUntapped: false,
      evidence: sharedEvidence,
    });
    expect(rankOpportunities([knownCovered, knownUntapped]).map((entry) => entry.name)).toEqual([
      "Zebra Known Untapped",
      "Apple Known Covered",
    ]);
  });
});

// ---------------------------------------------------------------------------
// §12 Output integrity
//
// "Unexpected affinities are genuinely supported" is pinned in
// `brandSignals.test.ts` and is not repeated here.
// ---------------------------------------------------------------------------

describe("§12 output integrity", () => {
  /** The real pipeline against the real synthetic provider, per test. */
  async function run(
    provider: CulturalIntelligenceProvider = new SyntheticProvider({ brands: registry }),
  ): Promise<PipelineOutcome> {
    return runAnalysis({
      profile: BASE_PROFILE,
      provider,
      brands: registry,
      resolveInterests: false,
      generatedAt: FIXED_TIMESTAMP,
    });
  }

  it("names only tastes that trace to a confirmed interest in the headline", async () => {
    const outcome = await run();
    const dna = outcome.analysis.tasteDna;
    const bands = partitionTasteDna(dna);
    const copy = describeTasteDna(dna, sourceVoice(outcome.analysis.source), bands);

    // Core means traceable, and adjacent means not. That is the whole distinction,
    // and it is what the headline is allowed to rest on.
    const declaredIds = new Set(dna.declared.map((entry) => entry.id));
    for (const entry of bands.core) {
      expect(entry.supportedBy, `"${entry.label}" is core but traces to no confirmed entity`).not.toEqual([]);
      const taste = dna.coreTastes.find((candidate) => candidate.tag.id === entry.id);
      expect(taste, `"${entry.label}" is in the core band but not in coreTastes`).toBeDefined();
      const traced = taste!.contributedBy.filter((contribution) => declaredIds.has(contribution.entityId));
      expect(traced.length, `"${entry.label}" claims declared support it does not have`).toBeGreaterThan(0);
    }
    for (const entry of bands.adjacent) {
      expect(entry.supportedBy, `"${entry.label}" is adjacent but claims declared support`).toEqual([]);
    }

    // §2.3 / §9.1: the basis is decided by the core band alone, so the headline and
    // the band rendered beside it cannot disagree — and the word "centres" belongs
    // to the declared band only. That one rule is what stops the observed run's
    // "Pizza, Indian, Mediterranean … and Farmstay", every word of which was a real
    // tag on a real returned result and none of which traced to a confirmed interest.
    if (bands.core.length > 0) {
      expect(copy.basis).toBe("declared");
      expect(copy.headline).toMatch(/centres on/);
      for (const label of bands.core.slice(0, 3).map((entry) => entry.label)) {
        expect(copy.headline, `headline omits a core taste it claims to rest on`).toContain(label);
      }
    } else {
      expect(copy.basis).not.toBe("declared");
      expect(copy.headline).not.toMatch(/centres on/);
    }
    // Whichever branch ran, the headline must not borrow a label from a band it did
    // not claim — that is the leak the observed run was.
    const claimed = copy.basis === "declared" ? bands.core : bands.adjacent;
    const other = copy.basis === "declared" ? bands.adjacent : bands.core;
    for (const entry of other) {
      if (claimed.some((candidate) => candidate.label === entry.label)) continue;
      expect(copy.headline, `"${entry.label}" is from the ${copy.basis === "declared" ? "adjacent" : "core"} band`).not.toContain(entry.label);
    }
  });

  it("flags nothing untapped without known coverage, and ranks by evidence state", async () => {
    const outcome = await run();
    const opportunities = outcome.analysis.opportunities;
    expect(opportunities.length).toBeGreaterThan(0);

    for (const entry of opportunities) {
      if (!entry.isUntapped) continue;
      // §9.5 / §7.2: an untapped connection requires ACTUAL known coverage AND
      // valid supporting affinity evidence. Both, every time.
      expect(entry.coverageKnown, `${entry.name} is flagged untapped on unknown coverage`).toBe(true);
      expect(entry.intersection?.state, `${entry.name} is flagged untapped without a verified overlap`).toBe(
        "verified_overlap",
      );
      expect(entry.intersection!.strength ?? 0).toBeGreaterThanOrEqual(CLEAR_OVERLAP);
    }

    // §7.1 at the level of the finished list: the evidence-state ordering survives
    // all the way to the output, so no brand on a weaker state precedes one on a
    // stronger state anywhere in the array.
    const stateRanks = opportunities.map((entry) =>
      entry.intersection === undefined ? -1 : OVERLAP_STATE_RANK[entry.intersection.state],
    );
    for (let index = 1; index < stateRanks.length; index += 1) {
      expect(
        stateRanks[index - 1]!,
        `${opportunities[index - 1]!.name} precedes ${opportunities[index]!.name} on weaker evidence`,
      ).toBeGreaterThanOrEqual(stateRanks[index]!);
    }
    // And the list ships in the order the comparator produces, so the sort was
    // actually applied rather than merely available.
    expect(opportunities.map((entry) => entry.name)).toEqual(
      rankOpportunities(opportunities).map((entry) => entry.name),
    );
  });

  it("separates why the catalogue returned a brand from what overlap was established", async () => {
    const outcome = await run();
    const withDiscovery = outcome.analysis.opportunities.filter((entry) => entry.discovery !== undefined);
    expect(withDiscovery.length, "the run produced no discovery metadata to check").toBeGreaterThan(0);

    for (const entry of withDiscovery) {
      const discovery = entry.discovery!;
      // §10: a discovery path is not proof of a cultural match, and the sentence has
      // to say so where the figure is rather than in a footnote.
      expect(discovery.meaning).toMatch(/not how well it fits/);
      expect(discovery.meaning).toMatch(/set-relative/);
      expect(discovery.meaning).toMatch(/rank \d+ of \d+/);
      // It must not wear an alignment verdict of any kind.
      expect(discovery.meaning).not.toMatch(/strong fit|clear alignment|perfect match|great fit|strong match/i);
      // §4.1: the raw figure is still there beside the normalised one.
      if (discovery.rawAffinity !== undefined) {
        expect(discovery.meaning).toContain(String(discovery.rawAffinity));
      }
      // An unresolved scale means an uninterpreted number, never a percentage.
      if (!discovery.scaleResolved) {
        expect(discovery.meaning).toMatch(/does not document|uninterpreted/i);
      }
      // Whatever the discovery block says, the position it reports is a separate
      // field from the intersection's strength: the two are never collapsed into one
      // number, so a reader can see a rank without reading it as a measurement.
      expect(typeof discovery.normalisedPosition).toBe("number");
      expect(discovery).not.toHaveProperty("strength");
    }
  });

  it("explains every diagnostic in plain language, and keeps §11's four distinctions apart", () => {
    // All three closed families are covered, so no code can reach a creator as a
    // bare snake_case key. The count is asserted as well as the coverage: adding a
    // code without writing its consequence is a compile error, and this is the
    // runtime counterpart that fails if a family is emptied or silently merged.
    const families = [
      ...Object.keys(OBSERVATION_CONSEQUENCE),
      ...Object.keys(PROVIDER_ERROR_CONSEQUENCE),
      ...Object.keys(PIPELINE_FAILURE_CONSEQUENCE),
    ];
    expect(families).toHaveLength(35);
    expect(new Set(families).size, "one code appears in two families, so the merge loses one").toBe(families.length);

    for (const code of families) {
      const sentence = explainObservation(code);
      expect(sentence, `${code} is explained as itself`).not.toBe(code);
      expect(sentence.length, `${code} is too short to be a consequence`).toBeGreaterThan(60);
      // The key must not leak into the prose it is supposed to replace.
      if (code.includes("_")) {
        expect(sentence, `${code} leaks its own key into the sentence`).not.toContain(code);
      }
    }

    // Distinction 1 — a provider that failed is not a catalogue that had nothing.
    const malformed = explainObservation("malformed_response");
    expect(malformed).toMatch(/did not match the documented format/);
    expect(malformed).toMatch(/failure to read an answer rather than the absence of one/);
    expect(explainObservation("timeout")).toMatch(/did not answer in time/);
    expect(explainObservation("not_found")).toMatch(/no entry matching/);
    expect(malformed).not.toBe(explainObservation("not_found"));
    // §11: "avoid claiming that a result is complete if a relevant source failed."
    expect(malformed).toMatch(/should not be read as having seen everything/);
    expect(explainObservation("items_rejected")).toMatch(/not be read as having seen everything/);

    // Distinction 2 — insufficient evidence is not no overlap. Pinned at the level
    // of the states, since that is where the collapse actually happened.
    expect(OVERLAP_STATE_LABEL.no_overlap).not.toBe(OVERLAP_STATE_LABEL.insufficient_evidence);

    // Distinction 3 — a relative discovery rank is not cultural compatibility.
    expect(explainObservation("affinity_absent")).toMatch(/order carries no meaning/);
    expect(explainObservation("scores_clustered")).toMatch(/not a ranking/);

    // Distinction 4 — a missing check is not a passed one, and a missing result is
    // not a substituted one.
    expect(explainObservation("ignore_check_unavailable")).toMatch(/absent check, not a passed one/);
    expect(explainObservation("ignore_check_inconclusive")).toMatch(/not a clean result/);
    expect(explainObservation("brand_discovery_empty")).toMatch(/no static or curated list was substituted/);
    expect(explainObservation("brand_discovery_failed")).toMatch(/No fallback list was substituted/);

    // The fallback is a sentence rather than the code, so even a diagnostic this
    // build has no entry for cannot surface as a bare key.
    const unknown = explainObservation("a_code_no_closed_union_produces");
    expect(unknown).not.toBe("a_code_no_closed_union_produces");
    expect(unknown).toMatch(/no plain-language explanation/);
  });
});
