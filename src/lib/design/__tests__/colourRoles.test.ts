// @vitest-environment node
// This suite reads globals.css off disk and asserts against exported constants.
// It touches no DOM, and the jsdom environment is actively wrong for it: under
// jsdom `import.meta.url` is an http URL, so `fileURLToPath` throws before a
// single assertion runs.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  NODE_COUNT_LIMITS,
  PROVENANCE_STYLE,
  ROLE_MEANING,
  ROLE_RGB,
  ROLE_SHAPE,
  ROLE_TOKEN,
  describeColourSystem,
  nodeCountStrategy,
  provenanceDash,
  resolveRoleRgb,
  roleClass,
  roleColour,
  roleRgbNormalised,
} from "@/lib/design/colourRoles";
import type { ColourRole } from "@/lib/contracts/viewModels";
import type { Provenance } from "@/lib/contracts/domain";

/**
 * Token parity.
 *
 * `ROLE_RGB` and `NODE_COUNT_LIMITS` are duplicated between TypeScript and CSS,
 * and both doc comments in `colourRoles.ts` promise a test asserts the two agree
 * — this is that test. Without it the drift is silent and visual: a WebGL hero
 * would use one cobalt while every SVG chart uses another, and nothing would
 * fail until someone compared them side by side.
 *
 * Parsing the stylesheet rather than snapshotting numbers is deliberate. A
 * snapshot would pass on the day it was written and then stop tracking the file
 * it claims to check.
 */

const CSS_PATH = fileURLToPath(new URL("../../../app/globals.css", import.meta.url));
const css = readFileSync(CSS_PATH, "utf8");

const ROLES = Object.keys(ROLE_TOKEN) as ColourRole[];
const PROVENANCES = Object.keys(PROVENANCE_STYLE) as Provenance[];

/** Strip comments, then collect `--name: value` pairs from one rule block. */
function declarationsIn(block: string): Map<string, string> {
  const cleaned = block.replace(/\/\*[\s\S]*?\*\//g, "");
  const found = new Map<string, string>();
  for (const match of cleaned.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    const [, name, value] = match;
    if (name === undefined || value === undefined) continue;
    found.set(name, value.trim());
  }
  return found;
}

/**
 * The first `:root { ... }` block — the light theme, which is the default.
 *
 * The helpers throw plain `Error`s rather than calling `expect`, because they
 * run inside `describe` bodies during collection and vitest refuses `expect`
 * outside a test.
 */
function rootDeclarations(): Map<string, string> {
  const start = css.indexOf(":root {");
  if (start === -1) throw new Error("globals.css has no :root block");
  return declarationsIn(sliceBlock(css, start));
}

/** Dark-theme overrides, keyed by name. Only the tokens it actually changes. */
function darkDeclarations(): Map<string, string> {
  const start = css.indexOf('[data-theme="dark"]');
  if (start === -1) throw new Error("globals.css has no dark theme block");
  return declarationsIn(sliceBlock(css, start));
}

/** Brace-matched slice starting at `from`, which must precede the opening `{`. */
function sliceBlock(text: string, from: number): string {
  const open = text.indexOf("{", from);
  if (open === -1) return "";
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    const char = text[index];
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(open, index + 1);
    }
  }
  return text.slice(open);
}

/** Follow `var(--x)` references until a literal value is reached. */
function resolve(name: string, declarations: Map<string, string>, depth = 0): string {
  if (depth >= 8) throw new Error(`token reference cycle at ${name}`);
  const raw = declarations.get(name);
  if (raw === undefined) throw new Error(`this block does not define ${name}`);
  const reference = /^var\(\s*(--[\w-]+)\s*\)$/.exec(raw);
  return reference?.[1] === undefined ? raw : resolve(reference[1], declarations, depth + 1);
}

function triplet(name: string, declarations: Map<string, string>): [number, number, number] {
  const parts = resolve(name, declarations).split(/\s+/).map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) {
    throw new Error(`${name} did not resolve to an RGB triplet`);
  }
  return [parts[0]!, parts[1]!, parts[2]!];
}

// ---------------------------------------------------------------------------
// ROLE_RGB <-> globals.css
// ---------------------------------------------------------------------------

describe("ROLE_RGB agrees with the :root role tokens", () => {
  const declarations = rootDeclarations();

  it.each(ROLES)("--role-%s resolves to ROLE_RGB.%s", (role) => {
    expect(triplet(ROLE_TOKEN[role], declarations)).toEqual(ROLE_RGB[role]);
  });

  it("names the same token the CSS defines, for every role", () => {
    for (const role of ROLES) {
      expect(declarations.has(ROLE_TOKEN[role]), `${ROLE_TOKEN[role]} missing from globals.css`).toBe(
        true,
      );
    }
  });

  it("keeps resolveRoleRgb and roleRgbNormalised on the same triplet", () => {
    for (const role of ROLES) {
      const [r, g, b] = ROLE_RGB[role];
      const hex = [r, g, b].map((channel) => channel.toString(16).padStart(2, "0")).join("");
      expect(resolveRoleRgb(role)).toBe(`#${hex}`);
      expect(roleRgbNormalised(role)).toEqual([r / 255, g / 255, b / 255]);
    }
  });
});

describe("the one role the dark theme deliberately diverges on", () => {
  /**
   * `--role-support` is deep navy in light mode and a light slate in dark mode,
   * because navy on a dark background is invisible. `ROLE_RGB` is a JS constant
   * and CANNOT follow the cascade, so `resolveRoleRgb("support")` is always the
   * light-theme value.
   *
   * This test pins that divergence rather than pretending it does not exist. It
   * is the assertion that stops a future WebGL scene from painting emphasis
   * marks in near-black on a near-black background: anyone who touches the dark
   * value lands here and reads this.
   */
  it("is --role-support, and the JS constant holds the light value", () => {
    const dark = darkDeclarations();
    const overridden = ROLES.filter((role) => dark.has(ROLE_TOKEN[role]));

    expect(overridden).toEqual(["support"]);
    expect(ROLE_RGB.support).toEqual(triplet(ROLE_TOKEN.support, rootDeclarations()));
    expect(ROLE_RGB.support).not.toEqual(triplet(ROLE_TOKEN.support, dark));
  });
});

// ---------------------------------------------------------------------------
// NODE_COUNT_LIMITS <-> globals.css
// ---------------------------------------------------------------------------

describe("NODE_COUNT_LIMITS agrees with the --node-count-* tokens", () => {
  const declarations = rootDeclarations();

  const pairs: Array<[keyof typeof NODE_COUNT_LIMITS, string]> = [
    ["full", "--node-count-comfortable"],
    ["group", "--node-count-group"],
    ["paginate", "--node-count-paginate"],
  ];

  it.each(pairs)("%s matches %s", (key, token) => {
    expect(Number(resolve(token, declarations))).toBe(NODE_COUNT_LIMITS[key]);
  });

  it("orders the thresholds so the strategy cascade cannot skip a level", () => {
    expect(NODE_COUNT_LIMITS.full).toBeLessThan(NODE_COUNT_LIMITS.group);
    expect(NODE_COUNT_LIMITS.group).toBeLessThan(NODE_COUNT_LIMITS.paginate);
  });
});

describe("nodeCountStrategy branches exactly at the limits", () => {
  const cases: Array<[number, ReturnType<typeof nodeCountStrategy>]> = [
    [0, "full"],
    [NODE_COUNT_LIMITS.full, "full"],
    [NODE_COUNT_LIMITS.full + 1, "filter"],
    [NODE_COUNT_LIMITS.group, "filter"],
    [NODE_COUNT_LIMITS.group + 1, "group"],
    [NODE_COUNT_LIMITS.paginate, "group"],
    [NODE_COUNT_LIMITS.paginate + 1, "list"],
  ];

  it.each(cases)("%i nodes -> %s", (count, expected) => {
    expect(nodeCountStrategy(count)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// The R14 rule: colour is never the only channel
// ---------------------------------------------------------------------------

describe("every role that can be a datum also has a shape", () => {
  /**
   * Doc 05 §11 requires a redundant non-colour encoding. `neutral` is chrome
   * (axes, gridlines) and `support` is an emphasis overlay drawn AROUND another
   * node, so neither is ever a point in a legend and both are `undefined` here
   * by design — see the note above `ROLE_SHAPE`.
   *
   * Asserting the two exceptions explicitly is what makes this test useful: if a
   * future chart starts plotting `support` as a node, this fails and the fix is
   * to add a sixth shape rather than to let two roles share a colour-only cue.
   */
  it("assigns a shape to all plotted roles and to none of the chrome roles", () => {
    for (const role of ROLES) {
      if (role === "neutral" || role === "support") {
        expect(ROLE_SHAPE[role], `${role} is chrome and must not claim a shape`).toBeUndefined();
      } else {
        expect(ROLE_SHAPE[role], `${role} is plotted and needs a non-colour cue`).toBeDefined();
      }
    }
  });

  it("documents what each role means, so the mapping is not only chosen", () => {
    for (const role of ROLES) {
      expect(ROLE_MEANING[role].label.length).toBeGreaterThan(0);
      expect(ROLE_MEANING[role].usedFor.length).toBeGreaterThan(0);
    }
    const described = describeColourSystem();
    for (const role of ROLES) {
      expect(described, `${role} missing from describeColourSystem()`).toContain(
        ROLE_MEANING[role].label,
      );
    }
  });

  it("resolves colours through the cascade, never to a literal hex", () => {
    for (const role of ROLES) {
      // `roleColour` must return a `var()` reference so a theme switch recolours
      // every chart with no re-render. A literal hex here would silently freeze
      // one component to the light palette.
      expect(roleColour(role)).toMatch(/^rgb\(var\(--role-[a-z]+\)\)$/);
      expect(roleColour(role, 0.5)).toMatch(/^rgb\(var\(--role-[a-z]+\) \/ 0\.5\)$/);
      expect(roleClass(role, "bg")).toBe(`bg-role-${role}`);
    }
  });
});

// ---------------------------------------------------------------------------
// Provenance (doc 05 §13): four classes, all distinguishable without colour
// ---------------------------------------------------------------------------

describe("provenance styling", () => {
  it("covers every provenance class the contract allows", () => {
    expect(PROVENANCES.sort()).toEqual(["creator", "derived", "qloo", "synthetic"]);
  });

  it("gives each class a label and a description", () => {
    for (const provenance of PROVENANCES) {
      expect(PROVENANCE_STYLE[provenance].label.length).toBeGreaterThan(0);
      expect(PROVENANCE_STYLE[provenance].description.length).toBeGreaterThan(0);
      expect(PROVENANCE_STYLE[provenance].badgeClass).toMatch(/^cd-provenance--/);
    }
  });

  /**
   * The whole point of the extra channels: a synthetic value must survive having
   * its colour removed. Greyscale print, colour-vision deficiency and a cropped
   * screenshot all do that, so `synthetic` is the one class that must not rely
   * on hue.
   */
  it("marks synthetic data with a dash, not only a colour", () => {
    expect(PROVENANCE_STYLE.synthetic.dash).not.toBe("none");
    expect(provenanceDash("synthetic")).toBe(PROVENANCE_STYLE.synthetic.dash);
    // Qloo and creator data is genuinely solid: dashing everything would make
    // the dash mean nothing.
    expect(provenanceDash("qloo")).toBeUndefined();
    expect(provenanceDash("creator")).toBeUndefined();
    expect(provenanceDash("derived")).toBe(PROVENANCE_STYLE.derived.dash);
  });

  it("defines a badge class in globals.css for every provenance", () => {
    for (const provenance of PROVENANCES) {
      const badgeClass = PROVENANCE_STYLE[provenance].badgeClass;
      expect(css, `${badgeClass} is not styled in globals.css`).toContain(`.${badgeClass}`);
    }
  });
});
