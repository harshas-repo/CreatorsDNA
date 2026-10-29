"use client";

import { useState } from "react";

import type {
  BrandPathSegment,
  BrandPathway,
  BrandRelationshipMapViewModel,
  NodeIdentity,
} from "@/lib/contracts/viewModels";
import { ROLE_SHAPE, provenanceStyle, roleColour } from "@/lib/design/colourRoles";
import { ShapeGlyph } from "@/components/shapes/ShapeGlyph";
import { QlooInsightBadge } from "@/components/ui/Provenance";
import { VizFrame } from "@/components/viz/VizFrame";

/**
 * D — Culture-to-brand relationship map (doc 05 §10D).
 *
 * The chart exists to answer "why this brand?" as a chain rather than a number:
 * interest → cultural affinity → brand. Two rules shape it.
 *
 *  1. **Every link states whose reasoning it is.** `segment.basis` is either
 *     `qloo_explainability` or `creatorsdna_matching`, and the two are drawn with
 *     different line styles AND labelled in words beneath the line. Doc 05 §10D
 *     requires the distinction; a chart that draws both links identically makes
 *     our own category overlap look like a Qloo explanation, which is the single
 *     most misleading thing this product could do.
 *  2. **`fallbackNotice` is rendered above the chains, not in a tooltip.** When
 *     no link is Qloo-sourced the notice says so for the whole chart, because a
 *     per-pathway badge alone leaves the impression that the OTHER pathways were
 *     explained by the data source.
 *
 * A pathway with no segments is skipped rather than drawn as a lone brand node —
 * an unconnected brand reads as "matched, reasons withheld".
 */

const WIDTH = 720;
const HEIGHT = 156;
const PAD_X = 66;
const NODE_Y = 70;

/** Line style keyed by `basis`, so the encoding lives in one table. */
const BASIS_STYLE: Record<
  BrandPathSegment["basis"],
  { dash: string | undefined; label: string }
> = {
  qloo_explainability: {
    dash: undefined,
    label: "Returned by the data source",
  },
  creatorsdna_matching: {
    // Same dash vocabulary as `PROVENANCE_STYLE.derived`: this link is ours.
    dash: "6 4",
    label: "CreatorsDNA matching",
  },
};

export function CultureToBrandMap({ model }: { model: BrandRelationshipMapViewModel }) {
  const [selected, setSelected] = useState<string | undefined>(undefined);

  const pathways = model.pathways.filter((pathway) => pathway.segments.length > 0);
  const active =
    selected === undefined ? undefined : pathways.find((pathway) => pathway.brandId === selected);

  return (
    <VizFrame
      index="D"
      title="Culture to brand"
      subtitle="The chain from what you make, through the culture you are close to, to a brand."
      meta={model.meta}
      legend={model.legend}
      provenances={[
        ...new Set(
          pathways.flatMap((pathway) =>
            nodesOf(pathway).map((node) => node.provenance),
          ),
        ),
      ]}
      footnotes={
        <ul className="cd-path__key">
          {Object.entries(BASIS_STYLE).map(([basis, style]) => (
            <li key={basis}>
              <svg viewBox="0 0 34 8" width="34" height="8" aria-hidden="true" focusable="false">
                <line
                  x1="1"
                  y1="4"
                  x2="33"
                  y2="4"
                  stroke="rgb(var(--chart-axis))"
                  strokeWidth="3"
                  strokeDasharray={style.dash}
                />
              </svg>
              <span>{style.label}</span>
            </li>
          ))}
          <li>
            <span className="cd-path__key-note">
              Line thickness is the strength of that link within this analysis, normalised — it is
              not a probability and not a share of an audience.
            </span>
          </li>
        </ul>
      }
    >
      {model.fallbackNotice ? (
        <p className="cd-path__notice" role="note">
          {model.fallbackNotice}
        </p>
      ) : null}

      <ul className="cd-path__list">
        {pathways.map((pathway) => (
          <li key={pathway.brandId} className="cd-path__item">
            <div className="cd-path__head">
              <h4 className="cd-path__brand">{pathway.brandName}</h4>
              <span className="cd-path__badges">
                <ExplainabilityChip status={pathway.explainabilityStatus} />
                <QlooInsightBadge
                  provenance={pathway.evidenceIsQlooSourced ? "qloo" : "derived"}
                  source={model.meta.source}
                />
                <button
                  type="button"
                  className="cd-button cd-button--ghost cd-button--xs"
                  onClick={() =>
                    setSelected(selected === pathway.brandId ? undefined : pathway.brandId)
                  }
                  aria-expanded={selected === pathway.brandId}
                >
                  {selected === pathway.brandId ? "Hide links" : "Inspect links"}
                </button>
              </span>
            </div>

            <PathwayChain pathway={pathway} detailed={selected === pathway.brandId} />
          </li>
        ))}
      </ul>

      {active ? <PathwayTable pathway={active} /> : null}
    </VizFrame>
  );
}

// ---------------------------------------------------------------------------
// The chain
// ---------------------------------------------------------------------------

function PathwayChain({ pathway, detailed }: { pathway: BrandPathway; detailed: boolean }) {
  const nodes = nodesOf(pathway);
  const step = (WIDTH - PAD_X * 2) / Math.max(1, nodes.length - 1);
  const xOf = (index: number) => PAD_X + index * step;

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="cd-path__svg"
      role="img"
      aria-label={`Chain for ${pathway.brandName}: ${nodes
        .map((node) => node.label)
        .join(" to ")}`}
    >
      {pathway.segments.map((segment, index) => {
        const x1 = xOf(index) + 16;
        const x2 = xOf(index + 1) - 16;
        const mid = (x1 + x2) / 2;
        const style = BASIS_STYLE[segment.basis];

        return (
          <g key={`${segment.from.id}->${segment.to.id}`}>
            <line
              x1={x1}
              y1={NODE_Y}
              x2={x2}
              y2={NODE_Y}
              stroke={roleColour(segment.role)}
              strokeWidth={1.5 + clamp01(segment.strength) * 5}
              strokeDasharray={style.dash}
              strokeLinecap="round"
              opacity={0.85}
            />
            {/* Arrowhead: the chain is directional and reading it backwards would
                invert the claim (brand → taste is not what is being said). */}
            <path
              d={`M${x2 - 9} ${NODE_Y - 5} L${x2} ${NODE_Y} L${x2 - 9} ${NODE_Y + 5} Z`}
              fill={roleColour(segment.role)}
              opacity={0.85}
            />
            <text
              x={mid}
              y={NODE_Y - 14}
              textAnchor="middle"
              className="cd-path__strength"
              fill="rgb(var(--text-muted))"
            >
              {segment.strength.toFixed(2)}
            </text>
            <text
              x={mid}
              y={NODE_Y + 26}
              textAnchor="middle"
              className="cd-path__basis"
              fill="rgb(var(--text-faint))"
            >
              {style.label}
            </text>
          </g>
        );
      })}

      {nodes.map((node, index) => (
        <ChainNode key={node.id} node={node} x={xOf(index)} detailed={detailed} />
      ))}
    </svg>
  );
}

function ChainNode({
  node,
  x,
  detailed,
}: {
  node: NodeIdentity;
  x: number;
  detailed: boolean;
}) {
  const shape = ROLE_SHAPE[node.role] ?? "circle";
  const style = provenanceStyle(node.provenance);

  return (
    <g>
      {/* `<title>` must be the first child or browsers do not surface it. */}
      <title>{`${node.label} — ${style.label}`}</title>
      <g transform={`translate(${x - 13} ${NODE_Y - 13})`}>
        <ShapeGlyph
          shape={shape}
          role={node.role}
          size={26}
          hollow={node.provenance === "synthetic"}
          dash={style.dash === "none" ? undefined : style.dash}
        />
      </g>
      <text
        x={x}
        y={NODE_Y - 26}
        textAnchor="middle"
        className="cd-path__node-label"
        fill="rgb(var(--text-ink))"
      >
        {truncate(node.label, 20)}
      </text>
      <text
        x={x}
        y={NODE_Y + 46}
        textAnchor="middle"
        className="cd-path__node-prov"
        fill="rgb(var(--text-faint))"
      >
        {style.label}
      </text>
      {detailed ? (
        <text
          x={x}
          y={NODE_Y + 60}
          textAnchor="middle"
          className="cd-path__node-id"
          fill="rgb(var(--text-faint))"
        >
          {truncate(node.id, 22)}
        </text>
      ) : null}
    </g>
  );
}

/**
 * The inspect panel, as a table rather than more graphics.
 *
 * When someone asks "where did this number come from", the useful answer is the
 * exact basis string and the two endpoints — text, at readable size, selectable
 * and copyable. Redrawing it as a bigger chart would answer a different question.
 */
function PathwayTable({ pathway }: { pathway: BrandPathway }) {
  return (
    <div className="cd-path__detail" role="region" aria-label={`Link detail for ${pathway.brandName}`}>
      <table className="cd-table">
        <caption>{pathway.brandName} — every link in the chain</caption>
        <thead>
          <tr>
            <th scope="col">From</th>
            <th scope="col">To</th>
            <th scope="col">Strength</th>
            <th scope="col">Basis</th>
          </tr>
        </thead>
        <tbody>
          {pathway.segments.map((segment) => (
            <tr key={`${segment.from.id}->${segment.to.id}`}>
              <td>{segment.from.label}</td>
              <td>{segment.to.label}</td>
              <td className="cd-tabular">{segment.strength.toFixed(3)}</td>
              <td>{BASIS_STYLE[segment.basis].label}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Explainability status in words.
 *
 * `unavailable` says "no explanation returned" rather than "not explained": the
 * difference matters because the absence is the data source's, and the chart
 * still shows a chain — it just labels every link as ours.
 */
const EXPLAINABILITY_LABEL: Record<BrandPathway["explainabilityStatus"], string> = {
  available: "Explained by the data source",
  warning: "Explained, with a warning",
  unavailable: "No explanation returned",
  synthetic: "Illustrative explanation",
};

function ExplainabilityChip({ status }: { status: BrandPathway["explainabilityStatus"] }) {
  const label = EXPLAINABILITY_LABEL[status];
  return (
    <span className={`cd-path__chip cd-path__chip--${status}`}>{label}</span>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * The chain's nodes in order: the first segment's `from`, then each segment's
 * `to`. Derived from the segments rather than stored separately so the drawing
 * cannot disagree with the data about how long the chain is.
 */
function nodesOf(pathway: BrandPathway): NodeIdentity[] {
  const [first, ...rest] = pathway.segments;
  if (first === undefined) return [];
  return [first.from, first.to, ...rest.map((segment) => segment.to)];
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}
