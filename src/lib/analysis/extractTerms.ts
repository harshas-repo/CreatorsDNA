/**
 * Candidate term extraction from a creator's free-text description.
 *
 * THE OUTPUT OF THIS MODULE IS A SUGGESTION AND NOTHING MORE.
 * ------------------------------------------------------------
 * Nothing here decides what becomes a signal. A candidate is a phrase worth
 * asking the catalogue about; whether it resolves, and whether the resolved
 * entity is the one the creator meant, is settled by live `/search` results plus
 * an explicit confirmation in the review stage. A candidate that matches nothing
 * stays a context-only phrase. A candidate the creator rejects is dropped from
 * the signal set but still reported.
 *
 * Why that matters enough to say twice: the previous flow sent whatever the
 * creator typed straight to an unscoped `/search` and accepted it only when
 * EXACTLY one entity matched. Anything ambiguous or unmatched was therefore
 * silently discarded, and the creator's own description of their work — the one
 * input guaranteed to be about them — contributed nothing. Extraction exists to
 * give the review stage something to review; it is not a resolver.
 *
 * NO HARDCODED VOCABULARY.
 * ------------------------
 * There is deliberately no list of known artists, genres or brands in this file.
 * A lexicon would decide what counts as culture, and it would be wrong in the
 * direction that matters: the niches a curated list omits are exactly the ones
 * the catalogue covers and the list does not, so the creators who most need this
 * product would get the least out of it. The strategies below are all structural
 * — quoting, capitalisation, hashtags, enumeration — so they work on a description
 * of shoegaze production and a description of competitive Excel alike.
 *
 * Everything is pure and deterministic: same text in, same candidates out, in the
 * same order. No randomness, no network, no locale-sensitive casing surprises
 * beyond the explicit `toLowerCase()` comparisons.
 */

/** Which structural pattern produced a candidate. Shown in the review stage. */
export type CandidateStrategy = "quoted" | "hashtag" | "capitalised" | "enumerated";

export interface CandidateTerm {
  /** The phrase to search for. Trimmed, original casing preserved. */
  term: string;
  strategy: CandidateStrategy;
}

/** Strategy rank. Stronger structural evidence first, for stable ordering. */
const STRATEGY_RANK: Record<CandidateStrategy, number> = {
  quoted: 0,
  hashtag: 1,
  capitalised: 2,
  enumerated: 3,
};

/** Hard cap. Mirrors `analyzeBodySchema.interests.max(24)`. */
export const MAX_CANDIDATES = 24;

/** Longest phrase worth searching. Longer spans are prose, not names. */
const MAX_WORDS = 6;

/**
 * Words that may not OPEN a capitalised span.
 *
 * Sentence-initial capitalisation is not evidence of a name — every sentence
 * starts with a capital letter. A span is only treated as a name when either it
 * does not start a sentence, or it starts one with several capitalised words
 * whose first is not an ordinary function word. "I make dream pop" yields
 * nothing; "Dream Pop Diaries" yields the title.
 *
 * This is a list of ENGLISH FUNCTION WORDS, not of cultural terms. It decides
 * nothing about what counts as a name; it only stops pronouns and articles being
 * offered as candidates.
 */
const NON_NAME_OPENERS = new Set([
  "i", "a", "an", "the", "my", "our", "we", "you", "your", "it", "its", "this", "that",
  "these", "those", "and", "but", "or", "so", "then", "also", "because", "when", "while",
  "if", "in", "on", "at", "to", "for", "of", "with", "as", "is", "am", "are", "was",
  "were", "be", "been", "being", "do", "does", "did", "have", "has", "had", "not", "no",
  "yes", "there", "here", "what", "who", "whom", "whose", "why", "how", "which", "all",
  "some", "most", "more", "less", "very", "just", "really", "mostly", "sometimes",
  "often", "usually", "always", "never", "still", "even", "only", "both", "each",
  "every", "any", "many", "much", "few", "little", "lot", "lots", "kind", "sort",
  "hey", "hi", "hello", "thanks", "please", "let", "lets", "me", "us", "them", "he",
  "she", "they", "his", "her", "their", "im", "ive", "id", "ill",
]);

/**
 * Words trimmed from the ends of an enumerated segment.
 *
 * "videos about dream pop and slow cinema" enumerates to "dream pop" and "slow
 * cinema", not to "videos about dream pop". Stripping a leading determiner or a
 * trailing "stuff"/"etc" is what makes an enumerated candidate searchable.
 */
const SEGMENT_EDGE_NOISE = new Set([
  "a", "an", "the", "some", "any", "much", "many", "most", "mostly", "really", "just",
  "very", "quite", "pretty", "kind", "kinda", "sort", "sorta", "stuff", "things",
  "thing", "etc", "and", "or", "but", "also", "plus", "like", "about", "around",
  "into", "over", "with", "of", "for", "to", "in", "on", "at", "my", "our", "your",
  "their", "its", "it", "them", "anything", "something", "everything", "nothing",
  "general", "especially", "particularly", "mainly", "basically", "literally",
]);

/** Markers that introduce an enumeration. Matched case-insensitively. */
const ENUMERATION_MARKERS = [
  "such as",
  "including",
  "inspired by",
  "influenced by",
  "in the vein of",
  "along the lines of",
  "think",
  "like",
  "covering",
  "about",
  "into",
  "e.g.",
  "eg.",
  "e.g",
] as const;

/**
 * Extract candidate terms from a description.
 *
 * Strategies run in priority order and the union is deduplicated case-
 * insensitively, keeping the strongest strategy and the first-seen position for
 * each distinct phrase. The result is capped at `MAX_CANDIDATES`.
 */
export function extractCandidateTerms(description: string): CandidateTerm[] {
  const text = description ?? "";
  if (text.trim().length === 0) return [];

  const found = new Map<string, CandidateTerm>();
  const add = (term: string, strategy: CandidateStrategy): void => {
    const cleaned = cleanTerm(term);
    if (cleaned === undefined) return;
    const key = cleaned.toLowerCase();
    const existing = found.get(key);
    if (existing === undefined) {
      found.set(key, { term: cleaned, strategy });
      return;
    }
    // Keep the phrase, upgrade the strategy when a stronger pattern also saw it.
    if (STRATEGY_RANK[strategy] < STRATEGY_RANK[existing.strategy]) {
      found.set(key, { term: cleaned, strategy });
    }
  };

  for (const term of quotedSpans(text)) add(term, "quoted");
  for (const term of hashtagTokens(text)) add(term, "hashtag");
  for (const term of capitalisedSpans(text)) add(term, "capitalised");
  for (const term of enumeratedSegments(text)) add(term, "enumerated");

  return [...found.values()]
    .sort(
      (a, b) =>
        STRATEGY_RANK[a.strategy] - STRATEGY_RANK[b.strategy] ||
        a.term.localeCompare(b.term),
    )
    .slice(0, MAX_CANDIDATES);
}

// ---------------------------------------------------------------------------
// Strategies
// ---------------------------------------------------------------------------

/** Straight, curly and typographic quotes. Pairs must match in kind. */
const QUOTE_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['"', '"'],
  ["“", "”"],
  ["‘", "’"],
  ["«", "»"],
  ["「", "」"],
];

/** Anything inside matching quotes. The strongest signal a creator can give. */
export function quotedSpans(text: string): string[] {
  const out: string[] = [];
  for (const [open, close] of QUOTE_PAIRS) {
    let index = 0;
    while (index < text.length) {
      const start = text.indexOf(open, index);
      if (start === -1) break;
      const end = text.indexOf(close, start + open.length);
      if (end === -1) break;
      out.push(text.slice(start + open.length, end));
      index = end + close.length;
    }
  }
  return out;
}

/** `#dream_pop` and `#dreampop` → searchable phrases. */
export function hashtagTokens(text: string): string[] {
  const out: string[] = [];
  const pattern = /#[\p{L}\p{N}_]+/gu;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    out.push(match[0].slice(1).replace(/_/g, " "));
  }
  return out;
}

interface Token {
  text: string;
  /** True when this token begins a sentence (or the whole description). */
  sentenceInitial: boolean;
}

/**
 * Split on whitespace, marking sentence-initial tokens.
 *
 * Punctuation stays attached at this stage; `cleanTerm` strips it later. Keeping
 * the split naive is deliberate — a proper tokeniser would be a second place for
 * this module and the review stage to disagree about what a phrase is.
 */
function tokenise(text: string): Token[] {
  const raw = text.split(/\s+/).filter((part) => part.length > 0);
  const tokens: Token[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const previous = i === 0 ? undefined : raw[i - 1]!;
    tokens.push({
      text: raw[i]!,
      sentenceInitial: i === 0 || previous === undefined || /[.!?…]["'”’)\]]?$/.test(previous),
    });
  }
  return tokens;
}

/** True for `NASA`, `BBC`, `OK` — an all-caps run of two or more letters. */
function isAcronym(word: string): boolean {
  const letters = word.replace(/[^\p{L}]/gu, "");
  return letters.length >= 2 && letters === letters.toUpperCase() && letters !== letters.toLowerCase();
}

/** True when the word begins with a capital letter. */
function isCapitalised(word: string): boolean {
  const first = [...word.replace(/[^\p{L}\p{N}]/gu, "")][0];
  if (first === undefined) return false;
  return first === first.toUpperCase() && first !== first.toLowerCase();
}

/**
 * Runs of capitalised words that look like names.
 *
 * A run is accepted when it is mid-sentence, or when it opens a sentence with at
 * least two capitalised words whose first is not a function word. An all-caps
 * acronym counts as capitalised so "NASA footage" survives.
 */
export function capitalisedSpans(text: string): string[] {
  const tokens = tokenise(text);
  const out: string[] = [];

  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index]!;
    if (!isCapitalised(token.text) && !isAcronym(token.text)) {
      index += 1;
      continue;
    }

    let end = index;
    while (
      end + 1 < tokens.length &&
      (isCapitalised(tokens[end + 1]!.text) || isAcronym(tokens[end + 1]!.text)) &&
      // Do not swallow a possessive or a parenthetical into the name.
      !/^[([]/.test(tokens[end + 1]!.text) &&
      // A list separator ends the name. Without this, "Neon Cartographer, DJ
      // Hollowfield" is read as one three-word span with a comma buried in the
      // middle, and neither artist is offered on its own.
      !/[,;:]$/.test(tokens[end]!.text)
    ) {
      end += 1;
    }

    const words = tokens.slice(index, end + 1).map((entry) => entry.text);
    const length = end - index + 1;
    const firstWord = words[0]!.replace(/[^\p{L}\p{N}'-]/gu, "").toLowerCase();
    const acceptable =
      !token.sentenceInitial ||
      (length >= 2 && !NON_NAME_OPENERS.has(firstWord)) ||
      (length >= 1 && !NON_NAME_OPENERS.has(firstWord) && isAcronym(words[0]!));

    if (acceptable && length <= MAX_WORDS) {
      out.push(words.join(" "));
      // A run that OPENS a sentence is ambiguous in a way a mid-sentence run is
      // not: its first capital letter may belong to the sentence rather than to
      // the name. "Think Neon Cartographer" is a verb followed by an artist, and
      // searching the whole span finds nothing, so the artist is never offered.
      // The shorter span is emitted alongside the full one and the catalogue
      // decides between them - no verb list, and a wrong guess costs one row the
      // creator can dismiss rather than a missed entity.
      if (token.sentenceInitial && length >= 3) out.push(words.slice(1).join(" "));
    }
    index = end + 1;
  }

  return out;
}

/**
 * Segments of an enumeration introduced by a marker phrase.
 *
 * This is the strategy that makes a LOWERCASE description usable, which is how
 * most people actually type: "i make videos about dream pop, slow cinema and
 * indie games" has no capital letters to find, but it does have a list in it.
 *
 * The tail of a sentence after the marker is taken up to the next sentence
 * boundary, then split on commas, semicolons, " and " and " & ". Each segment is
 * trimmed of edge noise and kept only if it is between one and `MAX_WORDS` words.
 */
export function enumeratedSegments(text: string): string[] {
  const out: string[] = [];
  const lowered = text.toLowerCase();

  for (const marker of ENUMERATION_MARKERS) {
    let from = 0;
    for (;;) {
      const at = lowered.indexOf(marker, from);
      if (at === -1) break;
      // Require a word boundary before the marker, so "unlike" does not match "like".
      const before = at === 0 ? " " : lowered[at - 1]!;
      from = at + marker.length;
      if (/[\p{L}\p{N}]/u.test(before)) continue;

      const tailStart = at + marker.length;
      const tailEnd = findSentenceEnd(text, tailStart);
      const tail = text.slice(tailStart, tailEnd);
      for (const segment of splitEnumeration(tail)) out.push(segment);
    }
  }

  return out;
}

function findSentenceEnd(text: string, start: number): number {
  for (let i = start; i < text.length; i += 1) {
    const character = text[i]!;
    if (character === "\n" || character === "." || character === "!" || character === "?") {
      // "e.g." and "Dr." should not end the tail. A period followed by a letter
      // is an abbreviation; a period followed by whitespace or end-of-text is not.
      if (character === "." && i + 1 < text.length && /[\p{L}]/u.test(text[i + 1]!)) continue;
      return i;
    }
  }
  return text.length;
}

function splitEnumeration(tail: string): string[] {
  return tail
    .split(/,|;|\s+and\s+|\s*&\s+|\s+or\s+/i)
    .map((segment) => trimSegmentEdges(segment))
    .filter((segment) => segment !== undefined)
    .map((segment) => segment as string);
}

/** Strip leading/trailing filler and punctuation; reject prose and empties. */
function trimSegmentEdges(segment: string): string | undefined {
  let words = segment
    .trim()
    .split(/\s+/)
    .map((word) => word.replace(/^[^\p{L}\p{N}#]+|[^\p{L}\p{N}.?!'-]+$/gu, ""))
    .filter((word) => word.length > 0);

  while (words.length > 0 && SEGMENT_EDGE_NOISE.has(words[0]!.toLowerCase())) words = words.slice(1);
  while (words.length > 0 && SEGMENT_EDGE_NOISE.has(words[words.length - 1]!.toLowerCase())) {
    words = words.slice(0, -1);
  }
  words = stripLeadingMarker(words);

  if (words.length === 0 || words.length > MAX_WORDS) return undefined;
  // A segment that is entirely function words carried nothing.
  if (words.every((word) => NON_NAME_OPENERS.has(word.toLowerCase()))) return undefined;
  return words.join(" ");
}

/**
 * Strip an enumeration marker that begins a segment.
 *
 * Two markers can apply to one sentence, and only the first is consumed by
 * `enumeratedSegments`: "covering Vector Siege and Hollow Lantern, influenced by
 * The Paper Harbour" splits on the comma and leaves "influenced by The Paper
 * Harbour" as a segment. Searching that finds the right entity only by accident
 * of fuzzy matching, and the review screen shows the creator a phrase they never
 * wrote as though it were a candidate.
 *
 * Reuses `ENUMERATION_MARKERS` rather than a second list, so the words that open
 * an enumeration and the words trimmed from one cannot drift apart.
 */
function stripLeadingMarker(words: readonly string[]): string[] {
  const bare = (word: string): string => word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  let rest = [...words];

  for (;;) {
    const marker = ENUMERATION_MARKERS.find((candidate) => {
      const parts = candidate.split(/\s+/).map(bare);
      return (
        rest.length > parts.length &&
        parts.every((part, position) => bare(rest[position]!) === part)
      );
    });
    if (marker === undefined) return rest;
    rest = rest.slice(marker.split(/\s+/).length);
  }
}

// ---------------------------------------------------------------------------
// Shared cleaning
// ---------------------------------------------------------------------------

/**
 * Drop sentence punctuation that ended up glued to the end of a name.
 *
 * `cleanTerm`'s strip pattern deliberately keeps a trailing period so that
 * abbreviation forms survive, and the cost is real: a capitalised span taken from
 * the end of a sentence arrives as "Sable Court." and is then searched with the
 * full stop attached. The catalogue matches names, not sentences, so the honest
 * candidate is the one without it.
 *
 * An abbreviation keeps its period. The test for one is structural rather than a
 * list: a single word that still contains a period after the trailing run is
 * removed ("e.g") is an abbreviation, so the original is returned untouched.
 */
function stripSentenceEnd(term: string): string {
  const without = term.replace(/[.?!…,;:]+$/u, "").trimEnd();
  if (without.length === 0) return term;
  if (!without.includes(" ") && without.includes(".")) return term;
  return without;
}

/**
 * Normalise a raw candidate into something worth searching for.
 *
 * Returns `undefined` for anything that should not be offered: empty strings,
 * single characters, pure punctuation, pure numbers, and phrases longer than
 * `MAX_WORDS`. Length is capped because `/search` is a name lookup, and a
 * nine-word phrase is prose the creator wrote rather than an entity they meant.
 */
function cleanTerm(raw: string): string | undefined {
  const trimmed = stripSentenceEnd(
    raw
      .replace(/\s+/g, " ")
      .replace(/^[^\p{L}\p{N}#]+|[^\p{L}\p{N}.?!'”’\]]+$/gu, "")
      .trim(),
  );

  if (trimmed.length < 2) return undefined;
  if (!/\p{L}/u.test(trimmed)) return undefined;

  const words = trimmed.split(/\s+/);
  if (words.length > MAX_WORDS) return undefined;
  // A single word that is nothing but a function word is not a name.
  if (words.length === 1 && NON_NAME_OPENERS.has(words[0]!.toLowerCase())) return undefined;

  return trimmed;
}
