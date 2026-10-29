import type { ReactNode } from "react";

import type { VisualizationMeta } from "@/lib/contracts/viewModels";
import { ProvenanceBadge } from "@/components/ui/Provenance";

/**
 * `InsightSection` (doc 02 §30).
 *
 * The page-level wrapper around one insight: Taste DNA, unexpected affinities,
 * untapped cultural connections, brands you overlap with. Doc 02 §28's flow is a
 * sequence of these, and doc 02 §30 says not to duplicate UI logic across pages —
 * so the heading hierarchy, the methodology disclosure and the illustrative-data
 * banner are decided here once rather than per page.
 *
 * The heading level is a prop with a default rather than a fixed `<h2>`. These
 * sections appear both as top-level blocks on the results page and nested inside
 * a `<section>` on the marketing page, and a hardcoded level would produce a
 * document outline that skips or repeats a level in one of the two.
 *
 * When `meta` is supplied the section CANNOT hide its source: the badge, the
 * methodology sentence and the illustrative banner are all rendered from it. That
 * mirrors what `VizFrame` does for charts, for the same reason — disclosure has
 * to be structural, or it becomes optional under deadline.
 */

export interface InsightSectionProps {
  /** Anchor id, so the section can be linked from the nav. */
  id?: string;
  /** Optional step number rendered ahead of the title, e.g. "01". */
  index?: string;
  eyebrow?: string;
  title: string;
  /** One or two sentences framing the insight. Prose, not a subtitle string. */
  lede?: ReactNode;
  /** Generated copy lines from `src/lib/copy/generate.ts`. */
  copy?: readonly string[];
  /** Supplies the provenance badge, methodology and illustrative banner. */
  meta?: VisualizationMeta;
  /** Narrow column beside the main content — a legend, a key, a caveat. */
  aside?: ReactNode;
  /**
   * Collapsible "how this was produced" disclosure. Keeps the lede to one line
   * while leaving the full reasoning a click away, instead of repeating
   * methodology the `/methodology` page and the `meta.methodology` line below
   * already carry. Decided once here rather than hand-rolled per stage (doc 02
   * §30), so every section's disclosure opens the same way.
   */
  details?: { summary: string; body: ReactNode };
  /** Heading level for `title`. Defaults to 2. */
  headingLevel?: 2 | 3 | 4;
  children?: ReactNode;
  className?: string;
}

export function InsightSection({
  id,
  index,
  eyebrow,
  title,
  lede,
  copy,
  meta,
  aside,
  details,
  headingLevel = 2,
  children,
  className,
}: InsightSectionProps) {
  const Heading = `h${headingLevel}` as const;
  const headingId = id === undefined ? undefined : `${id}-title`;

  return (
    <section
      id={id}
      className={`cd-insight${className ? ` ${className}` : ""}`}
      aria-labelledby={headingId}
    >
      <header className="cd-insight__head">
        {eyebrow ? <p className="cd-eyebrow">{eyebrow}</p> : null}
        <Heading id={headingId} className="cd-insight__title">
          {index ? <span className="cd-insight__index">{index}</span> : null}
          {title}
        </Heading>
        {lede ? <div className="cd-insight__lede cd-measure">{lede}</div> : null}
        {meta ? (
          <div className="cd-insight__badges">
            <span className="cd-viz__level" title={meta.fallbackLevel}>
              {meta.fallbackLevel}
            </span>
            <ProvenanceBadge provenance={meta.provenance} />
          </div>
        ) : null}
      </header>

      {/* Unconditional, for the same reason `VizFrame` does it: a badge can be
          cropped out of a screenshot, a band across the section cannot. */}
      {meta?.containsSynthetic ? (
        <p className="cd-viz__synthetic" role="note">
          Illustrative data — generated for development.{" "}
          {meta.source.isIllustrative
            ? "This analysis runs on the synthetic dataset, so nothing here is a Qloo discovery."
            : "Some values in this section are illustrative rather than retrieved; they are marked individually."}
        </p>
      ) : null}

      {copy && copy.length > 0 ? (
        <div className="cd-insight__copy cd-measure">
          {copy.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      ) : null}

      {details ? (
        <details className="cd-insight__details">
          <summary className="cd-insight__details-summary">{details.summary}</summary>
          <div className="cd-insight__details-body cd-measure">{details.body}</div>
        </details>
      ) : null}

      {aside !== undefined || children !== undefined ? (
        <div className={`cd-insight__grid${aside === undefined ? " cd-insight__grid--full" : ""}`}>
          {children !== undefined ? <div className="cd-insight__main">{children}</div> : null}
          {aside !== undefined ? <aside className="cd-insight__aside">{aside}</aside> : null}
        </div>
      ) : null}

      {meta ? (
        <p className="cd-insight__method">
          <span className="cd-viz__method-label">Method</span>
          {meta.methodology}
        </p>
      ) : null}
    </section>
  );
}
