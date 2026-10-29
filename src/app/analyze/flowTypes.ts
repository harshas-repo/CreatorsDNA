import { analyzeBodySchema } from "@/lib/api/schemas";
import { normaliseCategory } from "@/lib/utils/deterministic";
import { categoryLabel } from "@/lib/analysis/categoryLabels";
// Value import, not a type import: `describeAudience` needs the labels themselves.
// `qloo.ts` is a contracts module of schemas and constant maps with no runtime
// dependency on the request layer, so this does not pull the API client into the
// browser bundle.
import { AGE_BUCKET_LABEL } from "@/lib/contracts/qloo";
// Value imports for the same reason: `describeAudience` and `draftAudienceWords`
// need the labels and the resolver themselves, and `describeContent` needs the
// platform and approach maps. `creator.ts` is, like `qloo.ts`, a contracts module
// of schemas and constant maps with no runtime dependency on the request layer.
import {
  AUDIENCE_GROUP_LABEL,
  CONTENT_PURPOSE_APPROACH,
  CONTENT_PURPOSE_LABEL,
  PLATFORM_LABEL,
  audienceContextWords,
} from "@/lib/contracts/creator";

import type { AnalyzeInput } from "@/lib/api/schemas";
import type { ResolveEntry, ResolveStatus } from "@/lib/api/resolve";
import type { CandidateStrategy } from "@/lib/analysis/extractTerms";
import type {
  AudienceContext,
  AudienceGroup,
  AudienceWords,
  ContentDna,
  ContentPlatform,
  ContentPurpose,
} from "@/lib/contracts/creator";
import type { DataSource, SearchResultSet } from "@/lib/contracts/domain";
import type { QlooAgeBucket, QlooGender } from "@/lib/contracts/qloo";
import type { CreatorAnalysis } from "@/lib/contracts/viewModels";
import type { PipelineFailure } from "@/lib/analysis/pipeline";

/**
 * The shared vocabulary of the `/analyze` flow (doc 02 §28).
 *
 * Doc 02 §28 lists twelve stages and then says: *"The implementation can change
 * this flow if a better UX is found."* It has been changed once, and the reason is
 * worth recording because the old shape was the single largest source of empty
 * results.
 *
 * The old capture stages were `profile` → `interests` → `audience`. `interests`
 * asked the creator to add interests one at a time through a search box, and the
 * pipeline then accepted a phrase only when `/search` returned EXACTLY one match.
 * Anything a person naturally types — "dream pop", "Dune", "Nike" — matches more
 * than one entity, so the default outcome of using the product as designed was
 * that the input was quietly discarded and the analysis came back empty. There was
 * no screen where the creator could see that happen, let alone fix it.
 *
 * The capture stages are now `describe` → `review` → `context`:
 *
 *   1. `describe` — the creator writes about their work in their own words and
 *      optionally names entities. Nothing is resolved yet.
 *   2. `review`   — every candidate phrase is resolved against live search results
 *      and SHOWN, with its matches and their types. The creator confirms the right
 *      one, rejects a suggestion, searches for something missing, or leaves it as
 *      context. Ambiguity is resolved here or nowhere.
 *   3. `context`  — optional audience and coverage detail. Coverage is offered
 *      against the categories the CONFIRMED entities belong to, which is what makes
 *      the opportunity-gap arithmetic compare like with like.
 *
 * The result stages are unchanged and still in the order a creator would find them
 * surprising, because each one answers a question the previous raised.
 *
 * Split out from the components so that the stage list, the labels the progress
 * rail renders and the state machine that drives them cannot disagree. A rail
 * built from one array and a router switching on another is how a wizard comes to
 * show twelve steps and implement eleven.
 */

export const STAGES = [
  "welcome",
  "describe",
  "review",
  "context",
  "analyzing",
  "taste",
  "unexpected",
  "untapped",
  "brands",
  "brand",
  "pitch",
  "kit",
] as const;

export type Stage = (typeof STAGES)[number];

/**
 * The rail labels.
 *
 * Keyed by the closed union with no fallback, so adding a stage is a compile
 * error here until it is labelled — the same guard `PLATFORM_LABEL` uses. A rail
 * that printed a raw stage id would be showing the reader our state machine.
 */
export const STAGE_LABEL: Record<Stage, string> = {
  welcome: "Welcome",
  describe: "Tell us about your work",
  review: "Review what we found",
  context: "Add optional context",
  analyzing: "Analyze",
  taste: "Taste DNA",
  unexpected: "Unexpected affinities",
  untapped: "Untapped connections",
  brands: "Brands you overlap with",
  brand: "Brand detail",
  pitch: "Pitch",
  kit: "Media kit",
};

/** Stages the creator may skip without losing the analysis. */
export const OPTIONAL_STAGES: readonly Stage[] = ["context"];

/**
 * Stages that require a completed analysis.
 *
 * Kept as a list rather than an index comparison so that "can the creator be
 * here?" is answerable without knowing the order of `STAGES`. The rail uses it
 * to decide which completed steps are clickable, and the router uses it to send a
 * creator who reloads mid-flow back to the start rather than rendering an empty
 * results stage.
 */
export const RESULT_STAGES: readonly Stage[] = [
  "taste",
  "unexpected",
  "untapped",
  "brands",
  "brand",
  "pitch",
  "kit",
];

export function stageIndex(stage: Stage): number {
  return STAGES.indexOf(stage);
}

export function isResultStage(stage: Stage): boolean {
  return RESULT_STAGES.includes(stage);
}

// ---------------------------------------------------------------------------
// The draft profile
// ---------------------------------------------------------------------------

export type Emphasis = "low" | "normal" | "high";

/**
 * One search hit.
 *
 * Derived from the contract rather than imported from `SearchEntity`, so this
 * vocabulary module depends on the wire shape and not on a UI component. Both
 * derive from the same `SearchResultSet`, which is what stops them drifting: a
 * hand-written copy here would still typecheck after the contract changed and
 * then fail at the point where a real match is passed in.
 */
export type SearchMatch = SearchResultSet["matches"][number];

/**
 * One interest as the creator left it.
 *
 * `entityId` and `name` are the pair the route trusts: an interest carrying both
 * is treated as resolved, and one carrying neither is re-searched server-side and
 * reported in `unresolvedInterests` if it still cannot be matched. `subtype` and
 * `disambiguation` ride along when the catalogue supplied them.
 *
 * `fromSearchMatch` below is the only sanctioned way to fill the resolved fields,
 * which is what keeps a half-populated interest — an id with no name, trusted by
 * nobody and re-searched anyway — out of the draft.
 */
export interface DraftInterest {
  /** Exactly what the creator typed. Kept even after disambiguation. */
  query: string;
  entityId?: string;
  name?: string;
  subtype?: string;
  disambiguation?: string;
  emphasis: Emphasis;
  /** True while matches are on offer and none has been chosen. */
  ambiguous: boolean;
}

/**
 * A search hit becomes a draft interest.
 *
 * `ambiguous` is cleared here and nowhere else, so the only way an interest stops
 * being ambiguous is a real selection. Doc 02 §7: when several entities match, all
 * of them are presented and the creator chooses. Choosing for them would make
 * every downstream number describe a different thing than the thing they asked
 * about, and the error would be invisible because the result would still look
 * plausible.
 */
export function fromSearchMatch(match: SearchMatch, emphasis: Emphasis = "normal"): DraftInterest {
  return {
    query: match.entity.name,
    entityId: match.entity.id,
    name: match.entity.name,
    // `subtype` is the finer URN when Qloo returned one, but the pipeline also
    // needs SOME type to choose a recommendation `filter.type` from. The live
    // `/search` host returns `types[]` (mapped onto `entity.type`) and no
    // `subtype`, so falling back to `type` is what keeps a resolved interest
    // mappable. This mirrors the server-side `resolveInterests` fallback; without
    // it every live interest arrives typeless and no recommendations are made.
    subtype: match.entity.subtype ?? match.entity.type,
    disambiguation: match.entity.disambiguation,
    emphasis,
    ambiguous: false,
  };
}

/**
 * Free text the catalogue did not match.
 *
 * Marked unambiguous because there was nothing to choose between — but it carries
 * no `entityId`, so the route re-searches it and, if it still cannot resolve it,
 * reports it in `unresolvedInterests` rather than dropping it. The creator is
 * told what did not resolve; the analysis is never quietly built without it.
 *
 * In the current flow this is a fallback rather than the normal path: the review
 * stage confirms entities before submission, so a free-text interest only reaches
 * the wire when a caller drives the API directly.
 */
export function fromFreeText(query: string, emphasis: Emphasis = "normal"): DraftInterest {
  return { query, emphasis, ambiguous: false };
}

// ---------------------------------------------------------------------------
// The review stage
// ---------------------------------------------------------------------------

/**
 * One candidate phrase and everything the review stage knows about it.
 *
 * This is the state that makes ambiguity visible. The old flow had no equivalent:
 * a phrase was either resolved or gone, and "gone" looked identical to "never
 * typed". Here every extracted phrase keeps its matches, the creator's decision,
 * and the reason nothing was decided — so the review screen can show a phrase the
 * catalogue has never heard of next to one it matched eleven times, and the
 * creator can act on either.
 *
 * `status` is the catalogue's verdict, copied from the resolve route. It is never
 * edited locally: a phrase does not become `matched` because the creator wanted
 * it to.
 */
export interface ReviewItem {
  /** The phrase as extracted from the description, or as typed into the search. */
  phrase: string;
  /** Which structural pattern suggested it. Shown so the creator knows why. */
  strategy: CandidateStrategy | "manual";
  /** `pending` before the lookup returns; the catalogue's verdict after. */
  status: ResolveStatus | "pending";
  /** Every match returned, in catalogue order. Empty for `none` and `error`. */
  matches: SearchMatch[];
  /** The match the creator confirmed. Its presence is the ONLY thing that makes
   *  a phrase a signal. */
  confirmed?: DraftInterest;
  /** The creator looked at the matches and said none of them is right. */
  rejected: boolean;
  /** Populated when `status === "error"`, so a failed lookup is never shown as
   *  "nothing matched". */
  message?: string;
}

/**
 * A resolve-route entry becomes a review item.
 *
 * Exactly one match is pre-confirmed, which is the same rule `resolveInterests`
 * applies server-side and the one doc 02 §7 permits: there is nothing to choose
 * between, so asking the creator to click would be friction without information.
 * It is still SHOWN as confirmed with its entity type and a reject control, so
 * "we accepted the only match" is visible and reversible rather than silent.
 *
 * `query` is set to the creator's own phrase rather than the entity's name. They
 * are usually the same, and when they are not the creator's wording is the one
 * that should appear in `unresolvedInterests` and in the cache key.
 */
export function reviewItemFromEntry(entry: ResolveEntry, strategy: CandidateStrategy | "manual"): ReviewItem {
  const item: ReviewItem = {
    phrase: entry.phrase,
    strategy,
    status: entry.status,
    matches: entry.matches,
    rejected: false,
    message: entry.message,
  };
  if (entry.status === "matched" && entry.matches.length === 1) {
    item.confirmed = { ...fromSearchMatch(entry.matches[0]!, "normal"), query: entry.phrase };
  }
  return item;
}

/**
 * A review item the creator added by hand from the review screen's own search box.
 *
 * Starts `pending` with no matches, so an item that has not been looked up yet is
 * visually and logically distinct from one the catalogue could not find.
 */
export function manualReviewItem(phrase: string): ReviewItem {
  return { phrase, strategy: "manual", status: "pending", matches: [], rejected: false };
}

/**
 * Does this item still need the creator's attention?
 *
 * `matched` items are pre-confirmed by `reviewItemFromEntry` and `none` items have
 * nothing to choose from, so neither blocks. What is left is exactly the case the
 * old flow threw away: the catalogue found several things and no human has said
 * which one is meant, or the lookup failed and could be retried.
 */
export function needsDecision(item: ReviewItem): boolean {
  if (item.confirmed !== undefined || item.rejected) return false;
  return item.status === "multiple" || item.status === "error";
}

/** The confirmed entities, in review order. These and only these become signals. */
export function confirmedInterests(review: readonly ReviewItem[]): DraftInterest[] {
  return review
    .filter((item) => item.confirmed !== undefined)
    .map((item) => item.confirmed as DraftInterest);
}

/**
 * The phrases that stay context-only.
 *
 * Everything the creator wrote that did not become a confirmed entity: unmatched,
 * rejected, ambiguous-and-unresolved, failed lookups. These are reported back
 * through `CreatorAnalysis.contextTerms` and are NOT sent as interests, so they
 * reach no provider call. That is the whole distinction the brief asks for —
 * nothing is silently discarded, and nothing unconfirmed becomes a signal.
 */
export function contextTermsFrom(review: readonly ReviewItem[]): string[] {
  const terms = review.filter((item) => item.confirmed === undefined).map((item) => item.phrase);
  return [...new Set(terms.map((term) => term.trim()).filter((term) => term.length > 0))];
}

/**
 * Counts for the review screen's summary line.
 *
 * Computed rather than stored. Four separate counters kept in state alongside the
 * items would be four opportunities for the summary to disagree with the list it
 * summarises, and a summary that says "3 confirmed" above a list showing four is
 * worse than no summary.
 */
export interface ReviewSummary {
  total: number;
  confirmed: number;
  ambiguous: number;
  unmatched: number;
  failed: number;
  rejected: number;
  pending: number;
}

export function reviewSummary(review: readonly ReviewItem[]): ReviewSummary {
  const summary: ReviewSummary = {
    total: review.length,
    confirmed: 0,
    ambiguous: 0,
    unmatched: 0,
    failed: 0,
    rejected: 0,
    pending: 0,
  };
  for (const item of review) {
    if (item.status === "pending") summary.pending += 1;
    if (item.rejected) summary.rejected += 1;
    if (item.confirmed !== undefined) summary.confirmed += 1;
    else if (item.status === "multiple") summary.ambiguous += 1;
    else if (item.status === "none") summary.unmatched += 1;
    else if (item.status === "error") summary.failed += 1;
  }
  return summary;
}

/**
 * Pure review-state transitions.
 *
 * All four take the whole array and return a new one, because the draft is owned
 * by `AnalyzeFlow` and a stage must never mutate it in place — an in-place edit
 * would not re-render and, worse, would not change `draftKey`, so the staleness
 * banner would keep claiming the results still matched a form that had moved on.
 *
 * Items are addressed by `phrase` rather than by index: the review list is
 * rebuilt whenever the description changes, and an index captured by a closure
 * over a previous render would confirm the wrong row. Phrase is the stable key
 * the resolve route itself echoes back.
 */
function replaceItem(
  review: readonly ReviewItem[],
  phrase: string,
  next: (item: ReviewItem) => ReviewItem,
): ReviewItem[] {
  return review.map((item) => (item.phrase === phrase ? next(item) : item));
}

/** The creator picked one of the matches. This is what makes the phrase a signal. */
export function confirmReviewItem(
  review: readonly ReviewItem[],
  phrase: string,
  match: SearchMatch,
): ReviewItem[] {
  return replaceItem(review, phrase, (item) => ({
    ...item,
    // `query` stays the creator's phrase. It is what `unresolvedInterests` and the
    // cache key are built from, and it is what they typed.
    confirmed: { ...fromSearchMatch(match, item.confirmed?.emphasis ?? "normal"), query: item.phrase },
    rejected: false,
  }));
}

/**
 * The creator says none of the matches is right.
 *
 * The phrase stays in the list and still travels as a context term. Rejecting a
 * suggestion is not deleting what the creator wrote, and a rejection that vanished
 * the row would leave them with no record that the phrase was considered and
 * turned down.
 */
export function rejectReviewItem(review: readonly ReviewItem[], phrase: string): ReviewItem[] {
  return replaceItem(review, phrase, (item) => ({ ...item, confirmed: undefined, rejected: true }));
}

/** Undo a rejection, or clear a confirmation the creator wants to reconsider. */
export function resetReviewItem(review: readonly ReviewItem[], phrase: string): ReviewItem[] {
  return replaceItem(review, phrase, (item) => ({
    ...item,
    confirmed: undefined,
    rejected: false,
  }));
}

/** Remove a row entirely — the only transition that loses what the creator typed. */
export function removeReviewItem(review: readonly ReviewItem[], phrase: string): ReviewItem[] {
  return review.filter((item) => item.phrase !== phrase);
}

/** Change how central a confirmed entity is to the creator's work. */
export function setReviewEmphasis(
  review: readonly ReviewItem[],
  phrase: string,
  emphasis: Emphasis,
): ReviewItem[] {
  return replaceItem(review, phrase, (item) =>
    item.confirmed === undefined ? item : { ...item, confirmed: { ...item.confirmed, emphasis } },
  );
}

/**
 * Fold fresh resolve results into existing review state.
 *
 * Re-running the lookup must not throw away decisions already made. An item whose
 * phrase comes back with a new verdict keeps its `confirmed` selection if that
 * entity is still among the matches, and loses it if the catalogue no longer
 * offers it — the honest outcome, since confirming an entity that is not in the
 * result set would be confirming something we cannot show.
 *
 * Order is preserved: existing items keep their positions and new ones append, so
 * the screen does not reshuffle under the creator's cursor between lookups.
 */
export function mergeReview(
  review: readonly ReviewItem[],
  entries: readonly ResolveEntry[],
  strategies: ReadonlyMap<string, CandidateStrategy | "manual">,
): ReviewItem[] {
  const byPhrase = new Map(review.map((item) => [item.phrase, item]));
  const merged: ReviewItem[] = [...review];

  for (const entry of entries) {
    const previous = byPhrase.get(entry.phrase);
    const strategy = strategies.get(entry.phrase) ?? previous?.strategy ?? "manual";
    const fresh = reviewItemFromEntry(entry, strategy);

    if (previous === undefined) {
      merged.push(fresh);
      byPhrase.set(entry.phrase, fresh);
      continue;
    }

    const stillOffered =
      previous.confirmed !== undefined &&
      entry.matches.some((match) => match.entity.id === previous.confirmed?.entityId);
    const carried: ReviewItem = {
      ...fresh,
      confirmed: stillOffered ? previous.confirmed : undefined,
      // A rejection survives a re-lookup. The creator's verdict about the matches
      // is theirs, and the matches have not changed.
      rejected: previous.rejected,
    };
    byPhrase.set(entry.phrase, carried);
    const index = merged.findIndex((item) => item.phrase === entry.phrase);
    if (index === -1) merged.push(carried);
    else merged[index] = carried;
  }

  return merged;
}

/**
 * The coverage vocabulary for the context stage.
 *
 * Derived from the CONFIRMED entities, and that is the fix for the audit's
 * "coverage and categories are not comparable" finding. The old flow asked the
 * creator to type free-text category names — "film criticism", "music" — while
 * `deriveCategories` produced ids from the entities' own types. `coverageOf`
 * then looked up one in terms of the other and usually missed, so a creator who
 * said they were saturated in film was plotted as having no coverage of it.
 *
 * Offering exactly the ids the derivation will produce makes the two sides of the
 * subtraction the same thing by construction.
 */
export interface CategoryOption {
  /** What goes into `coveredCategories` and `saturation`. */
  id: string;
  /** What the creator reads. */
  label: string;
  /** How many confirmed entities landed here. Shown so the choice is informed. */
  count: number;
}

export function categoryOptions(review: readonly ReviewItem[]): CategoryOption[] {
  const counts = new Map<string, number>();
  for (const interest of confirmedInterests(review)) {
    // `fromSearchMatch` already folds `entity.type` into `subtype`, so `subtype`
    // IS `categoryId(entity)`. An interest without one cannot be placed in a
    // category and is skipped rather than filed under its entity id, which would
    // produce a coverage key nothing can ever match.
    const id = interest.subtype;
    if (id === undefined) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([id, count]) => ({ id, label: categoryLabel(id), count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export interface DraftProfile {
  displayName: string;
  handle: string;
  /**
   * Step 1: the creator's own description of their work.
   *
   * The primary input. Candidate phrases are extracted from it and resolved in
   * the review stage, and the text itself is retained for provenance — quoted
   * back as the creator's own words in the media kit, never restated as a
   * measured fact and never sent to the catalogue as a signal.
   */
  description: string;
  platforms: ContentPlatform[];
  /**
   * Step 2: the review state.
   *
   * The single source of truth for what becomes a signal. `interests` is NOT a
   * field on the draft any more: a separate list would be a second place to keep
   * in sync with the review items, and the two would eventually disagree about
   * whether an ambiguous phrase had been resolved. `confirmedInterests()` reads
   * this array instead.
   */
  review: ReviewItem[];
  /**
   * The description `review` was last built from.
   *
   * Bookkeeping, not payload: `toAnalyzeInput` never reads it, so it cannot change
   * a cache key. It exists so the review stage can tell "the creator came back to
   * this screen" from "the creator rewrote their description", and re-run the
   * lookup only in the second case. Without it, arriving at the review stage would
   * re-spend a batch of upstream calls on text that has not changed, and changing
   * one character would silently drop every confirmation already made.
   */
  reviewOf: string;
  /** Category ids the creator says they already cover. Derived from the confirmed entities. */
  coveredCategories: string[];
  /** 0..1 per category. Absent means "covered, saturation not stated". */
  saturation: Record<string, number>;
  ageBuckets: QlooAgeBucket[];
  gender: QlooGender | undefined;
  /**
   * A city or region the creator's audience is in, free text.
   *
   * Sent as `location.city` and NEVER as `signal.location.query`. That is a
   * deliberate narrowing of what the old flow did: doc 03 §7 makes a
   * `signal.location.query` that matches no locality a 400, and there is no
   * locality-resolution step anywhere in this app, so a free-text field wired
   * straight to a signal parameter is a way for the creator to take the entire
   * insights call down by typing "DACH". The place is therefore recorded as their
   * own description of their audience, shown as such, and used by no request.
   */
  place: string;
  /**
   * Country name. Profile metadata for the geographic-fit dimension only; it is
   * never a Qloo signal, because doc 03 §10 lists no country signal parameter.
   */
  country: string;
  /**
   * Optional audience context: who the creator says they create for, and what
   * people come to the content for.
   *
   * Four flat fields rather than a nested object, matching `ageBuckets`/`gender`/
   * `place`/`country`: every other capture-stage answer is flat on the draft, and
   * `ContextStage`'s toggles patch one field at a time.
   *
   * These reach the wire and the copy builders, and they change NO number. They are
   * excluded from the staleness key by `analysisIdentity`, because an edit that
   * cannot alter the analysis must not tell the creator their results are stale.
   */
  audienceGroups: AudienceGroup[];
  audiencePurposes: ContentPurpose[];
  /** The creator's own words behind the "Other" group chip. */
  audienceGroupsOther: string;
  /** The creator's own words behind the "Other" purpose chip. */
  audiencePurposesOther: string;
  /** True once the creator has actively declined the optional context step. */
  contextSkipped: boolean;
}

export function emptyDraft(): DraftProfile {
  return {
    displayName: "",
    handle: "",
    description: "",
    platforms: [],
    review: [],
    reviewOf: "",
    coveredCategories: [],
    saturation: {},
    ageBuckets: [],
    gender: undefined,
    place: "",
    country: "",
    audienceGroups: [],
    audiencePurposes: [],
    audienceGroupsOther: "",
    audiencePurposesOther: "",
    contextSkipped: false,
  };
}

/**
 * The short line the results quote as the creator's own description of their work.
 *
 * Derived from `description` rather than asked for separately. The old flow had a
 * dedicated "niche" input, which meant the creator was asked the same question
 * twice in two different vocabularies and the answers routinely disagreed. Taking
 * the first sentence of what they already wrote removes the second question and
 * guarantees the media kit quotes something the creator actually typed.
 *
 * Capped at the schema's 240 characters, cut on a word boundary, with an ellipsis
 * only when something was actually removed.
 */
export function deriveNiche(description: string): string {
  const text = description.trim();
  if (text.length === 0) return "";

  // First sentence, or the whole thing when there is no sentence terminator.
  const boundary = text.search(/[.!?…](?:\s|$)/);
  const sentence = boundary === -1 ? text : text.slice(0, boundary + 1).trim();

  const MAX = 240;
  if (sentence.length <= MAX) return sentence;
  const cut = sentence.slice(0, MAX - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > 0 ? lastSpace : cut.length).trimEnd()}…`;
}

/**
 * The audience facts the creator supplied themselves, and nothing else.
 *
 * CreatorsDNA measures no audience. There is no analytics connection, no platform
 * API read and no follower count anywhere in the pipeline, so every number in this
 * list is one the creator typed into the optional context step. That is what makes
 * it safe to print in a document they hand to a brand: the source is them.
 *
 * `stated` is false when the creator skipped the step or left every field empty,
 * and callers MUST then render nothing rather than a table of blanks. An empty
 * audience section in a media kit reads as "this creator has no audience";
 * omitting it reads as "not measured here", which is the truth.
 *
 * Each line is labelled with where it came from. "Skews male (self-reported)" and
 * "male" are the same words carrying a different amount of liability, and the
 * second one is the version a brand would repeat back as a measured fact.
 *
 * `context` is the audience-context half of the same answers in STRUCTURED form,
 * for the copy builders that have to compose a sentence rather than print a row. A
 * `lines` entry is a finished string; unparsing one back into groups and purposes
 * would be the only way to reach them otherwise, and a builder that splits a display
 * string is a builder that breaks when a label is reworded. Both come from one place.
 */
export function describeAudience(draft: DraftProfile): {
  stated: boolean;
  lines: Array<{ label: string; value: string }>;
  context: AudienceWords | undefined;
} {
  const lines: Array<{ label: string; value: string }> = [];

  const buckets = draft.ageBuckets
    .map((bucket) => AGE_BUCKET_LABEL[bucket])
    .filter((label) => label.trim().length > 0);
  if (buckets.length > 0) {
    lines.push({ label: "Age range", value: `${buckets.join(", ")} (self-reported)` });
  }

  if (draft.gender !== undefined) {
    lines.push({
      label: "Gender skew",
      value: `${GENDER_WORD[draft.gender]} (self-reported)`,
    });
  }

  const place = draft.place.trim();
  if (place.length > 0) {
    lines.push({ label: "Where they are", value: `${place} (creator's own description)` });
  }

  // Audience context. Rendered here rather than through `draftAudienceWords`
  // because a document a brand reads has to keep a category the creator TICKED
  // apart from a phrase they TYPED, and folding the two into one comma list
  // promotes their free text to the same standing as a label we defined. Quoting
  // it and naming its source is the same distinction `place` already draws with
  // "(creator's own description)".
  const audienceLine = (
    label: string,
    ticked: string[],
    otherSelected: boolean,
    ownWords: string,
  ): void => {
    const own = otherSelected ? ownWords.trim() : "";
    const words = own.length > 0 ? [...ticked, `"${own}" (their own words)`] : ticked;
    if (words.length === 0) return;
    lines.push({ label, value: `${words.join(", ")} (self-reported)` });
  };

  audienceLine(
    "Who they create for",
    draft.audienceGroups
      .filter((group) => group !== "other")
      .map((group) => AUDIENCE_GROUP_LABEL[group]),
    draft.audienceGroups.includes("other"),
    draft.audienceGroupsOther,
  );
  audienceLine(
    "What people come for",
    draft.audiencePurposes
      .filter((purpose) => purpose !== "other")
      .map((purpose) => CONTENT_PURPOSE_LABEL[purpose]),
    draft.audiencePurposes.includes("other"),
    draft.audiencePurposesOther,
  );

  return { stated: lines.length > 0, lines, context: draftAudienceWords(draft) };
}

/**
 * The draft's audience-context answers as one block, or `undefined` when the
 * creator answered neither question.
 *
 * Omitted as a block rather than sent empty, for the reason `toAnalyzeInput`'s own
 * header gives for demographics. The "Other" text is dropped unless its chip is
 * still selected: a string left in the field after the creator un-ticked "Other"
 * is not a statement they made about their audience, and rendering it back to them
 * as one is the failure this guards.
 */
function draftAudienceContext(draft: DraftProfile): AudienceContext | undefined {
  if (draft.audienceGroups.length === 0 && draft.audiencePurposes.length === 0) return undefined;

  const groupsOther = draft.audienceGroupsOther.trim();
  const purposesOther = draft.audiencePurposesOther.trim();

  return {
    groups: draft.audienceGroups,
    purposes: draft.audiencePurposes,
    groupsOther:
      draft.audienceGroups.includes("other") && groupsOther.length > 0 ? groupsOther : undefined,
    purposesOther:
      draft.audiencePurposes.includes("other") && purposesOther.length > 0
        ? purposesOther
        : undefined,
  };
}

/**
 * The draft's audience context as display words, for the copy builders.
 *
 * Resolved through `audienceContextWords` so there is exactly one place that turns
 * ids into labels, and so `lib/copy/generate.ts` can stay `import type`-only: it
 * receives words and never needs the label maps. `undefined` means "the creator
 * said nothing", and every consumer must then render exactly what it rendered
 * before this feature existed.
 */
export function draftAudienceWords(draft: DraftProfile): AudienceWords | undefined {
  return audienceContextWords(draftAudienceContext(draft));
}

/**
 * The draft's Content DNA: how this creator says they express themselves.
 *
 * Derived, not captured. Every value below comes from a field the creator already
 * filled in for another purpose, so this adds NO question to the flow:
 *
 *   - `topics`   — the labels behind `coveredCategories`, the categories they said
 *                  they already make work in.
 *   - `angles`   — `audiencePurposes`, the same answer Audience Context reads as a
 *                  reason to watch, read here as a form of expression.
 *   - `formats`  — `platforms`.
 *
 * The reuse of the purposes answer is deliberate and is the reason no second chip
 * set was added: the vocabulary the brief suggests for "content angle" is the
 * vocabulary `CONTENT_PURPOSES` already contains, and asking the creator to tick
 * "Tutorials and practical guidance" twice in two framings would produce two answers
 * that eventually disagree. What is new is the TYPE, so a builder can tell a claim
 * about the maker from a claim about the audience.
 *
 * Returns `undefined` when nothing supports one, rather than an all-empty object, for
 * the reason `audienceContextWords` gives: every caller's first act is a truthiness
 * check and an empty object is truthy.
 *
 * NOT EVIDENCE, and not on the wire. This reads only fields the draft already sends
 * (`coverage`, `platforms`) or already keeps off the analysis (`audience`), so it
 * adds no payload field, changes no `analysisCacheKey` input and cannot change
 * `analysisIdentity` — an edit here that moves nothing but the positioning phrase must
 * not tell the creator their results are stale.
 */
export function describeContent(draft: DraftProfile): ContentDna | undefined {
  const topics = [
    ...new Set(
      draft.coveredCategories
        // Filtered on the id, BEFORE labelling: `categoryLabel("")` returns
        // "Uncategorised" rather than "", so a blank entry would otherwise arrive as a
        // topic the creator never named. A missing category stays missing.
        .filter((category) => category.trim().length > 0)
        .map((category) => categoryLabel(category)),
    ),
  ];

  const angles = draft.audiencePurposes
    .filter((purpose) => purpose !== "other")
    .map((purpose) => CONTENT_PURPOSE_LABEL[purpose]);
  // Same rule as `audienceContextWords`: the "Other" chip is a control that reveals a
  // text field, not an answer, so what it contributes is the creator's own phrase —
  // and if they typed nothing, nothing.
  const otherAngle = draft.audiencePurposes.includes("other")
    ? draft.audiencePurposesOther.trim()
    : "";
  if (otherAngle.length > 0) angles.push(otherAngle);

  // The FIRST ticked purpose that has a form, in the creator's own order. One phrase
  // rather than a list because the consumer is a collaboration idea, and "a practical
  // walkthrough, or an explainer, or a story-led piece" describes nobody.
  const approach = draft.audiencePurposes
    .map((purpose) => CONTENT_PURPOSE_APPROACH[purpose])
    .find((phrase) => phrase !== undefined);

  const formats = draft.platforms.map((platform) => PLATFORM_LABEL[platform]);

  if (topics.length === 0 && angles.length === 0 && formats.length === 0) return undefined;
  const method = contentMethod(topics, angles);
  return {
    topics,
    angles,
    approach,
    formats,
    method,
    positioning: contentPositioning(method, formats),
  };
}

/**
 * What the work is and how it is made, with no format tail.
 *
 * Capped per part rather than per character: a creator who ticked all nine purposes
 * and declared every category still gets a phrase a human can read in one pass,
 * which is what "concise positioning summary" asks for. The uncapped arrays stay on
 * the type for any surface that would rather render them as a list.
 *
 * The angle leads when there is one, because "how" is the half of Content DNA that
 * distinguishes two creators in the same cultural world — two people covering Films
 * differ by whether they make explainers or story-led pieces, and a phrase that led
 * with the topic would read identically for both.
 *
 * ONE angle, not two. Every `CONTENT_PURPOSE_LABEL` phrase already contains "and"
 * ("Tutorials and practical guidance"), so joining two of them with "and" produces
 * "A and B and C" and the reader cannot tell what the list was. It also matches
 * `approach`, which takes the first tick for the same reason: one form of piece
 * describes a creator, three describes nobody.
 */
function contentMethod(topics: readonly string[], angles: readonly string[]): string | undefined {
  const focus = topics.slice(0, 3);
  const method = angles[0];
  if (method === undefined) {
    return focus.length > 0 ? `work covering ${joinWords(focus)}` : undefined;
  }
  return focus.length > 0 ? `${method}, covering ${joinWords(focus)}` : method;
}

/**
 * The synthesis `ContentDna.positioning` carries: `contentMethod` plus the formats.
 *
 * Subjectless on purpose — see the type's own note. Each surface adds its own
 * pronoun, so one phrase serves the second-person results screen, the third-person
 * media kit and the first-person pitch without three compositions drifting apart.
 *
 * Built FROM `method` rather than beside it so the two can never disagree about the
 * creator: `positioning` is exactly `method` with a tail appended, which is what lets
 * the pitch print the shorter one without recomposing it.
 */
function contentPositioning(
  method: string | undefined,
  formats: readonly string[],
): string | undefined {
  const surfaces = formats.slice(0, 3);
  const tail = surfaces.length > 0 ? `published on ${joinWords(surfaces)}` : undefined;
  if (method === undefined) return tail;
  return tail === undefined ? method : `${method}, ${tail}`;
}

/**
 * "A", "A and B", "A, B and C".
 *
 * A local copy rather than an import. The only other implementation is private to
 * `lib/copy/generate.ts`, and this module must not depend on the copy layer — the
 * dependency runs the other way, with the copy layer importing TYPES from the
 * contracts this file reads. Six lines is cheaper than inverting it.
 */
function joinWords(words: readonly string[]): string {
  if (words.length === 0) return "";
  if (words.length === 1) return words[0]!;
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/**
 * The gender word as a fact rather than as a form label.
 *
 * `ContextStage` has its own copy of this map for its radio buttons, which is a
 * small deliberate duplication: that one says "Skews male" as an option the
 * creator picks, and inventing a shared constant would couple a form label to a
 * document line. Keyed by the closed union with no fallback, so a new gender is a
 * compile error here rather than a raw id printed into a media kit.
 */
const GENDER_WORD: Record<QlooGender, string> = {
  male: "skews male",
  female: "skews female",
};

/**
 * The minimum a draft needs before it can be analysed.
 *
 * Deliberately small. Doc 01 §29's whole pitch is "no account, just go", and a
 * form that demands a handle, a niche, a platform list and a location before it
 * will run is the opposite of that.
 *
 * ZERO CONFIRMED ENTITIES IS NOT A BLOCKER. That is a change from the old flow,
 * where "at least one interest" gated the Analyze button. Gating it here would
 * make the honest no-signal outcome unreachable: the pipeline is built to return
 * `hasSignals === false` and a guided L4 recovery screen that explains what to
 * add, and a disabled button gives the creator none of that explanation. The
 * review stage shows the count and what it means; the pipeline shows the
 * consequence.
 *
 * What DOES block is unreviewed ambiguity — `needsDecision()` items — because
 * submitting while the creator has an unanswered choice in front of them would
 * send a signal set they never agreed to.
 */
export function draftBlockers(draft: DraftProfile): string[] {
  const blockers: string[] = [];
  if (draft.displayName.trim().length === 0) {
    blockers.push("A display name, so the results and the media kit can be addressed to you.");
  }
  if (draft.description.trim().length === 0 && draft.review.length === 0) {
    blockers.push(
      "A description of your work, or at least one entity added by hand. Without either there is nothing to analyse.",
    );
  }

  const undecided = draft.review.filter(needsDecision);
  if (undecided.length > 0) {
    blockers.push(
      `${undecided.length} phrase${undecided.length === 1 ? "" : "s"} still need${
        undecided.length === 1 ? "s" : ""
      } a decision: ${undecided
        .map((item) => `"${item.phrase}"`)
        .join(", ")}. Confirm the right match or reject it — choosing for you would ` +
        `make every number downstream describe something you did not mean.`,
    );
  }
  return blockers;
}

/**
 * Non-blocking things worth saying before the creator commits.
 *
 * Separate from `draftBlockers` because these are consequences rather than
 * mistakes. Zero confirmed entities is legal and produces the honest no-signal
 * state; the creator should still know that is what is about to happen rather
 * than discovering it on the results screen.
 */
export function draftWarnings(draft: DraftProfile): string[] {
  const warnings: string[] = [];
  if (confirmedInterests(draft.review).length === 0) {
    warnings.push(
      "No entity is confirmed, so nothing personalised can be derived. You can still analyse: " +
        "the result will say plainly that there were no signals, rather than showing you a " +
        "plausible-looking answer built from nothing.",
    );
  }
  if (draft.coveredCategories.length === 0) {
    warnings.push(
      "No coverage declared. Categories you said nothing about are assumed uncovered and labelled " +
        "as ours, not as your answer.",
    );
  }
  if (draft.country.trim().length === 0) {
    warnings.push(
      "No country given, so the geographic dimension is omitted and its weight redistributed " +
        "across the dimensions that could be evidenced.",
    );
  }
  return warnings;
}

/**
 * Draft → wire.
 *
 * Empty optional strings are dropped rather than sent as `""`, because the schema
 * validates them with `.trim().min(1)` and a default only applies to `undefined`.
 * Sending `handle: ""` would therefore be a 400, and the creator would be told
 * their form was invalid when it was in fact simply not filled in.
 *
 * Demographics are omitted as a block when nothing was declared. Sending
 * `{ ageBuckets: [] }` would make `audienceFitEvidence` take its "you provided no
 * demographics" branch either way, but omitting it keeps the cached analysis key
 * identical for two creators who both declined — which is the difference between
 * one cache entry and two.
 *
 * `saturation` keys go through `normaliseCategory`, the SAME function
 * `coverageWithBasis()` uses on the other side of the wire. This is not tidiness:
 * a raw key misses the lookup, and the coverage then falls back to "listed as
 * covered", which is coverage 1. A creator who said they only occasionally cover
 * a subject would be plotted as saturated and their own untapped opportunity
 * would vanish from the chart, with nothing anywhere reporting an error.
 *
 * `interests` comes from `confirmedInterests(draft.review)` and `contextTerms`
 * from `contextTermsFrom(draft.review)`. The two are complements by construction:
 * an item with a `confirmed` interest is a signal, and every other item is context
 * only. Nothing the creator typed can end up in neither list, and nothing
 * unconfirmed can end up in the first.
 *
 * `location` is omitted as a block unless a place or a country was given. `place`
 * becomes `city` and `country` becomes `country`; NEITHER populates `query`.
 * Doc 03 §7 makes a `signal.location.query` that matches no locality a 400, so a
 * free-text place sent there could take the whole insights call down with it. With
 * no `query` and no `localityId`, `toSignalBlock` drops the location block entirely
 * and the geographic dimension runs off the country comparison alone — which is the
 * only comparison the returned brand data actually supports.
 */
export function toAnalyzeInput(draft: DraftProfile): AnalyzeInput {
  const handle = draft.handle.trim();
  const description = draft.description.trim();
  const niche = deriveNiche(description);
  const place = draft.place.trim();
  const country = draft.country.trim();
  const hasDemographics = draft.ageBuckets.length > 0 || draft.gender !== undefined;

  const saturation: Record<string, number> = {};
  for (const [category, value] of Object.entries(draft.saturation)) {
    const key = normaliseCategory(category);
    if (key.length === 0) continue;
    saturation[key] = value;
  }

  return {
    displayName: draft.displayName.trim(),
    handle: handle.length > 0 ? handle : undefined,
    platforms: draft.platforms,
    niche: niche.length > 0 ? niche : undefined,
    description: description.length > 0 ? description : undefined,
    interests: confirmedInterests(draft.review).map((interest) => ({
      query: interest.query,
      entityId: interest.entityId,
      name: interest.name,
      subtype: interest.subtype,
      disambiguation: interest.disambiguation,
      emphasis: interest.emphasis,
    })),
    contextTerms: contextTermsFrom(draft.review),
    coverage: {
      coveredCategories: draft.coveredCategories,
      saturation,
    },
    demographics: hasDemographics
      ? { ageBuckets: draft.ageBuckets, gender: draft.gender }
      : undefined,
    location:
      place.length > 0 || country.length > 0
        ? {
            city: place.length > 0 ? place : undefined,
            country: country.length > 0 ? country : undefined,
          }
        : undefined,
    audience: draftAudienceContext(draft),
  };
}

/**
 * The part of a payload that decides what the analysis WILL BE.
 *
 * `audience` is removed, and the removal is the whole point. Audience context
 * changes no signal, no intersection, no fit score and nothing stored on the
 * analysis — every consumer of it is a render-time copy builder reading the draft
 * the creator is holding. So including it in the staleness key would fire the
 * banner reading "These results no longer match the form… nothing here reflects
 * your latest edits until you re-run" for an edit that provably cannot change a
 * single number. That is a false statement on screen, and it also spends a re-run —
 * and upstream quota — to obtain a byte-identical analysis.
 *
 * Both sides of the comparison must go through this function or the key they were
 * built from differs and the banner fires permanently. `AnalyzeFlow` applies it at
 * `draftKey` and at `setResponseKey`, which is why the rule lives here rather than
 * at either call site.
 *
 * `analysisCacheKey` needs no equivalent change: it reads named profile fields
 * rather than spreading the profile, so a field it does not mention is already
 * outside the key.
 */
export function analysisIdentity(payload: AnalyzeInput): Omit<AnalyzeInput, "audience"> {
  const { audience: _audience, ...identity } = payload;
  return identity;
}

/**
 * Validate the outgoing payload with the SAME schema the route uses.
 *
 * `src/lib/api/schemas.ts` is not `server-only` for exactly this reason, and its
 * own header says so: duplicating the limits in a client component is how a form
 * comes to accept input the API then rejects. Returning the issues as sentences
 * means the creator is told what to fix before a request is spent.
 */
export function validateDraft(draft: DraftProfile): { ok: true } | { ok: false; problems: string[] } {
  const result = analyzeBodySchema.safeParse(toAnalyzeInput(draft));
  if (result.success) return { ok: true };
  return {
    ok: false,
    problems: result.error.issues.map(
      (issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`,
    ),
  };
}

// ---------------------------------------------------------------------------
// The response
// ---------------------------------------------------------------------------

/**
 * What `POST /api/analyze` returns.
 *
 * Mirrors the route's `CachedAnalysis` plus the `notices` the route appends from
 * the current provider context. Declared here rather than exported from the route
 * module: importing a type from a route handler file into a client component is
 * legal but invites importing a value from it, and a route handler must never end
 * up in a browser bundle.
 */
export interface AnalyzeResponse {
  analysis: CreatorAnalysis;
  failures: PipelineFailure[];
  hasSignals: boolean;
  degradations: string[];
  renderable: boolean;
  source: DataSource;
  generatedAt: string;
  cached: boolean;
  notices: string[];
}

export interface AnalyzeError {
  message: string;
  /** HTTP status when the failure came from the route; absent for a network fault. */
  status?: number;
}

/**
 * `L4` means DO NOT RENDER.
 *
 * The route still returns 200 with an empty Taste DNA, because the creator needs
 * to see WHY rather than a spinner that never resolves (doc 02 §24, doc 04 §4.5).
 * This is the single predicate the flow uses to decide between the results stages
 * and the hard-fail state, so that decision is made in one place.
 */
export function isHardFail(response: AnalyzeResponse): boolean {
  return response.analysis.fallbackLevel === "L4" || !response.renderable;
}
