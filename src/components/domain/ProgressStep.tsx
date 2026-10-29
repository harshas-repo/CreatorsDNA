import type { ReactNode } from "react";

/**
 * `ProgressStep` (doc 02 §30), and the `ProgressTracker` rail that lays them out.
 *
 * The app flow in doc 02 §28 is a twelve-step sequence, and several of those
 * steps are OPTIONAL (doc 02 §39/§40: demographics and location are never
 * mandatory). That is what forces `"skipped"` to be its own status rather than a
 * flavour of `"upcoming"`: a creator who declines to share their audience sees a
 * step marked "not reached" and cannot tell whether they skipped it or the flow
 * lost their place. The two look identical if one glyph serves both.
 *
 * Every status is therefore encoded twice — by shape and by word — because a
 * stepper whose state is only a colour is unusable to a colour-blind creator and
 * unreadable by a screen reader (doc 05 §11: colour is never the only channel).
 *
 * No `"use client"`. A step is pure markup; the page that owns the flow owns the
 * state. Keeping this a Server Component means the twelve-step shell arrives in
 * the initial HTML instead of after hydration, and the pages stay free to manage
 * progress however they like.
 */

export type StepStatus = "complete" | "current" | "upcoming" | "skipped";

export interface ProgressStepProps {
  /** 1-based position, shown for steps that have no other glyph. */
  index: number;
  label: string;
  status: StepStatus;
  /** Renders the "Optional" marker. Distinct from `skipped`: this says the step
   *  may be skipped, not that it was. */
  optional?: boolean;
  /** One line of context under the label. */
  hint?: string;
  /**
   * Rendered as a button when supplied AND the step is already behind the
   * creator. Deliberately NOT honoured for `current` or `upcoming`: jumping
   * forward past an uncompleted step would leave a profile half-filled, and the
   * honest affordance for that is the flow's own Back button.
   */
  onSelect?: () => void;
  className?: string;
}

export function ProgressStep({
  index,
  label,
  status,
  optional = false,
  hint,
  onSelect,
  className,
}: ProgressStepProps) {
  // `upcoming` never becomes interactive even when a handler is passed. A
  // disabled button inside a navigation list is noise for assistive tech, so the
  // element changes type rather than being muted.
  const navigable = onSelect !== undefined && (status === "complete" || status === "skipped");

  const body = (
    <>
      <span className="cd-step__marker" aria-hidden="true">
        <StepGlyph status={status} index={index} />
      </span>

      <span className="cd-step__text">
        <span className="cd-step__label">
          {label}
          {optional ? <span className="cd-step__optional">Optional</span> : null}
        </span>
        {hint ? <span className="cd-step__hint">{hint}</span> : null}
      </span>

      {/* The word, not just the glyph. `aria-hidden` is wrong here: this is the
          redundant encoding that makes the marker legible without colour. */}
      <span className="cd-step__status">{STATUS_WORD[status]}</span>
    </>
  );

  return (
    <li
      className={`cd-step cd-step--${status}${className ? ` ${className}` : ""}`}
      {...(status === "current" ? { "aria-current": "step" as const } : {})}
    >
      {navigable ? (
        <button type="button" className="cd-step__button" onClick={onSelect}>
          {body}
          <span className="cd-sr-only">Return to {label}</span>
        </button>
      ) : (
        <span className="cd-step__static">{body}</span>
      )}
    </li>
  );
}

const STATUS_WORD: Record<StepStatus, string> = {
  complete: "Done",
  current: "In progress",
  upcoming: "Not started",
  skipped: "Skipped",
};

function StepGlyph({ status, index }: { status: StepStatus; index: number }) {
  if (status === "complete") return <CheckGlyph />;
  if (status === "skipped") return <SkipGlyph />;
  if (status === "current") return <span className="cd-step__dot" />;
  return <span className="cd-step__number cd-tabular">{index}</span>;
}

function CheckGlyph(): ReactNode {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" focusable="false" aria-hidden="true">
      <path
        d="M3.2 8.6 L6.3 11.6 L12.8 4.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** A forward slash: universally "not done, deliberately". */
function SkipGlyph(): ReactNode {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" focusable="false" aria-hidden="true">
      <path d="M11.6 4.4 L4.4 11.6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// The rail
// ---------------------------------------------------------------------------

export interface ProgressTrackerStep {
  label: string;
  status: StepStatus;
  optional?: boolean;
  hint?: string;
}

export interface ProgressTrackerProps {
  steps: readonly ProgressTrackerStep[];
  /** Called with the step's 0-based index when a completed step is clicked. */
  onStepSelect?: (index: number) => void;
  /**
   * `compact` drops the hints and the status words, leaving label + marker.
   * Used in the sidebar where the full rail would dominate the screen; the words
   * are what make the compact form still accessible, so they are kept and only
   * the hints go.
   */
  compact?: boolean;
  /** Accessible name for the list. Defaults to a sensible one. */
  ariaLabel?: string;
  className?: string;
}

/**
 * The ordered list of steps.
 *
 * An `<ol>` rather than a `<nav>` of links: these are stages in a procedure, not
 * a site navigation, and the numbering is semantic. Doc 02 §29 puts "generic
 * dashboard sidebar" on the avoid list, and a row of links would be exactly that.
 */
export function ProgressTracker({
  steps,
  onStepSelect,
  compact = false,
  ariaLabel = "Analysis progress",
  className,
}: ProgressTrackerProps) {
  if (steps.length === 0) return null;

  const completedCount = steps.filter((step) => step.status === "complete").length;

  return (
    <div className={`cd-tracker${compact ? " cd-tracker--compact" : ""}${className ? ` ${className}` : ""}`}>
      <div className="cd-tracker__head">
        <span className="cd-eyebrow">{ariaLabel}</span>
        {/* Counted, not percentaged: "3 of 12" is a position, while "25%" reads
            as a completion score for work that has no meaningful denominator. */}
        <span className="cd-tracker__count cd-tabular">
          {completedCount} of {steps.length}
        </span>
      </div>

      <ol className="cd-tracker__list">
        {steps.map((step, index) => (
          <ProgressStep
            key={`${index}|${step.label}`}
            index={index + 1}
            label={step.label}
            status={step.status}
            optional={step.optional}
            hint={compact ? undefined : step.hint}
            // The navigability rule lives in `ProgressStep` alone. Re-testing
            // the status here would be a second copy of the same condition, and
            // the two would drift the first time a status is added.
            onSelect={onStepSelect !== undefined ? () => onStepSelect(index) : undefined}
          />
        ))}
      </ol>
    </div>
  );
}
