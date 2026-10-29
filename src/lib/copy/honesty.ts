/**
 * The copy honesty rules, on their own.
 *
 * Split out of `src/lib/copy/generate.ts` because these rules have two callers
 * that live on opposite sides of the server/client boundary: the templates
 * assert over their own output during generation, and `PitchEditor` re-checks a
 * creator's hand-edited text in the browser on every keystroke. Keeping the rules
 * in a module with zero imports means neither caller can drag the other's
 * dependencies along with it, and the rules themselves can be tested without
 * constructing a profile.
 *
 * `generate.ts` re-exports all of it, so nothing that imported the checks from
 * there has to change.
 *
 * This file must stay dependency-free. That is the property the split buys, and
 * the first import from `@/lib/scoring` or `@/lib/analysis` would quietly give it
 * back.
 *
 * WHAT THE RULES ARE FOR
 * ----------------------
 * 1. **Never "N% of people".** Fact F13: Qloo affinity is not survey data and
 *    never was. No template renders a percentage of an audience, and no
 *    creator-edited pitch may imply one without being labelled.
 *
 * 2. **Never claim the followers were measured.** Doc 01 §37. "Your selected
 *    interests show…" is defensible; "your followers love…" is not.
 *
 * 3. **Never promise or rank.** Doc 05 §12: cultural fit is exploratory. "Best
 *    match" and "guaranteed" both convert an indication into a commitment.
 *
 * The patterns are deliberately blunt. A false positive costs a rephrase; a
 * false negative puts an unverifiable audience claim into a business document
 * that a brand will act on.
 */

export interface HonestyViolation {
  text: string;
  pattern: string;
  why: string;
}

export const FORBIDDEN_PATTERNS: ReadonlyArray<{ pattern: RegExp; why: string }> = [
  { pattern: /% of (people|users|viewers|followers|audience)/i, why: "F13: affinity is not survey data." },
  { pattern: /\bpercent of (people|users|viewers|followers)\b/i, why: "F13: affinity is not survey data." },
  { pattern: /your (followers|audience|viewers|fans) (love|like|want|prefer)/i, why: "Doc 01 §37: never claim followers were measured." },
  { pattern: /\b\d+(\.\d+)?% of your (followers|audience|viewers|fans)\b/i, why: "F13 and doc 01 §37 together." },
  { pattern: /we (know|measured|surveyed|tracked) your (audience|followers)/i, why: "Doc 01 §37." },
  { pattern: /\bguaranteed?\b/i, why: "Cultural fit is exploratory, never a promise." },
  { pattern: /\bbest (brand|match|choice)\b/i, why: "Doc 05 §12: fit is not a verdict." },
];

/** Returns every forbidden pattern found in `text`. Empty means clean. */
export function findHonestyViolations(text: string): HonestyViolation[] {
  return FORBIDDEN_PATTERNS.filter((entry) => entry.pattern.test(text)).map((entry) => ({
    text,
    pattern: entry.pattern.source,
    why: entry.why,
  }));
}

/** Throws on the first violation. Used by tests and by dev-mode rendering. */
export function assertHonestCopy(text: string, context = "generated copy"): void {
  const violations = findHonestyViolations(text);
  if (violations.length > 0) {
    throw new Error(
      `${context} violated the copy rules: ${violations
        .map((violation) => `/${violation.pattern}/ (${violation.why})`)
        .join("; ")}\nOffending text: "${text}"`,
    );
  }
}

/**
 * Check a batch of generated strings. Used in development and by the test suite;
 * a violation is a bug in a template, never in the data.
 */
export function checkCopyBatch(labelled: ReadonlyArray<[string, string]>): HonestyViolation[] {
  return labelled.flatMap(([context, text]) =>
    findHonestyViolations(text).map((violation) => ({ ...violation, text: `${context}: ${text}` })),
  );
}

/**
 * The disclosure appended when a creator exports a pitch they have edited into
 * text that trips `FORBIDDEN_PATTERNS`.
 *
 * Applied by `PitchEditor` at copy time, after the human has had the last word.
 * Blocking the export instead would be paternalistic about their own email;
 * shipping it silently would put an unverifiable audience claim into a business
 * document that carries our name.
 */
export const EDITED_PITCH_DISCLOSURE =
  "Disclosure: this pitch was edited by the creator after generation. CreatorsDNA has not verified the claims added by hand, and any statement about audience size, audience preference or performance is the creator's own.";
