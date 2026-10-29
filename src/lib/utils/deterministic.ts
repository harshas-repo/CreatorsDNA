/**
 * Deterministic hashing and seeded randomness.
 *
 * Two things in this codebase must be reproducible across processes:
 *   - cache keys, so a repeated analysis hits the cache instead of the API
 *   - synthetic fixtures, so tests assert stable values and a creator's taste
 *     fingerprint does not change between renders
 *
 * `Math.random()` is therefore never used anywhere in `src/lib`.
 */

/** FNV-1a, 32-bit. Fast, stable, and good enough for non-cryptographic keys. */
export function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function hashToHex(input: string): string {
  return fnv1a32(input).toString(16).padStart(8, "0");
}

/**
 * Stable canonical key for a parameter object.
 *
 * Doc 03 §8 requires caching "keyed by the sorted parameter set" so that two
 * logically identical requests share one cache entry regardless of the order in
 * which their parameters were assembled.
 */
export function stableKey(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      const entry = record[key];
      if (entry === undefined) continue; // absent and explicit-undefined must match
      sorted[key] = sortDeep(entry);
    }
    return sorted;
  }
  return value;
}

/**
 * Mulberry32 — a tiny seeded PRNG.
 *
 * Used only by the synthetic provider and by decorative geometry. Seeded from a
 * string so the same creator always produces the same synthetic world.
 */
export function createRandom(seed: string): () => number {
  let state = fnv1a32(seed) || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Inclusive integer in [min, max]. */
export function randomInt(random: () => number, min: number, max: number): number {
  return min + Math.floor(random() * (max - min + 1));
}

/** Deterministic pick from a non-empty array. */
export function pick<T>(random: () => number, items: readonly T[]): T {
  if (items.length === 0) {
    throw new Error("pick() requires a non-empty array");
  }
  const index = Math.min(items.length - 1, Math.floor(random() * items.length));
  return items[index] as T;
}

/** Deterministic shuffle (Fisher–Yates over a seeded PRNG). */
export function shuffle<T>(random: () => number, items: readonly T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j] as T, copy[i] as T];
  }
  return copy;
}

export function clamp(value: number, min = 0, max = 1): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function round(value: number, decimals = 4): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * Decimal places used for every SVG coordinate derived from trigonometry.
 *
 * Three is 0.001 user units — invisible at every viewBox in this app (the
 * smallest is 132 units rendered at 56px, where it is 0.0004 of a pixel) and
 * eleven orders of magnitude coarser than the divergence it has to absorb.
 */
export const SVG_COORD_DECIMALS = 3;

/**
 * A point on a circle, rounded so it is safe to emit as an SVG coordinate.
 *
 * THE ROUNDING IS NOT COSMETIC. IT FIXES A HYDRATION MISMATCH.
 * -----------------------------------------------------------
 * `Math.sin` and `Math.cos` are "implementation-approximated" per ECMA-262: the
 * spec permits any result within a few ULP of the true value. Node's V8 and
 * Chrome's V8 do not always pick the same one. So a polar coordinate computed
 * during server render and recomputed during hydration can differ in the
 * seventeenth significant digit — `40.432019981633765` against
 * `40.43201998163376`. React compares the server's attribute string with the
 * client's, finds them unequal, and discards the whole tree.
 *
 * That is how one invisible digit in a decorative seal produced a page-wide
 * "Minified React error #418" on the homepage, with a component stack pointing
 * at the hero. Two things made it hard to see, and both are worth remembering:
 * only the sine-derived coordinates differed, because cosine happened to agree
 * for these inputs, so the diff looked arbitrary rather than systematic; and
 * React stops comparing once a subtree fails, so the components with the same
 * bug further down the page never reported it. Fixing the first one alone just
 * moves the error to the next — and on this homepage it did exactly that, onto a
 * second, unrelated cause: SVG `<title>` elements with more than one child,
 * which React's server renderer emits empty. `tests/svgTitle.test.ts` guards
 * that one. If a hydration error survives the rounding below, look there.
 *
 * Every polar coordinate in a Client Component therefore comes through here.
 *
 * What does NOT need it: plain arithmetic (`+ - * /`) is exactly specified and
 * bit-identical across engines, and a value computed once on the server and
 * serialised to the client is never recomputed — which is why `heroLayout.ts`
 * may use raw trig, and why the view-model numbers these charts read are safe.
 */
export function polarPoint(
  cx: number,
  cy: number,
  radius: number,
  angle: number,
): { x: number; y: number } {
  return {
    x: round(cx + radius * Math.cos(angle), SVG_COORD_DECIMALS),
    y: round(cy + radius * Math.sin(angle), SVG_COORD_DECIMALS),
  };
}

/**
 * Canonical form of a category name.
 *
 * Lives here rather than in `src/lib/analysis/tasteDna.ts` because two layers
 * need the SAME function and neither can afford a private copy:
 *
 *   - the analysis layer, which turns a creator's declared coverage into the
 *     opportunity-gap chart's Y axis (`coverageOf`)
 *   - the onboarding form, which builds the `coverage.saturation` record the
 *     analysis layer later looks up
 *
 * The failure mode of two implementations is silent and specifically wrong in
 * the dangerous direction. `coverageOf` falls back to "listed as covered" when a
 * saturation key misses, and "listed as covered" means coverage 1 — so a creator
 * who said "I only occasionally make sci-fi content" would be plotted as fully
 * saturated, and the untapped opportunity they were told about would disappear
 * from their own chart. Nothing errors; the result just stops being true.
 *
 * Idempotent by construction: normalising an already-normalised value is a no-op,
 * which is what lets the analysis layer normalise both sides of a comparison
 * without tracking which side was already canonical.
 *
 * Leading and trailing separators are stripped as well as collapsed, and that
 * final `.replace` is load-bearing rather than cosmetic. Without it `"film-"`
 * normalises to `"film_"` while `"film"` normalises to `"film"` — two surface
 * forms of one category disagreeing, which is the exact failure this function
 * exists to prevent, arriving through a stray hyphen instead of a stray
 * implementation. It is also what makes an all-separator string collapse to `""`
 * rather than to `"_"`, so the empty-key guard in `toAnalyzeInput` can actually
 * catch it.
 */
export function normaliseCategory(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^urn:entity:/, "")
    .replace(/[_\s-]+/g, "_")
    .replace(/^_+|_+$/g, "");
}
