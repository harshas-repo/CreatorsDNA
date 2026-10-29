"use client";

import { useId } from "react";

import { CONTENT_PLATFORMS, PLATFORM_LABEL } from "@/lib/contracts/creator";
import { PIPELINE_STAGES, isStageProgressSettled } from "@/lib/analysis/stages";
import { DnaSpinner } from "@/components/ui/DnaSpinner";
import { extractCandidateTerms } from "@/lib/analysis/extractTerms";

import type { ReactNode } from "react";
import type { ContentPlatform } from "@/lib/contracts/creator";
import type { StageProgress } from "@/lib/analysis/stages";
import type { DraftProfile, Emphasis } from "./flowTypes";
import { deriveNiche } from "./flowTypes";

/**
 * The capture stages of doc 02 §28's flow: welcome, describe, analyzing — plus
 * the shared form furniture the review and context stages borrow.
 *
 * `ReviewStage` and `ContextStage` live in their own modules because each carries
 * state of its own (an in-flight resolve request, a per-item match list) and
 * because this file was already the largest in the flow. The three rules that used
 * to head it still govern all five stages:
 *
 * **Nothing is mandatory that the analysis can do without.** `draftBlockers()`
 * asks for a display name and something to resolve, and nothing else. Doc 01 §29's
 * pitch is "no account, just go"; a form demanding a handle, a platform list and a
 * location before it will run is the opposite of that, and the fallback hierarchy
 * exists precisely to handle thin inputs honestly rather than refuse them.
 *
 * **Every optional field says what leaving it empty costs.** An optional field with
 * no stated consequence reads as decorative, and a creator who skips it later meets
 * a chart that says "nothing to plot" with no idea why. So the context stage names
 * the dimension each field feeds and says whether that dimension is then omitted or
 * assumed.
 *
 * **A control is never offered that the pipeline ignores without saying so.** Two
 * live examples, both of which used to claim more than they delivered:
 *
 *   - `emphasis` is captured, sent, and shown back, but nothing in
 *     `src/lib/analysis` reads it. `SelectedInterest`'s own note says per-entity
 *     weights are POST-only and may be unavailable on the host this deployment
 *     talks to, so the control is labelled as a record rather than a multiplier.
 *   - `platforms` are media-kit metadata and NOT a scoring input. Nothing in the
 *     returned brand data identifies which platforms a brand works with, so a
 *     platform-compatibility score would be invented. The field says so here and
 *     `contentCompatibilityEvidence` says it again next to the bar it qualifies.
 *
 * Removing either control would be tidier and worse: both are in the contract, and
 * a control that quietly stops existing is how a form and an API drift.
 */

export interface CaptureStageProps {
  draft: DraftProfile;
  /** Shallow merge. The flow owns the draft; a stage never replaces it whole. */
  patch: (changes: Partial<DraftProfile>) => void;
}

// ---------------------------------------------------------------------------
// 1. Welcome
// ---------------------------------------------------------------------------

/**
 * Stage 1.
 *
 * Deliberately short. A welcome screen that explains the product is a second
 * marketing page, and the creator just came from the first one. What belongs here
 * is the transaction: what is asked, what is not kept, and what happens next.
 */
export function WelcomeStage({ onBegin }: { onBegin: () => void }) {
  return (
    <div className="cd-onboard__stage-body">
      <h2 className="cd-onboard__title">Describe your work, then check what we heard</h2>
      <p className="cd-onboard__lede cd-measure">
        Write about what you make and who you are close to culturally. We look each name up in the
        catalogue and show you what came back. Nothing becomes a signal until you confirm it.
      </p>

      <p className="cd-onboard__note">
        You&rsquo;ll get: your Taste DNA, affinities you did not declare, connections you have not
        made content in, the brands whose taste overlaps yours, a draft pitch and a printable media
        kit.
      </p>

      <ul className="cd-onboard__promise">
        {PROMISES.map((promise) => (
          <li key={promise.term}>
            <span className="cd-onboard__promise-term">{promise.term}</span>
            <span className="cd-onboard__promise-text">{promise.text}</span>
          </li>
        ))}
      </ul>

      <div className="cd-onboard__actions">
        <button
          type="button"
          className="cd-button cd-button--primary cd-button--lg"
          onClick={onBegin}
        >
          Start with your description
        </button>
      </div>
    </div>
  );
}

const PROMISES: ReadonlyArray<{ term: string; text: string }> = [
  {
    term: "No account",
    text: "Nothing is stored or emailed. The draft lives in this tab and dies with it.",
  },
  {
    term: "No guessing",
    text: "We suggest phrases, the catalogue decides what matched, you decide which match you meant. An unconfirmed phrase stays context and contributes no number.",
  },
  {
    term: "Nothing thrown away",
    text: "A phrase the catalogue has not heard of stays visible, labelled unmatched, and is listed back to you in the results.",
  },
  {
    term: "No invented numbers",
    text: "A value that could not be evidenced is omitted, and the omission is shown. A chart with nothing to plot says so.",
  },
  {
    term: "Skippable context",
    text: "Audience and coverage are optional. Decline them and those dimensions are dropped, the rest re-weighted, and the results say so.",
  },
];

// ---------------------------------------------------------------------------
// 2. Describe
// ---------------------------------------------------------------------------

/**
 * Stage 2 — "Tell us about your work".
 *
 * One textarea and an identity block. This is the input the old flow never had: a
 * creator's own description of their work is the one thing guaranteed to be about
 * them, and the previous form asked instead for a list of subjects to be typed one
 * at a time into a search box — a vocabulary question where a description was
 * wanted.
 *
 * Nothing is resolved here. Extraction happens in `ReviewStage`, which reads this
 * text; the only live feedback below is the candidate count, so the creator knows
 * whether what they wrote is likely to give the next screen anything to work with.
 * A description with no recognisable names is not an error — it is information the
 * next stage needs before it can say "we found nothing to look up".
 */
export function DescribeStage({ draft, patch }: CaptureStageProps) {
  const candidates = extractCandidateTerms(draft.description);
  const niche = deriveNiche(draft.description);

  function togglePlatform(platform: ContentPlatform): void {
    const has = draft.platforms.includes(platform);
    patch({
      platforms: has
        ? draft.platforms.filter((existing) => existing !== platform)
        : [...draft.platforms, platform],
    });
  }

  return (
    <div className="cd-onboard__stage-body">
      <h2 className="cd-onboard__title">Tell us about your work</h2>
      <p className="cd-onboard__lede cd-measure">
        In your own words: what you make, who it is for, and the artists, brands, games, films or
        scenes you are culturally close to. Name them directly — the next screen looks each one up
        and asks you to confirm.
      </p>

      <div className="cd-onboard__fields">
        <Field
          label="Display name"
          required
          hint="Shown on your results and in the media kit. Not sent anywhere else."
        >
          {(control) => (
            <input
              {...control}
              className="cd-input"
              type="text"
              value={draft.displayName}
              maxLength={120}
              autoComplete="nickname"
              placeholder="The name your audience knows"
              onChange={(event) => patch({ displayName: event.target.value })}
            />
          )}
        </Field>

        <Field
          label="Handle"
          hint="Optional. Used only to identify you in the pitch draft's opening line."
        >
          {(control) => (
            <input
              {...control}
              className="cd-input"
              type="text"
              value={draft.handle}
              maxLength={80}
              autoComplete="off"
              spellCheck={false}
              placeholder="yourhandle"
              onChange={(event) => patch({ handle: event.target.value })}
            />
          )}
        </Field>

        <Field
          label="Describe your content"
          required
          hint="Up to 2,000 characters. Quoted back to you as yours — never restated as a measured fact, never sent to the catalogue as a signal in its own right."
        >
          {(control) => (
            <>
              <textarea
                {...control}
                className="cd-input cd-input--area"
                rows={7}
                value={draft.description}
                maxLength={2000}
                placeholder={
                  "I make weekly video essays about slow cinema, mostly post-2000 East Asian — " +
                  "Wong Kar-wai, Hirokazu Kore-eda, that lineage. I also cover shoegaze and dream " +
                  "pop production, and I have done paid work with A24 and Criterion."
                }
                onChange={(event) => patch({ description: event.target.value })}
              />
              <p className="cd-onboard__hint" role="status">
                <span className="cd-tabular">{candidates.length}</span> candidate phrase
                {candidates.length === 1 ? "" : "s"} spotted so far. Suggestions only — the
                catalogue decides what matched, you decide which match you meant.
              </p>
            </>
          )}
        </Field>

        {niche.length > 0 ? (
          <p className="cd-onboard__note">
            <span className="cd-eyebrow">Quoted as your own description</span> {niche}
          </p>
        ) : null}

        {/* A toggle group rather than a `<select multiple>`: seven options fit on
            one line, and a multi-select on touch is close to unusable. These are
            `aria-pressed` buttons and not radios because more than one applies. */}
        <fieldset className="cd-onboard__fieldset">
          <legend className="cd-onboard__label">Where do you publish?</legend>
          <FieldHint id="platforms">
            Optional — media-kit metadata only, NOT a brand-fit input. Nothing in the returned brand
            data says which platforms a brand works with, so such a score would be invented. The
            dimension that IS scored compares your taste tags with the brand&rsquo;s own
            descriptors, and says so beside its bar.
          </FieldHint>
          <div className="cd-onboard__toggles" aria-describedby="platforms-hint">
            {CONTENT_PLATFORMS.map((platform) => (
              <button
                key={platform}
                type="button"
                className="cd-chip cd-chip--filter"
                aria-pressed={draft.platforms.includes(platform)}
                onClick={() => togglePlatform(platform)}
              >
                {PLATFORM_LABEL[platform]}
              </button>
            ))}
          </div>
        </fieldset>
      </div>

      <p className="cd-onboard__note">
        Culture-forward subjects — music, film and TV, gaming, books, fashion, food, fitness, travel
        — resolve richest in the catalogue. A B2B or tech-news niche is thinner there, so a narrow
        result usually means less coverage of that world, not a mistake in how you described it.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3. Analyzing
// ---------------------------------------------------------------------------

/**
 * The transit stage.
 *
 * ONE line, not the eleven-step list: the stage running right now, named beside the
 * turning helix, with a "Step N of 11" count for position. A wall of "Not started"
 * rows described a future the creator could not act on and dwarfed the one row that
 * was actually live; the buffer is the product's own DNA mark, so the wait reads as
 * the logo working rather than as a generic spinner. The step names still come from
 * `PIPELINE_STAGES` in `stages.ts`, shared with the server, so the line shown is
 * always a real boundary from `runAnalysis()` and the count can never disagree with
 * how many steps the pipeline runs.
 *
 * It is driven by STREAMED events, not an invented percentage: the route flushes a
 * `{type:"stage"}` line at each boundary and `AnalyzeFlow` folds it into `progress`,
 * so the named step changes as the work actually happens. With no `progress` yet
 * (the lazy-results fallback) it says "Starting the analysis" rather than claiming a
 * step that has not begun.
 *
 * The canary step is still the one worth reading when it is the one running. It is
 * the silent-ignore check from doc 03 §11: the pipeline asks the data source the
 * same question twice with a strictly smaller signal set, and if the answers do not
 * differ then the signals were ignored and the whole result is a generic popularity
 * list. That check is what can put the analysis at L4, and L4 refuses to render.
 */
export function AnalyzingStage({ progress }: { progress?: StageProgress }) {
  const settled = progress !== undefined && isStageProgressSettled(progress);
  const active = activeStage(progress);
  const position =
    active === undefined
      ? undefined
      : PIPELINE_STAGES.findIndex((stage) => stage.id === active.id) + 1;

  return (
    <div
      className="cd-onboard__stage-body"
      role="status"
      aria-live="polite"
      aria-busy={settled ? "false" : "true"}
    >
      <h2 className="cd-onboard__title">Working through it</h2>

      <div className="cd-onboard__analyzing">
        <DnaSpinner size={56} />
        <div className="cd-onboard__analyzing-text">
          <p className="cd-onboard__analyzing-stage">
            {active === undefined
              ? settled
                ? "Finishing up"
                : "Starting the analysis"
              : active.label}
          </p>
          {position === undefined ? null : (
            <p className="cd-onboard__analyzing-count cd-tabular">
              Step {position} of {PIPELINE_STAGES.length}
            </p>
          )}
        </div>
      </div>

      <p className="cd-onboard__note">
        Identical inputs are cached, so a second run on the same profile returns the same answer and
        costs the data source nothing.
      </p>
    </div>
  );
}

/**
 * The one stage to name while the run is in flight.
 *
 * The step whose event said `start` and has not settled yet; failing that, the next
 * one still `pending`, because the pipeline runs in order and the step about to
 * begin is a truer "current" than nothing. `undefined` once every stage is done or
 * skipped, or before any progress exists — the caller then says so in words rather
 * than pointing at a step that is not running.
 */
function activeStage(progress: StageProgress | undefined) {
  if (progress === undefined) return undefined;
  const running = PIPELINE_STAGES.find((stage) => progress[stage.id] === "start");
  if (running !== undefined) return running;
  return PIPELINE_STAGES.find((stage) => progress[stage.id] === "pending");
}

// ---------------------------------------------------------------------------
// Shared form furniture
// ---------------------------------------------------------------------------

/** What `Field` hands to the control it wraps. Spread it onto the input. */
export interface FieldControlProps {
  id: string;
  "aria-describedby": string | undefined;
}

/**
 * A labelled control with an associated hint.
 *
 * `children` is a render prop rather than a `ReactNode`, and that is the entire
 * reason this component exists. With a node child, wiring `aria-describedby` to
 * the hint is the caller's job on every one of a dozen fields, and the failure is
 * silent: the hint still renders, still looks associated, and a screen reader
 * simply never reads it. Passing the ids down makes the association impossible to
 * forget, because the control cannot be built without spreading them.
 */
export function Field({
  label,
  hint,
  required = false,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: (control: FieldControlProps) => ReactNode;
}) {
  const id = useId();
  const hintId = hint === undefined ? undefined : `${id}-hint`;

  return (
    <div className="cd-onboard__field">
      <label className="cd-onboard__label" htmlFor={id}>
        {label}
        {required ? <span className="cd-onboard__required">Required</span> : null}
      </label>
      {children({ id, "aria-describedby": hintId })}
      {hint ? (
        <p className="cd-onboard__hint" id={hintId}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/**
 * A hint for a control that is a group rather than a single input.
 *
 * A `<fieldset>` has no `htmlFor` to hang a description on, so the group container
 * points at this instead. The id is a plain string rather than `useId()` because
 * both halves are in the same render and a generated id cannot be referenced by a
 * sibling that does not have it.
 */
export function FieldHint({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p className="cd-onboard__hint" id={`${id}-hint`}>
      {children}
    </p>
  );
}

/** The five saturation words. Coarse on purpose — see `SaturationSlider`. */
const SATURATION_STEPS: ReadonlyArray<{ value: number; word: string }> = [
  { value: 0, word: "Rarely" },
  { value: 0.25, word: "Occasionally" },
  { value: 0.5, word: "Regularly" },
  { value: 0.75, word: "Mostly" },
  { value: 1, word: "Saturated" },
];

const TOP_STEP = { value: 1, word: "Saturated" };

/**
 * A five-step slider rather than a 0–100 one.
 *
 * The input is a guess about the creator's own back catalogue, and a 0–100 slider
 * would invite a precision the answer does not have — then plot it on a scatter
 * axis where two creators 4% apart look meaningfully different. Five words are
 * honest about the resolution of the underlying judgement.
 *
 * `aria-valuetext` carries the word. A screen reader announcing "0.75" in answer
 * to "how much of your output is film criticism?" is announcing our encoding, not
 * the creator's answer.
 */
export function SaturationSlider({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (next: number) => void;
}) {
  const id = useId();
  const index = nearestStepIndex(value);
  const step = SATURATION_STEPS[index] ?? TOP_STEP;

  return (
    <span className="cd-onboard__slider">
      <span className="cd-onboard__slider-word" id={`${id}-word`}>
        {step.word}
      </span>
      <input
        id={id}
        type="range"
        min={0}
        max={SATURATION_STEPS.length - 1}
        step={1}
        value={index}
        aria-label={label}
        aria-valuetext={step.word}
        aria-describedby={`${id}-word`}
        onChange={(event) => {
          const next = SATURATION_STEPS[Number(event.target.value)];
          if (next) onChange(next.value);
        }}
      />
    </span>
  );
}

/** The first step at or above `value`; the top step for anything out of range. */
function nearestStepIndex(value: number): number {
  const found = SATURATION_STEPS.findIndex((step) => step.value >= value);
  return found === -1 ? SATURATION_STEPS.length - 1 : found;
}

const EMPHASIS_OPTIONS: ReadonlyArray<{ value: Emphasis; word: string }> = [
  { value: "low", word: "Peripheral" },
  { value: "normal", word: "Part of it" },
  { value: "high", word: "Central" },
];

export function EmphasisControl({
  value,
  label,
  onChange,
}: {
  value: Emphasis;
  label: string;
  onChange: (next: Emphasis) => void;
}) {
  const name = useId();
  return (
    // Native radios, not `role="radio"` buttons. A hand-rolled radiogroup has to
    // reimplement arrow-key movement and roving tabindex to be usable; an `<input
    // type="radio">` with a shared `name` gets both for free, and the styling is
    // carried by the adjacent `<span>` so nothing about the appearance changes.
    <fieldset className="cd-onboard__emphasis">
      <legend className="cd-onboard__emphasis-label">{label}</legend>
      {EMPHASIS_OPTIONS.map((option) => (
        <label key={option.value} className="cd-onboard__radio">
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
          />
          <span className="cd-onboard__radio-word">{option.word}</span>
        </label>
      ))}
    </fieldset>
  );
}
