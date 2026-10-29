// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * No `<title>` in this codebase may have more than one child.
 *
 * WHY THIS GETS ITS OWN SUITE
 * ---------------------------
 * React's server renderer special-cases `<title>`. In `pushTitleImpl`
 * (`react-dom/cjs/react-dom-server.node.development.js`) the text it emits is:
 *
 *     Array.isArray(children) ? (children.length < 2 ? children[0] : null) : children
 *
 * So a `<title>` with two or more children renders as `<title></title>` — empty —
 * while the client renderer emits every child in full. React then compares the
 * two, finds them different, and regenerates the whole tree. In production that
 * is "Minified React error #418" on every page carrying such a title.
 *
 * The special case exists for document metadata and does NOT exempt the SVG
 * namespace, where `<title>` is an ordinary tooltip. Every chart here puts one
 * inside an SVG `<g>`, so the trap is easy to step in and impossible to see: the
 * tooltip still works after hydration, so nothing looks broken — the page just
 * quietly throws away its server render.
 *
 * Two charts had it (`OpportunityGap`, `TasteFingerprint`), both written as the
 * natural-looking `<title>{label} — {value}</title>`. A reviewer cannot catch
 * that by reading, and the symptom points at the wrong component, so it is
 * asserted here instead.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const SRC = join(ROOT, "src");

// ---------------------------------------------------------------------------
// The checker
// ---------------------------------------------------------------------------

interface TitleChildren {
  /** Number of top-level `{expression}` groups. */
  expressions: number;
  /** Non-whitespace text sitting OUTSIDE any expression. */
  literalText: string;
}

/**
 * Counts the children a `<title>`'s inner JSX would produce.
 *
 * Brace depth is tracked rather than counted, so a nested object or a ternary
 * inside one expression is still one child. Text outside braces is accumulated
 * so that `<title>plain {value}</title>` — two children, one of them literal —
 * is caught as well.
 *
 * Known limitation, accepted deliberately: braces inside a string literal
 * (`{"{"}`) would be miscounted. No title here contains one, and handling it
 * would mean writing a JSX lexer to guard a twelve-line rule.
 */
function countTitleChildren(inner: string): TitleChildren {
  let depth = 0;
  let expressions = 0;
  let literalText = "";

  for (const character of inner) {
    if (character === "{") {
      if (depth === 0) expressions += 1;
      depth += 1;
    } else if (character === "}") {
      depth = Math.max(0, depth - 1);
    } else if (depth === 0 && !/\s/.test(character)) {
      literalText += character;
    }
  }
  return { expressions, literalText };
}

/**
 * Whether one `<title>` body is safe to server-render.
 *
 * Safe means it produces at most one child: either plain text with no
 * expressions, or exactly one expression and nothing else.
 */
function isSingleChild(inner: string): boolean {
  const { expressions, literalText } = countTitleChildren(inner);
  return expressions === 0 ? true : expressions === 1 && literalText === "";
}

/**
 * Blanks every JSX comment, keeping its newlines.
 *
 * Not optional. Several components carry a comment that begins "`<title>` must be
 * the first child…", and a scanner that reads the raw source matches the `<title>`
 * INSIDE that comment and then runs on to the next real `</title>`, reporting a
 * multi-child title that does not exist. Blanking rather than deleting keeps every
 * line number intact, so a reported location still points at the offending line.
 */
function stripJsxComments(source: string): string {
  return source.replace(/\{\/\*[\s\S]*?\*\/\}/g, (comment) => comment.replace(/[^\n]/g, " "));
}

/** Every `<title>…</title>` body in a source string, with its line number. */
function titlesIn(source: string): Array<{ body: string; line: number }> {
  const stripped = stripJsxComments(source);
  const found: Array<{ body: string; line: number }> = [];
  const pattern = /<title\b[^>]*>([\s\S]*?)<\/title>/g;
  for (let match = pattern.exec(stripped); match !== null; match = pattern.exec(stripped)) {
    const body = match[1] ?? "";
    const before = stripped.slice(0, match.index);
    found.push({ body, line: before.split("\n").length });
  }
  return found;
}

function sourceFiles(): string[] {
  const entries = readdirSync(SRC, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".tsx"))
    .map((entry) => join(entry.parentPath ?? entry.path, entry.name))
    .sort();
}

// ---------------------------------------------------------------------------
// The checker itself
// ---------------------------------------------------------------------------

describe("countTitleChildren", () => {
  it("sees one child in a single template literal", () => {
    expect(isSingleChild("{`${point.label} — affinity ${point.affinity}`}")).toBe(true);
  });

  it("sees one child in a single expression, however nested", () => {
    // A ternary and a method call inside one expression are still one child. The
    // depth counter is what makes this pass; a naive brace count would see four.
    expect(isSingleChild("{a ? b.toFixed(2) : c}")).toBe(true);
    expect(isSingleChild("{`${x}`.slice(0, { y: 1 }.y)}")).toBe(true);
  });

  it("sees one child in plain text", () => {
    expect(isSingleChild("Tied with the neighbouring item")).toBe(true);
  });

  it.each([
    // The exact shape that broke `OpportunityGap`: label, separator, value.
    ["{point.label} — affinity {point.affinity.toFixed(2)}"],
    // The shape that broke `TasteFingerprint`.
    ["{spoke.label} — {spoke.value.toFixed(2)}"],
    // Literal text alongside one expression is also two children.
    ["prefix {value}"],
    ["{value} suffix"],
    // The explicit-space idiom JSX needs across a line break; easy to reintroduce.
    ['{label}, coverage{" "}\n        {value}'],
  ])("rejects more than one child: %s", (body) => {
    expect(isSingleChild(body)).toBe(false);
  });

  it("ignores surrounding whitespace, which JSX trims anyway", () => {
    expect(isSingleChild("\n        {`${a} — ${b}`}\n      ")).toBe(true);
  });

  it("finds titles and reports the line they start on", () => {
    const source = '<g>\n  <title>{`${a}`}</title>\n  <circle />\n</g>\n';
    const found = titlesIn(source);
    expect(found).toHaveLength(1);
    expect(found[0]?.line).toBe(2);
    expect(found[0]?.body).toBe("{`${a}`}");
  });
});

// ---------------------------------------------------------------------------
// The codebase
// ---------------------------------------------------------------------------

describe("every <title> in src", () => {
  const files = sourceFiles();
  const titles = files.flatMap((file) =>
    titlesIn(readFileSync(file, "utf8")).map((title) => ({
      where: `${relative(ROOT, file).split(sep).join("/")}:${title.line}`,
      body: title.body,
    })),
  );

  it("actually scans something, so a moved directory cannot silently pass", () => {
    // Without this the suite passes if `src` is renamed, emptied, or the glob
    // stops matching — a green test that checked nothing.
    expect(files.length).toBeGreaterThan(20);
    expect(titles.length).toBeGreaterThanOrEqual(6);
  });

  it.each(titles.map((title) => [title.where, title.body] as const))(
    "%s has a single child",
    (_where, body) => {
      expect(isSingleChild(body)).toBe(true);
    },
  );
});
