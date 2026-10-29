import "server-only";

import type { RegistryBrand, EnrichedBrand, BrandCategory } from "@/lib/contracts/brand";
import { brandEntityId, firstHttpUrl, isBrandEntity, mergeBrand } from "@/lib/contracts/brand";
import type { SelectedInterest } from "@/lib/contracts/creator";
import {
  toCreatorSignals,
  type CreatorProfile,
  type CreatorSignals,
} from "@/lib/contracts/creator";
import type {
  CulturalEntity,
  DataSource,
  DemographicResultSet,
  EntityResultSet,
  ObservationCode,
  PipelineObservationCode,
  ProviderErrorCode,
  ProviderObservation,
  ScoredTasteTag,
  TagResultSet,
} from "@/lib/contracts/domain";
import { ProviderError } from "@/lib/contracts/domain";
import { insightsTypeFor, type QlooInsightsEntityType } from "@/lib/contracts/qloo";
import type {
  BrandDiscoveryEvidence,
  BrandFitViewModel,
  BrandOpportunity,
  BrandTasteDNA,
  CreatorAnalysis,
  TasteIntersection,
} from "@/lib/contracts/viewModels";
import type { CulturalIntelligenceProvider, SignalBlock } from "@/lib/providers/provider";
import { stableKey } from "@/lib/utils/deterministic";

import { buildBrandFitViewModel, buildBrandRelationshipMap, buildOpportunityGap } from "./buildersBrand";
import { buildAffinityRanking, buildTasteDnaNetwork, buildTasteFingerprint } from "./buildersTaste";
import { buildBrandTasteDna } from "./brandTaste";
import { compareIntersections, intersectTaste } from "./intersection";
import { deriveOpportunities, rankOpportunities, toBrandOpportunity } from "./opportunities";
import { DEFAULT_THRESHOLDS, type AnalysisThresholds } from "./thresholds";
import { assembleTasteDna, coverageWithBasis, type TasteDnaResult } from "./tasteDna";
import { stageEvent, type PipelineStageId, type StageEvent, type StageStatus } from "./stages";
import {
  audienceFitEvidence,
  brandDiscoveryEvidence,
  contentCompatibilityEvidence,
  geographicFitEvidence,
  opportunityGapEvidence,
  tasteFitEvidence,
} from "@/lib/scoring/dimensions";
import { scoreBrandFit, type BrandFitEvidence, type BrandFitResult } from "@/lib/scoring/brandFit";

/**
 * The analysis pipeline: creator profile in, `CreatorAnalysis` out.
 *
 * This is the only module that knows the ORDER things happen in. Everything it
 * calls is pure and individually tested; this file is deliberately thin so that
 * a change in one stage cannot silently change another.
 *
 * Three rules shaped it:
 *
 *   1. **A failed provider call degrades the analysis, it does not abort it.**
 *      Doc 02 §39/§40 make demographics and location optional, and doc 04 §4.5
 *      builds the whole fallback hierarchy on the expectation that capabilities
 *      may be missing. Every call is wrapped in `attempt()`, which records the
 *      failure and carries on. The failures are returned, not swallowed, so the
 *      UI can say exactly which dimension is missing and why.
 *
 *   2. **Taste DNA and brand scoring are separate pools.** Recommendations (M2)
 *      feed the Taste DNA; the dedicated `filter.type=urn:entity:brand`
 *      recommendation call feeds brand fit. Merging them would put brands into
 *      the "discovered cultural affinity" network, which is a different claim.
 *      Both are within-set normalised, so the separation costs nothing in
 *      comparability. The curated registry is NOT a candidate source for either:
 *      it is consulted only to enrich a brand the data source already returned
 *      (see `scoreBrands`), so a brand absent from it stays eligible and a brand
 *      present in it is never promoted into the list on that basis alone.
 *
 *   3. **Nothing is invented to fill a gap.** An unresolved interest is reported
 *      in `unresolvedInterests`; a dimension with no data is excluded from the
 *      score and the weights renormalised; a brand shows a partnership route only
 *      when the curated registry carries one that a curator verified against an
 *      official source, and `available: false` otherwise. Worth stating plainly:
 *      no entry in `src/data/brands.json` currently carries one, so every brand
 *      reports no route today. That is the intended state — an unverified route is
 *      withheld — and not a gap being papered over with a plausible contact page.
 */

// ---------------------------------------------------------------------------
// Inputs & outputs
// ---------------------------------------------------------------------------

export interface PipelineFailure {
  /** Which stage failed, e.g. "recommendEntities", "brand:registry:nike". */
  step: string;
  /**
   * A closed diagnostic code, drawn from all three families rather than one.
   *
   * Usually `PipelineObservationCode` — a fact only the pipeline knows — or the
   * provider's own `ProviderErrorCode`, when the failure was a provider call that
   * threw. `retainBrandsOnly` reuses `ObservationCode["entity_type_excluded"]`
   * instead of inventing a synonym, and that is deliberate: the mapper excludes
   * wrong-typed entities at its own boundary and records the same code there, so
   * one key finds both boundaries' exclusions. A pipeline-specific variant would
   * split one concept across two codes and make the diagnostic harder to read,
   * not easier.
   *
   * What this is NOT is `string`. Every family is closed, which is what lets
   * `explainObservation` be keyed exhaustively on each one: a new code anywhere in
   * the pipeline is a compile error in the creator-facing copy until somebody has
   * written what it means to the person reading the result.
   */
  code: PipelineObservationCode | ProviderErrorCode | ObservationCode;
  message: string;
  /** True when the provider itself said the UI should degrade, not error. */
  recoverable: boolean;
}

export interface PipelineInput {
  profile: CreatorProfile;
  provider: CulturalIntelligenceProvider;
  /** Curated registry. Injected rather than imported so tests can vary it. */
  brands: readonly RegistryBrand[];
  thresholds?: AnalysisThresholds;
  /**
   * Resolve free-text interests through `/search`. Default true. Pass false when
   * the caller already resolved them during onboarding, so a re-run does not
   * repeat the calls.
   */
  resolveInterests?: boolean;
  /** Cap on brands carried through to the final opportunity list. */
  maxBrands?: number;
  /** Fixed timestamp for deterministic tests. Defaults to now. */
  generatedAt?: string;
  /**
   * Optional progress sink, emitted at each real stage boundary so the route can
   * stream it to the analyzing screen. It never affects the result: the pipeline
   * produces the same `PipelineOutcome` whether or not a handler is attached, so
   * a handler must stay side-effect-only. Absent for tests and the cached path.
   */
  onStage?: (event: StageEvent) => void;
}

export interface PipelineOutcome {
  analysis: CreatorAnalysis;
  failures: PipelineFailure[];
  /** True when at least one interest resolved to an entity id. */
  hasSignals: boolean;
  /**
   * Whether this outcome may be presented to the creator as personalised.
   *
   * This is `taste.renderable && hasSignals`, and it is NOT the same thing as
   * `taste.renderable`. The Taste DNA stage only reports `false` at L4, which it
   * reaches when the provider says the signals were IGNORED. A creator who
   * confirmed nothing produces no signals at all, so that stage is never asked
   * and reports `true` — while every visualisation built below was blanked by the
   * `hasSignals` half of this conjunction. Exposing the pipeline's own value is
   * what stops a caller from reading the stage's narrower flag and concluding the
   * outcome is presentable when the pipeline had already decided it was not.
   */
  renderable: boolean;
  /** The Taste DNA stage result, exposed so callers can show degradations. */
  taste: TasteDnaResult;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function runAnalysis(input: PipelineInput): Promise<PipelineOutcome> {
  const thresholds = input.thresholds ?? DEFAULT_THRESHOLDS;
  const maxBrands = input.maxBrands ?? 12;
  const failures: PipelineFailure[] = [];
  const provider = input.provider;
  const source = provider.source;
  const capabilities = provider.capabilities();

  /** Emit a stage boundary. A no-op when no handler is attached, so the outcome
   *  is identical with and without streaming. */
  const report = (id: PipelineStageId, status: StageStatus): void => {
    input.onStage?.(stageEvent(id, status));
  };

  // -- Stage 1: resolve interests ------------------------------------------
  const shouldResolve = input.resolveInterests !== false;
  report("interests", shouldResolve ? "start" : "skipped");
  const interests = shouldResolve
    ? await resolveInterests(input.profile.selectedInterests, provider, failures)
    : input.profile.selectedInterests;
  if (shouldResolve) report("interests", "done");

  const profile: CreatorProfile = { ...input.profile, selectedInterests: interests };
  const signals = toCreatorSignals(profile);
  const hasSignals = signals.entityIds.length > 0;

  if (!hasSignals) {
    failures.push({
      step: "signals",
      code: "no_resolved_signals",
      message:
        "None of the selected interests resolved to an entity id, so no personalisation was possible. The provider was not called: it requires at least one valid signal.",
      recoverable: true,
    });
  }

  // -- Stage 2: provider calls, in parallel where independent ---------------
  const signalBlock = toSignalBlock(signals);
  const take = capabilities.maxTake;
  const explainability = capabilities.supported.explainability;
  const scope = `profile:${profile.id}`;

  const filterTypes = filterTypesFor(interests);

  if (hasSignals && filterTypes.length === 0) {
    failures.push({
      step: "filterTypes",
      code: "no_mappable_entity_type",
      message:
        "Interests resolved, but none of their entity types has an Insights `filter.type` equivalent, so no recommendations could be requested. Nothing was substituted.",
      recoverable: true,
    });
  }

  // The three taste-building provider calls are independent, so they run
  // concurrently and all start at the same instant. Each reports its own
  // `done`/`skipped` as its promise settles, which is what makes the analyzing
  // screen light up in completion order rather than all at once. A call that
  // returns nothing is `skipped`, not `done` — the honest reading is "no data came
  // back for this", which is exactly how the dimension is treated downstream.
  // With no signals the calls never happen, so each stage is `skipped` without a
  // `start`.
  //
  // BRAND DISCOVERY IS NOT IN THIS GROUP. It used to be, and that forced it to run
  // on the declared signals alone, because the Creator Taste DNA it is supposed to
  // be driven by did not exist yet at that point. Discovery now waits for Stage 3
  // and runs in Stage 3b. The cost is one serialised round-trip; what it buys is a
  // candidate list drawn from the cultural profile the creator's input turned into,
  // rather than from the handful of things they typed.
  if (hasSignals) {
    report("recommendations", "start");
    report("tags", "start");
    report("demographics", "start");
  } else {
    report("recommendations", "skipped");
    report("tags", "skipped");
    report("demographics", "skipped");
  }

  const [entityPairs, declaredSet, tagResult, demographicsResult] = hasSignals
    ? await Promise.all([
        recommendEntitySets(provider, signalBlock, filterTypes, take, explainability, scope, failures).then(
          (pairs) => {
            report("recommendations", pairs.length > 0 ? "done" : "skipped");
            return pairs;
          },
        ),
        // Runs beside the recommendation calls, not after them: a fourth
        // independent question to the same provider, so serialising it would add a
        // round-trip to every analysis for nothing. Reported under no stage of its
        // own — it is part of asking the catalogue about this creator, and the
        // eleven stages the creator can see must correspond to eleven things that
        // happened rather than to a call count.
        scoreDeclaredEntities(
          provider,
          signalBlock,
          filterTypes,
          take,
          scope,
          failures,
        ),
        attempt("recommendTags", failures, () =>
          provider.recommendTags({
            filterType: "urn:tag",
            signals: signalBlock,
            take,
            explainability,
            scope,
          }),
        ).then((tags) => {
          report("tags", tags === undefined ? "skipped" : "done");
          return tags;
        }),
        attempt("demographics", failures, () =>
          provider.demographics({
            // The live adapter rewrites this to `urn:demographics`; the synthetic
            // one uses it to pick a candidate pool. Either way it must be a valid
            // enum member, so the dominant interest type is the honest choice.
            filterType: filterTypes[0] ?? "urn:entity:brand",
            signals: signalBlock,
            take,
            scope,
          }),
        ).then((demographics) => {
          report("demographics", demographics === undefined ? "skipped" : "done");
          return demographics;
        }),
      ])
    : ([[], undefined, undefined, undefined] as [
        EntityPair[],
        EntityResultSet | undefined,
        undefined,
        undefined,
      ]);

  // The declared set goes FIRST. `poolEntities` records `sourceSet` and keeps the
  // higher-ranked row when an id appears twice, so ordering only matters for a tie
  // — and on a tie the entity the creator named themselves should win against an
  // expansion result for the same id.
  const entityResults =
    declaredSet === undefined
      ? entityPairs.map((pair) => pair.set)
      : [declaredSet, ...entityPairs.map((pair) => pair.set)];

  // -- Stage 2b: silent-ignore detection (doc 03 §11, fallback level L4) -----
  // Runs only when there ARE signals and at least one recommendation set came
  // back, otherwise there is nothing to compare and nothing to accuse the
  // provider of. The cost is one extra call; the alternative is shipping a
  // profile that is really a generic popularity list.
  // The canary runs only when there is a smaller signal set to compare against
  // and at least one recommendation set came back; otherwise there is nothing to
  // accuse the provider of and the stage is honestly `skipped`. Its preconditions
  // are checked here rather than inferred from the return value, because
  // `detectIgnoredSignals` returns `undefined` both when it ran and found no
  // ignoring (a pass) and when it could not run at all.
  const canaryRuns = signalBlock.entityIds.length >= 2 && entityPairs.length > 0;
  report("canary", canaryRuns ? "start" : "skipped");
  const ignored = await detectIgnoredSignals(
    provider,
    signalBlock,
    entityPairs,
    take,
    scope,
    failures,
  );
  if (canaryRuns) report("canary", "done");
  const pipelineObservations: ProviderObservation[] = ignored === undefined ? [] : [ignored];

  // -- Stage 3: Taste DNA (M2 + M3, with M1 as an enhancement) --------------
  report("taste", "start");
  const taste = assembleTasteDna({
    signals,
    declaredCategories: profile.coverage.coveredCategories,
    entityResults,
    tagResults: tagResult,
    pipelineObservations,
    thresholds,
  });
  report("taste", "done");

  const renderable = taste.renderable && hasSignals;
  const level = hasSignals ? taste.level : "L4";

  // -- Stage 3b: brand discovery, driven by the Creator Taste DNA -------------
  // The fundamental pipeline change. Discovery is no longer "find brands related
  // to the keywords the creator typed"; it is "find brands related to the cultural
  // profile those keywords turned into". That profile only exists at this point,
  // which is why this call moved out of the parallel group above.
  //
  // The declared entities are always sent. They are the creator's confirmed intent,
  // and quietly dropping one would narrow the search without telling them. What is
  // added is the strongest ground the catalogue expanded those entities into,
  // bounded, so the request cannot grow without limit and the declared intent is
  // never diluted past recognition.
  const discoverySignals = hasSignals ? tasteLedSignalBlock(signalBlock, taste) : undefined;
  report("brands", discoverySignals === undefined ? "skipped" : "start");
  const brandResults: EntityResultSet | undefined =
    discoverySignals === undefined
      ? undefined
      : await discoverBrands(provider, discoverySignals, take, explainability, scope, failures).then(
          (brands) => {
            report("brands", brands === undefined ? "skipped" : "done");
            return brands;
          },
        );

  // -- Stage 3c: brand discovery is reported honestly when it comes back empty --
  // Doc 02 §21 and the brief: no static list may be substituted. An empty brand
  // result is a legitimate outcome of a live call, and saying so is the only thing
  // that stops an empty brand section reading as a bug.
  //
  // Recorded as `PipelineFailure`s rather than observations because
  // `ObservationCode` is a documented closed set owned by the provider layer (see
  // the note on `detectIgnoredSignals`), while `PipelineFailure.code` draws on
  // `PipelineObservationCode` — a separate closed set — precisely so a
  // pipeline-level fact does not have to masquerade as something the API said.
  // The mapper separately emits `empty_result_set` for
  // the same condition; this adds the part only the pipeline knows, which is that
  // nothing was substituted for it. Both are `recoverable`, so neither turns the
  // run into an error screen.
  if (hasSignals && brandResults !== undefined && brandResults.entities.length === 0) {
    failures.push({
      step: "brands",
      code: "brand_discovery_empty",
      message:
        "The data source returned no brands for these signals. No static or curated list was substituted, so the brand section is empty rather than filled with a guess.",
      recoverable: true,
    });
  } else if (hasSignals && brandResults === undefined) {
    failures.push({
      step: "brands",
      code: "brand_discovery_failed",
      message:
        "The brand discovery call did not return a usable result set. No fallback list was substituted, so the brand section is empty.",
      recoverable: true,
    });
  }

  // -- Stage 4: Brand Taste DNA, then the intersection -----------------------
  // Before anything is ranked, every discovered brand gets its own cultural profile
  // and that profile is compared with the creator's. This is the step that turns a
  // list of entities a search returned into a list of recommendations with a reason
  // attached, and it has to exist before the ranking rather than after it.
  //
  // It runs as its own pass, separate from scoring, for one reason: a stage the
  // creator can see has to correspond to work that actually happened at that point.
  // Folding it into `scoreBrands` would have made the `intersection` stage a label
  // over arithmetic that was really happening inside `scoring`.
  report("intersection", brandResults === undefined ? "skipped" : "start");
  const intersections = buildIntersections({
    brandResults,
    creatorTags: taste.allTags,
    declaredIds: signals.entityIds,
  });
  if (brandResults !== undefined) report("intersection", "done");

  // -- Stage 5: opportunities ----------------------------------------------
  report("opportunities", "start");
  const opportunitiesDerivation = deriveOpportunities({
    categories: taste.dna.categories,
    saturation: profile.coverage.saturation,
    coveredCategories: profile.coverage.coveredCategories,
    thresholds,
  });
  report("opportunities", "done");

  // -- Stage 6: brand scoring & fit ----------------------------------------
  // `profile.audience` and `profile.platforms` are deliberately NOT read here. They
  // are explanation inputs, and §5.3's "separate contextual content explanation"
  // lives in the copy layer, which receives them as already-resolved words at render
  // time. Threading them into the analysis would break two things at once:
  // `analysisCacheKey` excludes the audience answers, so two creators who share a
  // cache entry would receive each other's wording; and an explanation that has
  // entered a computed field has stopped being one. See the "audience context —
  // explanation only, never evidence" suites in tests/pipeline.test.ts and
  // tests/flowTypes.test.ts, which assert whole-analysis equality.
  report("scoring", "start");
  const scoredBrands = scoreBrands({
    registry: input.brands,
    brandResults,
    demographics: demographicsResult,
    signals,
    taste,
    intersections,
    source,
    level,
    saturation: profile.coverage.saturation,
    coveredCategories: profile.coverage.coveredCategories,
    renderable,
    maxBrands,
  });

  const brandMap = buildBrandRelationshipMap({
    brands: scoredBrands.map((entry) => ({
      brandId: entry.brandId,
      brandName: entry.name,
      category: entry.category,
      fit: entry.fit,
    })),
    declared: taste.dna.declared,
    categories: taste.dna.categories,
    pool: taste.pool,
    source,
    level,
    renderable,
  });

  const opportunityList: BrandOpportunity[] = rankOpportunities(
    scoredBrands.map((entry) =>
      toBrandOpportunity({
        brand: entry.enriched,
        fit: entry.viewModel,
        coverage: entry.coverage,
        pathway: brandMap.pathways.find((pathway) => pathway.brandId === entry.brandId),
        drivers: entry.drivers,
        brandTaste: entry.brandTaste,
        intersection: entry.intersection,
        // Carried as metadata so the card can say WHY the catalogue returned this
        // brand. `toBrandOpportunity` derives `isUntapped` from the intersection and
        // coverage itself; discovery position no longer feeds it (§4.2, §7.2).
        discovery: entry.discovery,
        thresholds,
      }),
    ),
  ).slice(0, maxBrands);
  report("scoring", "done");

  // -- Stage 7: visualisation view-models ----------------------------------
  report("viewmodels", "start");
  const declaredNames = signals.entityNames;

  const analysis: CreatorAnalysis = {
    creatorId: profile.id,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    source,
    fallbackLevel: level,
    observations: mergeObservations(taste.observations, entityResults, tagResult, demographicsResult, brandResults, failures),
    tasteDna: { ...taste.dna, level, levelDescription: taste.dna.levelDescription },
    network: buildTasteDnaNetwork({
      dna: taste.dna,
      pool: taste.pool,
      signals,
      source,
      level,
      renderable,
    }),
    affinityRanking: buildAffinityRanking({
      pool: taste.pool,
      source,
      level,
      renderable,
      declaredEntityIds: signals.entityIds,
      declaredNames,
      tieTolerance: thresholds.tieTolerance,
    }),
    opportunityGap: buildOpportunityGap({
      derivation: opportunitiesDerivation,
      source,
      level,
      renderable,
      thresholds,
    }),
    brandMap,
    brandFits: scoredBrands.map((entry) => entry.viewModel),
    fingerprint: buildTasteFingerprint({
      dna: taste.dna,
      source,
      level,
      renderable,
      creatorId: profile.id,
    }),
    opportunities: opportunityList,
    // What the rendered brand list, as a whole, was able to establish. Computed from
    // `opportunityList` rather than from `scoredBrands` so the sentence and the cards
    // beside it describe the same brands (§7.1).
    brandEvidenceSummary: summariseBrandEvidence(opportunityList),
    unresolvedInterests: signals.unresolved.map((entry) => ({
      query: entry.query,
      reason:
        entry.reason === "ambiguous"
          ? "More than one entity matched this text, and you did not confirm which one you meant, so it contributed no signal. Pick the right match to include it."
          : "Nothing in the catalogue matched this text, so it contributed no signal. It was not sent to the data source as an entity.",
    })),
    // Context-only phrases. Never signals: they carry no entity id, so nothing
    // here reached Qloo. Surfaced so the results can acknowledge what the creator
    // wrote instead of quietly discarding it.
    contextTerms: [...new Set((profile.contextTerms ?? []).map((term) => term.trim()).filter(Boolean))],
  };

  report("viewmodels", "done");

  return { analysis, failures, hasSignals, renderable, taste };
}

// ---------------------------------------------------------------------------
// Stage 1: interest resolution
// ---------------------------------------------------------------------------

/**
 * Resolve free-text interests through `/search` (doc 03 §8 step 1).
 *
 * Doc 02 §7 is the constraint that matters: when several entities match, the
 * creator must choose. Auto-picking the top hit would silently substitute our
 * guess for their intent, and every downstream number would then be about a
 * different thing than they asked about. So: exactly one match resolves, more
 * than one is marked `ambiguous` and reported back, zero is `not_found`.
 *
 * In the normal flow this is a no-op: the `/analyze` review stage resolves every
 * phrase against live search results and only forwards the ones the creator
 * confirmed, each already carrying an `entityId`. This function is the fallback
 * for a caller that did not do that, and it deliberately stays strict — an
 * exact-name match is NOT auto-selected, because two entities in different
 * categories can share a name and picking between them is the creator's call.
 */
export async function resolveInterests(
  interests: readonly SelectedInterest[],
  provider: CulturalIntelligenceProvider,
  failures: PipelineFailure[],
): Promise<SelectedInterest[]> {
  const resolved: SelectedInterest[] = [];

  for (const interest of interests) {
    if (interest.entityId !== undefined && interest.resolution === "resolved") {
      resolved.push(interest);
      continue;
    }

    // Scoped by the interest's own type when it has one, which is the case for a
    // confirmed interest whose id was lost between client and server. An unscoped
    // search for "Dune" returns films, books and artists alike and guarantees an
    // `ambiguous` verdict; scoping it does not guess anything, it just asks the
    // question that was already answered.
    const types = interest.subtype === undefined ? undefined : [interest.subtype];
    const result = await attempt(`search:${interest.query}`, failures, () =>
      provider.search({ query: interest.query, types, take: 5 }),
    );

    if (result === undefined || result.matches.length === 0) {
      resolved.push({ ...interest, resolution: "not_found" });
      continue;
    }
    if (result.matches.length > 1) {
      resolved.push({ ...interest, resolution: "ambiguous" });
      continue;
    }

    const entity = result.matches[0]!.entity;
    resolved.push({
      ...interest,
      entityId: entity.id,
      name: entity.name,
      // `subtype` is the finer URN when Qloo returned one, but the pipeline also
      // needs SOME type to choose a recommendation `filter.type` from. Falling
      // back to `type` keeps that possible without adding a second field to the
      // creator contract.
      subtype: entity.subtype ?? entity.type,
      disambiguation: entity.disambiguation,
      imageUrl: entity.imageUrl,
      resolution: "resolved",
    });
  }

  return resolved;
}

// ---------------------------------------------------------------------------
// Stage 2: provider calls
// ---------------------------------------------------------------------------

function toSignalBlock(signals: CreatorSignals): SignalBlock {
  const demographics = signals.demographics;
  return {
    entityIds: signals.entityIds,
    tagIds: signals.tagIds.length > 0 ? signals.tagIds : undefined,
    demographics:
      demographics === undefined
        ? undefined
        : {
            ageBuckets: demographics.ageBuckets.length > 0 ? [...demographics.ageBuckets] : undefined,
            gender: demographics.gender,
            audienceIds: demographics.audienceIds.length > 0 ? [...demographics.audienceIds] : undefined,
          },
    location:
      // Omitted entirely when neither a query nor a locality id exists. A
      // country-only location is real input (it drives the geographic dimension)
      // but is NOT a Qloo location signal: doc 03 §10 lists no country parameter,
      // and a `signal.location.query` that matches no locality is a 400 which
      // would take the entire insights call down with it.
      signals.location === undefined ||
      (signals.location.query === undefined && signals.location.localityId === undefined)
        ? undefined
        : { query: signals.location.query, localityId: signals.location.localityId },
  };
}

/**
 * Which `filter.type` values to recommend in.
 *
 * `filter.type` is required and singular (doc 03 §4), so a genuinely
 * cross-category Taste DNA has to be assembled from one call per type. The types
 * come from what the creator actually selected, mapped through
 * `insightsTypeFor()`, ordered by how many interests fell in each. Picking a
 * default type when nothing maps would mean recommending in a category nobody
 * asked about, so that case is reported as a failure instead.
 */
const MAX_RECOMMENDATION_TYPES = 4;

export function filterTypesFor(
  interests: readonly SelectedInterest[],
): QlooInsightsEntityType[] {
  const counts = new Map<QlooInsightsEntityType, number>();

  for (const interest of interests) {
    if (interest.resolution !== "resolved") continue;
    const type = insightsTypeFor(interest.subtype);
    if (type === undefined) continue;
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_RECOMMENDATION_TYPES)
    .map(([type]) => type);
}

/**
 * One recommendation call's output paired with the `filter.type` it was made
 * under. The type travels with the set rather than being re-derived later,
 * because the silent-ignore canary must be issued with the SAME type or the
 * comparison is between two different questions.
 */
type EntityPair = { filterType: QlooInsightsEntityType; set: EntityResultSet };

/**
 * M2 entity recommendations — one call per mapped interest type.
 *
 * Each call is its own result set with its own within-set normalisation, and
 * `poolEntities()` merges them without ever comparing raw affinities across
 * calls (doc 04 §4.4). Cross-domain backfill is requested per call when the
 * provider supports it: doc 03 §8 step 3 makes it the API's OWN "beyond your
 * niche" signal, which is stronger evidence than anything we could derive.
 *
 * The `filterType` is kept alongside each set because the silent-ignore check
 * needs to compare a canary call made with the SAME type.
 */
async function recommendEntitySets(
  provider: CulturalIntelligenceProvider,
  signals: SignalBlock,
  filterTypes: readonly QlooInsightsEntityType[],
  take: number,
  explainability: boolean,
  scope: string,
  failures: PipelineFailure[],
): Promise<EntityPair[]> {
  if (filterTypes.length === 0) return [];
  const supportsBackfill = provider.capabilities().supported.crossDomainBackfill;

  const sets = await Promise.all(
    filterTypes.map((filterType) =>
      attempt(`recommendEntities:${filterType}`, failures, () =>
        provider.recommendEntities({
          filterType,
          signals,
          take,
          explainability,
          crossDomainBackfill: supportsBackfill,
          scope: `${scope}:${filterType}`,
        }),
      ),
    ),
  );

  return sets.flatMap((set, index) =>
    set === undefined ? [] : [{ set, filterType: filterTypes[index]! }],
  );
}

/**
 * The creator's OWN confirmed entities, fetched as a result set of their own.
 *
 * WHY THIS CALL EXISTS
 * --------------------
 * `recommendEntities` deliberately refuses to echo the creator's inputs back — a
 * recommendation list made only of things they already named would be worthless.
 * The consequence, unless the inputs are asked for separately, is that the pool is
 * made ENTIRELY of expansion. Two failures follow, and both were live:
 *
 *   1. The tastes a confirmed entity is the sole evidence for never reach
 *      `deriveCoreTastes`. A streetwear creator who confirmed three hip-hop
 *      entities came back with no hip-hop in their own profile. Worse, a creator
 *      whose niche is narrow enough that the catalogue has few neighbours came back
 *      with an EMPTY one: every tag then had support 1 and failed `minTagSupport`,
 *      so `allTags` was empty, every intersection said "nothing to compare
 *      against", and the loop in doc 05 §30 stopped at its second step.
 *   2. Two distinctions became unrepresentable. `intersectTaste` calls a shared
 *      dimension `direct` when an entity that produced it is one the creator
 *      confirmed, and `partitionTasteDna` calls a taste `core` on the same test.
 *      With confirmed entities absent from `contributedBy`, every match in every
 *      run was `adjacent` and every taste was `adjacent`. The guards that skip
 *      declared ids in `deriveUnexpectedAffinities` and `discoveredList` were dead
 *      code for the same reason.
 *
 * WEIGHTING
 * ---------
 * The mapper's within-set normalisation is discarded: every confirmed entity carries
 * `rank.value = 1` with `method: "declared"`. Normalising them against each other
 * would be a category error — they are not a ranked recommendation set, they are
 * assertions the creator made — and min-max would hand the last of them a weight of
 * zero, reporting one of their own stated interests as carrying no evidence at all.
 * Equal full weight is the only reading that does not invent an ordering between
 * them. It is deliberately NOT comparable to a recommendation's normalised score,
 * and is labelled differently so no disclosure can imply that it is.
 *
 * WHY IT SENDS NO SIGNALS
 * -----------------------
 * Passing the confirmed ids as BOTH `signal.interests.entities` and
 * `filter.results.entities` — what this call used to do — returns an empty set
 * every time, because Qloo excludes its own signal entities from its results.
 * Verified live 2026-10-26: with the two lists identical the response was
 * `200 { results: { entities: [] } }`; with `filter.results.entities` alone and no
 * signals at all it was `200` with every requested entity and its full tag set.
 * So the call that existed precisely to stop the pool being made entirely of
 * expansion was itself contributing nothing, and every consequence listed above
 * (no `core` tastes, no `direct` dimensions, dead declared-id guards) was live.
 *
 * The affinity that call would have produced is discarded anyway — see WEIGHTING —
 * so there is no scoring to lose by not signalling. Explainability is turned off
 * for the same reason: with no signals there is nothing for a contribution to
 * point at, and asking for one would only generate an empty object that the mapper
 * would then report as a provider failure.
 */
async function scoreDeclaredEntities(
  provider: CulturalIntelligenceProvider,
  signals: SignalBlock,
  filterTypes: readonly QlooInsightsEntityType[],
  take: number,
  scope: string,
  failures: PipelineFailure[],
): Promise<EntityResultSet | undefined> {
  if (signals.entityIds.length === 0) return undefined;

  if (!provider.capabilities().supported.entityScoring) {
    // Recorded rather than silently skipped: without it the profile is expansion
    // only, and the creator-side half of every intersection rests on that gap.
    failures.push({
      step: "scoreEntities:declared",
      code: "entity_scoring_unsupported",
      message:
        "The data source cannot score a specific entity set, so the creator's own confirmed interests could not be read back out of it. Their Taste DNA is derived from expansion alone, and no shared taste can be attributed to an entity they confirmed.",
      recoverable: true,
    });
    return undefined;
  }

  const result = await attempt("scoreEntities:declared", failures, () =>
    provider.scoreEntities({
      // The dominant interest type, for the same reason `demographics` uses it: it
      // has to be a valid enum member, and this is the one the creator's own
      // interests actually fall in. It does NOT restrict the readback — the ids
      // below do — which is why a creator with a mixed profile still gets every
      // one of their confirmed interests back.
      filterType: filterTypes[0] ?? "urn:entity:brand",
      // Deliberately empty. See WHY IT SENDS NO SIGNALS above.
      signals: { entityIds: [] },
      candidateEntityIds: [...signals.entityIds],
      take: Math.max(take, signals.entityIds.length),
      // The readback's purpose is the entities' own descriptors, not a ranking.
      explainability: false,
      scope: `${scope}:declared`,
    }),
  );
  if (result === undefined) return undefined;

  // Only ids the creator actually confirmed. A scoring hook is free to return more
  // than it was asked for, and anything it adds was not asserted by anyone.
  const declared = new Set(signals.entityIds);
  const entities = result.entities
    .filter((entity) => declared.has(entity.id))
    .map((entity, index, all) => ({
      ...entity,
      rank: { value: 1, method: "declared" as const, rank: index, setSize: all.length },
    }));
  if (entities.length === 0) {
    // Not the same as "the creator confirmed nothing" — they did, and this says
    // the readback could not produce them. Recording it keeps the profile
    // honestly partial instead of silently expansion-only.
    failures.push({
      step: "scoreEntities:declared",
      code: "declared_readback_empty",
      message: `The data source was asked to return ${declared.size} confirmed interest${declared.size === 1 ? "" : "s"} by id and returned none of them. Their descriptors could not be read back, so this Taste DNA is derived from catalogue expansion alone and no shared taste can be attributed to an entity the creator confirmed.`,
      recoverable: true,
    });
    return undefined;
  }

  // A partial readback is a partial basis. The creator's own entities are the
  // strongest evidence in the profile, so losing some of them is not something
  // the result should carry silently.
  const missing = [...declared].filter((id) => !entities.some((entity) => entity.id === id));
  const meta = { ...result.meta, resultCount: entities.length };
  if (missing.length > 0) {
    meta.observations = [
      ...meta.observations,
      {
        code: "items_rejected" as const,
        detail: `${missing.length} of ${declared.size} confirmed interests were not returned by the readback and contributed no descriptors. The creator-side half of this profile is PARTIAL.`,
        severity: "warning" as const,
      },
    ];
  }

  return { ...result, entities, meta };
}

/**
 * Detect a provider that silently ignores its signals (doc 03 §11, fact F22).
 *
 * This is the single most dangerous failure mode in the whole product, because
 * it returns HTTP 200 with plausible-looking data. Everything downstream would
 * then render an unpersonalised result set AS the creator's Taste DNA — the exact
 * outcome doc 04 §4.5 calls unacceptable and labels L4.
 *
 * Detection: repeat one recommendation call with a MATERIALLY DIFFERENT signal
 * set (a single interest instead of all of them) and compare. If the ordering
 * does not move, the signals are not being used.
 *
 * Three details make this correct rather than merely plausible:
 *
 *   - The comparison is over the RELATIVE ORDER of ids present in BOTH sets, not
 *     over the raw lists. Declared interests are excluded from recommendations,
 *     and the canary declares fewer of them, so the two lists legitimately differ
 *     in membership even when personalisation works perfectly. Comparing raw
 *     lists would report a false positive on almost every creator.
 *   - Membership divergence is itself a PASS, and is checked first. A provider
 *     that ignored its signals would return the same set twice, so when most of
 *     the set changed the signals demonstrably moved the result and there is
 *     nothing to accuse. Ordering is only read once the two sets are substantially
 *     the same set.
 *   - At least three shared ids are required. Two ids in the same order is a coin
 *     flip and proves nothing.
 *
 * A false positive here costs a refused render, which is the safe direction; a
 * false negative costs a fabricated profile. The thresholds are set accordingly —
 * but "safe direction" only holds while the verdict is TRUE. This one reaches the
 * creator as a critical finding about the data source, so a false accusation
 * blanks a genuinely personalised analysis for a reason that did not happen. That
 * is a fabrication pointed the other way, which is why divergence is recorded as a
 * pass rather than shrugged off as inconclusive: observed live on a six-place
 * profile whose two calls shared 3 of 50 entities, where 47 differing results
 * were discarded and the 3 survivors' one-in-six ordering coincidence was
 * reported instead.
 *
 * Cost: one extra call per analysis, on the first mapped type only.
 *
 * When the check cannot run it returns nothing — but "could not run" is never
 * silent. Each case records a `PipelineFailure` instead: `no_resolved_signals`
 * and `no_mappable_entity_type` upstream, `ignore_check_unavailable` when only
 * one interest resolved, `ignore_check_inconclusive` when the two sets are nearly
 * the same set but too small to compare an ordering. No new `ObservationCode` is
 * invented for these, because that union is a documented closed set owned by the
 * provider layer; they live in `PipelineObservationCode`, which is closed too, so
 * the creator-facing copy has to explain each one before it can ship.
 */
const MIN_SHARED_FOR_IGNORE_CHECK = 3;

/**
 * The shared ids must cover at least this fraction of the SMALLER set before an
 * unchanged ordering may be read as "the signals were ignored".
 *
 * Half, because that is where "substantially the same set" stops being true: two
 * 50-result sets sharing 24 members are different sets, and the relative order of
 * the minority that survived both calls is not evidence about the calls as a
 * whole. It also makes the ordering test statistically meaningful — once the sets
 * are at least half shared, the number of possible orderings of the shared subset
 * grows past any plausible coincidence, so the one-in-six exposure that exactly
 * three shared ids carried cannot recur.
 */
const MIN_SET_OVERLAP_FOR_IGNORE_CHECK = 0.5;

async function detectIgnoredSignals(
  provider: CulturalIntelligenceProvider,
  signals: SignalBlock,
  pairs: readonly EntityPair[],
  take: number,
  scope: string,
  failures: PipelineFailure[],
): Promise<ProviderObservation | undefined> {
  if (pairs.length === 0) {
    // Every recommendation call failed, or nothing could be requested. That is
    // already recorded upstream by `recommendEntitySets` / the filter-type
    // guard, so adding a second failure would just duplicate it.
    return undefined;
  }

  if (signals.entityIds.length < 2) {
    failures.push({
      step: "silentIgnoreCanary",
      code: "ignore_check_unavailable",
      message:
        "Only one interest resolved, so there is no smaller signal set to compare against and the silent-ignore check (doc 03 §11) could not run. This is an absent check, not a passed one.",
      recoverable: true,
    });
    return undefined;
  }

  const primary = pairs[0]!;
  const canarySignals: SignalBlock = {
    ...signals,
    entityIds: [signals.entityIds[0]!],
  };

  const canary = await attempt("silentIgnoreCanary", failures, () =>
    provider.recommendEntities({
      filterType: primary.filterType,
      signals: canarySignals,
      take,
      explainability: false,
      scope: `${scope}:canary:${primary.filterType}`,
    }),
  );
  if (canary === undefined) return undefined;

  const primaryIds = primary.set.entities.map((entity) => entity.id);
  const canaryIds = canary.entities.map((entity) => entity.id);
  const canarySet = new Set(canaryIds);
  const primarySet = new Set(primaryIds);

  const sharedFromPrimary = primaryIds.filter((id) => canarySet.has(id));
  const sharedFromCanary = canaryIds.filter((id) => primarySet.has(id));

  // Divergence is checked BEFORE the shared-count floor, because it is a result
  // rather than an absence of one: the two calls came back with different sets, so
  // the signals were used, and filing `ignore_check_inconclusive` would record a
  // passed check as a failure. An empty set falls through (0 < 0 is false) and is
  // handled below as genuinely incomparable.
  const smallerSet = Math.min(primaryIds.length, canaryIds.length);
  if (sharedFromPrimary.length < smallerSet * MIN_SET_OVERLAP_FOR_IGNORE_CHECK) {
    return undefined;
  }

  if (sharedFromPrimary.length < MIN_SHARED_FOR_IGNORE_CHECK) {
    failures.push({
      step: "silentIgnoreCanary",
      code: "ignore_check_inconclusive",
      message: `The two recommendation sets shared only ${sharedFromPrimary.length} entities, fewer than the ${MIN_SHARED_FOR_IGNORE_CHECK} needed to compare an ordering, so the silent-ignore check was inconclusive.`,
      recoverable: true,
    });
    return undefined;
  }
  if (sharedFromPrimary.join("|") !== sharedFromCanary.join("|")) return undefined;

  return {
    code: "signals_appear_ignored",
    detail:
      "A recommendation call using a different subset of your interests returned the same ordering, so the data source does not appear to be using the signals at all. No taste profile is shown rather than presenting an unpersonalised result set as yours.",
    severity: "critical",
  };
}

/**
 * Discover the brands to score, for THIS creator's taste.
 *
 * One open recommendation call (`filter.type=urn:entity:brand`, sorted by
 * affinity) returns the brands the data source associates with the creator's
 * declared interests. This REPLACES scoring a fixed registry: a hand-curated list
 * can never contain the right brand for every niche, and scoring only registry
 * brands forced every result toward "moderate" for creators whose taste pointed
 * elsewhere (doc 02 §21 amendment).
 *
 * The whole discovered set is ONE within-set-normalised result set, so affinities
 * are comparable across every brand shown (doc 04 §4.4: never mix normalisation
 * sets). The curated registry is then used only to ENRICH a discovered brand that
 * happens to overlap it, carrying over any curator-verified partnership route the
 * registry holds for that brand — and nothing else, because a brand the registry
 * has never heard of is no less eligible for scoring than one it has.
 *
 * The signals it is given are the TASTE-LED ones — see `tasteLedSignalBlock`.
 */
async function discoverBrands(
  provider: CulturalIntelligenceProvider,
  signals: SignalBlock,
  take: number,
  explainability: boolean,
  scope: string,
  failures: PipelineFailure[],
): Promise<EntityResultSet | undefined> {
  const supportsBackfill = provider.capabilities().supported.crossDomainBackfill;
  const result = await attempt("discoverBrands", failures, () =>
    provider.recommendEntities({
      filterType: "urn:entity:brand",
      signals,
      take,
      explainability,
      crossDomainBackfill: supportsBackfill,
      scope: `${scope}:brands`,
    }),
  );
  return retainBrandsOnly(result, failures);
}

/**
 * The application-side half of the brand-only rule.
 *
 * The request already asked for `filter.type=urn:entity:brand` and the mapper
 * already excluded anything whose resolved type did not match, so on a live run
 * this normally passes everything through unchanged. It runs anyway, because
 * what reaches the creator is a list of companies they are being told they could
 * approach, and the guarantee behind that sentence has to be checked by the code
 * that publishes it rather than assumed from a parameter set two layers down. A
 * replayed cache entry, a synthetic fixture, or a catalogue that starts typing a
 * venue as something else would each sail past the mapper boundary; none sails
 * past this one.
 *
 * Type only, never name — see `isBrandEntity`. A brand-like name on a
 * wrong-typed entity is precisely the case this rejects.
 *
 * WHAT DROPPING LOOKS LIKE
 * ------------------------
 * Every exclusion is recorded twice: as an observation on the result set, so it
 * reaches the honesty panel, and as a pipeline failure, so it reaches the
 * diagnostics. Nothing is dropped quietly.
 *
 * An empty set after filtering is RETURNED, not turned into `undefined`. Those
 * are different statements: `undefined` means the call failed, an empty set
 * means it succeeded and found nothing eligible. Collapsing the second into the
 * first would report a validated exclusion as a provider outage, and collapsing
 * the first into the second is the confusion §2.2 forbids in the other
 * direction.
 */
function retainBrandsOnly(
  result: EntityResultSet | undefined,
  failures: PipelineFailure[],
): EntityResultSet | undefined {
  if (result === undefined) return undefined;

  const brands = result.entities.filter((entity) => isBrandEntity(entity));
  const excluded = result.entities.filter((entity) => !isBrandEntity(entity));
  if (excluded.length === 0) return result;

  const named = excluded
    .slice(0, 3)
    .map((entity) => `${entity.name} (${entity.type || "no type reported"})`)
    .join(", ");
  const detail = `${excluded.length} of ${result.entities.length} results returned by brand discovery were not typed as brands and were excluded before scoring: ${named}${
    excluded.length > 3 ? `, and ${excluded.length - 3} more` : ""
  }. A brand recommendation is a claim about what a creator could approach, so it is made only about entities the catalogue actually types as brands — never about a brand-like name.`;

  failures.push({
    step: "discoverBrands:typeValidation",
    code: "entity_type_excluded",
    message: detail,
    recoverable: true,
  });

  return {
    ...result,
    entities: brands,
    meta: {
      ...result.meta,
      resultCount: brands.length,
      observations: [
        ...result.meta.observations,
        { code: "entity_type_excluded" as const, detail, severity: "warning" as const },
      ],
    },
  };
}

/**
 * How many entity signals a brand discovery request may carry.
 *
 * Bounded for two reasons. Latency and payload grow with the signal count, and an
 * unbounded list would make the slowest call in the pipeline scale with how
 * chatty the catalogue was. More importantly, dilution: a request built on forty
 * entities is not "this creator's taste", it is "everything within four hops of
 * this creator's taste", and the brands it returns stop being distinguishable from
 * a popularity list. Eight keeps the declared entities — normally four to six —
 * plus the two or three strongest expansions.
 */
const MAX_DISCOVERY_SIGNALS = 8;

/**
 * The signal block brand discovery actually runs on.
 *
 * The declared entities first, always, then the strongest entities the catalogue
 * expanded them into. `taste.pool` is already sorted by within-set normalised score,
 * so "strongest" is the ordering the Taste DNA itself produced rather than a second
 * ranking invented here.
 *
 * WHY THE DECLARED ONES ARE NEVER DROPPED
 * ---------------------------------------
 * They are the creator's confirmed intent. Replacing them with derived entities
 * would mean the brand list was chosen by our expansion of what they said rather
 * than by what they said, and a creator who confirmed "mechanical keyboards" would
 * have no way to see that in the results. Expansion ADDS ground; it does not
 * substitute for it.
 *
 * Returns the input block unchanged when there is nothing to add, so the common
 * case does not allocate a second object for no reason.
 */
function tasteLedSignalBlock(base: SignalBlock, taste: TasteDnaResult): SignalBlock {
  const entityIds = [...base.entityIds];
  const seen = new Set(entityIds);

  for (const entity of taste.pool) {
    if (entityIds.length >= MAX_DISCOVERY_SIGNALS) break;
    if (seen.has(entity.id)) continue;
    seen.add(entity.id);
    entityIds.push(entity.id);
  }

  return entityIds.length === base.entityIds.length ? base : { ...base, entityIds };
}

/**
 * Keyword → category vocabulary for classifying a DISCOVERED brand that is not in
 * the curated registry. Ordered specific → general so the deterministic
 * first-wins tie-break reads sensibly (e.g. an automotive+technology brand lands
 * in `automotive`). This is DESCRIPTIVE metadata derived from Qloo, never a
 * hand-curated partnership claim (doc 02 §21). `other` is the honest default.
 */
const CATEGORY_KEYWORDS: ReadonlyArray<[BrandCategory, readonly string[]]> = [
  ["automotive", ["automotive", "automobile", "automaker", "vehicle", "vehicles", "motor", "motors", "car", "cars", "truck", "trucks"]],
  ["gaming", ["gaming", "videogame", "videogames", "video game", "video games", "esports", "game", "games"]],
  ["footwear", ["footwear", "shoe", "shoes", "sneaker", "sneakers"]],
  ["beauty", ["beauty", "cosmetic", "cosmetics", "skincare", "makeup", "personal care", "fragrance"]],
  ["food_beverage", ["food", "foods", "beverage", "beverages", "drink", "drinks", "snack", "snacks", "restaurant", "restaurants", "coffee", "grocery", "dairy", "packaged goods", "cpg"]],
  ["finance", ["finance", "financial", "bank", "banking", "insurance", "fintech", "investment", "investments", "payments", "credit"]],
  ["travel", ["travel", "tourism", "hotel", "hotels", "airline", "airlines", "hospitality", "vacation", "vacations"]],
  ["fitness", ["fitness", "gym", "wellness", "athletic", "athletics", "exercise", "sport", "sports"]],
  ["apparel", ["apparel", "clothing", "fashion", "sportswear", "garment", "garments"]],
  ["consumer_tech", ["technology", "technologies", "tech", "electronics", "electronic", "software", "computer", "computers", "hardware", "semiconductor", "semiconductors", "telecommunications", "telecom"]],
  ["media_entertainment", ["media", "entertainment", "streaming", "film", "films", "movie", "movies", "television", "music", "record label", "records", "publishing", "broadcasting"]],
  ["home_lifestyle", ["home", "furniture", "lifestyle", "household", "interior", "kitchen"]],
];

/** Lowercased industries + tag names + description: the text a category is read from. */
function categoryHaystack(entity: CulturalEntity): string {
  return [
    ...(entity.industries ?? []),
    ...entity.tags.map((tag) => tag.name),
    entity.description ?? "",
  ]
    .join(" ")
    .toLowerCase();
}

/**
 * Derive a descriptive brand category from Qloo metadata.
 *
 * Whole-token matches for single words (so "sport" never matches "sportswear")
 * and substring matches for multi-word phrases. The category with the most keyword
 * hits wins; ties fall to the earlier entry in `CATEGORY_KEYWORDS`. No hit at all
 * yields `other` rather than a guess.
 */
function deriveBrandCategory(entity: CulturalEntity): BrandCategory {
  const haystack = categoryHaystack(entity);
  const tokens = new Set(haystack.split(/[^a-z0-9]+/).filter((token) => token.length > 0));

  let best: BrandCategory = "other";
  let bestHits = 0;
  for (const [category, keywords] of CATEGORY_KEYWORDS) {
    let hits = 0;
    for (const keyword of keywords) {
      if (keyword.includes(" ") ? haystack.includes(keyword) : tokens.has(keyword)) hits += 1;
    }
    if (hits > bestHits) {
      bestHits = hits;
      best = category;
    }
  }
  return best;
}

/**
 * A minimal registry entry for a discovered brand with no curated counterpart.
 *
 * It carries NO partnership route and `not_verified` status, so `partnershipFor()`
 * reports `available: false` and the UI shows a data-completeness gap rather than
 * an invented contact (doc 02 §21/§22). `qlooEntityId` is the discovered id, which
 * keeps `brandEntityId()` stable and matches the discovery set.
 */
function synthesiseRegistryBrand(entity: CulturalEntity, category: BrandCategory): RegistryBrand {
  return {
    slug: brandSlugFromEntity(entity),
    qlooEntityId: entity.id,
    resolution: "resolved",
    displayName: entity.name,
    category,
    partnership: null,
    verification: { status: "not_verified" },
  };
}

function brandSlugFromEntity(entity: CulturalEntity): string {
  const readable = entity.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return readable.length > 0 ? readable : `brand-${stableKey(entity.id).slice(0, 10)}`;
}

/**
 * The declared interests that drove a discovered brand, strongest first.
 *
 * Taken from the brand entity's own explainability contributions and mapped back
 * to the creator's interest names, so the "why this brand" chain names real
 * declared inputs rather than an invented reason. Absent when the data source
 * returned no contributions.
 */
function brandDrivers(
  entity: CulturalEntity,
  signals: CreatorSignals,
): Array<{ name: string; score: number }> | undefined {
  const contributions = entity.explainability.contributions;
  if (contributions.length === 0) return undefined;

  const drivers = contributions
    .map((contribution) => ({
      name: signals.entityNames[contribution.signalEntityId] ?? contribution.signalName,
      score: contribution.score,
    }))
    .filter((driver): driver is { name: string; score: number } => driver.name !== undefined)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, 3);

  return drivers.length > 0 ? drivers : undefined;
}

// ---------------------------------------------------------------------------
// Stage 4: Brand Taste DNA and the intersection
// ---------------------------------------------------------------------------

/** One brand's cultural profile, and how it meets the creator's. */
export interface BrandIntersection {
  brandTaste: BrandTasteDNA;
  intersection: TasteIntersection;
}

/**
 * The one place a brand's cultural profile is derived and compared.
 *
 * Both halves come from the entity discovery already returned, so this costs no
 * additional API call per brand — which matters, because a per-brand enrichment
 * call would multiply latency by the candidate count and still come back sparse for
 * most of them.
 */
function brandIntersection(
  entity: CulturalEntity,
  creatorTags: readonly ScoredTasteTag[],
  declaredIds: readonly string[],
): BrandIntersection {
  const brandTaste = buildBrandTasteDna(entity);
  return {
    brandTaste,
    intersection: intersectTaste({
      brandId: entity.id,
      brand: brandTaste,
      creatorTags,
      declaredIds,
    }),
  };
}

export interface BuildIntersectionsInput {
  brandResults: EntityResultSet | undefined;
  /** The creator's derived taste tags, before the `maxCoreTastes` cut. */
  creatorTags: readonly ScoredTasteTag[];
  /** Entity ids the creator confirmed. Decides direct vs adjacent. */
  declaredIds: readonly string[];
}

/**
 * Build the intersection for every discovered brand, keyed by brand id.
 *
 * Every candidate gets one, including the ones with almost no evidence. Skipping a
 * sparse brand here would remove it from the list entirely, and a brand the
 * catalogue really did return should not disappear because the catalogue knew
 * little about it — it should appear with its evidence gap stated. What thin
 * evidence costs a brand is rank, through `intersectionRankValue`, not eligibility.
 */
function buildIntersections(input: BuildIntersectionsInput): Map<string, BrandIntersection> {
  const map = new Map<string, BrandIntersection>();
  if (input.brandResults === undefined) return map;

  for (const entity of input.brandResults.entities) {
    map.set(entity.id, brandIntersection(entity, input.creatorTags, input.declaredIds));
  }
  return map;
}

// ---------------------------------------------------------------------------
// Stage 6: brand scoring
// ---------------------------------------------------------------------------

interface ScoredBrand {
  brandId: string;
  name: string;
  category?: string;
  enriched: EnrichedBrand;
  fit: BrandFitResult;
  viewModel: BrandFitViewModel;
  coverage: number | undefined;
  /**
   * VERIFIED cultural affinity — the intersection's strength, not the discovery
   * position. Feeds the opportunity gap and the untapped test, both of which claim
   * to know something about cultural relevance and therefore may only rest on
   * evidence that establishes it.
   */
  affinity: number | undefined;
  /**
   * Why the catalogue returned this brand. Metadata only: rendered beside the
   * recommendation, never scored, never used to break a tie except as the last
   * resort documented in `compareOpportunities`.
   */
  discovery?: BrandDiscoveryEvidence;
  /** Declared interests that drove this brand's discovery (doc 05 §10D). */
  drivers?: Array<{ name: string; score: number }>;
  /** The brand's own cultural profile, derived from the entity Qloo returned. */
  brandTaste: BrandTasteDNA;
  /** Creator x Brand. Built BEFORE ranking, and what ranking is driven by. */
  intersection: TasteIntersection;
}

interface ScoreBrandsInput {
  registry: readonly RegistryBrand[];
  brandResults: EntityResultSet | undefined;
  demographics: DemographicResultSet | undefined;
  signals: CreatorSignals;
  taste: TasteDnaResult;
  /** Built in Stage 4, before any ranking. Keyed by brand entity id. */
  intersections: ReadonlyMap<string, BrandIntersection>;
  source: DataSource;
  level: CreatorAnalysis["fallbackLevel"];
  saturation: Record<string, number>;
  coveredCategories: readonly string[];
  renderable: boolean;
  maxBrands: number;
}

/** Which call the brand candidates came from, named for the discovery evidence. */
const BRAND_DISCOVERY_ENDPOINT = "brand discovery";

function scoreBrands(input: ScoreBrandsInput): ScoredBrand[] {
  const resultSet = input.brandResults;
  if (resultSet === undefined) return [];

  // Registry lookup by canonical entity id, built once. A discovered brand that
  // overlaps the curated registry keeps whatever the registry holds for it,
  // including a curator-verified partnership route when there is one; a brand that
  // does not overlap is enriched from Qloo metadata alone and flagged `discovered`.
  // Overlap never affects WHICH brands are scored — only what is known about them.
  const registryById = new Map<string, RegistryBrand>();
  for (const brand of input.registry) {
    registryById.set(brandEntityId(brand), brand);
  }

  const scored: ScoredBrand[] = [];

  for (const entity of resultSet.entities) {
    const brandId = entity.id;
    const registryEntry = registryById.get(brandId);
    const category: BrandCategory = registryEntry?.category ?? deriveBrandCategory(entity);
    const registry = registryEntry ?? synthesiseRegistryBrand(entity, category);
    const enriched: EnrichedBrand = {
      ...mergeBrand(registry, qlooMetadata(entity)),
      discovered: registryEntry === undefined,
    };

    const coverageLookup = coverageWithBasis(category, input.saturation, input.coveredCategories);
    const coverage = coverageLookup.coverage;

    // -- Brand Taste DNA and the intersection were built in Stage 4 -----------
    // Read here rather than recomputed, so the profile that explains a brand and
    // the profile that ranked it are guaranteed to be the same object. The fallback
    // is for a caller that scored brands without running Stage 4 first; it is the
    // same function, so it cannot produce a different answer.
    //
    // It is read BEFORE the fit evidence now, because taste fit is derived from it
    // rather than from the discovery ranking. That ordering is the fix: the
    // intersection used to be computed after the score that was supposed to rest
    // on it, which is how a discovery position ended up wearing the label.
    const pair =
      input.intersections.get(brandId) ??
      brandIntersection(entity, input.taste.allTags, input.signals.entityIds);
    const { brandTaste, intersection } = pair;

    // Discovery position, preserved as metadata with its raw value, scale and set
    // spread intact (§4.1). Passed to `tasteFitEvidence` only so that an unavailable
    // taste fit can say "this brand did appear in discovery, and that is not the
    // same thing as a fit score" instead of leaving a bare gap.
    const discovery = brandDiscoveryEvidence(resultSet, brandId, BRAND_DISCOVERY_ENDPOINT);

    // Affinity here is the verified intersection strength, not the normalised
    // discovery position. Every brand in a min-max set gets a position and the top
    // one always gets 1.00, so feeding that in awarded the discovery leader the
    // maximum untapped-opportunity score whatever its actual relevance (§4.3).
    const affinity = intersection.strength;

    const evidence: BrandFitEvidence = {
      taste_fit: tasteFitEvidence(intersection, discovery),
      audience_demographic: audienceFitEvidence(input.demographics, input.signals.demographics),
      content_compatibility: contentCompatibilityEvidence(entity, input.taste.allTags),
      geographic: geographicFitEvidence(entity, enriched.qloo.region, input.signals.location),
      // The basis travels with the value. An inferred zero used to be reported to
      // the creator as "self-reported by you", which attributed our assumption to
      // them and made a 10%-weighted dimension look measured.
      opportunity_gap: opportunityGapEvidence(affinity, coverage, coverageLookup.basis),
    };

    const fit = scoreBrandFit(evidence);
    const viewModel = buildBrandFitViewModel({
      brandId,
      brandName: enriched.qloo.name ?? registry.displayName,
      fit,
      source: input.source,
      level: input.level,
      renderable: input.renderable,
      omittedReason: input.renderable
        ? undefined
        : "No taste profile could be produced for this analysis, so brand fit is not shown.",
    });

    scored.push({
      brandId,
      name: enriched.qloo.name ?? registry.displayName,
      category,
      enriched,
      fit,
      viewModel,
      coverage,
      affinity,
      discovery,
      drivers: brandDrivers(entity, input.signals),
      brandTaste,
      intersection,
    });
  }

  // Rank by the INTERSECTION first, then cut. Ranking on the fit score alone would
  // let a brand Qloo happened to return highly outrank one that genuinely shares
  // the creator's cultural ground, which is the exact failure §28 names. The score
  // remains the tie-break: it is the part of the judgement that uses dimensions the
  // intersection does not cover, such as geography and declared coverage.
  //
  // The fit tie-break is gated on `renderable` so a score that could not be
  // interpreted does not become a ranking advantage (§7.1), and the whole ordering
  // is shared with `compareOpportunities` rather than restated here — two sorts that
  // disagree would produce a list in one order and a "top recommendation" naming
  // another brand.
  //
  // Nothing is dropped here for having thin evidence. The cut is a length limit,
  // not a quality gate — a sparse brand is pushed down the list by
  // `intersectionRankValue`, never removed from it.
  return scored
    .sort((a, b) => {
      const byIntersection = compareIntersections(a.intersection, b.intersection);
      if (byIntersection !== 0) return byIntersection;
      if (a.fit.overall.renderable !== b.fit.overall.renderable) {
        return a.fit.overall.renderable ? -1 : 1;
      }
      const byValue = b.fit.overall.value - a.fit.overall.value;
      if (byValue !== 0) return byValue;
      const byCoverage = b.fit.coverage - a.fit.coverage;
      if (byCoverage !== 0) return byCoverage;
      return a.name.localeCompare(b.name);
    })
    .slice(0, input.maxBrands);
}

/**
 * What the brand list, taken as a whole, was able to establish.
 *
 * §7.1's "if no brand has sufficient evidence for a meaningful cultural match, say
 * so". Computed over the list that is actually rendered, so the sentence and the
 * cards beside it describe the same brands. `message` is only set when the list is
 * non-empty and nothing in it was verified — an empty list needs no explanation
 * because the brand stage already says discovery returned nothing, and a list with
 * at least one verified overlap needs none because it is demonstrating the opposite.
 *
 * The counts distinguish a genuine non-match from an inability to compare, which is
 * the difference between "your taste and these brands do not overlap" and "the
 * catalogue's brand taxonomy could not be compared against your taste". Only the
 * second is a limitation of the analysis, and the message says which one happened.
 */
function summariseBrandEvidence(opportunities: readonly BrandOpportunity[]): CreatorAnalysis["brandEvidenceSummary"] {
  if (opportunities.length === 0) return undefined;

  let verifiedOverlap = 0;
  let noOverlap = 0;
  let couldNotEstablish = 0;
  for (const opportunity of opportunities) {
    const state = opportunity.intersection?.state ?? "insufficient_evidence";
    if (state === "verified_overlap") verifiedOverlap += 1;
    else if (state === "no_overlap") noOverlap += 1;
    else couldNotEstablish += 1;
  }

  if (verifiedOverlap > 0) {
    return { total: opportunities.length, verifiedOverlap, noOverlap, couldNotEstablish };
  }

  const message =
    couldNotEstablish === opportunities.length
      ? `None of the ${opportunities.length} brands discovered could be compared against your taste. Their own descriptors sit in catalogue namespaces that do not overlap with the ones your profile is built from, and this product does not invent a relationship between them. They are listed because the catalogue returned them against your interests — that is a discovery, not a verified cultural match, and no ranking here claims otherwise.`
      : `None of the ${opportunities.length} brands discovered has a verified cultural overlap with your taste${
          noOverlap > 0 ? ` — ${noOverlap} ${noOverlap === 1 ? "was" : "were"} compared and ${noOverlap === 1 ? "shares" : "share"} no descriptor with your profile` : ""
        }${couldNotEstablish > 0 ? `, and ${couldNotEstablish} could not be compared at all` : ""}. They are still listed, because a brand the catalogue returned is worth knowing about, but nothing below is a verified match and the ordering reflects evidence quality rather than a recommendation.`;

  return { total: opportunities.length, verifiedOverlap, noOverlap, couldNotEstablish, message };
}

/**
 * Registry metadata vs data-source metadata (doc 02 §21).
 *
 * Only fields the scored entity actually carries are copied. Anything missing
 * stays `undefined` — `mergeBrand` records that as `qlooMissing` so the UI can
 * show a data-completeness gap instead of a placeholder that looks like data.
 */
function qlooMetadata(entity: CulturalEntity): Partial<EnrichedBrand["qloo"]> {
  return {
    name: entity.name,
    description: entity.description,
    // First USABLE url, not `websites[0]`. The array is response data and one bad
    // entry — a bare domain, an empty string — would otherwise hide every good one
    // behind it and leave the card claiming the brand has no website.
    website: firstHttpUrl(entity.websites),
    imageUrl: entity.imageUrl,
    region: entity.geo?.city ?? entity.geo?.metro,
    popularity: entity.popularity,
    socialHandles: entity.socialHandles,
  };
}

// ---------------------------------------------------------------------------
// Error handling & observations
// ---------------------------------------------------------------------------

/**
 * Run a provider call, converting any failure into a recorded degradation.
 *
 * Returning `undefined` rather than throwing is what lets one missing capability
 * cost one dimension instead of the whole analysis. Programming errors are
 * recorded the same way but with `code: "unknown"`, which makes them visible in
 * the honesty panel rather than looking like a provider limitation.
 */
async function attempt<T>(
  step: string,
  failures: PipelineFailure[],
  run: () => Promise<T>,
): Promise<T | undefined> {
  try {
    return await run();
  } catch (error) {
    failures.push({
      step,
      code: error instanceof ProviderError ? error.code : "unknown",
      message: error instanceof Error ? error.message : String(error),
      recoverable: error instanceof ProviderError ? error.recoverable : false,
    });
    return undefined;
  }
}

/**
 * One flat observation list for the honesty panel.
 *
 * Pipeline failures are converted into observations with `severity: "warning"`
 * (or `"critical"` when the provider said they were not recoverable) so a single
 * component can render everything the run noticed, whether it came from the
 * mapper or from a failed call.
 */
function mergeObservations(
  tasteObservations: readonly ProviderObservation[],
  entityResults: readonly EntityResultSet[],
  tagResult: TagResultSet | undefined,
  demographics: DemographicResultSet | undefined,
  brandResults: EntityResultSet | undefined,
  failures: readonly PipelineFailure[],
): CreatorAnalysis["observations"] {
  const fromSets = [
    ...entityResults,
    ...(tagResult === undefined ? [] : [tagResult]),
    ...(demographics === undefined ? [] : [demographics]),
    ...(brandResults === undefined ? [] : [brandResults]),
  ].flatMap((set) => set.meta.observations);

  const seen = new Set<string>();
  const merged: CreatorAnalysis["observations"] = [];

  for (const observation of [...tasteObservations, ...fromSets]) {
    const key = `${observation.code}|${observation.detail}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push({
      code: observation.code,
      detail: observation.detail,
      severity: observation.severity,
    });
  }

  for (const failure of failures) {
    // `code` is a stable machine-readable identifier and `detail` is the human
    // sentence. The step name belongs in the SENTENCE: putting it in `code`
    // (as this originally did) produced codes like "demographics" and details
    // that never said which call had failed, so neither field was usable —
    // nothing could branch on the code and nothing told the reader the step.
    const key = `failure|${failure.step}|${failure.code}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push({
      code: failure.code,
      detail: `${failure.step} — ${failure.message}`,
      severity: failure.recoverable ? "warning" : "critical",
    });
  }

  return merged;
}

/**
 * Deterministic identity for a cached analysis.
 *
 * Keyed on the SORTED parameter set (doc 03 §8) so two logically identical
 * requests share one entry. `profile.id` is included because the same interests
 * under two creators must not collide, and `brandCount` because the registry can
 * change independently of the profile — the registry only ENRICHES discovered
 * brands, so a change to it changes the output without changing any request.
 *
 * `source` is included for the same reason as `brandCount`: the data source can
 * change without the request changing, and it changes every number in the answer.
 *
 * An interest is keyed on its resolved `entityId` as well as its query. Keying on
 * the query alone made two different analyses collide: the review stage exists
 * precisely so a creator can pick WHICH "Dune" they meant, and the film and the
 * book share a query string. Without the id, confirming the book after the film
 * had been cached would replay the film's analysis.
 */
export function analysisCacheKey(
  profile: CreatorProfile,
  brands: readonly RegistryBrand[],
  source: Pick<DataSource, "providerId" | "mode">,
): string {
  return stableKey({
    kind: "creator-analysis",
    // 2 — added `entityId` to the interest key, `contextTerms`, and stored stage
    // events for replay. Bumping it is what stops a pre-change entry (which has no
    // `stageEvents`) from being served by the new replay path.
    // 3 — brand opportunities now carry `brandTaste` and `intersection`, and
    // discovery is driven by the Taste DNA rather than by the declared signals
    // alone, so a cached entry from version 2 is both shape-incomplete and the
    // answer to a different question. Bumping it is what stops either being served.
    // 4 — the creator's own confirmed interests are now scored into the taste pool
    // (see `scoreDeclaredEntities`), so `coreTastes`, every intersection and the
    // brand ranking all change for a byte-identical request. A version-3 entry was
    // computed from expansion alone; serving one now would hand back a profile
    // that never considered what the creator actually said.
    // 5 — taste fit stopped reading the min-max normalised discovery position and
    // started reading verified intersection strength, so every brand's score, label
    // and rank can move for a byte-identical request. The view-model shape changed
    // in step: `TasteIntersection` gained `state`/`stateReason`/
    // `classificationMatches`, `SharedTasteDimension` gained `matchBasis`,
    // `BrandOpportunity` gained `coverageKnown`/`discovery`, and `BrandFitOverall`
    // gained `evidence`. A version-4 entry is therefore both shape-incomplete and
    // the answer to a question this version deliberately stopped asking — the one
    // that let a brand with no verified shared taste carry a top cultural-fit score.
    version: 5,
    profile: profile.id,
    // Not covered by the version bump, because the version cannot change when the
    // operator configures a real API key. `createProviderContext` builds ONE cache
    // and hands it to whichever provider wins, so without this a profile analysed
    // while the synthetic provider was active would be replayed verbatim after a
    // live key appeared — a stale illustrative answer served to a request that
    // could by then have been answered properly.
    source: `${source.providerId}|${source.mode}`,
    interests: profile.selectedInterests
      .map((interest) => `${interest.entityId ?? "?"}|${interest.query}`)
      .sort(),
    contextTerms: (profile.contextTerms ?? []).slice().sort(),
    coverage: profile.coverage.coveredCategories.slice().sort(),
    saturation: profile.coverage.saturation,
    demographics: profile.demographics ?? null,
    location: profile.location ?? null,
    brandCount: brands.length,
  });
}
