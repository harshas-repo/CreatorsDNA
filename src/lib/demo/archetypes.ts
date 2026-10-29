import type { CreatorProfile } from "@/lib/contracts/creator";
import { creatorProfileSchema } from "@/lib/contracts/creator";
import { SYNTHETIC_ENTITIES } from "@/lib/providers/synthetic/catalogue";

/**
 * The five creator archetypes.
 *
 * They live under `src/lib` rather than `tests/` because they have two callers
 * with different jobs:
 *
 *  - `tests/pipeline.test.ts` uses them to prove a specific property — that the
 *    pipeline produces genuinely DIFFERENT output for different inputs. A
 *    recommendation engine that returns plausible-looking results for anything
 *    also returns the same results for everything, and that failure is invisible
 *    in a demo. So the archetypes are deliberately far apart in the trait space.
 *  - `src/app/page.tsx` uses one of them to render the worked examples on the
 *    public site (doc 02 §27 sections 6–9). Those examples must be produced by
 *    the real pipeline over the real view-models, or the marketing page shows a
 *    drawing of the product instead of the product.
 *
 * One module for both is what keeps them the same five creators. Splitting them
 * would mean the site eventually advertises an example the test suite never
 * checks, and nobody would notice because both would still look correct.
 *
 * Entity ids are looked up by NAME from the synthetic catalogue rather than
 * hard-coded. A hard-coded id silently rots when the catalogue changes and the
 * fixture then tests nothing; a name lookup throws loudly instead.
 */

export type ArchetypeId = "streetwear" | "outdoor" | "gaming" | "food" | "electronic";

export const ARCHETYPE_IDS: readonly ArchetypeId[] = [
  "streetwear",
  "outdoor",
  "gaming",
  "food",
  "electronic",
];

function entityId(name: string): { id: string; subtype: string } {
  const found = SYNTHETIC_ENTITIES.find((entity) => entity.name === name);
  if (found === undefined) {
    throw new Error(
      `Archetype fixture refers to "${name}", which is not in the synthetic catalogue. Update the fixture or the catalogue — do not guess an id.`,
    );
  }
  return { id: found.id, subtype: found.subtype ?? found.type };
}

function interest(name: string) {
  const { id, subtype } = entityId(name);
  return {
    query: name,
    entityId: id,
    name,
    subtype,
    disambiguation: `Synthetic ${subtype.replace("urn:entity:", "")} entity`,
    resolution: "resolved" as const,
    emphasis: "normal" as const,
  };
}

/**
 * Pre-resolved profiles.
 *
 * `resolution: "resolved"` means callers exercise the analysis pipeline, not the
 * search-resolution path. `resolveInterests: false` is passed to `runAnalysis` so
 * no `/search` calls are made — which keeps these profiles deterministic and
 * independent of how the provider chooses to rank matches.
 */
const PROFILES: Record<ArchetypeId, CreatorProfile> = {
  streetwear: creatorProfileSchema.parse({
    id: "arch-streetwear",
    handle: "@soleandseam",
    displayName: "Sole & Seam",
    platforms: ["youtube", "instagram"],
    niche: "Streetwear reviews and sneaker culture history",
    selectedInterests: [interest("Marlowe Vance"), interest("Kickflip Boulevard"), interest("Sable Court")],
    coverage: {
      coveredCategories: ["fashion", "sneakers"],
      coveredTagIds: [],
      saturation: { fashion: 0.8, sneakers: 0.2 },
      methodology: "Creator-declared content categories. Coverage is self-reported, not measured.",
    },
    demographics: { ageBuckets: ["25_to_29"], gender: "male", audienceIds: [] },
    location: { query: "London", city: "London", country: "United Kingdom" },
  }),

  outdoor: creatorProfileSchema.parse({
    id: "arch-outdoor",
    handle: "@ninesuns",
    displayName: "Nine Suns Field Notes",
    platforms: ["youtube", "podcast"],
    niche: "Long-form outdoor documentary and backcountry travel",
    selectedInterests: [
      interest("Nine Hundred Sunrises"),
      interest("The Long Climb"),
      interest("Ridgeline Camp"),
      interest("The Understory"),
    ],
    coverage: {
      coveredCategories: ["travel"],
      coveredTagIds: [],
      saturation: { travel: 0.15 },
      methodology: "Creator-declared content categories. Coverage is self-reported, not measured.",
    },
    demographics: { ageBuckets: ["35_to_44"], audienceIds: [] },
    location: { query: "Vancouver", city: "Vancouver", country: "Canada" },
  }),

  gaming: creatorProfileSchema.parse({
    id: "arch-gaming",
    handle: "@hollowlantern",
    displayName: "Hollow Lantern Reviews",
    platforms: ["twitch", "youtube"],
    niche: "Indie game essays and tactical strategy deep dives",
    selectedInterests: [interest("Hollow Lantern"), interest("Trailhead Tales"), interest("Vector Siege")],
    coverage: {
      coveredCategories: ["gaming"],
      coveredTagIds: [],
      saturation: { gaming: 0.9 },
      methodology: "Creator-declared content categories. Coverage is self-reported, not measured.",
    },
    demographics: { ageBuckets: ["24_and_younger"], audienceIds: [] },
    location: { query: "Austin", city: "Austin", country: "United States" },
  }),

  food: creatorProfileSchema.parse({
    id: "arch-food",
    handle: "@fermentworks",
    displayName: "Ferment Works Journal",
    platforms: ["instagram", "newsletter"],
    niche: "Fermentation, specialty food and restaurant craft",
    selectedInterests: [
      interest("Tomas Reyes"),
      interest("Ledger & Lime"),
      interest("Salt, Fat, Ledger"),
      interest("Ferment Works"),
    ],
    coverage: {
      coveredCategories: ["food", "coffee"],
      coveredTagIds: [],
      saturation: { food: 0.5, coffee: 0.05 },
      methodology: "Creator-declared content categories. Coverage is self-reported, not measured.",
    },
    demographics: { ageBuckets: ["30_to_34"], gender: "female", audienceIds: [] },
    location: { query: "Melbourne", city: "Melbourne", country: "Australia" },
  }),

  electronic: creatorProfileSchema.parse({
    id: "arch-electronic",
    handle: "@nightcartographer",
    displayName: "Night Cartographer",
    platforms: ["youtube", "other"],
    niche: "Electronic music production and club culture archaeology",
    selectedInterests: [
      interest("Neon Cartographer"),
      interest("DJ Hollowfield"),
      interest("Bootleg Frequencies"),
    ],
    coverage: {
      coveredCategories: ["music"],
      coveredTagIds: [],
      saturation: { music: 0.35 },
      methodology: "Creator-declared content categories. Coverage is self-reported, not measured.",
    },
    demographics: { ageBuckets: ["25_to_29"], audienceIds: [] },
    location: { query: "Berlin", city: "Berlin", country: "Germany" },
  }),
};

export function archetypeProfile(id: ArchetypeId): CreatorProfile {
  return PROFILES[id];
}

export function allArchetypeProfiles(): Array<{ id: ArchetypeId; profile: CreatorProfile }> {
  return ARCHETYPE_IDS.map((id) => ({ id, profile: PROFILES[id] }));
}

/**
 * A profile with NO resolved interests.
 *
 * This is the empty-state fixture. It is separate from the archetypes because it
 * exercises a different contract: the provider must NOT be called at all (it
 * requires at least one valid signal), and the analysis must come back
 * non-renderable with the reason recorded rather than throwing or inventing a
 * profile.
 */
export function emptyProfile(): CreatorProfile {
  return creatorProfileSchema.parse({
    id: "arch-empty",
    handle: "@nobody",
    displayName: "No Signals Yet",
    platforms: ["youtube"],
    selectedInterests: [
      { query: "asdfqwerty", resolution: "not_found", emphasis: "normal" },
    ],
    coverage: { coveredCategories: [], coveredTagIds: [], saturation: {} },
  });
}

/** A profile whose interests are ambiguous, so resolution must ask rather than guess. */
export function ambiguousProfile(): CreatorProfile {
  return creatorProfileSchema.parse({
    id: "arch-ambiguous",
    handle: "@uncertain",
    displayName: "Ambiguous Signals",
    platforms: ["youtube"],
    selectedInterests: [{ query: "Velvet", resolution: "ambiguous", emphasis: "normal" }],
    coverage: { coveredCategories: [], coveredTagIds: [], saturation: {} },
  });
}

/** Fixed timestamp so `generatedAt` never makes a snapshot differ between runs. */
export const FIXED_TIMESTAMP = "2026-01-01T00:00:00.000Z";
