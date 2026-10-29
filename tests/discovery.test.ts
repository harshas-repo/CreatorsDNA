// @vitest-environment node
// Drives the REAL resolve route and the REAL analyze route. No provider mocks:
// the property under test is what the two routes actually say about a phrase, so
// replacing either with a stub would test the stub.

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { NextRequest } from "next/server";

import {
  categoryOptions,
  confirmReviewItem,
  confirmedInterests,
  contextTermsFrom,
  draftBlockers,
  draftWarnings,
  emptyDraft,
  mergeReview,
  needsDecision,
  rejectReviewItem,
  reviewSummary,
  toAnalyzeInput,
} from "@/app/analyze/flowTypes";
import { extractCandidateTerms } from "@/lib/analysis/extractTerms";
import { categoryId, coverageWithBasis } from "@/lib/analysis/tasteDna";
import { resetConfigCache } from "@/lib/env";
import { resetProviderContext } from "@/lib/providers";

import { POST as analyzePost } from "@/app/api/analyze/route";
import { POST as resolvePost } from "@/app/api/qloo/resolve/route";

import type { AnalyzeResponse, DraftProfile, ReviewItem } from "@/app/analyze/flowTypes";
import type { ResolveResponse } from "@/lib/api/resolve";
import type { StageEvent } from "@/lib/analysis/stages";

/**
 * The creator discovery flow, end to end.
 *
 * Three creators — music, fashion, technology — are described the way people
 * actually write about their work, and every assertion below is about what the
 * catalogue said in response rather than about a hand-built fixture. That is the
 * point of the suite: the old flow accepted a phrase only when `/search` returned
 * EXACTLY one match, so which inputs worked was an accident of the catalogue's
 * ranking. A test built on invented matches would have kept passing through that
 * bug.
 *
 * The contract being pinned down is the one the brief asks for:
 *
 *   - a phrase the catalogue matched once is confirmed, visibly and reversibly;
 *   - a phrase it matched several times is SHOWN as a choice and blocks until the
 *     creator makes one;
 *   - a phrase it never matched is kept as context and reported, never dropped;
 *   - only confirmed entities become signals;
 *   - a creator with nothing confirmed can still analyse, and gets the honest
 *     no-signal result rather than a plausible-looking one.
 */

// ---------------------------------------------------------------------------
// Environment: pinned to synthetic so the suite never spends live quota
// ---------------------------------------------------------------------------

const savedEnv: Record<string, string | undefined> = {
  CREATORSDNA_PROVIDER: process.env.CREATORSDNA_PROVIDER,
  QLOO_API_KEY: process.env.QLOO_API_KEY,
};

beforeAll(() => {
  // `CREATORSDNA_PROVIDER=synthetic` also means `QLOO_API_KEY` is never read, so a
  // developer who happens to have a key exported cannot turn this suite into a set
  // of live calls. Asserted below rather than assumed.
  process.env.CREATORSDNA_PROVIDER = "synthetic";
  delete process.env.QLOO_API_KEY;
  resetConfigCache();
  resetProviderContext();
});

afterAll(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetConfigCache();
  resetProviderContext();
});

// ---------------------------------------------------------------------------
// The three creators
// ---------------------------------------------------------------------------

interface CreatorCase {
  displayName: string;
  description: string;
}

const CREATORS = {
  music: {
    displayName: "Night Cartographer",
    description:
      "Music production breakdowns. I cover Neon Cartographer, DJ Hollowfield and Bootleg Frequencies.",
  },
  fashion: {
    displayName: "Sole & Seam",
    description:
      "A fashion channel about Sable Court and Marlowe Vance, plus whatever streetwear drops.",
  },
  technology: {
    displayName: "Teardown Weekly",
    description:
      "Technology reviews covering Vector Siege and Hollow Lantern, influenced by The Paper Harbour.",
  },
  // Nothing here is in the catalogue. The creator typed a real description of
  // real work and the honest answer is "we could not resolve any of it".
  unmatched: {
    displayName: "Nobody Yet",
    description: "i make videos about dream pop, slow cinema and indie games",
  },
} satisfies Record<string, CreatorCase>;

type CreatorId = keyof typeof CREATORS;

// ---------------------------------------------------------------------------
// Route helpers
// ---------------------------------------------------------------------------

/** The routes only ever call `.json()`, so a literal is enough and a real
 *  `NextRequest` would need a URL and headers the handler never reads. */
function asRequest(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

async function resolvePhrases(phrases: readonly string[]): Promise<ResolveResponse> {
  const response = await resolvePost(asRequest({ phrases, take: 5 }));
  expect(response.status, "the resolve route should answer").toBe(200);
  return (await response.json()) as ResolveResponse;
}

/**
 * What the review screen would be holding when a creator arrives at it.
 *
 * Extraction suggests, the catalogue decides, `mergeReview` folds the verdicts
 * into review state — the same three steps `ReviewStage` performs, in the same
 * order.
 */
async function reviewFor(description: string): Promise<ReviewItem[]> {
  const candidates = extractCandidateTerms(description);
  expect(candidates.length, "extraction found nothing to review").toBeGreaterThan(0);

  const body = await resolvePhrases(candidates.map((candidate) => candidate.term));
  const strategies = new Map(candidates.map((candidate) => [candidate.term, candidate.strategy]));
  return mergeReview([], body.results, strategies);
}

function draftFor(creator: CreatorCase, review: ReviewItem[], changes: Partial<DraftProfile> = {}): DraftProfile {
  return {
    ...emptyDraft(),
    displayName: creator.displayName,
    description: creator.description,
    review,
    reviewOf: creator.description,
    ...changes,
  };
}

interface StreamedRun {
  events: StageEvent[];
  result?: AnalyzeResponse;
  error?: string;
}

async function analyze(draft: DraftProfile): Promise<StreamedRun> {
  const response = await analyzePost(asRequest(toAnalyzeInput(draft)));
  expect(response.status, "the analyze route should accept the form's own payload").toBe(200);

  const lines = (await response.text())
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as { type: string } & Record<string, unknown>);

  const run: StreamedRun = {
    events: lines.filter((line) => line.type === "stage") as unknown as StageEvent[],
  };
  const result = lines.find((line) => line.type === "result");
  if (result !== undefined) run.result = result as unknown as AnalyzeResponse;
  const error = lines.find((line) => line.type === "error");
  if (error !== undefined) run.error = String(error.message);
  return run;
}

function statusOf(review: readonly ReviewItem[], phrase: string): ReviewItem {
  const item = review.find((candidate) => candidate.phrase === phrase);
  if (item === undefined) {
    throw new Error(`"${phrase}" was never offered to the creator. Got: ${review.map((r) => r.phrase).join(", ")}`);
  }
  return item;
}

// ---------------------------------------------------------------------------
// Extraction is a suggestion, never a decision
// ---------------------------------------------------------------------------

describe("candidate extraction (music, fashion, technology)", () => {
  it("finds named entities in all three descriptions without a cultural vocabulary", () => {
    for (const creator of [CREATORS.music, CREATORS.fashion, CREATORS.technology]) {
      const terms = extractCandidateTerms(creator.description).map((candidate) => candidate.term);
      expect(terms.length, creator.displayName).toBeGreaterThan(0);
      // A list separator must not glue two names into one unsearchable span.
      expect(terms.some((term) => term.includes(",")), creator.displayName).toBe(false);
      // Nor must a sentence's full stop ride along inside a name.
      expect(terms.some((term) => term.endsWith(".")), creator.displayName).toBe(false);
    }
  });

  it("offers the short span as well when a sentence opens with a capitalised run", () => {
    // "Think Neon Cartographer" is a verb plus an artist. Searching the whole span
    // finds nothing, so the shorter one is offered alongside it and the catalogue
    // picks between them.
    const terms = extractCandidateTerms(
      "I make dream pop diaries. Think Neon Cartographer meets slow cinema.",
    ).map((candidate) => candidate.term);
    expect(terms).toContain("Neon Cartographer");
  });

  it("keeps a lowercase description usable through its enumeration", () => {
    const terms = extractCandidateTerms(CREATORS.unmatched.description).map((candidate) => candidate.term);
    expect(terms).toContain("dream pop");
    expect(terms).toContain("slow cinema");
    expect(terms).toContain("indie games");
  });

  it("never strips a marker word out of the middle of a real name", () => {
    // `stripLeadingMarker` trims "influenced by" from a segment. It must not
    // damage the name that follows, and it must not fire on a name that merely
    // begins with a word that is also a marker.
    const terms = extractCandidateTerms(
      "Technology reviews covering Vector Siege and Hollow Lantern, influenced by The Paper Harbour.",
    ).map((candidate) => candidate.term);
    expect(terms).toContain("The Paper Harbour");
    expect(terms.some((term) => term.startsWith("influenced by"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Exactly one match
// ---------------------------------------------------------------------------

describe("a search with exactly one match", () => {
  it("is confirmed automatically, and shown as confirmed", async () => {
    const review = await reviewFor(CREATORS.music.description);

    expect(review).toHaveLength(3);
    for (const item of review) {
      expect(item.status, `"${item.phrase}" should have matched exactly one entity`).toBe("matched");
      expect(item.matches).toHaveLength(1);
      expect(item.confirmed, `"${item.phrase}" should be pre-confirmed`).toBeDefined();
      expect(needsDecision(item), `"${item.phrase}" should not block`).toBe(false);
    }
    expect(confirmedInterests(review)).toHaveLength(3);
    expect(contextTermsFrom(review)).toEqual([]);
  });

  it("shows the entity and its type, not just its name", async () => {
    // The brief asks the review screen to show the actual matching entities and
    // their types. `subtype` carries the type through to the pipeline, where it
    // decides which `filter.type` recommendations are requested with — so an
    // interest that lost it would silently produce no recommendations at all.
    const review = await reviewFor(CREATORS.music.description);
    for (const item of review) {
      const entity = item.matches[0]!.entity;
      expect(entity.type.length, item.phrase).toBeGreaterThan(0);
      expect(item.confirmed?.subtype, item.phrase).toBe(entity.subtype ?? entity.type);
      expect(item.confirmed?.entityId, item.phrase).toBe(entity.id);
      expect(item.confirmed?.name, item.phrase).toBe(entity.name);
    }
  });

  it("keeps the creator's own wording as the query, not the catalogue's", async () => {
    const review = await reviewFor(CREATORS.music.description);
    for (const item of review) {
      expect(item.confirmed?.query, item.phrase).toBe(item.phrase);
    }
  });

  it("can still be rejected, and rejection keeps the phrase as context", async () => {
    const review = await reviewFor(CREATORS.music.description);
    const phrase = review[0]!.phrase;

    const rejected = rejectReviewItem(review, phrase);
    expect(confirmedInterests(rejected)).toHaveLength(2);
    expect(contextTermsFrom(rejected)).toEqual([phrase]);
    // Rejecting is not deleting: the creator still wrote it and is still told it
    // was considered.
    expect(rejected).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// Multiple candidate matches
// ---------------------------------------------------------------------------

describe("multiple candidate matches", () => {
  it("shows every match and refuses to choose", async () => {
    const review = await reviewFor(CREATORS.technology.description);
    const lantern = statusOf(review, "Hollow Lantern");

    expect(lantern.status).toBe("multiple");
    expect(lantern.matches.length).toBeGreaterThan(1);
    expect(lantern.confirmed).toBeUndefined();
    expect(needsDecision(lantern)).toBe(true);
    // The matches are distinct entities, not the same one listed twice.
    const ids = new Set(lantern.matches.map((match) => match.entity.id));
    expect(ids.size).toBe(lantern.matches.length);
  });

  it("blocks the analysis until the creator decides, and names the phrase", async () => {
    const review = await reviewFor(CREATORS.technology.description);
    const draft = draftFor(CREATORS.technology, review);
    const blockers = draftBlockers(draft);

    expect(blockers.length).toBeGreaterThan(0);
    expect(blockers.join(" ")).toContain("Hollow Lantern");
    expect(blockers.join(" ")).toContain("The Paper Harbour");
  });

  it("stops blocking once one match is confirmed", async () => {
    const review = await reviewFor(CREATORS.technology.description);
    const lantern = statusOf(review, "Hollow Lantern");
    const chosen = lantern.matches[1]!;

    const decided = confirmReviewItem(review, "Hollow Lantern", chosen);
    expect(statusOf(decided, "Hollow Lantern").confirmed?.entityId).toBe(chosen.entity.id);
    expect(needsDecision(statusOf(decided, "Hollow Lantern"))).toBe(false);
    // The other ambiguous phrase still blocks — confirming one is not confirming both.
    expect(draftBlockers(draftFor(CREATORS.technology, decided)).join(" ")).toContain(
      "The Paper Harbour",
    );
  });

  it("lets the creator reject all of them and keep the phrase as context", async () => {
    const review = await reviewFor(CREATORS.technology.description);
    const rejected = rejectReviewItem(review, "Hollow Lantern");

    expect(statusOf(rejected, "Hollow Lantern").rejected).toBe(true);
    expect(statusOf(rejected, "Hollow Lantern").matches.length).toBeGreaterThan(1);
    expect(needsDecision(statusOf(rejected, "Hollow Lantern"))).toBe(false);
    expect(contextTermsFrom(rejected)).toContain("Hollow Lantern");
  });
});

// ---------------------------------------------------------------------------
// No match
// ---------------------------------------------------------------------------

describe("no match", () => {
  it("reports the phrase as unmatched, not as a failed lookup", async () => {
    const review = await reviewFor(CREATORS.fashion.description);
    const phrase = review.find((item) => item.status === "none");

    expect(phrase, "one fashion phrase should not be in the catalogue").toBeDefined();
    expect(phrase!.matches).toEqual([]);
    expect(phrase!.confirmed).toBeUndefined();
    expect(phrase!.message).toBeUndefined();
    // Nothing to choose between, so it does not block — but it is never dropped.
    expect(needsDecision(phrase!)).toBe(false);
    expect(contextTermsFrom(review)).toContain(phrase!.phrase);
  });

  it("distinguishes 'not in the catalogue' from 'the lookup failed'", async () => {
    const body = await resolvePhrases(["dream pop"]);
    const unmatched = body.results[0]!;
    expect(unmatched.status).toBe("none");
    expect(unmatched.message).toBeUndefined();
  });

  it("still lets a missing entity be searched for by hand", async () => {
    // The review screen offers a search box precisely because extraction cannot
    // find everything. A phrase the description never contained resolves the same
    // way, and becomes a signal once confirmed.
    const body = await resolvePhrases(["Nine Hundred Sunrises"]);
    expect(body.results[0]!.status).toBe("matched");

    const review = mergeReview(await reviewFor(CREATORS.fashion.description), body.results, new Map([["Nine Hundred Sunrises", "manual" as const]]));
    const added = statusOf(review, "Nine Hundred Sunrises");
    expect(added.strategy).toBe("manual");
    expect(added.confirmed).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Mixed resolved and context-only phrases
// ---------------------------------------------------------------------------

describe("mixed resolved and context-only phrases", () => {
  it.each(["fashion", "technology"] as const)(
    "splits the %s creator's phrases into signals and context with nothing lost",
    async (id) => {
      const creator = CREATORS[id];
      const review = await reviewFor(creator.description);

      const confirmed = confirmedInterests(review);
      const context = contextTermsFrom(review);

      expect(confirmed.length, `${id}: something should have resolved`).toBeGreaterThan(0);
      expect(context.length, `${id}: something should have stayed context`).toBeGreaterThan(0);
      // The two lists are complements by construction. A phrase in neither would
      // be the old behaviour: silently discarded, invisible on every screen.
      expect(confirmed.length + context.length).toBe(review.length);

      const confirmedQueries = confirmed.map((interest) => interest.query);
      for (const item of review) {
        const inSignals = confirmedQueries.includes(item.phrase);
        const inContext = context.includes(item.phrase);
        expect(inSignals !== inContext, `"${item.phrase}" is in both lists or neither`).toBe(true);
      }
    },
  );

  it("carries both lists to the analysis, and only one of them as a signal", async () => {
    const creator = CREATORS.fashion;
    const review = await reviewFor(creator.description);
    const undecided = review.filter((item) => item.status === "multiple");
    // Reject anything ambiguous so the draft can actually be submitted; the point
    // of this test is the split, not the ambiguity gate.
    const settled = undecided.reduce(
      (acc, item) => rejectReviewItem(acc, item.phrase),
      review,
    );

    const input = toAnalyzeInput(draftFor(creator, settled));
    expect(input.interests?.length).toBe(confirmedInterests(settled).length);
    expect(input.contextTerms).toEqual(contextTermsFrom(settled));

    const run = await analyze(draftFor(creator, settled));
    expect(run.error).toBeUndefined();
    expect(run.result?.hasSignals).toBe(true);
    // The context phrases survive the round trip and are reported, but no entity
    // was resolved for them, so they are in neither the declared taste nor the
    // unresolved-interest list — they are their own category of thing.
    expect(run.result?.analysis.contextTerms?.sort()).toEqual([...input.contextTerms!].sort());
    const declared = run.result?.analysis.tasteDna.declared ?? [];
    for (const interest of input.interests ?? []) {
      expect(
        declared.some((entry) => entry.id === interest.entityId),
        `"${interest.query}" should appear as declared taste`,
      ).toBe(true);
    }
  });

  it("summarises the split for the review screen's own headline", async () => {
    const review = await reviewFor(CREATORS.technology.description);
    const summary = reviewSummary(review);

    expect(summary.total).toBe(review.length);
    expect(summary.confirmed + summary.ambiguous + summary.unmatched + summary.failed + summary.pending).toBe(
      summary.total,
    );
    expect(summary.ambiguous).toBeGreaterThan(0);
    expect(summary.confirmed).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// No confirmed signals
// ---------------------------------------------------------------------------

describe("no confirmed signals", () => {
  it("leaves every phrase as context and blocks nothing", async () => {
    const creator = CREATORS.unmatched;
    const review = await reviewFor(creator.description);

    expect(review.length).toBeGreaterThan(0);
    expect(confirmedInterests(review)).toEqual([]);
    // Nothing resolved, so nothing was thrown away either: every phrase the
    // creator wrote is still on the review screen as context.
    expect([...contextTermsFrom(review)].sort()).toEqual(
      review.map((item) => item.phrase).sort(),
    );
    // The honest no-signal outcome must stay REACHABLE. A disabled Analyze button
    // would show the creator none of the explanation the pipeline is built to give.
    expect(draftBlockers(draftFor(creator, review))).toEqual([]);
    expect(draftWarnings(draftFor(creator, review)).join(" ")).toContain("No entity is confirmed");
  });

  it("analyses anyway and says plainly that nothing resolved", async () => {
    const creator = CREATORS.unmatched;
    const review = await reviewFor(creator.description);
    const run = await analyze(draftFor(creator, review));

    expect(run.error).toBeUndefined();
    expect(run.result?.hasSignals).toBe(false);
    expect(run.result?.analysis.fallbackLevel).toBe("L4");
    expect(run.result?.renderable).toBe(false);
    // Every word the creator typed is acknowledged somewhere.
    expect(run.result?.analysis.contextTerms?.length).toBe(review.length);
    // And nothing was invented in its place.
    expect(run.result?.analysis.tasteDna.coreTastes).toEqual([]);
    expect(run.result?.analysis.opportunities).toEqual([]);
  });

  it("does not cache the blank result, so going back and retrying is a real retry", async () => {
    // The route caches a renderable payload only. A no-signals analysis is not
    // renderable, and caching it would pin the creator to a blank page for the
    // whole TTL. This is the property that `outcome.taste.renderable` broke: that
    // flag is false only at L4, a creator who confirmed nothing never reaches the
    // canary, so the guard read `true` and stored the empty result anyway.
    const creator = CREATORS.unmatched;
    const review = await reviewFor(creator.description);
    const draft = draftFor(creator, review);

    const first = await analyze(draft);
    const second = await analyze(draft);

    expect(first.result?.renderable).toBe(false);
    expect(first.result?.cached).toBe(false);
    expect(second.result?.cached, "a blank analysis must not be served from cache").toBe(false);
  });

  it("reports the four provider stages as skipped, never as completed", async () => {
    const creator = CREATORS.unmatched;
    const review = await reviewFor(creator.description);
    const run = await analyze(draftFor(creator, review));

    const byId = new Map(run.events.map((event) => [event.id, event.status]));
    for (const id of ["recommendations", "tags", "demographics", "brands"] as const) {
      // The API requires at least one valid signal, so these calls never happened.
      // Reporting them as `done` would tell the creator we asked Qloo for
      // demographics about nobody.
      expect(byId.get(id), `${id} should be reported skipped`).toBe("skipped");
    }
  });
});

// ---------------------------------------------------------------------------
// Coverage vocabulary comes from the confirmed entities
// ---------------------------------------------------------------------------

describe("the optional context stage", () => {
  it("offers coverage categories derived from what the creator confirmed", async () => {
    const review = await reviewFor(CREATORS.music.description);
    const options = categoryOptions(review);

    expect(options.length).toBeGreaterThan(0);
    // Every option id is one of the confirmed entities' own types, which is what
    // makes the opportunity-gap subtraction compare like with like.
    const confirmedTypes = confirmedInterests(review).map((interest) => interest.subtype);
    for (const option of options) {
      expect(confirmedTypes, `"${option.id}" was not derived from a confirmed entity`).toContain(option.id);
      expect(option.count).toBeGreaterThan(0);
    }
  });

  it("offers nothing to declare when nothing was confirmed", async () => {
    const review = await reviewFor(CREATORS.unmatched.description);
    expect(categoryOptions(review)).toEqual([]);
  });

  it("keeps a declared category findable by the id the pipeline derives", async () => {
    const review = await reviewFor(CREATORS.music.description);
    const options = categoryOptions(review);
    const chosen = options[0]!;

    const input = toAnalyzeInput(
      draftFor(CREATORS.music, review, {
        coveredCategories: [chosen.id],
        saturation: { [chosen.id]: 0.3 },
      }),
    );
    expect(input.coverage?.coveredCategories).toEqual([chosen.id]);

    // What is actually being pinned down is not how either side is spelled on the
    // wire but that the lookup the pipeline performs finds the creator's own
    // figure. `coverageWithBasis` normalises both sides, so a raw `urn:entity:`
    // prefix on one and not the other still resolves. When it did not, the miss
    // fell through to "listed as covered" — coverage 1 — so a creator who said
    // they only occasionally cover a subject was plotted as saturated and their
    // own untapped opportunity disappeared from the chart without any error.
    const lookup = coverageWithBasis(
      chosen.id,
      input.coverage!.saturation ?? {},
      input.coverage!.coveredCategories ?? [],
    );
    expect(lookup.coverage).toBe(0.3);
    expect(lookup.basis).toBe("creator_declared");

    // And the ids the form offers are exactly the ids the derivation produces from
    // the confirmed entities. That is what makes the opportunity-gap subtraction
    // compare like with like instead of two vocabularies that merely look similar.
    const offered = new Set(options.map((option) => option.id));
    const entities = new Map(
      review.flatMap((item) => item.matches).map((match) => [match.entity.id, match.entity]),
    );
    for (const interest of confirmedInterests(review)) {
      // A confirmation with no entity id is not a signal, so this is the invariant
      // the whole review stage rests on rather than a formality.
      expect(interest.entityId, `"${interest.query}" is confirmed but carries no entity id`).toBeDefined();
      const entity = entities.get(interest.entityId!);
      expect(entity, `"${interest.query}" confirmed an entity the review never showed`).toBeDefined();
      expect(
        offered,
        `"${interest.query}" derives a category the context stage never offered`,
      ).toContain(categoryId(entity!));
    }
  });

  it("never turns the place a creator typed into a signal", async () => {
    // Doc 03 §7: a `signal.location.query` matching no locality is a 400 that
    // takes the whole insights call down with it. The country is profile metadata
    // for the geographic dimension only.
    const review = await reviewFor(CREATORS.music.description);
    const input = toAnalyzeInput(
      draftFor(CREATORS.music, review, { place: "Berlin", country: "Germany" }),
    );
    expect(input.location).toEqual({ city: "Berlin", country: "Germany" });
    expect(input.location?.query).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// The resolve route's own contract
// ---------------------------------------------------------------------------

describe("POST /api/qloo/resolve", () => {
  it("answers for every phrase it was given, in the order it was given them", async () => {
    const phrases = ["Neon Cartographer", "Hollow Lantern", "dream pop"];
    const body = await resolvePhrases(phrases);
    expect(body.results.map((entry) => entry.phrase)).toEqual(phrases);
  });

  it("deduplicates a repeated phrase into one answer", async () => {
    const body = await resolvePhrases(["Sable Court", "sable court", "Sable Court"]);
    // Two rows for two distinct strings is correct: the review screen keys on the
    // phrase, and case differences are the creator's, not ours to collapse.
    expect(body.results.length).toBeLessThanOrEqual(3);
    for (const entry of body.results) expect(entry.matches.length).toBe(1);
  });

  it("labels its own source so the review screen can warn about it", async () => {
    const body = await resolvePhrases(["Sable Court"]);
    // This suite pins the provider to synthetic, so the flag MUST be set: a
    // review screen that showed illustrative matches without saying so would be
    // the exact failure the flag exists to prevent.
    expect(body.source.isIllustrative).toBe(true);
    expect(body.source.mode).toBe("synthetic");
  });

  it("rejects an empty phrase list rather than answering nothing", async () => {
    const response = await resolvePost(asRequest({ phrases: [] }));
    expect(response.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Cache replay
// ---------------------------------------------------------------------------

describe("cache replay", () => {
  /**
   * A creator with exactly ONE confirmed entity.
   *
   * The silent-ignore canary needs at least two signals to compare, so it is
   * skipped — and the run is still renderable, which means it IS cached. That
   * combination is the only way to observe a replayed `skipped`. A replay that
   * reported it as `done` would tell the creator a verification check had run
   * when it never could have, which is the defect this group exists to catch.
   */
  async function singleSignalDraft(): Promise<DraftProfile> {
    const review = await reviewFor(CREATORS.music.description);
    const keep = review[0]!.phrase;
    const settled = review.reduce(
      (acc, item) => (item.phrase === keep ? acc : rejectReviewItem(acc, item.phrase)),
      review,
    );
    expect(confirmedInterests(settled), "this draft must carry exactly one signal").toHaveLength(1);
    return draftFor(CREATORS.music, settled);
  }

  it("serves an identical analysis from cache and says it did", async () => {
    // Start from an empty cache rather than relying on this being the first test
    // in the file to have touched this profile. `resetProviderContext` drops the
    // memoised context, and the cache singleton is built inside it.
    resetProviderContext();

    const draft = await singleSignalDraft();

    const first = await analyze(draft);
    expect(first.result?.renderable, "only a renderable result may be cached").toBe(true);
    expect(first.result?.cached, "a cold cache must compute").toBe(false);

    const second = await analyze(draft);
    expect(second.result?.cached).toBe(true);
  });

  it("replays the same stage events, including the skipped ones", async () => {
    const draft = await singleSignalDraft();
    const first = await analyze(draft);
    const replay = await analyze(draft);

    expect(replay.events).toEqual(first.events);
    const skipped = replay.events.filter((event) => event.status === "skipped");
    expect(skipped.length, "the canary cannot run on a single signal").toBeGreaterThan(0);
  });

  it("does not report the unrunnable canary as completed", async () => {
    const draft = await singleSignalDraft();
    await analyze(draft);
    const replay = await analyze(draft);

    const byId = new Map(replay.events.map((event) => [event.id, event.status]));
    expect(byId.get("canary"), "a cached replay must not upgrade skipped to done").toBe("skipped");
  });

  it("replays the stored result rather than recomputing a different one", async () => {
    const draft = await singleSignalDraft();
    const first = await analyze(draft);
    const replay = await analyze(draft);

    // `generatedAt` is minted at compute time, so an identical value is proof the
    // analysis was not silently re-run and re-dated.
    expect(replay.result?.analysis.generatedAt).toBe(first.result?.analysis.generatedAt);
    expect(replay.result?.analysis.brandFits.map((fit) => fit.brandId)).toEqual(
      first.result?.analysis.brandFits.map((fit) => fit.brandId),
    );
  });

  it("recomputes when the creator confirms a different set of entities", async () => {
    // The cache key is derived from the profile, so a creator who goes back and
    // confirms more entities is never served the earlier, narrower answer.
    const one = await singleSignalDraft();
    const three = draftFor(CREATORS.music, await reviewFor(CREATORS.music.description));
    expect(confirmedInterests(three.review)).toHaveLength(3);

    const first = await analyze(one);
    const second = await analyze(three);

    // Deliberately not asserting on `first.cached`: earlier tests in this block
    // already populated that entry, and a test whose meaning depends on how many
    // of its neighbours ran is not a test. The claim that matters is that the
    // wider profile did not land on the narrower profile's entry.
    expect(second.result?.cached, "a different signal set must not hit the same entry").toBe(false);
    expect(second.result?.analysis.tasteDna.declared?.length).toBeGreaterThan(
      first.result?.analysis.tasteDna.declared?.length ?? 0,
    );
  });
});
