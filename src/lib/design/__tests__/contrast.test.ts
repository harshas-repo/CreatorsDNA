// @vitest-environment node
// Pure arithmetic over exported constants. No DOM, no stylesheet, no React — and
// jsdom would only slow collection down.

import { describe, expect, it } from "vitest";

import {
  INK_DARK,
  INK_LIGHT,
  ROLE_RGB,
  ROLE_SHAPE,
  contrastRatio,
  inkColourOnRole,
  inkOnRole,
  relativeLuminance,
} from "@/lib/design/colourRoles";
import type { ColourRole } from "@/lib/contracts/viewModels";

/**
 * Contrast, and the knockout-ink choice that depends on it.
 *
 * `inkOnRole` decides what colour a glyph is drawn in when it sits INSIDE a
 * role-coloured shape. That decision is invisible when it is right and invisible
 * when it is wrong: an ivory mark on a sun-yellow fill does not look like a bug,
 * it looks like an empty node, and the only way to find out is the greyscale
 * print test somebody eventually runs on a media kit.
 *
 * So the suite pins three separate things, in increasing order of how much they
 * matter:
 *
 *   1. the arithmetic is the WCAG arithmetic, checked against values that can be
 *      derived by hand rather than against another implementation
 *   2. `inkOnRole` really does pick the better of the two inks, rather than
 *      happening to return a plausible answer for this palette
 *   3. every role that can be plotted as a datum clears the contrast floor with
 *      the ink chosen for it — the property the shape family is built on
 */

/** WCAG 1.4.11, non-text contrast: the floor for a graphical object. */
const NON_TEXT_AA = 3;
/** WCAG 1.4.3, normal text: not required of a node glyph, but currently met. */
const TEXT_AA = 4.5;

const BLACK: readonly [number, number, number] = [0, 0, 0];
const WHITE: readonly [number, number, number] = [255, 255, 255];
const PURE_RED: readonly [number, number, number] = [255, 0, 0];

const ROLES = Object.keys(ROLE_RGB) as ColourRole[];

/** Roles that can appear as a datum, i.e. the ones that ever need a knockout. */
const PLOTTED = ROLES.filter((role) => ROLE_SHAPE[role] !== undefined);

const INKS: ReadonlyArray<{ name: string; rgb: readonly [number, number, number] }> = [
  { name: "ivory", rgb: INK_LIGHT },
  { name: "charcoal", rgb: INK_DARK },
];

function inkFor(role: ColourRole): readonly [number, number, number] {
  return inkOnRole(role) === "light" ? INK_LIGHT : INK_DARK;
}

// ---------------------------------------------------------------------------
// 1. The arithmetic is WCAG's
// ---------------------------------------------------------------------------

describe("relativeLuminance", () => {
  it("returns 0 for black and 1 for white", () => {
    expect(relativeLuminance(BLACK)).toBeCloseTo(0, 12);
    expect(relativeLuminance(WHITE)).toBeCloseTo(1, 12);
  });

  it("weights the green channel hardest, per the sRGB coefficients", () => {
    // 0.2126 + 0.7152 + 0.0722 = 1, so a pure primary's luminance IS its own
    // coefficient. Asserting the coefficient rather than a table means a change
    // to the formula fails here instead of silently re-ranking the palette.
    expect(relativeLuminance(PURE_RED)).toBeCloseTo(0.2126, 10);
    expect(relativeLuminance([0, 255, 0])).toBeCloseTo(0.7152, 10);
    expect(relativeLuminance([0, 0, 255])).toBeCloseTo(0.0722, 10);
  });

  it("is continuous across the linear/power seam", () => {
    // The piecewise transfer function switches at c = 0.03928, i.e. channel value
    // ~10.02. A wrong exponent or a missing branch shows up as a step there, and
    // a step is exactly what "close to its neighbours" rules out.
    const below = relativeLuminance([10, 10, 10]);
    const above = relativeLuminance([11, 11, 11]);
    expect(above).toBeGreaterThan(below);
    expect(above - below).toBeLessThan(0.004);
  });
});

describe("contrastRatio", () => {
  it("spans exactly 1 to 21", () => {
    expect(contrastRatio(BLACK, WHITE)).toBeCloseTo(21, 10);
    expect(contrastRatio(WHITE, WHITE)).toBe(1);
    expect(contrastRatio(PURE_RED, PURE_RED)).toBe(1);
  });

  it("is symmetric — argument order cannot change a legibility verdict", () => {
    for (const role of ROLES) {
      for (const ink of INKS) {
        expect(contrastRatio(ROLE_RGB[role], ink.rgb)).toBeCloseTo(
          contrastRatio(ink.rgb, ROLE_RGB[role]),
          12,
        );
      }
    }
  });

  it("stays inside the WCAG range for every palette pair", () => {
    for (const role of ROLES) {
      for (const ink of INKS) {
        const ratio = contrastRatio(ROLE_RGB[role], ink.rgb);
        expect(ratio).toBeGreaterThanOrEqual(1);
        expect(ratio).toBeLessThanOrEqual(21);
      }
    }
  });

  it("agrees with a hand-derived value", () => {
    // Red on black: (0.2126 + 0.05) / (0 + 0.05) = 5.252. Written out rather than
    // computed the same way the implementation does it, which is the only thing
    // that makes this a check rather than a restatement.
    expect(contrastRatio(PURE_RED, BLACK)).toBeCloseTo((0.2126 + 0.05) / 0.05, 10);
  });
});

// ---------------------------------------------------------------------------
// 2. The choice is really a choice
// ---------------------------------------------------------------------------

describe("inkOnRole", () => {
  it.each(ROLES)("picks the higher-contrast ink for %s", (role) => {
    const chosen = contrastRatio(ROLE_RGB[role], inkFor(role));
    const other = contrastRatio(
      ROLE_RGB[role],
      inkOnRole(role) === "light" ? INK_DARK : INK_LIGHT,
    );
    expect(chosen).toBeGreaterThanOrEqual(other);
  });

  it("uses both inks — the palette is genuinely split", () => {
    // The doc comment claims cobalt and violet take ivory while sun, lime, coral
    // and magenta take charcoal. Pinning the membership means a palette tweak
    // that flips a role fails here, next to the claim it contradicts, instead of
    // showing up as an unreadable node six months later.
    const light = PLOTTED.filter((role) => inkOnRole(role) === "light");
    const dark = PLOTTED.filter((role) => inkOnRole(role) === "dark");
    expect(light).toEqual(["taste", "secondary"]);
    expect(dark).toEqual(["brand", "content", "audience", "geo"]);
  });

  it("never returns a literal colour, only a token reference", () => {
    // Same rule the rest of the module holds: a hex in JS is a second copy of the
    // palette that the cascade cannot reach. `inkColourOnRole` is for inline
    // styles, so it must still go through a custom property.
    for (const role of ROLES) {
      const colour = inkColourOnRole(role);
      expect(colour).toMatch(/^rgb\(var\(--color-(ivory|charcoal)\)\)$/);
      expect(colour.includes("#")).toBe(false);
    }
  });

  it("agrees with inkOnRole", () => {
    for (const role of ROLES) {
      const expected = inkOnRole(role) === "light" ? "--color-ivory" : "--color-charcoal";
      expect(inkColourOnRole(role)).toContain(expected);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. The floor every plotted role has to clear
// ---------------------------------------------------------------------------

describe("every plotted role is legible with its knockout ink", () => {
  it.each(PLOTTED)("clears non-text AA contrast for %s", (role) => {
    const ratio = contrastRatio(ROLE_RGB[role], inkFor(role));
    expect(
      ratio,
      `${role} with ${inkOnRole(role)} ink measures ${ratio.toFixed(2)}:1 — a glyph drawn ` +
        `inside this fill would not be distinguishable from it. Darken or lighten the ` +
        `role token; do not lower this floor.`,
    ).toBeGreaterThanOrEqual(NON_TEXT_AA);
  });

  it("has headroom above the requirement, and the worst case is recorded", () => {
    // Not a requirement — a tripwire. The palette currently clears AA-for-text
    // everywhere, so the day a role drops to 3.4:1 the shape family has already
    // lost quality that nobody asked for. Failing on headroom rather than on the
    // floor turns a slow visual regression into a single reviewable diff.
    const worst = PLOTTED.reduce<{ role: ColourRole; ratio: number }>(
      (lowest, role) => {
        const ratio = contrastRatio(ROLE_RGB[role], inkFor(role));
        return ratio < lowest.ratio ? { role, ratio } : lowest;
      },
      { role: PLOTTED[0]!, ratio: Number.POSITIVE_INFINITY },
    );

    expect(
      worst.ratio,
      `${worst.role} is now the weakest knockout at ${worst.ratio.toFixed(2)}:1`,
    ).toBeGreaterThanOrEqual(TEXT_AA);
  });

  it("never asks for a knockout on a chrome-only role", () => {
    // `neutral` and `support` are axes, gridlines and emphasis. Nothing is drawn
    // inside them, so `ROLE_SHAPE` leaves them undefined and the contrast floor
    // does not apply. Asserting the two sets are disjoint keeps that reasoning
    // true rather than merely current.
    const chrome = ROLES.filter((role) => ROLE_SHAPE[role] === undefined);
    expect(chrome.length).toBeGreaterThan(0);
    expect(PLOTTED.filter((role) => chrome.includes(role))).toEqual([]);
  });
});
