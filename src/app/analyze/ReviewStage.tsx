"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { SearchEntity } from "@/components/domain/SearchEntity";
import { DnaSpinner } from "@/components/ui/DnaSpinner";
import { extractCandidateTerms } from "@/lib/analysis/extractTerms";
import { EmphasisControl } from "./CaptureStages";

import type { DataSource } from "@/lib/contracts/domain";
import type { ResolveEntry, ResolveResponse } from "@/lib/api/resolve";
import type { CandidateStrategy } from "@/lib/analysis/extractTerms";
import type { CaptureStageProps } from "./CaptureStages";
import type { Emphasis, ReviewItem, SearchMatch } from "./flowTypes";
import {
  confirmReviewItem,
  manualReviewItem,
  mergeReview,
  rejectReviewItem,
  removeReviewItem,
  resetReviewItem,
  reviewItemFromEntry,
  reviewSummary,
  setReviewEmphasis,
} from "./flowTypes";

/**
 * Stage 3 — "Review what we found".
 *
 * This is the stage the old flow did not have, and its absence was the reason
 * most analyses came back empty. The previous `interests` stage sent whatever the
 * creator typed to an unscoped `/search` and accepted it only when EXACTLY one
 * entity matched. "Dream pop" matches a genre tag, several artists and an album;
 * "Dune" matches a film, a novel and at least two bands. So the default outcome of
 * using the product as designed was that the input was quietly discarded and the
 * creator was shown a thin result with no indication that anything had been lost.
 *
 * Here every candidate phrase is looked up and every answer is SHOWN:
 *
 *   - exactly one match is pre-confirmed, because there is nothing to choose
 *     between — but it is still rendered as a decision with a reject control, so
 *     "we accepted the only match" is visible and reversible rather than silent;
 *   - several matches are listed with their types and disambiguations, and the
 *     creator picks one. Until they do, the phrase is NOT a signal and the Analyze
 *     button is blocked with a reason naming it;
 *   - no match is labelled "Not in the catalogue" and kept as context. It is
 *     reported back through `CreatorAnalysis.contextTerms`, contributes nothing to
 *     any request, and is never presented as if it had;
 *   - a failed lookup is labelled as a failure with a retry, and is never folded
 *     into "no match" — the two mean different things and only one is retryable.
 *
 * The creator can also search for something the extraction missed, or type a
 * phrase by hand. Both paths land in the same list under the same rules.
 */

/** Matches requested per phrase. Doc 02 §32: a sensible limit, not the maximum. */
const TAKE = 6;

type Busy = "idle" | "resolving";

export function ReviewStage({ draft, patch }: CaptureStageProps) {
  const [busy, setBusy] = useState<Busy>("idle");
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const [source, setSource] = useState<DataSource | undefined>(undefined);
  const [manualPhrase, setManualPhrase] = useState("");
  /** Guards the mount effect against a second resolve of the same description. */
  const inFlight = useRef(false);

  const description = draft.description;

  /**
   * Resolve a batch of phrases and fold the answers into the existing review.
   *
   * `mergeReview` rather than a replacement: re-running a lookup after the creator
   * has confirmed three entities must not undo those confirmations, and it must not
   * resurrect a match the catalogue no longer offers either.
   */
  const resolve = useCallback(
    async (phrases: readonly string[]) => {
      const unique = [...new Set(phrases.map((phrase) => phrase.trim()).filter(Boolean))];
      if (unique.length === 0) return;

      inFlight.current = true;
      setBusy("resolving");
      setFailure(undefined);
      try {
        const response = await fetch("/api/qloo/resolve", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ phrases: unique, take: TAKE }),
        });

        if (!response.ok) {
          setFailure(await readMessage(response));
          return;
        }

        let body: unknown;
        try {
          body = await response.json();
        } catch {
          setFailure("The response was not valid JSON. Nothing was invented in its place.");
          return;
        }

        // Structural guard. A proxy, an auth wall or a hosting error page can all
        // return HTML with a 200, and `body.results.map` on that would throw during
        // render instead of telling the creator the lookup did not complete.
        if (!isResolveResponse(body)) {
          setFailure("The response did not contain a resolve result set.");
          return;
        }

        setSource(body.source);
        const strategies = new Map<string, CandidateStrategy | "manual">();
        for (const item of draft.review) strategies.set(item.phrase, item.strategy);
        patch({
          review: mergeReview(draft.review, body.results, strategies),
          reviewOf: description,
        });
      } catch (cause) {
        setFailure(
          cause instanceof TypeError
            ? "The catalogue could not be reached. Your description is still here, unchanged."
            : "The lookup was interrupted. Your description is still here, unchanged.",
        );
      } finally {
        inFlight.current = false;
        setBusy("idle");
      }
    },
    // `draft.review` and `description` are read inside, so both belong in the
    // dependency list even though `patch` is the only thing written.
    [draft.review, description, patch],
  );

  /**
   * Resolve on arrival, and again only if the description has changed since the
   * list was built.
   *
   * `draft.reviewOf` records what the current list was derived from. Without it,
   * navigating back and forth between describe and review would re-spend a batch
   * of upstream calls on every arrival, and editing one character would silently
   * discard the creator's confirmations.
   */
  useEffect(() => {
    if (inFlight.current || busy !== "idle") return;
    if (draft.reviewOf === description && description.trim().length > 0) return;
    const candidates = extractCandidateTerms(description);
    if (candidates.length === 0) {
      // Nothing to look up. Recording the description as reviewed stops the effect
      // re-running on every render; the empty state below explains it to the creator.
      patch({ reviewOf: description });
      return;
    }
    void resolve(candidates.map((candidate) => candidate.term));
    // Deliberately narrow: the effect's job is to react to arriving with an
    // unreviewed description, not to re-run whenever any review state changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [description, draft.reviewOf]);

  const candidates = extractCandidateTerms(description);

  function addManual(): void {
    const phrase = manualPhrase.trim();
    if (phrase.length === 0 || phrase.length > 120) return;
    if (draft.review.some((item) => item.phrase.toLowerCase() === phrase.toLowerCase())) return;
    patch({ review: [...draft.review, manualReviewItem(phrase)] });
    setManualPhrase("");
    void resolve([phrase]);
  }

  /** A search hit from the review screen's own box becomes a confirmed item. */
  function addFromSearch(match: SearchMatch): void {
    const phrase = match.entity.name;
    const entry: ResolveEntry = { phrase, status: "matched", matches: [match] };
    const existing = draft.review.some(
      (item) =>
        item.phrase.toLowerCase() === phrase.toLowerCase() ||
        item.confirmed?.entityId === match.entity.id,
    );
    if (existing) return;
    patch({ review: [...draft.review, reviewItemFromEntry(entry, "manual")] });
  }

  function confirm(phrase: string, match: SearchMatch): void {
    patch({ review: confirmReviewItem(draft.review, phrase, match) });
  }

  function setEmphasis(phrase: string, emphasis: Emphasis): void {
    patch({ review: setReviewEmphasis(draft.review, phrase, emphasis) });
  }

  const summary = reviewSummary(draft.review);
  const contextOnly = draft.review.filter((item) => item.confirmed === undefined);
  const unlookedUp = candidates.filter(
    (candidate) =>
      !draft.review.some((item) => item.phrase.toLowerCase() === candidate.term.toLowerCase()),
  );

  return (
    <div className="cd-onboard__stage-body">
      <h2 className="cd-onboard__title">Review what we found</h2>
      {/* §1.2. The chips below already name WHERE each phrase came from, so this
          says only what they cannot: that the extraction is structural and not a
          model's opinion. Naming the catalogue generically rather than as "Qloo's"
          is deliberate — the badge underneath reports which source actually
          answered, and in development that is the synthetic one. */}
      <p className="cd-onboard__lede cd-measure">
        Possible interests are picked out of your description by its wording — what you quoted,
        capitalised, hashtagged or listed. Not AI-generated recommendations: nothing interprets your
        text for meaning, and the chip beside each phrase names the structure it came from. Each is
        looked up in the catalogue; only what you confirm becomes a signal.
      </p>

      {source ? (
        <p
          className={
            source.isIllustrative
              ? "cd-datasource cd-datasource--synthetic"
              : "cd-datasource cd-datasource--live"
          }
        >
          <span className="cd-datasource__label">{source.label}</span>
          <span className="cd-datasource__body">
            {source.isIllustrative
              ? "Generated for development — NOT real catalogue results. Nothing below should be read as a fact about a real entity."
              : "Returned by the live catalogue. Every match is a real entry, typed as the catalogue typed it."}
          </span>
        </p>
      ) : null}

      {draft.review.length > 0 ? (
        <ul className="cd-onboard__summary" aria-live="polite">
          <li>
            <strong className="cd-tabular">{summary.confirmed}</strong> confirmed
          </li>
          <li>
            <strong className="cd-tabular">{summary.ambiguous}</strong> need a choice
          </li>
          <li>
            <strong className="cd-tabular">{summary.unmatched}</strong> not in the catalogue
          </li>
          {summary.failed > 0 ? (
            <li>
              <strong className="cd-tabular">{summary.failed}</strong> lookup failed
            </li>
          ) : null}
          {summary.rejected > 0 ? (
            <li>
              <strong className="cd-tabular">{summary.rejected}</strong> rejected by you
            </li>
          ) : null}
        </ul>
      ) : null}

      {failure ? (
        <p className="cd-onboard__warning" role="alert">
          {failure} Nothing was discarded — the phrases are still listed.
          <button
            type="button"
            className="cd-button cd-button--ghost cd-button--sm"
            disabled={busy === "resolving"}
            onClick={() => void resolve(draft.review.map((item) => item.phrase))}
          >
            Try again
          </button>
        </p>
      ) : null}

      {busy === "resolving" ? (
        <div className="cd-onboard__resolving" role="status">
          <DnaSpinner size={30} />
          <p className="cd-onboard__note">Looking these up in the catalogue…</p>
        </div>
      ) : null}

      {draft.review.length === 0 && busy === "idle" ? (
        <p className="cd-onboard__warning" role="status">
          {candidates.length === 0
            ? "We could not spot any names in your description to look up. Not a failure — it usually means the description is written in general terms. Add a specific artist, brand, game, film or product below."
            : "Nothing has been looked up yet."}
        </p>
      ) : null}

      {draft.review.length > 0 ? (
        <ul className="cd-onboard__list">
          {draft.review.map((item) => (
            <ReviewRow
              key={`${item.phrase}|${item.confirmed?.entityId ?? "none"}`}
              item={item}
              disabled={busy === "resolving"}
              onConfirm={(match) => confirm(item.phrase, match)}
              onReject={() => patch({ review: rejectReviewItem(draft.review, item.phrase) })}
              onReset={() => patch({ review: resetReviewItem(draft.review, item.phrase) })}
              onRemove={() => patch({ review: removeReviewItem(draft.review, item.phrase) })}
              onRetry={() => void resolve([item.phrase])}
              onEmphasis={(emphasis) => setEmphasis(item.phrase, emphasis)}
            />
          ))}
        </ul>
      ) : null}

      {unlookedUp.length > 0 ? (
        <p className="cd-onboard__note">
          {unlookedUp.length} phrase{unlookedUp.length === 1 ? "" : "s"} from your description
          {unlookedUp.length === 1 ? " has" : " have"} not been looked up yet.
          <button
            type="button"
            className="cd-button cd-button--ghost cd-button--sm"
            disabled={busy === "resolving"}
            onClick={() => void resolve(unlookedUp.map((candidate) => candidate.term))}
          >
            Look {unlookedUp.length === 1 ? "it" : "them"} up
          </button>
        </p>
      ) : null}

      <section className="cd-onboard__block" aria-labelledby="review-missing">
        <h3 className="cd-onboard__subtitle" id="review-missing">
          Something we missed?
        </h3>
        <p className="cd-onboard__hint">
          Extraction is structural — quoting, capitalisation, hashtags and lists — so it misses
          names written in lower case or phrased oddly. Searching adds a real catalogue entity
          straight to the confirmed set; typing a phrase adds it to the list under the same rules.
        </p>

        <SearchEntity
          id="review-search"
          label="Search the catalogue"
          take={8}
          hint="Type at least two characters. When several entries match, all are listed and you choose."
          onSelect={addFromSearch}
        />

        <div className="cd-onboard__field">
          <label className="cd-onboard__label" htmlFor="review-manual">
            Or look up a phrase yourself
          </label>
          <span className="cd-onboard__inline">
            <input
              id="review-manual"
              className="cd-input"
              type="text"
              value={manualPhrase}
              maxLength={120}
              placeholder="Regional rail photography"
              onChange={(event) => setManualPhrase(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addManual();
                }
              }}
            />
            <button
              type="button"
              className="cd-button cd-button--ghost"
              onClick={addManual}
              disabled={manualPhrase.trim().length === 0 || busy === "resolving"}
            >
              Look up
            </button>
          </span>
        </div>
      </section>

      <section className="cd-onboard__block" aria-labelledby="review-context">
        <h3 className="cd-onboard__subtitle" id="review-context">
          Kept as context only{" "}
          <span className="cd-onboard__subtitle-note">
            <span className="cd-tabular">{contextOnly.length}</span> phrase
            {contextOnly.length === 1 ? "" : "s"}
          </span>
        </h3>
        <p className="cd-onboard__hint">
          Things you wrote that are NOT confirmed entities: unmatched, rejected, still ambiguous, or
          a failed lookup. They are listed back to you in the results and contribute no number. They
          are never sent as entity signals — that is how an analysis comes to describe something
          other than what you meant.
        </p>
        {contextOnly.length > 0 ? (
          <ul className="cd-onboard__toggles">
            {contextOnly.map((item) => (
              <li key={item.phrase} className="cd-chip">
                {item.phrase}
                <span className="cd-onboard__strategy">{VERDICT[item.status].short}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {summary.confirmed === 0 ? (
        <p className="cd-onboard__warning" role="status">
          Nothing is confirmed yet, so there is nothing personalised to derive. You can still run
          it: the result will say plainly that there were no signals, rather than showing a
          plausible answer built from nothing.
        </p>
      ) : null}
    </div>
  );
}

/**
 * The four catalogue verdicts, plus the pre-lookup state.
 *
 * `short` is what the context-only chip shows; `word` is the row's verdict badge;
 * `state` drives the card's edge treatment. Wording matters here: "Not in the
 * catalogue" and "Lookup failed" are different facts with different remedies, and
 * the old flow had one label — or none — for both.
 */
const VERDICT = {
  pending: { word: "Not looked up yet", short: "not looked up", state: "pending" },
  matched: { word: "One match", short: "matched", state: "matched" },
  multiple: { word: "Several matches", short: "ambiguous", state: "ambiguous" },
  none: { word: "Not in the catalogue", short: "unmatched", state: "none" },
  error: { word: "Lookup failed", short: "lookup failed", state: "error" },
} as const satisfies Record<ReviewItem["status"], { word: string; short: string; state: string }>;

const STRATEGY_LABEL: Record<CandidateStrategy | "manual", string> = {
  quoted: "you quoted it",
  hashtag: "from a hashtag",
  capitalised: "capitalised in your text",
  enumerated: "from a list in your text",
  manual: "added by you",
};

function ReviewRow({
  item,
  disabled,
  onConfirm,
  onReject,
  onReset,
  onRemove,
  onRetry,
  onEmphasis,
}: {
  item: ReviewItem;
  disabled: boolean;
  onConfirm: (match: SearchMatch) => void;
  onReject: () => void;
  onReset: () => void;
  onRemove: () => void;
  onRetry: () => void;
  onEmphasis: (emphasis: Emphasis) => void;
}) {
  const verdict = VERDICT[item.status];
  // `rejected` outranks everything: a phrase the creator turned down is not
  // "several matches", it is a decision already made. Otherwise a confirmed item
  // reads as confirmed and an undecided one keeps the verdict's own treatment,
  // which is what makes the dashed edge mean "needs you".
  const state = item.rejected
    ? "rejected"
    : item.confirmed !== undefined
      ? "confirmed"
      : verdict.state;

  return (
    <li className="cd-onboard__item" data-state={state} data-resolved={item.confirmed !== undefined}>
      <span className="cd-onboard__item-main">
        <span className="cd-onboard__phrase" data-rejected={item.rejected}>
          {item.phrase}
        </span>
        <span className="cd-onboard__strategy">{STRATEGY_LABEL[item.strategy]}</span>
        <span className="cd-onboard__verdict">
          {item.rejected ? "Rejected by you" : verdict.word}
        </span>
      </span>

      {/* Every match is listed, never truncated to the top hit. Doc 02 §7: when
          several entities match, the creator chooses, because choosing for them
          would make every number downstream describe a different thing than the
          thing they asked about — and the error would be invisible, since the
          result would still look plausible. */}
      {item.matches.length > 0 ? (
        <ul className="cd-onboard__matches">
          {item.matches.map((match) => {
            const selected = item.confirmed?.entityId === match.entity.id;
            return (
              <li key={match.entity.id}>
                <button
                  type="button"
                  className="cd-onboard__match"
                  aria-pressed={selected}
                  disabled={disabled}
                  onClick={() => onConfirm(match)}
                >
                  <span className="cd-onboard__match-name">{match.entity.name}</span>
                  {match.entity.subtype ?? match.entity.type ? (
                    <span className="cd-onboard__match-type">
                      {match.entity.subtype ?? match.entity.type}
                    </span>
                  ) : null}
                  {match.entity.disambiguation ? (
                    <span className="cd-onboard__match-disambig">
                      {match.entity.disambiguation}
                    </span>
                  ) : null}
                  {match.entity.releaseYear ? (
                    <span className="cd-onboard__match-type cd-tabular">
                      {match.entity.releaseYear}
                    </span>
                  ) : null}
                  <span className="cd-sr-only">
                    {selected
                      ? " — this is the match you confirmed"
                      : " — confirm this match for the phrase"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      {item.status === "none" ? (
        <p className="cd-onboard__hint">
          The catalogue has no entry for that exact wording — common for genres, scenes, formats and
          recent releases. The phrase stays as context; if a specific artist, album, show, game,
          book or brand is behind it, search for that instead.
        </p>
      ) : null}

      {item.status === "error" ? (
        <p className="cd-onboard__hint">
          {item.message ?? "The lookup did not complete."} Not the same as “no match”: we do not
          know whether the catalogue has an entry, so nothing is claimed either way.
        </p>
      ) : null}

      {item.status === "multiple" && item.confirmed === undefined ? (
        <p className="cd-onboard__hint">
          Several entries match. Pick the one you meant — until you do, this phrase contributes
          nothing and the analysis cannot be run.
        </p>
      ) : null}

      {item.confirmed !== undefined ? (
        <EmphasisControl
          value={item.confirmed.emphasis}
          label={`How central is “${item.confirmed.name ?? item.phrase}” to your work?`}
          onChange={onEmphasis}
        />
      ) : null}

      <span className="cd-onboard__actions-row">
        {item.confirmed !== undefined || item.rejected ? (
          <button
            type="button"
            className="cd-button cd-button--quiet cd-button--xs"
            disabled={disabled}
            onClick={onReset}
          >
            Clear my decision
            <span className="cd-sr-only"> on {item.phrase}</span>
          </button>
        ) : null}

        {item.confirmed !== undefined && !item.rejected ? (
          <button
            type="button"
            className="cd-button cd-button--quiet cd-button--xs"
            disabled={disabled}
            onClick={onReject}
          >
            Not this one
            <span className="cd-sr-only"> — reject the match for {item.phrase}</span>
          </button>
        ) : null}

        {item.status === "error" ? (
          <button
            type="button"
            className="cd-button cd-button--quiet cd-button--xs"
            disabled={disabled}
            onClick={onRetry}
          >
            Retry lookup
            <span className="cd-sr-only"> of {item.phrase}</span>
          </button>
        ) : null}

        <button
          type="button"
          className="cd-button cd-button--quiet cd-button--xs"
          disabled={disabled}
          onClick={onRemove}
        >
          Remove
          <span className="cd-sr-only"> {item.phrase} from the review list</span>
        </button>
      </span>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Response handling
// ---------------------------------------------------------------------------

/**
 * Structural guard on the resolve response.
 *
 * Checked field by field rather than by a schema, because this is a client
 * component and shipping zod into the browser chunk to validate one route's reply
 * costs more than the twelve lines below. `matches` is validated as an array and
 * each match as an object carrying an `entity` with an `id` and a `name` — the four
 * things `ReviewRow` dereferences. Anything else is reported as a malformed
 * response rather than rendered and thrown on.
 */
function isResolveResponse(value: unknown): value is ResolveResponse {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { results?: unknown; source?: unknown };
  if (!Array.isArray(candidate.results)) return false;
  if (typeof candidate.source !== "object" || candidate.source === null) return false;
  return candidate.results.every((entry) => {
    if (typeof entry !== "object" || entry === null) return false;
    const item = entry as { phrase?: unknown; status?: unknown; matches?: unknown };
    if (typeof item.phrase !== "string") return false;
    if (!["matched", "multiple", "none", "error"].includes(String(item.status))) return false;
    if (!Array.isArray(item.matches)) return false;
    return item.matches.every((match) => {
      if (typeof match !== "object" || match === null) return false;
      const entity = (match as { entity?: unknown }).entity;
      if (typeof entity !== "object" || entity === null) return false;
      const { id, name } = entity as { id?: unknown; name?: unknown };
      return typeof id === "string" && typeof name === "string";
    });
  });
}

/** Read the shared error envelope from `src/lib/api/respond.ts`. */
async function readMessage(response: Response): Promise<string> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return `The request failed (HTTP ${response.status}). Nothing was discarded.`;
  }
  // Read structurally: importing even a type from a route-adjacent module into a
  // client chunk is a habit worth not forming, and `ApiErrorBody` lives in a
  // `server-only` module.
  const message = (body as { error?: { message?: unknown } }).error?.message;
  return typeof message === "string"
    ? message
    : `The request failed (HTTP ${response.status}). Nothing was discarded.`;
}
