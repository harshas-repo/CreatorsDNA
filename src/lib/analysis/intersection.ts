/**
 * The cultural intersection — Creator Taste DNA x Brand Taste DNA.
 *
 * This is the central analytical operation of the product, and the reason a brand
 * is allowed to appear as a recommendation at all. Qloo returning a brand during
 * discovery is a FACT ABOUT THE QUERY. It is not a CreatorsDNA recommendation, and
 * nothing here treats it as one: the ranking runs after this module, never before.
 *
 *   CreatorsDNA = Creator Taste x Brand Taste -> Cultural Intersection -> Opportunity
 *
 * HOW THE COMPARISON IS MADE
 * --------------------------
 * Two passes, in descending order of how much they prove:
 *
 *  1. **Descriptor identity.** The creator's derived taste tags and the brand's own
 *     tags are the same Qloo representation, so an id match is a like-for-like
 *     comparison rather than two strings that happen to look alike. This pass is
 *     `sharedTasteOverlap()` — the one primitive also used by the
 *     content-compatibility fit dimension, so the number that ranks a brand and
 *     the number that explains it cannot disagree. It is the only pass allowed to
 *     move `strength`.
 *
 *  2. **Classification.** A brand that carried no comparable tags of its own is
 *     still matched against the creator's taste at industry level, by normalised
 *     name. Coarse, and labelled as coarse in `brandEvidence`, but it is Qloo's own
 *     classification on both sides rather than our guess. It adds shared dimensions
 *     without inflating `strength`, which stays the strict descriptor-level share.
 *
 * THE TWO PASSES ARE NOT SYMMETRICAL, AND THAT IS THE POINT
 * ---------------------------------------------------------
 * Pass 2 can only ADD positive evidence. It can never establish that two profiles
 * do NOT overlap, because a non-match between two different vocabularies proves
 * nothing: the creator says "Punk" and the brand is classified "Apparel", and the
 * absence of a string match between those two words is not a finding about either.
 * So when pass 1 could not compare the descriptor namespaces at all, the state stays
 * `incomparable` even if pass 2 also found nothing — it does not get promoted to
 * `no_overlap`, which would turn a taxonomy gap into a claim about the brand.
 *
 * WHAT IS DELIBERATELY NOT DONE
 * -----------------------------
 * No fuzzy or semantic matching. "Skateboarding" and "Skate culture" would need a
 * model to equate, and this project introduces no LLM. An unmatched near-synonym
 * is reported in `missing` — visible, and checkable — instead of being silently
 * promoted into a match.
 *
 * No hand-authored bridge between tag namespaces. Live capture found the creator
 * side sitting in `urn:tag:genre:media` / `urn:tag:genre:music` /
 * `urn:tag:interests:qloo` and the brand side in `urn:tag:genre:brand` /
 * `urn:tag:interest_adjacency:qloo`, with an empty intersection across 39 and 48
 * namespaces respectively. The bundled provider documentation records no
 * relationship between them — `filter.parents.types` is documented as
 * audience-only, and `feature.semantic_search` is beta and unverified. Writing our
 * own mapping table would invent exactly the provider relationship §5.1 forbids, in
 * the direction that increases the match count. So the honest branch is taken: the
 * state reports that these dimensions cannot be compared with the available
 * taxonomy, and says so in words a creator can read.
 *
 * No score for a brand with no evidence. `strength` is `undefined`, never 0. A
 * sparse brand stays a candidate and stays on the list, because hiding a real brand
 * behind our own data gap would be its own kind of dishonesty; what it does not get
 * is a confident claim.
 *
 * No use of the brand's explainability contributions. Those name the creator signals
 * the brand was returned because of, so intersecting them with creator taste would
 * match every discovered brand by construction. That link is real and lives in
 * `drivers` and the `BrandPathway`, with its provenance stated.
 */

import type { ScoredTasteTag } from "@/lib/contracts/domain";
import type {
  BrandTasteDNA,
  BrandTasteDescriptor,
  IntersectionKind,
  OverlapState,
  SharedTasteDimension,
  SharedTasteMatchBasis,
  TasteIntersection,
} from "@/lib/contracts/viewModels";
import { OVERLAP_STATE_RANK } from "@/lib/contracts/viewModels";
import { conceptOf } from "@/lib/providers/qloo/tagCuration";
import { sharedTasteOverlap, type SharedTasteOverlap } from "@/lib/scoring/dimensions";
import { normaliseCategory, round } from "@/lib/utils/deterministic";

import { brandComparableTags } from "./brandTaste";
import { dominantProvenance } from "./buildersTaste";

/**
 * Cap on shared dimensions surfaced per brand.
 *
 * Not a display limit — an analytical one. A brand that shares thirty descriptors
 * with a creator is not thirty times more interesting than one that shares three,
 * and listing all of them buries the two or three that actually explain the
 * connection. Six is enough to name the overlap and short enough that every entry
 * gets read.
 */
export const MAX_SHARED_DIMENSIONS = 6;

/**
 * At or above this share of creator taste weight, the overlap is called strong.
 *
 * Exported for the same reason `NOMINAL_WEIGHTS` is: `/methodology` publishes these
 * thresholds to the reader, and a page that transcribed them as literals would go
 * quietly wrong the day one moved. The methodology page computes its copy from these
 * constants, so the disclosure cannot drift from the arithmetic it discloses.
 */
export const STRONG_OVERLAP = 0.35;
/** At or above this share, the overlap is called clear rather than incidental. */
export const CLEAR_OVERLAP = 0.12;
/** This many shared dimensions counts as breadth when the share alone is low. */
export const BROAD_OVERLAP_COUNT = 3;
/** How many of the creator's unmatched tastes are named as missing evidence. */
const MAX_NAMED_GAPS = 3;
/** How many creator-side entities a shared dimension keeps in its evidence trail. */
const MAX_TRACED_ENTITIES = 5;

const METHODOLOGY =
  "Compared deterministically, not semantically. Your derived taste descriptors and this brand's own " +
  "descriptors are the same catalogue representation, so a match is an identity between two catalogue " +
  "entries rather than two words that look alike. Comparability is decided by tag namespace first: two " +
  "descriptors from namespaces with no documented relationship between them cannot be matched exactly, " +
  "and matching them because their labels read alike would be a relationship we invented. Where no exact " +
  "descriptor match was possible, the brand's recorded classification was matched against your taste at " +
  "industry level and labelled as the coarser comparison it is — that adds shared dimensions but never a " +
  "numeric strength. Four outcomes are kept distinct: overlap verified, comparable descriptors examined " +
  "with no overlap found, too little evidence on one side to compare, and evidence present but not " +
  "comparable with the available taxonomy. The overlap figure is the share of your total taste weight " +
  "that this brand also carries: a position within this run, not a percentage of any audience, and not " +
  "comparable to another creator or another analysis. Nothing was inferred from the brand's name, and no " +
  "brand-side audience data exists in this product.";

/**
 * The creator-side evidence gap, stated once.
 *
 * Both `stateReason` and `missing` carry it, because they reach the reader by
 * different routes — `stateReason` through the shared-taste block, `missing`
 * through the generated brand copy — and neither route is guaranteed to be
 * rendered. One constant is what stops the two from drifting apart, and it is what
 * lets `SharedTaste` drop the duplicate when it happens to render both.
 */
const CREATOR_SIDE_GAP =
  "No taste descriptors could be derived for this profile, so there was nothing on the creator side to compare. That is a gap in the creator-side evidence, not a finding about the brand.";

export interface IntersectTasteInput {
  brandId: string;
  /** The brand's cultural profile, from `buildBrandTasteDna`. */
  brand: BrandTasteDNA;
  /**
   * The creator's derived taste tags BEFORE the `maxCoreTastes` cut, so a brand is
   * not penalised for sharing a taste that happened to fall outside the top twelve
   * shown on screen.
   */
  creatorTags: readonly ScoredTasteTag[];
  /**
   * Entity ids the creator confirmed. Decides direct vs adjacent: a shared
   * dimension is `direct` when one of the entities that produced it is something
   * the creator chose, and `adjacent` when it reached their profile only through
   * the catalogue's expansion of what they chose.
   */
  declaredIds: readonly string[];
}

/**
 * Compute the intersection between one creator profile and one brand.
 *
 * Pure and deterministic: the same two profiles always produce the same shared
 * dimensions in the same order, which is what makes the explanation checkable
 * rather than merely plausible.
 */
export function intersectTaste(input: IntersectTasteInput): TasteIntersection {
  const { brandId, brand, creatorTags, declaredIds } = input;
  const declared = new Set(declaredIds);

  const descriptorById = new Map<string, BrandTasteDescriptor>();
  const classificationByLabel = new Map<string, BrandTasteDescriptor>();
  for (const descriptor of brand.descriptors) {
    descriptorById.set(descriptor.id, descriptor);
    if (descriptor.kind !== "tag") {
      const key = normaliseCategory(descriptor.label);
      if (key.length > 0 && !classificationByLabel.has(key)) {
        classificationByLabel.set(key, descriptor);
      }
    }
  }

  if (creatorTags.length === 0) {
    return {
      brandId,
      shared: [],
      kind: "none",
      state: "insufficient_evidence",
      stateReason: CREATOR_SIDE_GAP,
      strength: undefined,
      strengthLabel: "Could not establish shared taste",
      evidenceLimited: true,
      classificationMatches: 0,
      missing: [CREATOR_SIDE_GAP],
      provenance: brand.provenance,
      methodology: METHODOLOGY,
    };
  }

  // Pass 1 — descriptor identity. This is also the only pass that moves `strength`.
  // Namespaces travel with the ids, which is what lets the pass report "these two
  // profiles are not comparable" instead of reporting a zero that reads as a
  // measured absence of shared taste.
  const brandTags = brandComparableTags(brand);
  const overlap = sharedTasteOverlap(creatorTags, brandTags);
  const shared: SharedTasteDimension[] = [];
  const claimed = new Set<string>();

  for (const tag of overlap.matched) {
    const descriptor = descriptorById.get(tag.tag.id);
    if (descriptor === undefined) continue;
    shared.push(sharedDimension(tag, descriptor, overlap.totalWeight, declared, "descriptor"));
    claimed.add(normaliseCategory(tag.tag.name));
  }

  // Pass 2 — the brand's classification, matched against creator taste by name.
  // Only reached for a brand that carried no comparable descriptor for that taste,
  // so it can never double-count a pass-1 match.
  for (const tag of creatorTags) {
    const key = normaliseCategory(tag.tag.name);
    if (key.length === 0 || claimed.has(key)) continue;
    const descriptor = classificationByLabel.get(key);
    if (descriptor === undefined) continue;
    claimed.add(key);
    shared.push(sharedDimension(tag, descriptor, overlap.totalWeight, declared, "classification"));
  }

  shared.sort((a, b) => b.creatorWeight - a.creatorWeight || a.label.localeCompare(b.label));
  const kept = shared.slice(0, MAX_SHARED_DIMENSIONS);

  // Counted over `kept` rather than over every candidate, so the number agrees with
  // the dimensions actually rendered beside it.
  const classificationMatches = kept.filter(
    (dimension) => dimension.matchBasis === "classification",
  ).length;
  const descriptorMatches = overlap.matched.length;

  const { state, reason: stateReason } = resolveState(overlap, classificationMatches);

  // A strength is claimed only for an exact descriptor identity. A classification
  // match is real evidence and is listed as a shared dimension, but it is too coarse
  // to carry a number: "Apparel" and "Fashion" meeting is not a measured share of
  // anyone's taste. `undefined` here makes taste fit unavailable rather than zero,
  // which is the honest outcome.
  const strength =
    descriptorMatches > 0 && overlap.share !== undefined ? round(overlap.share) : undefined;

  const kind: IntersectionKind =
    kept.length === 0 ? "none" : kept.some((dimension) => dimension.kind === "direct") ? "direct" : "adjacent";

  return {
    brandId,
    shared: kept,
    kind,
    state,
    stateReason,
    strength,
    strengthLabel: strengthLabelFor(brand, kept, strength, state),
    evidenceLimited: brand.evidenceLimited,
    classificationMatches,
    missing: missingEvidence(brand, creatorTags, claimed, brandTags.length > 0),
    provenance: dominantProvenance([
      ...kept.map((dimension) => dimension.provenance),
      brand.provenance,
    ]),
    methodology: METHODOLOGY,
  };
}

/**
 * Combine the two passes into one state.
 *
 * Pass 2 is positive-evidence-only. It can lift `incomparable`, `no_overlap` and
 * even a descriptor-side `insufficient_evidence` up to `verified_overlap`, because
 * a matched classification is a real thing the catalogue stated about the brand and
 * a real thing in the creator's profile. It can never push anything DOWN, and it can
 * never manufacture a `no_overlap`: when both passes find nothing and pass 1 could
 * not compare the namespaces, the answer stays "could not compare", not "compared
 * and found nothing".
 */
function resolveState(
  overlap: SharedTasteOverlap,
  classificationMatches: number,
): { state: OverlapState; reason: string } {
  if (overlap.state === "verified_overlap") {
    return { state: "verified_overlap", reason: overlap.stateReason };
  }

  if (classificationMatches === 0) {
    return { state: overlap.state, reason: overlap.stateReason };
  }

  const count = `${classificationMatches} of your taste${
    classificationMatches === 1 ? " descriptor" : " descriptors"
  }`;
  const reason =
    overlap.state === "no_overlap"
      ? `Comparable descriptors were examined and none matched, but this brand's recorded classification matched ${count} by normalised name. The overlap is verified at classification level, which is a coarser comparison than a descriptor identity, so no numeric overlap strength is claimed.`
      : `Shared ground was established at classification level only: this brand's recorded classification matched ${count} by normalised name. Its own tag descriptors could not be compared against yours, because the two profiles sit in tag namespaces with no documented relationship between them — an exact identifier match across them cannot occur, and treating two labels as the same idea because they read alike would be a relationship we invented rather than one the catalogue stated. No numeric overlap strength is claimed for a classification match.`;

  return { state: "verified_overlap", reason };
}

/**
 * One shared cultural dimension, with the evidence for BOTH sides attached.
 *
 * A shared descriptor on its own is just a string appearing twice. What makes it
 * an explanation is the pair of sentences saying where each side of it came from,
 * which is what lets a creator check the claim instead of taking it on trust.
 */
function sharedDimension(
  tag: ScoredTasteTag,
  descriptor: BrandTasteDescriptor,
  totalWeight: number,
  declared: ReadonlySet<string>,
  matchBasis: SharedTasteMatchBasis,
): SharedTasteDimension {
  const tracedTo = [...new Set(tag.contributedBy.map((entry) => entry.entityId))].slice(0, MAX_TRACED_ENTITIES);
  const direct = tracedTo.some((id) => declared.has(id));
  return {
    id: tag.tag.id,
    label: tag.tag.name,
    kind: direct ? "direct" : "adjacent",
    creatorWeight: round(totalWeight > 0 ? tag.score / totalWeight : 0),
    brandWeight: descriptor.weight,
    creatorEvidence: creatorEvidenceFor(tag, direct),
    brandEvidence:
      descriptor.kind === "tag"
        ? "Carried as one of this brand's own descriptors in the returned catalogue data."
        : `Read from this brand's recorded ${descriptor.kind} (“${descriptor.label}”), which is a coarser comparison than a shared descriptor and is weighted as one.`,
    basis: "creatorsdna_matching",
    tracedTo,
    matchBasis,
    provenance: tag.provenance === "qloo" || descriptor.provenance === "qloo" ? "qloo" : descriptor.provenance,
  };
}

/** Where the creator side of a shared dimension came from, in words. */
function creatorEvidenceFor(tag: ScoredTasteTag, direct: boolean): string {
  const names = tag.contributedBy
    .slice(0, 2)
    .map((entry) => entry.entityName.trim())
    .filter((name) => name.length > 0);
  const support = tag.support;
  const supportNote =
    support > 1 ? `, one of ${support} results in this run carrying it` : "";

  if (direct && names.length > 0) {
    return `Traced to ${names.join(" and ")}${supportNote} — ${
      names.length === 1 ? "an entity you confirmed" : "entities you confirmed"
    }.`;
  }
  return support > 0
    ? `Derived from ${support} ${support === 1 ? "result" : "results"} the catalogue returned around your interests${
        names.length > 0 ? `, including ${names.join(" and ")}` : ""
      }. Not something you confirmed directly.`
    : "Derived from the catalogue's expansion of your interests, not from anything you confirmed directly.";
}

/**
 * The qualitative reading of the overlap.
 *
 * STATE FIRST, ARITHMETIC SECOND. The old version looked at `shared.length` and
 * then at `strength`, which produced "Some shared taste" for an overlap of 0.0004 —
 * a positive label for a number that meant nothing — and "No shared taste found" for
 * a brand whose descriptors could not be compared at all, which is an admission
 * dressed as a finding. §5.2 requires those to be different sentences, and §5.4
 * requires that zero overlap never earn a positive label at all.
 *
 * The thresholds below are the documented ones and are reused rather than
 * reinvented; what changed is the evidence each label is allowed to rest on.
 */
function strengthLabelFor(
  brand: BrandTasteDNA,
  shared: readonly SharedTasteDimension[],
  strength: number | undefined,
  state: OverlapState,
): string {
  if (state !== "verified_overlap") {
    // "No shared taste found" means comparable descriptors were examined and none
    // matched. "Could not establish shared taste" means they could not be examined.
    // Swapping them would either claim a finding we do not have or hide one we do.
    return state === "no_overlap" ? "No shared taste found" : "Could not establish shared taste";
  }

  // A brand with no comparable descriptor of its own can only have matched at
  // classification level, so whatever the arithmetic says it is not called strong.
  if (brand.evidenceLimited) return "Limited evidence, but some shared ground";

  const concepts = distinctConcepts(shared);

  // "Strong" additionally requires breadth. A high share resting on one concept —
  // five hierarchical ids for *fashion* — is intensity without spread, and calling
  // it strong would be the exaggeration §5.4 names.
  if (strength !== undefined && strength >= STRONG_OVERLAP && concepts >= 2) {
    return "Strong shared taste";
  }
  if (strength !== undefined && strength >= CLEAR_OVERLAP) return "Clear shared taste";
  if (concepts >= BROAD_OVERLAP_COUNT) return "Broad shared taste";
  if (concepts <= 1) return "One shared descriptor";
  return `${concepts} shared descriptors`;
}

/**
 * How many distinct cultural CONCEPTS a set of shared dimensions represents.
 *
 * Not a count of ids. Qloo's ids are hierarchical, and one brand was observed live
 * carrying `urn:tag:genre:brand:fashion`, `…:fashion:footwear`,
 * `…:fashion:footwear:other`, `…:fashion:formalwear` and `…:fashion:casual` — five
 * ids, one idea. Counting ids let a single concept buy a breadth claim it had not
 * earned. `conceptOf` collapses them structurally, from the id's own hierarchy, with
 * no word list and no knowledge of what any segment means.
 */
export function distinctConcepts(shared: readonly SharedTasteDimension[]): number {
  return new Set(shared.map((dimension) => conceptOf(dimension.id))).size;
}

/**
 * What could NOT be compared, stated rather than scored as zero.
 *
 * Every entry is a fact about the evidence, never a fact about the brand. "Your
 * strongest tastes found no counterpart in what the catalogue returned" is true and
 * checkable; "this brand has nothing to do with streetwear" would be a claim built
 * out of a data gap.
 */
function missingEvidence(
  brand: BrandTasteDNA,
  creatorTags: readonly ScoredTasteTag[],
  claimed: ReadonlySet<string>,
  brandHasTags: boolean,
): string[] {
  const missing: string[] = [];

  if (brand.descriptors.length === 0) {
    missing.push(
      "The catalogue returned no descriptors at all for this brand, so nothing about its cultural world could be compared. What is known about it here is its name and its classification, and no more.",
    );
  } else if (!brandHasTags) {
    missing.push(
      "This brand carried no cultural descriptors of its own, only its recorded classification, so any overlap below compares an industry against your taste rather than one descriptor against another.",
    );
  }

  const unmatched = creatorTags
    .filter((tag) => !claimed.has(normaliseCategory(tag.tag.name)))
    .slice(0, MAX_NAMED_GAPS)
    .map((tag) => tag.tag.name.trim())
    .filter((name) => name.length > 0);

  if (unmatched.length > 0) {
    missing.push(
      `Your strongest cultural ground — ${joinList(unmatched)} — found no counterpart in what the catalogue returned for this brand. That is a gap in the data held about the brand, not a finding that the brand has nothing to do with it.`,
    );
  }

  return missing;
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

/**
 * One ordering value for an intersection, so the ranking can be intersection-led
 * without every comparator restating the same tie-breaks.
 *
 * THIS IS THE SECOND KEY, NOT THE FIRST. `compareIntersections` orders by overlap
 * STATE before it orders by this value, because the value is 0 for a brand we
 * compared and found nothing in AND for a brand we could not compare at all — and
 * treating those as equal is what let the observed run fall through to the fit score
 * and promote a brand on its discovery rank alone (§7.1).
 *
 * WHAT EACH TERM MEANS
 * --------------------
 * `strength` carries most of it: the share of the creator's taste the brand also
 * holds, which is the defensible core of §13's "strength of those dimensions".
 * Breadth is capped and lightly weighted, because six shared descriptors are not
 * twice as good as three — and it counts distinct CONCEPTS rather than ids, so a
 * brand carrying five hierarchical spellings of one idea does not buy five times the
 * breadth. Directness is a small bonus: a brand sitting on ground the creator
 * confirmed is the safer collaboration, while an adjacent-only overlap is the more
 * interesting discovery and is deliberately NOT penalised into obscurity for being
 * it.
 *
 * The `evidenceLimited` multiplier is the important one. It halves the ranking
 * value of a brand whose cultural profile is thin, which is how §7's "should not
 * receive a highly confident intersection claim" is enforced arithmetically rather
 * than only in the wording. It halves rather than zeroes: a sparse brand is pushed
 * down the list, never removed from it, because removing it would hide a real
 * brand behind a gap in our data.
 *
 * Returns -1 when there is no intersection at all, which orders such a brand below
 * every brand that has one while still leaving it on the list.
 */
export function intersectionRankValue(intersection: TasteIntersection | undefined): number {
  if (intersection === undefined) return -1;

  const directness = intersection.kind === "direct" ? 1 : 0;
  const strength = intersection.strength ?? 0;
  const concepts = Math.min(distinctConcepts(intersection.shared), MAX_SHARED_DIMENSIONS);
  const breadth = concepts / MAX_SHARED_DIMENSIONS;
  const confidence = intersection.evidenceLimited ? 0.5 : 1;

  return round((directness * 0.2 + strength * 0.6 + breadth * 0.2) * confidence);
}

/**
 * Evidence quality of an intersection, for use as the PRIMARY ordering key.
 *
 * `verified_overlap` above `no_overlap` above `incomparable` above
 * `insufficient_evidence`, per `OVERLAP_STATE_RANK`. A brand with no intersection at
 * all sorts below even the weakest state, because it is a brand this analysis never
 * managed to examine.
 */
function stateRankOf(intersection: TasteIntersection | undefined): number {
  return intersection === undefined ? -1 : OVERLAP_STATE_RANK[intersection.state];
}

/**
 * Descending by intersection, for use as the primary sort key in brand ranking.
 *
 * State leads so that "we verified an overlap" always outranks "we verified there
 * was none", which always outranks "we could not verify anything". Only among brands
 * of equal evidence quality does the finer-grained value decide.
 */
export function compareIntersections(
  a: TasteIntersection | undefined,
  b: TasteIntersection | undefined,
): number {
  const byState = stateRankOf(b) - stateRankOf(a);
  if (byState !== 0) return byState;
  return intersectionRankValue(b) - intersectionRankValue(a);
}

/** "a, b and c" — small enough not to warrant a shared helper. */
function joinList(values: readonly string[]): string {
  if (values.length === 0) return "";
  if (values.length === 1) return values[0]!;
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")} and ${values[values.length - 1]}`;
}
