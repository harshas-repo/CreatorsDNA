import rawRegistry from "@/data/brands.json";

import {
  brandRegistrySchema,
  type BrandRegistry,
  type RegistryBrand,
} from "@/lib/contracts/brand";

/**
 * Brand registry loader.
 *
 * The registry is a checked-in JSON file, parsed once through the zod contract.
 * Validation runs at import time so a malformed entry fails the build rather
 * than surfacing as an empty brand list at runtime.
 *
 * Doc 02 §21 is the reason this file exists separately from the provider: brand
 * NAMES and partnership ROUTES are hand-curated, everything descriptive comes
 * from Qloo. Keeping them in different places makes that split auditable.
 */

let parsed: BrandRegistry | undefined;

function load(): BrandRegistry {
  if (parsed) return parsed;
  const result = brandRegistrySchema.safeParse(rawRegistry);
  if (!result.success) {
    // Never swallow this: a silently empty registry would make every brand score
    // look like "no opportunities found" rather than "the data failed to load".
    throw new Error(
      `Brand registry failed validation: ${result.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")}`,
    );
  }
  parsed = result.data;
  return parsed;
}

export function getBrandRegistry(): BrandRegistry {
  return load();
}

export function getAllBrands(): RegistryBrand[] {
  return load().brands;
}

export function getBrandBySlug(slug: string): RegistryBrand | undefined {
  const needle = slug.trim().toLowerCase();
  return load().brands.find((brand) => brand.slug.toLowerCase() === needle);
}

/** Group brands by category, stable-ordered, for the discovery UI. */
export function getBrandsByCategory(): Array<{ category: string; brands: RegistryBrand[] }> {
  const grouped = new Map<string, RegistryBrand[]>();
  for (const brand of load().brands) {
    const existing = grouped.get(brand.category);
    if (existing) existing.push(brand);
    else grouped.set(brand.category, [brand]);
  }
  return [...grouped.entries()]
    .map(([category, brands]) => ({
      category,
      brands: brands.sort((a, b) => a.displayName.localeCompare(b.displayName)),
    }))
    .sort((a, b) => a.category.localeCompare(b.category));
}

/**
 * How many registry entries still need a curator verification pass.
 *
 * Surfaced in the UI so the "no verified partnership route" state is explained
 * as a data-completeness gap rather than looking like the product found nothing.
 */
export function countUnverifiedBrands(): number {
  return load().brands.filter((brand) => brand.verification.status !== "verified").length;
}

/** Test hook: drop the memoised parse so a mutated fixture is re-read. */
export function resetBrandRegistryCache(): void {
  parsed = undefined;
}
