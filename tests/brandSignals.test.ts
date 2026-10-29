// @vitest-environment node
/**
 * Brand signals: where the candidates come from, and what the fit score is
 * allowed to claim about them.
 *
 * Two questions the audit could not settle by reading alone, so both are settled
 * here by execution:
 *
 *   1. Does the curated registry still control which brands are considered? It
 *      must not. Discovery is a single live `filter.type=urn:entity:brand` call
 *      and the registry may only ENRICH a brand Qloo already returned. A test
 *      that asserted "registry brands appear in the output" would pass under both
 *      designs, so the assertions below run the pipeline with an EMPTY registry
 *      and with a Qloo response the registry has never heard of, and require the
 *      scored set to be identical.
 *
 *   2. Does every dimension of the fit score describe evidence the calculation
 *      actually used? A dimension with no data must be omitted and the remaining
 *      weights renormalised — never defaulted to 0.5, and never shown as a
 *      platform or geographic match when no platform or country was compared.
 *
 * The provider is live-mode for brand discovery only and delegates everything
 * else to the synthetic engine, so the analysis stays renderable and the
 * silent-ignore canary still passes. Nothing here spends live quota and no key
 * is read: the wire payloads are built locally and injected at the provider seam.
 */

import { describe, expect, it } from "vitest";

import { brandEntityId } from "@/lib/contracts/brand";
import { collapseDuplicateTastes } from "@/lib/analysis/tasteDna";
import { getAllBrands } from "@/lib/data/brandRegistry";
import { archetypeProfile, FIXED_TIMESTAMP } from "@/lib/demo/archetypes";
import { runAnalysis, type PipelineOutcome } from "@/lib/analysis/pipeline";
import { mapEntityResultSet } from "@/lib/providers/qloo/mapper";
import { buildInsightsParams, DEFAULT_FILTER_TAGS_OPERATOR } from "@/lib/providers/qloo/requests";
import { SyntheticProvider } from "@/lib/providers/synthetic/provider";
import { contentCompatibilityEvidence, geographicFitEvidence } from "@/lib/scoring/dimensions";

import type { CreatorProfile } from "@/lib/contracts/creator";
import type { DataSource, ScoredTasteTag } from "@/lib/contracts/domain";
import type { QlooEntityResult } from "@/lib/contracts/qloo";
import type { CulturalIntelligenceProvider, RecommendRequest } from "@/lib/providers/provider";
import type { ScoreComponent, ScoreDimension } from "@/lib/contracts/viewModels";

const brands = getAllBrands();
type Registry = typeof brands;

const LIVE_SOURCE: DataSource = {
  mode: "live",
  providerId: "qloo",
  label: "Live Qloo data",
  isIllustrative: false,
};

const BASE_PROFILE = archetypeProfile("electronic");

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface WireEntry {
  id: string;
  name: string;
  affinity: number;
  industries?: string[];
  description?: string;
  signalId?: string;
  /** Wire `properties.geocode.city` — the only field that becomes a brand region. */
  region?: string;
  /** Wire `tags[].id`, the descriptors `contentCompatibilityEvidence` reads. */
  tagIds?: string[];
}

function brandWire(entries: WireEntry[]): QlooEntityResult[] {
  return entries.map((entry) => ({
    name: entry.name,
    entity_id: entry.id,
    type: "urn:entity:brand",
    subtype: "urn:entity:brand",
    properties: {
      description: entry.description ?? `${entry.name} brand.`,
      industries: entry.industries,
      geocode: entry.region === undefined ? undefined : { city: entry.region },
    },
    tags: entry.tagIds?.map((id) => ({ id })),
    query: {
      affinity: entry.affinity,
      explainability: entry.signalId
        ? { "signal.interests.entities": [{ entity_id: entry.signalId, score: 0.8 }] }
        : undefined,
    },
    // Cast through unknown: the wire schemas are passthrough, and the nested
    // explainability key is intentionally not in the typed shape.
  })) as unknown as QlooEntityResult[];
}

function liveDiscoveryProvider(entities: QlooEntityResult[]): CulturalIntelligenceProvider {
  const base = new SyntheticProvider({ brands });
  return {
    id: "qloo",
    source: LIVE_SOURCE,
    capabilities: () => base.capabilities(),
    health: () => base.health(),
    search: (request) => base.search(request),
    recommendEntities: (request) =>
      request.filterType === "urn:entity:brand"
        ? Promise.resolve(mapEntityResultSet({ success: true, results: { entities } }, LIVE_SOURCE))
        : base.recommendEntities(request),
    scoreEntities: (request) => base.scoreEntities(request),
    recommendTags: (request) => base.recommendTags(request),
    scoreTags: (request) => base.scoreTags(request),
    demographics: (request) => base.demographics(request),
  };
}

function analyseWith(
  entities: QlooEntityResult[],
  options: { profile?: CreatorProfile; registry?: Registry } = {},
): Promise<PipelineOutcome> {
  return runAnalysis({
    profile: options.profile ?? BASE_PROFILE,
    provider: liveDiscoveryProvider(entities),
    // Injected rather than imported so the registry can be varied per test — the
    // whole point of the "registry does not select" group below.
    brands: options.registry ?? brands,
    resolveInterests: false,
    generatedAt: FIXED_TIMESTAMP,
  });
}

function profileWith(changes: Partial<CreatorProfile>): CreatorProfile {
  return { ...BASE_PROFILE, ...changes };
}

/**
 * The same provider, plus a record of every recommendation request the pipeline
 * actually built.
 *
 * `toSignalBlock` is module-private, so the only honest way to test the live
 * request shape is to intercept it at the seam and run it through the real
 * `buildInsightsParams`. Asserting on a hand-written request instead would test
 * the test.
 */
function recordingProvider(entities: QlooEntityResult[]): {
  provider: CulturalIntelligenceProvider;
  requests: RecommendRequest[];
} {
  const base = liveDiscoveryProvider(entities);
  const requests: RecommendRequest[] = [];
  return {
    requests,
    provider: {
      ...base,
      recommendEntities: (request) => {
        requests.push(request);
        return base.recommendEntities(request);
      },
    },
  };
}

async function captureBrandRequest(profile: CreatorProfile): Promise<RecommendRequest> {
  const { provider, requests } = recordingProvider(
    brandWire([{ id: "qloo-probe", name: "Probe Brand", affinity: 90 }]),
  );
  await runAnalysis({
    profile,
    provider,
    brands,
    resolveInterests: false,
    generatedAt: FIXED_TIMESTAMP,
  });
  const request = requests.find((entry) => entry.filterType === "urn:entity:brand");
  if (request === undefined) {
    throw new Error(
      `no brand discovery request was made. Requests: ${requests.map((r) => r.filterType).join(", ") || "(none)"}`,
    );
  }
  return request;
}

function componentOf(outcome: PipelineOutcome, brandId: string, dimension: ScoreDimension): ScoreComponent {
  const fit = outcome.analysis.brandFits.find((entry) => entry.brandId === brandId);
  if (fit === undefined) {
    throw new Error(
      `"${brandId}" was not scored. Scored: ${outcome.analysis.brandFits.map((f) => f.brandId).join(", ") || "(none)"}`,
    );
  }
  const component = fit.components.find((entry) => entry.dimension === dimension);
  if (component === undefined) throw new Error(`No ${dimension} component on "${brandId}"`);
  return component;
}

/** Sum of the weights actually applied. Must be 1 whenever anything was scored. */
function effectiveTotal(outcome: PipelineOutcome, brandId: string): number {
  const fit = outcome.analysis.brandFits.find((entry) => entry.brandId === brandId)!;
  return fit.components
    .filter((component) => component.available)
    .reduce((sum, component) => sum + component.effectiveWeight, 0);
}

/**
 * Tag ids the derived taste profile actually carries, so a wire brand can be given
 * a descriptor the creator's side genuinely uses.
 *
 * Read from a probe run rather than hardcoded, because the synthetic catalogue owns
 * the ids. This is what makes a test able to put a brand in the `verified_overlap`
 * state: taste fit and content compatibility are both gated on the four-way overlap
 * state now, so a brand with no comparable descriptors has both dimensions
 * UNAVAILABLE, not zero — which is correct, but means a test that wants to observe a
 * real cultural score has to supply one.
 */
async function sharedTagIds(count = 2): Promise<string[]> {
  const probe = await analyseWith(brandWire([]));
  const tagIds = probe.taste.allTags.slice(0, count).map((tag) => tag.tag.id);
  expect(tagIds.length, "the profile must derive at least one taste tag").toBeGreaterThan(0);
  return tagIds;
}

// ---------------------------------------------------------------------------
// Candidate discovery is Qloo's, not the registry's
// ---------------------------------------------------------------------------

describe("brand candidates come from the Qloo response", () => {
  const QLOO_ONLY = brandWire([
    { id: "qloo-only-audio", name: "Unlisted Audio Co", affinity: 95, industries: ["Audio"] },
    { id: "qloo-only-motoring", name: "Unlisted Motoring", affinity: 88, industries: ["Automotive"] },
  ]);

  it("scores exactly the brands Qloo returned and none of the curated ones", async () => {
    // The registry is non-empty in this run, so an output containing only the two
    // Qloo ids can only mean discovery drove the candidate list.
    expect(brands.length).toBeGreaterThan(0);

    const outcome = await analyseWith(QLOO_ONLY);
    const scored = outcome.analysis.brandFits.map((fit) => fit.brandId);

    expect([...scored].sort()).toEqual(["qloo-only-audio", "qloo-only-motoring"]);

    const registryIds = new Set(brands.map((brand) => brandEntityId(brand)));
    expect(
      scored.filter((id) => registryIds.has(id)),
      "a curated brand was injected as a candidate",
    ).toEqual([]);
  });

  it("scores the same brands when the registry is empty", async () => {
    // The strongest form of the claim: with no registry at all, discovery is
    // unchanged. If the registry seeded, filtered or capped candidates, this run
    // would score fewer brands than the one above.
    const withRegistry = await analyseWith(QLOO_ONLY);
    const withoutRegistry = await analyseWith(QLOO_ONLY, { registry: [] });

    expect(withoutRegistry.analysis.brandFits.map((fit) => fit.brandId).sort()).toEqual(
      withRegistry.analysis.brandFits.map((fit) => fit.brandId).sort(),
    );
    // And every one of them is flagged as discovered, because nothing enriched them.
    expect(withoutRegistry.analysis.opportunities.every((entry) => entry.discovered)).toBe(true);
  });

  it("keeps a Qloo brand eligible when the registry has no entry for it", async () => {
    const outcome = await analyseWith(QLOO_ONLY);
    const audio = outcome.analysis.opportunities.find((entry) => entry.brandId === "qloo-only-audio");

    expect(audio, "a registry-absent brand must still be scored").toBeDefined();
    expect(audio?.discovered).toBe(true);
    // No partnership route is invented for a brand the registry does not carry.
    expect(audio?.partnership.available).toBe(false);
    expect(audio?.partnership.verificationNote?.length ?? 0).toBeGreaterThan(0);
  });

  it("reports the brand stage as done, not skipped, when the call succeeded", async () => {
    const statuses: Array<{ id: string; status: string }> = [];
    await runAnalysis({
      profile: BASE_PROFILE,
      provider: liveDiscoveryProvider(QLOO_ONLY),
      brands,
      resolveInterests: false,
      generatedAt: FIXED_TIMESTAMP,
      onStage: (event) => statuses.push({ id: event.id, status: event.status }),
    });

    const brands_ = statuses.filter((entry) => entry.id === "brands").map((entry) => entry.status);
    expect(brands_).toEqual(["start", "done"]);
  });
});

// ---------------------------------------------------------------------------
// Qloo returns zero brands
// ---------------------------------------------------------------------------

describe("Qloo returning zero brands", () => {
  it("leaves the brand section empty rather than substituting a static list", async () => {
    const outcome = await analyseWith(brandWire([]));

    expect(outcome.analysis.brandFits).toEqual([]);
    expect(outcome.analysis.opportunities).toEqual([]);
    // The curated registry is still in memory and still non-empty; an empty brand
    // list therefore proves it was not used as a fallback.
    expect(brands.length).toBeGreaterThan(0);
  });

  it("says so in the failures panel and keeps the run recoverable", async () => {
    const outcome = await analyseWith(brandWire([]));
    const failure = outcome.failures.find((entry) => entry.code === "brand_discovery_empty");

    expect(failure, "an empty brand discovery must be reported").toBeDefined();
    expect(failure!.recoverable, "empty is not a hard failure").toBe(true);
    expect(failure!.message).toContain("No static or curated list was substituted");
  });

  it("still returns a renderable analysis, because zero brands is not a failed run", async () => {
    const outcome = await analyseWith(brandWire([]));

    expect(outcome.hasSignals).toBe(true);
    expect(outcome.renderable).toBe(true);
    // The taste profile stands on its own; only the brand section is empty.
    expect(outcome.analysis.tasteDna.coreTastes.length).toBeGreaterThan(0);
  });

  it("reports the brand stage as done when the call returned an empty set", async () => {
    // `skipped` would imply the call never happened. It did happen and answered
    // with nothing, which is a different fact and the one the creator needs.
    const statuses: string[] = [];
    await runAnalysis({
      profile: BASE_PROFILE,
      provider: liveDiscoveryProvider(brandWire([])),
      brands,
      resolveInterests: false,
      generatedAt: FIXED_TIMESTAMP,
      onStage: (event) => {
        if (event.id === "brands") statuses.push(event.status);
      },
    });
    expect(statuses).toEqual(["start", "done"]);
  });
});

// ---------------------------------------------------------------------------
// Geographic fit
// ---------------------------------------------------------------------------

describe("geographic fit uses the supported country field", () => {
  it("is omitted when the creator gave no location at all", () => {
    const evidence = geographicFitEvidence(undefined, "Germany", undefined);
    expect(evidence.value).toBeUndefined();
    expect(evidence.unavailableReason).toContain("did not provide a location");
    expect(evidence.unavailableReason).toContain("optional");
  });

  it("is omitted when the location is a city rather than a country", () => {
    // Doc 03 §10 lists no country signal parameter, and a free-text locality is
    // not comparable to a brand's region, so no partial-credit model is applied.
    const evidence = geographicFitEvidence(undefined, "Germany", { city: "Berlin", query: "Berlin" });
    expect(evidence.value).toBeUndefined();
    expect(evidence.unavailableReason).toContain("not given as a country");
  });

  it("is omitted when the data source returned no region for the brand", () => {
    const evidence = geographicFitEvidence(undefined, undefined, { country: "Germany" });
    expect(evidence.value).toBeUndefined();
    expect(evidence.unavailableReason).toContain("no region");
  });

  it("scores an exact country match as 1 and a mismatch as 0", () => {
    const match = geographicFitEvidence(undefined, "Germany", { country: "Germany" });
    const miss = geographicFitEvidence(undefined, "Berlin", { country: "Germany" });

    expect(match.value).toBe(1);
    expect(miss.value).toBe(0);
    // Binary by design, and the basis discloses both sides of the comparison
    // rather than presenting the number as a measured affinity.
    expect(match.basis).toContain("Binary by design");
    expect(match.basis).toContain("Germany");
  });

  it("is unavailable end to end when the creator's country is missing", async () => {
    const wire = brandWire([{ id: "qloo-geo", name: "Geo Brand", affinity: 90, region: "Berlin" }]);

    const withCountry = await analyseWith(wire, {
      profile: profileWith({ location: { query: "Berlin", city: "Berlin", country: "Germany" } }),
    });
    const withoutCountry = await analyseWith(wire, {
      profile: profileWith({ location: { query: "Berlin", city: "Berlin" } }),
    });
    const noLocation = await analyseWith(wire, { profile: profileWith({ location: undefined }) });

    expect(componentOf(withCountry, "qloo-geo", "geographic").available).toBe(true);
    expect(componentOf(withoutCountry, "qloo-geo", "geographic").available).toBe(false);
    expect(componentOf(noLocation, "qloo-geo", "geographic").available).toBe(false);
    expect(componentOf(noLocation, "qloo-geo", "geographic").effectiveWeight).toBe(0);
  });

  it("renormalises the remaining weights instead of leaving a hole", async () => {
    // The brand carries descriptors the creator's own taste profile uses, so taste
    // fit is AVAILABLE in both runs. That matters: taste fit is gated on the overlap
    // state now, and a descriptor-less brand has it unavailable — which would make
    // both effective weights below 0 and this test would be comparing two holes
    // instead of watching a weight move between them.
    const tagIds = await sharedTagIds();
    const wire = brandWire([
      { id: "qloo-geo", name: "Geo Brand", affinity: 90, region: "Berlin", tagIds },
    ]);

    const withCountry = await analyseWith(wire, {
      profile: profileWith({ location: { query: "Berlin", city: "Berlin", country: "Germany" } }),
    });
    const withoutCountry = await analyseWith(wire, {
      profile: profileWith({ location: { query: "Berlin", city: "Berlin" } }),
    });

    // The applied weights still sum to 1 in both runs — an omitted dimension is
    // redistributed, never left as a zero that drags the overall score down.
    expect(effectiveTotal(withCountry, "qloo-geo")).toBeCloseTo(1, 3);
    expect(effectiveTotal(withoutCountry, "qloo-geo")).toBeCloseTo(1, 3);

    // The 10% the geographic dimension carried moved onto the others.
    const tasteWith = componentOf(withCountry, "qloo-geo", "taste_fit").effectiveWeight;
    const tasteWithout = componentOf(withoutCountry, "qloo-geo", "taste_fit").effectiveWeight;
    expect(tasteWith, "taste fit must be scored for this test to measure a shift").toBeGreaterThan(0);
    expect(tasteWithout).toBeGreaterThan(tasteWith);

    // And the disclosure names what was excluded and why, so the reduced coverage
    // is visible rather than buried in the arithmetic.
    const disclosure = withoutCountry.analysis.brandFits.find((f) => f.brandId === "qloo-geo")!.overall.disclosure;
    expect(disclosure).toContain("Geographic fit");
    expect(disclosure).toContain("not set to a default");
  });
});

// ---------------------------------------------------------------------------
// Platform / content compatibility
// ---------------------------------------------------------------------------

describe("no platform score is claimed", () => {
  /**
   * A brand carrying descriptors the creator's own taste tags actually use, so
   * `content_compatibility` is AVAILABLE and the assertions below compare two real
   * numbers rather than two `undefined`s. The tag ids come from `sharedTagIds`,
   * which reads them off a probe run rather than hardcoding them.
   */
  async function sharedDescriptorBrand(): Promise<QlooEntityResult[]> {
    return brandWire([
      { id: "qloo-content", name: "Shared Descriptor Co", affinity: 90, tagIds: await sharedTagIds() },
    ]);
  }

  it("does not change when the creator's platforms change", async () => {
    const wire = await sharedDescriptorBrand();

    const one = await analyseWith(wire, { profile: profileWith({ platforms: ["youtube"] }) });
    const other = await analyseWith(wire, {
      profile: profileWith({ platforms: ["podcast", "newsletter", "tiktok"] }),
    });

    const a = componentOf(one, "qloo-content", "content_compatibility");
    const b = componentOf(other, "qloo-content", "content_compatibility");

    expect(a.available, "the dimension should be computable from descriptors alone").toBe(true);
    expect(a.value).toBe(b.value);
    expect(a.effectiveWeight).toBe(b.effectiveWeight);
    // Platforms are not an input to any dimension, so the overall cannot move either.
    expect(
      one.analysis.brandFits.find((f) => f.brandId === "qloo-content")!.overall.value,
    ).toBe(other.analysis.brandFits.find((f) => f.brandId === "qloo-content")!.overall.value);
  });

  it("never labels or describes the dimension as a platform match", async () => {
    const wire = await sharedDescriptorBrand();
    const outcome = await analyseWith(wire);
    const component = componentOf(outcome, "qloo-content", "content_compatibility");

    expect(component.label).not.toMatch(/platform/i);
    // The disclosure sits next to the bar it qualifies, so the number cannot be
    // read as a platform match by a creator who never scrolls to the methodology.
    expect(component.basis).toMatch(/platform selection is NOT used/i);
    expect(component.basis).toMatch(/no platform-compatibility score is computed/i);
  });

  it("says why it could not be computed when the brand carried no descriptors", () => {
    const evidence = contentCompatibilityEvidence(undefined, [
      scoredTag("urn:tag:genre:electronic:qloo", "Electronic", 0.5, 2),
    ]);
    expect(evidence.value).toBeUndefined();
    expect(evidence.unavailableReason).toContain("no descriptors");
    // The basis is still the full method, so an omitted dimension explains itself.
    expect(evidence.basis).toMatch(/platform selection is NOT used/i);
  });

  it("says why it could not be computed when the creator has no taste tags", () => {
    const evidence = contentCompatibilityEvidence(undefined, []);
    expect(evidence.value).toBeUndefined();
    expect(evidence.unavailableReason).toContain("No taste tags");
  });
});

function scoredTag(id: string, name: string, score: number, support: number): ScoredTasteTag {
  return {
    tag: { id, name, namespace: "urn:tag:genre", provenance: "qloo" },
    score,
    support,
    contributedBy: [],
    provenance: "qloo",
  };
}

// ---------------------------------------------------------------------------
// Duplicate taste tags
// ---------------------------------------------------------------------------

describe("repeated taste tags", () => {
  it("collapses the same word arriving from two namespaces into one entry", () => {
    // Aggregation is keyed by tag id, and Qloo carries one surface word in several
    // namespaces. Both survive that pass, so the taste list showed "Rock" twice
    // with two different scores and wasted two of the handful of slots allowed.
    const collapsed = collapseDuplicateTastes([
      scoredTag("urn:tag:genre:rock:qloo", "Rock", 0.3, 4),
      scoredTag("urn:tag:genre:rock:musicbrainz", "Rock", 0.2, 3),
    ]);

    expect(collapsed).toHaveLength(1);
    expect(collapsed[0]!.tag.name).toBe("Rock");
    // Scores are already fractions of total weight, so summing keeps the list
    // summing to 1 without a second normalisation pass.
    expect(collapsed[0]!.score).toBeCloseTo(0.5, 6);
  });

  it("keeps the stronger evidence as the representative", () => {
    const collapsed = collapseDuplicateTastes([
      scoredTag("urn:tag:genre:rock:weak", "Rock", 0.1, 2),
      { ...scoredTag("urn:tag:genre:rock:strong", "Rock", 0.4, 5), provenance: "derived" as const },
    ]);

    expect(collapsed).toHaveLength(1);
    expect(collapsed[0]!.tag.id).toBe("urn:tag:genre:rock:strong");
    expect(collapsed[0]!.provenance).toBe("derived");
  });

  it("treats differently-cased surface forms as the same tag", () => {
    const collapsed = collapseDuplicateTastes([
      scoredTag("urn:tag:a", "dream pop", 0.2, 2),
      scoredTag("urn:tag:b", "Dream Pop", 0.1, 2),
    ]);
    expect(collapsed).toHaveLength(1);
  });

  it("never merges two tags that only look alike", () => {
    const collapsed = collapseDuplicateTastes([
      scoredTag("urn:tag:a", "Rock", 0.2, 2),
      scoredTag("urn:tag:b", "Rocksteady", 0.1, 2),
    ]);
    expect(collapsed).toHaveLength(2);
  });

  it("keeps a nameless tag distinct instead of inventing a name for it", () => {
    const collapsed = collapseDuplicateTastes([
      scoredTag("urn:tag:a", "", 0.2, 2),
      scoredTag("urn:tag:b", "", 0.1, 2),
    ]);
    expect(collapsed).toHaveLength(2);
  });

  it("surfaces no repeated label in the creator's own core tastes", async () => {
    const outcome = await analyseWith(
      brandWire([{ id: "qloo-tags", name: "Tag Brand", affinity: 90 }]),
    );
    const names = outcome.analysis.tasteDna.coreTastes.map((tag) => tag.tag.name.trim().toLowerCase());

    expect(names.length, "the profile should derive core tastes").toBeGreaterThan(0);
    expect(new Set(names).size, `repeated taste tag: ${names.join(", ")}`).toBe(names.length);
  });
});

// ---------------------------------------------------------------------------
// A category is not an unexpected affinity
// ---------------------------------------------------------------------------

describe("unexpected affinities", () => {
  it("never presents a derived category as its own unexpected affinity", async () => {
    const outcome = await analyseWith(
      brandWire([{ id: "qloo-affinity", name: "Affinity Brand", affinity: 90 }]),
    );
    const { categories, unexpectedAffinities } = outcome.analysis.tasteDna;

    const categoryLabels = new Set(categories.map((category) => category.label.trim().toLowerCase()));
    const categoryIds = new Set(categories.map((category) => category.id));

    for (const affinity of unexpectedAffinities) {
      expect(
        categoryLabels.has(affinity.label.trim().toLowerCase()),
        `"${affinity.label}" is a category, not an unexpected affinity`,
      ).toBe(false);
      expect(categoryIds.has(affinity.id)).toBe(false);
    }
  });

  it("gives every unexpected affinity a reason rather than a bare score", async () => {
    const outcome = await analyseWith(
      brandWire([{ id: "qloo-affinity", name: "Affinity Brand", affinity: 90 }]),
    );
    for (const affinity of outcome.analysis.tasteDna.unexpectedAffinities) {
      expect(affinity.reasons.length, `"${affinity.label}" has no stated reason`).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// The live request respects the documented contract
// ---------------------------------------------------------------------------

describe("the brand discovery request (doc 03)", () => {
  it("asks for brands using the creator's confirmed entities as signals", async () => {
    const request = await captureBrandRequest(BASE_PROFILE);
    const built = buildInsightsParams(request);

    expect(built.params["filter.type"]).toBe("urn:entity:brand");

    const sent = (built.params["signal.interests.entities"] ?? "").split(",").filter(Boolean);
    const declared = BASE_PROFILE.selectedInterests
      .map((interest) => interest.entityId)
      .filter((id): id is string => id !== undefined);
    expect(sent.length, "discovery must be driven by the confirmed signals").toBeGreaterThan(0);
    // Discovery is taste-LED, not taste-REPLACED. Every confirmed entity is still
    // sent: dropping one would narrow the search without the creator ever seeing
    // that happen, and the expansion is allowed to ADD ground, never to substitute
    // its own idea of what they meant.
    for (const id of declared) {
      expect(sent, `a confirmed entity was dropped from discovery: ${id}`).toContain(id);
    }
  });

  it("adds the strongest expanded taste signals, and keeps the request bounded", async () => {
    // Discovery now runs AFTER the Creator Taste DNA is assembled, which is the only
    // reason it can be driven by the expanded cultural profile rather than by the
    // handful of things the creator typed. This is the assertion that the reordering
    // actually bought something.
    const { provider, requests } = recordingProvider(
      brandWire([{ id: "qloo-probe", name: "Probe Brand", affinity: 90 }]),
    );
    const outcome = await runAnalysis({
      profile: BASE_PROFILE,
      provider,
      brands,
      resolveInterests: false,
      generatedAt: FIXED_TIMESTAMP,
    });

    const request = requests.find((entry) => entry.filterType === "urn:entity:brand");
    expect(request, "brand discovery must still run").toBeDefined();

    const declared = BASE_PROFILE.selectedInterests
      .map((interest) => interest.entityId)
      .filter((id): id is string => id !== undefined);
    const sent = request!.signals.entityIds;

    if (outcome.taste.pool.length > 0 && declared.length < 8) {
      expect(
        sent.length,
        "discovery ignored the expanded taste profile and used the raw input only",
      ).toBeGreaterThan(declared.length);
    }
    // Bounded, so the request cannot grow with how chatty the catalogue was and the
    // declared intent cannot be diluted past recognition.
    expect(sent.length).toBeLessThanOrEqual(8);
    expect(new Set(sent).size, "a signal was sent twice").toBe(sent.length);
  });

  it("sends nothing the API would silently ignore", async () => {
    // Doc 03 §11: an unsupported parameter is dropped by Qloo without an error, so
    // the response comes back 200 and wrong. The allow-list exists to make that
    // impossible, and a `Dropped` warning on a request the pipeline itself built
    // would mean the two have drifted apart.
    const built = buildInsightsParams(await captureBrandRequest(BASE_PROFILE));
    expect(built.warnings.filter((warning) => warning.detail.startsWith("Dropped"))).toEqual([]);
  });

  it("never turns a creator's country into a location signal", async () => {
    // `SignalBlock.location` has no country field at all, and `toSignalBlock`
    // omits the location entirely when only a country was given. Doc 03 §10 lists
    // no country parameter, and §7 makes a `signal.location.query` that matches no
    // locality a 400 — which would take the whole insights call down with it.
    const request = await captureBrandRequest(profileWith({ location: { country: "Germany" } }));

    expect(request.signals.location).toBeUndefined();

    const built = buildInsightsParams(request);
    expect(Object.keys(built.params).filter((key) => key.startsWith("signal.location"))).toEqual([]);
    expect(JSON.stringify(built.params)).not.toContain("Germany");
  });

  it("carries no credential in the parameters or the cache key", async () => {
    // The key travels in an `X-Api-Key` header set by the client. If it ever
    // reached the parameter set it would also reach `cacheKeyFor`, and from there
    // a log line or a debug panel.
    const built = buildInsightsParams(await captureBrandRequest(BASE_PROFILE));
    const suspicious = /key|token|secret|auth/i;

    expect(Object.keys(built.params).filter((key) => suspicious.test(key))).toEqual([]);
    expect(suspicious.test(built.cacheKey)).toBe(false);
  });

  it("warns instead of sending a request the API would reject with 400", () => {
    // Doc 03 §4: `filter.type` plus at least one valid signal or filter. This is
    // the shape a no-signals run would produce, and the pipeline never sends it —
    // but the builder must say so rather than emit a request doomed to fail.
    const built = buildInsightsParams({
      filterType: "urn:entity:brand",
      signals: { entityIds: [] },
    });

    expect(built.warnings.some((warning) => warning.detail.includes("at least one valid signal"))).toBe(
      true,
    );
  });

  it("never sends a tag parameter whose operator was left implicit", () => {
    // Doc 03 §16: `operator.filter.tags` defaults to union but
    // `operator.signal.interests.tags` defaults to intersection, so an operator left
    // to its default is how a request silently returns an empty set. The invariant
    // that matters is therefore not "the operator is present" but "nothing
    // tag-shaped goes out unless its operator either went with it or was dropped
    // and recorded". `operator.signal.interests.tags` is on no per-type allow-list,
    // so the honest outcome for it today is a warning rather than a parameter.
    const built = buildInsightsParams({
      filterType: "urn:entity:brand",
      signals: { entityIds: ["urn:entity:artist:1"], tagIds: ["urn:tag:genre:electronic"] },
      filterTagIds: ["urn:tag:genre:electronic"],
    });

    expect(built.params["filter.tags"]).toBeDefined();
    expect(built.params["operator.filter.tags"]).toBe(DEFAULT_FILTER_TAGS_OPERATOR);

    const dropped = built.warnings.filter(
      (warning) => warning.param === "operator.signal.interests.tags",
    );
    expect(
      built.params["operator.signal.interests.tags"] !== undefined || dropped.length > 0,
      "an operator was neither sent nor recorded as dropped",
    ).toBe(true);
  });
});
