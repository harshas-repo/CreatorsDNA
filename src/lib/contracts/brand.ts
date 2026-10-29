import { z } from "zod";

import type { CulturalEntity, Provenance } from "./domain";

/**
 * Brand registry contract (doc 04 §5, doc 02 §21/§22).
 *
 * Split by who can honestly supply the field:
 *
 *   HAND-CURATED (checked into the repo, from verified official sources)
 *     - the partnership routes: creator programme URL, affiliate URL,
 *       ambassador URL, contact route
 *     - verification date and source
 *     - the Qloo entity id to score against
 *
 *   QLOO-SOURCED AT RUNTIME (never hand-written)
 *     - name, category, website, region, imagery, description
 *
 * Doc 03 §6 shows `properties.websites`, `external.instagram`,
 * `external.twitter`, `properties.image.url` and `properties.description` are
 * real Qloo data, so hand-curating them would be both redundant and a risk to
 * the "verifiable information only" rule.
 *
 * Invented contacts are forbidden. A brand with no verified partnership route
 * ships with `partnership: null` and the UI says so.
 */

export const partnershipRouteSchema = z.object({
  /** Official creator/partnership programme page. Must be a verified URL. */
  creatorPartnershipUrl: z.string().url().optional(),
  affiliateUrl: z.string().url().optional(),
  ambassadorUrl: z.string().url().optional(),
  /** How a creator actually gets in touch, e.g. "Brand partnership form". */
  contactRoute: z.string().optional(),
  /** ISO date the route was checked. Stale routes must be re-verified. */
  verificationDate: z.string().optional(),
  /** Where it was verified from, e.g. "brand's official website". */
  verificationSource: z.string().optional(),
});
export type PartnershipRoute = z.infer<typeof partnershipRouteSchema>;

/** Brand category, used for grouping and for the doc 03 §3 type mapping. */
export const BRAND_CATEGORIES = [
  "apparel",
  "footwear",
  "beauty",
  "food_beverage",
  "consumer_tech",
  "gaming",
  "automotive",
  "finance",
  "travel",
  "fitness",
  "media_entertainment",
  "home_lifestyle",
  "other",
] as const;
export type BrandCategory = (typeof BRAND_CATEGORIES)[number];

export const registryBrandSchema = z.object({
  /** Stable internal slug; the primary key of the registry. */
  slug: z.string().min(1),
  /**
   * Qloo entity id (GUID) or URN.
   *
   * OPTIONAL on purpose. Without an API key there is no way to obtain a real id,
   * and inventing a plausible-looking GUID would be exactly the fabricated data
   * doc 02 §21 forbids. Ids are resolved at runtime through `/search`
   * (doc 03 §8 step 1) and then cached.
   */
  qlooEntityId: z.string().optional(),
  resolution: z.enum(["unresolved", "resolved"]).default("unresolved"),
  displayName: z.string().min(1),
  category: z.enum(BRAND_CATEGORIES),
  /** Hand-curated only when a verified official route exists. */
  partnership: partnershipRouteSchema.nullable().default(null),
  /**
   * Verification state of this entry as a whole. `not_verified` is the honest
   * default: it means no human has checked the partnership route against an
   * official source yet, and the UI must say so rather than implying a route
   * exists.
   */
  verification: z
    .object({
      status: z.enum(["verified", "not_verified"]).default("not_verified"),
      verifiedAt: z.string().optional(),
      source: z.string().optional(),
      note: z.string().optional(),
    })
    .default({ status: "not_verified" }),
  /**
   * Curator notes are allowed; marketing claims are not. Anything here is
   * rendered as curator commentary with `provenance: "derived"`.
   */
  notes: z.string().optional(),
});
export type RegistryBrand = z.infer<typeof registryBrandSchema>;

export const brandRegistrySchema = z.object({
  version: z.string(),
  /** Provenance statement rendered next to the registry in the UI. */
  attribution: z.string(),
  brands: z.array(registryBrandSchema),
});
export type BrandRegistry = z.infer<typeof brandRegistrySchema>;

/** A registry brand enriched with whatever Qloo returned for it at runtime. */
export interface EnrichedBrand {
  registry: RegistryBrand;
  qloo: {
    name?: string;
    description?: string;
    website?: string;
    imageUrl?: string;
    region?: string;
    popularity?: number;
    socialHandles: Record<string, string[]>;
  };
  /** Which parts came from where, so the UI can label each field. */
  provenance: {
    partnership: Provenance;
    metadata: Provenance;
    score: Provenance;
  };
  /** True when Qloo had nothing for this id — metadata then stays empty rather
   *  than being backfilled with guesses. */
  qlooMissing: boolean;
  /**
   * True when this brand came from Qloo discovery and is NOT in the curated
   * registry: it then has no verified partnership route and its category is
   * derived from Qloo metadata rather than hand-curated. Registry-backed brands
   * leave this unset. Drives the "discovered" provenance label in the UI.
   */
  discovered?: boolean;
}

/**
 * Merge a registry entry with a Qloo entity result.
 *
 * The merge never lets one side overwrite the other's authority: partnership
 * routes always come from the registry, descriptive metadata always comes from
 * Qloo. When Qloo returns nothing, the fields are left `undefined` — doc 02 §21
 * forbids inventing them.
 */
export function mergeBrand(
  registry: RegistryBrand,
  qloo: Partial<EnrichedBrand["qloo"]> | undefined,
): EnrichedBrand {
  const missing = qloo === undefined || qloo.name === undefined;
  return {
    registry,
    qloo: {
      name: qloo?.name ?? registry.displayName,
      description: qloo?.description,
      website: qloo?.website,
      imageUrl: qloo?.imageUrl,
      region: qloo?.region,
      popularity: qloo?.popularity,
      socialHandles: qloo?.socialHandles ?? {},
    },
    provenance: {
      partnership: "derived",
      metadata: missing ? "derived" : "qloo",
      score: "derived",
    },
    qlooMissing: missing,
  };
}

/**
 * Canonical entity id for a registry brand.
 *
 * One function, used by the provider (to mint the synthetic entity), by the
 * scoring pipeline (to build the candidate id list) and by the opportunity
 * builder (to key the result). Before this existed the synthetic provider used
 * `syn:brand:<slug>` while opportunities used `registry:<slug>`, so a scored
 * brand could never be matched back to its registry entry and every brand fit
 * came out unresolvable. Ids must be minted in exactly one place.
 */
export function brandEntityId(brand: Pick<RegistryBrand, "qlooEntityId" | "slug">): string {
  return brand.qlooEntityId ?? `registry:${brand.slug}`;
}

// ---------------------------------------------------------------------------
// Brand eligibility
// ---------------------------------------------------------------------------

/** The entity type a brand recommendation must actually be. */
export const BRAND_ENTITY_TYPE = "urn:entity:brand";

/**
 * Whether a returned entity IS a brand, decided by its type and nothing else.
 *
 * THE SECOND OF TWO BOUNDARIES. The first is the request: discovery asks for
 * `filter.type=urn:entity:brand`, and the mapper independently excludes any
 * result whose resolved type is not the one asked for. This one is the
 * application's own check on the entities it is about to publish as brand
 * partners, and it exists because "we asked for brands" is a statement about
 * the request, not about the answer. A cached set, a synthetic fixture, a
 * future caller that reuses this pool, or a catalogue that changes underneath
 * us would all defeat the first boundary while leaving this one intact.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * --------------------------------
 * No name heuristic. Nothing here reads `name`, `industries`, `websites` or
 * `disambiguation`. "Global Desi" and "Pipa Bella" are brands because the
 * catalogue types them as brands; a venue called "Brand Coffee" is not a brand
 * because the catalogue does not type it as one, and a person called "Nike"
 * would not be either. Inferring brandhood from a brand-like name is exactly
 * the guess this predicate replaces: it would let a restaurant, a film title or
 * an individual designer into a list the creator is told contains companies
 * they can approach.
 *
 * ABSENCE IS NOT A MATCH. The bare marker `urn:entity` — which every live
 * `/v2/insights` result carries in its `type` field — is NOT accepted. It says
 * the entity is an entity, which is not evidence that it is a brand, and
 * treating an unresolved type as eligible would make the check vacuous on the
 * exact payload shape it was written for. `subtype` is checked too because
 * that, not `type`, is where the live host puts the concrete type; a result
 * carrying it in either field passes, and one carrying it in neither does not.
 *
 * A hierarchical refinement counts: `urn:entity:brand:x` is a brand the same way
 * `urn:tag:genre:media:x` is a genre tag. The converse does not — a parent type
 * is not evidence of its child.
 */
export function isBrandEntity(entity: Pick<CulturalEntity, "type" | "subtype">): boolean {
  return isBrandType(entity.type) || isBrandType(entity.subtype);
}

function isBrandType(value: string | undefined): boolean {
  if (value === undefined) return false;
  const trimmed = value.trim();
  return trimmed === BRAND_ENTITY_TYPE || trimmed.startsWith(`${BRAND_ENTITY_TYPE}:`);
}

/**
 * Whether a verified, actionable partnership route exists.
 *
 * Both conditions matter: a URL is only "verified" if a human actually checked
 * it against an official source. An unverified URL is treated as no route at all,
 * because rendering it would imply an endorsement nobody confirmed.
 */
export function hasVerifiedRoute(brand: EnrichedBrand): boolean {
  const p = brand.registry.partnership;
  if (!p) return false;
  if (brand.registry.verification.status !== "verified") return false;
  return Boolean(
    p.creatorPartnershipUrl || p.affiliateUrl || p.ambassadorUrl || p.contactRoute,
  );
}

// ---------------------------------------------------------------------------
// Official destination
// ---------------------------------------------------------------------------

/**
 * A link the creator can actually follow to the brand.
 *
 * `origin` is part of the value, not decoration: the two sources carry different
 * guarantees and the UI must say which one it is showing. A registry URL was
 * checked by a curator against an official source. A Qloo URL is what the
 * catalogue returned in `properties.websites` — real data from a named source,
 * but nobody here has opened it. Presenting both with the same word would make
 * the weaker claim look as strong as the stronger one.
 */
export interface BrandDestination {
  href: string;
  /** Host only, for display. A full URL with a query string reads as noise. */
  host: string;
  origin: "registry" | "qloo";
}

/**
 * The brand's own website, when one is available and safe to render.
 *
 * Registry-verified first, then the catalogue's. Returns `undefined` rather than
 * a guess: doc 02 §21 forbids inventing a contact, and a card with no link is
 * honest where a card with a plausible one is not.
 *
 * The `http`/`https` check is not bureaucracy. `websites` is an array of strings
 * from a third-party response, and any of them could be `javascript:…`, a bare
 * domain with no scheme, or an empty entry. Putting such a value straight into an
 * `href` either executes script in our origin or produces a link that resolves
 * against our own path — so a value that does not parse as an absolute http(s)
 * URL is treated as absent.
 */
export function officialDestination(brand: EnrichedBrand): BrandDestination | undefined {
  if (brand.registry.verification.status === "verified") {
    const route = brand.registry.partnership;
    const curated =
      route?.creatorPartnershipUrl ?? route?.affiliateUrl ?? route?.ambassadorUrl;
    const verified = parseHttpUrl(curated);
    if (verified !== undefined) return { ...verified, origin: "registry" };
  }

  // `qloo.website` is `websites[0]`, already chosen by the pipeline. Falling back
  // across the array happens there, not here, so this stays one decision deep.
  const fromCatalogue = parseHttpUrl(brand.qloo.website);
  return fromCatalogue === undefined ? undefined : { ...fromCatalogue, origin: "qloo" };
}

/** Absolute http(s) URL → `{href, host}`, or `undefined` for anything else. */
function parseHttpUrl(value: string | undefined): { href: string; host: string } | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return undefined;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
  if (url.hostname.length === 0) return undefined;

  return { href: url.toString(), host: url.hostname.replace(/^www\./, "") };
}

/**
 * The first entry that is an absolute http(s) URL, or `undefined`.
 *
 * Exported for the pipeline's metadata step, which picks a brand's website out of
 * the catalogue's `websites` array. Taking `websites[0]` blindly meant one
 * malformed entry — a bare domain, an empty string — hid every usable URL behind
 * it, and the card then reported no website for a brand that had one.
 */
export function firstHttpUrl(values: readonly string[] | undefined): string | undefined {
  if (values === undefined) return undefined;
  return values.find((value) => parseHttpUrl(value) !== undefined);
}

/**
 * Social profiles the catalogue returned, as followable links.
 *
 * Same rule as `officialDestination`: a handle is only useful if it resolves
 * somewhere, and the network name is only trustworthy as a label. Entries whose
 * value is not an absolute http(s) URL are dropped, because a bare handle cannot
 * be turned into a link without assuming a platform URL scheme — and assuming it
 * is how a card ends up pointing at a profile that does not exist.
 */
export function socialDestinations(
  brand: EnrichedBrand,
  limit = 4,
): Array<{ network: string; handle: string; href: string }> {
  const out: Array<{ network: string; handle: string; href: string }> = [];
  for (const [network, values] of Object.entries(brand.qloo.socialHandles)) {
    for (const value of values) {
      const parsed = parseHttpUrl(value);
      if (parsed === undefined) continue;
      out.push({ network, handle: parsed.host, href: parsed.href });
      break; // one profile per network; the rest are duplicates in practice
    }
    if (out.length >= limit) break;
  }
  return out;
}
