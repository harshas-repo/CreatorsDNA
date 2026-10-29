/**
 * Brand Taste DNA — the brand-side half of the product's central comparison.
 *
 * CreatorsDNA = Creator Taste x Brand Taste -> Cultural Intersection ->
 * Opportunity. `tasteDna.ts` builds the creator side; this module builds the
 * brand side so the two can be compared by `intersection.ts` on the same
 * representation rather than on two unrelated vocabularies.
 *
 * WHAT IT IS
 * ----------
 * "The cultural interests and affinities associated with this brand in the
 * available Qloo data." Nothing more. It is NOT the brand's customer audience —
 * there is no brand-side analytics connection in this product, so a descriptor
 * here is never a demographic and never a claim about who buys from them.
 *
 * WHERE THE EVIDENCE COMES FROM
 * -----------------------------
 * Only from the brand entity that discovery already returned: its own tags, its
 * `properties.industries`, and its `subtype` when that is more specific than its
 * `type`. No second call is made per brand. A per-brand enrichment call would
 * multiply latency by the candidate count, spend live quota on brands that are
 * about to be ranked out, and — for most live results — still come back sparse.
 *
 * SPARSE IS A NORMAL OUTCOME, NOT AN ERROR
 * ----------------------------------------
 * Plenty of live brand results carry little more than a name. That is recorded as
 * `density: "sparse"` and `evidenceLimited: true`. What is NOT done is filling the
 * gap by reading the brand's name for keywords: "Nike" implying sportswear is our
 * inference dressed up as catalogue data, and it would then be intersected with
 * the creator's taste and presented as a cultural match. A sparse brand stays a
 * candidate — dropping it would hide a real brand behind our own data gap — but it
 * does not get a confident intersection claim.
 *
 * WHY EXPLAINABILITY IS NOT A DESCRIPTOR
 * --------------------------------------
 * A brand's explainability contributions name the creator signals it was returned
 * because of. Feeding those back in as "brand taste" and then intersecting them
 * with creator taste would match every discovered brand by construction and
 * measure nothing at all. That link is real and is carried elsewhere — by
 * `drivers` and by the `BrandPathway` — with its provenance stated.
 */

import type { CulturalEntity } from "@/lib/contracts/domain";
import type {
  BrandTasteDNA,
  BrandTasteDensity,
  BrandTasteDescriptor,
  BrandTasteDescriptorKind,
} from "@/lib/contracts/viewModels";
import type { ComparableBrandTag } from "@/lib/scoring/dimensions";
import { isSurfaceableTag, namespaceOf } from "@/lib/providers/qloo/tagCuration";
import { normaliseCategory, round } from "@/lib/utils/deterministic";

import { categoryLabel } from "./categoryLabels";

/**
 * How much a descriptor of each kind is worth, BEFORE within-brand normalisation.
 *
 * A tag outranks an industry because it is the same representation the creator's
 * taste tags use, so a tag match is a like-for-like comparison. An industry is
 * Qloo's own classification of the company, which is real but coarse: "Automotive"
 * says far less about a brand's cultural world than a genre tag does. A subtype is
 * coarser still, and is only emitted when it is more specific than the type.
 *
 * Equal weight within a kind, by design. Qloo returns no per-tag score on a brand
 * entity, so any ordering inside a kind would be invented.
 */
const KIND_WEIGHT: Record<BrandTasteDescriptorKind, number> = {
  tag: 1,
  industry: 0.7,
  category: 0.4,
};

/**
 * Cap on descriptors kept per brand.
 *
 * A brand can arrive with dozens of tags, and every one past the handful that
 * actually intersect is noise in the UI and weight spread thin over the ones that
 * do. Twelve matches `maxCoreTastes` on the creator side, so neither profile gets
 * to look richer than the other by accident.
 */
export const MAX_BRAND_DESCRIPTORS = 12;

const BASIS =
  "Derived from the brand entity the catalogue returned during discovery: its own descriptors, " +
  "its recorded industries and its classification. Weights are relative to this brand alone and " +
  "are not comparable to another brand's. No brand-side audience data exists in this product, so " +
  "nothing here describes who buys from them, and nothing was inferred from the brand's name.";

/**
 * Build the Brand Taste DNA for one discovered brand entity.
 *
 * Deterministic and side-effect free: the same entity always produces the same
 * descriptors in the same order, which is what lets the intersection be explained
 * rather than merely asserted.
 */
export function buildBrandTasteDna(entity: CulturalEntity): BrandTasteDNA {
  const raw = collectDescriptors(entity);

  const rawTotal = raw.reduce((sum, descriptor) => sum + KIND_WEIGHT[descriptor.kind], 0);
  const weighted = raw
    .map((descriptor) => ({
      ...descriptor,
      weight: rawTotal > 0 ? KIND_WEIGHT[descriptor.kind] / rawTotal : 0,
    }))
    .sort((a, b) => b.weight - a.weight || a.label.localeCompare(b.label))
    .slice(0, MAX_BRAND_DESCRIPTORS);

  // Renormalise after the cut. Without this the surviving weights would sum to
  // less than 1 for a tag-heavy brand, and the intersection's brand-side weights
  // would silently understate how much of the brand they account for.
  const keptTotal = weighted.reduce((sum, descriptor) => sum + descriptor.weight, 0);
  const descriptors: BrandTasteDescriptor[] =
    keptTotal > 0
      ? weighted.map((descriptor) => ({
          ...descriptor,
          weight: round(descriptor.weight / keptTotal),
        }))
      : weighted;

  const hasTags = descriptors.some((descriptor) => descriptor.kind === "tag");
  const density: BrandTasteDensity =
    descriptors.length === 0
      ? "sparse"
      : hasTags && descriptors.length >= 3
        ? "rich"
        : "partial";

  return {
    brandId: entity.id,
    descriptors,
    density,
    // A brand with no comparable tag of its own can still be matched at
    // classification level, but that is a coarse claim and is labelled as one.
    evidenceLimited: !hasTags,
    basis: BASIS,
    provenance: descriptors.length === 0 ? "derived" : entity.provenance,
  };
}

/**
 * Every descriptor the entity actually carries, deduplicated, unweighted.
 *
 * Tags go through the same `isSurfaceableTag` curation the creator's taste tags
 * go through. That is not tidiness, it is correctness: if the creator side drops
 * promotional and internal namespaces and the brand side keeps them, the two would
 * "share" a descriptor the creator's own profile refused to show, and the
 * intersection would report a match that was an artefact of asymmetric filtering.
 */
function collectDescriptors(entity: CulturalEntity): BrandTasteDescriptor[] {
  const descriptors: BrandTasteDescriptor[] = [];
  const seen = new Set<string>();

  for (const tag of entity.tags) {
    if (!isSurfaceableTag(tag)) continue;
    const label = tag.name.trim();
    if (label.length === 0) continue;
    if (seen.has(tag.id)) continue;
    seen.add(tag.id);
    descriptors.push({
      id: tag.id,
      label,
      kind: "tag",
      // Recorded so the intersection can decide COMPARABILITY, not just identity.
      // Two ids from different namespaces cannot match exactly and must not be
      // matched by how their labels read, so without this field a brand whose tags
      // all sit in `urn:tag:genre:brand:*` looks like it shares nothing with a
      // creator profile built on `urn:tag:genre:music:*` — which is true — and
      // reports it as a measured zero, which is not.
      namespace: tag.namespace ?? namespaceOf(tag.id),
      weight: 0,
      provenance: tag.provenance,
    });
  }

  for (const industry of entity.industries ?? []) {
    const label = industry.trim();
    if (label.length === 0) continue;
    const id = `industry:${normaliseCategory(label)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    descriptors.push({ id, label, kind: "industry", weight: 0, provenance: entity.provenance });
  }

  const subtype = entity.subtype?.trim();
  // Only when it is more specific than the type. For a brand entity both are
  // normally `urn:entity:brand`, and a descriptor reading "Brands" on a brand
  // would be a tautology taking up one of the twelve slots.
  if (subtype !== undefined && subtype.length > 0 && subtype !== entity.type) {
    const id = `category:${normaliseCategory(subtype)}`;
    if (!seen.has(id)) {
      seen.add(id);
      descriptors.push({
        id,
        label: categoryLabel(subtype),
        kind: "category",
        weight: 0,
        provenance: entity.provenance,
      });
    }
  }

  return descriptors;
}

/**
 * The brand's own tag descriptors, in the form the shared-taste primitive takes.
 *
 * Namespace travels with the id because that is what makes a comparison honest: an
 * id set alone can only ever answer "did any string match", which reports a
 * taxonomy gap as a measured absence of shared taste.
 */
export function brandComparableTags(brand: BrandTasteDNA): ComparableBrandTag[] {
  const tags: ComparableBrandTag[] = [];
  for (const descriptor of brand.descriptors) {
    if (descriptor.kind !== "tag") continue;
    tags.push({ id: descriptor.id, namespace: descriptor.namespace ?? namespaceOf(descriptor.id) });
  }
  return tags;
}
