import { describe, expect, it, vi } from "vitest";

import { runAnalysis, analysisCacheKey, type PipelineOutcome } from "@/lib/analysis/pipeline";
import {
  PIPELINE_STAGES,
  applyStageEvent,
  initialStageProgress,
  isStageProgressSettled,
  type StageEvent,
} from "@/lib/analysis/stages";
import { getAllBrands } from "@/lib/data/brandRegistry";
import {
  FORBIDDEN_PATTERNS,
  assertHonestCopy,
  describeBrandFitForKit,
  describeBrandOpportunity,
  describeCoreTaste,
  draftPitch,
  findHonestyViolations,
  proposeCollaboration,
  sourceVoice,
} from "@/lib/copy/generate";
import { SyntheticProvider } from "@/lib/providers/synthetic/provider";
import { mapEntityResultSet } from "@/lib/providers/qloo/mapper";
import { NOT_ENOUGH_EVIDENCE_LABEL } from "@/lib/scoring/brandFit";
import type { CulturalIntelligenceProvider } from "@/lib/providers/provider";
import type { DataSource } from "@/lib/contracts/domain";
import type { QlooEntityResult } from "@/lib/contracts/qloo";
import type { CreatorProfile, AudienceWords, ContentDna } from "@/lib/contracts/creator";
// The archetypes live under `src/lib/demo` because the public site renders the
// same five creators as its worked examples. One module, two callers — see the
// header comment there for why that is deliberate.
import {
  FIXED_TIMESTAMP,
  allArchetypeProfiles,
  emptyProfile,
  archetypeProfile,
} from "@/lib/demo/archetypes";

/**
 * End-to-end tests for the analysis pipeline.
 *
 * These run the REAL pipeline against the REAL synthetic provider — no mocks in
 * the scoring path — because the property worth testing is that the stages
 * compose correctly, not that each one works in isolation (the unit tests cover
 * that). The synthetic provider is used because there is no API key, and every
 * assertion about provenance below exists to prove the output cannot be mistaken
 * for a Qloo discovery.
 */

const brands = getAllBrands();

function makeProvider(options: { simulateSilentIgnore?: boolean } = {}): SyntheticProvider {
  return new SyntheticProvider({ brands, ...options });
}

async function analyse(
  profile: CreatorProfile,
  provider = makeProvider(),
): Promise<PipelineOutcome> {
  return runAnalysis({
    profile,
    provider,
    brands,
    resolveInterests: false,
    generatedAt: FIXED_TIMESTAMP,
  });
}

/** Run every archetype once. Done in a single pass so the suite stays fast. */
async function analyseAll(): Promise<Array<{ id: string; outcome: PipelineOutcome }>> {
  const results: Array<{ id: string; outcome: PipelineOutcome }> = [];
  for (const { id, profile } of allArchetypeProfiles()) {
    results.push({ id, outcome: await analyse(profile) });
  }
  return results;
}

describe("analysis pipeline", () => {
  it("produces a renderable analysis for every archetype", async () => {
    const results = await analyseAll();

    expect(results).toHaveLength(5);
    for (const { id, outcome } of results) {
      expect(outcome.hasSignals, `${id} should have resolved signals`).toBe(true);
      expect(outcome.taste.pool.length, `${id} should have discovered entities`).toBeGreaterThan(0);
      expect(outcome.taste.renderable, `${id} should be renderable`).toBe(true);
      expect(outcome.analysis.fallbackLevel, `${id} must not hard-fail`).not.toBe("L4");
    }
  });

  it("populates all six visualisation view-models", async () => {
    const { analysis } = await analyse(archetypeProfile("streetwear"));

    expect(analysis.network.viz).toBe("taste-dna-network");
    expect(analysis.affinityRanking.viz).toBe("cultural-affinity-ranking");
    expect(analysis.opportunityGap.viz).toBe("opportunity-gap");
    expect(analysis.brandMap.viz).toBe("culture-to-brand-map");
    expect(analysis.fingerprint.viz).toBe("taste-fingerprint");
    expect(analysis.brandFits.length).toBeGreaterThan(0);
    expect(analysis.brandFits.every((fit) => fit.viz === "brand-fit-breakdown")).toBe(true);

    // The network must actually connect things, not scatter isolated nodes.
    expect(analysis.network.nodes.length).toBeGreaterThan(0);
    expect(analysis.network.edges.length).toBeGreaterThan(0);
  });

  it("is deterministic: the same profile yields byte-identical output", async () => {
    const profile = archetypeProfile("food");
    const first = await analyse(profile);
    const second = await analyse(profile);

    // `generatedAt` is pinned by the fixture, so any difference is a real
    // non-determinism bug rather than a clock artefact.
    expect(JSON.stringify(first.analysis)).toBe(JSON.stringify(second.analysis));
  });
});

describe("distinctness (the property that catches a do-nothing engine)", () => {
  it("gives every archetype a different fingerprint signature", async () => {
    const results = await analyseAll();
    const signatures = results.map(({ outcome }) => outcome.analysis.fingerprint.signature);

    expect(new Set(signatures).size, "fingerprints collided").toBe(signatures.length);
    // Doc 05 §10F: a signature must be non-empty to drive geometry at all.
    expect(signatures.every((signature) => signature.length > 0)).toBe(true);
  });

  it("gives different archetypes different top core tastes", async () => {
    const results = await analyseAll();
    const topTastes = results.map(({ outcome }) =>
      outcome.analysis.tasteDna.coreTastes.slice(0, 3).map((tag) => tag.tag.id),
    );

    // Not every pair has to differ in its top three, but if ALL five are the same
    // the engine is ignoring its inputs.
    const distinct = new Set(topTastes.map((tastes) => tastes.join("|")));
    expect(distinct.size, "all archetypes produced identical top tastes").toBeGreaterThan(1);
  });

  it("gives different archetypes different discovered entities", async () => {
    const results = await analyseAll();
    const discovered = results.map(({ outcome }) =>
      outcome.analysis.tasteDna.discovered
        .slice(0, 5)
        .map((entry) => entry.id)
        .join("|"),
    );

    expect(new Set(discovered).size, "all archetypes got the same recommendations").toBeGreaterThan(1);
  });

  it("ranks brands differently for different archetypes", async () => {
    const results = await analyseAll();
    const orderings = results.map(({ outcome }) =>
      outcome.analysis.opportunities
        .slice(0, 5)
        .map((opportunity) => opportunity.brandId)
        .join("|"),
    );

    expect(new Set(orderings).size, "brand ranking ignored the creator's taste").toBeGreaterThan(1);
  });
});

describe("provenance honesty (execution decision 3)", () => {
  it("marks every analysis as illustrative when using the synthetic provider", async () => {
    const { analysis } = await analyse(archetypeProfile("gaming"));

    expect(analysis.source.isIllustrative).toBe(true);
    expect(analysis.source.mode).toBe("synthetic");
    expect(analysis.network.meta.containsSynthetic).toBe(true);
    expect(analysis.affinityRanking.meta.containsSynthetic).toBe(true);
  });

  it("never claims Qloo-sourced evidence from synthetic explainability", async () => {
    const { analysis } = await analyse(archetypeProfile("electronic"));

    // `synthetic` explainability is produced by our own dev provider. Presenting
    // it as a Qloo explanation is the exact failure execution decision 3 forbids.
    for (const pathway of analysis.brandMap.pathways) {
      expect(pathway.evidenceIsQlooSourced).toBe(false);
    }
    expect(analysis.brandMap.fallbackNotice).toBeTruthy();
  });

  it("generates copy that passes every honesty guard", async () => {
    const results = await analyseAll();
    const strings: string[] = [];
    let withSharedTaste = 0;
    let directMatches = 0;
    let adjacentMatches = 0;

    for (const { outcome } of results) {
      for (const fit of outcome.analysis.brandFits) strings.push(...fit.rationale);
      strings.push(...outcome.analysis.tasteDna.unexpectedAffinities.flatMap((u) => u.reasons));
      strings.push(outcome.analysis.opportunityGap.coverageMethodology);
      for (const observation of outcome.analysis.observations) strings.push(observation.detail);

      // The two brand-copy builders are called at render time and store nothing on
      // the analysis, so without this loop no test in the suite ever reads their
      // output. They produce the sentences a creator pastes into an email and a
      // brand then reads, and both now lead with the cultural intersection — which
      // makes them the costliest place in the product for an overclaim to slip
      // through. Guarded here rather than left to the components that call them.
      const voice = sourceVoice(outcome.analysis.source);
      for (const opportunity of outcome.analysis.opportunities) {
        if ((opportunity.intersection?.shared.length ?? 0) > 0) withSharedTaste += 1;
        if (opportunity.intersection?.kind === "direct") directMatches += 1;
        if (opportunity.intersection?.kind === "adjacent") adjacentMatches += 1;
        const why = describeBrandOpportunity(opportunity, voice);
        strings.push(why.hypothesis, why.caveat, ...why.because);
        const note = describeBrandFitForKit(opportunity, "Test Creator", voice);
        strings.push(note.line, note.caveat, ...note.because);
      }
    }

    expect(strings.length).toBeGreaterThan(0);
    // Non-vacuity, asserted for the same reason the forbidden-pattern list tests
    // itself below: if no brand in any archetype run shared a single taste with its
    // creator, every intersection-led sentence above would take its empty branch and
    // this guard would pass while never reading the copy that matters most.
    expect(withSharedTaste, "no brand produced a shared taste in any run").toBeGreaterThan(0);
    // Doc 05 §10 makes direct-vs-adjacent the distinction that tells a creator
    // whether a brand sits in their own niche or was reached across a cultural
    // bridge. Both were unobservable for the same reason the guard above exists:
    // a `direct` match needs a shared taste traced back to an entity the creator
    // CONFIRMED, and confirmed entities never entered the taste pool — so every
    // match in every run classified as adjacent, and the direct branch of every
    // intersection-led sentence was dead code that still looked covered.
    //
    // Adjacent is asserted too, in the other direction. Without it a future change
    // could make everything direct by widening what counts as confirmed, and the
    // "interesting discovery" case §10 calls one of the core reasons the cultural
    // graph is worth having would quietly disappear from the product.
    expect(directMatches, "no brand matched a creator's own confirmed interest").toBeGreaterThan(0);
    expect(adjacentMatches, "every match traced to a confirmed interest; none was reached across a bridge").toBeGreaterThan(0);
    for (const text of strings) {
      expect(findHonestyViolations(text), `honesty violation in: ${text}`).toEqual([]);
    }
  });

  it("keeps the forbidden-pattern list itself meaningful", () => {
    // A guard that matches nothing is worse than no guard: it reads as coverage.
    expect(FORBIDDEN_PATTERNS.length).toBeGreaterThanOrEqual(5);
    expect(findHonestyViolations("12% of people love this brand")).not.toEqual([]);
    expect(findHonestyViolations("your followers love sustainable gear")).not.toEqual([]);
    expect(findHonestyViolations("This is the best match for you")).not.toEqual([]);
    expect(findHonestyViolations("Neutral, factual description of a result set.")).toEqual([]);
  });
});

describe("brand-specific pitch draft (Phase C)", () => {
  // The rework must make two brands read differently. `draftPitch` seeds the
  // subject/opening/closing on a hash of the brand id and derives the body from
  // that brand's own drivers, pathway and strongest dimension. A do-nothing
  // template — one that merely swaps the brand name into identical prose — fails
  // the name-stripped comparison below, which is the whole point of the rework.
  function pitchFor(
    outcome: PipelineOutcome,
    opportunity: PipelineOutcome["analysis"]["opportunities"][number],
  ): string {
    return draftPitch({
      creatorName: "Test Creator",
      handle: "testcreator",
      niche: "dream pop",
      dna: outcome.analysis.tasteDna,
      brandId: opportunity.brandId,
      brandName: opportunity.name,
      brandCategory: opportunity.category,
      drivers: opportunity.drivers,
      pathway: opportunity.pathway,
      fit: opportunity.fit,
      voice: sourceVoice(outcome.analysis.source),
    });
  }

  it("gives two different brands materially different drafts", async () => {
    const outcome = await analyse(archetypeProfile("electronic"));
    const opportunities = outcome.analysis.opportunities;
    expect(opportunities.length, "need two brands to compare").toBeGreaterThanOrEqual(2);

    const first = opportunities[0]!;
    const second = opportunities[1]!;
    const a = pitchFor(outcome, first);
    const b = pitchFor(outcome, second);
    expect(a).not.toBe(b);

    // Materially different, not just a name swap: neutralise each brand's own
    // name and the drafts must STILL differ. What is left — the drivers, the
    // pathway bridge, the strongest-dimension lead and the fit breakdown — is
    // brand-derived, so identical residual prose would mean the rework did nothing.
    const residualA = a.split(first.name).join("BRAND");
    const residualB = b.split(second.name).join("BRAND");
    expect(residualA, "drafts differ only by the brand name").not.toBe(residualB);
  });

  it("keeps every draft inside the honesty rules", async () => {
    const outcome = await analyse(archetypeProfile("electronic"));
    expect(outcome.analysis.opportunities.length).toBeGreaterThan(0);
    for (const opportunity of outcome.analysis.opportunities) {
      const text = pitchFor(outcome, opportunity);
      // `assertHonestCopy` throws on the first violation; the draft is a business
      // document a brand will act on, so a slip here is the costliest kind.
      expect(() => assertHonestCopy(text, `pitch for ${opportunity.name}`)).not.toThrow();
      expect(findHonestyViolations(text)).toEqual([]);
    }
  });

  it("is deterministic: the same brand drafts identically every time", async () => {
    const outcome = await analyse(archetypeProfile("electronic"));
    const opportunity = outcome.analysis.opportunities[0]!;
    expect(pitchFor(outcome, opportunity)).toBe(pitchFor(outcome, opportunity));
  });
});

describe("core-taste 'why' line (Phase D)", () => {
  // A highlighted taste must justify itself. `describeCoreTaste` restates the
  // provenance trail (`contributedBy`) rather than inventing a reason, so the
  // strongest contributing entity is named verbatim and the line stays inside the
  // honesty rules — no percentage of an audience, no verdict.
  it("names the returned entities that carried the tag, honestly", async () => {
    const { analysis } = await analyse(archetypeProfile("electronic"));
    const core = analysis.tasteDna.coreTastes;
    expect(core.length).toBeGreaterThan(0);

    for (const taste of core.slice(0, 5)) {
      const described = describeCoreTaste(taste);
      expect(described.label).toBe(taste.tag.name);
      expect(described.reason.length).toBeGreaterThan(0);

      const topName = taste.contributedBy[0]?.entityName.trim() ?? "";
      if (topName.length > 0) {
        expect(described.reason, "reason must restate the trail, not invent one").toContain(topName);
      }
      expect(findHonestyViolations(described.reason)).toEqual([]);
    }
  });
});

describe("brand registry honesty (doc 02 §21/§22)", () => {
  it("never invents a partnership route", async () => {
    const { analysis } = await analyse(archetypeProfile("streetwear"));

    expect(analysis.opportunities.length).toBeGreaterThan(0);
    for (const opportunity of analysis.opportunities) {
      // Every registry entry ships unverified, so nothing may claim a route.
      expect(opportunity.partnership.available).toBe(false);
      expect(opportunity.partnership.creatorPartnershipUrl).toBeUndefined();
      expect(opportunity.partnership.affiliateUrl).toBeUndefined();
      expect(opportunity.partnership.verificationNote).toBeTruthy();
    }
  });

  it("always renders the fit disclosure alongside the score", async () => {
    const { analysis } = await analyse(archetypeProfile("outdoor"));

    for (const fit of analysis.brandFits) {
      expect(fit.overall.disclosure.length).toBeGreaterThan(0);
      expect(fit.components).toHaveLength(5);
      // Doc 05 §10E: an overall number must be traceable to its components.
      expect(fit.overall.componentsTotal).toBe(5);
      if (fit.overall.renderable) {
        expect(fit.overall.componentsUsed).toBeGreaterThan(0);
        expect(fit.rationale.length).toBeGreaterThan(0);
      }
    }
  });

  it("excludes unavailable dimensions instead of defaulting them", async () => {
    // The outdoor archetype declares no gender, so the audience dimension must be
    // computed from age only or excluded — never silently set to 0.5.
    const { analysis } = await analyse(archetypeProfile("outdoor"));
    const audience = analysis.brandFits
      .map((fit) => fit.components.find((c) => c.dimension === "audience_demographic"))
      .filter((component) => component !== undefined);

    expect(audience.length).toBeGreaterThan(0);
    for (const component of audience) {
      if (!component.available) {
        expect(component.value).toBeUndefined();
        expect(component.effectiveWeight).toBe(0);
      } else {
        expect(component.value).toBeDefined();
      }
    }
  });
});

describe("degraded and empty states (doc 04 §4.5)", () => {
  it("does not call the provider when nothing resolved", async () => {
    const provider = makeProvider();
    const search = vi.spyOn(provider, "search");
    const recommend = vi.spyOn(provider, "recommendEntities");
    const score = vi.spyOn(provider, "scoreEntities");

    const outcome = await runAnalysis({
      profile: emptyProfile(),
      provider,
      brands,
      generatedAt: FIXED_TIMESTAMP,
    });

    expect(outcome.hasSignals).toBe(false);
    // The API requires at least one valid signal, so calling it would be a
    // guaranteed 400 — and worse, a 200 with unpersonalised data.
    expect(recommend).not.toHaveBeenCalled();
    expect(score).not.toHaveBeenCalled();
    expect(search).toHaveBeenCalled(); // resolution was attempted, and failed
    expect(outcome.analysis.unresolvedInterests.length).toBeGreaterThan(0);
    expect(outcome.analysis.fallbackLevel).toBe("L4");

    // Every view-model must refuse to render rather than show a generic profile.
    expect(outcome.analysis.network.meta.renderable).toBe(false);
    expect(outcome.analysis.affinityRanking.meta.renderable).toBe(false);
    expect(outcome.analysis.fingerprint.meta.renderable).toBe(false);
    expect(outcome.analysis.network.meta.omittedReason).toBeTruthy();
  });

  it("hard-fails at L4 when the provider silently ignores signals", async () => {
    const outcome = await analyse(
      archetypeProfile("streetwear"),
      makeProvider({ simulateSilentIgnore: true }),
    );

    expect(outcome.analysis.fallbackLevel).toBe("L4");
    expect(outcome.taste.renderable).toBe(false);
    expect(outcome.analysis.network.meta.renderable).toBe(false);
    expect(outcome.analysis.tasteDna.coreTastes).toHaveLength(0);
    expect(
      outcome.analysis.observations.some((o) => o.code === "signals_appear_ignored"),
    ).toBe(true);
  });

  /**
   * The canary's two calls, under control.
   *
   * Recognised by `scope`, which the pipeline stamps per call
   * (`profile:<id>:<filterType>`, `…:canary:<type>`, `…:brands`), so the intercept
   * does not depend on which entity type the archetype happens to resolve to.
   * Brand discovery is delegated, and the declared readback is a `scoreEntities`
   * call that never reaches this method, so neither is disturbed.
   */
  const CANARY_SOURCE: DataSource = {
    mode: "live",
    providerId: "qloo",
    label: "Live Qloo data",
    isIllustrative: false,
  };

  /** What the ALL-signals call returns. The single-signal call is the parameter. */
  const CANARY_PRIMARY_IDS = ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9", "C10"];

  function canaryWire(ids: readonly string[], filterType: string): QlooEntityResult[] {
    return ids.map((id, index) => ({
      name: `Canary probe ${id}`,
      entity_id: id,
      type: filterType,
      subtype: filterType,
      properties: { description: `Canary probe ${id}.` },
      query: { affinity: 90 - index },
      // Cast through unknown: the wire schemas are passthrough.
    })) as unknown as QlooEntityResult[];
  }

  function canaryProbeProvider(canaryIds: readonly string[]): CulturalIntelligenceProvider {
    const base = new SyntheticProvider({ brands });
    return {
      id: "qloo",
      source: CANARY_SOURCE,
      capabilities: () => base.capabilities(),
      health: () => base.health(),
      search: (request) => base.search(request),
      recommendEntities: (request) => {
        const scope = request.scope ?? "";
        if (scope.endsWith(":brands")) return base.recommendEntities(request);
        const ids = scope.includes(":canary:") ? canaryIds : CANARY_PRIMARY_IDS;
        return Promise.resolve(
          mapEntityResultSet(
            { success: true, results: { entities: canaryWire(ids, request.filterType) } },
            CANARY_SOURCE,
          ),
        );
      },
      scoreEntities: (request) => base.scoreEntities(request),
      recommendTags: (request) => base.recommendTags(request),
      scoreTags: (request) => base.scoreTags(request),
      demographics: (request) => base.demographics(request),
    };
  }

  function analyseWithCanary(canaryIds: readonly string[]): Promise<PipelineOutcome> {
    return runAnalysis({
      profile: archetypeProfile("streetwear"),
      provider: canaryProbeProvider(canaryIds),
      brands,
      resolveInterests: false,
      generatedAt: FIXED_TIMESTAMP,
    });
  }

  it("does not accuse the provider of ignoring signals when the two sets differ", async () => {
    // Live regression, 2026-10-27. A six-place profile whose all-signals and
    // single-signal place calls shared 3 of 50 entities — and those 3 happened to
    // sit in the same relative order — produced a CRITICAL `signals_appear_ignored`
    // verdict that blanked an analysis the signals had demonstrably personalised:
    // 47 of the 50 results differed, and brand-discovery explainability attributed
    // the brands to the declared interests by name. Three shared ids have only
    // 3! = 6 possible orderings, so a one-in-six coincidence was enough to refuse a
    // real result and tell the creator the data source ignored them.
    const divergent = ["X1", "C2", "X2", "C5", "X3", "C9", "X4", "X5", "X6", "X7"];

    const outcome = await analyseWithCanary(divergent);

    expect(
      outcome.analysis.observations.some((o) => o.code === "signals_appear_ignored"),
      "a materially different result set is proof the signals were used",
    ).toBe(false);
    // Divergence is a PASS, not an absent check. Filing it as inconclusive would
    // put a successful comparison into the honesty ledger as a failure.
    expect(
      outcome.failures.some((failure) => failure.code === "ignore_check_inconclusive"),
      "a passed check must not be recorded as one that could not run",
    ).toBe(false);
  });

  it("still reports ignored signals when the two sets are substantially the same", async () => {
    // The divergence guard must not neuter the check. Six of ten shared, in the
    // same relative order, is a set that did not move — and the ordering evidence
    // now rests on a majority of both calls rather than on 3 survivors. Paired with
    // the divergent case above, this is what proves the canary actually RAN in both
    // instead of passing vacuously because it never fired anywhere.
    const mostlySame = ["C1", "C2", "C3", "C4", "C5", "C6", "Y1", "Y2", "Y3", "Y4"];

    const outcome = await analyseWithCanary(mostlySame);

    expect(
      outcome.analysis.observations.some((o) => o.code === "signals_appear_ignored"),
    ).toBe(true);
    expect(outcome.analysis.fallbackLevel).toBe("L4");
    expect(outcome.analysis.tasteDna.coreTastes).toHaveLength(0);
  });

  it("records provider failures as degradations rather than throwing", async () => {
    const provider = makeProvider();
    vi.spyOn(provider, "demographics").mockRejectedValue(new Error("upstream 500"));

    const outcome = await analyse(archetypeProfile("food"), provider);

    // The analysis still completes; only the affected dimension is lost.
    expect(outcome.taste.renderable).toBe(true);
    expect(outcome.failures.some((failure) => failure.step === "demographics")).toBe(true);
    expect(
      outcome.analysis.observations.some((observation) => observation.detail.includes("demographics")),
    ).toBe(true);
  });
});

/**
 * Live brand discovery (doc 02 §21 amendment).
 *
 * The scored brand set is now DISCOVERED from the data source for this creator's
 * taste, with the curated registry demoted to partnership-route enrichment on
 * overlap. These tests drive the real pipeline against a live-mode mock provider
 * returning brand entities the registry has never heard of, plus one that DOES
 * overlap it, so both branches run. The mock is live for brand discovery only and
 * delegates everything else to the synthetic engine, so the analysis stays
 * renderable and the silent-ignore canary still passes.
 */
describe("live brand discovery (doc 02 §21 amendment)", () => {
  const LIVE_SOURCE: DataSource = {
    mode: "live",
    providerId: "qloo",
    label: "Live Qloo data",
    isIllustrative: false,
  };

  /** A registry brand with a real Qloo id, so the overlap branch can be tested. */
  const overlapBrand = brands.find((brand) => brand.qlooEntityId !== undefined)!;

  interface WireEntry {
    id: string;
    name: string;
    affinity: number;
    industries?: string[];
    description?: string;
    signalId?: string;
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
      },
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

  function analyseWith(entities: QlooEntityResult[]): Promise<PipelineOutcome> {
    return runAnalysis({
      profile: archetypeProfile("electronic"),
      provider: liveDiscoveryProvider(entities),
      brands,
      resolveInterests: false,
      generatedAt: FIXED_TIMESTAMP,
    });
  }

  it("scores discovered brands that are absent from the registry", async () => {
    const signalId = archetypeProfile("electronic").selectedInterests[0]!.entityId!;
    const { analysis } = await analyseWith(
      brandWire([
        {
          id: "qloo-discovered-audio",
          name: "Test Audio Co",
          affinity: 95,
          industries: ["Consumer Electronics", "Audio"],
          description: "Consumer electronics and audio hardware maker.",
          signalId,
        },
        {
          id: "qloo-discovered-motoring",
          name: "Test Motoring",
          affinity: 88,
          industries: ["Automotive"],
          description: "Automotive and performance vehicle manufacturer.",
          signalId,
        },
      ]),
    );

    const audio = analysis.opportunities.find((entry) => entry.brandId === "qloo-discovered-audio");
    const motoring = analysis.opportunities.find((entry) => entry.brandId === "qloo-discovered-motoring");

    expect(audio, "discovered audio brand should be scored").toBeDefined();
    expect(audio?.discovered).toBe(true);
    // Category is DERIVED from Qloo metadata, not hand-curated.
    expect(audio?.category).toBe("consumer_tech");
    expect(motoring?.category).toBe("automotive");
    // A discovered brand has no verified partnership route, and none is invented.
    expect(audio?.partnership.available).toBe(false);
    // The "why this brand" chain names the declared interest that drove it.
    expect(audio?.drivers?.some((driver) => driver.name.length > 0)).toBe(true);
  });

  it("enriches a discovered brand that overlaps the registry, keeping its curated category", async () => {
    const { analysis } = await analyseWith(
      brandWire([
        {
          id: overlapBrand.qlooEntityId!,
          name: overlapBrand.displayName,
          affinity: 91,
          industries: ["Unrelated Industry"],
          description: "A brand that happens to overlap the curated registry.",
        },
      ]),
    );

    const overlapped = analysis.opportunities.find((entry) => entry.brandId === overlapBrand.qlooEntityId);
    expect(overlapped, "registry-overlapping brand should be scored").toBeDefined();
    // Overlap means NOT flagged discovered, and the curated category is kept
    // rather than the derived one the unrelated industries would have produced.
    expect(overlapped?.discovered).toBe(false);
    expect(overlapped?.category).toBe(overlapBrand.category);
  });

  it("keeps discovery position as metadata and never lets it become taste fit", async () => {
    // The §4 correction. Three brands on ONE call, affinities 99/60/20. Min-max
    // normalisation stretches those across 0..1, so the top brand used to arrive
    // carrying `taste_fit = 1.00` — a "100% cultural match" computed from nothing
    // but the fact that it was returned first. None of the three carries a single
    // descriptor comparable with the creator's taste, so there is no measured
    // cultural fit here at all, and the score must say so rather than invent one.
    const { analysis } = await analyseWith(
      brandWire([
        { id: "qloo-brand-high", name: "High Brand", affinity: 99 },
        { id: "qloo-brand-mid", name: "Mid Brand", affinity: 60 },
        { id: "qloo-brand-low", name: "Low Brand", affinity: 20 },
      ]),
    );

    const ids = ["qloo-brand-high", "qloo-brand-mid", "qloo-brand-low"];

    const tasteFitOf = (id: string) => {
      const component = analysis.brandFits
        .find((fit) => fit.brandId === id)
        ?.components.find((entry) => entry.dimension === "taste_fit");
      expect(component, `${id} must still carry a taste_fit component`).toBeDefined();
      return component!;
    };

    // Unavailable — not zero, and not 1. An omitted dimension is renormalised away,
    // so a missing measurement never masquerades as a bad one or, as before, as a
    // perfect one. The reason is carried on the overall evidence summary rather than
    // on the component, because that summary is what §6.4 requires the reader to see
    // before any of the arithmetic.
    for (const id of ids) {
      const component = tasteFitOf(id);
      expect(component.available, `${id} has no comparable descriptor, so taste fit is unavailable`).toBe(false);
      expect(component.value).toBeUndefined();
      expect(component.effectiveWeight).toBe(0);

      const fit = analysis.brandFits.find((entry) => entry.brandId === id)!;
      const reason = fit.overall.evidence.unavailable.find((entry) => entry.dimension === "taste_fit");
      expect(reason, `${id} must explain why taste fit was omitted`).toBeDefined();
      expect(reason!.reason.length).toBeGreaterThan(0);
    }

    // No cultural dimension was scored, so the overall cannot wear an alignment
    // label and must not be rendered as a score (§6.3).
    for (const fit of analysis.brandFits) {
      expect(fit.overall.renderable, `${fit.brandId} has no cultural evidence`).toBe(false);
      expect(fit.overall.label).toBe(NOT_ENOUGH_EVIDENCE_LABEL);
      expect(fit.overall.evidence.culturalEvidence).toBe(false);
      expect(fit.overall.evidence.culturalDimensionsAvailable).toEqual([]);
    }

    // The within-set normalisation is NOT thrown away — it is kept, labelled as
    // what it is, and moved out of the score. One shared result set, so the three
    // positions stay comparable with each other (doc 04 §4.4).
    const discoveryOf = (id: string) =>
      analysis.opportunities.find((entry) => entry.brandId === id)?.discovery;

    const high = discoveryOf("qloo-brand-high");
    const mid = discoveryOf("qloo-brand-mid");
    const low = discoveryOf("qloo-brand-low");

    expect(high?.rank, "the top affinity is rank 1 of the set").toBe(1);
    expect(mid?.rank).toBe(2);
    expect(low?.rank).toBe(3);
    expect(high?.setSize).toBe(3);

    // §4.1: "do not discard the raw value after normalization".
    expect(high?.rawAffinity).toBe(99);
    expect(mid?.rawAffinity).toBe(60);
    expect(low?.rawAffinity).toBe(20);
    // These arrived as 0–100 integers with at least one above 1, so the detector
    // could resolve the scale rather than flagging it ambiguous.
    expect(high?.affinityScale).toBe("percent");
    expect(high?.scaleResolved).toBe(true);

    // Order preserved by the normalised position, the top of the set at 1.
    expect(high?.normalisedPosition).toBeCloseTo(1, 5);
    expect(high!.normalisedPosition!).toBeGreaterThan(mid!.normalisedPosition!);
    expect(mid!.normalisedPosition!).toBeGreaterThan(low!.normalisedPosition!);

    // And the metadata says out loud what it is, so a card rendering it cannot
    // present a rank as a fit score.
    expect(high?.meaning).toMatch(/why this brand appeared/i);
    expect(high?.meaning).not.toMatch(/cultural match/i);
  });

  it("caps the scored brand list at maxBrands", async () => {
    const many = Array.from({ length: 15 }, (_, index) => ({
      id: `qloo-brand-${index}`,
      name: `Brand ${index}`,
      affinity: 90 - index,
    }));
    const { analysis } = await analyseWith(brandWire(many));

    // 15 discovered, 12 kept — the cap actually bit.
    expect(analysis.brandFits.length).toBe(12);
    expect(analysis.opportunities.length).toBeLessThanOrEqual(12);
  });
});

/**
 * Streamed stage progress (Phase B).
 *
 * `runAnalysis` reports a `StageEvent` at every real boundary so the route can
 * stream it and the analyzing screen can light up against actual work. These
 * tests assert the CONTRACT the client relies on: every canonical stage reaches
 * exactly one terminal status, the sequential stages keep their order, and the
 * events fold into a settled progress map. The four provider calls run
 * concurrently, so their completion order is deliberately NOT asserted — only
 * that each one terminates.
 */
describe("streamed stage progress (onStage)", () => {
  async function collectStages(
    profile: CreatorProfile,
    provider: SyntheticProvider = makeProvider(),
    resolveInterests?: boolean,
  ): Promise<{ outcome: PipelineOutcome; events: StageEvent[] }> {
    const events: StageEvent[] = [];
    const outcome = await runAnalysis({
      profile,
      provider,
      brands,
      generatedAt: FIXED_TIMESTAMP,
      ...(resolveInterests === undefined ? {} : { resolveInterests }),
      onStage: (event) => events.push(event),
    });
    return { outcome, events };
  }

  it("reports exactly one terminal status for every canonical stage", async () => {
    const { events } = await collectStages(archetypeProfile("electronic"), makeProvider(), false);

    const terminal = events.filter((event) => event.status === "done" || event.status === "skipped");
    const terminalIds = terminal.map((event) => event.id);

    expect(terminalIds).toHaveLength(PIPELINE_STAGES.length);
    expect(new Set(terminalIds).size, "a stage terminated twice").toBe(PIPELINE_STAGES.length);
    for (const stage of PIPELINE_STAGES) {
      expect(terminalIds, `stage ${stage.id} never terminated`).toContain(stage.id);
      // The label the client renders is carried by the event, not looked up again.
      expect(events.find((event) => event.id === stage.id)?.label).toBe(stage.label);
    }
  });

  it("opens on interest resolution and closes on the view-model build", async () => {
    const { events } = await collectStages(archetypeProfile("electronic"), makeProvider(), false);

    expect(events[0]?.id).toBe("interests");
    expect(events[events.length - 1]).toMatchObject({ id: "viewmodels", status: "done" });

    // The strictly sequential tail can never reorder; the parallel provider calls
    // before it are excluded because they settle in completion order.
    //
    // `brands` and `intersection` are IN the tail, and their position is the
    // architectural guarantee rather than a detail: brand discovery runs after the
    // Creator Taste DNA is assembled (so it can be driven by the expanded profile
    // instead of the typed keywords), and every brand's cultural profile is compared
    // with the creator's before anything is scored or ranked. A tail that read
    // `brands` before `taste` would mean the old ordering had come back.
    const tail: readonly string[] = [
      "canary",
      "taste",
      "brands",
      "intersection",
      "opportunities",
      "scoring",
      "viewmodels",
    ];
    const terminalTail = events
      .filter((event) => event.status === "done" || event.status === "skipped")
      .map((event) => event.id)
      .filter((id) => tail.includes(id));
    expect(terminalTail).toEqual([...tail]);
  });

  it("marks interest resolution skipped when interests arrive pre-resolved", async () => {
    const { events } = await collectStages(archetypeProfile("electronic"), makeProvider(), false);
    // resolveInterests: false means no search ran, so the honest status is skipped.
    expect(events[0]).toMatchObject({ id: "interests", status: "skipped" });
  });

  it("runs interest resolution start→done when it must resolve", async () => {
    const { events } = await collectStages(archetypeProfile("electronic"), makeProvider(), true);
    const interests = events.filter((event) => event.id === "interests");
    expect(interests[0]?.status).toBe("start");
    expect(interests[interests.length - 1]?.status).toBe("done");
  });

  it("folds into a settled progress map the analyzing screen can render", async () => {
    const { events } = await collectStages(archetypeProfile("electronic"), makeProvider(), false);

    let progress = initialStageProgress();
    // Before any event, nothing is settled and every stage is pending.
    expect(isStageProgressSettled(progress)).toBe(false);
    for (const event of events) progress = applyStageEvent(progress, event);

    expect(isStageProgressSettled(progress)).toBe(true);
    // An unknown id is ignored rather than inventing a step (a newer server must
    // not crash an older client's render).
    const unchanged = applyStageEvent(progress, {
      id: "not-a-real-stage" as StageEvent["id"],
      label: "x",
      status: "done",
    });
    expect(unchanged).toBe(progress);
  });
});

describe("audience context — explanation only, never evidence", () => {
  /**
   * The two answers as the copy layer receives them: already resolved to words.
   * `generate.ts` never sees an id, which is what lets it keep its
   * no-runtime-imports rule while gaining the feature.
   */
  const STATED: AudienceWords = {
    groups: ["Gamers", "Students and learners"],
    purposes: ["Entertainment and humor", "Education and learning"],
  };

  /** The same answers as they travel on the wire, as ids. */
  const ON_PROFILE: CreatorProfile["audience"] = {
    groups: ["gamers", "students"],
    purposes: ["entertainment", "education"],
  };

  function pitchFor(
    outcome: PipelineOutcome,
    opportunity: PipelineOutcome["analysis"]["opportunities"][number],
    audienceContext?: AudienceWords,
  ): string {
    return draftPitch({
      creatorName: "Test Creator",
      handle: "testcreator",
      niche: "dream pop",
      dna: outcome.analysis.tasteDna,
      brandId: opportunity.brandId,
      brandName: opportunity.name,
      brandCategory: opportunity.category,
      drivers: opportunity.drivers,
      pathway: opportunity.pathway,
      intersection: opportunity.intersection,
      fit: opportunity.fit,
      voice: sourceVoice(outcome.analysis.source),
      audienceContext,
    });
  }

  it("changes nothing the pipeline computes, and nothing the cache key is built from", async () => {
    const bare = await analyse(archetypeProfile("gaming"));
    const withContext = await analyse({
      ...archetypeProfile("gaming"),
      audience: ON_PROFILE,
    });

    // The WHOLE analysis, not a selection of fields. Audience context is an
    // explanation input: if any number, any intersection, any ordering or any
    // stored string moved, it would have stopped being one. `generatedAt` is pinned
    // to `FIXED_TIMESTAMP` by `analyse`, so a difference here is a real difference.
    expect(withContext.analysis).toEqual(bare.analysis);
    expect(withContext.renderable).toBe(bare.renderable);
    expect(withContext.hasSignals).toBe(bare.hasSignals);

    // And the key follows the analysis rather than the profile. Two creators who
    // differ only in what they said about their audience MUST share a cache entry,
    // because they get a byte-identical result — and if the analysis above ever
    // started differing, this assertion and that one would fail together, which is
    // the point of having both.
    const source = bare.analysis.source;
    expect(
      analysisCacheKey({ ...archetypeProfile("gaming"), audience: ON_PROFILE }, brands, source),
    ).toBe(analysisCacheKey(archetypeProfile("gaming"), brands, source));
  });

  it("adds a sentence to the opportunity copy only where an overlap already existed", async () => {
    const results = await analyseAll();
    let overlapped = 0;

    for (const { outcome } of results) {
      const voice = sourceVoice(outcome.analysis.source);
      for (const opportunity of outcome.analysis.opportunities) {
        const plain = describeBrandOpportunity(opportunity, voice);
        const enriched = describeBrandOpportunity(opportunity, voice, STATED);
        const stated = enriched.because.filter((line) => line.startsWith("You say you create for"));

        if ((opportunity.intersection?.shared.length ?? 0) > 0) {
          overlapped += 1;
          expect(stated, `${opportunity.name} has an overlap but no audience sentence`).toHaveLength(
            1,
          );
        } else {
          // THE GATE, asserted in the direction that matters. With no shared
          // dimension the creator's answer would be the only thing linking them to
          // the brand, so nothing may be said — and not merely nothing extra: the
          // whole evidence chain must be identical, which is what stops a ticked
          // chip from manufacturing a cultural match.
          expect(stated, `${opportunity.name} got an audience sentence with no overlap`).toEqual([]);
          expect(enriched.because).toEqual(plain.because);
        }

        // Either way the rest of the copy is untouched, so the sentence can only
        // add an explanation and never replace, reorder or strengthen evidence.
        expect(enriched.hypothesis).toBe(plain.hypothesis);
        expect(enriched.caveat).toBe(plain.caveat);
        expect(enriched.missing).toEqual(plain.missing);
        for (const line of enriched.because) {
          expect(findHonestyViolations(line), `honesty violation in: ${line}`).toEqual([]);
        }
      }
    }

    // Non-vacuity, for the reason the honesty guard above gives its own: if no brand
    // in any run shared a taste, every positive assertion above would have been
    // skipped and the gate would look exercised while never being tested.
    expect(overlapped, "no brand in any run shared a taste").toBeGreaterThan(0);
  });

  it("says nothing at all for a brand reached with no overlap", async () => {
    // Constructed rather than found. Whether an archetype run happens to contain an
    // overlap-free brand is a property of the fixture, and a gate tested only
    // against fixtures can silently stop being tested. Here the refusal is
    // exercised on every run of the suite, on all three surfaces.
    const outcome = await analyse(archetypeProfile("gaming"));
    const first = outcome.analysis.opportunities[0];
    expect(first, "need a brand to strip the overlap from").toBeDefined();
    const voice = sourceVoice(outcome.analysis.source);
    const bare = { ...first!, intersection: undefined, drivers: [] };

    const why = describeBrandOpportunity(bare, voice, STATED);
    expect(why.because.filter((line) => line.startsWith("You say"))).toEqual([]);

    const note = describeBrandFitForKit(bare, "Test Creator", voice, STATED);
    expect(note.because.filter((line) => line.includes("says they create for"))).toEqual([]);

    const pitch = pitchFor(outcome, { ...first!, intersection: undefined }, STATED);
    expect(pitch).not.toContain("I make my work for");
    // The pitch still carries its honest placeholder, so refusing the sentence did
    // not quietly turn into claiming an audience.
    expect(pitch).toContain("CreatorsDNA does not measure audiences");
  });

  it("keeps the kit and the pitch inside the honesty rules when the context is used", async () => {
    const outcome = await analyse(archetypeProfile("gaming"));
    const voice = sourceVoice(outcome.analysis.source);
    let stated = 0;

    for (const opportunity of outcome.analysis.opportunities) {
      const note = describeBrandFitForKit(opportunity, "Test Creator", voice, STATED);
      for (const line of [note.line, note.caveat, ...note.because]) {
        expect(findHonestyViolations(line), `honesty violation in: ${line}`).toEqual([]);
      }
      if (note.because.some((line) => line.includes("says they create for"))) stated += 1;

      const pitch = pitchFor(outcome, opportunity, STATED);
      expect(() => assertHonestCopy(pitch, `pitch for ${opportunity.name}`)).not.toThrow();
    }

    expect(stated, "no gaming brand shared a taste, so the kit sentence never ran").toBeGreaterThan(
      0,
    );
  });

  it("leaves every draft byte-identical when the creator said nothing", async () => {
    // The backward-compatibility claim, tested rather than asserted in a comment:
    // a creator who skipped both questions gets the pitch this function produced
    // before the field existed. `undefined` and an absent property are both covered,
    // because callers reach this through an optional prop.
    const outcome = await analyse(archetypeProfile("electronic"));
    expect(outcome.analysis.opportunities.length).toBeGreaterThan(0);

    for (const opportunity of outcome.analysis.opportunities) {
      expect(pitchFor(outcome, opportunity, undefined)).toBe(pitchFor(outcome, opportunity));
      const voice = sourceVoice(outcome.analysis.source);
      expect(describeBrandOpportunity(opportunity, voice, undefined)).toEqual(
        describeBrandOpportunity(opportunity, voice),
      );
    }
  });
});

describe("content DNA — the form of an overlap, never the overlap itself", () => {
  /**
   * Two creators in the SAME cultural world, making different things.
   *
   * §4's example reduced to the minimum that can show the difference. Both carry the
   * same topic and the same platform, so every intersection, every score and every
   * ordering is identical for the two of them; the only thing that can vary is the
   * FORM a collaboration would take. If a test below passes with these two swapped,
   * the differentiation is not coming from Content DNA.
   */
  const PRACTICAL: ContentDna = {
    topics: ["Streetwear"],
    angles: ["Tutorials and practical guidance"],
    approach: "a practical walkthrough",
    formats: ["YouTube"],
    method: "Tutorials and practical guidance, covering Streetwear",
    positioning: "Tutorials and practical guidance, covering Streetwear, published on YouTube",
  };

  const NARRATIVE: ContentDna = {
    ...PRACTICAL,
    angles: ["Personal stories and relatable experiences"],
    approach: "a story-led piece",
    method: "Personal stories and relatable experiences, covering Streetwear",
    positioning:
      "Personal stories and relatable experiences, covering Streetwear, published on YouTube",
  };

  type Opportunity = PipelineOutcome["analysis"]["opportunities"][number];

  function pitchWith(
    outcome: PipelineOutcome,
    opportunity: Opportunity,
    contentDna?: ContentDna,
  ): string {
    return draftPitch({
      creatorName: "Test Creator",
      handle: "testcreator",
      niche: "streetwear",
      dna: outcome.analysis.tasteDna,
      brandId: opportunity.brandId,
      brandName: opportunity.name,
      brandCategory: opportunity.category,
      drivers: opportunity.drivers,
      pathway: opportunity.pathway,
      intersection: opportunity.intersection,
      fit: opportunity.fit,
      isUntapped: opportunity.isUntapped,
      platforms: ["YouTube"],
      voice: sourceVoice(outcome.analysis.source),
      contentDna,
    });
  }

  function conceptFor(
    outcome: PipelineOutcome,
    opportunity: Opportunity,
    contentDna?: ContentDna,
  ) {
    return proposeCollaboration({
      brandId: opportunity.brandId,
      brandName: opportunity.name,
      category: opportunity.category,
      isUntapped: opportunity.isUntapped,
      drivers: opportunity.drivers,
      coreTastes: outcome.analysis.tasteDna.coreTastes,
      platforms: ["YouTube"],
      intersection: opportunity.intersection,
      contentDna,
    });
  }

  /** Brands whose evidence can carry a content sentence at all: an overlap exists,
   *  and a fit was computed (the non-renderable hypothesis has no form clause to
   *  vary, so including one here would assert a difference that cannot appear). */
  function differentiable(opportunity: Opportunity): boolean {
    return (opportunity.intersection?.shared.length ?? 0) > 0 && opportunity.fit.overall.renderable;
  }

  it("gives two creators who overlap the same brand two different hypotheses", async () => {
    const outcome = await analyse(archetypeProfile("streetwear"));
    const voice = sourceVoice(outcome.analysis.source);
    let compared = 0;

    for (const opportunity of outcome.analysis.opportunities) {
      if (!differentiable(opportunity)) continue;
      compared += 1;

      const plain = describeBrandOpportunity(opportunity, voice);
      const practical = describeBrandOpportunity(opportunity, voice, undefined, PRACTICAL);
      const narrative = describeBrandOpportunity(opportunity, voice, undefined, NARRATIVE);

      // The requirement itself: one intersection, two readings.
      expect(
        practical.hypothesis,
        `${opportunity.name} did not differentiate on content DNA`,
      ).not.toBe(narrative.hypothesis);
      expect(practical.hypothesis).toContain("a practical walkthrough");
      expect(narrative.hypothesis).toContain("a story-led piece");

      // …and ONLY the form differs. The overlap clause, the caveat and the missing
      // evidence are the same comparison, so two creators must not be given two
      // versions of what was found — that is how a positioning phrase would start
      // to look like a stronger match.
      expect(practical.caveat).toBe(narrative.caveat);
      expect(practical.missing).toEqual(narrative.missing);
      expect(practical.missing).toEqual(plain.missing);
      expect(practical.because).toHaveLength(plain.because.length + 1);

      // §6's order, asserted structurally rather than by eye: the content sentence
      // sits AFTER the overlap sentence in the evidence chain, never ahead of it.
      const overlapAt = practical.because.findIndex((line) =>
        line.startsWith("Your cultural profile and"),
      );
      const contentAt = practical.because.findIndex((line) =>
        line.startsWith("How you make things"),
      );
      expect(overlapAt).toBe(0);
      expect(contentAt).toBeGreaterThan(overlapAt);

      for (const line of [practical.hypothesis, ...practical.because]) {
        expect(findHonestyViolations(line), `honesty violation in: ${line}`).toEqual([]);
      }
    }

    // Non-vacuity, for the reason the audience suite gives its own: if no brand in
    // this run was differentiable, every assertion above was skipped and the
    // requirement would look covered while never being exercised.
    expect(compared, "no streetwear brand could carry a content sentence").toBeGreaterThan(0);
  });

  it("says nothing at all for a brand the evidence found no overlap with", async () => {
    // Constructed rather than found, for the reason the audience suite gives: whether
    // a fixture happens to contain an overlap-free brand is a property of the fixture,
    // and a gate tested only against fixtures can silently stop being tested. This is
    // §5's last requirement — with no shared dimension the creator's own description
    // of their method would be the only thing connecting them to the brand.
    const outcome = await analyse(archetypeProfile("streetwear"));
    const first = outcome.analysis.opportunities[0];
    expect(first, "need a brand to strip the overlap from").toBeDefined();
    const voice = sourceVoice(outcome.analysis.source);
    const bare = { ...first!, intersection: undefined, drivers: [] };

    const why = describeBrandOpportunity(bare, voice, undefined, PRACTICAL);
    expect(why.because.filter((line) => line.includes("How you make things"))).toEqual([]);
    // Not merely no extra sentence: the hypothesis must be the one written before
    // Content DNA existed, and must not gain the form clause.
    expect(why.hypothesis).toBe(describeBrandOpportunity(bare, voice).hypothesis);
    expect(why.hypothesis).not.toContain("walkthrough");
    // And no gap was filled by it either — a positioning phrase must not stand in for
    // missing evidence.
    expect(why.missing).toEqual(describeBrandOpportunity(bare, voice).missing);

    const note = describeBrandFitForKit(bare, "Test Creator", voice, undefined, PRACTICAL);
    expect(note.because.filter((line) => line.includes("describes their own work"))).toEqual([]);

    const pitch = pitchWith(outcome, { ...first!, intersection: undefined }, PRACTICAL);
    expect(pitch).not.toContain("How I make things");
  });

  it("gives the suggested collaboration a form without changing what it was built from", async () => {
    const outcome = await analyse(archetypeProfile("streetwear"));
    let shaped = 0;

    for (const opportunity of outcome.analysis.opportunities) {
      const plain = conceptFor(outcome, opportunity);
      const practical = conceptFor(outcome, opportunity, PRACTICAL);
      const narrative = conceptFor(outcome, opportunity, NARRATIVE);

      // The FAMILY of idea is still chosen by the evidence alone: where the evidence
      // supports nothing, stating an angle must not conjure a suggestion. "A social
      // media campaign" is not a concept, and Content DNA is not allowed to make one.
      if (plain === undefined) {
        expect(practical, `${opportunity.name} gained a concept from content DNA`).toBeUndefined();
        expect(narrative).toBeUndefined();
        continue;
      }

      expect(practical).toBeDefined();
      expect(narrative).toBeDefined();
      expect(practical!.idea, `${opportunity.name} did not differentiate`).not.toBe(
        narrative!.idea,
      );
      // The idea is the SAME sentence with one clause appended, never a different idea:
      // there is no table pairing an angle with a brand or a category, so the subject
      // still comes from the evidence and only the shape comes from the creator.
      expect(practical!.label).toBe(plain.label);
      expect(practical!.idea.startsWith(plain.idea)).toBe(true);
      expect(practical!.basis.startsWith(plain.basis)).toBe(true);
      expect(practical!.idea).toContain("a practical walkthrough");
      expect(narrative!.idea).toContain("a story-led piece");
      shaped += 1;
    }

    expect(shaped, "no streetwear brand produced a collaboration concept").toBeGreaterThan(0);

    // The refusal, constructed rather than hoped for. Whether a fixture happens to
    // contain a brand with no intersection, no driver and no core taste is a property of
    // the fixture, so the loop above cannot be relied on to reach it — and this is the
    // case §5 turns on, so it runs on every pass of the suite.
    expect(
      proposeCollaboration({
        brandId: "no-evidence",
        brandName: "No Evidence Brand",
        isUntapped: false,
        intersection: undefined,
        drivers: [],
        coreTastes: [],
        platforms: ["YouTube"],
        contentDna: PRACTICAL,
      }),
      "content DNA produced a collaboration concept out of no evidence at all",
    ).toBeUndefined();
  });

  it("states the method in the pitch once, after the overlap and before the suggestion", async () => {
    const outcome = await analyse(archetypeProfile("gaming"));
    let stated = 0;

    for (const opportunity of outcome.analysis.opportunities) {
      const pitch = pitchWith(outcome, opportunity, PRACTICAL);
      const occurrences = pitch.split("How I make things:").length - 1;
      const overlapped = (opportunity.intersection?.shared.length ?? 0) > 0;

      if (!overlapped) {
        expect(occurrences, `${opportunity.name} got a method line with no overlap`).toBe(0);
        continue;
      }

      expect(occurrences, `${opportunity.name} overlapped but the pitch said nothing`).toBe(1);
      stated += 1;
      // §6's order in the one document that leaves the product: the cultural overlap,
      // then the creator's own angle, then the collaboration it could inspire.
      const overlapAt = pitch.indexOf("Our content and your brand share a cultural connection");
      const methodAt = pitch.indexOf("How I make things:");
      expect(overlapAt).toBeGreaterThanOrEqual(0);
      expect(methodAt).toBeGreaterThan(overlapAt);

      const ideaAt = pitch.indexOf("One idea, offered as a starting point");
      if (ideaAt >= 0) expect(methodAt).toBeLessThan(ideaAt);

      expect(() => assertHonestCopy(pitch, `pitch for ${opportunity.name}`)).not.toThrow();
    }

    expect(stated, "no gaming brand shared a taste, so the pitch line never ran").toBeGreaterThan(
      0,
    );
  });

  it("keeps the kit inside the honesty rules, and attributes the words to the creator", async () => {
    const outcome = await analyse(archetypeProfile("gaming"));
    const voice = sourceVoice(outcome.analysis.source);
    let attributed = 0;

    for (const opportunity of outcome.analysis.opportunities) {
      const note = describeBrandFitForKit(opportunity, "Test Creator", voice, undefined, PRACTICAL);
      const lines = note.because.filter((line) => line.includes("describes their own work"));

      for (const line of [note.line, note.caveat, ...note.because]) {
        expect(findHonestyViolations(line), `honesty violation in: ${line}`).toEqual([]);
      }

      if ((opportunity.intersection?.shared.length ?? 0) > 0) {
        expect(lines, `${opportunity.name} has an overlap but no content note`).toHaveLength(1);
        attributed += 1;
        // A brand reading a format next to an overlap will otherwise assume the format
        // was part of what matched. The note has to say it was not, and say whose words
        // these are — a kit is forwarded, and the creator is not in the room to add it.
        expect(lines[0]).toContain("Test Creator describes their own work");
        expect(lines[0]).toContain("not part of the comparison");
      } else {
        expect(lines).toEqual([]);
      }
    }

    expect(attributed, "no gaming brand shared a taste, so the kit note never ran").toBeGreaterThan(
      0,
    );
  });

  it("leaves every surface byte-identical when the creator stated no content DNA", async () => {
    // The backward-compatibility claim, tested rather than asserted in a comment. A
    // creator who ticked nothing gets the copy these four functions produced before the
    // field existed, and `undefined` and an absent property are both covered because
    // callers reach all of them through an optional prop.
    const outcome = await analyse(archetypeProfile("electronic"));
    expect(outcome.analysis.opportunities.length).toBeGreaterThan(0);
    const voice = sourceVoice(outcome.analysis.source);

    for (const opportunity of outcome.analysis.opportunities) {
      expect(pitchWith(outcome, opportunity, undefined)).toBe(pitchWith(outcome, opportunity));
      expect(describeBrandOpportunity(opportunity, voice, undefined, undefined)).toEqual(
        describeBrandOpportunity(opportunity, voice),
      );
      expect(
        describeBrandFitForKit(opportunity, "Test Creator", voice, undefined, undefined),
      ).toEqual(describeBrandFitForKit(opportunity, "Test Creator", voice));
      expect(conceptFor(outcome, opportunity, undefined)).toEqual(conceptFor(outcome, opportunity));
    }
  });

  it("never writes back to the analysis it describes", async () => {
    // The copy layer is pure, and Content DNA is the newest thing flowing through it. A
    // builder that decorated the opportunity with a content-derived field would put a
    // creator's self-description inside the object every score is read from — which is
    // how "not evidence" quietly stops being true without anyone changing a weight.
    const outcome = await analyse(archetypeProfile("streetwear"));
    const voice = sourceVoice(outcome.analysis.source);
    const before = JSON.stringify(outcome.analysis.opportunities);

    for (const opportunity of outcome.analysis.opportunities) {
      describeBrandOpportunity(opportunity, voice, undefined, PRACTICAL);
      describeBrandFitForKit(opportunity, "Test Creator", voice, undefined, PRACTICAL);
      conceptFor(outcome, opportunity, PRACTICAL);
      pitchWith(outcome, opportunity, PRACTICAL);
    }

    expect(JSON.stringify(outcome.analysis.opportunities)).toBe(before);

    // And nothing content-derived leaked onto the objects the ranking is made of: the
    // intersection and the fit are the same shape they were before this feature existed,
    // so there is no field a later change could start reading as a signal.
    const first = outcome.analysis.opportunities[0]!;
    expect(Object.keys(first)).not.toContain("contentDna");
    expect(Object.keys(first.fit.overall)).not.toContain("contentDna");
    expect(Object.keys(first.intersection ?? {})).not.toContain("contentDna");
  });
});
