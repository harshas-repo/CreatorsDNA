import type { ReactNode } from "react";

import type { VisualizationMeta } from "@/lib/contracts/viewModels";
import { Legend, ProvenanceBadge, ProvenanceKey } from "@/components/ui/Provenance";
import { OmittedViz } from "@/components/ui/States";
import type { LegendEntry } from "@/lib/contracts/viewModels";
import type { Provenance } from "@/lib/contracts/domain";

/**
 * The frame every visualisation is rendered inside.
 *
 * Doc 05 §10 lists six charts, and the easy mistake is six components each
 * inventing its own title bar, its own legend and its own "where did this come
 * from" note — which is how one chart ends up disclosing its methodology and
 * another does not. `VizFrame` makes disclosure structural: a chart that uses
 * this frame CANNOT hide its source, its method or its fallback level, because
 * they are props of the frame rather than choices of the chart.
 *
 * It also owns the omission rule. `meta.renderable === false` renders
 * `OmittedViz` and never the children, so no chart has to remember to check.
 */

export interface VizFrameProps {
  /** Chart id, e.g. "A". Rendered as the index doc 05 §10 uses. */
  index?: string;
  title: string;
  /** One sentence on what the chart shows. Not the methodology — that comes from meta. */
  subtitle?: string;
  meta: VisualizationMeta;
  legend?: readonly LegendEntry[];
  /** Provenance classes present in the data, for the source key. */
  provenances?: readonly Provenance[];
  /** Extra controls (group/filter toggles) aligned to the right of the header. */
  controls?: ReactNode;
  /** Footnotes the chart needs beyond the standard methodology line. */
  footnotes?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function VizFrame({
  index,
  title,
  subtitle,
  meta,
  legend,
  provenances,
  controls,
  footnotes,
  children,
  className,
}: VizFrameProps) {
  const headingId = `viz-${(index ?? title).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

  return (
    <figure className={`cd-viz${className ? ` ${className}` : ""}`} aria-labelledby={headingId}>
      <figcaption className="cd-viz__head">
        <div className="cd-viz__heading">
          <h3 id={headingId} className="cd-viz__title">
            {index ? <span className="cd-viz__index">{index}</span> : null}
            {title}
          </h3>
          {subtitle ? <p className="cd-viz__subtitle">{subtitle}</p> : null}
        </div>

        <div className="cd-viz__badges">
          <span className="cd-viz__level" title={meta.fallbackLevel}>
            {meta.fallbackLevel}
          </span>
          <ProvenanceBadge provenance={meta.provenance} />
          {controls}
        </div>
      </figcaption>

      {/* The banner is unconditional on illustrative data. A badge alone can be
          cropped out of a screenshot; a full-width band cannot. */}
      {meta.containsSynthetic ? (
        <p className="cd-viz__synthetic" role="note">
          Illustrative data — generated for development.{" "}
          {meta.source.isIllustrative
            ? "This analysis runs on the synthetic dataset, so nothing here is a Qloo discovery."
            : "Some values in this chart are illustrative rather than retrieved; they are marked individually."}
        </p>
      ) : null}

      {!meta.renderable ? (
        <OmittedViz
          title={title}
          reason={meta.omittedReason ?? "The available data cannot support this visualisation."}
        />
      ) : (
        <>
          <div className="cd-viz__body">{children}</div>

          {legend && legend.length > 0 ? <Legend entries={legend} /> : null}
          {provenances && provenances.length > 0 ? (
            <ProvenanceKey provenances={provenances} />
          ) : null}
        </>
      )}

      <div className="cd-viz__foot">
        <p className="cd-viz__method">
          <span className="cd-viz__method-label">Method</span>
          {meta.methodology}
        </p>
        {footnotes}
      </div>
    </figure>
  );
}
