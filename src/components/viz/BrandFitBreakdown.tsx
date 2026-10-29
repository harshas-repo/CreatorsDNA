"use client";

import type { BrandFitViewModel } from "@/lib/contracts/viewModels";
import { VizFrame } from "@/components/viz/VizFrame";
import { ScoreBreakdown } from "@/components/domain/ScoreBreakdown";

/**
 * E — Brand-fit breakdown (doc 05 §10E).
 *
 * Doc 05 §10E's warning is specific: an unexplained overall percentage is the
 * least trustworthy number a product can show. So the overall is never rendered
 * on its own — it is rendered beside its components, its disclosure and the count
 * of dimensions that actually contributed.
 *
 * The rows, the overall figure and the dimension→colour mapping all live in
 * `ScoreBreakdown` (doc 02 §30) rather than here. This component's job is the
 * frame: the index letter, the methodology, the legend, the provenance key and
 * the rationale prose. Keeping the two apart is what lets a `BrandCard` show the
 * same breakdown in miniature without a second implementation of the
 * renormalisation display drifting away from this one.
 */

export function BrandFitBreakdown({
  model,
  compact = false,
}: {
  model: BrandFitViewModel;
  /** Tighter layout for card grids and comparison tables. */
  compact?: boolean;
}) {
  return (
    <VizFrame
      index="E"
      title={`Brand fit — ${model.brandName}`}
      subtitle="What the fit score is made of, and what could not be computed."
      meta={model.meta}
      legend={model.legend}
      provenances={[...new Set(model.components.map((component) => component.provenance))]}
      className={compact ? "cd-viz--compact" : undefined}
      footnotes={
        <>
          {model.rationale.length > 0 ? (
            <ul className="cd-fit__rationale">
              {model.rationale.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : null}
          <p className="cd-viz__footnote">{model.overall.disclosure}</p>
        </>
      }
    >
      {/* `showDisclosure` is off because the disclosure is rendered in the frame's
          foot area above, next to the methodology, which is where this chart has
          always put its caveats. It is NOT suppressed — `VizFrame` renders
          `meta.methodology` there, which is a different sentence about how the
          values were produced, not about how much of the score is evidenced. */}
      <ScoreBreakdown
        components={model.components}
        overall={model.overall}
        compact={compact}
        showDisclosure={false}
      />
    </VizFrame>
  );
}
