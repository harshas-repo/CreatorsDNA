import {
  NOMINAL_WEIGHTS,
  SCORE_DIMENSIONS,
  type BrandFitEvidenceSummary,
  type ScoreComponent,
  type ScoreDimension,
} from "@/lib/contracts/viewModels";
import type { Provenance } from "@/lib/contracts/domain";
import { clamp, round } from "@/lib/utils/deterministic";

import { DIMENSION_LABELS, type DimensionEvidence } from "./dimensions";

/**
 * The deterministic brand-fit aggregator (doc 02 §15).
 *
 * Three rules drive the whole file:
 *
 *   1. **"The final score must be explainable."** Every component carries the
 *      nominal weight, the weight ACTUALLY applied, the 0..1 value and the basis
 *      string. The UI renders all four, so an overall number never appears
 *      without its arithmetic (doc 05 §10E warns specifically against
 *      unexplained overall percentages).
 *
 *   2. **Omitted dimensions are renormalised, never defaulted.** Doc 02 §16
 *      allows "omit / neutral fallback / mark unavailable". A neutral fallback
 *      is rejected here because 0.5 would assert knowledge we do not have and
 *      would compress every partial score toward the middle. Renormalising keeps
 *      the score honest AND keeps it comparable, at the cost of lower coverage —
 *      which is why `coverage` and `disclosure` are part of the result.
 *
 *   3. **Renormalisation may not launder a thin evidence base into a strong
 *      claim.** This is the rule §6 adds, and it is the one the product was
 *      missing. Renormalising two dimensions to 0.75/0.25 is arithmetically fine
 *      and produced a live card reading "No shared taste found / Clear alignment /
 *      75/100 / 2 of 5 dimensions" — every part true, the whole misleading. So the
 *      score is gated on whether any CULTURAL dimension contributed, the alignment
 *      label is gated on whether the dominant one did, and the size of the gap is
 *      stated in `evidence.coverageNote` rather than left to be reconstructed.
 *
 * Consequence worth stating plainly: a brand scored on taste fit alone is NOT
 * equivalent to a brand scored on all five, even at the same overall value. The
 * disclosure string exists so that difference is visible rather than buried.
 */

export type BrandFitEvidence = Partial<Record<ScoreDimension, DimensionEvidence>>;

/**
 * The dimensions that measure CULTURE rather than logistics.
 *
 * `audience_demographic`, `geographic` and `opportunity_gap` are all real and worth
 * scoring, but none of them says anything about whether a creator and a brand occupy
 * the same cultural ground: they measure who watches, where, and what is already
 * covered. A score assembled from only those three is a true statement about
 * logistics wearing an alignment label, which is what the gate below prevents.
 */
export const CULTURAL_DIMENSIONS: readonly ScoreDimension[] = [
  "taste_fit",
  "content_compatibility",
];

/** Shown when the score cannot be interpreted reliably (§6.3). */
export const NOT_ENOUGH_EVIDENCE_LABEL = "Not enough comparable evidence";
/** Shown when cultural evidence exists but the dominant dimension could not be scored. */
export const PARTIAL_ASSESSMENT_LABEL = "Partial assessment";

export interface BrandFitOverall {
  /** 0..1. Zero when nothing could be computed — see `renderable`. */
  value: number;
  /** Qualitative label, preferred over a bare number in headline positions. */
  label: string;
  componentsUsed: number;
  componentsTotal: number;
  disclosure: string;
  /** How much of the intended assessment this rests on. Always rendered with `label`. */
  evidence: BrandFitEvidenceSummary;
  /** False when the score cannot be interpreted reliably; the UI must omit it. */
  renderable: boolean;
}

export interface BrandFitResult {
  components: ScoreComponent[];
  overall: BrandFitOverall;
  /** Sum of nominal weights that were actually available, 0..1. */
  coverage: number;
  /** Dominant provenance across the components that contributed. */
  provenance: Provenance;
}

/**
 * Qualitative bands.
 *
 * Deliberately descriptive rather than evaluative. Doc 05 §12 forbids implying
 * that an opportunity is good or bad, and cultural fit is exploratory — so these
 * labels state the STRENGTH of the alignment the data shows, never a verdict on
 * whether the creator should pursue it.
 *
 * The two strongest bands carry an evidence condition the number alone cannot
 * express — see `overallLabel`.
 */
const BANDS: Array<{ min: number; label: string }> = [
  { min: 0.8, label: "Strong alignment" },
  { min: 0.6, label: "Clear alignment" },
  { min: 0.4, label: "Moderate alignment" },
  { min: 0.2, label: "Limited alignment" },
  { min: 0, label: "Little alignment" },
];

export function alignmentLabel(value: number): string {
  return (BANDS.find((band) => value >= band.min) ?? BANDS[BANDS.length - 1]!).label;
}

/**
 * The label an overall value is allowed to wear, given what it rests on.
 *
 * A score with no cultural dimension behind it gets no alignment word at all. A
 * score with cultural evidence but WITHOUT `taste_fit` — the 45%-weighted intensity
 * measure — is capped at "Partial assessment", because whatever it was built from
 * (audience deltas, a country match, a coverage gap) is not a measurement of
 * cultural compatibility and renormalisation cannot promote it into one. §6.3: "a
 * score based only on relative discovery ranking cannot produce a
 * cultural-alignment label" — and by the same argument, neither can one based only
 * on geography.
 */
function overallLabel(value: number, evidence: BrandFitEvidenceSummary): string {
  if (!evidence.culturalEvidence) return NOT_ENOUGH_EVIDENCE_LABEL;
  if (!evidence.culturalDimensionsAvailable.includes("taste_fit")) return PARTIAL_ASSESSMENT_LABEL;
  return alignmentLabel(value);
}

function evidenceSummary(
  components: readonly ScoreComponent[],
  evidence: BrandFitEvidence,
  coverage: number,
): BrandFitEvidenceSummary {
  const contributed = components.filter((component) => component.available);
  const culturalDimensionsAvailable = CULTURAL_DIMENSIONS.filter((dimension) =>
    contributed.some((component) => component.dimension === dimension),
  );
  const unavailable = components
    .filter((component) => !component.available)
    .map((component) => ({
      dimension: component.dimension,
      label: component.label,
      reason:
        evidence[component.dimension]?.unavailableReason?.trim() ||
        "Not computed for this analysis.",
    }));
  const partial = contributed.length < SCORE_DIMENSIONS.length;

  // Appended whenever no cultural dimension contributed — §6.3's refusal to claim
  // an alignment label has to be stated in the same breath as the arithmetic.
  const noCulturalSentence =
    culturalDimensionsAvailable.length === 0
      ? " None of the dimensions that measure cultural compatibility could be scored, so no alignment label is claimed."
      : "";

  // THREE cases, not two. At zero contributors nothing was renormalised and there
  // is no figure, so the partial-assessment sentence would vouch for arithmetic
  // that never happened — "renormalised into the ones that did" names a set that
  // is empty, and "the figure is arithmetically correct" describes a number that
  // was withheld. It would also contradict `Overall`, which has its own
  // zero-contributor branch saying exactly the opposite. This is user-facing:
  // ScoreBreakdown renders `coverageNote` whenever the assessment is partial,
  // unrenderable scores included.
  const coverageNote =
    contributed.length === 0
      ? `None of the ${SCORE_DIMENSIONS.length} dimensions could be computed, so there is no figure and nothing was renormalised. Every one was excluded rather than assumed, and the reason is listed against it.${noCulturalSentence}`
      : partial
        ? `This is a partial assessment. ${contributed.length} of ${SCORE_DIMENSIONS.length} dimensions contributed, covering ${Math.round(
            coverage * 100,
          )}% of the intended weighting; the rest were renormalised into the ones that did. The figure is arithmetically correct over the available dimensions, but it is not a full assessment and should not be read as one.${noCulturalSentence}`
        : "All five dimensions contributed at their nominal weights, so this is a complete assessment.";

  return {
    culturalDimensionsAvailable,
    culturalEvidence: culturalDimensionsAvailable.length > 0,
    partial,
    coveredWeighting: round(coverage, 4),
    coverageNote,
    unavailable,
  };
}

export function scoreBrandFit(evidence: BrandFitEvidence): BrandFitResult {
  const availableDimensions = SCORE_DIMENSIONS.filter(
    (dimension) => evidence[dimension]?.value !== undefined,
  );
  const nominalTotal = availableDimensions.reduce(
    (sum, dimension) => sum + NOMINAL_WEIGHTS[dimension],
    0,
  );

  const components: ScoreComponent[] = SCORE_DIMENSIONS.map((dimension) => {
    const found = evidence[dimension];
    const nominal = NOMINAL_WEIGHTS[dimension];
    const value = found?.value;
    const isAvailable = value !== undefined && found !== undefined;
    const effectiveWeight =
      isAvailable && nominalTotal > 0 ? nominal / nominalTotal : 0;

    return {
      dimension,
      label: DIMENSION_LABELS[dimension],
      weight: nominal,
      effectiveWeight: round(effectiveWeight, 4),
      value: isAvailable ? clamp(round(value as number, 4)) : undefined,
      available: isAvailable,
      basis: found?.basis ?? "Not computed for this analysis.",
      provenance: found?.provenance ?? "derived",
    };
  });

  const coverage = round(nominalTotal, 4);
  const used = availableDimensions.length;
  const emptySummary = evidenceSummary(components, evidence, 0);

  if (used === 0 || nominalTotal <= 0) {
    return {
      components,
      coverage: 0,
      provenance: "derived",
      overall: {
        value: 0,
        label: NOT_ENOUGH_EVIDENCE_LABEL,
        componentsUsed: 0,
        componentsTotal: SCORE_DIMENSIONS.length,
        disclosure:
          "None of the five dimensions could be computed from the available data, so no fit score is shown. Inventing one would breach the no-fabrication rule.",
        evidence: emptySummary,
        renderable: false,
      },
    };
  }

  const value = clamp(
    components.reduce(
      (sum, component) => sum + (component.value ?? 0) * component.effectiveWeight,
      0,
    ),
  );

  const summary = evidenceSummary(components, evidence, coverage);

  const omitted = components
    .filter((component) => !component.available)
    .map((component) => component.label);

  const disclosure =
    omitted.length === 0
      ? "Computed from all five dimensions at their nominal weights."
      : `Computed from ${used} of ${SCORE_DIMENSIONS.length} dimensions, covering ${Math.round(
          coverage * 100,
        )}% of the nominal weighting. ${omitted.join(", ")} ${
          omitted.length === 1 ? "was" : "were"
        } excluded because the data was not available — not set to a default.`;

  // The disclosure is what the detail stage prints when the score is withheld, so
  // it has to say WHY it was withheld. The arithmetic sentence above describes the
  // dimensions that contributed and stops there, which in the unrenderable case
  // leaves a reader with "3 of 5 dimensions" and no reason not to treat it as a
  // fit score that happened to come out low. §6.3: the two are different claims —
  // a withheld score says the evidence cannot support an alignment reading, not
  // that the brand was assessed and failed.
  const renderable = summary.culturalEvidence;
  const disclosureWithReason = renderable
    ? disclosure
    : `${disclosure} No fit score is shown, because none of the dimensions that contributed measures cultural compatibility — what was assessed is real, and it is about audience, geography and coverage. A number here would read as an alignment verdict that nothing in the evidence supports.`;

  const label = overallLabel(value, summary);

  return {
    components,
    coverage,
    provenance: dominantProvenance(components),
    overall: {
      value: round(value, 4),
      label,
      componentsUsed: used,
      componentsTotal: SCORE_DIMENSIONS.length,
      disclosure: disclosureWithReason,
      evidence: summary,
      // Unrenderable when no dimension contributed OR when none of the ones that did
      // measure culture. The second condition is what stops a geography-and-audience
      // score from being presented as cultural fit; the value is still carried for
      // the diagnostic panel, which states plainly that it is not a measurement of
      // alignment.
      renderable,
    },
  };
}

/**
 * Which provenance dominates the components that actually contributed.
 *
 * `synthetic` wins any tie and any presence: if even one contributing value is
 * illustrative, the whole breakdown must carry the illustrative banner. That is
 * the conservative direction, and it is the one doc 05 §13 demands.
 */
function dominantProvenance(components: readonly ScoreComponent[]): Provenance {
  const contributing = components.filter((component) => component.available);
  if (contributing.some((component) => component.provenance === "synthetic")) return "synthetic";
  if (contributing.every((component) => component.provenance === "creator")) return "creator";
  if (contributing.some((component) => component.provenance === "qloo")) return "qloo";
  return "derived";
}

// ---------------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------------

export interface RankableBrandFit {
  id: string;
  fit: BrandFitResult;
}

/**
 * Deterministic ordering for a scored brand list.
 *
 * A score that is not renderable sorts LAST, always. Its `value` is either 0 by
 * construction or a number that measures logistics rather than culture, and either
 * way comparing it against a real score would be meaningless — worse, because a
 * non-renderable brand's value is never higher, leaving it in the numeric comparison
 * would silently treat "we could not score this" as "we scored it and it lost".
 * §7.1: an unavailable overall fit must never act as a fallback ranking advantage,
 * and by the same token never as a disadvantage that looks like one.
 *
 * Ties are common and must be broken STABLY, or the same analysis re-run would
 * reshuffle the list. Order: renderability, overall value, coverage (a
 * fully-evidenced score outranks a one-dimension score at the same value), taste fit
 * (the dominant dimension), then id. No randomness anywhere.
 */
export function compareBrandFit(a: RankableBrandFit, b: RankableBrandFit): number {
  const byRenderable = Number(b.fit.overall.renderable) - Number(a.fit.overall.renderable);
  if (byRenderable !== 0) return byRenderable;

  const byOverall = b.fit.overall.value - a.fit.overall.value;
  if (byOverall !== 0) return byOverall;

  const byCoverage = b.fit.coverage - a.fit.coverage;
  if (byCoverage !== 0) return byCoverage;

  const tasteA = a.fit.components.find((c) => c.dimension === "taste_fit")?.value ?? -1;
  const tasteB = b.fit.components.find((c) => c.dimension === "taste_fit")?.value ?? -1;
  if (tasteA !== tasteB) return tasteB - tasteA;

  return a.id.localeCompare(b.id);
}

export function rankBrandFits(brands: RankableBrandFit[]): RankableBrandFit[] {
  return [...brands].sort(compareBrandFit);
}
