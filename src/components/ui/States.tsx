import type { ReactNode } from "react";

import type { DataSource } from "@/lib/contracts/domain";
import type { FallbackLevel } from "@/lib/contracts/viewModels";
import { FALLBACK_DESCRIPTIONS } from "@/lib/contracts/viewModels";
import { ProvenanceBadge } from "@/components/ui/Provenance";

/**
 * Error, empty, degraded and omitted states (workstream S12).
 *
 * Doc 02 §32 requires loading and error states; doc 04 §4.5 requires that L4 REFUSE
 * to render. These are not decorative variations on a card — each one exists
 * because a specific failure mode would otherwise be invisible:
 *
 *   `EmptyState`      nothing to show, and that is a legitimate outcome
 *   `ErrorState`      something broke; `recoverable` decides retry vs. degrade
 *   `DegradedNotice`  it worked, but at a lower fallback level — the user is told
 *   `HardFailState`   L4. Rendering here would be presenting a fabricated profile
 *   `OmittedViz`      a chart that cannot be drawn honestly is not drawn
 *   `LoadingState`    the skeleton matches the real layout so nothing jumps
 *
 * The common failure these guard against is the "plausible empty" one: a chart
 * that renders with no data looks identical to a chart that rendered correctly
 * and found nothing. Every state here says which of those it is.
 */

// ---------------------------------------------------------------------------
// Shared shell
// ---------------------------------------------------------------------------

function StateShell({
  tone,
  title,
  children,
  actions,
  className,
}: {
  tone: "neutral" | "warning" | "critical";
  title: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`cd-state cd-state--${tone}${className ? ` ${className}` : ""}`} role={tone === "critical" ? "alert" : "status"}>
      <h3 className="cd-state__title">{title}</h3>
      {children ? <div className="cd-state__body">{children}</div> : null}
      {actions ? <div className="cd-state__actions">{actions}</div> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty
// ---------------------------------------------------------------------------

export function EmptyState({
  title,
  message,
  hint,
  action,
  className,
}: {
  title: string;
  message: string;
  hint?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <StateShell tone="neutral" title={title} actions={action} className={className}>
      <p>{message}</p>
      {hint ? <p className="cd-state__hint">{hint}</p> : null}
    </StateShell>
  );
}

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export interface ErrorInfo {
  code: string;
  message: string;
  recoverable: boolean;
  status?: number;
}

/**
 * `recoverable` drives the affordance, not the HTTP status.
 *
 * A 429 and a network failure both deserve a retry; a 400 does not, because
 * retrying the same invalid body produces the same 400. Guessing from the status
 * code would offer a retry button that cannot work.
 */
export function ErrorState({
  error,
  onRetry,
  title = "That did not work",
  className,
}: {
  error: ErrorInfo;
  onRetry?: () => void;
  title?: string;
  className?: string;
}) {
  const advice = ADVICE_FOR_CODE[error.code] ?? DEFAULT_ADVICE;

  return (
    <StateShell
      tone={error.recoverable ? "warning" : "critical"}
      title={title}
      className={className}
      actions={
        error.recoverable && onRetry ? (
          <button type="button" className="cd-button cd-button--ghost cd-button--sm" onClick={onRetry}>
            Try again
          </button>
        ) : undefined
      }
    >
      <p>{error.message}</p>
      <p className="cd-state__hint">{advice}</p>
      <p className="cd-state__code">
        <code>{error.code}</code>
        {error.status ? <code>HTTP {error.status}</code> : null}
      </p>
      {/* Stated explicitly, because the natural assumption after a failure is
          that the app quietly made something up to fill the gap. */}
      <p className="cd-state__assurance">
        Nothing was fabricated in place of this result.
      </p>
    </StateShell>
  );
}

const ADVICE_FOR_CODE: Record<string, string> = {
  rate_limited: "The data source is rate-limiting requests. Waiting a moment and retrying usually clears it.",
  quota_exhausted: "The API quota for this key is exhausted. Results stay unavailable until it resets.",
  not_configured: "No API key is configured on this deployment, so live data cannot be retrieved.",
  timeout: "The request took too long and was abandoned rather than left hanging.",
  network: "The data source could not be reached. Check the connection and retry.",
  unauthorized: "The API key was rejected. Check that it is set and that the base URL is correct.",
  forbidden_type: "This key is not entitled to that entity type. Other categories may still work.",
  invalid_request: "The request was malformed. Adjust the inputs rather than retrying unchanged.",
  malformed_response: "The data source returned something that did not match its documented shape. Nothing was guessed to fill the gap.",
  unsupported: "This provider does not support that operation.",
  no_resolved_signals: "None of the selected interests could be matched to a known entity, so there was nothing to personalise from.",
  no_mappable_entity_type: "The matched interests have no equivalent recommendation category, so no results could be requested.",
};

const DEFAULT_ADVICE =
  "The analysis stopped at this step rather than substituting a plausible-looking value.";

// ---------------------------------------------------------------------------
// Degraded
// ---------------------------------------------------------------------------

/**
 * Shows the fallback level and every condition that forced it.
 *
 * `degradations` is a LIST, not a single reason, because the levels form an
 * ordered chain and several conditions can apply at once (doc 04 §4.5). Collapsing
 * them to one level loses information the creator is entitled to.
 */
export function DegradedNotice({
  level,
  degradations,
  source,
  className,
}: {
  level: FallbackLevel;
  degradations: readonly string[];
  source: DataSource;
  className?: string;
}) {
  if (level === "L0" && degradations.length === 0) return null;

  return (
    <div className={`cd-degraded${className ? ` ${className}` : ""}`} role="status">
      <div className="cd-degraded__head">
        <span className="cd-degraded__level" aria-label={`Fallback level ${level}`}>
          {level}
        </span>
        <span className="cd-degraded__summary">{FALLBACK_DESCRIPTIONS[level]}</span>
        {source.isIllustrative ? <ProvenanceBadge provenance="synthetic" /> : null}
      </div>
      {degradations.length > 0 ? (
        <ul className="cd-degraded__list">
          {degradations.map((degradation, index) => (
            <li key={`${index}|${degradation}`}>{degradation}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hard fail (L4)
// ---------------------------------------------------------------------------

/**
 * The L4 state. Doc 04 §4.5 and doc 03 §11: signals were silently ignored, so
 * there is no taste profile to show.
 *
 * This is the one state that must be visually unmistakable and must offer no
 * result. The temptation is to show the raw result set anyway with a warning —
 * that is exactly the failure the level exists to prevent, because an
 * unpersonalised popularity list wearing a warning badge still reads as "your
 * taste". So: no data, no chart, no partial list.
 */
export function HardFailState({
  reasons,
  onRestart,
  className,
}: {
  reasons: readonly string[];
  onRestart?: () => void;
  className?: string;
}) {
  return (
    <StateShell
      tone="critical"
      title="No taste profile is shown"
      className={className}
      actions={
        onRestart ? (
          <button type="button" className="cd-button cd-button--primary cd-button--sm" onClick={onRestart}>
            Start again
          </button>
        ) : undefined
      }
    >
      <p>
        The data source returned results, but they did not change when the inputs changed. It is not
        using the signals at all, so anything built on that response would be a generic popularity
        list presented as your taste. CreatorsDNA refuses to render it.
      </p>
      {reasons.length > 0 ? (
        <ul className="cd-degraded__list">
          {reasons.map((reason, index) => (
            <li key={`${index}|${reason}`}>{reason}</li>
          ))}
        </ul>
      ) : null}
      <p className="cd-state__hint">
        This is a data-source problem, not a problem with the interests supplied. Retrying the same
        inputs against the same source will produce the same result.
      </p>
    </StateShell>
  );
}

// ---------------------------------------------------------------------------
// Omitted visualisation
// ---------------------------------------------------------------------------

/**
 * Stand-in for a chart whose `meta.renderable` is false.
 *
 * Doc 05 §13 permits — and sometimes requires — omitting a visualisation when the
 * data cannot support it. The space is kept and labelled rather than collapsed,
 * so a reader comparing two creators sees that a chart is MISSING for one of them
 * instead of concluding that creator simply has nothing there.
 */
export function OmittedViz({
  title,
  reason,
  className,
}: {
  title: string;
  reason: string;
  className?: string;
}) {
  return (
    <div className={`cd-omitted${className ? ` ${className}` : ""}`} role="status">
      <span className="cd-omitted__title">{title}</span>
      <span className="cd-omitted__reason">{reason}</span>
      <span className="cd-omitted__mark" aria-hidden="true">
        Omitted
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/**
 * Skeleton blocks sized to the layout they will be replaced by.
 *
 * `lines` is a shape hint, not content: a skeleton that does not resemble the
 * final layout causes a visible jump when data lands, which reads as a bug even
 * when it is not.
 */
export function LoadingState({
  title = "Analysing",
  lines = 3,
  className,
}: {
  title?: string;
  lines?: number;
  className?: string;
}) {
  return (
    <div className={`cd-loading${className ? ` ${className}` : ""}`} aria-busy="true" aria-live="polite">
      <span className="cd-loading__title">{title}</span>
      <span className="cd-sr-only">Loading</span>
      <div className="cd-loading__bars" aria-hidden="true">
        {Array.from({ length: Math.max(1, lines) }, (_, index) => (
          <span
            key={index}
            className="cd-skeleton cd-loading__bar animate-shimmer"
            style={{ width: `${100 - index * 11}%` }}
          />
        ))}
      </div>
    </div>
  );
}

/** A generic skeleton panel for card grids. */
export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={`cd-skeleton cd-skeleton-card animate-shimmer${className ? ` ${className}` : ""}`} aria-hidden="true" />
  );
}
