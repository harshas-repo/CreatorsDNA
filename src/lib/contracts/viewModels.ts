import type { BrandDestination } from "./brand";
import type {
  CulturalEntity,
  DataMode,
  DataSource,
  ExplainabilityStatus,
  NormalisedScore,
  Provenance,
  ScoredTasteTag,
} from "./domain";

/**
 * View-model contracts for the six required visualisations (doc 05 §10 A–F).
 *
 * Design rules encoded here rather than left to the components:
 *
 *  1. Every visualisation carries its own `meta` with data source, provenance,
 *     methodology and a `renderable` flag. Doc 05 §13 permits — and sometimes
 *     requires — omitting a visualisation when the data cannot support it, so
 *     "cannot render" is a first-class state, not an exception.
 *  2. No visualisation receives a bare number. Every score arrives with the
 *     basis on which it was computed, so labels and definitions can be shown
 *     (doc 05 §10B).
 *  3. Nothing here is expressed as a percentage of people. Doc 03 §15 is
 *     explicit that affinity is not survey data.
 *  4. Colours are referenced by ROLE, never by literal value, so the mapping in
 *     `src/lib/design/colourRoles.ts` stays the single documented source
 *     (doc 05 §12: "the specific mapping can be chosen during implementation,
 *     but it should be documented and reused").
 */

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

/**
 * Taste DNA fallback hierarchy (doc 04 §4.5).
 *
 *  L0 — full: M2 entity affinity + M3 harvested tags + M1 scored tag insights
 *  L1 — DESIGN TARGET: M2 entity affinity + M3 harvested tags (M1 unusable)
 *  L2 — affinity absent or unscaled: M2 `index` rank + M3 frequency-weighted tags
 *  L3 — explainability absent: template reasons from our own score breakdown
 *  L4 — HARD FAIL: signals were silently ignored. Must NOT render.
 */
export const FALLBACK_LEVELS = ["L0", "L1", "L2", "L3", "L4"] as const;
export type FallbackLevel = (typeof FALLBACK_LEVELS)[number];

/**
 * Descriptions transcribed from the doc 04 §4.5 fallback table.
 *
 * The levels form an ordered degradation chain, not a severity ranking of
 * independent faults: L4 always wins, otherwise the level is the FURTHEST point
 * down the chain that had to be used. `TasteDnaResult.degradations` lists every
 * condition that applied, so no information is lost by collapsing to one level.
 */
export const FALLBACK_DESCRIPTIONS: Record<FallbackLevel, string> = {
  L0: "Full personalisation: entity recommendations plus scored cultural tags.",
  L1: "Entity-derived Taste DNA: categories and tags harvested from scored recommendations. This is the expected baseline.",
  L2: "Rank-derived Taste DNA: recommendations were returned but carried no usable affinity scores, so position in the result set is used instead.",
  L3: "Evidence unavailable: the data source did not explain its results, so reasons are generated from our own score breakdown instead.",
  L4: "Signals were not honoured by the data source. No taste profile can be shown.",
};

/** Colour roles, bound to provenance and never to good/bad (doc 05 §7, §12). */
export type ColourRole =
  | "taste" // creator-declared / core taste
  | "secondary" // discovered cultural affinity
  | "brand" // brand entities
  | "content" // content categories & coverage
  | "audience" // audience / demographic
  | "geo" // geography
  | "neutral" // structure, axes, chrome
  | "support"; // emphasis, highlights

export interface VisualizationMeta {
  source: DataSource;
  /** Dominant provenance of the values on display. */
  provenance: Provenance;
  /** Plain-language description of how the values were produced. Rendered in the UI. */
  methodology: string;
  renderable: boolean;
  /** Present when `renderable` is false. Explains the omission to the user. */
  omittedReason?: string;
  fallbackLevel: FallbackLevel;
  /** True when any displayed value is illustrative rather than retrieved. */
  containsSynthetic: boolean;
}

export function syntheticFlag(mode: DataMode): boolean {
  return mode === "synthetic";
}

/** A point on a legend, so colour is never the only channel (doc 05 §11). */
export interface LegendEntry {
  role: ColourRole;
  label: string;
  /** Non-colour redundant encoding: shape or line style token. */
  shape?: "circle" | "square" | "diamond" | "triangle" | "ring";
  description?: string;
}

export interface NodeIdentity {
  id: string;
  label: string;
  role: ColourRole;
  provenance: Provenance;
}

// ---------------------------------------------------------------------------
// A. Taste DNA network
// ---------------------------------------------------------------------------

export type TasteNodeKind = "declared_interest" | "discovered_entity" | "derived_category" | "taste_tag";

export interface TasteNode extends NodeIdentity {
  kind: TasteNodeKind;
  /** 0..1 normalised within this network. Drives radius, not colour. */
  weight: number;
  category?: string;
  /** Underlying entity, when the node represents one. */
  entity?: Pick<CulturalEntity, "id" | "name" | "subtype" | "popularity" | "imageUrl">;
  /** True when the node came from `backfill.cross_domain` — the API's own
   *  "beyond your niche" signal (doc 03 §8 step 3). */
  crossDomain: boolean;
}

export interface TasteEdge {
  id: string;
  source: string;
  target: string;
  /** 0..1 strength within this network. Drives stroke width. */
  strength: number;
  relation: "declared" | "recommended" | "co_occurs" | "categorised";
  role: ColourRole;
}

export interface TasteDnaNetworkViewModel {
  viz: "taste-dna-network";
  meta: VisualizationMeta;
  nodes: TasteNode[];
  edges: TasteEdge[];
  legend: LegendEntry[];
  /** Doc 05 §11: graphs must stay readable as nodes grow. Grouping lets the
   *  component collapse by category instead of drawing everything at once. */
  groups: Array<{ id: string; label: string; role: ColourRole; nodeIds: string[] }>;
  /** Cap the component should render before switching to grouped view. */
  readableNodeLimit: number;
}

// ---------------------------------------------------------------------------
// B. Cultural affinity ranking
// ---------------------------------------------------------------------------

export interface AffinityRankItem {
  id: string;
  label: string;
  category?: string;
  /** 0..1, normalised WITHIN this ranking only (doc 03 §15 rule 1). */
  score: number;
  rank: number;
  role: ColourRole;
  provenance: Provenance;
  /** True when this item sits in the documented "cluster of strong matches",
   *  meaning the gap to its neighbour is not meaningful (doc 03 §15). */
  clusteredWithNeighbour: boolean;
  /** Supporting entities, for the inspect-on-click interaction. */
  support: Array<{ entityId: string; entityName: string; weight: number }>;
  definition?: string;
}

export interface AffinityRankingViewModel {
  viz: "cultural-affinity-ranking";
  meta: VisualizationMeta;
  items: AffinityRankItem[];
  /**
   * Which normalisation produced `score` — surfaced in the methodology note.
   *
   * Derived from the domain type rather than restated here. Two copies of this
   * union existed and only one of them was widened when `"declared"` was added,
   * which is how a ranking built from a creator's own confirmed interests ended
   * up able to describe itself as "no usable affinity was returned".
   */
  normalisation: NormalisedScore["method"];
  setSize: number;
  legend: LegendEntry[];
  /** Doc 03 §15: bands are indicative only and filters depress scores, so this
   *  is a soft labelling layer and must be shown with its basis. */
  bands: Array<{ id: string; label: string; min: number; max: number }>;
}

// ---------------------------------------------------------------------------
// C. Opportunity-gap scatter
// ---------------------------------------------------------------------------

/**
 * How a coverage figure came to exist.
 *
 * `inferred_zero` is the one that matters: a creator who declared coverage for
 * some categories and said nothing about the rest gets zero for the rest, which
 * is a defensible default but is OUR inference. Stamping those points
 * `creator_declared` — as the derivation used to do — attributed an assumption to
 * the creator and made the resulting opportunity gap look measured.
 *
 * `measured` is reserved. Nothing in this app measures coverage from a creator's
 * published content, so no code path may emit it; it stays in the union because
 * doc 05 §10C names it and a future measurement must not be forced to reuse a
 * weaker word.
 */
export type CoverageBasis = "creator_declared" | "inferred_zero" | "measured" | "unavailable";

export interface OpportunityPoint {
  id: string;
  label: string;
  /** X axis: 0..1 cultural affinity, normalised within this analysis. */
  affinity: number;
  /** Y axis: 0..1 existing content coverage. */
  coverage: number;
  /** Derived: high affinity + low coverage. Never a Qloo value. */
  gapScore: number;
  role: ColourRole;
  provenance: Provenance;
  /** How coverage was obtained — required by doc 05 §10C. */
  coverageBasis: CoverageBasis;
  supportCount: number;
}

export interface OpportunityGapViewModel {
  viz: "opportunity-gap";
  meta: VisualizationMeta;
  points: OpportunityPoint[];
  axes: {
    x: { label: string; meaning: string; min: number; max: number };
    y: { label: string; meaning: string; min: number; max: number };
  };
  /** Doc 05 §10C: the coverage methodology must be identified, not implied. */
  coverageMethodology: string;
  /** Quadrant labels. Note: no quadrant is "bad" — fit is exploratory
   *  (doc 05 §12), and red/green are not used. */
  quadrants: Array<{ id: string; label: string; description: string; role: ColourRole }>;
  legend: LegendEntry[];
}

// ---------------------------------------------------------------------------
// D. Culture-to-brand relationship map
// ---------------------------------------------------------------------------

export interface BrandPathSegment {
  from: NodeIdentity;
  to: NodeIdentity;
  /** 0..1 contribution. `basis` says where the number came from. */
  strength: number;
  basis: "qloo_explainability" | "creatorsdna_matching";
  role: ColourRole;
}

export interface BrandPathway {
  brandId: string;
  brandName: string;
  /** interest → affinity → brand, as doc 05 §10D requires. */
  segments: BrandPathSegment[];
  explainabilityStatus: ExplainabilityStatus;
  /** Doc 05 §10D: distinguish Qloo explanations from our own deterministic
   *  matching. This flag drives that labelling. */
  evidenceIsQlooSourced: boolean;
}

export interface BrandRelationshipMapViewModel {
  viz: "culture-to-brand-map";
  meta: VisualizationMeta;
  pathways: BrandPathway[];
  legend: LegendEntry[];
  /** Shown when explainability is unavailable, so the fallback is disclosed
   *  rather than passed off as Qloo evidence (doc 02 §37). */
  fallbackNotice?: string;
}

// ---------------------------------------------------------------------------
// E. Brand-fit breakdown
// ---------------------------------------------------------------------------

export const SCORE_DIMENSIONS = [
  "taste_fit",
  "audience_demographic",
  "content_compatibility",
  "geographic",
  "opportunity_gap",
] as const;
export type ScoreDimension = (typeof SCORE_DIMENSIONS)[number];

/** Nominal weights from doc 01 §13 / doc 02 §15. */
export const NOMINAL_WEIGHTS: Record<ScoreDimension, number> = {
  taste_fit: 0.45,
  audience_demographic: 0.2,
  content_compatibility: 0.15,
  geographic: 0.1,
  opportunity_gap: 0.1,
};

export interface ScoreComponent {
  dimension: ScoreDimension;
  label: string;
  /** Nominal weight before renormalisation. */
  weight: number;
  /** Weight actually applied, after renormalising over available components. */
  effectiveWeight: number;
  /** 0..1 normalised within its own result set. `undefined` when unavailable. */
  value: number | undefined;
  available: boolean;
  /** How this component was computed. Always rendered next to the bar. */
  basis: string;
  provenance: Provenance;
}

/**
 * How much of the intended assessment this score actually rests on.
 *
 * §6.4: renormalisation is arithmetically correct and rhetorically dangerous. Two
 * of five dimensions renormalise to weights of 0.75 and 0.25, so a score computed
 * from them is a real number over a real weighting — and it reads exactly like a
 * full assessment unless something says otherwise. `components` carries the
 * per-dimension detail; this carries the summary a reader needs before they look at
 * any of it, so the arithmetic never has to be reconstructed from a diagnostic
 * panel.
 *
 * `culturalEvidence` is the gate that matters most. Two of the five dimensions
 * measure culture (`taste_fit`, `content_compatibility`); the other three measure
 * audience, geography and coverage. A score built only from the latter three says
 * something true about logistics and nothing at all about fit, so it must not be
 * allowed to wear an alignment label. When this is false the overall score is
 * marked unrenderable, whatever the arithmetic produced.
 */
export interface BrandFitEvidenceSummary {
  /** The cultural dimensions that were actually evaluated. */
  culturalDimensionsAvailable: ScoreDimension[];
  /** True when at least one cultural dimension contributed a value. */
  culturalEvidence: boolean;
  /** True when fewer than all five dimensions contributed. */
  partial: boolean;
  /** Nominal weighting actually covered, 0..1. Multiply by 100 to render. */
  coveredWeighting: number;
  /** One or two sentences stating how partial this assessment is. */
  coverageNote: string;
  /** Every dimension that did not contribute, with the reason it could not. */
  unavailable: Array<{ dimension: ScoreDimension; label: string; reason: string }>;
}

export interface BrandFitViewModel {
  viz: "brand-fit-breakdown";
  meta: VisualizationMeta;
  brandId: string;
  brandName: string;
  components: ScoreComponent[];
  /**
   * Overall value, 0..1. Doc 05 §10E warns against unexplained overall
   * percentages, so this MUST be rendered together with `components` and
   * `disclosure` — never on its own.
   */
  overall: {
    value: number;
    /** Qualitative label. Preferred over a bare number in headline positions. */
    label: string;
    componentsUsed: number;
    componentsTotal: number;
    disclosure: string;
    /**
     * How much of the intended assessment this rests on. Rendered with `label` and
     * `value`, never optional: a label without it is the misleading presentation
     * §6 exists to remove.
     */
    evidence: BrandFitEvidenceSummary;
    /**
     * False when the score cannot be interpreted reliably — no dimension could be
     * computed, or none of the ones that could are cultural. `value` is then not a
     * measurement and MUST NOT be rendered; `label` carries the honest sentence
     * instead ("Not enough comparable evidence"). Doc 02 §16.
     */
    renderable: boolean;
  };
  /** Why this brand, in generated prose. Template-based — no LLM (decision D5). */
  rationale: string[];
  legend: LegendEntry[];
}

// ---------------------------------------------------------------------------
// F. Taste fingerprint
// ---------------------------------------------------------------------------

export interface FingerprintSpoke {
  axis: string;
  label: string;
  /** 0..1. Must come from real profile data (doc 05 §10F). */
  value: number;
  role: ColourRole;
  provenance: Provenance;
}

export interface TasteFingerprintViewModel {
  viz: "taste-fingerprint";
  meta: VisualizationMeta;
  /**
   * Deterministic identity derived from the creator's actual profile. Used to
   * seed geometry so two creators with different data cannot receive the same
   * decorative graphic — the explicit requirement in doc 05 §10F.
   */
  signature: string;
  spokes: FingerprintSpoke[];
  /** Ordered taste tags that shape the glyph outline. */
  markers: Array<{ id: string; label: string; weight: number; role: ColourRole }>;
  legend: LegendEntry[];
}

// ---------------------------------------------------------------------------
// Aggregate
// ---------------------------------------------------------------------------

export interface TasteDna {
  level: FallbackLevel;
  levelDescription: string;
  /** Core tastes with scores. */
  coreTastes: ScoredTasteTag[];
  /** Grouped by `subtype` — the "cultural connections" layer. */
  categories: Array<{
    id: string;
    label: string;
    subtype: string;
    score: number;
    entities: Array<{ id: string; name: string; weight: number }>;
  }>;
  /** High affinity + low popularity. Needs no extra API surface (doc 04 §4.3). */
  emergingSignals: Array<{ id: string; label: string; affinity: number; popularity: number }>;
  /** Pure set difference: returned categories minus declared categories. */
  unexpectedAffinities: Array<{
    id: string;
    label: string;
    category: string;
    affinity: number;
    /** Why it counts as unexpected — the four criteria of doc 02 §18. */
    reasons: string[];
    apiSourced: boolean;
  }>;
  /** Doc 02 §17 / doc 01 §12: the UI must separate what the creator said from
   *  what was discovered. */
  declared: Array<{ id: string; label: string }>;
  discovered: Array<{ id: string; label: string; weight: number }>;
}

// ---------------------------------------------------------------------------
// Brand Taste DNA and the Creator x Brand intersection
// ---------------------------------------------------------------------------

/**
 * `BrandTasteDNA` — the brand-side counterpart of `TasteDna`.
 *
 * MEANING (and the limit of that meaning)
 * ----------------------------------------
 * "The cultural interests and affinities associated with this brand in the
 * available Qloo data." It is NOT the brand's customer audience. CreatorsDNA holds
 * no brand-side analytics, so nothing here may be read as "this is who buys from
 * them", and no descriptor below is a demographic.
 *
 * Built entirely from the brand entity Qloo already returned during discovery —
 * its tags, industries, type/subtype and explainability. No second call is made
 * per brand, because a per-brand enrichment call would multiply latency by the
 * candidate count and still come back sparse for most brands.
 *
 * SPARSE IS A NORMAL OUTCOME
 * --------------------------
 * Many live brand results carry little more than a name. That is recorded here as
 * `density: "sparse"` + `evidenceLimited: true` rather than filled in by guessing
 * from the brand's name. A sparse brand stays a candidate; what it loses is the
 * right to a confident intersection claim.
 */

/**
 * What kind of Qloo evidence a brand descriptor rests on.
 *
 * Explainability contributions are deliberately NOT a kind. A contribution names a
 * creator signal the brand was returned *because of*, so treating it as brand taste
 * and then intersecting it with creator taste would match every discovered brand
 * by construction and measure nothing. That link is already carried, honestly, by
 * `BrandOpportunity.drivers` and `BrandPathway`.
 */
export type BrandTasteDescriptorKind =
  /** A tag carried on the brand entity itself. The strongest, most comparable
   *  kind: the creator's taste tags are the same representation. */
  | "tag"
  /** `properties.industries` — Qloo's own classification of the brand. */
  | "industry"
  /** The entity `subtype`, read as a cultural category. Only emitted when it is
   *  more specific than the entity `type`, so "Brands" never describes a brand. */
  | "category";

export interface BrandTasteDescriptor {
  id: string;
  label: string;
  kind: BrandTasteDescriptorKind;
  /**
   * Weight of this descriptor WITHIN this brand, 0..1, summing to 1 across the
   * brand's descriptors. Deliberately not comparable across brands: doc 04 §4.4
   * forbids mixing normalisation sets, and each brand is its own set.
   */
  weight: number;
  /**
   * The tag namespace this descriptor sits in, for `kind: "tag"` only.
   *
   * Carried because comparability is decided at namespace level, not at id level.
   * Two ids are only a like-for-like comparison when they come from the same
   * namespace: `urn:tag:genre:music:punk` and `urn:tag:genre:brand:fashion` are
   * both genre tags but of different catalogues of ideas, and an exact-id match
   * across disjoint namespaces is impossible by construction rather than by
   * finding. Recording the namespace is what lets the intersection say "these two
   * profiles cannot be compared" instead of reporting a zero that reads as a
   * measured absence.
   *
   * `undefined` for industry and category descriptors: those have no namespace,
   * and are matched by normalised name at classification level instead.
   */
  namespace?: string;
  provenance: Provenance;
}

/** How much Qloo actually told us about this brand's cultural world. */
export type BrandTasteDensity =
  | "rich" // descriptors across several kinds, including tags
  | "partial" // some descriptors, but no comparable tags
  | "sparse"; // a name and little else

export interface BrandTasteDNA {
  brandId: string;
  /** Strongest first. Empty is legitimate and means "we know nothing". */
  descriptors: BrandTasteDescriptor[];
  density: BrandTasteDensity;
  /** True when the evidence is too thin to support a confident claim. */
  evidenceLimited: boolean;
  /** The method, in one sentence, so the number beside it can be checked. */
  basis: string;
  provenance: Provenance;
}

/**
 * The four distinct answers to "do these two profiles share cultural ground?".
 *
 * Collapsing them is the single most misleading thing this model can do, because
 * three of the four look identical as a bare zero while meaning different things
 * about DIFFERENT SUBJECTS:
 *
 *  `verified_overlap`        descriptors were compared and at least one matched.
 *  `no_overlap`              descriptors WERE comparable and none matched. This is
 *                            a finding about the brand, and it is the only state
 *                            that may be worded as one.
 *  `insufficient_evidence`   one side carried nothing to compare. A finding about
 *                            our data, never about the brand.
 *  `incomparable`            both sides carried descriptors, but in namespaces with
 *                            no supported relationship between them, so no
 *                            comparison was possible in either direction.
 *
 * `incomparable` and `insufficient_evidence` are kept apart rather than merged into
 * one "could not tell" because they have different remedies: the first needs a
 * taxonomy bridge the provider has not documented, the second needs more data about
 * one entity. Reporting them as one would hide which.
 *
 * §5.2 requires these meanings to be identical in the data model, the view models
 * and the UI, which is why the label table below lives here and not in a component.
 */
export type OverlapState =
  | "verified_overlap"
  | "no_overlap"
  | "insufficient_evidence"
  | "incomparable";

/**
 * The creator-facing wording for each state, shared by every surface that renders
 * one so a brand card and a methodology panel cannot disagree.
 *
 * Note the two states that share a label. "Could not establish shared taste" is
 * deliberately the same sentence for both, because to a creator they ARE the same
 * statement — we could not tell. `stateReason` carries the difference, and the
 * label is not the place for a taxonomy lecture.
 */
export const OVERLAP_STATE_LABEL: Record<OverlapState, string> = {
  verified_overlap: "Shared taste verified",
  no_overlap: "No shared taste found",
  insufficient_evidence: "Could not establish shared taste",
  incomparable: "Could not establish shared taste",
};

/**
 * How much an overlap state is worth to the ranking, highest first.
 *
 * The order encodes EVIDENCE QUALITY, not match quality: a brand whose descriptors
 * were compared and found not to overlap (`no_overlap`) outranks one that could not
 * be compared at all (`incomparable`), which outranks one we know nothing about
 * (`insufficient_evidence`). That is not a claim that a non-match is good — it is
 * a claim that knowing something beats knowing nothing, and §7.1 forbids letting a
 * score we could not defend do the ordering instead.
 *
 * Kept as a table rather than inline arithmetic so a change to the ordering has to
 * be made in one visible place with the rationale beside it.
 */
export const OVERLAP_STATE_RANK: Record<OverlapState, number> = {
  verified_overlap: 3,
  no_overlap: 2,
  incomparable: 1,
  insufficient_evidence: 0,
};

/**
 * Whether a shared dimension rests on an exact descriptor identity or on the
 * coarser classification comparison.
 *
 * §5.4: exact identity and a documented related-concept match must remain
 * distinguishable. In this product only exact identity exists — no taxonomy bridge
 * is documented by the provider — so `classification` is the weaker of the two and
 * is never allowed to carry a numeric strength.
 */
export type SharedTasteMatchBasis = "descriptor" | "classification";

/**
 * Whether a shared dimension sits inside the creator's declared ground or was
 * reached through the Qloo graph.
 *
 * `direct` — the creator confirmed something that carries this dimension, so the
 * overlap is a restatement of ground they already work in.
 * `adjacent` — the dimension reached the profile only through Qloo-expanded
 * entities. This is the interesting case, and it is presented as a discovery to
 * explore, never as a guaranteed commercial fit.
 */
export type SharedTasteKind = "direct" | "adjacent";

export interface SharedTasteDimension {
  id: string;
  label: string;
  kind: SharedTasteKind;
  /** Share of the creator's total taste weight this dimension carries. */
  creatorWeight: number;
  /** Share of the brand's descriptor weight this dimension carries. */
  brandWeight: number;
  /** Where the creator-side weight came from, in words. */
  creatorEvidence: string;
  /** Where the brand-side weight came from, in words. */
  brandEvidence: string;
  /**
   * The ids of the catalogue entities on the creator's side that carry this
   * dimension. Ids rather than names, because this field exists to be joined
   * against `TasteDna.categories[].entities[].id` — the readable names are already
   * in `creatorEvidence`, and two entities can share a name.
   *
   * This is the link that makes the provenance chain walkable end to end —
   * creator input → confirmed entity → derived affinity → shared taste — and what
   * lets a brand be attributed to a specific cultural connection rather than to the
   * run as a whole. Empty when the dimension reached the profile only through
   * expansion, which is exactly the adjacent case.
   */
  tracedTo: string[];
  /**
   * Same provenance vocabulary as `BrandPathSegment.basis`: either Qloo stated the
   * link, or CreatorsDNA matched two representations deterministically.
   */
  basis: "qloo_explainability" | "creatorsdna_matching";
  /**
   * Which of the two comparisons produced this dimension.
   *
   * `descriptor` — an exact id identity between two catalogue tags, the strong
   * case, and the only one allowed to move a numeric strength.
   * `classification` — the brand's recorded industry or subtype matched a creator
   * taste by normalised name. Real Qloo classification on both sides, but a coarser
   * claim, and rendered as one.
   *
   * Kept as data rather than only as prose in `brandEvidence` because the strength
   * labels and the ranking both need to tell the two apart arithmetically, and
   * parsing our own sentences back out would be the fragile way to do it.
   */
  matchBasis: SharedTasteMatchBasis;
  provenance: Provenance;
}

export type IntersectionKind =
  | "direct" // at least one shared dimension is declared ground
  | "adjacent" // shared dimensions exist, all reached through the graph
  | "none"; // nothing was shared — WHY is carried by `state`, not by this field

/**
 * `TasteIntersection` — the central output of the product.
 *
 * Creator Taste DNA x Brand Taste DNA, computed deterministically, carrying the
 * evidence for each shared dimension rather than collapsing it into one number.
 * This is what a brand recommendation is allowed to rest on: Qloo returning a
 * brand is discovery, not a CreatorsDNA recommendation, and the ranking runs AFTER
 * this exists.
 *
 * `strength` is the share of the creator's total taste weight that the brand also
 * carries. It is a within-run share, not a percentage of any audience, and it is
 * `undefined` — never 0 — when it could not be computed.
 *
 * `kind` and `state` answer different questions and must not be read as one.
 * `kind` says where the shared ground sits relative to what the creator declared;
 * `state` says whether a comparison was possible at all. `kind: "none"` with
 * `state: "incomparable"` means we could not look; with `state: "no_overlap"` it
 * means we looked and found nothing.
 */
export interface TasteIntersection {
  brandId: string;
  /** Shared dimensions, strongest first. */
  shared: SharedTasteDimension[];
  kind: IntersectionKind;
  /**
   * The four-way evidence state. Every consumer that renders or ranks an
   * intersection reads this rather than inferring a state from `shared.length`,
   * because an empty `shared` is three different situations.
   */
  state: OverlapState;
  /**
   * Why the state is what it is, in plain language and about the EVIDENCE.
   * Rendered beside `strengthLabel`, and the only place the distinction between
   * "no overlap" and "could not compare" is explained to a creator.
   */
  stateReason: string;
  strength: number | undefined;
  /** Qualitative wording for when the number is too thin to show. */
  strengthLabel: string;
  /** True when the brand side was too sparse for a confident claim. */
  evidenceLimited: boolean;
  /**
   * How many shared dimensions came from the coarse classification comparison
   * rather than an exact descriptor identity. Recorded separately because a
   * classification-only overlap is genuine but cannot carry a numeric strength, and
   * the number lets the UI say "1 of 1 shared dimensions is a classification match"
   * instead of leaving a reader to work out why `strength` is absent.
   */
  classificationMatches: number;
  /**
   * What could NOT be compared, stated rather than scored as zero. Includes the
   * creator's strongest dimensions the brand shows no evidence for.
   */
  missing: string[];
  provenance: Provenance;
  /** The method, in full, for the methodology panel and the media kit. */
  methodology: string;
}

/**
 * Why the catalogue returned this brand — kept structurally separate from fit.
 *
 * §4.1/§4.2: the position a brand holds inside one discovery call is a real fact
 * and worth showing, but it is NOT a measure of cultural compatibility. It is the
 * normalised affinity within the candidate set that produced it, so its scale is
 * set-relative: the top result is always at the top of the range however narrow the
 * underlying spread was. Live brand discovery returned a spread of 0.017 across ten
 * brands; min-max stretched that across 0–1 and made the leader look like a perfect
 * match while proving only that it was first.
 *
 * So the raw value is preserved alongside the normalised one, the scale's
 * ambiguity is recorded rather than resolved by assumption, and `meaning` states in
 * plain words what the numbers do and do not claim. Nothing here feeds a fit score.
 */
export interface BrandDiscoveryEvidence {
  /** 1-based position within the discovery result set. */
  rank: number;
  setSize: number;
  /** The affinity exactly as the provider returned it, before any normalisation. */
  rawAffinity: number | undefined;
  /**
   * What the raw figure appears to be on — a 0–1 proportion, a 0–100 percentage, a
   * unitless score, mixed within one set, or absent. Recorded rather than assumed:
   * the provider does not document it.
   */
  affinityScale: string;
  /**
   * False when the scale could not be resolved from the response. A false value
   * means `rawAffinity` is shown as an uninterpreted number and never as a
   * percentage, which is the whole point of keeping the flag.
   */
  scaleResolved: boolean;
  /**
   * The spread between the highest and lowest raw affinity in the set. This is the
   * figure that makes a normalised position interpretable: a rank of 1 over a spread
   * of 0.017 is a weak claim, and showing the spread is what stops it reading as a
   * strong one.
   */
  setSpread: number | undefined;
  /** The set-relative 0..1 position. Never a percentage of anything. */
  normalisedPosition: number | undefined;
  /** `minmax`, `rank` (every candidate tied), `declared`, or `unavailable`. */
  method: string;
  /** Which call produced this, so two sets are never compared. */
  endpoint: string;
  /** The plain-language reading, rendered next to the numbers it qualifies. */
  meaning: string;
  provenance: Provenance;
}

export interface BrandOpportunity {
  brandId: string;
  brandSlug?: string;
  name: string;
  category?: string;
  fit: BrandFitViewModel;
  pathway?: BrandPathway;
  /** Verified partnership route, or null — never invented (doc 02 §21). */
  partnership: {
    available: boolean;
    creatorPartnershipUrl?: string;
    affiliateUrl?: string;
    ambassadorUrl?: string;
    contactRoute?: string;
    verificationNote?: string;
  };
  /**
   * Who the brand is, from whichever source actually knew.
   *
   * Absent as a whole when nothing descriptive arrived — a card then shows the
   * name and the evidence and says the catalogue had no description, rather than
   * filling the space with a sentence we wrote. Every field inside is optional for
   * the same reason: `undefined` means "not returned", and doc 02 §21 makes
   * substituting a plausible value for it a fabrication.
   *
   * `provenance` covers the descriptive fields as a group. It is the value
   * `mergeBrand` already computed, so the badge on the card cannot disagree with
   * the merge that produced the text beside it.
   */
  metadata?: {
    description?: string;
    region?: string;
    imageUrl?: string;
    /** Followable links, pre-validated as absolute http(s). Empty when none. */
    destination?: BrandDestination;
    social?: Array<{ network: string; handle: string; href: string }>;
    /** Curator commentary from the registry. Never a marketing claim. */
    curatorNote?: string;
    provenance: Provenance;
    /** True when the catalogue had nothing for this brand at all. */
    incomplete: boolean;
  };
  /**
   * Untapped: verified cultural relevance the creator has not covered yet.
   *
   * Requires all three of a verified overlap, an overlap strength at or above the
   * documented clear-overlap line, and a KNOWN coverage figure at or below the
   * untapped line. A brand whose coverage was never declared is `false` here — not
   * because it is covered, but because the question cannot be answered (§7.2).
   */
  isUntapped: boolean;
  /**
   * Whether this brand's category coverage was actually known.
   *
   * Carried separately because `fit.evidence.opportunity_gap.available` conflates
   * "coverage unknown" with "relevance unknown", so it cannot answer this on its
   * own. Ranking uses it to stay neutral when coverage is missing on one side only:
   * `isUntapped === false` for an unknown is not evidence of coverage, and must
   * neither demote the brand below one that is genuinely untapped nor promote it
   * above one. Optional so that pre-existing `BrandOpportunity` literals still
   * typecheck, and `undefined` is treated as unknown.
   */
  coverageKnown?: boolean;
  /**
   * True when this brand came from data-source discovery and is NOT in the
   * curated registry, so it has no verified partnership route and its category is
   * derived rather than hand-curated. Lets the UI label it as a recommendation
   * rather than a curated partner (doc 02 §21 amendment).
   */
  discovered?: boolean;
  /**
   * The declared interests the data source named as driving this brand's
   * recommendation, strongest first. Absent when no explainability arrived.
   * Surfaces the "why this brand" chain (doc 05 §10D) without inventing a reason.
   */
  drivers?: Array<{ name: string; score: number }>;
  /**
   * The brand's own cultural profile, derived from the Qloo entity that discovery
   * returned. Absent only for a brand that reached this list without an entity.
   */
  brandTaste?: BrandTasteDNA;
  /**
   * Why this brand is on the list at all: the cultural ground it shares with the
   * creator, with the evidence for each shared dimension. Ranking is driven by
   * this, not by the fit score.
   */
  intersection?: TasteIntersection;
  /**
   * Why the CATALOGUE returned this brand, as distinct from why CreatorsDNA
   * recommends it.
   *
   * Present whenever discovery produced a rankable position for the brand, and
   * rendered as metadata — never as a fit score, never as a ranking input of its
   * own beyond the documented last-resort tie-break. §10: "a discovery path is not
   * proof of a cultural match."
   */
  discovery?: BrandDiscoveryEvidence;
}

export interface CreatorAnalysis {
  creatorId: string;
  generatedAt: string;
  source: DataSource;
  fallbackLevel: FallbackLevel;
  /** Every observation the provider recorded, surfaced in a debug/honesty panel. */
  observations: Array<{ code: string; detail: string; severity: string }>;
  tasteDna: TasteDna;
  network: TasteDnaNetworkViewModel;
  affinityRanking: AffinityRankingViewModel;
  opportunityGap: OpportunityGapViewModel;
  brandMap: BrandRelationshipMapViewModel;
  brandFits: BrandFitViewModel[];
  fingerprint: TasteFingerprintViewModel;
  opportunities: BrandOpportunity[];
  /**
   * What the brand list as a whole was able to establish, counted by overlap state.
   *
   * §7.1: when no brand has enough evidence for a meaningful cultural match the
   * product must SAY SO, because the interface has room for a list and an empty
   * explanation beside it reads as a recommendation. The counts are the evidence
   * for that sentence and they are also what stops it being said when it is not
   * true — a run with three verified overlaps gets no warning at all.
   *
   * Present whenever brand discovery ran. `message` is set only in the
   * nothing-could-be-established case; otherwise it is absent rather than empty, so
   * a UI cannot render a blank banner by mistake.
   */
  brandEvidenceSummary?: {
    total: number;
    verifiedOverlap: number;
    noOverlap: number;
    couldNotEstablish: number;
    message?: string;
  };
  /** Doc 02 §7: interests that could not be resolved, reported not dropped. */
  unresolvedInterests: Array<{ query: string; reason: string }>;
  /**
   * Phrases the creator wrote that were never confirmed as entities.
   *
   * These are NOT signals: no entity id was resolved for them, so nothing here
   * reached Qloo as an interest. They are carried through so the results can say
   * "you also mentioned X; it was kept as context only" instead of dropping the
   * words the creator typed on the floor. The distinction matters because a
   * context term that quietly became a signal would be an unconfirmed guess
   * driving every downstream number.
   */
  contextTerms: string[];
}

export type AnyViewModel =
  | TasteDnaNetworkViewModel
  | AffinityRankingViewModel
  | OpportunityGapViewModel
  | BrandRelationshipMapViewModel
  | BrandFitViewModel
  | TasteFingerprintViewModel;
