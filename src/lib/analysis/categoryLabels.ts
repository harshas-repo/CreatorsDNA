/**
 * Category labels — the human-readable name of an entity category.
 *
 * Why this is a separate module rather than an inline helper in `tasteDna.ts`:
 *
 * A category is a SET of entities (`deriveCategories` groups the pool by
 * `subtype ?? type`). Its label therefore has to be a property of the SET, and
 * the only thing that identifies the set is its id. The previous implementation
 * took an optional `sample` entity and returned that entity's `disambiguation`
 * when one existed, which is a set label derived from one member. The visible
 * failure was an "unexpected affinity" whose category read "Company of American
 * Idiot" — the disambiguation text of a single music entity, presented as the
 * name of a whole cultural category. The same string also leaked onto the public
 * landing page through the illustrative archetypes, so a fixture's
 * disambiguation ("Synthetic music entity") was being shown as a category.
 *
 * So: labels come from a static map keyed by the category id, with a
 * deterministic title-case fallback for ids the map has not seen. An id we have
 * never encountered still gets a readable, honest label rather than a raw URN or
 * another entity's description.
 */

/**
 * Category id → label.
 *
 * Keys are what `categoryId()` returns, i.e. `entity.subtype ?? entity.type`.
 * Qloo emits both bare tails (`artist`) and full URNs (`urn:entity:artist`), and
 * the two documented spellings of video game. Every key is therefore listed in
 * whichever forms the catalogue actually produces, because a lookup miss falls
 * back to a mechanical title-case that is legible but less accurate.
 */
const CATEGORY_LABELS: Record<string, string> = {
  // -- people & music ------------------------------------------------------
  artist: "Music artists",
  "urn:entity:artist": "Music artists",
  album: "Albums",
  "urn:entity:album": "Albums",
  musician: "Musicians",
  "urn:entity:musician": "Musicians",
  band: "Bands",
  "urn:entity:band": "Bands",
  person: "People",
  "urn:entity:person": "People",
  actor: "Actors",
  "urn:entity:actor": "Actors",
  director: "Directors",
  "urn:entity:director": "Directors",
  author: "Authors",
  "urn:entity:author": "Authors",
  athlete: "Athletes",
  "urn:entity:athlete": "Athletes",

  // -- screen & audio ------------------------------------------------------
  movie: "Films",
  "urn:entity:movie": "Films",
  film: "Films",
  "urn:entity:film": "Films",
  tv_show: "TV shows",
  "urn:entity:tv_show": "TV shows",
  tv_series: "TV shows",
  "urn:entity:tv_series": "TV shows",
  podcast: "Podcasts",
  "urn:entity:podcast": "Podcasts",
  book: "Books",
  "urn:entity:book": "Books",

  // -- games ---------------------------------------------------------------
  videogame: "Video games",
  "urn:entity:videogame": "Video games",
  video_game: "Video games",
  "urn:entity:video_game": "Video games",
  game: "Games",
  "urn:entity:game": "Games",

  // -- commerce ------------------------------------------------------------
  brand: "Brands",
  "urn:entity:brand": "Brands",
  company: "Companies",
  "urn:entity:company": "Companies",
  product: "Products",
  "urn:entity:product": "Products",
  retail_location: "Retail locations",
  "urn:entity:retail_location": "Retail locations",

  // -- places --------------------------------------------------------------
  place: "Places",
  "urn:entity:place": "Places",
  locality: "Locations",
  "urn:entity:locality": "Locations",
  city: "Cities",
  "urn:entity:city": "Cities",
  country: "Countries",
  "urn:entity:country": "Countries",
  neighbourhood: "Neighbourhoods",
  "urn:entity:neighbourhood": "Neighbourhoods",

  // -- tags & other --------------------------------------------------------
  "urn:tag": "Topics",
  tag: "Topics",
  unknown: "Uncategorised",
};

/**
 * Render a category id for a reader.
 *
 * No entity parameter, by design: see the module header. A label that depended
 * on one member of the set would describe that member, not the category.
 */
export function categoryLabel(id: string): string {
  const trimmed = id.trim();
  if (trimmed.length === 0) return CATEGORY_LABELS["unknown"]!;

  const direct = CATEGORY_LABELS[trimmed];
  if (direct !== undefined) return direct;

  // `urn:entity:tv_show` → try `tv_show`. Covers ids the map has not seen but
  // whose tail it has, which is most of them.
  const tail = trimmed.split(":").pop() ?? trimmed;
  const byTail = CATEGORY_LABELS[tail];
  if (byTail !== undefined) return byTail;

  return titleCaseTail(tail);
}

/**
 * Mechanical fallback: `some_new_type` → "Some New Type".
 *
 * Deterministic and never implies data we do not hold. It is also what keeps an
 * unseen id off the screen as a raw URN, which would be showing the reader our
 * encoding rather than their culture.
 */
function titleCaseTail(tail: string): string {
  return tail.replace(/[_-]+/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

/** True when the label came from the curated map rather than the fallback. */
export function hasCuratedCategoryLabel(id: string): boolean {
  const trimmed = id.trim();
  if (CATEGORY_LABELS[trimmed] !== undefined) return true;
  const tail = trimmed.split(":").pop() ?? trimmed;
  return CATEGORY_LABELS[tail] !== undefined;
}
