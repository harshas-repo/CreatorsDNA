import type { EnrichedBrand, RegistryBrand } from "@/lib/contracts/brand";
import {
  brandEntityId,
  hasVerifiedRoute,
  officialDestination,
  socialDestinations,
} from "@/lib/contracts/brand";
import type {
  BrandDiscoveryEvidence,
  BrandOpportunity,
  OpportunityPoint,
  TasteDna,
  TasteIntersection,
} from "@/lib/contracts/viewModels";
import { clamp, round } from "@/lib/utils/deterministic";

import { DEFAULT_THRESHOLDS, type AnalysisThresholds } from "./thresholds";
import { CLEAR_OVERLAP, compareIntersections } from "./intersection";
import { coverageWithBasis, type CoverageBasis, type TasteCategory } from "./tasteDna";

/**
 * Untapped-opportunity derivation (doc 02 §19, doc 01 §9/§10).
 *
 *   High affinity + low current content coverage = untapped opportunity
 *
 * Doc 02 §19 is explicit that this is a **CreatorsDNA-specific feature rather
 * than a Qloo feature**, so every value produced here is `provenance: "derived"`
 * and the UI must never attribute it to the data source.
 *
 * The coverage axis is the honest weak point, and doc 05 §10C requires it to be
 * identified rather than implied. Coverage comes from what the creator declared
 * about their own output. It is NOT measured from their content, and a category
 * with no declared coverage information is OMITTED from the scatter rather than
 * plotted at zero — plotting an unknown as zero would manufacture an opportunity
 * out of missing data.
 */

export interface OpportunityDerivation {
  points: OpportunityPoint[];
  /** Categories left out because coverage was unknown. */
  omitted: Array<{ id: string; label: string; affinity: number; reason: string }>;
  /**
   * The weakest basis present across the plotted points, so one inferred zero
   * cannot hide behind a chart-level claim of creator declaration.
   */
  coverageBasis: CoverageBasis;
  coverageMethodology: string;
  /**
   * The opportunity shortlist: points that actually qualify as untapped,
   * highest gap first, capped for display.
   *
   * Gated by the SAME thresholds as `isUntapped()` rather than being "the five
   * largest numbers". Two reasons: a category with weak affinity and no coverage
   * scores a high gap while being nowhere near the creator's taste, so a raw
   * top-5 surfaces noise; and the brand cards mark themselves untapped through
   * `isUntapped()`, so an ungated shortlist could contradict the badge on the
   * same category. Empty is a legitimate result and means "no untapped
   * opportunity was found", not "not computed".
   */
  topGaps: OpportunityPoint[];
}

export interface OpportunityInput {
  categories: readonly TasteCategory[];
  /** Creator-declared coverage. `saturation` is a 0..1 self-report per category. */
  saturation: Record<string, number>;
  coveredCategories: readonly string[];
  thresholds?: AnalysisThresholds;
  /**
   * Cap on plotted points. Categories past the cap are dropped from `points`
   * and the drop is reported in `coverageMethodology` — they are NOT added to
   * `omitted`, which means specifically "coverage unknown".
   */
  maxPoints?: number;
}

/** Cap on the `topGaps` shortlist. Display limit only. */
const MAX_TOP_GAPS = 5;

export function deriveOpportunities(input: OpportunityInput): OpportunityDerivation {
  const thresholds = input.thresholds ?? DEFAULT_THRESHOLDS;
  const maxPoints = input.maxPoints ?? 24;

  const points: OpportunityPoint[] = [];
  const omitted: OpportunityDerivation["omitted"] = [];

  for (const category of input.categories) {
    // `category.id` is looked up FIRST. It is the value the coverage step is now
    // rendered against (`categoryIdsFor`), so it is the one that can actually
    // match; `category.label` is kept as a fallback for a hand-entered category
    // name. The old order did the reverse and, because the label vocabulary could
    // never equal a derived id, every lookup fell through to the inferred branch.
    const declared = coverageWithBasis(category.id, input.saturation, input.coveredCategories);
    const byLabel = coverageWithBasis(category.label, input.saturation, input.coveredCategories);
    const coverage = declared.coverage ?? byLabel.coverage;
    const basis: CoverageBasis = declared.coverage !== undefined ? declared.basis : byLabel.basis;

    if (coverage === undefined) {
      omitted.push({
        id: category.id,
        label: category.label,
        affinity: category.score,
        reason:
          "You have not declared whether you cover this category, so its opportunity gap cannot be computed. It is omitted rather than assumed to be uncovered.",
      });
      continue;
    }

    points.push({
      id: category.id,
      label: category.label,
      affinity: round(category.score, 4),
      coverage: round(clamp(coverage), 4),
      gapScore: round(category.score * (1 - clamp(coverage)), 4),
      role: "secondary",
      provenance: "derived",
      // Was hardcoded to `creator_declared` for every point, including the ones
      // whose zero coverage was our inference from the creator having declared
      // OTHER categories. That attributed an assumption to them.
      coverageBasis: basis,
      supportCount: category.entities.length,
    });
  }

  const sorted = points.sort(
    (a, b) => b.gapScore - a.gapScore || b.affinity - a.affinity || a.label.localeCompare(b.label),
  );

  const basis: CoverageBasis = weakestBasis(points);

  const plotted = sorted.slice(0, maxPoints);
  // `omitted` is about UNKNOWN COVERAGE, not about the display cap, so a
  // truncation cannot be folded into it without changing what that word means.
  // It is reported in the methodology string instead, which chart C renders
  // verbatim — a cap that quietly drops categories would leave the chart
  // claiming to show all of them.
  const truncated = sorted.length - plotted.length;

  // Gated by the same thresholds `isUntapped()` uses, so this shortlist and the
  // "untapped" badge on a brand card can never disagree about one category.
  const topGaps = sorted
    .filter((point) => isUntapped(point.affinity, point.coverage, thresholds))
    .slice(0, MAX_TOP_GAPS);

  return {
    points: plotted,
    omitted,
    coverageBasis: basis,
    coverageMethodology: coverageNote(basis, omitted.length, truncated, maxPoints),
    topGaps,
  };
}

/**
 * Run-specific facts about how coverage was established, and nothing else.
 *
 * This string used to open with `METHODOLOGY.opportunityGap`, and the chart's
 * `meta.methodology` prepended that same definition to it. `OpportunityGap`
 * renders both, and `describeOpportunities` appended the whole thing to the
 * section lede — so one two-sentence definition was printed four times inside a
 * single section. The definition now lives only on the viz frame's Method line,
 * and this is the footnote labelled "Coverage basis", which is what that label
 * always claimed it was.
 */
function coverageNote(
  basis: CoverageBasis,
  omittedCount: number,
  truncated: number,
  maxPoints: number,
): string {
  if (basis === "unavailable") {
    return "No coverage information was available, so no opportunity gap could be computed.";
  }

  const parts = [
    basis === "inferred_zero"
      ? "At least one plotted category had no coverage statement from you, so it is treated as uncovered. That zero is our inference, not something you declared, and points marked accordingly should be read as assumptions."
      : null,
    // A zero count is a non-event: "0 categories were omitted" reads as a
    // defect, and the chart already shows every category it was given.
    omittedCount > 0
      ? `${omittedCount} categor${
          omittedCount === 1 ? "y was" : "ies were"
        } omitted because coverage was unknown.`
      : null,
    truncated > 0
      ? `A further ${truncated} ${
          truncated === 1 ? "category was" : "categories were"
        } left off the chart by the ${maxPoints}-point display cap; they are not missing from the analysis.`
      : null,
  ].filter((part): part is string => part !== null);

  // Without a fallback the footnote renders "Coverage basis:" and nothing after
  // it. Stating the clean case is also the only place a creator is told that
  // nothing was inferred on their behalf.
  return (
    parts.join(" ") ||
    "Every plotted category uses coverage you declared. Nothing was inferred and nothing was left off the chart."
  );
}

/** Weakest basis across a set of points — a single inference weakens the claim. */
function weakestBasis(points: readonly OpportunityPoint[]): CoverageBasis {
  if (points.length === 0) return "unavailable";
  if (points.some((point) => point.coverageBasis === "inferred_zero")) return "inferred_zero";
  return "creator_declared";
}

// ---------------------------------------------------------------------------
// Untapped test
// ---------------------------------------------------------------------------

/**
 * Is this an untapped opportunity?
 *
 * Two conditions, both required (doc 02 §19). The affinity floor is the same
 * `unexpectedMinAffinity` used for unexpected affinities, so the two features
 * cannot disagree about what counts as "meaningful relevance".
 */
export function isUntapped(
  affinity: number | undefined,
  coverage: number | undefined,
  thresholds: AnalysisThresholds = DEFAULT_THRESHOLDS,
): boolean {
  if (affinity === undefined || coverage === undefined) return false;
  return affinity >= thresholds.unexpectedMinAffinity && coverage <= thresholds.untappedCoverage;
}

/** Saturation check, used to warn when a creator is already deep in a category. */
export function isSaturated(
  coverage: number | undefined,
  thresholds: AnalysisThresholds = DEFAULT_THRESHOLDS,
): boolean {
  return coverage !== undefined && coverage >= thresholds.saturatedCoverage;
}

/**
 * Is a BRAND an untapped opportunity?
 *
 * Deliberately a separate function from `isUntapped`, and deliberately not a call to
 * it. `isUntapped` compares an affinity against `unexpectedMinAffinity`, a floor
 * calibrated for provider affinity values — figures that arrived from a live call on
 * a 0–1 scale, min-max normalised across a candidate set. A brand's relevance is now
 * the verified intersection strength, which is a different quantity on a different
 * scale, and reusing that floor would apply a threshold to a number it was never
 * calibrated for.
 *
 * So the relevance condition here is categorical, not numeric, wherever it can be:
 * the overlap must be VERIFIED. On top of that, `CLEAR_OVERLAP` is the documented
 * line between "incidental" and "clear" overlap and is already published on
 * /methodology, so using it as the floor for a positive badge reuses an existing
 * documented threshold rather than introducing a new one. A classification-only
 * overlap has no strength at all and therefore cannot earn the badge: it is real
 * evidence, but too coarse to support a claim this specific.
 *
 * Missing coverage yields false, and §7.2 requires that this neither grants nor
 * removes ranking preference — which is why `coverageKnown` is carried separately and
 * `compareOpportunities` only applies the untapped key when both sides know theirs.
 */
export function brandIsUntapped(
  intersection: TasteIntersection | undefined,
  coverage: number | undefined,
  thresholds: AnalysisThresholds = DEFAULT_THRESHOLDS,
): boolean {
  if (intersection === undefined || intersection.state !== "verified_overlap") return false;
  if (intersection.strength === undefined || intersection.strength < CLEAR_OVERLAP) return false;
  if (coverage === undefined) return false;
  return coverage <= thresholds.untappedCoverage;
}

// ---------------------------------------------------------------------------
// Quadrants
// ---------------------------------------------------------------------------

/**
 * The four quadrants of the opportunity scatter.
 *
 * Note the wording: none of them is "bad". Doc 05 §12 forbids implying that an
 * opportunity is good or bad, because cultural fit is exploratory. "Established
 * ground" and "Saturated" describe situations, not verdicts.
 */
export const OPPORTUNITY_QUADRANTS = [
  {
    id: "untapped",
    label: "Untapped",
    description: "Strong affinity, little existing coverage. The gap worth looking at first.",
    role: "brand" as const,
  },
  {
    id: "established",
    label: "Established ground",
    description: "Strong affinity and you already cover it. Alignment you are acting on.",
    role: "taste" as const,
  },
  {
    id: "speculative",
    label: "Speculative",
    description: "Little coverage and modest affinity. Unproven in both directions.",
    role: "neutral" as const,
  },
  {
    id: "saturated",
    label: "Saturated",
    description: "Heavy existing coverage without matching affinity. Worth reviewing.",
    role: "content" as const,
  },
] as const;

export function quadrantFor(
  affinity: number,
  coverage: number,
  thresholds: AnalysisThresholds = DEFAULT_THRESHOLDS,
): (typeof OPPORTUNITY_QUADRANTS)[number]["id"] {
  const strong = affinity >= thresholds.unexpectedMinAffinity;
  const covered = coverage >= thresholds.saturatedCoverage;
  const uncovered = coverage <= thresholds.untappedCoverage;
  if (strong && uncovered) return "untapped";
  if (strong && covered) return "saturated";
  if (strong) return "established";
  return "speculative";
}

// ---------------------------------------------------------------------------
// Brand opportunities
// ---------------------------------------------------------------------------

/**
 * Partnership route for a brand opportunity (doc 02 §22).
 *
 * Three rules, in order of how easily they get violated:
 *
 *   1. **Never invent a route.** `hasVerifiedRoute()` requires a human-verified
 *      entry; an unverified URL is treated as no route at all.
 *   2. **Never imply a creator programme that was not confirmed.** Doc 02 §22:
 *      show "Official contact route" rather than pretending a creator programme
 *      exists.
 *   3. **Say so when there is nothing.** `available: false` plus a note is the
 *      honest output, and the UI renders it as a data-completeness gap.
 */
export function partnershipFor(brand: EnrichedBrand): BrandOpportunity["partnership"] {
  const route = brand.registry.partnership;

  if (!hasVerifiedRoute(brand) || route === null) {
    return {
      available: false,
      verificationNote:
        brand.registry.verification.note ??
        "No partnership route has been verified against an official source for this brand yet. None is shown rather than guessed.",
    };
  }

  const hasCreatorSpecific = Boolean(
    route.creatorPartnershipUrl || route.affiliateUrl || route.ambassadorUrl,
  );
  return {
    available: true,
    creatorPartnershipUrl: route.creatorPartnershipUrl,
    affiliateUrl: route.affiliateUrl,
    ambassadorUrl: route.ambassadorUrl,
    // Doc 02 §22: fall back to a generic official route, labelled as such.
    contactRoute: hasCreatorSpecific ? route.contactRoute : (route.contactRoute ?? "Official contact route"),
    verificationNote: [
      route.verificationSource ? `Verified from ${route.verificationSource}` : undefined,
      route.verificationDate ? `on ${route.verificationDate}` : undefined,
      hasCreatorSpecific ? undefined : "No creator-specific programme was confirmed; this is the official contact route.",
    ]
      .filter(Boolean)
      .join(" "),
  };
}

export interface BrandOpportunityInput {
  brand: EnrichedBrand;
  /** Pre-built fit view-model, produced by `src/lib/scoring/brandFit.ts`. */
  fit: BrandOpportunity["fit"];
  /** The brand's category coverage in the creator's declared output. */
  coverage: number | undefined;
  pathway?: BrandOpportunity["pathway"];
  /** Declared interests that drove this brand's recommendation (doc 05 §10D). */
  drivers?: BrandOpportunity["drivers"];
  /** The brand's own cultural profile, from `buildBrandTasteDna`. */
  brandTaste?: BrandOpportunity["brandTaste"];
  /** Creator x Brand. What the ranking is driven by and what explains the brand. */
  intersection?: BrandOpportunity["intersection"];
  /**
   * Why the catalogue returned this brand. Metadata only — it never contributes to
   * the ranking except as the documented last resort in `compareOpportunities`, and
   * it never contributes to a score.
   */
  discovery?: BrandDiscoveryEvidence;
  thresholds?: AnalysisThresholds;
}

export function toBrandOpportunity(input: BrandOpportunityInput): BrandOpportunity {
  const thresholds = input.thresholds ?? DEFAULT_THRESHOLDS;
  return {
    brandId: brandEntityId(input.brand.registry),
    brandSlug: input.brand.registry.slug,
    name: input.brand.qloo.name ?? input.brand.registry.displayName,
    category: input.brand.registry.category,
    fit: input.fit,
    pathway: input.pathway,
    partnership: partnershipFor(input.brand),
    metadata: metadataFor(input.brand),
    // Verified cultural relevance, not discovery position. `affinity` used to be the
    // normalised place this brand held in the candidate set, which meant the top
    // discovery result always carried the maximum untapped score by construction.
    isUntapped: brandIsUntapped(input.intersection, input.coverage, thresholds),
    coverageKnown: input.coverage !== undefined,
    discovered: input.brand.discovered,
    drivers: input.drivers,
    brandTaste: input.brandTaste,
    intersection: input.intersection,
    discovery: input.discovery,
  };
}

/**
 * The brands discovered inside one untapped cultural connection.
 *
 * §11 asks an untapped connection to answer "and what does that connect you to?"
 * rather than stopping at a gap score. This is that answer, and the join is a real
 * one rather than a string comparison: a brand belongs to a connection when one of
 * the cultural dimensions it shares with the creator traces back to an entity that
 * supports the connection's category. Both halves of that chain are already in the
 * data — `SharedTasteDimension.tracedTo` on one side, `TasteCategory.entities` on
 * the other — so nothing is inferred to make the link.
 *
 * Returns an empty list rather than guessing when the category is not in this run
 * or carried no supporting entities. "No brand was discovered in this connection"
 * is a true and useful sentence; a fuzzy match would not be.
 */
export function brandsInConnection(
  point: OpportunityPoint,
  categories: readonly TasteCategory[],
  opportunities: readonly BrandOpportunity[],
): BrandOpportunity[] {
  const category = categories.find((entry) => entry.id === point.id);
  if (category === undefined) return [];

  const entityIds = new Set(category.entities.map((entity) => entity.id));
  if (entityIds.size === 0) return [];

  return opportunities.filter((opportunity) =>
    (opportunity.intersection?.shared ?? []).some((dimension) =>
      dimension.tracedTo.some((id) => entityIds.has(id)),
    ),
  );
}

/**
 * Descriptive identity for the card, carried through rather than dropped.
 *
 * `mergeBrand` already resolved which side supplied what; this only copies the
 * fields a creator can act on and keeps the provenance that came with them. The
 * whole block is omitted when there is nothing in it, because an empty
 * `metadata` object renders as a section with no content — and a card that shows
 * a heading over nothing looks broken in a way that saying "the catalogue had no
 * description" does not.
 *
 * Links go through `officialDestination`/`socialDestinations`, which refuse any
 * value that is not an absolute http(s) URL. A brand's `websites` array is
 * third-party response data, so the validation is what stops a malformed entry
 * becoming a `javascript:` href on our own page.
 */
function metadataFor(brand: EnrichedBrand): BrandOpportunity["metadata"] {
  const destination = officialDestination(brand);
  const social = socialDestinations(brand);
  const curatorNote = brand.registry.notes?.trim();

  const hasContent =
    brand.qloo.description !== undefined ||
    brand.qloo.region !== undefined ||
    brand.qloo.imageUrl !== undefined ||
    destination !== undefined ||
    social.length > 0 ||
    (curatorNote !== undefined && curatorNote.length > 0);
  if (!hasContent) return undefined;

  return {
    description: brand.qloo.description,
    region: brand.qloo.region,
    imageUrl: brand.qloo.imageUrl,
    destination,
    social: social.length > 0 ? social : undefined,
    curatorNote: curatorNote !== undefined && curatorNote.length > 0 ? curatorNote : undefined,
    provenance: brand.provenance.metadata,
    incomplete: brand.qlooMissing,
  };
}

/**
 * Order brand opportunities for display (§7.1).
 *
 * THE INTERSECTION LEADS. This is the one ordering decision that makes "Qloo
 * discovery ≠ CreatorsDNA recommendation" true in the output rather than only in
 * the documentation: a brand is placed by how much cultural ground it actually
 * shares with the creator, with evidence, and only then by anything else.
 * `compareIntersections` sorts on overlap STATE first and rank value second, so a
 * verified overlap always precedes a mere absence of one, which always precedes an
 * inability to compare — an empty intersection can never tie silently into the
 * keys below and be decided by a misleading fallback score.
 *
 * Every key after that is deliberately narrow about when it may fire:
 *
 *  - **Untapped** applies only when BOTH brands' coverage was actually known.
 *    `isUntapped` is false for an unknown coverage, but that false is a missing
 *    answer, not a measured "already covered". Comparing a known against an unknown
 *    here would let absent data move a brand, which §7.2 forbids in both directions.
 *  - **Overall fit** applies only between brands whose fit is renderable. An
 *    unrenderable overall value is arithmetic over renormalised logistics, not a
 *    measurement, and letting it decide order would be exactly the fallback
 *    advantage §7.1 rules out — and renderability itself is compared first, so a
 *    brand that can be scored never sits below one that cannot.
 *  - **Discovery rank** is the last resort, and only when both brands have one. It
 *    is provider metadata about why a brand appeared, so it settles a genuine tie
 *    and never breaks one that evidence could have settled. It is never consulted
 *    ahead of an evidence-based key.
 *
 * A brand with no intersection at all sorts last but is never dropped. Removing it
 * would hide a real brand behind a gap in our data about it. A brand with a
 * verified partnership route is NOT promoted ahead of a better overlap: route
 * availability is an actionability detail, not a measure of alignment, and
 * conflating them would quietly turn the ranking into an advertisement.
 */
export function compareOpportunities(a: BrandOpportunity, b: BrandOpportunity): number {
  const byIntersection = compareIntersections(a.intersection, b.intersection);
  if (byIntersection !== 0) return byIntersection;

  if (a.coverageKnown === true && b.coverageKnown === true && a.isUntapped !== b.isUntapped) {
    return a.isUntapped ? -1 : 1;
  }

  const byRenderable = Number(b.fit.overall.renderable) - Number(a.fit.overall.renderable);
  if (byRenderable !== 0) return byRenderable;

  const byFit = b.fit.overall.value - a.fit.overall.value;
  if (byFit !== 0) return byFit;

  const byCoverage = b.fit.overall.componentsUsed - a.fit.overall.componentsUsed;
  if (byCoverage !== 0) return byCoverage;

  const aRank = a.discovery?.rank;
  const bRank = b.discovery?.rank;
  if (aRank !== undefined && bRank !== undefined && aRank !== bRank) return aRank - bRank;

  return a.name.localeCompare(b.name);
}

export function rankOpportunities(opportunities: readonly BrandOpportunity[]): BrandOpportunity[] {
  return [...opportunities].sort(compareOpportunities);
}

/** Registry brand → the shape the opportunity builder wants, pre-enrichment. */
export function toEnrichedBrandShell(registry: RegistryBrand): EnrichedBrand {
  return {
    registry,
    qloo: {
      name: registry.displayName,
      socialHandles: {},
    },
    provenance: { partnership: "derived", metadata: "derived", score: "derived" },
    qlooMissing: true,
  };
}

/** How many of the Taste DNA categories are untapped, for the summary line. */
export function countUntapped(dna: TasteDna, saturation: Record<string, number>, coveredCategories: readonly string[]): number {
  return dna.categories.filter((category) => {
    const coverage =
      coverageWithBasis(category.id, saturation, coveredCategories).coverage ??
      coverageWithBasis(category.label, saturation, coveredCategories).coverage;
    return isUntapped(category.score, coverage);
  }).length;
}
