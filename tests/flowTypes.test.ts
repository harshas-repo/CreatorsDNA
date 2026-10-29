// @vitest-environment node
// Pure functions plus two real pipeline runs. No DOM, and jsdom would only slow
// collection down — the one thing here that touches the browser, `flowTypes.ts`,
// is imported for its exports, not rendered.

import { describe, expect, it } from "vitest";

import {
  OPTIONAL_STAGES,
  RESULT_STAGES,
  STAGES,
  STAGE_LABEL,
  analysisIdentity,
  categoryOptions,
  confirmReviewItem,
  confirmedInterests,
  contextTermsFrom,
  deriveNiche,
  describeAudience,
  describeContent,
  draftAudienceWords,
  draftBlockers,
  draftWarnings,
  emptyDraft,
  fromFreeText,
  fromSearchMatch,
  isHardFail,
  isResultStage,
  manualReviewItem,
  mergeReview,
  needsDecision,
  rejectReviewItem,
  removeReviewItem,
  resetReviewItem,
  reviewItemFromEntry,
  reviewSummary,
  setReviewEmphasis,
  stageIndex,
  toAnalyzeInput,
  validateDraft,
} from "@/app/analyze/flowTypes";
import { categoryLabel } from "@/lib/analysis/categoryLabels";
import { coverageOf, categoryId } from "@/lib/analysis/tasteDna";
import { runAnalysis } from "@/lib/analysis/pipeline";
import { getAllBrands } from "@/lib/data/brandRegistry";
import { archetypeProfile, emptyProfile, FIXED_TIMESTAMP } from "@/lib/demo/archetypes";
import { SyntheticProvider } from "@/lib/providers/synthetic/provider";
import { normaliseCategory, stableKey } from "@/lib/utils/deterministic";

import type {
  AnalyzeResponse,
  DraftProfile,
  ReviewItem,
  SearchMatch,
} from "@/app/analyze/flowTypes";
import type { AnalyzeInput } from "@/lib/api/schemas";
import type { ResolveEntry, ResolveStatus } from "@/lib/api/resolve";
import type { CreatorProfile } from "@/lib/contracts/creator";

/**
 * The `/analyze` form's contract with the analysis layer.
 *
 * Two bugs shaped this suite, and both were found by reading rather than by
 * running.
 *
 * The first is why `normaliseCategory` is tested across a module boundary. The
 * form stored saturation under the creator's own wording while `coverageOf()`
 * looked it up under a canonical key, so every lookup missed, fell through to
 * "listed as covered", and returned coverage **1**. A creator who said they only
 * occasionally make film criticism was plotted as saturated in it — and their own
 * untapped opportunity disappeared from the chart shown to them as evidence.
 * Nothing threw. The result was simply wrong in the direction that flatters the
 * product.
 *
 * The second is why the review state is tested at all. The old flow accepted a
 * phrase only when `/search` returned EXACTLY one match, so anything a person
 * naturally types — "Dune", "Nike", "dream pop" — was quietly discarded and the
 * analysis came back empty with no screen anywhere showing that it had happened.
 * `ReviewItem` exists so every phrase keeps its verdict, its matches and the
 * creator's decision. The tests below assert the property that matters: a phrase
 * is either a confirmed signal or a reported context term, and never neither.
 */

const brands = getAllBrands();

function provider(): SyntheticProvider {
  return new SyntheticProvider({ brands });
}

/**
 * A draft that satisfies `draftBlockers`, so tests can vary one field at a time.
 *
 * Carries a description but NO confirmed entities: that is the minimum the product
 * promises to work with, and it keeps every test below honest about which field it
 * is actually exercising.
 */
function baseDraft(changes: Partial<DraftProfile> = {}): DraftProfile {
  return {
    ...emptyDraft(),
    displayName: "Ada Okonjo",
    description: "I make film criticism and slow cinema essays.",
    ...changes,
  };
}

/** Real catalogue hits, so nothing here invents a `SearchMatch` shape. */
async function matchesFor(query: string, take = 5): Promise<SearchMatch[]> {
  const result = await provider().search({ query, take });
  return result.matches;
}

async function oneMatch(query: string): Promise<SearchMatch> {
  const matches = await matchesFor(query, 1);
  const match = matches[0];
  if (match === undefined) {
    throw new Error(`the synthetic catalogue returned nothing for "${query}"`);
  }
  return match;
}

/**
 * Build a resolve entry the way `resolveOne` in the resolve route does.
 *
 * Duplicating the classification here is deliberate: the route's verdict is the
 * thing under test in `tests/discovery.test.ts`, and reusing its own logic to
 * build these fixtures would make the assertions below circular.
 */
function resolveEntry(
  phrase: string,
  matches: SearchMatch[],
  message?: string,
): ResolveEntry {
  const status: ResolveStatus =
    message !== undefined
      ? "error"
      : matches.length === 0
        ? "none"
        : matches.length === 1
          ? "matched"
          : "multiple";
  return message === undefined
    ? { phrase, status, matches }
    : { phrase, status, matches, message };
}

/** A review item that is already a signal. */
async function confirmedItem(phrase: string, query = phrase): Promise<ReviewItem> {
  const match = await oneMatch(query);
  return reviewItemFromEntry(resolveEntry(phrase, [match]), "capitalised");
}

async function responseFor(profile: CreatorProfile): Promise<AnalyzeResponse> {
  const source = provider();
  const outcome = await runAnalysis({
    profile,
    provider: source,
    brands,
    resolveInterests: false,
    generatedAt: FIXED_TIMESTAMP,
  });
  return {
    analysis: outcome.analysis,
    failures: outcome.failures,
    hasSignals: outcome.hasSignals,
    degradations: outcome.taste.degradations,
    renderable: outcome.taste.renderable,
    source: source.source,
    generatedAt: FIXED_TIMESTAMP,
    cached: false,
    notices: [],
  };
}

/**
 * The coverage block as `coverageOf()` wants it.
 *
 * On the INPUT type both fields are optional, because the schema defaults them.
 * The mapper always sets them, and asserting that once here beats sprinkling `!`
 * through the suite: a non-null assertion would keep compiling on the day the
 * mapper stops setting the block, which is precisely the regression these tests
 * exist to catch. Throwing turns it into a named failure instead.
 */
function wireCoverage(input: AnalyzeInput): {
  coveredCategories: string[];
  saturation: Record<string, number>;
} {
  const coverage = input.coverage;
  if (coverage === undefined) {
    throw new Error("toAnalyzeInput omitted the coverage block entirely");
  }
  return {
    coveredCategories: coverage.coveredCategories ?? [],
    saturation: coverage.saturation ?? {},
  };
}

/** `coverageOf()` over the payload the form would actually send. */
function formCoverage(category: string, draft: DraftProfile): number | undefined {
  const { coveredCategories, saturation } = wireCoverage(toAnalyzeInput(draft));
  return coverageOf(category, saturation, coveredCategories);
}

// ---------------------------------------------------------------------------
// normaliseCategory
// ---------------------------------------------------------------------------

describe("normaliseCategory", () => {
  it.each([
    ["Film Criticism", "film_criticism"],
    ["  film   criticism  ", "film_criticism"],
    ["film-criticism", "film_criticism"],
    ["film_criticism", "film_criticism"],
    ["FILM---CRITICISM", "film_criticism"],
    ["urn:entity:movie", "movie"],
    ["URN:ENTITY:Movie", "movie"],
    ["", ""],
    ["   ", ""],
    ["___", ""],
    ["-film-", "film"],
  ])("maps %j to %j", (input, expected) => {
    expect(normaliseCategory(input)).toBe(expected);
  });

  it.each([
    "film_criticism",
    "Film Criticism",
    "movie",
    "",
    "urn:entity:movie",
    "  Weird   Spacing-Here ",
  ])("is idempotent for %j", (input) => {
    const once = normaliseCategory(input);
    expect(normaliseCategory(once)).toBe(once);
  });

  it("does not stem, so two different categories cannot collapse into one", () => {
    // The function is a canonicaliser, not a matcher. Merging "film" with
    // "films" would silently join two coverage rows the creator entered
    // separately, and the join would be invisible: one row would simply stop
    // appearing in the chart.
    expect(normaliseCategory("film")).not.toBe(normaliseCategory("films"));
    expect(normaliseCategory("coffee")).not.toBe(normaliseCategory("tea"));
  });
});

// ---------------------------------------------------------------------------
// The cross-module agreement — the actual regression test
// ---------------------------------------------------------------------------

describe("what the form stores is what coverageOf reads", () => {
  const draft = baseDraft({
    coveredCategories: ["Film Criticism", "Streetwear"],
    saturation: { "Film Criticism": 0.25, Streetwear: 0.9 },
  });

  it("returns the creator's own saturation, not the covered-list fallback", () => {
    // 0.25 is "Occasionally". 1 would be "Saturated" — the answer the fallback
    // branch gives, and the one that erases the opportunity being reported.
    expect(formCoverage("Film Criticism", draft)).toBe(0.25);
    expect(formCoverage("Streetwear", draft)).toBe(0.9);
  });

  it("would have returned 1 without the normalisation — negative control", () => {
    // Same input, keys left exactly as the creator typed them. This is the bug:
    // the lookup misses, `coverageOf` falls through to "listed as covered", and
    // the honest 0.25 becomes a flattering 1. Asserted so a future change to
    // EITHER side cannot make the test above pass for the wrong reason.
    expect(coverageOf("Film Criticism", draft.saturation, draft.coveredCategories)).toBe(1);
  });

  it("matches a category queried in a different surface form", () => {
    expect(formCoverage("film-criticism", draft)).toBe(0.25);
    expect(formCoverage("FILM   CRITICISM", draft)).toBe(0.25);
    expect(formCoverage("urn:entity:film_criticism", draft)).toBe(0.25);
  });

  it("returns 1 for a covered category whose saturation was never stated", () => {
    const noSaturation = baseDraft({ coveredCategories: ["Travel"] });
    expect(formCoverage("Travel", noSaturation)).toBe(1);
  });

  it("returns 0 for an uncovered category, and undefined when nothing is declared", () => {
    const declared = baseDraft({ coveredCategories: ["Travel"] });
    expect(formCoverage("Gaming", declared)).toBe(0);

    // The distinction the untapped-opportunity chart depends on: "no categories
    // declared at all" is an unknown and must be omitted, not plotted at zero.
    expect(formCoverage("Gaming", baseDraft())).toBeUndefined();
  });

  it("drops a saturation entry whose key normalises to nothing", () => {
    const { saturation } = wireCoverage(
      toAnalyzeInput(baseDraft({ coveredCategories: ["Travel"], saturation: { "___": 0.5, Travel: 0.4 } })),
    );
    expect(Object.keys(saturation)).toEqual(["travel"]);
  });
});

// ---------------------------------------------------------------------------
// deriveNiche — the description, quoted, never re-asked
// ---------------------------------------------------------------------------

describe("deriveNiche", () => {
  it("takes the first sentence", () => {
    expect(deriveNiche("I make film criticism. Sometimes podcasts too.")).toBe(
      "I make film criticism.",
    );
  });

  it("takes the whole text when there is no sentence terminator", () => {
    expect(deriveNiche("  film criticism and slow cinema  ")).toBe(
      "film criticism and slow cinema",
    );
  });

  it("returns nothing for nothing", () => {
    expect(deriveNiche("")).toBe("");
    expect(deriveNiche("   ")).toBe("");
  });

  it("stays inside the schema's 240 characters and cuts on a word", () => {
    // 240 is `analyzeBodySchema.niche.max(240)`. A longer value is a 400, and the
    // creator would be told their description — the one input guaranteed to be
    // about them — was invalid.
    const long = `Word ${"x".repeat(300)}`;
    const derived = deriveNiche(long);
    expect(derived.length).toBeLessThanOrEqual(240);
    expect(derived.endsWith("…")).toBe(true);
    expect(derived).not.toContain("  ");
    // The ellipsis must land on a word boundary, not mid-token.
    expect(derived.slice(0, -1).endsWith("x")).toBe(false);
  });

  it("does not add an ellipsis when nothing was removed", () => {
    expect(deriveNiche("A short description.")).toBe("A short description.");
  });
});

// ---------------------------------------------------------------------------
// Draft -> wire
// ---------------------------------------------------------------------------

describe("toAnalyzeInput", () => {
  it("omits empty optional strings rather than sending them", () => {
    const input = toAnalyzeInput(baseDraft({ description: "" }));
    // The schema validates these with `.trim().min(1)` and a `.default()` only
    // applies to `undefined`, so `""` would be a 400 — and the creator would be
    // told their form was invalid when it was merely unfilled.
    expect(input.handle).toBeUndefined();
    expect(input.niche).toBeUndefined();
    expect(input.description).toBeUndefined();
    expect(input.location).toBeUndefined();
  });

  it("sends the trimmed handle and the derived niche", () => {
    const input = toAnalyzeInput(
      baseDraft({ handle: "  @ada  ", description: " Film criticism, mostly. " }),
    );
    expect(input.handle).toBe("@ada");
    expect(input.niche).toBe("Film criticism, mostly.");
    expect(input.description).toBe("Film criticism, mostly.");
  });

  it("maps place and country onto city and country, and never onto a signal query", () => {
    // Doc 03 §7 makes a `signal.location.query` that matches no locality a 400,
    // which would take the whole insights call down with it. Doc 03 §10 lists no
    // country signal parameter at all. A free-text place therefore has exactly one
    // safe home on the wire, and this is the test that keeps it there.
    const input = toAnalyzeInput(baseDraft({ place: " Lagos ", country: " Nigeria " }));
    expect(input.location).toEqual({ city: "Lagos", country: "Nigeria" });
    expect(input.location?.query).toBeUndefined();
    expect(input.location?.localityId).toBeUndefined();
  });

  it("sends a country on its own when no city was given", () => {
    const input = toAnalyzeInput(baseDraft({ country: "Germany" }));
    expect(input.location).toEqual({ city: undefined, country: "Germany" });
  });

  it("omits the demographics block entirely when nothing was declared", () => {
    // Two creators who both declined must produce the same cache key. Sending
    // `{ ageBuckets: [] }` would be semantically identical downstream and would
    // still double the entries.
    expect(toAnalyzeInput(baseDraft()).demographics).toBeUndefined();
  });

  it("includes demographics when only one of the two was given", () => {
    expect(toAnalyzeInput(baseDraft({ gender: "female" })).demographics).toEqual({
      ageBuckets: [],
      gender: "female",
    });
    expect(toAnalyzeInput(baseDraft({ ageBuckets: ["25_to_29"] })).demographics).toEqual({
      ageBuckets: ["25_to_29"],
      gender: undefined,
    });
  });

  it("carries emphasis through unchanged", async () => {
    // The control is currently inert downstream, and the UI says so. That is a
    // reason to label it, not a reason to drop it: the field is in the contract,
    // and silently discarding a value the creator supplied is how a form and an
    // API drift apart.
    const item = await confirmedItem("Neon Cartographer");
    const emphasised = setReviewEmphasis([item], "Neon Cartographer", "high");
    const input = toAnalyzeInput(baseDraft({ review: emphasised }));
    expect(input.interests?.[0]?.emphasis).toBe("high");
  });

  it("never sends `reviewOf`, which is bookkeeping rather than payload", async () => {
    // If the description a review was BUILT FROM reached the wire it would change
    // the cache key on every edit to the text, and the creator would pay for a
    // fresh analysis of an unchanged signal set.
    const item = await confirmedItem("Neon Cartographer");
    const draft = baseDraft({ review: [item], reviewOf: "a previous draft of the text" });
    const input = toAnalyzeInput(draft);
    expect(JSON.stringify(input)).not.toContain("a previous draft of the text");
  });

  it("sends confirmed entities as interests and everything else as context terms", async () => {
    const confirmed = await confirmedItem("Neon Cartographer");
    const unmatched = reviewItemFromEntry(resolveEntry("dream pop", []), "enumerated");
    const rejected = rejectReviewItem(
      [await confirmedItem("Sable Court")],
      "Sable Court",
    )[0]!;
    const review = [confirmed, unmatched, rejected];

    const input = toAnalyzeInput(baseDraft({ review }));
    const interestQueries = (input.interests ?? []).map((interest) => interest.query);

    expect(interestQueries).toEqual(["Neon Cartographer"]);
    expect(input.contextTerms).toEqual(["dream pop", "Sable Court"]);
    // The two lists are complements: nothing the creator wrote is lost, and
    // nothing unconfirmed becomes a signal.
    expect(interestQueries.filter((query) => input.contextTerms?.includes(query))).toEqual([]);
    expect(interestQueries.length + (input.contextTerms?.length ?? 0)).toBe(review.length);
  });

  it("respects the 24-interest cap the schema enforces", async () => {
    const review: ReviewItem[] = [];
    for (let index = 0; index < 25; index += 1) {
      review.push(manualReviewItem(`subject ${index}`));
    }
    // Manual items are unconfirmed, so they are context terms — and those are
    // capped too. The point is that `validateDraft` catches it in the form rather
    // than the route catching it as a 400.
    expect(toAnalyzeInput(baseDraft({ review })).contextTerms).toHaveLength(25);
    expect(validateDraft(baseDraft({ review })).ok).toBe(false);
  });
});

describe("fromSearchMatch and fromFreeText", () => {
  it("copies the disambiguation fields off a real catalogue hit", async () => {
    const match = await oneMatch("coffee");
    const interest = fromSearchMatch(match, "high");

    expect(interest.entityId).toBe(match.entity.id);
    expect(interest.name).toBe(match.entity.name);
    expect(interest.query).toBe(match.entity.name);
    expect(interest.emphasis).toBe("high");
    // Cleared here and nowhere else, so the only way an interest stops being
    // ambiguous is a real selection.
    expect(interest.ambiguous).toBe(false);
  });

  it("falls back to the coarse type, so a live interest is still mappable", async () => {
    // `filterTypesFor` needs SOME type to choose a recommendation `filter.type`
    // from. The live `/search` host returns `types[]` and no `subtype`, so without
    // this fallback every live interest arrives typeless and no recommendations
    // are made at all.
    const match = await oneMatch("Neon Cartographer");
    expect(fromSearchMatch(match).subtype).toBe(match.entity.subtype ?? match.entity.type);
  });

  it("produces an interest the route can trust, for every hit", async () => {
    // `toCreatorProfile` trusts `entityId` + `name`. This is the assertion that
    // the only sanctioned way to fill those fields actually fills them — a
    // half-populated interest would be silently re-searched, and could resolve
    // to the very entity the creator rejected.
    for (const query of ["coffee", "velvet", "music"]) {
      for (const match of await matchesFor(query)) {
        const interest = fromSearchMatch(match);
        expect(interest.entityId, `${query}: missing entityId`).toBeDefined();
        expect(interest.name, `${query}: missing name`).toBeDefined();
      }
    }
  });

  it("leaves free text unresolved rather than inventing an id", () => {
    const interest = fromFreeText("  my own words  ");
    expect(interest.query).toBe("  my own words  ");
    expect(interest.entityId).toBeUndefined();
    expect(interest.name).toBeUndefined();
    expect(interest.ambiguous).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The review state — where ambiguity becomes visible
// ---------------------------------------------------------------------------

describe("reviewItemFromEntry", () => {
  it("pre-confirms the only match, visibly and reversibly", async () => {
    // Exactly one hit is the same rule the server applies, and doc 02 §7 permits
    // it: there is nothing to choose between. It is still SHOWN as confirmed with
    // a reject control, so "we accepted the only match" is never silent.
    const match = await oneMatch("Neon Cartographer");
    const item = reviewItemFromEntry(resolveEntry("neon cartographer", [match]), "capitalised");

    expect(item.status).toBe("matched");
    expect(item.confirmed?.entityId).toBe(match.entity.id);
    expect(needsDecision(item)).toBe(false);
    // The creator's own wording is what travels, not the catalogue's name.
    expect(item.confirmed?.query).toBe("neon cartographer");
  });

  it("does not choose between several matches", async () => {
    const matches = await matchesFor("The Paper Harbour");
    expect(matches.length).toBeGreaterThan(1);

    const item = reviewItemFromEntry(resolveEntry("The Paper Harbour", matches), "capitalised");
    expect(item.status).toBe("multiple");
    expect(item.matches).toHaveLength(matches.length);
    expect(item.confirmed).toBeUndefined();
    expect(needsDecision(item)).toBe(true);
  });

  it("keeps an unmatched phrase rather than dropping it", () => {
    const item = reviewItemFromEntry(resolveEntry("dream pop", []), "enumerated");
    expect(item.status).toBe("none");
    expect(item.confirmed).toBeUndefined();
    // Nothing to choose from, so it does not block — but it is still reported.
    expect(needsDecision(item)).toBe(false);
    expect(contextTermsFrom([item])).toEqual(["dream pop"]);
  });

  it("reports a failed lookup as a failure, never as 'no match'", async () => {
    // Conflating the two tells the creator the catalogue has no such thing when
    // all we know is the lookup did not complete, and they would then leave a real
    // entity unconfirmed.
    const match = await oneMatch("Sable Court");
    const item = reviewItemFromEntry(
      resolveEntry("Sable Court", [match], "upstream 502"),
      "capitalised",
    );
    expect(item.status).toBe("error");
    expect(item.message).toBe("upstream 502");
    expect(item.confirmed).toBeUndefined();
    expect(needsDecision(item)).toBe(true);
  });

  it("starts a manually added phrase as pending, not as unmatched", () => {
    const item = manualReviewItem("  a phrase I typed  ");
    expect(item.status).toBe("pending");
    expect(item.strategy).toBe("manual");
    expect(item.matches).toEqual([]);
    expect(needsDecision(item)).toBe(false);
  });
});

describe("the creator's decisions", () => {
  async function ambiguous(): Promise<ReviewItem[]> {
    const matches = await matchesFor("Hollow Lantern");
    expect(matches.length).toBeGreaterThan(1);
    return [reviewItemFromEntry(resolveEntry("Hollow Lantern", matches), "capitalised")];
  }

  it("confirming one match makes the phrase a signal and stops it blocking", async () => {
    const review = await ambiguous();
    const chosen = review[0]!.matches[1]!;
    const next = confirmReviewItem(review, "Hollow Lantern", chosen);

    expect(next[0]!.confirmed?.entityId).toBe(chosen.entity.id);
    expect(needsDecision(next[0]!)).toBe(false);
    expect(confirmedInterests(next).map((interest) => interest.entityId)).toEqual([
      chosen.entity.id,
    ]);
    expect(contextTermsFrom(next)).toEqual([]);
  });

  it("addresses items by phrase, not by position", async () => {
    // The review list is rebuilt whenever the description changes. An index
    // captured by a closure over a previous render would confirm the wrong row,
    // and the confirmation would look perfectly sensible.
    const first = await confirmedItem("Neon Cartographer");
    const second = await confirmedItem("Sable Court");
    const next = confirmReviewItem([first, second], "Sable Court", second.matches[0]!);

    expect(next[0]!.confirmed?.entityId).toBe(first.confirmed?.entityId);
    expect(next[1]!.confirmed?.entityId).toBe(second.matches[0]!.entity.id);
  });

  it("rejecting keeps the phrase, as context", async () => {
    const review = await ambiguous();
    const next = rejectReviewItem(review, "Hollow Lantern");

    expect(next).toHaveLength(1);
    expect(next[0]!.rejected).toBe(true);
    expect(next[0]!.confirmed).toBeUndefined();
    expect(needsDecision(next[0]!)).toBe(false);
    // A rejection is not a deletion. The creator still wrote it, and it is still
    // reported — it simply contributes no number.
    expect(contextTermsFrom(next)).toEqual(["Hollow Lantern"]);
  });

  it("rejecting an auto-confirmed single match undoes it", async () => {
    const review = [await confirmedItem("Vector Siege")];
    expect(confirmedInterests(review)).toHaveLength(1);

    const rejected = rejectReviewItem(review, "Vector Siege");
    expect(confirmedInterests(rejected)).toHaveLength(0);
    expect(contextTermsFrom(rejected)).toEqual(["Vector Siege"]);
  });

  it("resetting returns an item to undecided", async () => {
    const review = await ambiguous();
    const confirmed = confirmReviewItem(review, "Hollow Lantern", review[0]!.matches[0]!);
    const reset = resetReviewItem(confirmed, "Hollow Lantern");

    expect(reset[0]!.confirmed).toBeUndefined();
    expect(reset[0]!.rejected).toBe(false);
    expect(needsDecision(reset[0]!)).toBe(true);
  });

  it("removing is the only transition that loses what the creator typed", async () => {
    const review = [await confirmedItem("Vector Siege")];
    const removed = removeReviewItem(review, "Vector Siege");
    expect(removed).toEqual([]);
    expect(contextTermsFrom(removed)).toEqual([]);
  });

  it("changes emphasis only on a confirmed item", async () => {
    const review = await ambiguous();
    expect(setReviewEmphasis(review, "Hollow Lantern", "high")).toEqual(review);

    const confirmed = confirmReviewItem(review, "Hollow Lantern", review[0]!.matches[0]!);
    const emphasised = setReviewEmphasis(confirmed, "Hollow Lantern", "high");
    expect(emphasised[0]!.confirmed?.emphasis).toBe("high");
    // Setting emphasis must not silently confirm anything.
    expect(confirmedInterests(emphasised)).toHaveLength(1);
  });
});

describe("mergeReview", () => {
  const strategies = new Map<string, "capitalised" | "manual">();

  it("keeps a confirmation when the catalogue still offers that entity", async () => {
    const matches = await matchesFor("Hollow Lantern");
    const chosen = matches[1]!;
    const existing = confirmReviewItem(
      [reviewItemFromEntry(resolveEntry("Hollow Lantern", matches), "capitalised")],
      "Hollow Lantern",
      chosen,
    );

    const merged = mergeReview(existing, [resolveEntry("Hollow Lantern", matches)], strategies);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.confirmed?.entityId).toBe(chosen.entity.id);
  });

  it("drops a confirmation the catalogue no longer offers", async () => {
    // Confirming an entity that is not in the result set would be confirming
    // something we cannot show the creator, and the review screen would then have
    // a selected row with nothing selected in it.
    const matches = await matchesFor("Hollow Lantern");
    const existing = confirmReviewItem(
      [reviewItemFromEntry(resolveEntry("Hollow Lantern", matches), "capitalised")],
      "Hollow Lantern",
      matches[0]!,
    );

    const merged = mergeReview(existing, [resolveEntry("Hollow Lantern", [matches[1]!])], strategies);
    expect(merged[0]!.confirmed).toBeUndefined();
    expect(merged[0]!.matches).toHaveLength(1);
  });

  it("keeps a rejection across a re-lookup", async () => {
    const matches = await matchesFor("Hollow Lantern");
    const existing = rejectReviewItem(
      [reviewItemFromEntry(resolveEntry("Hollow Lantern", matches), "capitalised")],
      "Hollow Lantern",
    );

    const merged = mergeReview(existing, [resolveEntry("Hollow Lantern", matches)], strategies);
    expect(merged[0]!.rejected).toBe(true);
    // And the fresh verdict does not re-confirm behind the creator's back:
    // `reviewItemFromEntry` would have pre-confirmed a single match.
    const single = mergeReview(
      rejectReviewItem([await confirmedItem("Vector Siege")], "Vector Siege"),
      [resolveEntry("Vector Siege", await matchesFor("Vector Siege", 1))],
      strategies,
    );
    expect(single[0]!.rejected).toBe(true);
    expect(confirmedInterests(single)).toHaveLength(0);
  });

  it("preserves order and appends what is new", async () => {
    const first = await confirmedItem("Neon Cartographer");
    const entries = [
      resolveEntry("Sable Court", await matchesFor("Sable Court", 1)),
      resolveEntry("Neon Cartographer", await matchesFor("Neon Cartographer", 1)),
    ];

    const merged = mergeReview([first], entries, strategies);
    expect(merged.map((item) => item.phrase)).toEqual(["Neon Cartographer", "Sable Court"]);
  });

  it("restores the strategy a candidate was found by", async () => {
    const existing = [reviewItemFromEntry(resolveEntry("teardown", []), "hashtag")];
    const merged = mergeReview(existing, [resolveEntry("teardown", [])], strategies);
    expect(merged[0]!.strategy).toBe("hashtag");
  });
});

describe("reviewSummary", () => {
  it("counts every state, and never double-counts a decision", async () => {
    const confirmed = await confirmedItem("Vector Siege");
    const multiple = reviewItemFromEntry(
      resolveEntry("The Paper Harbour", await matchesFor("The Paper Harbour")),
      "capitalised",
    );
    const unmatched = reviewItemFromEntry(resolveEntry("dream pop", []), "enumerated");
    const failed = reviewItemFromEntry(resolveEntry("Sable Court", [], "boom"), "manual");
    const pending = manualReviewItem("not looked up");
    const rejected = rejectReviewItem(
      [reviewItemFromEntry(resolveEntry("Bootleg Frequencies", await matchesFor("Bootleg Frequencies", 1)), "capitalised")],
      "Bootleg Frequencies",
    )[0]!;

    const summary = reviewSummary([confirmed, multiple, unmatched, failed, pending, rejected]);
    expect(summary).toEqual({
      total: 6,
      confirmed: 1,
      ambiguous: 1,
      unmatched: 1,
      failed: 1,
      rejected: 1,
      pending: 1,
    });
  });
});

describe("contextTermsFrom", () => {
  it("trims and deduplicates, and drops empties", async () => {
    const confirmed = await confirmedItem("Vector Siege");
    const review = [
      confirmed,
      manualReviewItem("  dream pop "),
      manualReviewItem("dream pop"),
      reviewItemFromEntry(resolveEntry("   ", []), "enumerated"),
    ];
    expect(contextTermsFrom(review)).toEqual(["dream pop"]);
  });
});

// ---------------------------------------------------------------------------
// The coverage vocabulary is derived from the confirmed entities
// ---------------------------------------------------------------------------

describe("categoryOptions", () => {
  it("offers the ids the pipeline will actually derive", async () => {
    // This is the fix for the audit's "coverage and categories are not
    // comparable" finding. The old form asked for free-text category names while
    // `deriveCategories` produced ids from the entities' own types, so
    // `coverageOf` looked one up in terms of the other and usually missed.
    const match = await oneMatch("Neon Cartographer");
    const review = [reviewItemFromEntry(resolveEntry("Neon Cartographer", [match]), "capitalised")];

    const options = categoryOptions(review);
    expect(options.map((option) => option.id)).toEqual([categoryId(match.entity)]);
    expect(options[0]!.count).toBe(1);
  });

  it("labels a category, and never with one entity's disambiguation", async () => {
    // The landing page used to show a fixture's disambiguation — "Synthetic music
    // entity" — as the label for a whole category, because the label was read off
    // whichever entity happened to be first in the group.
    const review = [
      reviewItemFromEntry(
        resolveEntry("Neon Cartographer", await matchesFor("Neon Cartographer", 1)),
        "capitalised",
      ),
      reviewItemFromEntry(resolveEntry("Marlowe Vance", await matchesFor("Marlowe Vance", 1)), "capitalised"),
    ];

    for (const option of categoryOptions(review)) {
      expect(option.label).toBe(categoryLabel(option.id));
      for (const item of review) {
        expect(option.label).not.toBe(item.confirmed?.disambiguation);
      }
    }
  });

  it("counts how many confirmed entities landed in each category", async () => {
    const review = [
      reviewItemFromEntry(resolveEntry("Neon Cartographer", await matchesFor("Neon Cartographer", 1)), "capitalised"),
      reviewItemFromEntry(resolveEntry("Sable Court", await matchesFor("Sable Court", 1)), "capitalised"),
      reviewItemFromEntry(resolveEntry("Marlowe Vance", await matchesFor("Marlowe Vance", 1)), "capitalised"),
    ];

    const options = categoryOptions(review);
    const artists = options.find((option) => option.count > 1);
    expect(artists, "three artists should share one category").toBeDefined();
    expect(artists!.count).toBeGreaterThanOrEqual(2);
    // Sorted by count, then by label — a stable order the chips can be rendered in.
    expect(options.map((option) => option.count)).toEqual(
      [...options.map((option) => option.count)].sort((a, b) => b - a),
    );
  });

  it("ignores phrases that were never confirmed", async () => {
    const review = [
      reviewItemFromEntry(resolveEntry("dream pop", []), "enumerated"),
      rejectReviewItem(
        [reviewItemFromEntry(resolveEntry("Vector Siege", await matchesFor("Vector Siege", 1)), "capitalised")],
        "Vector Siege",
      )[0]!,
    ];
    expect(categoryOptions(review)).toEqual([]);
  });

  it("never files an interest under its entity id", async () => {
    // `subtype` IS the category id because `fromSearchMatch` folds `entity.type`
    // into it. An interest somehow lacking one is skipped: filing it under its
    // entity id would produce a coverage key nothing can ever match, and the
    // creator's answer would silently count for nothing.
    const review: ReviewItem[] = [
      {
        phrase: "typeless",
        strategy: "manual",
        status: "matched",
        matches: [],
        rejected: false,
        confirmed: { query: "typeless", entityId: "urn:entity:1", name: "Typeless", emphasis: "normal", ambiguous: false },
      },
    ];
    expect(categoryOptions(review)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Validation and gating
// ---------------------------------------------------------------------------

describe("validateDraft", () => {
  it("accepts the minimum the product promises to work with", () => {
    // Doc 01 §29's pitch is "no account, just go". This is the test that keeps
    // it true: a name and a description, and nothing else. If a required field is
    // ever added to `analyzeBodySchema`, this fails — which is the point, since
    // the alternative is discovering it in the form of creators abandoning a
    // wizard at step two.
    expect(validateDraft(baseDraft())).toEqual({ ok: true });
  });

  it("rejects an empty draft, and says which field", () => {
    const result = validateDraft(emptyDraft());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.join(" ")).toContain("displayName");
  });

  it("rejects a saturation value outside 0..1", () => {
    const result = validateDraft(baseDraft({ saturation: { film: 1.5 } }));
    expect(result.ok).toBe(false);
  });

  it("accepts a draft whose only content is entities added by hand", async () => {
    const review = [await confirmedItem("Neon Cartographer")];
    expect(validateDraft(baseDraft({ description: "", review })).ok).toBe(true);
  });
});

describe("draftBlockers", () => {
  it("asks for a name and something to resolve, and nothing else", () => {
    expect(draftBlockers(emptyDraft())).toHaveLength(2);
    expect(draftBlockers(baseDraft())).toEqual([]);
  });

  it("blocks on a phrase the creator has not decided about", async () => {
    const matches = await matchesFor("Hollow Lantern");
    const review = [reviewItemFromEntry(resolveEntry("Hollow Lantern", matches), "capitalised")];
    const blockers = draftBlockers(baseDraft({ review }));

    // Submitting while an unanswered choice is on screen would send a signal set
    // the creator never agreed to.
    expect(blockers).toHaveLength(1);
    expect(blockers[0]).toContain("Hollow Lantern");
  });

  it("stops blocking once that phrase is confirmed or rejected", async () => {
    const matches = await matchesFor("Hollow Lantern");
    const review = [reviewItemFromEntry(resolveEntry("Hollow Lantern", matches), "capitalised")];

    expect(draftBlockers(baseDraft({ review: confirmReviewItem(review, "Hollow Lantern", matches[0]!) }))).toEqual([]);
    expect(draftBlockers(baseDraft({ review: rejectReviewItem(review, "Hollow Lantern") }))).toEqual([]);
  });

  it("does NOT block on zero confirmed entities", async () => {
    // A change from the old flow, where "at least one interest" gated the Analyze
    // button. Gating it here makes the honest no-signal outcome unreachable: the
    // pipeline is built to return `hasSignals === false` and a guided L4 recovery
    // screen, and a disabled button gives the creator none of that explanation.
    const review = [reviewItemFromEntry(resolveEntry("dream pop", []), "enumerated")];
    expect(confirmedInterests(review)).toHaveLength(0);
    expect(draftBlockers(baseDraft({ review }))).toEqual([]);
  });

  it("does not block on any optional field", () => {
    // Every context signal is optional (doc 02 §39/§40). A blocker list that grew
    // to include them would turn a skippable stage into a mandatory one.
    expect(draftBlockers(baseDraft({ contextSkipped: true }))).toEqual([]);
    expect(draftBlockers(baseDraft({ coveredCategories: [] }))).toEqual([]);
    expect(draftBlockers(baseDraft({ platforms: [], country: "", place: "", handle: "" }))).toEqual([]);
  });
});

describe("draftWarnings", () => {
  it("warns about the consequences of an empty signal set instead of forbidding it", () => {
    const warnings = draftWarnings(baseDraft());
    expect(warnings.some((warning) => warning.includes("No entity is confirmed"))).toBe(true);
    expect(draftBlockers(baseDraft())).toEqual([]);
  });

  it("says out loud when coverage is inferred rather than declared", () => {
    expect(draftWarnings(baseDraft()).some((w) => w.includes("assumed uncovered"))).toBe(true);
    expect(draftWarnings(baseDraft({ coveredCategories: ["music"] })).some((w) => w.includes("assumed uncovered"))).toBe(
      false,
    );
  });

  it("says out loud when the geographic dimension will be dropped", () => {
    expect(draftWarnings(baseDraft()).some((w) => w.includes("geographic"))).toBe(true);
    expect(draftWarnings(baseDraft({ country: "Germany" })).some((w) => w.includes("geographic"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The stage vocabulary
// ---------------------------------------------------------------------------

describe("the stage list", () => {
  it("has twelve stages, per doc 02 §28", () => {
    expect(STAGES).toHaveLength(12);
  });

  it("labels every stage, with no fallback branch", () => {
    for (const stage of STAGES) {
      expect(STAGE_LABEL[stage], `${stage} is unlabelled`).toBeTruthy();
    }
    expect(Object.keys(STAGE_LABEL)).toHaveLength(STAGES.length);
  });

  it("partitions into capture, transit and results with nothing left over", () => {
    const capture = STAGES.filter((stage) => !isResultStage(stage) && stage !== "analyzing");
    // Doc 02 §28 permits changing the flow when a better UX is found. The capture
    // stages were changed once, from `profile`/`interests`/`audience`, because
    // `interests` silently discarded anything ambiguous. Asserted literally so
    // the next change is a decision rather than a side effect.
    expect(capture).toEqual(["welcome", "describe", "review", "context"]);
    expect(RESULT_STAGES).toHaveLength(7);
    expect(capture.length + RESULT_STAGES.length + 1).toBe(STAGES.length);
  });

  it("marks only the context stage skippable", () => {
    expect(OPTIONAL_STAGES).toEqual(["context"]);
  });

  it("puts the review stage before the context stage", () => {
    // Coverage is offered against the categories the CONFIRMED entities belong to,
    // so the context stage is meaningless before the review stage has run.
    expect(stageIndex("review")).toBeLessThan(stageIndex("context"));
  });

  it("orders the results so stageIndex agrees with isResultStage", () => {
    // The rail decides clickability from status, but `goto` refuses a result
    // stage with no response. Both rest on "results come after capture".
    const firstResult = stageIndex(RESULT_STAGES[0]!);
    for (const stage of STAGES) {
      if (isResultStage(stage)) expect(stageIndex(stage)).toBeGreaterThanOrEqual(firstResult);
      else expect(stageIndex(stage)).toBeLessThan(firstResult);
    }
  });
});

// ---------------------------------------------------------------------------
// The hard-fail gate
// ---------------------------------------------------------------------------

describe("isHardFail", () => {
  it("is false for a real, renderable analysis", async () => {
    const response = await responseFor(archetypeProfile("streetwear"));
    expect(response.analysis.fallbackLevel).not.toBe("L4");
    expect(response.renderable).toBe(true);
    expect(isHardFail(response)).toBe(false);
  });

  it("is true for the real L4 case — no signal at all", async () => {
    const response = await responseFor(emptyProfile());
    expect(response.hasSignals).toBe(false);
    expect(response.analysis.fallbackLevel).toBe("L4");
    expect(isHardFail(response)).toBe(true);
  });

  it("is true for an unrenderable analysis even when the level is not L4", async () => {
    const response = await responseFor(archetypeProfile("streetwear"));
    // The two conditions are OR'd, and the second one is the reason: a level
    // below L4 that still produced nothing renderable must show the hard-fail
    // state rather than an empty chart wearing a "degraded" badge. Doc 04 §4.5 —
    // an unpersonalised list that looks personalised is the failure this product
    // exists to prevent.
    expect(isHardFail({ ...response, renderable: false })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Audience context
// ---------------------------------------------------------------------------

describe("audience context on the draft", () => {
  it("is omitted from the payload as a block when neither question was answered", () => {
    // The same discipline `demographics` and `location` already follow, and for the
    // same reason: sending `{ groups: [], purposes: [] }` would be a second wire
    // shape for "the creator declined", and every consumer would have to handle both.
    expect(toAnalyzeInput(baseDraft()).audience).toBeUndefined();
    // Whitespace alone is still nothing said.
    expect(
      toAnalyzeInput(baseDraft({ audienceGroupsOther: "   " })).audience,
    ).toBeUndefined();
  });

  it("carries each answer on its own, and the Other text only with its own chip", () => {
    expect(toAnalyzeInput(baseDraft({ audienceGroups: ["gamers"] })).audience).toEqual({
      groups: ["gamers"],
      purposes: [],
      groupsOther: undefined,
      purposesOther: undefined,
    });
    expect(
      toAnalyzeInput(baseDraft({ audiencePurposesOther: " synth repair " })).audience,
    ).toBeUndefined();

    // A string left in the field after the creator un-ticked "Other" is not a
    // statement they made about their audience, so it must not travel — the route
    // drops it again, but the client is the one that knows what is on screen.
    expect(
      toAnalyzeInput(
        baseDraft({ audienceGroups: ["gamers"], audienceGroupsOther: "removed later" }),
      ).audience?.groupsOther,
    ).toBeUndefined();
    expect(
      toAnalyzeInput(
        baseDraft({ audienceGroups: ["other"], audienceGroupsOther: "  amateur astronomers " }),
      ).audience?.groupsOther,
    ).toBe("amateur astronomers");
  });

  it("validates against the same schema the route uses", () => {
    // `validateDraft` runs the outgoing payload through `analyzeBodySchema`, so this
    // is the test that the client and the API agree about the new field. A draft the
    // form accepts and the route rejects is the failure `schemas.ts` exists to stop.
    expect(
      validateDraft(
        baseDraft({
          audienceGroups: ["gamers", "other"],
          audienceGroupsOther: "amateur astronomers",
          audiencePurposes: ["education"],
        }),
      ).ok,
    ).toBe(true);
    // And the cap is real: an unbounded blob would ride into the cached request.
    expect(
      validateDraft(baseDraft({ audienceGroups: ["other"], audienceGroupsOther: "x".repeat(121) }))
        .ok,
    ).toBe(false);
  });

  it("does not change the staleness key, so it cannot cry stale over an edit that changes nothing", () => {
    // The invariant `analysisIdentity` exists to hold. Audience context changes no
    // signal, no intersection and no stored string, so counting it in the key would
    // show "These results no longer match the form… nothing here reflects your
    // latest edits until you re-run" over an edit that provably cannot alter the
    // analysis — a false statement, and a wasted re-run to obtain an identical one.
    const bare = toAnalyzeInput(baseDraft());
    const stated = toAnalyzeInput(
      baseDraft({
        audienceGroups: ["gamers", "students"],
        audiencePurposes: ["entertainment"],
        audienceGroupsOther: "amateur astronomers",
      }),
    );

    expect(stated.audience).toBeDefined();
    expect(stableKey(analysisIdentity(stated))).toBe(stableKey(analysisIdentity(bare)));
    // And it removes only that: everything else the analysis is actually built from
    // still has to be in the key, or a real edit would stop being detected.
    expect(analysisIdentity(stated)).toEqual({ ...stated, audience: undefined });
    const edited = toAnalyzeInput(baseDraft({ country: "Nigeria" }));
    expect(stableKey(analysisIdentity(edited))).not.toBe(stableKey(analysisIdentity(bare)));
  });

  it("resolves the answers to words once, for the copy layer", () => {
    // `generate.ts` keeps its no-runtime-imports rule by only ever seeing words, so
    // this is the single place ids become labels. If it drifted, a sentence would
    // print `fashion_beauty` to a creator.
    expect(draftAudienceWords(baseDraft())).toBeUndefined();
    expect(
      draftAudienceWords(
        baseDraft({
          audienceGroups: ["fashion_beauty", "other"],
          audienceGroupsOther: "amateur astronomers",
          audiencePurposes: ["reviews"],
        }),
      ),
    ).toEqual({
      groups: ["Fashion and beauty enthusiasts", "amateur astronomers"],
      purposes: ["Product recommendations and reviews"],
    });
    // "Other" with nothing typed is a control that was opened, not an answer, so it
    // contributes no word — and a sentence reading "you create for Other" would be
    // the form's own vocabulary leaking into a claim about the creator.
    expect(draftAudienceWords(baseDraft({ audienceGroups: ["other"] }))).toBeUndefined();
  });

  it("counts as a stated audience on its own, so the kit section is not dropped", () => {
    // `stated: false` makes `MediaKit` render "Not included" for the whole audience
    // section. A creator who answered ONLY the two new questions said something
    // about their audience, so omitting it would report their answer as absent.
    expect(describeAudience(baseDraft()).stated).toBe(false);
    expect(describeAudience(baseDraft()).context).toBeUndefined();

    const groupsOnly = describeAudience(baseDraft({ audienceGroups: ["gamers"] }));
    expect(groupsOnly.stated).toBe(true);
    expect(groupsOnly.lines).toEqual([
      { label: "Who they create for", value: "Gamers (self-reported)" },
    ]);

    const purposesOnly = describeAudience(baseDraft({ audiencePurposes: ["education"] }));
    expect(purposesOnly.stated).toBe(true);
    expect(purposesOnly.lines).toEqual([
      { label: "What people come for", value: "Education and learning (self-reported)" },
    ]);

    // An opened "Other" with nothing in it is not a statement, so the section stays
    // omitted rather than printing a row with an empty value.
    expect(describeAudience(baseDraft({ audienceGroups: ["other"] })).stated).toBe(false);
  });

  it("labels the creator's own words as theirs, and ticks as self-reported", () => {
    // The distinction `describeAudience`'s own doc draws for `place`: a category we
    // defined and a phrase they typed must not arrive in a brand's hands looking
    // like the same kind of thing.
    const described = describeAudience(
      baseDraft({
        audienceGroups: ["gamers", "other"],
        audienceGroupsOther: "amateur astronomers",
      }),
    );
    expect(described.lines).toEqual([
      {
        label: "Who they create for",
        value: 'Gamers, "amateur astronomers" (their own words) (self-reported)',
      },
    ]);
  });

  it("never becomes a signal", async () => {
    // The structural guarantee behind every other test here. `toCreatorSignals` is
    // what feeds the provider, and audience context must not reach it: if it did, an
    // unverified self-description would start driving entity ids, tag ids and every
    // number downstream.
    const bare = archetypeProfile("gaming");
    const stated: CreatorProfile = {
      ...bare,
      audience: { groups: ["students"], purposes: ["education"] },
    };
    const outcome = await runAnalysis({
      profile: stated,
      provider: provider(),
      brands,
      resolveInterests: false,
      generatedAt: FIXED_TIMESTAMP,
    });
    const before = await runAnalysis({
      profile: bare,
      provider: provider(),
      brands,
      resolveInterests: false,
      generatedAt: FIXED_TIMESTAMP,
    });

    expect(outcome.analysis).toEqual(before.analysis);
  });
});

describe("content DNA — derived from answers already given, never a new one", () => {
  it("is absent when nothing supports it, rather than an object of empty lists", () => {
    // `undefined`, not `{ topics: [], angles: [], formats: [] }`. Every consumer's first
    // act is a truthiness check — `contentDna?.positioning` in the header, the kit and
    // the brand notes — and an empty object is truthy, so a creator who said nothing
    // would get a section headed "How they make it" with nothing under it.
    expect(describeContent(baseDraft())).toBeUndefined();
    // An opened "Other" with nothing typed is a control that was revealed, not an
    // answer. The same rule `draftAudienceWords` applies, tested there.
    expect(describeContent(baseDraft({ audiencePurposes: ["other"] }))).toBeUndefined();
    // A blank category id contributes no topic. `categoryLabel("")` returns
    // "Uncategorised" rather than "", so filtering after labelling would have invented
    // a topic the creator never named — the one failure mode §8.7 exists to catch.
    expect(describeContent(baseDraft({ coveredCategories: ["", "   "] }))).toBeUndefined();
  });

  it("resolves every id to a word, so no sentence can print `urn:entity:movie`", () => {
    expect(
      describeContent(
        baseDraft({
          coveredCategories: ["movie", "movie", "album"],
          audiencePurposes: ["tutorials"],
          platforms: ["youtube", "tiktok"],
        }),
      ),
    ).toEqual({
      topics: ["Films", "Albums"],
      angles: ["Tutorials and practical guidance"],
      approach: "a practical walkthrough",
      formats: ["YouTube", "TikTok"],
      method: "Tutorials and practical guidance, covering Films and Albums",
      positioning:
        "Tutorials and practical guidance, covering Films and Albums, published on YouTube and TikTok",
    });
  });

  it("is a different reading of the same tick, not a copy of the audience answer", () => {
    // §2 asks for the layers kept distinct. Both read `audiencePurposes`, because asking
    // a creator to tick "Tutorials and practical guidance" twice in two framings would
    // produce two answers that eventually disagree — but they arrive as different types
    // with different words, so no builder can mistake a claim about the maker for a
    // claim about the audience.
    const draft = baseDraft({ audiencePurposes: ["tutorials"] });
    expect(draftAudienceWords(draft)?.purposes).toEqual(["Tutorials and practical guidance"]);
    expect(describeContent(draft)?.angles).toEqual(["Tutorials and practical guidance"]);
    expect(describeContent(draft)?.approach).toBe("a practical walkthrough");
    // Audience words carry the groups someone creates FOR; Content DNA has no such
    // field, because who you intend to reach is not a property of how you work.
    expect("groups" in (describeContent(draft) ?? {})).toBe(false);
  });

  it("takes the first ticked form, in the order the creator ticked them", () => {
    // `approach` feeds a collaboration idea, so it has to be ONE phrase. Taking the first
    // tick rather than a priority order means the creator's own ranking decides. And a
    // ticked "Other" has no form at all: a fallback like "a piece in their own style"
    // would read as a description of method while saying nothing about it.
    expect(describeContent(baseDraft({ audiencePurposes: ["other", "education"] }))?.approach).toBe(
      "an explainer",
    );
    expect(
      describeContent(baseDraft({ audiencePurposes: ["reviews", "education"] }))?.approach,
    ).toBe("a review or recommendation");
  });

  it("composes the summary, and leaves out a half that was never given", () => {
    // Topics only: no angle was ticked, so nothing claims to know HOW the work is made.
    const topicsOnly = describeContent(baseDraft({ coveredCategories: ["movie", "album"] }));
    expect(topicsOnly?.method).toBe("work covering Films and Albums");
    expect(topicsOnly?.positioning).toBe("work covering Films and Albums");
    expect(topicsOnly?.approach).toBeUndefined();

    // Formats only.
    const formatsOnly = describeContent(baseDraft({ platforms: ["newsletter"] }));
    expect(formatsOnly?.method).toBeUndefined();
    expect(formatsOnly?.positioning).toBe("published on Newsletter");

    // Nothing but a typed "Other": an angle with no topic and no platform, which still
    // says something true and still refuses to invent the rest.
    const otherOnly = describeContent(
      baseDraft({
        audiencePurposes: ["other"],
        audiencePurposesOther: "  video essays about horror  ",
      }),
    );
    expect(otherOnly?.angles).toEqual(["video essays about horror"]);
    expect(otherOnly?.positioning).toBe("video essays about horror");
    expect(otherOnly?.approach).toBeUndefined();
  });

  it("caps the sentence without dropping anything from the lists underneath it", () => {
    const described = describeContent(
      baseDraft({
        coveredCategories: ["movie", "album", "book", "podcast", "tv_show"],
        platforms: ["youtube", "tiktok", "instagram", "twitch", "podcast"],
      }),
    );
    expect(described?.topics).toHaveLength(5);
    expect(described?.formats).toHaveLength(5);
    expect(described?.positioning).toBe(
      "work covering Films, Albums and Books, published on YouTube, TikTok and Instagram",
    );
  });

  it("changes no analysis input, so it can neither manufacture a match nor cry stale", () => {
    // The structural half of §5 and §7 in one assertion. Two creators who differ ONLY in
    // the purposes they ticked get different Content DNA and an identical analysis
    // identity: nothing about how they describe their work reaches a signal, an entity
    // lookup, an intersection or the staleness key. If this ever stops holding, Content
    // DNA has become evidence — the one thing it is not allowed to be.
    const wireA = toAnalyzeInput(baseDraft({ audiencePurposes: ["tutorials"] }));
    const wireB = toAnalyzeInput(baseDraft({ audiencePurposes: ["stories"] }));

    expect(describeContent(baseDraft({ audiencePurposes: ["tutorials"] }))?.approach).toBe(
      "a practical walkthrough",
    );
    expect(describeContent(baseDraft({ audiencePurposes: ["stories"] }))?.approach).toBe(
      "a story-led piece",
    );
    expect(stableKey(analysisIdentity(wireA))).toBe(stableKey(analysisIdentity(wireB)));

    // The only difference anywhere on the wire is the `audience` block, which
    // `analysisIdentity` strips and which the suite above already proves never becomes a
    // signal. Content DNA itself has no field: it is derived on the way back out, from
    // answers that were already being sent for another reason.
    expect({ ...wireA, audience: undefined }).toEqual({ ...wireB, audience: undefined });
  });
});
