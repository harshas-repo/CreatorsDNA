// @vitest-environment node
import { describe, expect, it } from "vitest";

import { SVG_COORD_DECIMALS, polarPoint, round } from "@/lib/utils/deterministic";

/**
 * `polarPoint` and `round` — the two functions that keep SVG coordinates stable
 * between the server render and hydration.
 *
 * This suite exists because of a specific and non-obvious production bug. The
 * homepage failed to hydrate ("Minified React error #418") and the entire tree
 * was regenerated on the client. The cause was one digit: `Math.sin` is
 * "implementation-approximated" per ECMA-262, Node's V8 returned
 * `40.432019981633765` where the browser's returned `40.43201998163376`, and
 * React compares those as attribute strings.
 *
 * The obvious way to write this suite would assert that `polarPoint` rounds, and
 * that assertion would keep passing if the rounding were made fine enough to be
 * useless. So the two properties that actually matter are tested directly: that
 * a one-ULP change in the input cannot change the output, and that the precision
 * is still far below anything visible.
 */

// ---------------------------------------------------------------------------
// round
// ---------------------------------------------------------------------------

describe("round", () => {
  it("defaults to four decimals", () => {
    expect(round(1.23456789)).toBe(1.2346);
  });

  it("takes an explicit precision", () => {
    expect(round(40.432019981633765, 3)).toBe(40.432);
    expect(round(2.5, 0)).toBe(3);
  });

  it("maps the two V8 results from the original bug onto one value", () => {
    // The exact pair observed in the failing homepage: the server's sine and the
    // browser's, one ULP apart. If this ever stops holding, the bug is back.
    expect(round(40.432019981633765, SVG_COORD_DECIMALS)).toBe(
      round(40.43201998163376, SVG_COORD_DECIMALS),
    );
    expect(round(33.64435183257187, SVG_COORD_DECIMALS)).toBe(
      round(33.644351832571864, SVG_COORD_DECIMALS),
    );
  });

  it("clears the floating-point dust that would otherwise be emitted verbatim", () => {
    // `Math.cos(Math.PI / 2)` is not 0, it is 6.123233995736766e-17. Unrounded,
    // that is what lands in the SVG as `x="6.123233995736766e-17"` — legal, but
    // twenty-odd characters of noise in every payload, for a coordinate that is
    // zero. Rounding is a size win as well as a correctness one.
    expect(round(6.123233995736766e-17, SVG_COORD_DECIMALS)).toBe(0);
  });

  it("is idempotent", () => {
    const once = round(Math.PI, SVG_COORD_DECIMALS);
    expect(round(once, SVG_COORD_DECIMALS)).toBe(once);
  });
});

// ---------------------------------------------------------------------------
// polarPoint
// ---------------------------------------------------------------------------

/** The smallest double strictly greater than `value`. */
function nextUp(value: number): number {
  const bits = new Float64Array(1);
  const view = new BigUint64Array(bits.buffer);
  bits[0] = value;
  // IEEE-754 bit patterns increase with the value above zero and DECREASE with
  // it below zero, so the sign decides the direction. Getting this backwards
  // would make every assertion below pass trivially.
  //
  // Both `??` fallbacks are unreachable — the arrays have exactly one element
  // by construction — and exist only for `noUncheckedIndexedAccess`. Falling back
  // to `value` rather than throwing is deliberate: it would make the
  // `nextUp(angle) !== angle` assertion below fail, so a silent no-op cannot slip
  // through as a passing test.
  view[0] = (view[0] ?? 0n) + (value >= 0 ? 1n : -1n);
  return bits[0] ?? value;
}

/** The seal's own angles: 48 spokes, exactly as `buildTicks` generates them. */
const SEAL_ANGLES = Array.from(
  { length: 48 },
  (_, index) => (Math.PI * 2 * index) / 48 - Math.PI / 2,
);

describe("polarPoint", () => {
  it("places angle zero due east and a quarter turn due south", () => {
    // SVG's y axis points down, so +90 degrees is south, not north. Asserting
    // the sign here is what stops a flipped chart reading as a rotation bug.
    expect(polarPoint(0, 0, 10, 0)).toEqual({ x: 10, y: 0 });
    expect(polarPoint(0, 0, 10, Math.PI / 2)).toEqual({ x: 0, y: 10 });
    expect(polarPoint(0, 0, 10, Math.PI)).toEqual({ x: -10, y: 0 });
    expect(polarPoint(0, 0, 10, -Math.PI / 2)).toEqual({ x: 0, y: -10 });
  });

  it("offsets by the centre rather than measuring from the origin", () => {
    expect(polarPoint(66, 66, 10, 0)).toEqual({ x: 76, y: 66 });
  });

  it("is unchanged by a one-ULP change in the angle, at every spoke of the seal", () => {
    // The direct reproduction. The server and the browser do not disagree about
    // the angle — that is plain arithmetic — they disagree about the sine OF it,
    // by up to a few ULP. A one-ULP change in the angle produces a change of the
    // same order in the result, so this is the same perturbation applied one
    // step earlier, and it is the version this function can actually be given.
    for (const angle of SEAL_ANGLES) {
      expect(nextUp(angle)).not.toBe(angle);
      expect(polarPoint(66, 66, 34, nextUp(angle))).toEqual(polarPoint(66, 66, 34, angle));
      expect(polarPoint(66, 66, 58, nextUp(angle))).toEqual(polarPoint(66, 66, 58, angle));
    }
  });

  it("emits no coordinate with more than the declared precision", () => {
    const factor = 10 ** SVG_COORD_DECIMALS;
    for (const angle of SEAL_ANGLES) {
      const { x, y } = polarPoint(66, 66, 42, angle);
      // Compared through a tolerance rather than `Number.isInteger` because
      // `round` divides by the factor afterwards, which can itself leave dust.
      expect(Math.abs(x * factor - Math.round(x * factor))).toBeLessThan(1e-6);
      expect(Math.abs(y * factor - Math.round(y * factor))).toBeLessThan(1e-6);
    }
  });

  it("has margin over the divergence it exists to absorb", () => {
    // The worst-case error is a few ULP at the magnitude of the largest
    // coordinate in the app (a 680-unit viewBox). Requiring eight orders of
    // magnitude of margin is what separates a fix from a coincidence: at three
    // decimals the step is ~4e10 times the error, so a straddle would need a
    // coordinate to land within 1e-14 of a rounding boundary.
    const worstCaseUlp = 680 * Number.EPSILON;
    expect(10 ** -SVG_COORD_DECIMALS / worstCaseUlp).toBeGreaterThan(1e8);
  });

  it("is still far below anything visible at the tightest render ratio in the app", () => {
    // `TasteSeal` draws a 132-unit viewBox into 56px — the smallest ratio
    // anywhere here. If the precision were ever coarsened enough to matter, the
    // seal's ring would visibly facet; this is the guard on the other side.
    const unitsPerPixel = 132 / 56;
    expect(10 ** -SVG_COORD_DECIMALS / unitsPerPixel).toBeLessThan(0.01);
  });

  it("returns a finite point for a zero radius and for a full turn", () => {
    expect(polarPoint(66, 66, 0, 1.234)).toEqual({ x: 66, y: 66 });
    const full = polarPoint(0, 0, 5, Math.PI * 2);
    expect(Number.isFinite(full.x)).toBe(true);
    expect(Number.isFinite(full.y)).toBe(true);
    expect(full.x).toBe(5);
  });
});
