// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  HERO_SHAPE_LIMIT,
  HERO_SHAPE_LIMIT_COARSE,
  INNER_RADIUS,
  TAU,
  VERTICAL_SQUEEZE,
  heroShapeInputs,
  heroShapeLayout,
} from "@/components/site/heroLayout";
import { ROLE_SHAPE } from "@/lib/design/colourRoles";
import { exampleAnalysis } from "@/lib/demo/exampleAnalysis";

import type { HeroShapeInput } from "@/components/site/heroLayout";
import type { ColourRole, TasteNode, TasteNodeKind } from "@/lib/contracts/viewModels";

/**
 * The hero's 3D shape field, asserted as data.
 *
 * The renderer cannot be tested here — it needs a GL context — so everything
 * that decides WHAT is drawn and WHERE lives in `heroLayout.ts`, and this is the
 * suite that holds it to its promises. Three of those promises are worth naming,
 * because each has a specific and reachable way of failing silently:
 *
 * 1. DETERMINISM. The composition is built on the server and re-read on every
 *    client mount. A layout that varied between them would flicker, and one that
 *    varied between builds would make the hero untestable and unreproducible.
 * 2. THE LEGEND SURVIVES. Every form's shape comes from `ROLE_SHAPE` and every
 *    material from the node's `kind`. If either mapping drifted, the hero would
 *    start contradicting the charts sitting next to it — and because it is a
 *    background layer, nobody would notice the contradiction, only that the page
 *    felt less coherent.
 * 3. THE CENTRE STAYS CLEAR. `INNER_RADIUS` is what stops a translucent form
 *    parking behind the largest text on the page. That is a contrast guarantee
 *    expressed as geometry, so it gets asserted as geometry.
 */

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Roles `ROLE_SHAPE` gives a form to. The other two are chrome, never data. */
const PLOTTED = (Object.keys(ROLE_SHAPE) as ColourRole[]).filter(
  (role) => ROLE_SHAPE[role] !== undefined,
);
const SHAPELESS = (Object.keys(ROLE_SHAPE) as ColourRole[]).filter(
  (role) => ROLE_SHAPE[role] === undefined,
);

function node(id: string, label: string, overrides: Partial<TasteNode> = {}): TasteNode {
  return {
    id,
    label,
    role: "taste",
    provenance: "creator",
    kind: "declared_interest",
    weight: 0.5,
    crossDomain: false,
    ...overrides,
  };
}

function input(id: string, overrides: Partial<HeroShapeInput> = {}): HeroShapeInput {
  return {
    id,
    label: id,
    role: "taste",
    shape: "circle",
    material: "matte",
    weight: 0.5,
    crossDomain: false,
    ...overrides,
  };
}

/** A field spanning every plotted role and every material family. */
function mixedNodes(count: number): TasteNode[] {
  return Array.from({ length: count }, (_, index) =>
    node(`n${index}`, `Node ${index}`, {
      role: PLOTTED[index % PLOTTED.length] ?? "taste",
      kind: (["declared_interest", "discovered_entity", "derived_category", "taste_tag"] as const)[
        index % 4
      ] as TasteNodeKind,
      weight: 1 - index / (count + 1),
      crossDomain: index % 3 === 0,
    }),
  );
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

describe("heroShapeInputs", () => {
  it("returns nothing for an empty network", () => {
    expect(heroShapeInputs([], 10)).toEqual([]);
  });

  it("drops roles that have no shape, rather than giving them a default", () => {
    expect(SHAPELESS.length).toBeGreaterThan(0);
    const nodes = SHAPELESS.map((role, index) => node(`s${index}`, `Chrome ${index}`, { role }));
    expect(heroShapeInputs(nodes, 10)).toEqual([]);
  });

  it("does not let a shapeless node consume a slot in the limit", () => {
    // The strongest node here is chrome. If the limit were applied before the
    // shape filter, the field would come back one form short — and would do so
    // silently, because a missing background form looks like art direction.
    const nodes = [
      node("chrome", "Editorial", { role: "neutral", weight: 0.99 }),
      node("a", "Velvet", { weight: 0.6 }),
      node("b", "Coffee", { weight: 0.4 }),
    ];
    const picked = heroShapeInputs(nodes, 2);
    expect(picked.map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("ranks by weight descending", () => {
    const nodes = [
      node("low", "Low", { weight: 0.1 }),
      node("high", "High", { weight: 0.9 }),
      node("mid", "Mid", { weight: 0.5 }),
    ];
    expect(heroShapeInputs(nodes, 10).map((p) => p.id)).toEqual(["high", "mid", "low"]);
  });

  it("breaks weight ties by label, so one profile cannot draw two heroes", () => {
    // `weight` is a float normalised within a set, and two nodes can land on the
    // same value. Without the tie-break the order would come from the provider,
    // which is not a stable source. Ids match labels here on purpose: the input
    // order and the expected output order are then readable against each other.
    const nodes = [
      node("zebra", "Zebra", { weight: 0.5 }),
      node("apple", "Apple", { weight: 0.5 }),
      node("mango", "Mango", { weight: 0.5 }),
    ];
    expect(heroShapeInputs(nodes, 10).map((p) => p.id)).toEqual(["apple", "mango", "zebra"]);
  });

  it("respects an explicit limit and defaults to HERO_SHAPE_LIMIT", () => {
    const nodes = mixedNodes(40);
    expect(heroShapeInputs(nodes, 3)).toHaveLength(3);
    expect(heroShapeInputs(nodes)).toHaveLength(HERO_SHAPE_LIMIT);
    expect(heroShapeInputs(nodes, 0)).toEqual([]);
  });

  it("asks for more forms on desktop than it shows on a coarse pointer", () => {
    // The renderer slices from the front, so this ordering is what makes the
    // reduced mobile field a subset of the desktop one rather than a different
    // composition. If it were ever inverted, a phone would drop the strongest
    // forms and keep the weakest.
    expect(HERO_SHAPE_LIMIT_COARSE).toBeLessThan(HERO_SHAPE_LIMIT);
  });

  it.each([
    ["declared_interest", "matte"],
    ["discovered_entity", "glass"],
    ["derived_category", "gloss"],
    ["taste_tag", "gloss"],
  ] as const)("gives %s the %s material", (kind, material) => {
    const picked = heroShapeInputs([node("x", "X", { kind })], 1);
    expect(picked[0]?.material).toBe(material);
  });

  it("takes every shape from ROLE_SHAPE, never from its own table", () => {
    const nodes = PLOTTED.map((role, index) => node(`r${index}`, `Role ${index}`, { role }));
    const picked = heroShapeInputs(nodes, PLOTTED.length);
    expect(picked).toHaveLength(PLOTTED.length);
    for (const form of picked) {
      expect(form.shape).toBe(ROLE_SHAPE[form.role]);
    }
  });

  it("clamps a weight the provider sent out of range", () => {
    const picked = heroShapeInputs(
      [node("over", "Over", { weight: 4 }), node("under", "Under", { weight: -2 })],
      2,
    );
    expect(picked.map((p) => p.weight)).toEqual([1, 0]);
  });

  it("carries the cross-domain flag through, which is the field's one non-role datum", () => {
    const picked = heroShapeInputs([node("x", "X", { crossDomain: true })], 1);
    expect(picked[0]?.crossDomain).toBe(true);
  });

  it("does not reorder the caller's array", () => {
    const nodes = [node("low", "Low", { weight: 0.1 }), node("high", "High", { weight: 0.9 })];
    heroShapeInputs(nodes, 2);
    expect(nodes.map((n) => n.id)).toEqual(["low", "high"]);
  });
});

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

describe("heroShapeLayout", () => {
  const inputs = mixedNodes(12).flatMap((n) => heroShapeInputs([n], 1));

  it("returns nothing for nothing, and does not seed a PRNG on an empty list", () => {
    expect(heroShapeLayout([])).toEqual([]);
  });

  it("is deterministic — the same inputs lay out identically every time", () => {
    expect(heroShapeLayout(inputs)).toEqual(heroShapeLayout(inputs));
  });

  it("is data-dependent — different ids produce a different composition", () => {
    // Guards the other failure mode of a seeded layout: a seed that ignores its
    // input would be deterministic AND identical for every creator, which is the
    // "generic 3D shapes" outcome doc 01 §24 forbids, arrived at through the seed
    // rather than through the geometry.
    const other = inputs.map((form) => ({ ...form, id: `other-${form.id}` }));
    expect(heroShapeLayout(other)).not.toEqual(heroShapeLayout(inputs));
  });

  it("keeps rank order and carries every input field through", () => {
    const laid = heroShapeLayout(inputs);
    expect(laid).toHaveLength(inputs.length);
    laid.forEach((placement, index) => {
      expect(placement.rank).toBe(index);
      const source = inputs[index];
      expect(source).toBeDefined();
      expect(placement.id).toBe(source?.id);
      expect(placement.role).toBe(source?.role);
      expect(placement.shape).toBe(source?.shape);
      expect(placement.material).toBe(source?.material);
      expect(placement.weight).toBe(source?.weight);
    });
  });

  it("places every form inside the normalised field and at a usable depth", () => {
    for (const placement of heroShapeLayout(inputs)) {
      expect(Math.abs(placement.u)).toBeLessThanOrEqual(1);
      expect(Math.abs(placement.v)).toBeLessThanOrEqual(1);
      expect(placement.depth).toBeGreaterThanOrEqual(0);
      expect(placement.depth).toBeLessThanOrEqual(1);
      expect(placement.scale).toBeGreaterThan(0);
      expect(placement.phase).toBeGreaterThanOrEqual(0);
      expect(placement.phase).toBeLessThan(TAU);
      expect(Number.isFinite(placement.spin)).toBe(true);
      // Deliberately looser than the module's own constant: this asserts the
      // property that matters (ambient, not animated) rather than pinning an
      // art-direction number that should be free to change.
      expect(Math.abs(placement.spin)).toBeLessThan(0.5);
    }
  });

  it("keeps the centre of the hero clear of forms", () => {
    // The headline and lede sit there. `v` is squashed by `VERTICAL_SQUEEZE`, so
    // unsquashing it recovers the true polar radius, which the layout guarantees
    // is at least `INNER_RADIUS`. This is the contrast guarantee expressed as
    // geometry, and it is the one assertion in this file that a change to the
    // composition could break without any test about shapes noticing.
    for (const placement of heroShapeLayout(inputs)) {
      const radius = Math.hypot(placement.u, placement.v / VERTICAL_SQUEEZE);
      expect(radius).toBeGreaterThanOrEqual(INNER_RADIUS - 1e-9);
    }
  });

  it("biases the strongest forms toward the viewer", () => {
    const laid = heroShapeLayout(inputs);
    const third = Math.max(Math.floor(laid.length / 3), 1);
    const mean = (slice: readonly { depth: number }[]): number =>
      slice.reduce((total, p) => total + p.depth, 0) / slice.length;
    // Averages rather than a per-index comparison, because depth is part rank and
    // part jitter by design: a strictly ordered field would read as a chart.
    expect(mean(laid.slice(0, third))).toBeLessThan(mean(laid.slice(-third)));
  });

  it("scales forms with weight, so size still means importance in 3D", () => {
    const laid = heroShapeLayout([
      input("heavy", { weight: 1 }),
      input("light", { weight: 0 }),
    ]);
    const heavy = laid.find((p) => p.id === "heavy");
    const light = laid.find((p) => p.id === "light");
    expect(heavy).toBeDefined();
    expect(light).toBeDefined();
    expect(heavy?.scale).toBeGreaterThan(light?.scale ?? 0);
  });

  it("spins rings in their own plane, so the ring silhouette never collapses to a line", () => {
    // A torus turned edge-on is a thin stroke, and `ring` is the whole encoding
    // for the `secondary` role. This is the one shape whose axis is not free.
    const rings = heroShapeLayout(
      Array.from({ length: 8 }, (_, index) =>
        input(`ring${index}`, { role: "secondary", shape: "ring" }),
      ),
    );
    expect(rings).toHaveLength(8);
    for (const ring of rings) {
      expect(ring.spinAxis).toBe("z");
    }
  });

  it("gives non-ring shapes a real axis to turn on", () => {
    const axes = new Set(
      heroShapeLayout(inputs)
        .filter((p) => p.shape !== "ring")
        .map((p) => p.spinAxis),
    );
    for (const axis of axes) {
      expect(["x", "y", "z"]).toContain(axis);
    }
    expect(axes.has("z")).toBe(false);
  });

  it("lays out a single form without dividing by zero", () => {
    const laid = heroShapeLayout([input("only")]);
    expect(laid).toHaveLength(1);
    const only = laid[0];
    expect(only).toBeDefined();
    expect(Number.isFinite(only?.u)).toBe(true);
    expect(Number.isFinite(only?.v)).toBe(true);
    expect(Number.isFinite(only?.depth)).toBe(true);
  });

  it("uses more than one shape family, so the field is a legend and not a set of spheres", () => {
    const shapes = new Set(heroShapeLayout(inputs).map((p) => p.shape));
    expect(shapes.size).toBeGreaterThan(2);
    for (const shape of shapes) {
      expect(["circle", "ring", "diamond", "square", "triangle"]).toContain(shape);
    }
  });

  it("uses more than one material family, per doc 05 §2's warning against one finish", () => {
    const materials = new Set(heroShapeLayout(inputs).map((p) => p.material));
    expect(materials.size).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// The real analysis
// ---------------------------------------------------------------------------

describe("the hero field over the real example analysis", () => {
  it("is built from nodes that actually exist in the network", async () => {
    const { analysis } = await exampleAnalysis();
    const laid = heroShapeLayout(heroShapeInputs(analysis.network.nodes, HERO_SHAPE_LIMIT));
    const ids = new Set(analysis.network.nodes.map((n) => n.id));

    expect(laid.length).toBeGreaterThan(0);
    expect(laid.length).toBeLessThanOrEqual(HERO_SHAPE_LIMIT);
    for (const placement of laid) {
      expect(ids.has(placement.id)).toBe(true);
      expect(ROLE_SHAPE[placement.role]).toBe(placement.shape);
    }
  });

  it("has no duplicate forms", async () => {
    const { analysis } = await exampleAnalysis();
    const laid = heroShapeLayout(heroShapeInputs(analysis.network.nodes, HERO_SHAPE_LIMIT));
    expect(new Set(laid.map((p) => p.id)).size).toBe(laid.length);
  });

  it("leads with the strongest plotted node, agreeing with the map beside it", async () => {
    // `HeroComposition` ranks its reduced map the same way. The two sit in one
    // hero; if they disagreed about which node matters most, a reader comparing
    // them would be right to conclude one of them is arbitrary.
    const { analysis } = await exampleAnalysis();
    const plotted = analysis.network.nodes.filter((n) => ROLE_SHAPE[n.role] !== undefined);
    expect(plotted.length).toBeGreaterThan(0);
    // Sorted with the SAME comparator `heroShapeInputs` uses, including the label
    // tie-break. Picking the maximum with a reduce would silently disagree on a
    // tie and make this test depend on the provider's array order.
    const strongest = [...plotted].sort(
      (a, b) => b.weight - a.weight || a.label.localeCompare(b.label),
    )[0];
    expect(strongest).toBeDefined();

    const laid = heroShapeLayout(heroShapeInputs(analysis.network.nodes, HERO_SHAPE_LIMIT));
    expect(laid[0]?.id).toBe(strongest?.id);
    expect(laid[0]?.weight).toBe(strongest?.weight);
  });

  it("contains a declared-interest form, so the material encoding is exercised and not theoretical", async () => {
    const { analysis } = await exampleAnalysis();
    const laid = heroShapeLayout(heroShapeInputs(analysis.network.nodes, HERO_SHAPE_LIMIT));
    expect(laid.some((p) => p.material === "matte")).toBe(true);
  });

  it("stays deterministic across two separate pipeline runs", async () => {
    // A stronger claim than running the layout twice on one input: the analysis
    // itself is memoised per process, so this asserts that the memo holds and
    // that nothing in the reduction depends on iteration order of a Map or Set.
    const first = await exampleAnalysis();
    const second = await exampleAnalysis();
    const a = heroShapeLayout(heroShapeInputs(first.analysis.network.nodes, HERO_SHAPE_LIMIT));
    const b = heroShapeLayout(heroShapeInputs(second.analysis.network.nodes, HERO_SHAPE_LIMIT));
    expect(a).toEqual(b);
  });
});
