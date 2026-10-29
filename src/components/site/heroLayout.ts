import { ROLE_SHAPE } from "@/lib/design/colourRoles";
import { clamp, createRandom } from "@/lib/utils/deterministic";

import type { NodeShape } from "@/lib/design/colourRoles";
import type { ColourRole, TasteNode, TasteNodeKind } from "@/lib/contracts/viewModels";

/**
 * The hero's 3D shape field, reduced to plain data (doc 01 §24, doc 05 §2 and §4).
 *
 * WHY THIS MODULE EXISTS SEPARATELY FROM THE RENDERER
 * ---------------------------------------------------
 * `HeroShapes.tsx` needs `three`, which needs a browser. Everything that decides
 * WHAT is drawn and WHERE is here instead, in a module with no DOM dependency, so
 * the composition can be asserted in `tests/heroLayout.test.ts` and built on the
 * server. The renderer's only job is to turn these numbers into meshes.
 *
 * It also keeps the client payload small. `TasteNode` carries an optional
 * `entity` payload; passing network nodes to a client component would serialise
 * it. `HeroShapeInput` is seven primitives.
 *
 * THE ARGUMENT AGAINST "GENERIC 3D SHAPES"
 * ----------------------------------------
 * Doc 01 §24 forbids generic 3D shapes in the hero. Doc 05 §2 calls abstract 3D
 * shapes "one of the most important elements of the CreatorsDNA identity", and §4
 * asks for "a memorable 3D composition made from the signature abstract shapes"
 * that may extend "around or behind the typography". Those two only reconcile if
 * the shapes are not generic — so nothing here is invented:
 *
 *   SHAPE   comes from `ROLE_SHAPE`, the same mapping the network chart, the
 *           legend and `ShapeGlyph` use. Each 3D form is picked so its SILHOUETTE
 *           is the 2D glyph: sphere→circle, torus→ring, octahedron→diamond,
 *           box→square, three-sided cone→triangle. A reader who learned the
 *           legend in a chart reads the same legend in the hero.
 *   COLOUR  comes from the `--role-*` tokens, resolved from the cascade at
 *           runtime so the dark theme is honoured (see `HeroShapes.tsx`).
 *   MATERIAL comes from the node's `kind`, below.
 *   SIZE    comes from `weight`, exactly as it drives radius in the 2D network.
 *   MEMBERSHIP comes from the real analysis: these are the same nodes
 *           `HeroComposition` draws, ranked the same way.
 *
 * So the field is the product's own legend rendered in a third dimension, not
 * decoration that happens to be 3D. If the data changes, the field changes.
 */

// ---------------------------------------------------------------------------
// Material family
// ---------------------------------------------------------------------------

export type HeroMaterial = "matte" | "gloss" | "glass";

/**
 * Material family encodes WHERE A NODE CAME FROM, which is the provenance channel
 * doc 05 §13 requires and R14 forbids spending colour on.
 *
 * The three families are the ones `globals.css` already defines token sets for
 * (`--shape-matte-*`, `--shape-gloss-*`, `--shape-glass-*`), so the 3D scene and
 * the 2D shape system are describing the same three surfaces. Doc 05 §2 warns
 * against making everything chrome, metallic or glass; mapping by kind means no
 * single family can take over unless the data is all one kind.
 *
 * - `declared_interest` → MATTE. What the creator typed. No reflection, no
 *   transparency: it is the one thing here that is not inferred.
 * - `discovered_entity` → GLASS. Retrieved from the data source. You can see
 *   through it, which is the 3D equivalent of the hollow glyph the 2D map uses
 *   for the same distinction.
 * - `derived_category` / `taste_tag` → GLOSS. Computed by us. Crisp highlight,
 *   opaque, and the sharpest of the three because it is the layer we own.
 */
const MATERIAL_BY_KIND: Record<TasteNodeKind, HeroMaterial> = {
  declared_interest: "matte",
  discovered_entity: "glass",
  derived_category: "gloss",
  taste_tag: "gloss",
};

// ---------------------------------------------------------------------------
// Composition constants
// ---------------------------------------------------------------------------

export const TAU = Math.PI * 2;

/**
 * Nothing is placed inside this radius, in normalised field space. The headline
 * and the lede sit in the middle of the hero, and a form parked directly behind
 * the largest text on the page is a form that costs contrast for no gain. The
 * field reads as a ring AROUND the typography, which is what doc 05 §4 asks for.
 */
export const INNER_RADIUS = 0.54;

/**
 * Vertical squash. The hero is much wider than it is tall, so an unsquashed ring
 * would put its top and bottom forms outside the section entirely and leave the
 * visible band empty. Squashing keeps the composition inside the hero's own
 * proportions instead of the canvas's.
 */
export const VERTICAL_SQUEEZE = 0.62;

/** How far the spiral wraps. Just under two turns: enough to interleave. */
const SPIRAL_TURNS = 1.75;

/** Radians per second at most. Anything faster stops reading as ambient. */
const MAX_SPIN = 0.16;

/**
 * How many forms the field holds on a wide viewport.
 *
 * Deliberately below `HeroComposition`'s 12-node map. That map is the thing a
 * reader studies; this field is the thing they feel behind it, and past about
 * fifteen overlapping translucent forms it stops reading as a composition and
 * starts reading as noise — and as a page that is trying too hard.
 */
export const HERO_SHAPE_LIMIT = 15;

/**
 * Reduced count for coarse pointers and narrow viewports (doc 05 §14: "On mobile,
 * simplify compositions"). The renderer builds the full set and toggles
 * `visible`, so crossing the breakpoint on resize costs nothing.
 *
 * Slicing from the front is not arbitrary: `heroShapeLayout` ranks by weight and
 * puts the strongest nearest the viewer, so the first N are the N that matter.
 */
export const HERO_SHAPE_LIMIT_COARSE = 8;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HeroShapeInput {
  id: string;
  label: string;
  role: ColourRole;
  /** Resolved from `ROLE_SHAPE`; never `undefined`, because shapeless roles are dropped. */
  shape: NodeShape;
  material: HeroMaterial;
  /** 0..1, normalised within the network. Drives size, never colour. */
  weight: number;
  crossDomain: boolean;
}

export interface HeroShapePlacement extends HeroShapeInput {
  /** Rank in the field, 0 = strongest. */
  rank: number;
  /** Horizontal position, -1 (inline-start) to 1 (inline-end). */
  u: number;
  /** Vertical position, -1 (bottom) to 1 (top), in three.js's y-up sense. */
  v: number;
  /** 0 = nearest the viewer, 1 = furthest. */
  depth: number;
  /** Relative radius before the `--shape-scale-far` depth cue is applied. */
  scale: number;
  /** Offset into the ambient float cycle, radians. */
  phase: number;
  /** Rotation speed, radians per second, signed. */
  spin: number;
  spinAxis: "x" | "y" | "z";
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

/**
 * Reduce network nodes to the forms the hero field will draw.
 *
 * Ranking is `weight` descending with `label` ascending as the tie-break — the
 * SAME ordering `HeroComposition` uses for its reduced map. That is load-bearing
 * rather than tidy: the two visuals sit side by side in one hero, and if they
 * disagreed about which nodes are strongest a reader comparing them would be
 * right to conclude one of them is arbitrary. The tie-break exists because
 * `weight` is a float, and without it two equal weights would order by whatever
 * the provider returned, so one profile could draw two different heroes on two
 * builds.
 *
 * Roles with no shape (`neutral`, `support`) are dropped rather than given a
 * default. They are chrome roles — `ROLE_SHAPE` leaves them undefined precisely so
 * that no chart can plot them as data — and letting the hero draw them as forms
 * would be the one place in the product where that rule quietly does not apply.
 */
export function heroShapeInputs(
  nodes: readonly TasteNode[],
  limit: number = HERO_SHAPE_LIMIT,
): HeroShapeInput[] {
  const ranked = [...nodes].sort(
    (a, b) => b.weight - a.weight || a.label.localeCompare(b.label),
  );

  const picked: HeroShapeInput[] = [];
  for (const node of ranked) {
    if (picked.length >= limit) break;
    const shape = ROLE_SHAPE[node.role];
    if (shape === undefined) continue;
    picked.push({
      id: node.id,
      label: node.label,
      role: node.role,
      shape,
      material: MATERIAL_BY_KIND[node.kind],
      weight: clamp(node.weight),
      crossDomain: node.crossDomain,
    });
  }
  return picked;
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

/**
 * Place the selected forms in normalised hero space.
 *
 * Positions come from a seeded PRNG over the node ids rather than from
 * `Math.random()`, for two reasons. Determinism is a stated requirement of the
 * scoring and layout layers (doc 02 §9), and a background field that rearranged
 * itself on every hydration would flicker between server and client. Seeding from
 * the ids rather than a constant means the composition is still specific to the
 * creator being shown — two different profiles get two different fields — while
 * one profile always gets the same one.
 *
 * The arrangement is a spiral, not a scatter. A scatter of fifteen translucent
 * forms behind a headline looks like noise; a spiral has a direction the eye can
 * follow, and because the strongest node starts it, that direction begins at the
 * thing the analysis actually claims is most important.
 */
export function heroShapeLayout(inputs: readonly HeroShapeInput[]): HeroShapePlacement[] {
  if (inputs.length === 0) return [];

  const random = createRandom(`creatorsdna-hero-field|${inputs.map((i) => i.id).join("|")}`);
  const last = Math.max(inputs.length - 1, 1);

  return inputs.map((input, rank) => {
    const t = rank / last;
    // Angle jitter is bounded well below one step of the spiral, so it breaks up
    // the regularity without letting two forms swap places and overlap.
    const angle = t * SPIRAL_TURNS * TAU + (random() - 0.5) * 0.5;
    const radius = INNER_RADIUS + (1 - INNER_RADIUS) * (0.3 + 0.7 * random());

    // Depth is part rank, part jitter: the strongest forms are biased near the
    // viewer, but not strictly ordered, because a field whose sizes descended in
    // perfect lockstep would read as a chart rather than a composition.
    const depth = clamp(t * 0.45 + random() * 0.55);

    return {
      ...input,
      rank,
      u: Math.cos(angle) * radius,
      v: Math.sin(angle) * radius * VERTICAL_SQUEEZE,
      depth,
      scale: 0.55 + input.weight * 0.8,
      phase: random() * TAU,
      spin: (random() * 2 - 1) * MAX_SPIN,
      // A torus spun about x or y turns edge-on and vanishes into a line, which
      // is the one failure mode that would make the `ring` silhouette — the whole
      // reason that form was chosen for `secondary` — unreadable. Rings stay in
      // their own plane and spin like a coin on a table instead.
      spinAxis: input.shape === "ring" ? "z" : random() < 0.5 ? "x" : "y",
    };
  });
}
