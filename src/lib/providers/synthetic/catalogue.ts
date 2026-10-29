/**
 * Synthetic cultural catalogue.
 *
 * ⚠️ EVERY ENTITY HERE IS INVENTED. Names, descriptions, popularity values and
 * affinities are fabricated development data. Doc 05 §13 and the current
 * execution decision both require that synthetic results are never presented as
 * Qloo discoveries, so every value produced from this catalogue carries
 * `provenance: "synthetic"` and the UI renders a persistent banner.
 *
 * Why a trait model rather than random numbers:
 *
 * Doc 03 §11 mitigation #4 requires that five different creators produce five
 * DIFFERENT Taste DNAs, and that identical output be treated as a bug. A
 * catalogue of random values per call would make that test meaningless. So each
 * entity carries a sparse vector over a fixed trait vocabulary, and affinity is
 * a deterministic similarity between the creator's aggregated signal vector and
 * the candidate's vector. The synthetic provider is therefore genuinely
 * signal-responsive — it exercises the same code paths, including the
 * personalisation assertion, that the live adapter will.
 *
 * Brand entities are NOT listed here. They are injected from the curated brand
 * registry, because those brands are real (decision 3) and only their SCORES are
 * synthetic.
 */

export const SYNTHETIC_CATALOGUE_NOTICE =
  "Synthetic development data. Every entity, score and relationship shown is generated locally for development and testing. None of it was returned by Qloo.";

// ---------------------------------------------------------------------------
// Trait vocabulary
// ---------------------------------------------------------------------------

/**
 * A fixed cultural-trait vocabulary. Every entity is a sparse weighting over
 * these. Kept small enough to reason about and large enough that distinct
 * niches do not collapse into the same neighbourhood.
 */
export const TRAITS = [
  "streetwear",
  "sneaker_culture",
  "hip_hop",
  "electronic_music",
  "indie_rock",
  "pop_culture",
  "film_craft",
  "documentary",
  "anime",
  "gaming_competitive",
  "gaming_indie",
  "motorsport",
  "cycling",
  "running",
  "outdoor_adventure",
  "camping",
  "cooking",
  "coffee_culture",
  "specialty_food",
  "consumer_technology",
  "ai_tooling",
  "photography",
  "design_craft",
  "diy_making",
  "sustainability",
  "wellness",
  "personal_finance",
  "travel_culture",
  "literature",
  "comedy",
  "strength_training",
  "retro_nostalgia",
] as const;

export type Trait = (typeof TRAITS)[number];

export type TraitVector = Partial<Record<Trait, number>>;

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

export interface SyntheticEntity {
  id: string;
  name: string;
  /** Insights `filter.type`. */
  type: string;
  subtype: string;
  /** Human-readable grouping, used for the Taste DNA category layer. */
  category: string;
  disambiguation: string;
  description: string;
  traits: TraitVector;
  /** 0..1 catalogue popularity, independent of any query (doc 03 §15). */
  popularity: number;
  tags: Array<{ id: string; name: string; type: string }>;
  /**
   * Qloo `properties.industries`. Brand entities only.
   *
   * This is where a brand's commerce category belongs. "Apparel" is not a genre
   * of cultural work, so encoding it as `urn:tag:genre:media:apparel` puts it in
   * a namespace that LOOKS comparable to a creator's taste tags while never
   * actually being one — see `TRAIT_TAGS` below.
   */
  industries?: string[];
}

/**
 * Identity map so entity rows can be written as `[T.hip_hop]: 0.95` while the
 * keys stay type-checked against the trait vocabulary.
 */
const T: Record<Trait, Trait> = Object.fromEntries(TRAITS.map((trait) => [trait, trait])) as Record<
  Trait,
  Trait
>;

/** Compact builder: `e("artist", "Name", "Music", traits, popularity, tags)`. */
function e(
  type: string,
  name: string,
  category: string,
  traits: TraitVector,
  popularity: number,
  tags: Array<[string, string, string]>,
  disambiguation = "",
  description = "",
): SyntheticEntity {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return {
    id: `syn:${type.replace("urn:entity:", "")}:${slug}`,
    name,
    type,
    subtype: type,
    category,
    disambiguation: disambiguation || `Synthetic ${category.toLowerCase()} entity`,
    description: description || `Invented ${category.toLowerCase()} entry used for development data.`,
    traits,
    popularity,
    tags: tags.map(([id, tagName, tagType]) => ({ id, name: tagName, type: tagType })),
  };
}

/** Genre tags — an ALLOWED namespace under the doc 03 §17 curation policy. */
const genre = (slug: string, name: string): [string, string, string] => [
  `urn:tag:genre:media:${slug}`,
  name,
  "urn:tag:genre:media",
];
/** Style tags — also allowed. */
const style = (slug: string, name: string): [string, string, string] => [
  `urn:tag:style:qloo:${slug}`,
  name,
  "urn:tag:style:qloo",
];
/**
 * Keyword tags — HARD DENIED by the curation policy. Deliberately included so
 * the filtering path is exercised by tests rather than merely asserted in prose.
 * These mirror the kind of plot keyword doc 03 §17 warns about.
 */
const keyword = (slug: string, name: string): [string, string, string] => [
  `urn:tag:keyword:media:${slug}`,
  name,
  "urn:tag:keyword:media",
];

const BASE_ENTITIES: SyntheticEntity[] = [
  // ---- Music ----
  e("urn:entity:artist", "Neon Cartographer", "Music", { [T.electronic_music]: 0.9, [T.design_craft]: 0.5, [T.consumer_technology]: 0.4 }, 0.62, [genre("electronic", "Electronic"), style("nocturnal", "Nocturnal"), keyword("synth_arpeggio", "Synth Arpeggio")]),
  e("urn:entity:artist", "Marlowe Vance", "Music", { [T.hip_hop]: 0.95, [T.streetwear]: 0.7, [T.sneaker_culture]: 0.6 }, 0.88, [genre("hip_hop", "Hip-Hop"), style("confident", "Confident")]),
  e("urn:entity:artist", "The Paper Harbour", "Music", { [T.indie_rock]: 0.9, [T.literature]: 0.4, [T.coffee_culture]: 0.35 }, 0.41, [genre("indie", "Indie"), style("wistful", "Wistful")]),
  e("urn:entity:artist", "Sable Court", "Music", { [T.pop_culture]: 0.85, [T.streetwear]: 0.5, [T.comedy]: 0.2 }, 0.93, [genre("pop", "Pop"), style("glossy", "Glossy")]),
  e("urn:entity:artist", "Ferrous Bloom", "Music", { [T.indie_rock]: 0.7, [T.diy_making]: 0.55, [T.retro_nostalgia]: 0.5 }, 0.33, [genre("alternative", "Alternative"), style("lo_fi", "Lo-Fi")]),
  e("urn:entity:artist", "DJ Hollowfield", "Music", { [T.electronic_music]: 0.85, [T.gaming_competitive]: 0.45, [T.pop_culture]: 0.4 }, 0.71, [genre("dance", "Dance"), style("high_energy", "High Energy")]),

  // ---- Film ----
  e("urn:entity:movie", "The Salt Line", "Film", { [T.film_craft]: 0.9, [T.documentary]: 0.5, [T.travel_culture]: 0.45 }, 0.58, [genre("drama", "Drama"), style("slow_burn", "Slow Burn"), keyword("boat_sinking", "Boat Sinking")]),
  e("urn:entity:movie", "Velvet Static", "Film", { [T.film_craft]: 0.75, [T.retro_nostalgia]: 0.7, [T.pop_culture]: 0.5 }, 0.47, [genre("thriller", "Thriller"), style("stylised", "Stylised")]),
  e("urn:entity:movie", "Nine Hundred Sunrises", "Film", { [T.documentary]: 0.95, [T.outdoor_adventure]: 0.6, [T.sustainability]: 0.5 }, 0.36, [genre("documentary", "Documentary"), style("contemplative", "Contemplative")]),
  e("urn:entity:movie", "Kickflip Boulevard", "Film", { [T.streetwear]: 0.8, [T.sneaker_culture]: 0.7, [T.comedy]: 0.45, [T.diy_making]: 0.4 }, 0.52, [genre("comedy", "Comedy"), style("irreverent", "Irreverent")]),

  // ---- Television ----
  e("urn:entity:tv_show", "Foundry Road", "Television", { [T.diy_making]: 0.9, [T.design_craft]: 0.65, [T.sustainability]: 0.4 }, 0.64, [genre("reality", "Reality"), style("hands_on", "Hands-On")]),
  e("urn:entity:tv_show", "The Understory", "Television", { [T.documentary]: 0.85, [T.sustainability]: 0.7, [T.outdoor_adventure]: 0.5 }, 0.44, [genre("nature", "Nature"), style("reverent", "Reverent")]),
  e("urn:entity:tv_show", "Midnight Reps", "Television", { [T.gaming_competitive]: 0.8, [T.comedy]: 0.6, [T.pop_culture]: 0.5 }, 0.77, [genre("comedy", "Comedy"), style("banter", "Banter")]),
  e("urn:entity:tv_show", "Ledger & Lime", "Television", { [T.cooking]: 0.85, [T.specialty_food]: 0.7, [T.personal_finance]: 0.35 }, 0.55, [genre("lifestyle", "Lifestyle"), style("warm", "Warm")]),

  // ---- Video games ----
  e("urn:entity:videogame", "Driftline Rally", "Gaming", { [T.motorsport]: 0.95, [T.gaming_competitive]: 0.7, [T.consumer_technology]: 0.4 }, 0.69, [genre("racing", "Racing"), style("simulation", "Simulation")]),
  e("urn:entity:videogame", "Hollow Lantern", "Gaming", { [T.gaming_indie]: 0.95, [T.film_craft]: 0.4, [T.literature]: 0.45 }, 0.38, [genre("adventure", "Adventure"), style("atmospheric", "Atmospheric")]),
  e("urn:entity:videogame", "Vector Siege", "Gaming", { [T.gaming_competitive]: 0.9, [T.consumer_technology]: 0.55, [T.electronic_music]: 0.3 }, 0.84, [genre("strategy", "Strategy"), style("tactical", "Tactical")]),
  e("urn:entity:videogame", "Trailhead Tales", "Gaming", { [T.gaming_indie]: 0.7, [T.outdoor_adventure]: 0.75, [T.camping]: 0.6, [T.sustainability]: 0.4 }, 0.29, [genre("casual", "Casual"), style("cosy", "Cosy")]),

  // ---- Podcasts ----
  e("urn:entity:podcast", "Compound Interest", "Podcast", { [T.personal_finance]: 0.95, [T.consumer_technology]: 0.35, [T.wellness]: 0.25 }, 0.66, [genre("business", "Business"), style("practical", "Practical")]),
  e("urn:entity:podcast", "Grain & Gravity", "Podcast", { [T.photography]: 0.9, [T.film_craft]: 0.6, [T.design_craft]: 0.5 }, 0.31, [genre("arts", "Arts"), style("technical", "Technical")]),
  e("urn:entity:podcast", "The Long Climb", "Podcast", { [T.outdoor_adventure]: 0.9, [T.strength_training]: 0.6, [T.wellness]: 0.55 }, 0.48, [genre("sports", "Sports"), style("inspirational", "Inspirational")]),
  e("urn:entity:podcast", "Bootleg Frequencies", "Podcast", { [T.retro_nostalgia]: 0.85, [T.electronic_music]: 0.6, [T.comedy]: 0.4 }, 0.27, [genre("music", "Music"), style("nostalgic", "Nostalgic")]),

  // ---- Books ----
  e("urn:entity:book", "A Grammar of Rivers", "Book", { [T.literature]: 0.95, [T.sustainability]: 0.5, [T.travel_culture]: 0.4 }, 0.42, [genre("literary", "Literary"), style("lyrical", "Lyrical")]),
  e("urn:entity:book", "The Maintenance Manifesto", "Book", { [T.diy_making]: 0.9, [T.sustainability]: 0.75, [T.design_craft]: 0.5 }, 0.35, [genre("nonfiction", "Non-Fiction"), style("polemical", "Polemical")]),
  e("urn:entity:book", "Salt, Fat, Ledger", "Book", { [T.cooking]: 0.8, [T.specialty_food]: 0.75, [T.personal_finance]: 0.4 }, 0.51, [genre("food", "Food Writing"), style("methodical", "Methodical")]),

  // ---- People ----
  e("urn:entity:person", "Ines Okonkwo", "Person", { [T.photography]: 0.85, [T.travel_culture]: 0.7, [T.documentary]: 0.6 }, 0.4, [genre("creator", "Creator"), style("observational", "Observational")], "Synthetic photographer and documentarian"),
  e("urn:entity:person", "Bex Halloran", "Person", { [T.strength_training]: 0.9, [T.wellness]: 0.7, [T.running]: 0.5 }, 0.57, [genre("athlete", "Athlete"), style("disciplined", "Disciplined")], "Synthetic coach and endurance athlete"),
  e("urn:entity:person", "Tomas Reyes", "Person", { [T.cooking]: 0.9, [T.specialty_food]: 0.8, [T.coffee_culture]: 0.5 }, 0.63, [genre("chef", "Chef"), style("instinctive", "Instinctive")], "Synthetic chef and food writer"),

  // ---- Places ----
  e("urn:entity:place", "Ferment Works", "Place", { [T.specialty_food]: 0.9, [T.coffee_culture]: 0.6, [T.sustainability]: 0.55 }, 0.24, [genre("restaurant", "Restaurant"), style("experimental", "Experimental")], "Synthetic neighbourhood kitchen"),
  e("urn:entity:place", "Ridgeline Camp", "Place", { [T.camping]: 0.95, [T.outdoor_adventure]: 0.85, [T.sustainability]: 0.5 }, 0.19, [genre("outdoor", "Outdoor"), style("rustic", "Rustic")], "Synthetic backcountry camp"),
  e("urn:entity:place", "Halftone Gallery", "Place", { [T.design_craft]: 0.9, [T.photography]: 0.7, [T.film_craft]: 0.45 }, 0.28, [genre("gallery", "Gallery"), style("minimal", "Minimal")], "Synthetic print and photography gallery"),
];

// ---------------------------------------------------------------------------
// Shared tag groups
// ---------------------------------------------------------------------------

/**
 * Tags carried by MORE THAN ONE entity.
 *
 * This layer exists because of a real defect it exposed. Method M3 — harvesting
 * taste tags from entity results, the answer to decision D2 — requires a tag to
 * appear on at least `minTagSupport` results before it is surfaced, on the doc 04
 * §4.2 principle that "a tag on one result is an anecdote; a tag on twelve is a
 * pattern". The entity list above gave almost every entry a bespoke tag set, so
 * no tag ever reached support 2 and `coreTastes` came back EMPTY for every
 * archetype. The scoring code was correct; the fixture was not.
 *
 * A real cultural catalogue shares genre, style and subject tags heavily — that
 * overlap is precisely what makes co-occurrence analysis possible. The groups
 * below reproduce that structure. Members are named rather than indexed so a
 * renamed entity fails loudly at import time instead of silently dropping a tag.
 *
 * Note the deliberate inclusion of the `keyword` namespace in one group: doc 03
 * §17 HARD DENIES plot keywords, so a shared keyword must still be filtered out.
 * Keeping one shared makes that filter testable rather than merely asserted.
 */
const SHARED_TAG_GROUPS: Array<{
  id: string;
  name: string;
  type: string;
  members: readonly string[];
}> = [
  {
    id: "urn:tag:genre:media:electronic",
    name: "Electronic",
    type: "urn:tag:genre:media",
    members: ["Neon Cartographer", "DJ Hollowfield", "Bootleg Frequencies", "Vector Siege"],
  },
  {
    id: "urn:tag:genre:media:hip_hop",
    name: "Hip-Hop",
    type: "urn:tag:genre:media",
    members: ["Marlowe Vance", "Kickflip Boulevard", "Sable Court", "Bootleg Frequencies"],
  },
  {
    id: "urn:tag:genre:media:indie",
    name: "Indie",
    type: "urn:tag:genre:media",
    members: ["The Paper Harbour", "Ferrous Bloom", "Hollow Lantern", "Trailhead Tales"],
  },
  {
    id: "urn:tag:genre:media:documentary",
    name: "Documentary",
    type: "urn:tag:genre:media",
    members: [
      "Nine Hundred Sunrises",
      "The Understory",
      "The Salt Line",
      "Ines Okonkwo",
      "Grain & Gravity",
    ],
  },
  {
    id: "urn:tag:style:qloo:outdoor",
    name: "Outdoor",
    type: "urn:tag:style:qloo",
    members: [
      "Nine Hundred Sunrises",
      "The Long Climb",
      "Ridgeline Camp",
      "Trailhead Tales",
      "The Understory",
    ],
  },
  {
    id: "urn:tag:genre:media:food",
    name: "Food",
    type: "urn:tag:genre:media",
    members: ["Ledger & Lime", "Salt, Fat, Ledger", "Tomas Reyes", "Ferment Works"],
  },
  {
    id: "urn:tag:genre:media:gaming",
    name: "Gaming",
    type: "urn:tag:genre:media",
    members: [
      "Driftline Rally",
      "Hollow Lantern",
      "Vector Siege",
      "Trailhead Tales",
      "Midnight Reps",
    ],
  },
  {
    id: "urn:tag:style:qloo:design_craft",
    name: "Design & Craft",
    type: "urn:tag:style:qloo",
    members: [
      "Foundry Road",
      "Halftone Gallery",
      "Grain & Gravity",
      "The Maintenance Manifesto",
      "Neon Cartographer",
    ],
  },
  {
    id: "urn:tag:style:qloo:retro",
    name: "Retro",
    type: "urn:tag:style:qloo",
    members: ["Velvet Static", "Ferrous Bloom", "Bootleg Frequencies"],
  },
  {
    id: "urn:tag:style:qloo:wellness",
    name: "Wellness",
    type: "urn:tag:style:qloo",
    members: ["Bex Halloran", "The Long Climb", "Compound Interest"],
  },
  {
    id: "urn:tag:genre:media:sustainability",
    name: "Sustainability",
    type: "urn:tag:genre:media",
    members: [
      "The Understory",
      "The Maintenance Manifesto",
      "Ridgeline Camp",
      "Nine Hundred Sunrises",
      "A Grammar of Rivers",
    ],
  },
  // Denied namespace, shared on purpose — see the note above.
  {
    id: "urn:tag:keyword:media:ensemble_cast",
    name: "Ensemble Cast",
    type: "urn:tag:keyword:media",
    members: ["Kickflip Boulevard", "Midnight Reps", "Velvet Static"],
  },
];

/** Broad per-category tag, so any two entities in a category always overlap. */
const CATEGORY_TAG: Record<string, { id: string; name: string }> = {
  Music: { id: "urn:tag:genre:media:music", name: "Music" },
  Film: { id: "urn:tag:genre:media:film", name: "Film" },
  Television: { id: "urn:tag:genre:media:television", name: "Television" },
  Gaming: { id: "urn:tag:genre:media:gaming_culture", name: "Gaming Culture" },
  Podcast: { id: "urn:tag:genre:media:audio", name: "Audio" },
  Book: { id: "urn:tag:genre:media:literature", name: "Literature" },
  Person: { id: "urn:tag:genre:media:creator_culture", name: "Creator Culture" },
  Place: { id: "urn:tag:genre:media:local_culture", name: "Local Culture" },
};

// ---------------------------------------------------------------------------
// Trait -> cultural tag
// ---------------------------------------------------------------------------

/** A tag as the catalogue declares it: id, the label shown, and its namespace. */
interface CatalogueTag {
  id: string;
  name: string;
  type: string;
}

/**
 * Every tag the catalogue shares, resolved to its name and type.
 *
 * Built from the two declarations above rather than written out a third time, so
 * `TRAIT_TAGS` can only point at a tag that real entities in this catalogue
 * actually carry. That is the whole point: a brand tag nothing else carries is
 * not a cultural fact, it is a string that can never match.
 */
const SHARED_TAG_INDEX: ReadonlyMap<string, CatalogueTag> = new Map<string, CatalogueTag>([
  ...SHARED_TAG_GROUPS.map(
    (group): [string, CatalogueTag] => [
      group.id,
      { id: group.id, name: group.name, type: group.type },
    ],
  ),
  ...Object.values(CATEGORY_TAG).map(
    (tag): [string, CatalogueTag] => [
      tag.id,
      { id: tag.id, name: tag.name, type: "urn:tag:genre:media" },
    ],
  ),
]);

/**
 * The cultural tag each trait earns, in the catalogue's own tag vocabulary.
 *
 * WHY THIS EXISTS
 * ---------------
 * Brand entities used to be given one tag built from their commerce category —
 * `urn:tag:genre:media:${category}`, so `:apparel`, `:footwear`, `:beauty`. No
 * creator entity in this catalogue carries any of those ids, and the intersection
 * compares tag ids, so `shared` came back EMPTY for every brand in every run.
 * The product's central operation could not fire, and a non-vacuity guard in
 * `tests/pipeline.test.ts` is what proved it. The scoring code was correct; the
 * fixture was not — the same defect `SHARED_TAG_GROUPS` was added for, one layer
 * down.
 *
 * A real cultural catalogue tags a brand with the cultures it sits in, not only
 * with the product it sells. So the brand side is derived from the trait vector
 * the brand already carries, and every target below is a tag creator entities
 * also carry — which is what makes a match an identity between two catalogue
 * entries rather than two words that happen to look alike.
 *
 * DELIBERATELY PARTIAL
 * --------------------
 * Traits the catalogue has no shared tag for (`pop_culture`, `motorsport`,
 * `consumer_technology`, `photography`, `travel_culture`, ...) are absent, so a
 * brand strong only in those comes back with no comparable tag at all. That is
 * the sparse outcome doc 05 §7 requires: it is recorded as evidence-limited and
 * ranked down, never filled in by reading the brand's name or its commerce
 * category for keywords. Inventing a tag to make the numbers look better would
 * be exactly the fabrication the intersection exists to avoid.
 */
const TRAIT_TAGS: Partial<Record<Trait, string>> = {
  hip_hop: "urn:tag:genre:media:hip_hop",
  // Not a leap: the catalogue's streetwear entities — Marlowe Vance, Kickflip
  // Boulevard, Sable Court — are precisely the ones already carrying the hip-hop
  // tag. This restates a link the fixture asserts elsewhere.
  streetwear: "urn:tag:genre:media:hip_hop",
  sneaker_culture: "urn:tag:genre:media:hip_hop",
  electronic_music: "urn:tag:genre:media:electronic",
  indie_rock: "urn:tag:genre:media:indie",
  documentary: "urn:tag:genre:media:documentary",
  film_craft: "urn:tag:genre:media:film",
  gaming_competitive: "urn:tag:genre:media:gaming",
  gaming_indie: "urn:tag:genre:media:gaming",
  outdoor_adventure: "urn:tag:style:qloo:outdoor",
  camping: "urn:tag:style:qloo:outdoor",
  cooking: "urn:tag:genre:media:food",
  specialty_food: "urn:tag:genre:media:food",
  coffee_culture: "urn:tag:genre:media:food",
  design_craft: "urn:tag:style:qloo:design_craft",
  diy_making: "urn:tag:style:qloo:design_craft",
  sustainability: "urn:tag:genre:media:sustainability",
  wellness: "urn:tag:style:qloo:wellness",
  strength_training: "urn:tag:style:qloo:wellness",
  retro_nostalgia: "urn:tag:style:qloo:retro",
  literature: "urn:tag:genre:media:literature",
};

/**
 * Cultural tags for a trait vector, strongest trait first.
 *
 * Deterministic — weight descending, trait name as the tie-break — so a brand's
 * descriptors never move between runs and cached scores stay valid. Traits that
 * earn the same tag collapse into one descriptor, because `cooking` and
 * `specialty_food` both meaning Food is one fact about the brand, not two.
 */
export function culturalTagsForTraits(traits: TraitVector): CatalogueTag[] {
  const ordered = (Object.entries(traits) as Array<[Trait, number | undefined]>)
    .filter((entry): entry is [Trait, number] => entry[1] !== undefined)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  const tags: CatalogueTag[] = [];
  const seen = new Set<string>();
  for (const [trait] of ordered) {
    const id = TRAIT_TAGS[trait];
    if (id === undefined || seen.has(id)) continue;
    const tag = SHARED_TAG_INDEX.get(id);
    if (tag === undefined) {
      // Fail loudly, for the reason `withSharedTags` does: a mistyped id would
      // silently drop a brand's only comparable tag and the intersection would
      // go quietly empty again — the failure this map was written to fix.
      throw new Error(
        `TRAIT_TAGS maps "${trait}" to "${id}", which no shared tag group defines.`,
      );
    }
    seen.add(id);
    tags.push({ id: tag.id, name: tag.name, type: tag.type });
  }
  return tags;
}

function withSharedTags(entities: readonly SyntheticEntity[]): SyntheticEntity[] {
  const byName = new Map(entities.map((entity) => [entity.name, entity]));

  const add = (entity: SyntheticEntity, id: string, name: string, type: string): void => {
    if (entity.tags.some((tag) => tag.id === id)) return;
    entity.tags.push({ id, name, type });
  };

  for (const group of SHARED_TAG_GROUPS) {
    for (const member of group.members) {
      const entity = byName.get(member);
      if (entity === undefined) {
        // Fail loudly. A silently-skipped member would quietly weaken the fixture
        // and the M3 tests would keep passing while testing less.
        throw new Error(
          `Shared tag group "${group.name}" lists "${member}", which is not in the synthetic catalogue.`,
        );
      }
      add(entity, group.id, group.name, group.type);
    }
  }

  for (const entity of entities) {
    const broad = CATEGORY_TAG[entity.category];
    if (broad !== undefined) add(entity, broad.id, broad.name, "urn:tag:genre:media");
  }

  return [...entities];
}

/** The catalogue actually used, with shared tags applied. */
export const SYNTHETIC_ENTITIES: readonly SyntheticEntity[] = withSharedTags(BASE_ENTITIES);

/** Index for O(1) lookup by synthetic id. */
export const SYNTHETIC_ENTITY_INDEX: ReadonlyMap<string, SyntheticEntity> = new Map(
  SYNTHETIC_ENTITIES.map((entity) => [entity.id, entity]),
);

export function findSyntheticEntity(id: string): SyntheticEntity | undefined {
  return SYNTHETIC_ENTITY_INDEX.get(id);
}

/** All entity types the synthetic catalogue can return, by Insights type. */
export const SYNTHETIC_TYPES: readonly string[] = [
  ...new Set(SYNTHETIC_ENTITIES.map((entity) => entity.type)),
];

/** Cultural categories present in the catalogue. */
export const SYNTHETIC_CATEGORIES: readonly string[] = [
  ...new Set(SYNTHETIC_ENTITIES.map((entity) => entity.category)),
];
