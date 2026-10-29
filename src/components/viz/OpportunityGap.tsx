"use client";

import { useState } from "react";

import type { OpportunityGapViewModel, OpportunityPoint } from "@/lib/contracts/viewModels";
import { roleColour } from "@/lib/design/colourRoles";
import { VizFrame } from "@/components/viz/VizFrame";
import { EmptyState } from "@/components/ui/States";

/**
 * C — Opportunity-gap scatter (doc 05 §10C).
 *
 * X is cultural affinity, Y is existing content coverage. The interesting corner
 * is high affinity / low coverage: territory the creator is genuinely close to
 * and has not made content about.
 *
 * Two honesty rules drive the implementation:
 *
 *  1. **The axes are FIXED at 0..1 and never fitted to the observed range.** A
 *     scatter that auto-scales to its own data turns three clustered points into
 *     three widely separated ones, which is a visual claim the numbers do not
 *     make. Fitting the axes is the standard way this chart lies.
 *  2. **Coverage basis is stated per point and in the header.** Doc 05 §10C
 *     forbids implying coverage was measured when it was creator-declared, so
 *     `coverageMethodology` is rendered verbatim in the footnote and every point
 *     carries its own `coverageBasis`.
 *
 *     The `unavailable` case is handled defensively below but is not reachable
 *     through the current derivation: `deriveOpportunityGaps` moves a category
 *     with unknown coverage into its `omitted` list rather than plotting it, and
 *     reports the count in `coverageMethodology`. It becomes reachable only if
 *     that rule changes, at which point the hollow dashed mark is what keeps
 *     "coverage unknown" from reading as "coverage zero" — a difference the whole
 *     chart depends on.
 *
 * No quadrant is styled as good or bad (doc 05 §12): saturated territory is a
 * legitimate finding, not a failure, and red/green are not in the palette.
 */

const WIDTH = 680;
const HEIGHT = 460;
const MARGIN = { top: 24, right: 28, bottom: 58, left: 62 };
const PLOT_W = WIDTH - MARGIN.left - MARGIN.right;
const PLOT_H = HEIGHT - MARGIN.top - MARGIN.bottom;

export function OpportunityGap({ model }: { model: OpportunityGapViewModel }) {
  const [selected, setSelected] = useState<string | undefined>(undefined);

  const points = model.points;
  const active = selected === undefined ? undefined : points.find((point) => point.id === selected);

  const x = (affinity: number) => MARGIN.left + clamp01(affinity) * PLOT_W;
  // Y is inverted: high coverage at the TOP, so the empty corner the product
  // cares about (high affinity, low coverage) sits bottom-right and reads as a
  // gap rather than as a peak.
  const y = (coverage: number) => MARGIN.top + (1 - clamp01(coverage)) * PLOT_H;

  return (
    <VizFrame
      index="C"
      title="Opportunity gap"
      subtitle="Cultural affinity against the coverage you declared, by category."
      meta={model.meta}
      legend={model.legend}
      provenances={[...new Set(points.map((point) => point.provenance))]}
      footnotes={
        <>
          <p className="cd-viz__footnote">
            <strong>Coverage basis:</strong> {model.coverageMethodology}
          </p>
          <ul className="cd-quadrant-key">
            {model.quadrants.map((quadrant) => (
              <li key={quadrant.id}>
                <span className="cd-quadrant-key__dot" style={{ backgroundColor: roleColour(quadrant.role) }} aria-hidden="true" />
                <strong>{quadrant.label}</strong> — {quadrant.description}
              </li>
            ))}
          </ul>
        </>
      }
    >
      {points.length === 0 ? (
        <EmptyState
          title="No categories to compare"
          message="Affinity and coverage could not both be established for any category, so there is no gap to plot."
          hint="Declare the categories you already cover, and add interests that resolve to entities."
        />
      ) : (
        <div className="cd-scatter">
          <svg
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            className="cd-scatter__svg"
            role="img"
            aria-label={`Scatter of ${points.length} categories, cultural affinity against existing coverage`}
          >
            {/* Quadrant tints. Drawn at very low opacity so they read as regions,
                not as a heatmap of value. */}
            {model.quadrants.map((quadrant, index) => {
              const qx = MARGIN.left + (index % 2 === 0 ? 0 : PLOT_W / 2);
              const qy = MARGIN.top + (index < 2 ? 0 : PLOT_H / 2);
              return (
                <rect
                  key={quadrant.id}
                  x={qx}
                  y={qy}
                  width={PLOT_W / 2}
                  height={PLOT_H / 2}
                  fill={roleColour(quadrant.role)}
                  opacity={0.05}
                />
              );
            })}

            <GridLines x={x} y={y} />
            <Axes model={model} x={x} y={y} />

            {points.map((point) => (
              <ScatterPoint
                key={point.id}
                point={point}
                cx={x(point.affinity)}
                cy={y(point.coverage)}
                selected={selected === point.id}
                onSelect={() => setSelected(selected === point.id ? undefined : point.id)}
              />
            ))}
          </svg>

          {active ? <PointDetail point={active} /> : null}
        </div>
      )}
    </VizFrame>
  );
}

function GridLines({ x, y }: { x: (v: number) => number; y: (v: number) => number }) {
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  return (
    <g stroke="rgb(var(--chart-grid))" opacity={0.12}>
      {ticks.map((tick) => (
        <line key={`v${tick}`} x1={x(tick)} x2={x(tick)} y1={MARGIN.top} y2={MARGIN.top + PLOT_H} />
      ))}
      {ticks.map((tick) => (
        <line key={`h${tick}`} x1={MARGIN.left} x2={MARGIN.left + PLOT_W} y1={y(tick)} y2={y(tick)} />
      ))}
      {/* The midlines, slightly stronger, so the four quadrants are legible. */}
      <line
        x1={x(0.5)}
        x2={x(0.5)}
        y1={MARGIN.top}
        y2={MARGIN.top + PLOT_H}
        stroke="rgb(var(--chart-axis))"
        opacity={0.35}
      />
      <line
        x1={MARGIN.left}
        x2={MARGIN.left + PLOT_W}
        y1={y(0.5)}
        y2={y(0.5)}
        stroke="rgb(var(--chart-axis))"
        opacity={0.35}
      />
    </g>
  );
}

function Axes({
  model,
  x,
  y,
}: {
  model: OpportunityGapViewModel;
  x: (v: number) => number;
  y: (v: number) => number;
}) {
  const ticks = [0, 0.5, 1];
  return (
    <g>
      <line
        x1={MARGIN.left}
        x2={MARGIN.left + PLOT_W}
        y1={MARGIN.top + PLOT_H}
        y2={MARGIN.top + PLOT_H}
        stroke="rgb(var(--chart-axis))"
        opacity={0.55}
      />
      <line
        x1={MARGIN.left}
        x2={MARGIN.left}
        y1={MARGIN.top}
        y2={MARGIN.top + PLOT_H}
        stroke="rgb(var(--chart-axis))"
        opacity={0.55}
      />

      {ticks.map((tick) => (
        <text
          key={`x${tick}`}
          x={x(tick)}
          y={MARGIN.top + PLOT_H + 18}
          textAnchor="middle"
          className="cd-scatter__tick"
          fill="rgb(var(--chart-label))"
        >
          {tick.toFixed(1)}
        </text>
      ))}
      {ticks.map((tick) => (
        <text
          key={`y${tick}`}
          x={MARGIN.left - 10}
          y={y(tick) + 4}
          textAnchor="end"
          className="cd-scatter__tick"
          fill="rgb(var(--chart-label))"
        >
          {tick.toFixed(1)}
        </text>
      ))}

      <text
        x={MARGIN.left + PLOT_W / 2}
        y={HEIGHT - 26}
        textAnchor="middle"
        className="cd-scatter__axis-title"
        fill="rgb(var(--text-muted))"
      >
        {model.axes.x.label} →
      </text>
      <text
        x={16}
        y={MARGIN.top + PLOT_H / 2}
        textAnchor="middle"
        className="cd-scatter__axis-title"
        fill="rgb(var(--text-muted))"
        transform={`rotate(-90 16 ${MARGIN.top + PLOT_H / 2})`}
      >
        ↑ {model.axes.y.label}
      </text>

      {/* Axis meanings, rendered on the chart. Doc 05 §10B: no bare numbers
          without a stated basis. */}
      <text x={MARGIN.left} y={HEIGHT - 8} className="cd-scatter__axis-meaning" fill="rgb(var(--text-faint))">
        {model.axes.x.meaning}
      </text>
      <text x={MARGIN.left + PLOT_W} y={HEIGHT - 8} textAnchor="end" className="cd-scatter__axis-meaning" fill="rgb(var(--text-faint))">
        {model.axes.y.meaning}
      </text>
    </g>
  );
}

function ScatterPoint({
  point,
  cx,
  cy,
  selected,
  onSelect,
}: {
  point: OpportunityPoint;
  cx: number;
  cy: number;
  selected: boolean;
  onSelect: () => void;
}) {
  // Radius encodes how much evidence sits behind the point. A category resting on
  // one entity is drawn smaller, so a confident-looking dot is not mistaken for a
  // well-supported one.
  const radius = 5 + Math.min(9, point.supportCount * 1.6);
  const unknownCoverage = point.coverageBasis === "unavailable";
  const inferredCoverage = point.coverageBasis === "inferred_zero";

  return (
    <g
      className="cd-scatter__point"
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
      tabIndex={0}
      role="button"
      aria-pressed={selected}
      aria-label={`${point.label}: affinity ${point.affinity.toFixed(2)}, coverage ${
        unknownCoverage ? "unavailable" : point.coverage.toFixed(2)
      }, gap score ${point.gapScore.toFixed(2)}, ${point.supportCount} supporting entities`}
    >
      {/* ONE string child, never several. React's server renderer emits nothing
          at all for a `<title>` whose children form an array of two or more —
          `pushTitleImpl` resolves the text to `null` — while the client renders
          every child. The server HTML therefore carries `<title></title>`, the
          client carries a full sentence, and React answers the mismatch by
          throwing the whole tree away and re-rendering it ("Minified React error
          #418"). It does not exempt the SVG namespace, where `<title>` is an
          ordinary tooltip and not document metadata. The template literal also
          reproduces the previous spacing exactly: the `{" "}` that used to sit
          before the coverage value was only there to stop JSX trimming the
          newline, and a single string has no newline to trim. */}
      <title>{`${point.label} — affinity ${point.affinity.toFixed(2)}, coverage ${
        unknownCoverage ? "unavailable" : point.coverage.toFixed(2)
      }${inferredCoverage ? " (assumed uncovered — you did not state this)" : ""}, gap ${point.gapScore.toFixed(2)}`}</title>
      <circle
        cx={cx}
        cy={cy}
        r={radius}
        fill={roleColour(point.role)}
        fillOpacity={unknownCoverage ? 0.18 : 0.72}
        stroke={selected ? "rgb(var(--chart-highlight-stroke))" : roleColour(point.role)}
        strokeWidth={selected ? 2.5 : 1.5}
        // Unknown coverage is hollow AND dashed: two non-colour cues, because the
        // difference between "no coverage" and "coverage not established" is the
        // whole point of the chart. Inferred coverage keeps the fill (the value
        // IS plotted at zero) but uses a finer dash, so an assumption is visually
        // distinguishable from a statement without relying on colour.
        strokeDasharray={unknownCoverage ? "3 3" : inferredCoverage ? "1 2.5" : undefined}
      />
      <text x={cx} y={cy - radius - 5} textAnchor="middle" className="cd-scatter__label" fill="rgb(var(--text-ink))">
        {truncate(point.label, 18)}
      </text>
    </g>
  );
}

function PointDetail({ point }: { point: OpportunityPoint }) {
  return (
    <div className="cd-scatter__detail" role="region" aria-label={`Detail for ${point.label}`}>
      <h4>{point.label}</h4>
      <dl>
        <div>
          <dt>Cultural affinity</dt>
          <dd className="cd-tabular">{point.affinity.toFixed(3)}</dd>
        </div>
        <div>
          <dt>Coverage</dt>
          <dd className="cd-tabular">
            {point.coverageBasis === "unavailable"
              ? "not established"
              : `${point.coverage.toFixed(3)}${point.coverageBasis === "inferred_zero" ? " (assumed)" : ""}`}
          </dd>
        </div>
        <div>
          <dt>Gap score</dt>
          <dd className="cd-tabular">{point.gapScore.toFixed(3)}</dd>
        </div>
        <div>
          <dt>Supporting entities</dt>
          <dd className="cd-tabular">{point.supportCount}</dd>
        </div>
      </dl>
      <p className="cd-scatter__basis">
        Coverage basis: <strong>{BASIS_LABEL[point.coverageBasis]}</strong>. The gap score is
        derived by CreatorsDNA from the two values above — it is not a value returned by the data
        source.
      </p>
    </div>
  );
}

const BASIS_LABEL: Record<OpportunityPoint["coverageBasis"], string> = {
  creator_declared: "declared by you during onboarding, not measured",
  inferred_zero: "assumed by CreatorsDNA — you declared other categories but not this one, so it is plotted as uncovered",
  measured: "measured from published content",
  unavailable: "not established — plotted at the baseline, which is not the same as zero coverage",
};

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}
