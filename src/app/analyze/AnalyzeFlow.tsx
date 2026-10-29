"use client";

import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { stableKey } from "@/lib/utils/deterministic";
import {
  applyStageEvent,
  initialStageProgress,
  type StageEvent,
  type StageProgress,
} from "@/lib/analysis/stages";
import { ProgressTracker } from "@/components/domain/ProgressStep";
import { ErrorState } from "@/components/ui/States";
import { AnalyzingStage, DescribeStage, WelcomeStage } from "./CaptureStages";
import { ContextStage } from "./ContextStage";
import { ReviewStage } from "./ReviewStage";

import type { ProgressTrackerStep, StepStatus } from "@/components/domain/ProgressStep";
import type { AnalyzeError, AnalyzeResponse, DraftProfile, SearchMatch, Stage } from "./flowTypes";
import {
  OPTIONAL_STAGES,
  STAGES,
  STAGE_LABEL,
  analysisIdentity,
  confirmReviewItem,
  draftBlockers,
  draftWarnings,
  emptyDraft,
  isResultStage,
  reviewItemFromEntry,
  stageIndex,
  toAnalyzeInput,
  validateDraft,
} from "./flowTypes";

/**
 * The state machine for doc 02 §28's twelve-stage flow.
 *
 * This component owns exactly four things: where the creator is, what they have
 * typed, what the API returned, and whether those two still describe each other.
 * All the rendering is delegated, and all the vocabulary is in `flowTypes.ts`, so
 * the rail, the router and the request payload are built from one list of stages
 * and cannot disagree about how many there are.
 *
 * THE STALENESS RULE
 * ------------------
 * The results are kept beside a canonical key of the payload they were built from.
 * Edit anything afterwards and a banner says the results no longer describe the
 * form, with a re-run button. Without it a creator could add three interests, walk
 * back to the Taste DNA stage, and read numbers computed from a different profile
 * with nothing on screen indicating so — the exact class of error this product
 * exists to avoid, arriving through the back door of a wizard that lets you go
 * backwards.
 *
 * THE RESULTS CHUNK
 * -----------------
 * `ResultStages` is `lazy` and warmed from the review stage onwards, so the
 * analysis layer and the copy templates it pulls in are downloaded while the
 * creator is still confirming entities and are not in the initial `/analyze`
 * payload. See the header of `ResultStages.tsx` for what that costs and why it is
 * worth it.
 */

const ResultStages = lazy(() =>
  import("./ResultStages").then((module) => ({ default: module.ResultStages })),
);

/** Every stage a navigation control may target. `analyzing` is a transit state, not a place. */
const NAV_STAGES: readonly Stage[] = STAGES.filter((stage) => stage !== "analyzing");

type Status = "idle" | "requesting" | "done" | "failed";

export function AnalyzeFlow() {
  const [stage, setStage] = useState<Stage>("welcome");
  const [draft, setDraft] = useState<DraftProfile>(emptyDraft);
  const [response, setResponse] = useState<AnalyzeResponse | undefined>(undefined);
  const [error, setError] = useState<AnalyzeError | undefined>(undefined);
  const [status, setStatus] = useState<Status>("idle");
  const [selectedBrandId, setSelectedBrandId] = useState<string | undefined>(undefined);
  /**
   * Brand ids the creator has set aside to pitch, in the order they added them.
   *
   * A list of ids rather than a list of opportunities, so it survives a re-run
   * without holding stale objects: after the profile changes, the ids that no
   * longer appear in `analysis.opportunities` are simply not rendered, and the
   * ones that do are rendered from the fresh analysis rather than from a copy
   * taken before the creator edited their interests. Keeping the objects instead
   * would mean a shortlisted brand card showing a score from the previous run.
   *
   * Deliberately NOT cleared when a new response arrives. A creator who tweaks a
   * description and re-runs has not changed their mind about which brands they
   * want to approach, and losing the shortlist would make the re-run button feel
   * destructive.
   */
  const [shortlist, setShortlist] = useState<string[]>([]);
  /** Canonical key of the payload `response` was built from. */
  const [responseKey, setResponseKey] = useState<string | undefined>(undefined);
  /** Live pipeline progress, folded from the streamed `{type:"stage"}` lines. */
  const [stageProgress, setStageProgress] = useState<StageProgress>(initialStageProgress);
  /**
   * Whether the creator has pressed "Complete" on the final (media kit) stage.
   *
   * The rail marks a step `complete` only once the flow has moved PAST it, and
   * there is nowhere past the last step — so without an explicit end the media
   * kit would sit at "In progress" forever. This flag is that explicit end: it
   * flips the whole rail to done, and is cleared again the moment a fresh run
   * starts, because a new analysis is not a finished one.
   */
  const [completed, setCompleted] = useState(false);

  const stageRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<AbortController | undefined>(undefined);
  const mountedOnce = useRef(false);

  // Both sides of the staleness comparison go through `analysisIdentity`, which
  // drops the audience-context answers. Those change no number and nothing stored
  // on the analysis, so counting them here would cry stale over an edit that
  // provably cannot alter the result. See `analysisIdentity` for the full argument.
  const draftKey = useMemo(() => canonical(analysisIdentity(toAnalyzeInput(draft))), [draft]);
  const stale = response !== undefined && responseKey !== draftKey;

  const patch = useCallback((changes: Partial<DraftProfile>) => {
    setDraft((current) => ({ ...current, ...changes }));
  }, []);

  /**
   * Add or remove a brand from the shortlist.
   *
   * One toggle rather than add/remove pairs because the button on the card has to
   * be one control, and a creator who is deciding between four brands will change
   * their mind about one of them. `useCallback` with no dependencies so the card
   * list does not re-create its handlers on every keystroke in the description
   * field, which is the same render the whole wizard shares.
   */
  const toggleShortlist = useCallback((brandId: string) => {
    setShortlist((current) =>
      current.includes(brandId)
        ? current.filter((id) => id !== brandId)
        : [...current, brandId],
    );
  }, []);

  // -----------------------------------------------------------------------
  // Focus management
  // -----------------------------------------------------------------------

  /**
   * Move focus AND the viewport to the new stage.
   *
   * Without this, a screen-reader user who activates "Next" stays focused on a
   * button that has just been replaced, and the only feedback is silence. The
   * first render is skipped deliberately: focusing on mount would scroll the page
   * and take focus from wherever the creator actually landed.
   *
   * WHY SCROLLING IS NOT OPTIONAL
   * -----------------------------
   * The stage nav sits below the stage panel, so a creator who has just read a
   * long stage is scrolled near the bottom of the document when they press
   * "Next". Focus alone moves the caret but leaves the viewport where it was,
   * which means the new stage appears off-screen above them and the first thing
   * they see is the tail end of the panel they just left. Every transition goes
   * through `setStage`, so this one effect covers Next, Back, rail clicks, the
   * analyze→results transition and every in-result jump.
   *
   * WHY THE PANEL AND NOT DOCUMENT TOP
   * ----------------------------------
   * `page.tsx` renders a full intro section above this component — eyebrow,
   * heading, standfirst, the data-source banner and the config notices. Scrolling
   * to `top: 0` would put all of that between the creator and the stage they just
   * asked for, which is the same complaint from the other direction. `block:
   * "start"` puts the stage itself at the top of the viewport instead, and
   * `scroll-padding-top` on `html` keeps it clear of the sticky header.
   *
   * `preventScroll` on the focus call stops the two scroll mechanisms fighting:
   * focusing an element scrolls it into view on its own terms, which is a second,
   * differently-computed scroll of the same element.
   *
   * No `behavior` is passed, on purpose. `html` already declares
   * `scroll-behavior: smooth` with a `prefers-reduced-motion` override that
   * switches it to `auto`, so an explicit `"smooth"` here would ignore a
   * preference the stylesheet is already honouring.
   */
  useEffect(() => {
    if (!mountedOnce.current) {
      mountedOnce.current = true;
      return;
    }
    const panel = stageRef.current;
    if (panel === null) return;
    panel.focus({ preventScroll: true });
    panel.scrollIntoView({ block: "start" });
  }, [stage]);

  // -----------------------------------------------------------------------
  // Warming the results chunk
  // -----------------------------------------------------------------------

  useEffect(() => {
    if (stageIndex(stage) < stageIndex("review")) return;
    // Fire and forget. The browser caches the module, so the `lazy()` boundary
    // resolves from cache later; a failure here is not worth surfacing because
    // the same import runs again at the boundary, where it IS reported.
    void import("./ResultStages");
  }, [stage]);

  // -----------------------------------------------------------------------
  // The request
  // -----------------------------------------------------------------------

  const run = useCallback(async (override?: Partial<DraftProfile>) => {
    // An override lets a recovery action (resolving an unmatched interest from the
    // hard-fail screen) re-run against the corrected profile in the same tick,
    // without waiting for the asynchronous `patch` to land in this closure.
    const source = override ? { ...draft, ...override } : draft;
    const validation = validateDraft(source);
    if (!validation.ok) {
      setError({
        message: `The form is not ready to send. ${validation.problems.join(" ")}`,
      });
      setStatus("failed");
      setStage("analyzing");
      return;
    }

    // A second click while a request is in flight would otherwise race the first,
    // and whichever resolved last would win regardless of which payload it carried.
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    const payload = toAnalyzeInput(source);
    setStage("analyzing");
    setStatus("requesting");
    setError(undefined);
    setStageProgress(initialStageProgress());
    // A new run is not a finished one: clear any earlier "Complete" so the rail
    // cannot claim the fresh analysis is done before it has even landed.
    setCompleted(false);

    let raw: Response;
    try {
      raw = await fetch("/api/analyze", {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
        body: JSON.stringify(payload),
      });
    } catch (cause) {
      if (controller.signal.aborted) return;
      setStatus("failed");
      setError({
        message:
          cause instanceof TypeError
            ? "The analysis request never reached the server. Your form is still here, unchanged."
            : "The analysis request was interrupted. Your form is still here, unchanged.",
      });
      return;
    }

    if (!raw.ok) {
      setStatus("failed");
      setError(await readError(raw));
      return;
    }

    // The success response is NDJSON: `{type:"stage"}` lines as the pipeline
    // reaches each boundary, then one `{type:"result"}` line. Reading it
    // incrementally is the entire point — it is what lets the analyzing screen
    // light up against real work rather than an invented percentage. A 200 with
    // no readable body (an intercepting proxy) falls back to one JSON parse so
    // the failure is still reported rather than silently hanging.
    let body: unknown;
    let streamError: string | undefined;
    try {
      if (raw.body === null) {
        body = await raw.json();
      } else {
        const reader = raw.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        const consume = (line: string): void => {
          const trimmed = line.trim();
          if (trimmed.length === 0) return;
          let event: unknown;
          try {
            event = JSON.parse(trimmed);
          } catch {
            return; // A torn line is not fatal; the next chunk completes it.
          }
          if (isStageLine(event)) {
            // Aliased to a const: TypeScript drops the narrowing of a mutable
            // `let` inside a closure, and the fold needs the `StageEvent` type.
            const stageLine = event;
            setStageProgress((current) => applyStageEvent(current, stageLine));
          } else if (isErrorLine(event)) {
            streamError = event.message;
          } else if (isResultLine(event)) {
            body = stripType(event);
          }
        };

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let newline = buffer.indexOf("\n");
          while (newline >= 0) {
            consume(buffer.slice(0, newline));
            buffer = buffer.slice(newline + 1);
            newline = buffer.indexOf("\n");
          }
        }
        // Flush a final line that arrived without a trailing newline.
        consume(buffer + decoder.decode());
      }
    } catch (cause) {
      if (controller.signal.aborted) return;
      setStatus("failed");
      setError({
        message:
          cause instanceof TypeError
            ? "The analysis stream was interrupted before it finished. Your form is still here, unchanged."
            : "The analysis stream stopped part way through. Your form is still here, unchanged.",
        status: raw.status,
      });
      return;
    }

    if (streamError !== undefined) {
      setStatus("failed");
      setError({ message: streamError, status: raw.status });
      return;
    }

    if (!isAnalyzeResponse(body)) {
      setStatus("failed");
      setError({
        message:
          body === undefined
            ? "The analysis stream ended before a result arrived. Nothing was invented in its place."
            : "The response did not contain an analysis. A proxy or an error page in front of the API can return this with a 200 status.",
        status: raw.status,
      });
      return;
    }

    setResponse(body);
    // Recorded from the payload that was SENT, not re-derived from the draft when
    // the response lands: the creator may have typed more while it was in flight,
    // and re-deriving would mark those edits as already-analysed.
    //
    // Through `analysisIdentity` for the same reason `draftKey` is: the two keys
    // are only comparable if they were built the same way.
    setResponseKey(canonical(analysisIdentity(payload)));
    setStatus("done");
    setStage("taste");
  }, [draft]);

  /**
   * One-click recovery from the no-signals hard fail.
   *
   * The creator picked a catalogue entity for a phrase that had not resolved. The
   * review list is the source of truth for what is a signal, so the recovery edits
   * THAT rather than a separate interest array: confirming the matching review item
   * keeps the review screen, the payload and the cache key describing one state.
   * A phrase that is not in the list at all (a caller driving the API directly,
   * whose `unresolvedInterests` came from free-text interests) is appended as a
   * manually added, already-confirmed item.
   *
   * The draft is patched and the run re-issued against the corrected profile in the
   * same tick, because `patch` is asynchronous and `run` closes over the `draft`
   * from THIS render.
   */
  const resolveInterest = useCallback(
    (query: string, match: SearchMatch) => {
      const existing = draft.review.find(
        (item) => item.phrase.toLowerCase() === query.toLowerCase(),
      );
      const review =
        existing !== undefined
          ? confirmReviewItem(draft.review, existing.phrase, match)
          : [
              ...draft.review,
              reviewItemFromEntry(
                { phrase: query, status: "matched", matches: [match] },
                "manual",
              ),
            ];
      patch({ review });
      void run({ review });
    },
    [draft, patch, run],
  );

  // -----------------------------------------------------------------------
  // Navigation
  // -----------------------------------------------------------------------

  const goto = useCallback(
    (next: Stage) => {
      // A result stage with nothing to render is not a place the creator can be.
      // Silently ignoring the request would leave the rail and the panel
      // disagreeing, so the flow refuses and stays put — the rail already renders
      // these steps as non-interactive, and this is the belt to that brace.
      if (isResultStage(next) && response === undefined) return;
      setStage(next);
    },
    [response],
  );

  const position = NAV_STAGES.indexOf(stage);
  const previous = position > 0 ? NAV_STAGES[position - 1] : undefined;
  const next = position >= 0 && position < NAV_STAGES.length - 1 ? NAV_STAGES[position + 1] : undefined;

  const blockers = draftBlockers(draft);
  const warnings = draftWarnings(draft);
  const validation = validateDraft(draft);
  const cannotProceed = blockers.length > 0 || !validation.ok;

  function onStepSelect(index: number): void {
    const target = STAGES[index];
    if (target !== undefined) goto(target);
  }

  return (
    <div className="cd-onboard">
      <div className="cd-onboard__layout">
        <div className="cd-onboard__rail">
          <ProgressTracker
            steps={railSteps(stage, draft, response, completed)}
            onStepSelect={onStepSelect}
            compact
            ariaLabel="Analysis progress"
          />
        </div>

        {/* `tabIndex={-1}` makes the container programmatically focusable for the
            stage-change effect above without putting it in the tab order. */}
        <div className="cd-onboard__stage" ref={stageRef} tabIndex={-1}>
          {stale ? <StaleBanner onRerun={() => void run()} /> : null}

          {stage === "welcome" ? <WelcomeStage onBegin={() => goto("describe")} /> : null}
          {stage === "describe" ? <DescribeStage draft={draft} patch={patch} /> : null}
          {stage === "review" ? <ReviewStage draft={draft} patch={patch} /> : null}
          {stage === "context" ? <ContextStage draft={draft} patch={patch} /> : null}

          {stage === "analyzing" ? (
            status === "failed" && error !== undefined ? (
              <div className="cd-onboard__stage-body">
                <ErrorState
                  error={{
                    code: error.status === undefined ? "network" : "request_failed",
                    message: error.message,
                    recoverable: error.status === undefined || error.status >= 500,
                    status: error.status,
                  }}
                  onRetry={() => void run()}
                />
                <p className="cd-onboard__note">
                  Nothing was lost. Your form is exactly as you left it, and you can go back and
                  change it first.
                </p>
              </div>
            ) : (
              <AnalyzingStage progress={stageProgress} />
            )
          ) : null}

          {isResultStage(stage) && response !== undefined ? (
            <Suspense fallback={<AnalyzingStage progress={stageProgress} />}>
              <ResultStages
                stage={stage}
                response={response}
                draft={draft}
                selectedBrandId={selectedBrandId}
                onSelectBrand={setSelectedBrandId}
                shortlist={shortlist}
                onToggleShortlist={toggleShortlist}
                onGoto={goto}
                onResolveInterest={resolveInterest}
              />
            </Suspense>
          ) : null}

          <StageNav
            stage={stage}
            previous={previous}
            next={next}
            blockers={blockers}
            warnings={warnings}
            cannotProceed={cannotProceed}
            hasResult={response !== undefined}
            completed={completed}
            onGoto={goto}
            onRun={() => void run()}
            onComplete={() => setCompleted(true)}
            onSkipContext={() => {
              // Skip means "no context, analyse now". The context stage is the last
              // capture step, so the only forward move from it is the run itself.
              // The old handler recorded the flag and stopped — and because the rail
              // marks the step skipped only once the flow has moved PAST it, pressing
              // Skip changed nothing on screen at all, which is why it read as broken.
              // `patch` is asynchronous and `run` closes over this render's `draft`,
              // so the flag rides along as an override to reach the request in the
              // same tick, exactly as `resolveInterest` does. The button is disabled
              // whenever Analyze is, so this can never bypass a draft blocker.
              patch({ contextSkipped: true });
              void run({ contextSkipped: true });
            }}
          />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The rail
// ---------------------------------------------------------------------------

/**
 * Step statuses for the whole twelve-stage list.
 *
 * Two rules that are easy to lose:
 *
 *   - a SKIPPED optional stage stays skipped once the flow has moved past it. A
 *     creator who skipped the optional context stage — audience and coverage —
 *     must be able to see that the flow heard them; `complete` would claim they
 *     answered, and `upcoming` would claim they never got there.
 *   - the result stages are never `complete` when the response is not renderable.
 *     `ProgressStep` only makes `complete` and `skipped` steps clickable, so this
 *     is what stops the rail offering a link into a stage that would render the
 *     L4 refusal — an offer the creator can accept and that leads nowhere.
 */
function railSteps(
  current: Stage,
  draft: DraftProfile,
  response: AnalyzeResponse | undefined,
  completed: boolean,
): ProgressTrackerStep[] {
  const currentIndex = stageIndex(current);
  const renderable = response !== undefined && response.renderable && !isHardFailResponse(response);

  return STAGES.map((stage, index) => {
    let status: StepStatus;
    // Once the creator presses "Complete" the whole flow is finished, so every
    // step is done regardless of where they navigate afterwards. Otherwise a step
    // is done only when the flow has moved past it.
    if (completed || index < currentIndex) status = "complete";
    else if (index === currentIndex) status = "current";
    else status = "upcoming";

    // A skipped optional stage stays skipped even after completion: `complete`
    // would claim the creator answered it, and they deliberately did not.
    if (stage === "context" && draft.contextSkipped && status !== "current") {
      status = "skipped";
    }
    // The renderability guard keeps a non-renderable result stage out of the
    // "done, click to return" state — but it must never undo an explicit Complete.
    if (!completed && isResultStage(stage) && !renderable && status === "complete") {
      status = "upcoming";
    }

    return {
      label: STAGE_LABEL[stage],
      status,
      optional: OPTIONAL_STAGES.includes(stage),
      hint: RAIL_HINT[stage],
    };
  });
}

function isHardFailResponse(response: AnalyzeResponse): boolean {
  return response.analysis.fallbackLevel === "L4" || !response.renderable;
}

/**
 * One line per step, shown in the full rail.
 *
 * Keyed by the closed `Stage` union with every key present and every value
 * `undefined`-free by intent except where there is genuinely nothing to add. A
 * hint that restates the label ("Taste DNA: your taste DNA") is noise, so steps
 * without a real second thing to say get none.
 */
const RAIL_HINT: Record<Stage, string | undefined> = {
  welcome: undefined,
  describe: "Your name, and what you make, in your own words",
  review: "What the catalogue matched, and which match you meant",
  context: "Coverage, audience and place — each one optional",
  analyzing: "Eleven pipeline stages, each reported as it runs",
  taste: "The graph, and the seal derived from it",
  unexpected: "Categories that came back which you never confirmed",
  untapped: "Cultural ground you reach but have not made content in",
  brands: "Ranked on the overlap with your taste, not on the order they came back in",
  brand: "One brand: the shared taste first, then the chain that found it",
  pitch: "A template-built opening message you can edit",
  kit: "One printable page, disclosures included",
};

// ---------------------------------------------------------------------------
// Stage navigation
// ---------------------------------------------------------------------------

function StageNav({
  stage,
  previous,
  next,
  blockers,
  warnings,
  cannotProceed,
  hasResult,
  completed,
  onGoto,
  onRun,
  onSkipContext,
  onComplete,
}: {
  stage: Stage;
  previous: Stage | undefined;
  next: Stage | undefined;
  blockers: readonly string[];
  warnings: readonly string[];
  cannotProceed: boolean;
  hasResult: boolean;
  completed: boolean;
  onGoto: (stage: Stage) => void;
  onRun: () => void;
  onSkipContext: () => void;
  onComplete: () => void;
}) {
  if (stage === "welcome" || stage === "analyzing") return null;

  /**
   * The media kit is the last stage, so there is no `next` to walk to. This is
   * the flow's explicit end: a "Complete" button in the same slot the "Next"
   * button occupies everywhere else. Pressing it flips the whole rail to done
   * (`completed`), which is the only way the final step ever leaves "In
   * progress" — the rail marks a step complete by position, and nothing sits
   * past the last one.
   */
  if (next === undefined) {
    return (
      <nav className="cd-onboard__nav" aria-label="Step navigation">
        {previous !== undefined ? (
          <button
            type="button"
            className="cd-button cd-button--ghost"
            onClick={() => onGoto(previous)}
          >
            Back: {STAGE_LABEL[previous]}
          </button>
        ) : (
          <span />
        )}

        <span className="cd-onboard__nav-right">
          <button
            type="button"
            className="cd-button cd-button--primary"
            onClick={onComplete}
            disabled={completed}
          >
            {completed ? "Completed" : "Complete"}
          </button>
        </span>

        {completed ? (
          <p className="cd-onboard__note" role="status">
            That&apos;s the last step. Every part of the flow is done, and your media kit above is
            ready to print or save.
          </p>
        ) : null}
      </nav>
    );
  }

  /**
   * The forward button ANALYSES when it would enter a result stage with nothing
   * rendered yet, and merely navigates otherwise.
   *
   * `draftBlockers` gates the analysis and nothing else. Applying it to every
   * forward step would disable "Next: Review what we found" on the describe stage —
   * because nothing is confirmed yet — and trap the creator one step short of the
   * only place they can confirm anything. The blockers are therefore shown, and the
   * button disabled, exactly when the button is about to run the pipeline.
   *
   * `draftWarnings` are shown on the same trigger but never disable anything. They
   * are consequences of a legal choice, not mistakes: zero confirmed entities runs
   * and returns the honest no-signal state, and a disabled button would deny the
   * creator the explanation that state exists to give.
   */
  const willAnalyze = isResultStage(next) && !hasResult;
  const blocked = willAnalyze && cannotProceed;

  return (
    <nav className="cd-onboard__nav" aria-label="Step navigation">
      {previous !== undefined ? (
        <button
          type="button"
          className="cd-button cd-button--ghost"
          onClick={() => onGoto(previous)}
        >
          Back: {STAGE_LABEL[previous]}
        </button>
      ) : (
        <span />
      )}

      <span className="cd-onboard__nav-right">
        {stage === "context" ? (
          <button
            type="button"
            className="cd-button cd-button--quiet"
            onClick={onSkipContext}
            disabled={blocked}
          >
            Skip optional context
          </button>
        ) : null}

        <button
          type="button"
          className="cd-button cd-button--primary"
          onClick={willAnalyze ? onRun : () => onGoto(next)}
          disabled={blocked}
        >
          {willAnalyze ? "Analyze" : `Next: ${STAGE_LABEL[next]}`}
        </button>
      </span>

      {/* Listed here rather than in a toast: a disabled button with no reason is
          the single most common way a form tells a user nothing. Shown only when
          it can actually block, so it never reads as a general complaint. */}
      {blocked ? (
        <ul className="cd-onboard__blockers">
          {blockers.map((blocker) => (
            <li key={blocker}>{blocker}</li>
          ))}
        </ul>
      ) : null}

      {willAnalyze && !blocked && warnings.length > 0 ? (
        <ul className="cd-onboard__blockers" aria-live="polite">
          {warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Staleness
// ---------------------------------------------------------------------------

function StaleBanner({ onRerun }: { onRerun: () => void }) {
  return (
    <div className="cd-onboard__stale" role="status">
      <p>
        <strong>These results no longer match the form.</strong> You changed something since they
        were produced, so the numbers below describe the profile as it was. They are still shown —
        discarding work is worse than labelling it — but nothing here reflects your latest edits
        until you re-run.
      </p>
      <button type="button" className="cd-button cd-button--primary cd-button--sm" onClick={onRerun}>
        Re-run the analysis
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Response handling
// ---------------------------------------------------------------------------

/**
 * Structural guard on the response.
 *
 * The route is typed, but a reverse proxy, an auth wall or a hosting error page can
 * all return HTML with a 200, and the first render of `response.analysis.tasteDna`
 * would then throw inside React rather than showing a message the creator can act
 * on. `SearchEntity` does the same for its own response, for the same reason.
 *
 * Deliberately shallow. Checking that `analysis` is an object with a `tasteDna` and
 * that `renderable` is a boolean is enough to distinguish "an analysis" from "an
 * error page"; validating the whole `CreatorAnalysis` in the browser would mean
 * shipping a second copy of the contract.
 */
function isAnalyzeResponse(value: unknown): value is AnalyzeResponse {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<AnalyzeResponse>;
  if (typeof candidate.renderable !== "boolean") return false;
  if (typeof candidate.analysis !== "object" || candidate.analysis === null) return false;
  const analysis = candidate.analysis as { tasteDna?: unknown; fallbackLevel?: unknown };
  return typeof analysis.tasteDna === "object" && typeof analysis.fallbackLevel === "string";
}

/**
 * Guards for the three NDJSON line types the stream can carry.
 *
 * Declared structurally rather than importing the route's wire types: this is a
 * client component and a route handler must never end up in a browser bundle, so
 * the line shapes are re-described here exactly as `isAnalyzeResponse` re-describes
 * the payload. `StageEvent` comes from `stages.ts`, which is NOT server-only
 * precisely so both sides can share the one stage vocabulary.
 */
function isStageLine(value: unknown): value is StageEvent {
  if (typeof value !== "object" || value === null) return false;
  const line = value as { type?: unknown; id?: unknown; label?: unknown; status?: unknown };
  return (
    line.type === "stage" &&
    typeof line.id === "string" &&
    typeof line.label === "string" &&
    (line.status === "start" || line.status === "done" || line.status === "skipped")
  );
}

/** A failure that happened AFTER 200 was already on the wire, so it cannot be a status code. */
function isErrorLine(value: unknown): value is { type: "error"; message: string } {
  if (typeof value !== "object" || value === null) return false;
  const line = value as { type?: unknown; message?: unknown };
  return line.type === "error" && typeof line.message === "string";
}

/** The analysis payload line. */
function isResultLine(value: unknown): value is { type: "result" } & Record<string, unknown> {
  return typeof value === "object" && value !== null && (value as { type?: unknown }).type === "result";
}

/** Drop the `type` marker so the payload matches the non-streamed `AnalyzeResponse`. */
function stripType(line: Record<string, unknown>): Record<string, unknown> {
  const rest: Record<string, unknown> = { ...line };
  delete rest.type;
  return rest;
}

/** Read the shared error envelope from `src/lib/api/respond.ts`. */
async function readError(response: Response): Promise<AnalyzeError> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { message: `The request failed (HTTP ${response.status}).`, status: response.status };
  }

  // `ApiErrorBody` is imported as a type only where it is used, so nothing at
  // runtime reaches the `server-only` module that declares it. The shape is read
  // structurally here instead of imported, because importing even a type from a
  // route-adjacent module into a client chunk is a habit worth not forming.
  const error = (body as { error?: { message?: unknown; recoverable?: unknown } }).error;
  if (error === undefined || typeof error.message !== "string") {
    return { message: `The request failed (HTTP ${response.status}).`, status: response.status };
  }
  return { message: error.message, status: response.status };
}

/**
 * Canonical JSON for comparing two payloads.
 *
 * `stableKey` rather than `JSON.stringify`, because `toAnalyzeInput()` builds its
 * objects in a fixed order today but nothing enforces that, and a key-order
 * difference would flag results as stale when the profile had not changed at all.
 * A banner crying stale on every render trains the creator to ignore it — including
 * the one time it is true.
 */
function canonical(value: unknown): string {
  return stableKey(value);
}
