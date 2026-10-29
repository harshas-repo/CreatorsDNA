import type { ColourRole } from "@/lib/contracts/viewModels";
import type { Provenance } from "@/lib/contracts/domain";

/**
 * The data colour-role mapping — resolves open item R14.
 *
 * Doc 05 §12 permits choosing the mapping during implementation but requires
 * that it be DOCUMENTED and REUSED. This module is the documentation, and every
 * visualisation reads its colours through here rather than naming a token
 * directly. `globals.css` holds the values; this file holds the meaning.
 *
 * THE RULE
 * --------
 * Colour encodes SEMANTIC ROLE. Provenance is encoded SEPARATELY, by line
 * style, node shape, a dashed badge and (for synthetic data) a persistent
 * banner.
 *
 * Why not one channel for both: doc 05 §13 requires four provenance classes to
 * stay distinguishable, and §12 requires stable semantic roles across six
 * visualisations. Encoding both as colour would need 4 × 8 = 32 distinguishable
 * hues — impossible, and exactly the "arbitrary colours without a clear reason"
 * §12 warns against. Doc 05 §12 itself prescribes the fix: *"Use size, shape,
 * labels, line styles, and grouping alongside color."*
 *
 * WHAT IS DELIBERATELY ABSENT
 * ---------------------------
 * Red and green. Doc 05 §12: *"Do not use red or green alone to imply that an
 * opportunity is bad or good. Cultural fit is exploratory, not a binary
 * judgment."* No role maps to either, and no component is allowed to introduce
 * them. Error states use a distinct treatment (see `src/components/states`),
 * never a red/green contrast against data.
 */

// ---------------------------------------------------------------------------
// Role → token
// ---------------------------------------------------------------------------

/** CSS custom property holding the raw RGB channel triplet for each role. */
export const ROLE_TOKEN: Record<ColourRole, string> = {
  taste: "--role-taste",
  secondary: "--role-secondary",
  brand: "--role-brand",
  content: "--role-content",
  audience: "--role-audience",
  geo: "--role-geo",
  neutral: "--role-neutral",
  support: "--role-support",
};

/** Tailwind colour class fragment, so components can use opacity modifiers. */
export const ROLE_TAILWIND: Record<ColourRole, string> = {
  taste: "role-taste",
  secondary: "role-secondary",
  brand: "role-brand",
  content: "role-content",
  audience: "role-audience",
  geo: "role-geo",
  neutral: "role-neutral",
  support: "role-support",
};

/**
 * Resolve a role to a usable colour string for SVG `fill`/`stroke` and for CSS
 * `background`/`border`.
 *
 * Returns a `var()` reference rather than a literal hex so a theme switch (doc 01
 * §39) recolours every chart with no re-render of the data. The one consumer that
 * cannot take a `var()` is the WebGL hero, which resolves the same custom property
 * out of the cascade itself — see `ROLE_RGB`.
 */
export function roleColour(role: ColourRole, alpha?: number): string {
  const token = ROLE_TOKEN[role];
  return alpha === undefined
    ? `rgb(var(${token}))`
    : `rgb(var(${token}) / ${alpha})`;
}

/** Tailwind text/background/border class for a role. */
export function roleClass(
  role: ColourRole,
  kind: "text" | "bg" | "border" | "fill" | "stroke" = "text",
  alpha?: number,
): string {
  const base = `${kind}-${ROLE_TAILWIND[role]}`;
  return alpha === undefined ? base : `${base}/${Math.round(alpha * 100)}`;
}

/**
 * Literal RGB triplet for the two consumers that cannot ask the cascade.
 *
 * 1. `relativeLuminance` / `contrastRatio` / `inkOnRole` below. These are pure
 *    functions with no DOM, and they have to be — `src/lib/design/__tests__/`
 *    runs them under `@vitest-environment node`, which is the only way to assert
 *    a contrast floor without a browser. There is no `getComputedStyle` to ask.
 * 2. `HeroShapes.tsx`, as a FALLBACK. That component resolves role colours from
 *    the cascade at runtime, because a WebGL material cannot take a `var()` and
 *    because the dark theme re-points `--role-support`. These literals are what
 *    it uses if the custom property is missing or unparseable, so that a broken
 *    stylesheet degrades to the light palette rather than to black.
 *
 * They are therefore pinned to the LIGHT theme, and must stay that way: the
 * contrast assertions below are only meaningful against one fixed palette. A
 * theme-dependent value here would make `inkOnRole` non-deterministic.
 *
 * These MUST stay in sync with `globals.css`; the duplication is deliberate and
 * `src/lib/design/__tests__/colourRoles.test.ts` asserts the two agree.
 */
export const ROLE_RGB: Record<ColourRole, [number, number, number]> = {
  taste: [43, 73, 255],
  secondary: [123, 63, 242],
  brand: [255, 90, 60],
  content: [255, 197, 49],
  audience: [255, 61, 154],
  geo: [184, 241, 53],
  neutral: [140, 138, 148],
  support: [11, 16, 48],
};

export function resolveRoleRgb(role: ColourRole): string {
  const [r, g, b] = ROLE_RGB[role];
  return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

/** Normalised 0..1 channels, for `THREE.Color().setRGB()`. */
export function roleRgbNormalised(role: ColourRole): [number, number, number] {
  const [r, g, b] = ROLE_RGB[role];
  return [r / 255, g / 255, b / 255];
}

// ---------------------------------------------------------------------------
// Ink on a role-coloured fill
// ---------------------------------------------------------------------------

/**
 * The two inks available for drawing ON TOP of a role colour.
 *
 * These are the palette's own ivory and charcoal rather than pure white and
 * black, so a knocked-out glyph sits in the same family as the rest of the
 * interface instead of looking pasted on.
 */
export const INK_LIGHT: readonly [number, number, number] = [251, 247, 240];
export const INK_DARK: readonly [number, number, number] = [26, 26, 30];

/**
 * WCAG relative luminance of an sRGB triplet.
 *
 * Exported because the alternative to computing it is a hand-maintained table of
 * "which roles are light", and that table goes quietly wrong the first time a
 * palette value changes. Computing it means `ROLE_RGB` is the only place a colour
 * is written down — the same property the rest of this module is built around.
 */
export function relativeLuminance(rgb: readonly [number, number, number]): number {
  const [r, g, b] = rgb;
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}

function channelLuminance(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** WCAG contrast ratio, 1..21. */
export function contrastRatio(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Which ink contrasts better with a role's colour.
 *
 * This exists because a glyph drawn INSIDE a role-coloured shape has to contrast
 * with the FILL, not with the page. One ink cannot serve the palette: cobalt and
 * violet are dark enough for ivory, while sun, lime and coral are light enough
 * that ivory disappears into them. Guessing a single knockout colour produces a
 * shape family that is legible for some roles and invisible for others — and
 * because it is invisible rather than wrong-looking, nobody notices until the
 * greyscale print test.
 *
 * Note the values come from `ROLE_RGB`, which is pinned to the LIGHT palette.
 * `--role-support` is the one role re-pointed in the dark theme; it is never
 * plotted as a datum (`ROLE_SHAPE.support` is `undefined`), so it never asks for
 * a knockout and the divergence cannot reach this function.
 */
export function inkOnRole(role: ColourRole): "light" | "dark" {
  const fill = ROLE_RGB[role];
  return contrastRatio(fill, INK_LIGHT) >= contrastRatio(fill, INK_DARK) ? "light" : "dark";
}

/** Ink as a CSS colour, for the rare case that needs it inline. */
export function inkColourOnRole(role: ColourRole): string {
  return inkOnRole(role) === "light" ? "rgb(var(--color-ivory))" : "rgb(var(--color-charcoal))";
}

// ---------------------------------------------------------------------------
// Role meanings (the documented mapping itself)
// ---------------------------------------------------------------------------

export const ROLE_MEANING: Record<ColourRole, { label: string; usedFor: string }> = {
  taste: {
    label: "Your taste",
    usedFor: "Creator-declared signals and the core Taste DNA spine.",
  },
  secondary: {
    label: "Discovered affinity",
    usedFor: "Cultural affinities surfaced by the data source rather than declared.",
  },
  brand: {
    label: "Brands",
    usedFor: "Registry brands, brand-fit scores and partnership opportunities.",
  },
  content: {
    label: "Content",
    usedFor: "Content categories, coverage and the creator's own output.",
  },
  audience: {
    label: "Audience",
    usedFor: "Demographic deltas and audience-shape comparisons.",
  },
  geo: {
    label: "Geography",
    usedFor: "Location signals and regional breakdowns.",
  },
  neutral: {
    label: "Structure",
    usedFor: "Axes, gridlines and chrome. Never carries meaning of its own.",
  },
  support: {
    label: "Emphasis",
    usedFor: "Highlights, selection outlines and the currently focused element.",
  },
};

// ---------------------------------------------------------------------------
// Role → redundant shape encoding
// ---------------------------------------------------------------------------

/**
 * Shape per role, so colour is never the only channel (doc 05 §11).
 *
 * Five shapes for eight roles, and the arithmetic works out because not every
 * role is ever plotted as a datum:
 *
 *   - `neutral` is chrome (axes, gridlines) and `support` is an emphasis overlay
 *     drawn AROUND another node. Neither is a point in a legend, so both are
 *     `undefined` here rather than borrowing a shape they will never use.
 *   - `audience` and `geo` share `triangle`. They appear in score breakdowns and
 *     geographic panels, never as node kinds in the same graph, so the collision
 *     is not reachable. If a future visualisation plots both as nodes, add a
 *     sixth shape rather than relying on this note.
 */
export const ROLE_SHAPE: Record<ColourRole, NodeShape | undefined> = {
  taste: "circle",
  secondary: "ring",
  brand: "diamond",
  content: "square",
  audience: "triangle",
  geo: "triangle",
  neutral: undefined,
  support: undefined,
};

// ---------------------------------------------------------------------------
// Provenance → non-colour encoding
// ---------------------------------------------------------------------------

export type NodeShape = "circle" | "square" | "diamond" | "triangle" | "ring";

export interface ProvenanceStyle {
  /** Short label rendered next to the value. */
  label: string;
  /** SVG `stroke-dasharray`. `none` = solid. */
  dash: string;
  /**
   * The CSS `border-style` equivalent of `dash`.
   *
   * SVG strokes and HTML borders cannot share one property, so without this an
   * HTML component has to derive its own border style from `dash` — and every
   * component that does so is a chance for a chip to read "dashed" while the
   * chart line next to it reads "dotted" for the same provenance. Keeping the
   * pair in one table is what makes the encoding one system rather than two
   * that happen to agree today.
   *
   * `dash: "2 4"` is a dotted rhythm, so synthetic is `dotted`: derived and
   * synthetic stay distinguishable in HTML exactly as they do in SVG.
   */
  borderStyle: "solid" | "dashed" | "dotted";
  /** Redundant shape encoding for graph nodes. */
  shape: NodeShape;
  /** Badge modifier class, defined in globals.css. */
  badgeClass: string;
  /** One-line explanation for tooltips and the methodology panel. */
  description: string;
}

/**
 * Provenance styling (doc 05 §13's four classes).
 *
 * Synthetic gets BOTH a dash and a hatched badge background so it survives
 * greyscale printing, colour-vision deficiency and a cropped screenshot. That is
 * the point: a synthetic value must not be mistakable for a Qloo discovery even
 * when every other cue has been stripped away.
 */
export const PROVENANCE_STYLE: Record<Provenance, ProvenanceStyle> = {
  qloo: {
    label: "Qloo",
    dash: "none",
    borderStyle: "solid",
    shape: "circle",
    badgeClass: "cd-provenance--qloo",
    description: "Returned directly by the cultural data source.",
  },
  creator: {
    label: "You",
    dash: "none",
    borderStyle: "solid",
    shape: "square",
    badgeClass: "cd-provenance--creator",
    description: "Provided by you during onboarding.",
  },
  derived: {
    label: "CreatorsDNA",
    dash: "6 4",
    borderStyle: "dashed",
    shape: "diamond",
    badgeClass: "cd-provenance--derived",
    description: "Calculated by CreatorsDNA from the inputs shown, using the documented method.",
  },
  synthetic: {
    label: "Illustrative",
    dash: "2 4",
    borderStyle: "dotted",
    shape: "triangle",
    badgeClass: "cd-provenance--synthetic",
    description:
      "Generated development data. Not a real result — shown so the interface can be evaluated before live data is connected.",
  },
};

export function provenanceStyle(provenance: Provenance): ProvenanceStyle {
  return PROVENANCE_STYLE[provenance];
}

/** Edge dash pattern for a provenance class. */
export function provenanceDash(provenance: Provenance): string | undefined {
  const dash = PROVENANCE_STYLE[provenance].dash;
  return dash === "none" ? undefined : dash;
}

/** CSS border style for a provenance class — the HTML counterpart of `provenanceDash`. */
export function provenanceBorderStyle(provenance: Provenance): ProvenanceStyle["borderStyle"] {
  return PROVENANCE_STYLE[provenance].borderStyle;
}

// ---------------------------------------------------------------------------
// Node-count strategy (doc 05 §11, fact F21)
// ---------------------------------------------------------------------------

export type NodeCountStrategy = "full" | "filter" | "group" | "list";

/**
 * Progressive-disclosure thresholds for the network visualisations.
 *
 * A Qloo result set can hold up to 50 entities per call (doc 03 §4) and the
 * Taste DNA aggregates across several calls, so a naive render can easily exceed
 * a hundred nodes. Doc 05 §11 requires filtering, grouping, progressive
 * disclosure and a graph/list switch rather than "draw everything smaller".
 *
 * Values mirror the `--node-count-*` tokens in globals.css.
 */
export const NODE_COUNT_LIMITS = {
  full: 24,
  group: 60,
  paginate: 120,
} as const;

export function nodeCountStrategy(nodeCount: number): NodeCountStrategy {
  if (nodeCount <= NODE_COUNT_LIMITS.full) return "full";
  if (nodeCount <= NODE_COUNT_LIMITS.group) return "filter";
  if (nodeCount <= NODE_COUNT_LIMITS.paginate) return "group";
  return "list";
}

// ---------------------------------------------------------------------------
// Human-readable documentation of the mapping
// ---------------------------------------------------------------------------

/**
 * Rendered in the app's methodology panel so the mapping is documented to users,
 * not only to developers (doc 05 §12: "documented and reused").
 */
export function describeColourSystem(): string {
  const roles = (Object.keys(ROLE_MEANING) as ColourRole[])
    .map((role) => `${ROLE_MEANING[role].label} — ${ROLE_MEANING[role].usedFor}`)
    .join("\n");
  const provenance = (Object.keys(PROVENANCE_STYLE) as Provenance[])
    .map((key) => `${PROVENANCE_STYLE[key].label} — ${PROVENANCE_STYLE[key].description}`)
    .join("\n");
  return [
    "Colour shows WHAT a value is about:",
    roles,
    "",
    "Line style and shape show WHERE it came from:",
    provenance,
    "",
    "Red and green are never used to imply good or bad. Cultural fit is exploratory, not a verdict.",
  ].join("\n");
}
