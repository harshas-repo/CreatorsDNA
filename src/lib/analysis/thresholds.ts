/**
 * Every tunable constant in the analysis pipeline, in one object.
 *
 * Doc 04 §7 (workstream S3) requires that "constants that depend on A2 are
 * isolated behind one config object", because A2 — the scale of `query.affinity`
 * — is still unverified against the live host. If the probe shows affinities
 * arriving on a different scale, the corrections land here and nowhere else.
 *
 * Each constant records WHY it has this value. A magic number without a stated
 * basis is indistinguishable from a fabricated one, and doc 02 §16 forbids
 * fabricating scores.
 */

export interface AnalysisThresholds {
  /**
   * Minimum number of distinct entity results that must carry a tag before it is
   * surfaced (doc 04 §4.2: "a tag on one result is an anecdote; a tag on twelve
   * is a pattern").
   */
  minTagSupport: number;
  /** Maximum core tastes rendered. Beyond this the network becomes unreadable. */
  maxCoreTastes: number;
  /**
   * "Meaningful relevance" for the unexpected-affinity test (doc 02 §18
   * criterion 2), on the within-set normalised 0..1 scale.
   *
   * 0.55 sits above the midpoint so that merely-average results are excluded,
   * but below the top decile so the list is not just "the top five results" —
   * which doc 02 §18 explicitly warns against.
   */
  unexpectedMinAffinity: number;
  /**
   * "Sufficiently different" for doc 02 §18 criterion 4. A candidate whose
   * category shares more than this fraction of its tags with the creator's
   * declared categories is too close to be interesting.
   */
  unexpectedMaxCategorySimilarity: number;
  /** Maximum unexpected affinities surfaced. */
  maxUnexpected: number;
  /**
   * Emerging signal = high normalised affinity AND low catalogue popularity
   * (doc 04 §4.3). Both fields are confirmed present (fact F15), so this needs
   * no unverified assumption.
   */
  emergingMinAffinity: number;
  emergingMaxPopularity: number;
  maxEmerging: number;
  /**
   * Two normalised scores closer than this are treated as tied rather than
   * ranked (doc 03 §15: "91 versus 92 usually indicates similar relevance").
   */
  tieTolerance: number;
  /** Coverage at or above which a category counts as saturated (untapped test). */
  saturatedCoverage: number;
  /** Coverage at or below which a category counts as untouched (untapped test). */
  untappedCoverage: number;
  /** Minimum categories in the Taste DNA before it is considered useful. */
  minCategories: number;
}

export const DEFAULT_THRESHOLDS: AnalysisThresholds = {
  minTagSupport: 2,
  maxCoreTastes: 12,
  unexpectedMinAffinity: 0.55,
  unexpectedMaxCategorySimilarity: 0.34,
  maxUnexpected: 6,
  emergingMinAffinity: 0.6,
  emergingMaxPopularity: 0.4,
  maxEmerging: 6,
  tieTolerance: 0.02,
  saturatedCoverage: 0.7,
  untappedCoverage: 0.25,
  minCategories: 1,
};

/**
 * Methodology strings.
 *
 * Rendered verbatim in the UI next to the values they describe, so a user can
 * always see how a number was produced. Kept here rather than inline in the
 * components so the wording is reviewed in one place and cannot drift between
 * the six visualisations.
 */
export const METHODOLOGY = {
  withinSetNormalisation:
    "Every affinity is normalised within the result set it came from, because the data source normalises per query and depresses scores as filters are added. Scores from different calls are never compared directly. An interest you confirmed yourself is the one exception: it carries full weight and was never ranked against anything, so it is labelled as confirmed rather than described as a score.",
  m3Tags:
    "Taste tags are derived by us: for each tag, we sum the within-set normalised affinity of every result carrying it, then divide by the total across all tags. A tag must appear on at least two results to be shown.",
  emergingSignals:
    "An emerging signal is a result with high normalised affinity but low catalogue popularity — aligned with your taste, not yet widely recognised. Both numbers come from the same response; nothing is inferred.",
  unexpectedAffinities:
    "An unexpected affinity was not selected by you, carries meaningful relevance, belongs to a real cultural category, and is sufficiently distant from your declared categories. It is ranked by a fixed rule, not picked as 'the top few results'.",
  brandFit:
    "Brand fit is a weighted combination of up to five dimensions at 45/20/15/10/10. A dimension with no data is excluded and the remaining weights are renormalised — it is never given a default value.",
  opportunityGap:
    "Opportunity gap is cultural affinity multiplied by the uncovered share of that category. Coverage comes from what you declared; it is never measured from your content.",
  fingerprint:
    "This glyph is generated from your own profile values. Two creators with different data cannot receive the same shape.",
} as const;

export type MethodologyKey = keyof typeof METHODOLOGY;
