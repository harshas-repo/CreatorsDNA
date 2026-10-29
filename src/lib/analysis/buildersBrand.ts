import type { DataSource, ExplainabilityStatus } from "@/lib/contracts/domain";
import type {
  BrandFitViewModel,
  BrandPathSegment,
  BrandPathway,
  BrandRelationshipMapViewModel,
  ColourRole,
  FallbackLevel,
  NodeIdentity,
  OpportunityGapViewModel,
  OpportunityPoint,
  ScoreComponent,
} from "@/lib/contracts/viewModels";
import { describeBrandFit, sourceVoice } from "@/lib/copy/generate";
import type { BrandFitResult } from "@/lib/scoring/brandFit";
import { round } from "@/lib/utils/deterministic";

import {
  OPPORTUNITY_QUADRANTS,
  quadrantFor,
  type OpportunityDerivation,
} from "./opportunities";
import { DEFAULT_THRESHOLDS, METHODOLOGY, type AnalysisThresholds } from "./thresholds";
import { categoryId, type PooledEntity, type TasteCategory } from "./tasteDna";
import { dominantProvenance, legendFor, unrenderableMeta, visualizationMeta } from "./buildersTaste";

/**
 * Builders for the three brand-side visualisations: C (opportunity gap),
 * D (culture-to-brand relationship map) and E (brand-fit breakdown).
 *
 * Same discipline as `buildersTaste.ts`: these functions do the arithmetic and
 * return plain serialisable objects, and the components render them without
 * computing anything themselves. That is what keeps the six charts from
 * disagreeing about a number.
 *
 * The honesty rules that matter most here:
 *
 *   - **D distinguishes Qloo explanations from our own matching.** Doc 05 §10D
 *     requires the interest → affinity → brand chain to say which link came from
 *     the data source and which is CreatorsDNA logic. `BrandPathSegment.basis`
 *     carries that, and `evidenceIsQlooSourced` is only true when the source is
 *     live AND explainability actually arrived.
 *   - **C never plots an unknown coverage as zero.** Categories with no declared
 *     coverage are omitted upstream by `deriveOpportunities()`; this builder only
 *     renders what survived.
 *   - **E never shows a bare overall number.** `rationale` and `disclosure` are
 *     produced alongside it in the same call, so a caller cannot get one without
 *     the other.
 */

// ---------------------------------------------------------------------------
// C. Opportunity-gap scatter
// ---------------------------------------------------------------------------

export interface OpportunityGapInput {
  derivation: OpportunityDerivation;
  source: DataSource;
  level: FallbackLevel;
  renderable: boolean;
  thresholds?: AnalysisThresholds;
}

/**
 * Quadrant id → colour role.
 *
 * Colouring points by quadrant rather than by a single role is what makes the
 * scatter readable, and it reuses the SAME role vocabulary as the quadrant
 * legend below — so "untapped" is coral in the legend and coral on the canvas.
 * Roles describe situation, never verdict: doc 05 §12 forbids good/bad encoding
 * and the palette contains no red or green at all.
 */
const QUADRANT_ROLE: Record<(typeof OPPORTUNITY_QUADRANTS)[number]["id"], ColourRole> = {
  untapped: "brand",
  established: "taste",
  speculative: "neutral",
  saturated: "content",
};

export function buildOpportunityGap(input: OpportunityGapInput): OpportunityGapViewModel {
  const thresholds = input.thresholds ?? DEFAULT_THRESHOLDS;

  if (!input.renderable || input.derivation.points.length === 0) {
    return {
      viz: "opportunity-gap",
      meta: unrenderableMeta(
        input.source,
        input.level,
        input.derivation.points.length === 0
          ? "No category had both an affinity and a declared coverage, so there is no opportunity gap to plot. Nothing is shown rather than assumed to be uncovered."
          : "The opportunity gap cannot be shown at this fallback level.",
      ),
      points: [],
      axes: OPPORTUNITY_AXES,
      coverageMethodology: input.derivation.coverageMethodology,
      quadrants: [],
      legend: [],
    };
  }

  const points: OpportunityPoint[] = input.derivation.points.map((point) => ({
    ...point,
    role: QUADRANT_ROLE[quadrantFor(point.affinity, point.coverage, thresholds)],
  }));

  // Only explain quadrants that actually contain a point. Listing four empty
  // quadrants invites the reader to look for data that is not there.
  const present = new Set(points.map((point) => quadrantFor(point.affinity, point.coverage, thresholds)));
  const quadrants = OPPORTUNITY_QUADRANTS.filter((quadrant) => present.has(quadrant.id)).map(
    (quadrant) => ({
      id: quadrant.id,
      label: quadrant.label,
      description: quadrant.description,
      role: QUADRANT_ROLE[quadrant.id],
    }),
  );

  return {
    viz: "opportunity-gap",
    meta: visualizationMeta({
      source: input.source,
      // Every value here is ours: affinity comes from the data source but the
      // GAP — affinity × uncovered share — is a CreatorsDNA derivation.
      provenance: "derived",
      // The definition, and only the definition. The run-specific coverage facts
      // are rendered immediately below this line by `OpportunityGap` as the
      // frame's "Coverage basis" footnote, so joining them here printed the same
      // two sentences twice inside one figure.
      methodology: METHODOLOGY.opportunityGap,
      fallbackLevel: input.level,
      renderable: input.derivation.coverageBasis !== "unavailable",
      omittedReason:
        input.derivation.coverageBasis === "unavailable"
          ? "Coverage information was unavailable, so the gap could not be computed."
          : undefined,
    }),
    points,
    axes: OPPORTUNITY_AXES,
    coverageMethodology: input.derivation.coverageMethodology,
    quadrants,
    legend: legendFor(quadrants.map((quadrant) => quadrant.role)),
  };
}

/**
 * Axis definitions, fixed rather than fitted to the data.
 *
 * Both axes stay 0..1 even when the points cluster in a corner. Rescaling to the
 * observed range would visually exaggerate small differences — a real risk in a
 * chart whose whole purpose is comparing magnitudes.
 */
const OPPORTUNITY_AXES: OpportunityGapViewModel["axes"] = {
  x: {
    label: "Cultural affinity",
    // Kept short on purpose: `OpportunityGap` paints the two axis meanings on
    // one shared baseline at opposite ends of a 590-unit plot, so a long
    // sentence here does not wrap, it collides with the other axis's sentence.
    // The full definition lives on each point's own card and on /methodology.
    meaning: "Relative to this result set, not a share of people.",
    min: 0,
    max: 1,
  },
  y: {
    label: "Your existing coverage",
    meaning: "Self-reported by you, not measured from your content.",
    min: 0,
    max: 1,
  },
};

// ---------------------------------------------------------------------------
// D. Culture-to-brand relationship map
// ---------------------------------------------------------------------------

export interface BrandMapInput {
  /** Scored brands, in display order. `brandId` matches `PooledEntity.id` when
   *  the data source scored the brand directly. */
  brands: Array<{
    brandId: string;
    brandName: string;
    category?: string;
    /** The brand's own fit breakdown, used to source the final segment strength. */
    fit: BrandFitResult;
  }>;
  /** Declared interests: what the creator actually selected. */
  declared: Array<{ id: string; label: string }>;
  /** Derived taste categories, the middle layer of the chain. */
  categories: readonly TasteCategory[];
  /** Every scored entity, used to find a bridge carrying explainability. */
  pool: readonly PooledEntity[];
  source: DataSource;
  level: FallbackLevel;
  renderable: boolean;
  maxPathways?: number;
}

export function buildBrandRelationshipMap(input: BrandMapInput): BrandRelationshipMapViewModel {
  if (!input.renderable || input.brands.length === 0 || input.declared.length === 0) {
    return {
      viz: "culture-to-brand-map",
      meta: unrenderableMeta(
        input.source,
        input.level,
        input.declared.length === 0
          ? "No declared interests were available, so no chain from your taste to a brand can be shown."
          : "No brands were scored for this analysis.",
      ),
      pathways: [],
      legend: [],
    };
  }

  const maxPathways = input.maxPathways ?? 6;
  const declaredById = new Map(input.declared.map((entry) => [entry.id, entry.label]));
  const pathways: BrandPathway[] = [];

  for (const brand of input.brands) {
    if (pathways.length >= maxPathways) break;
    const pathway = pathwayFor(brand, input, declaredById);
    if (pathway === undefined) continue;
    pathways.push(pathway);
  }

  // Doc 05 §10D / doc 02 §37: when the chain is our own matching rather than the
  // data source's explanation, that must be stated on the chart, not buried.
  const anyQlooSourced = pathways.some((pathway) => pathway.evidenceIsQlooSourced);
  const fallbackNotice = anyQlooSourced
    ? undefined
    : pathways.length === 0
      ? "No explainable chain could be built from your interests to these brands, so none is drawn. Drawing one would mean inventing a reason."
      : "The data source did not explain these results, so every link shown is CreatorsDNA's own deterministic matching — category and taste overlap — not a Qloo explanation.";

  return {
    viz: "culture-to-brand-map",
    meta: visualizationMeta({
      source: input.source,
      provenance: dominantProvenance(
        pathways.flatMap((pathway) =>
          pathway.segments.flatMap((segment) => [segment.from.provenance, segment.to.provenance]),
        ),
      ),
      methodology: `${METHODOLOGY.brandFit} Chains show interest → cultural affinity → brand; each link states whether the number came from the data source's explainability or from our own matching.`,
      fallbackLevel: input.level,
      renderable: pathways.length > 0,
      omittedReason: pathways.length === 0 ? fallbackNotice : undefined,
    }),
    pathways,
    legend: legendFor(["taste", "secondary", "neutral", "brand"]),
    fallbackNotice,
  };
}

function pathwayFor(
  brand: BrandMapInput["brands"][number],
  input: BrandMapInput,
  declaredById: Map<string, string>,
): BrandPathway | undefined {
  const brandEntity = input.pool.find((entity) => entity.id === brand.brandId);
  const status = explainabilityStatusOf(brandEntity);

  const brandNode: NodeIdentity = {
    id: `brand:${brand.brandId}`,
    label: brand.brandName,
    role: "brand",
    provenance: brandEntity?.provenance ?? "derived",
  };

  // Prefer a real bridge: an entity in the same category as the brand that the
  // data source itself tied back to something the creator declared. That gives a
  // chain whose middle link is genuinely evidence rather than a category label.
  const bridge = findBridge(brand, input, declaredById);
  if (bridge !== undefined) {
    const segments: BrandPathSegment[] = [
      {
        from: {
          id: `declared:${bridge.declaredId}`,
          label: bridge.declaredLabel,
          role: "taste",
          provenance: "creator",
        },
        to: {
          id: `entity:${bridge.entity.id}`,
          label: bridge.entity.name,
          role: "secondary",
          provenance: bridge.entity.provenance,
        },
        strength: round(bridge.contributionScore, 4),
        basis: "qloo_explainability",
        role: "secondary",
      },
      {
        from: {
          id: `entity:${bridge.entity.id}`,
          label: bridge.entity.name,
          role: "secondary",
          provenance: bridge.entity.provenance,
        },
        to: brandNode,
        // The brand-category link is OURS: the data source does not say "this
        // movie implies this brand". Labelling it qloo_explainability would be
        // the single most damaging misattribution available in this feature.
        strength: round(tasteFitOf(brand) ?? bridge.entity.rank.value, 4),
        basis: "creatorsdna_matching",
        role: "brand",
      },
    ];

    return {
      brandId: brand.brandId,
      brandName: brand.brandName,
      segments,
      explainabilityStatus: status,
      evidenceIsQlooSourced: isQlooEvidence(status, segments, input.source),
    };
  }

  // No bridge. Fall back to a category-level chain, entirely our own matching,
  // and say so through `basis` on both segments.
  const category = matchCategory(brand, input.categories);
  if (category === undefined) return undefined;

  const declaredId = declaredInterestForCategory(category, input.pool, declaredById);
  if (declaredId === undefined) return undefined;

  const categoryNode: NodeIdentity = {
    id: `category:${category.id}`,
    label: category.label,
    role: "neutral",
    provenance: "derived",
  };

  const segments: BrandPathSegment[] = [
    {
      from: {
        id: `declared:${declaredId}`,
        label: declaredById.get(declaredId) ?? declaredId,
        role: "taste",
        provenance: "creator",
      },
      to: categoryNode,
      strength: round(category.score, 4),
      basis: "creatorsdna_matching",
      role: "neutral",
    },
    {
      from: categoryNode,
      to: brandNode,
      strength: round(tasteFitOf(brand) ?? category.score, 4),
      basis: "creatorsdna_matching",
      role: "brand",
    },
  ];

  return {
    brandId: brand.brandId,
    brandName: brand.brandName,
    segments,
    explainabilityStatus: status,
    evidenceIsQlooSourced: false,
  };
}

interface Bridge {
  declaredId: string;
  declaredLabel: string;
  entity: PooledEntity;
  contributionScore: number;
}

/**
 * Find the best interest → affinity bridge for a brand.
 *
 * Candidates are pooled entities in the SAME category as the brand that carry an
 * explainability contribution pointing at a declared interest. Ranked by the
 * entity's within-set normalised score, then by contribution score, then by name
 * — deterministic, so the same analysis always draws the same chain.
 */
function findBridge(
  brand: BrandMapInput["brands"][number],
  input: BrandMapInput,
  declaredById: Map<string, string>,
): Bridge | undefined {
  const target = brandCategory(brand, input.pool);
  const candidates: Bridge[] = [];

  for (const entity of input.pool) {
    if (entity.id === brand.brandId) continue;
    if (target !== undefined && categoryId(entity) !== target) continue;

    for (const contribution of entity.explainability.contributions) {
      const label = declaredById.get(contribution.signalEntityId);
      if (label === undefined) continue;
      candidates.push({
        declaredId: contribution.signalEntityId,
        declaredLabel: label,
        entity,
        contributionScore: contribution.score,
      });
    }
  }

  if (candidates.length === 0) return undefined;
  return candidates.sort(
    (a, b) =>
      b.entity.rank.value - a.entity.rank.value ||
      b.contributionScore - a.contributionScore ||
      a.entity.name.localeCompare(b.entity.name),
  )[0];
}

/** The brand's category: its registry category, else the scored entity's URN. */
function brandCategory(
  brand: BrandMapInput["brands"][number],
  pool: readonly PooledEntity[],
): string | undefined {
  if (brand.category !== undefined && brand.category.length > 0) return brand.category;
  const entity = pool.find((candidate) => candidate.id === brand.brandId);
  return entity === undefined ? undefined : categoryId(entity);
}

/** Category whose id or label matches the brand's own category. */
function matchCategory(
  brand: BrandMapInput["brands"][number],
  categories: readonly TasteCategory[],
): TasteCategory | undefined {
  if (brand.category === undefined) return undefined;
  const needle = brand.category.toLowerCase();
  return categories.find((category) => {
    const id = category.id.toLowerCase();
    const subtype = category.subtype.toLowerCase();
    return id.includes(needle) || needle.includes(id) || subtype.includes(needle);
  });
}

/**
 * Which declared interest feeds this category?
 *
 * Taken from the category's own contributing entities' explainability, so the
 * answer is evidence-based rather than alphabetical. Falls back to the first
 * declared interest only when no contribution names one.
 */
function declaredInterestForCategory(
  category: TasteCategory,
  pool: readonly PooledEntity[],
  declaredById: Map<string, string>,
): string | undefined {
  const memberIds = new Set(category.entities.map((entity) => entity.id));
  const counts = new Map<string, number>();

  for (const entity of pool) {
    if (!memberIds.has(entity.id)) continue;
    for (const contribution of entity.explainability.contributions) {
      if (!declaredById.has(contribution.signalEntityId)) continue;
      counts.set(
        contribution.signalEntityId,
        (counts.get(contribution.signalEntityId) ?? 0) + contribution.score,
      );
    }
  }

  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (ranked.length > 0) return ranked[0]![0];
  return declaredById.size > 0 ? [...declaredById.keys()].sort()[0] : undefined;
}

function tasteFitOf(brand: BrandMapInput["brands"][number]): number | undefined {
  return brand.fit.components.find((component) => component.dimension === "taste_fit")?.value;
}

function explainabilityStatusOf(entity: PooledEntity | undefined): ExplainabilityStatus {
  if (entity === undefined) return "unavailable";
  return entity.explainability.status;
}

/**
 * Is this pathway's evidence genuinely from the live data source?
 *
 * Three conditions, all required. `synthetic` explainability is produced by our
 * own development provider and must never be presented as a Qloo explanation —
 * that is execution decision 3's "do not present synthetic results as Qloo
 * discoveries", enforced in code rather than by convention.
 */
function isQlooEvidence(
  status: ExplainabilityStatus,
  segments: readonly BrandPathSegment[],
  source: DataSource,
): boolean {
  if (source.isIllustrative) return false;
  if (status !== "available") return false;
  return segments.some((segment) => segment.basis === "qloo_explainability");
}

// ---------------------------------------------------------------------------
// E. Brand-fit breakdown
// ---------------------------------------------------------------------------

export interface BrandFitInput {
  brandId: string;
  brandName: string;
  fit: BrandFitResult;
  source: DataSource;
  level: FallbackLevel;
  /** Omit the score entirely when the brand could not be resolved at all. */
  renderable?: boolean;
  omittedReason?: string;
}

/**
 * Build the brand-fit breakdown.
 *
 * `rationale` is generated in the same call as `overall` and from the same data,
 * which is deliberate: doc 05 §10E warns against unexplained overall
 * percentages, and the only reliable way to guarantee an explanation travels with
 * a number is to make it impossible to obtain one without the other.
 */
export function buildBrandFitViewModel(input: BrandFitInput): BrandFitViewModel {
  const voice = sourceVoice(input.source);
  const renderable = (input.renderable ?? true) && input.fit.overall.renderable;

  if (!renderable) {
    return {
      viz: "brand-fit-breakdown",
      meta: unrenderableMeta(
        input.source,
        input.level,
        input.omittedReason ?? input.fit.overall.disclosure,
      ),
      brandId: input.brandId,
      brandName: input.brandName,
      components: input.fit.components,
      overall: { ...input.fit.overall, renderable: false },
      // Even unrenderable, the breakdown states WHY. A silent omission reads as
      // a bug; a stated one reads as honest data limits.
      rationale: [input.omittedReason ?? input.fit.overall.disclosure],
      legend: [],
    };
  }

  const shell: BrandFitViewModel = {
    viz: "brand-fit-breakdown",
    meta: visualizationMeta({
      source: input.source,
      provenance: input.fit.provenance,
      methodology: METHODOLOGY.brandFit,
      fallbackLevel: input.level,
    }),
    brandId: input.brandId,
    brandName: input.brandName,
    components: input.fit.components,
    overall: input.fit.overall,
    rationale: [],
    legend: legendFor(componentRoles(input.fit.components)),
  };

  return { ...shell, rationale: describeBrandFit(shell, voice) };
}

/**
 * Roles for the five dimensions, in a fixed order.
 *
 * Each dimension gets the role that matches what it MEASURES, so the breakdown
 * speaks the same colour language as every other chart: audience dimensions are
 * magenta here and magenta in the audience panel, geography is lime here and lime
 * on the map. A dimension that contributed nothing is dropped from the legend
 * rather than shown greyed-out, because an empty swatch reads as a value of zero.
 */
const DIMENSION_ROLE = {
  taste_fit: "taste",
  audience_demographic: "audience",
  content_compatibility: "content",
  geographic: "geo",
  opportunity_gap: "brand",
} as const satisfies Record<BrandFitViewModel["components"][number]["dimension"], ColourRole>;

function componentRoles(components: readonly ScoreComponent[]): ColourRole[] {
  return components
    .filter((component) => component.available)
    .map((component) => DIMENSION_ROLE[component.dimension]);
}

export { DIMENSION_ROLE };
