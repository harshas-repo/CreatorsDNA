import type { AudienceDemographics, CreatorLocation } from "@/lib/contracts/creator";
import type {
  BrandDiscoveryEvidence,
  CoverageBasis,
  OverlapState,
  ScoreDimension,
  TasteIntersection,
} from "@/lib/contracts/viewModels";
import type {
  CulturalEntity,
  CulturalTag,
  DemographicResultSet,
  EntityResultSet,
  Provenance,
} from "@/lib/contracts/domain";
import type { ScoredTasteTag } from "@/lib/contracts/domain";
import { isSurfaceableTag, namespaceOf } from "@/lib/providers/qloo/tagCuration";
import { clamp, round } from "@/lib/utils/deterministic";

/**
 * The five brand-fit dimensions (doc 01 §13, doc 02 §15).
 *
 * Doc 02 §16 is the governing rule here: *"If a dimension cannot be calculated
 * because data is missing: omit it, use a clearly defined neutral fallback, or
 * mark it unavailable. Do not fabricate."*
 *
 * Every calculator below returns `value: undefined` plus a REASON whenever it
 * cannot honestly compute. None of them substitutes 0.5. A neutral fallback
 * would silently claim knowledge we do not have, and — because the aggregator
 * renormalises weights over available components only — an omitted dimension is
 * already handled correctly without one.
 *
 * Provenance convention: a component's `provenance` is the provenance of the
 * DATA it was computed from, not of the arithmetic. So a live Qloo affinity
 * yields `qloo` even though the normalisation is ours; synthetic input yields
 * `synthetic`, which is what forces the illustrative banner. The arithmetic
 * itself is always disclosed in `basis`, which the UI renders next to the bar.
 */

export interface DimensionEvidence {
  /** 0..1, or `undefined` when the dimension could not be computed. */
  value: number | undefined;
  /** How the value was produced. Always rendered. */
  basis: string;
  provenance: Provenance;
  /** Required when `value` is undefined. Rendered in place of a bar. */
  unavailableReason: string;
}

export const DIMENSION_LABELS: Record<ScoreDimension, string> = {
  taste_fit: "Taste fit",
  audience_demographic: "Audience fit",
  content_compatibility: "Content compatibility",
  geographic: "Geographic fit",
  opportunity_gap: "Opportunity gap",
};

function unavailable(
  reason: string,
  basis: string,
  provenance: Provenance = "derived",
): DimensionEvidence {
  return { value: undefined, basis, provenance, unavailableReason: reason };
}

function available(
  value: number,
  basis: string,
  provenance: Provenance,
): DimensionEvidence {
  return {
    value: clamp(round(value, 4)),
    basis,
    provenance,
    unavailableReason: "",
  };
}

// ---------------------------------------------------------------------------
// 1. Taste fit — 45%
// ---------------------------------------------------------------------------

/**
 * Taste fit is the VERIFIED cultural intersection, and nothing else.
 *
 * WHAT IT USED TO BE, AND WHY THAT WAS WRONG
 * ------------------------------------------
 * This dimension read `entity.rank.value` from the discovery call: the brand's
 * position inside the candidate set Qloo happened to return, min-max normalised
 * across that set. A live run returned ten brands whose raw affinities spanned
 * 0.8211–0.8382 — a spread of 0.017 — and min-max stretched it across 0–1. The
 * leader became `taste_fit = 1.00` and the last `0.00`. With the other dimensions
 * unavailable, renormalisation handed that 1.00 a 0.75 effective weight and the
 * card announced "Clear alignment / 75" for a brand with no verified shared taste
 * at all. The number was arithmetically correct and meant something other than
 * what its label said.
 *
 * Set position answers "why did this brand appear in the candidate set?". That is
 * a real question with a real answer, and it is preserved — as
 * `BrandDiscoveryEvidence`, rendered separately, feeding nothing here. §4.2: a
 * discovery rank is not a substitute for an unavailable dimension.
 *
 * WHAT IT IS NOW
 * --------------
 * The intersection's `strength`: the share of the creator's taste weight the brand's
 * own descriptors also carry, established by exact descriptor identity. That is a
 * measurement of cultural compatibility, computed from evidence both sides
 * actually carry.
 *
 * A measured ZERO is scored as zero. `no_overlap` means both sides had comparable
 * descriptors and none matched, so zero is the finding, not the absence of one —
 * and marking it unavailable instead would be worse than misleading, because an
 * omitted dimension is renormalised away and a brand we compared and found nothing
 * in would then score ABOVE one we could not compare at all.
 *
 * Anything short of a verified comparison yields `undefined` with the state's own
 * reason attached, so a reader sees why rather than seeing a fabricated figure.
 */
export function tasteFitEvidence(
  intersection: TasteIntersection | undefined,
  discovery?: BrandDiscoveryEvidence,
): DimensionEvidence {
  const basis =
    "Share of your total taste weight that this brand's own catalogue descriptors also carry, established by exact descriptor identity. Not a position in a returned candidate set, and not comparable to another analysis.";

  // Naming the discovery fact beside the gap is what stops "unavailable" reading as
  // "we found nothing". The brand DID come back from the catalogue; what came back
  // with it was not evidence of cultural compatibility.
  const discoveryNote =
    discovery === undefined
      ? ""
      : ` This brand did appear in the catalogue's discovery results (rank ${discovery.rank} of ${discovery.setSize}), but discovery position says why it was returned, not how well it fits, so it is reported separately and is not used here.`;

  if (intersection === undefined) {
    return unavailable(
      `No cultural intersection was computed for this brand, so there is no verified evidence of shared taste to score.${discoveryNote}`,
      basis,
    );
  }

  const provenance = intersection.provenance;

  if (intersection.state === "verified_overlap") {
    if (intersection.strength !== undefined) {
      const classificationNote =
        intersection.classificationMatches > 0
          ? ` ${intersection.classificationMatches} further shared dimension${
              intersection.classificationMatches === 1 ? " was" : "s were"
            } matched only at classification level and is reported in the shared dimensions rather than in this figure, because an industry label is too coarse to carry a numeric score.`
          : "";
      return available(
        intersection.strength,
        `${basis} ${intersection.shared.length} shared dimension${intersection.shared.length === 1 ? "" : "s"}.${classificationNote}`,
        provenance,
      );
    }
    return unavailable(
      `Shared ground was verified, but only at classification level — this brand's recorded industry or category matched one of your tastes by name. That is genuine evidence and it is listed in the shared dimensions, but it is too coarse to carry a numeric fit score, so no figure is shown rather than one being invented.${discoveryNote}`,
      basis,
      provenance,
    );
  }

  if (intersection.state === "no_overlap") {
    return available(
      0,
      `${basis} ${intersection.stateReason} A zero here is the measurement, not a missing measurement.${discoveryNote}`,
      provenance,
    );
  }

  return unavailable(
    `${intersection.stateReason} No figure is shown, because a score would have to be manufactured to fill the gap.${discoveryNote}`,
    basis,
    provenance,
  );
}

/**
 * Why the catalogue returned this brand, as metadata rather than as a score.
 *
 * Every fact the old taste-fit dimension used is preserved here — the raw affinity
 * exactly as returned, the detected scale, whether that scale could be resolved,
 * the spread across the set, the normalised position, the method, and the call it
 * came from. §4.1: "do not discard the raw value after normalization".
 *
 * `scaleResolved` is the honesty flag. The provider does not document what its
 * affinity figures are measured on: `detectAffinityScale` can only tell a 0–100
 * encoding from a 0–1 one when at least one value exceeds 1, so a set whose values
 * all sit inside [0, 1] is detected as `"unit"` and marked ambiguous — it could be
 * a proportion, or a percentage whose scores all happen to be tiny. Both live sets
 * captured for this project landed there. When the scale is not resolved the raw
 * figure is shown as an uninterpreted number and never as a percentage, which is the
 * whole reason the flag exists rather than a guessed unit.
 *
 * `meaning` states the limitation in the same breath as the numbers, because a
 * caveat in a footnote is a caveat nobody reads.
 */
export function brandDiscoveryEvidence(
  scored: EntityResultSet | undefined,
  brandEntityId: string | undefined,
  endpoint: string,
): BrandDiscoveryEvidence | undefined {
  if (scored === undefined || brandEntityId === undefined || brandEntityId.length === 0) {
    return undefined;
  }
  const entity = scored.entities.find((candidate) => candidate.id === brandEntityId);
  if (entity === undefined) return undefined;

  const { rank } = entity;
  if (rank.method === "unavailable") return undefined;

  // Only the documented 0–100 encoding counts as resolved, and only when a value
  // actually exceeded 1 — which is what made the detection unambiguous in the first
  // place. Every other case is either inherently ambiguous or unusable.
  const scale = rank.scale ?? "absent";
  const scaleResolved = scale === "percent";
  const spread = rank.setSpread;
  const narrow = spread !== undefined && spread < 0.05;

  const method =
    rank.method === "minmax"
      ? "min-max normalised across the candidate set"
      : rank.method === "rank"
        ? "rank-derived, because every candidate in the set tied"
        : rank.method;

  const rawNote =
    rank.raw === undefined
      ? "The response carried no affinity figure for it, only its position."
      : scaleResolved
        ? `The catalogue reported a raw affinity of ${rank.raw} on the documented 0-100 scale.`
        : `The catalogue reported a raw affinity of ${rank.raw}, on a scale it does not document — every value in this set sat within 0 to 1, which could be a proportion or could be a percentage whose scores are all very low. It is shown uninterpreted rather than as a percentage.`;

  const meaning =
    `Why this brand appeared in the candidate set, not how well it fits. It was rank ${rank.rank + 1} of ${rank.setSize} returned by ${endpoint}, ${method}. ` +
    rawNote +
    (spread === undefined
      ? ""
      : ` The whole set spanned ${spread.toFixed(4)} of raw affinity${
          narrow
            ? ", which is close to a tie: position inside a set this narrow is a weak claim and is the reason it is not used as a fit score"
            : ""
        }.`) +
    " This figure is set-relative and is not comparable to another analysis or another call.";

  return {
    rank: rank.rank + 1,
    setSize: rank.setSize,
    rawAffinity: rank.raw,
    affinityScale: scale,
    scaleResolved,
    setSpread: spread,
    normalisedPosition: rank.value,
    method,
    endpoint,
    meaning,
    provenance: entity.provenance,
  };
}

// ---------------------------------------------------------------------------
// 2. Audience fit — 20%
// ---------------------------------------------------------------------------

/**
 * Audience fit compares the creator's DECLARED audience against the signed
 * demographic deltas Qloo returns for their signals.
 *
 * The deltas are signed deviations from average (doc 03 §6), not percentages of
 * people. The mapping below is therefore stated explicitly rather than hidden:
 * a delta of 0 (exactly average) sits at the midpoint 0.5, and the scale is
 * linear over the observed range. Nothing is described to the user as "N% of
 * people" — doc 03 §15 / fact F13 forbids that phrasing outright.
 */
export function audienceFitEvidence(
  demographics: DemographicResultSet | undefined,
  declared: AudienceDemographics | undefined,
): DimensionEvidence {
  const basis =
    "Signed demographic deltas returned for your signals, averaged over the buckets you declared, mapped so that 0 (average) sits at the midpoint.";

  const declaredAge = declared?.ageBuckets ?? [];
  const declaredGender = declared?.gender;
  if (declaredAge.length === 0 && declaredGender === undefined) {
    return unavailable(
      "You did not provide audience demographics. This input is optional, so the dimension was excluded rather than assumed.",
      basis,
    );
  }
  if (demographics === undefined || demographics.rows.length === 0) {
    return unavailable(
      "The data source returned no demographic deltas for these signals.",
      basis,
    );
  }

  const provenance: Provenance = demographics.meta.source.isIllustrative ? "synthetic" : "qloo";
  // Widened to plain strings: the declared buckets are typed against the Qloo
  // enum, but what the data source returns is whatever it returns, and a strict
  // comparison would silently drop a bucket renamed upstream.
  const declaredAgeSet = new Set<string>(declaredAge);
  const usedBuckets: string[] = [];
  let total = 0;
  let count = 0;

  for (const row of demographics.rows) {
    for (const delta of row.age) {
      if (declaredAgeSet.has(delta.bucket)) {
        total += delta.delta;
        count += 1;
        if (!usedBuckets.includes(delta.bucket)) usedBuckets.push(delta.bucket);
      }
    }
    if (declaredGender !== undefined) {
      for (const delta of row.gender) {
        if (delta.bucket.toLowerCase() === declaredGender.toLowerCase()) {
          total += delta.delta;
          count += 1;
        }
      }
    }
  }

  if (count === 0) {
    return unavailable(
      "None of the buckets you declared appeared in the returned demographic data, so there is nothing to compare against.",
      basis,
      provenance,
    );
  }

  const mean = total / count;
  return available(
    0.5 + mean,
    `${basis} Averaged over ${count} delta${count === 1 ? "" : "s"} across ${usedBuckets.length || 1} bucket(s). These are signed deviations from average, not shares of an audience.`,
    provenance,
  );
}

// ---------------------------------------------------------------------------
// 3. The shared-taste primitive, and content compatibility — 15%
// ---------------------------------------------------------------------------

/**
 * The overlap between the creator's taste tags and a brand's own descriptors.
 *
 * THIS IS THE PRIMITIVE THE WHOLE PRODUCT RESTS ON. The cultural intersection
 * (`analysis/intersection.ts`) and the content-compatibility dimension below are
 * two views of one computation, and they share it rather than each re-deriving
 * it, because two implementations of "what do these two profiles have in common"
 * is how a brand ends up ranked on one answer and explained by another.
 *
 * TWO MEASUREMENTS, NOT ONE
 * -------------------------
 * `share` is INTENSITY: how much of the creator's total taste weight the brand
 * also carries. Weighted rather than a plain count, so a brand sharing the
 * creator's strongest tag scores above one sharing only their weakest.
 *
 * `breadth` is SPREAD: how many of the creator's distinct descriptors the brand
 * touches, unweighted. A creator with one dominant taste and a brand matching it
 * has a high `share` and a low `breadth`; a creator with twenty even tastes and a
 * brand matching six has the reverse. Taste fit reads `share`, content
 * compatibility reads `breadth`, which is what makes them two dimensions rather
 * than one number wearing two labels.
 *
 * Neither is a percentage of any audience, and neither is comparable across runs.
 *
 * THE STATE IS THE PART THAT WAS MISSING
 * --------------------------------------
 * Both figures are 0 when nothing matched, and 0 is three different situations:
 * the descriptors were compared and none matched; one side had nothing to compare;
 * both sides had descriptors but in tag namespaces with no supported relationship
 * between them. `state` separates them, and every consumer reads `state` before it
 * reads a number — a zero presented as a finding about the brand when it was really
 * a finding about our data is the exact error §5.2 exists to remove.
 */
export interface SharedTasteOverlap {
  /** Creator taste tags the brand also carries, in creator-weight order. */
  matched: ScoredTasteTag[];
  /** Sum of the matched tags' scores. */
  sharedWeight: number;
  /** Sum of every creator taste tag's score — the denominator of `share`. */
  totalWeight: number;
  /** `sharedWeight / totalWeight`, or `undefined` when either side is unusable. */
  share: number | undefined;
  /**
   * `matched.length / tasteTags.length`, or `undefined` when the creator side is
   * empty. Unweighted by design: this answers "how much of your taste does this
   * brand touch", not "how strongly".
   */
  breadth: number | undefined;
  /** The four-way evidence state. Read this before reading any number above. */
  state: OverlapState;
  /** Why the state is what it is, in plain language and about the evidence. */
  stateReason: string;
  /**
   * Tag namespaces present on BOTH sides. Empty means the two profiles were never
   * comparable, and is the evidence for an `incomparable` state rather than an
   * assertion about it.
   */
  comparableNamespaces: string[];
  /** Recorded so the diagnostic layer can show what each side actually held. */
  creatorNamespaces: string[];
  brandNamespaces: string[];
}

/**
 * A brand-side descriptor as the primitive sees it: an id, plus the namespace that
 * decides whether the id means the same kind of thing as a creator-side id.
 */
export interface ComparableBrandTag {
  id: string;
  namespace?: string;
}

function tagNamespace(tag: { id: string; namespace?: string }): string {
  return tag.namespace ?? namespaceOf(tag.id);
}

function distinctSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort();
}

/** Render at most three namespaces, because a diagnostic list is not a paragraph. */
function describeNamespaces(namespaces: readonly string[]): string {
  if (namespaces.length === 0) return "none";
  const shown = namespaces.slice(0, 3).join(", ");
  return namespaces.length > 3 ? `${shown} and ${namespaces.length - 3} more` : shown;
}

/**
 * Decide which of the four overlap states a comparison ended in.
 *
 * ORDER OF THE CHECKS IS THE LOGIC. Absence of data is tested before absence of
 * shared namespaces, which is tested before absence of matches — because "no
 * overlap" is the only state that makes a claim about the brand, and it may only be
 * reached once both sides demonstrably had comparable evidence. Reversing any pair
 * would let a data gap report itself as a finding.
 */
export function classifyOverlap(input: {
  creatorCount: number;
  brandCount: number;
  comparableNamespaces: readonly string[];
  matchedCount: number;
}): { state: OverlapState; reason: string } {
  if (input.creatorCount === 0) {
    return {
      state: "insufficient_evidence",
      reason:
        "No taste tags could be derived for this profile, so there was nothing on the creator side to compare. That is a gap in the creator-side evidence, not a finding about the brand.",
    };
  }
  if (input.brandCount === 0) {
    return {
      state: "insufficient_evidence",
      reason:
        "The catalogue returned no descriptors for this brand, so there was nothing on the brand side to compare. What is known about it here is its name and its classification, and no more.",
    };
  }
  if (input.comparableNamespaces.length === 0) {
    return {
      state: "incomparable",
      reason:
        "Both sides carried descriptors, but in different tag namespaces, so no comparison between them was possible in either direction. Namespaces are separate catalogues of ideas: an exact identifier match across them cannot occur, and treating two labels as the same idea because they read alike would be a relationship we invented rather than one the catalogue stated.",
    };
  }
  if (input.matchedCount > 0) {
    return {
      state: "verified_overlap",
      reason: `${input.matchedCount} descriptor${input.matchedCount === 1 ? "" : "s"} matched exactly between the two profiles, inside the tag namespace${
        input.comparableNamespaces.length === 1 ? "" : "s"
      } they share (${describeNamespaces(input.comparableNamespaces)}).`,
    };
  }
  return {
    state: "no_overlap",
    reason: `Both profiles were compared inside the tag namespace${
      input.comparableNamespaces.length === 1 ? "" : "s"
    } they share (${describeNamespaces(input.comparableNamespaces)}) and no descriptor matched. This is a measured absence rather than a missing-data case: each side had comparable descriptors, and none were the same.`,
  };
}

export function sharedTasteOverlap(
  tasteTags: readonly ScoredTasteTag[],
  brandTags: readonly ComparableBrandTag[],
): SharedTasteOverlap {
  const brandIds = new Set(brandTags.map((tag) => tag.id));
  const matched = tasteTags.filter((tag) => brandIds.has(tag.tag.id));
  const sharedWeight = matched.reduce((sum, tag) => sum + tag.score, 0);
  const totalWeight = tasteTags.reduce((sum, tag) => sum + tag.score, 0);

  const creatorNamespaces = distinctSorted(tasteTags.map((tag) => tagNamespace(tag.tag)));
  const brandNamespaces = distinctSorted(brandTags.map((tag) => tagNamespace(tag)));
  const creatorSet = new Set(creatorNamespaces);
  const comparableNamespaces = brandNamespaces.filter((namespace) => creatorSet.has(namespace));

  const { state, reason } = classifyOverlap({
    creatorCount: tasteTags.length,
    brandCount: brandTags.length,
    comparableNamespaces,
    matchedCount: matched.length,
  });

  return {
    matched,
    sharedWeight,
    totalWeight,
    share: totalWeight > 0 ? sharedWeight / totalWeight : undefined,
    breadth: tasteTags.length > 0 ? matched.length / tasteTags.length : undefined,
    state,
    stateReason: reason,
    comparableNamespaces,
    creatorNamespaces,
    brandNamespaces,
  };
}

/**
 * A brand's descriptors that are COMPARABLE with the creator's taste tags.
 *
 * Filtered by the same curation the creator side is filtered by. That symmetry is
 * correctness, not tidiness: if the creator's profile withholds a namespace and
 * the brand's side keeps it, the two can "share" a descriptor the creator was
 * never shown, and the intersection would report a match that is an artefact of
 * asymmetric filtering. It also stops a brand whose only tags are plot keywords
 * scoring a real 0 — an unavailable dimension is honest, a zero is a claim.
 *
 * Returns descriptors rather than bare ids because the namespace travels with the
 * id and decides comparability. The old `Set<string>` form could not express
 * "these two profiles cannot be compared", so it reported a zero instead.
 */
export function comparableBrandTags(brandEntity: CulturalEntity): ComparableBrandTag[] {
  const tags: ComparableBrandTag[] = [];
  const seen = new Set<string>();
  for (const tag of brandEntity.tags) {
    if (!isSurfaceableTag(tag)) continue;
    if (seen.has(tag.id)) continue;
    seen.add(tag.id);
    tags.push({ id: tag.id, namespace: tagNamespace(tag) });
  }
  return tags;
}

/**
 * Content compatibility is the BREADTH of measured cultural overlap: how many of
 * the creator's distinct taste descriptors this brand also carries.
 *
 * WHY BREADTH AND NOT SHARE
 * -------------------------
 * Taste fit already reports `share`, the weighted intensity of the same overlap.
 * Two dimensions reading one number under two names is not two dimensions, so this
 * one reads the other half of it — spread rather than intensity. Both are gated on
 * the same four-way state, so they can differ in value without ever differing about
 * whether a comparison was possible.
 *
 * WHEN IT RETURNS ZERO, AND WHEN IT DOES NOT
 * ------------------------------------------
 * Zero is returned only for a `no_overlap` state: both sides carried comparable
 * descriptors and none matched. That is a real finding and it is allowed to be
 * negative evidence. For `insufficient_evidence` and `incomparable` the dimension
 * is marked unavailable with the state's reason, because a zero there would claim a
 * demonstrated incompatibility that was never demonstrated. §5.3: "return zero only
 * when the evidence supports a real zero."
 *
 * WHAT THIS DOES NOT USE
 * ----------------------
 * Platform selection is not a scoring input, and neither is anything else the
 * creator typed about their own work. No platform-compatibility model is computed,
 * because nothing in the returned brand data identifies which platforms a brand
 * works with — a score built on that would be invented.
 *
 * The creator's declared purposes and platforms ARE shown, but in the copy layer,
 * as a sentence of their own beside this figure. They are deliberately not a
 * parameter here. `CreatorAnalysis` is cache-keyed on everything except the
 * audience answers (`analysisCacheKey`), so any field derived from them would make
 * two creators who share a cache entry receive each other's wording — and would
 * quietly turn an explanation input into a computed one, which is the exact
 * boundary the "audience context — explanation only, never evidence" suite guards.
 */
export function contentCompatibilityEvidence(
  brandEntity: CulturalEntity | undefined,
  tasteTags: readonly ScoredTasteTag[],
): DimensionEvidence {
  const basis =
    "Share of your distinct taste descriptors that this brand's own descriptors also carry — the spread of the overlap, where taste fit reports its intensity. " +
    "Both are computed from one comparison, so they cannot disagree about whether a comparison was possible. " +
    "Your platform selection is NOT used as an input here and no platform-compatibility score is computed, because nothing in the returned brand data says which platforms a brand works with.";

  const brandTags = brandEntity === undefined ? [] : comparableBrandTags(brandEntity);
  const overlap = sharedTasteOverlap(tasteTags, brandTags);
  const provenance = brandEntity?.provenance ?? "derived";

  if (overlap.state === "insufficient_evidence" || overlap.state === "incomparable") {
    return unavailable(`${overlap.stateReason} No figure is shown, because a zero here would claim an incompatibility that was never demonstrated.`, basis, provenance);
  }

  if (overlap.breadth === undefined) {
    return unavailable("Your derived taste tags could not be counted, so no breadth figure exists.", basis, provenance);
  }

  const sharedNames = overlap.matched.slice(0, 3).map((tag) => tag.tag.name);
  const reading =
    overlap.state === "no_overlap"
      ? `Compared inside the tag namespaces both sides carry (${describeNamespaces(overlap.comparableNamespaces)}) and nothing matched, so this is a measured zero rather than missing data.`
      : `${overlap.matched.length} of ${tasteTags.length} of your taste descriptors are also carried by this brand${
          sharedNames.length > 0 ? `, including ${sharedNames.join(", ")}` : ""
        }.`;

  return available(overlap.breadth, `${basis} ${reading}`, provenance);
}

// ---------------------------------------------------------------------------
// 4. Geographic fit — 10%
// ---------------------------------------------------------------------------

/**
 * Geographic fit is an exact country match, and nothing subtler.
 *
 * A partial-credit model (same continent, language proximity, market size) would
 * be invented: none of it is in the data and doc 02 §16 forbids fabricating a
 * dimension. A binary is coarse, so the coarseness is disclosed in `basis` and
 * the whole dimension is omitted when either side is missing.
 *
 * The creator side must be a COUNTRY. A free-text locality ("Berlin") is not
 * comparable to the region the catalogue returns for a brand, and
 * `signal.location.query` is deliberately NOT used to bridge the gap: doc 03 §10
 * lists no country signal parameter at all, and a `signal.location.query` that
 * matches no locality is a 400 that would take the whole insights call with it.
 * So the country is collected explicitly and used only for this comparison.
 */
export function geographicFitEvidence(
  brandEntity: CulturalEntity | undefined,
  brandRegion: string | undefined,
  location: CreatorLocation | undefined,
): DimensionEvidence {
  const basis =
    "Exact country match between your declared location and the region the data source returned for this brand.";

  const creatorCountry = location?.country?.trim();
  if (!location || (!creatorCountry && !location.query && !location.city)) {
    return unavailable(
      "You did not provide a location. This input is optional, so the dimension was excluded rather than assumed.",
      basis,
    );
  }
  if (!creatorCountry) {
    return unavailable(
      "Your location was not given as a country, and no partial-credit geographic model is applied because none could be justified from the available data.",
      basis,
    );
  }

  const region = brandRegion?.trim() || brandEntity?.geo?.city?.trim();
  if (!region) {
    return unavailable(
      "The data source returned no region for this brand.",
      basis,
      brandEntity?.provenance ?? "derived",
    );
  }

  const matches = normalisePlace(region) === normalisePlace(creatorCountry) ||
    normalisePlace(region).includes(normalisePlace(creatorCountry));
  return available(
    matches ? 1 : 0,
    `${basis} Compared "${creatorCountry}" against "${region}". Binary by design: the data supports a match test, not a distance or affinity model.`,
    brandEntity?.provenance ?? "qloo",
  );
}

function normalisePlace(value: string): string {
  return value.toLowerCase().replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// 5. Opportunity gap — 10%
// ---------------------------------------------------------------------------

/**
 * Opportunity gap rewards alignment the creator has NOT already covered.
 *
 * `gap = affinity × (1 − coverage)`. Coverage comes from the creator's own
 * declaration where one exists (doc 05 §10C requires the basis to be identified,
 * never implied), so a brand in a saturated niche scores below an equally aligned
 * brand in an untouched one. Neither is "bad" — doc 05 §12 — they are different
 * situations.
 *
 * WHICH AFFINITY, AND WHY IT IS NOT THE DISCOVERY ONE
 * ---------------------------------------------------
 * `affinity` here is the VERIFIED cultural affinity — the intersection's strength.
 * It used to be the brand's normalised position in the discovery candidate set, and
 * that was two errors in one: it fed a set-relative ordering into a dimension whose
 * label promises a cultural measurement (§4.2), and because it is a min-max value
 * some brand in every set always scored 1.00, so the top discovery result was
 * automatically awarded the maximum "untapped opportunity" whatever its actual
 * relevance. With no verified affinity the dimension is unavailable, which is
 * honest: there is no established relevance to multiply by an uncovered share.
 *
 * `inferred_zero` is the honest middle case: the creator declared SOME categories
 * and said nothing about this one, so it is treated as uncovered. The dimension is
 * still scored — omitting it would discard a reasonable default — but the basis
 * string says the zero is ours, not theirs. Previously every scored case was
 * labelled "self-reported by you", which attributed our assumption to the creator.
 */
export function opportunityGapEvidence(
  affinity: number | undefined,
  coverage: number | undefined,
  coverageBasis: CoverageBasis,
): DimensionEvidence {
  const basis =
    "Verified cultural affinity multiplied by the uncovered share of that category: affinity x (1 - coverage). The affinity is the verified intersection strength, not the brand's position in the discovery results.";

  if (affinity === undefined) {
    return unavailable(
      "No verified cultural affinity was established for this brand, so there is no relevance to weigh against your coverage. The discovery position it did hold is reported separately and is not used here, because a ranking inside one candidate set is not a cultural measurement.",
      basis,
    );
  }
  if (coverage === undefined || coverageBasis === "unavailable") {
    return unavailable(
      "Content coverage for the relevant category is unknown. Coverage is never inferred from nothing, so this dimension was omitted and the remaining weights renormalised.",
      basis,
    );
  }

  const coverageLabel =
    coverageBasis === "creator_declared"
      ? "self-reported by you"
      : coverageBasis === "inferred_zero"
        ? "assumed by CreatorsDNA to be zero, because you declared coverage for other categories but not this one"
        : "measured from your published content";
  return available(
    affinity * (1 - clamp(coverage)),
    `${basis} Coverage was ${coverageLabel} at ${Math.round(clamp(coverage) * 100)}%.`,
    "derived",
  );
}

// ---------------------------------------------------------------------------
// Helpers used by the pipeline
// ---------------------------------------------------------------------------

/** Distinct tag ids across a set of entities — the M3 input. */
export function tagIdSet(entities: readonly CulturalEntity[]): Set<string> {
  const ids = new Set<string>();
  for (const entity of entities) {
    for (const tag of entity.tags) ids.add(tag.id);
  }
  return ids;
}

/** Weighted Jaccard-style overlap between two tag collections. */
export function tagOverlap(
  a: readonly CulturalTag[],
  b: readonly CulturalTag[],
): number {
  if (a.length === 0 || b.length === 0) return 0;
  const bIds = new Set(b.map((tag) => tag.id));
  const shared = a.filter((tag) => bIds.has(tag.id)).length;
  return shared / new Set([...a.map((tag) => tag.id), ...b.map((tag) => tag.id)]).size;
}
