"use client";

import { useState } from "react";

import type { FingerprintSpoke, TasteFingerprintViewModel } from "@/lib/contracts/viewModels";
import { ROLE_SHAPE, roleColour } from "@/lib/design/colourRoles";
import { polarPoint } from "@/lib/utils/deterministic";
import { ShapeGlyph } from "@/components/shapes/ShapeGlyph";
import { TasteSeal, shortSealHash } from "@/components/shapes/TasteSeal";
import { VizFrame } from "@/components/viz/VizFrame";
import { EmptyState } from "@/components/ui/States";

/**
 * F — Taste fingerprint (doc 05 §10F).
 *
 * Two separate things are drawn here and the separation is the whole point:
 *
 *  1. **A radar of `spokes`.** These are real values — category scores from the
 *     analysis — and the polygon passes through them exactly, with straight
 *     edges. No smoothing, no easing, no jitter: a curved radar reads as "the
 *     area between points means something", and it does not.
 *  2. **A deterministic seal.** Doc 05 §10F's requirement is that two creators
 *     with different data cannot receive the same graphic. The seal satisfies it
 *     by hashing the profile, and it is deliberately kept OUTSIDE the data area
 *     and labelled as an identity mark rather than a measurement. Mixing it into
 *     the radar would invite a reader to interpret a decorative bump as a score.
 *
 * A radar needs three axes to enclose an area at all. With one or two spokes the
 * polygon degenerates into a dot or a line, which looks like a chart and reads
 * like data that is missing — so below `MIN_SPOKES_FOR_RADAR` the same values are
 * drawn as a labelled list instead, and the reason is stated.
 */

const SIZE = 460;
const CX = SIZE / 2;
const CY = 200;
const R = 126;
const RINGS = [0.25, 0.5, 0.75, 1];
const MIN_SPOKES_FOR_RADAR = 3;

export function TasteFingerprint({ model }: { model: TasteFingerprintViewModel }) {
  const [selected, setSelected] = useState<string | undefined>(undefined);

  const spokes = model.spokes;
  const active = selected === undefined ? undefined : spokes.find((spoke) => spoke.axis === selected);
  const useRadar = spokes.length >= MIN_SPOKES_FOR_RADAR;

  return (
    <VizFrame
      index="F"
      title="Taste fingerprint"
      subtitle="The shape of this profile across its strongest cultural categories."
      meta={model.meta}
      legend={model.legend}
      provenances={[...new Set(spokes.map((spoke) => spoke.provenance))]}
      footnotes={
        <>
          <p className="cd-viz__footnote">
            Spoke length is each category&apos;s score, normalised within this analysis — 0 is the
            weakest category here and 1 the strongest. It is a relative position among your own
            categories, not a share of any audience and not comparable to another creator.
          </p>
          <p className="cd-viz__footnote">
            The seal is generated from a hash of this profile ({shortSealHash(model.signature)}), so a
            change in any score changes the pattern. It is an identity mark, not a measurement:
            nothing in it encodes a quantity.
          </p>
        </>
      }
    >
      {spokes.length === 0 ? (
        <EmptyState
          title="No fingerprint yet"
          message="No category scores were produced, so there is no shape to draw."
          hint="This usually means the analysis did not resolve enough interests to group into categories."
        />
      ) : (
        <div className="cd-print">
          <div className="cd-print__main">
            {useRadar ? (
              <Radar
                spokes={spokes}
                selected={selected}
                onSelect={(axis) => setSelected(selected === axis ? undefined : axis)}
              />
            ) : (
              <SpokeList spokes={spokes} count={spokes.length} />
            )}

            {active ? <SpokeDetail spoke={active} /> : null}
          </div>

          <aside className="cd-print__aside">
            <TasteSeal signature={model.signature} />
            <MarkerList model={model} />
          </aside>
        </div>
      )}
    </VizFrame>
  );
}

// ---------------------------------------------------------------------------
// Radar
// ---------------------------------------------------------------------------

function Radar({
  spokes,
  selected,
  onSelect,
}: {
  spokes: readonly FingerprintSpoke[];
  selected: string | undefined;
  onSelect: (axis: string) => void;
}) {
  const total = spokes.length;
  const outline = spokes.map((spoke, index) => polar(index, total, clamp01(spoke.value)));

  return (
    <svg
      viewBox={`0 0 ${SIZE} ${SIZE - 40}`}
      className="cd-print__svg"
      role="img"
      aria-label={`Radar chart of ${total} cultural categories. ${spokes
        .map((spoke) => `${spoke.label} ${spoke.value.toFixed(2)}`)
        .join(", ")}.`}
    >
      {/* Grid rings drawn as polygons, not circles: the reader is comparing a
          polygon against them, and a circular grid implies radial distance is the
          measure when the vertices are what carry the values. */}
      {RINGS.map((ring) => (
        <polygon
          key={ring}
          points={ringPoints(total, ring)}
          fill="none"
          stroke="rgb(var(--chart-grid))"
          strokeWidth={ring === 1 ? 1.25 : 1}
          opacity={ring === 1 ? 0.45 : 0.2}
        />
      ))}

      {spokes.map((spoke, index) => {
        const [x, y] = polar(index, total, 1);
        return (
          <line
            key={spoke.axis}
            x1={CX}
            y1={CY}
            x2={x}
            y2={y}
            stroke="rgb(var(--chart-grid))"
            opacity={0.22}
          />
        );
      })}

      {/* The ring value labels, on the vertical axis where nothing overlaps. */}
      {RINGS.map((ring) => (
        <text
          key={`label-${ring}`}
          x={CX + 5}
          y={CY - R * ring + 4}
          className="cd-print__ring-label"
          fill="rgb(var(--text-faint))"
        >
          {ring === 1 ? "1.0 strongest" : ring.toFixed(2)}
        </text>
      ))}
      <text x={CX + 5} y={CY + 12} className="cd-print__ring-label" fill="rgb(var(--text-faint))">
        0
      </text>

      <polygon
        points={outline.map(([x, y]) => `${x},${y}`).join(" ")}
        fill={roleColour("content")}
        fillOpacity={0.16}
        stroke={roleColour("content")}
        strokeWidth={2}
        strokeLinejoin="round"
      />

      {spokes.map((spoke, index) => {
        const [x, y] = polar(index, total, clamp01(spoke.value));
        const [lx, ly] = polar(index, total, 1.17);
        const isSelected = selected === spoke.axis;

        return (
          <g key={spoke.axis}>
            <g
              className="cd-print__vertex"
              onClick={() => onSelect(spoke.axis)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect(spoke.axis);
                }
              }}
              tabIndex={0}
              role="button"
              aria-pressed={isSelected}
              aria-label={`${spoke.label}: ${spoke.value.toFixed(2)}`}
            >
              {/* `<title>` must be the first child or browsers do not surface it,
                  and must be a SINGLE string child or React's server renderer
                  emits it empty — see the note in `OpportunityGap`. The three
                  children this used to have (`{label}`, ` — `, `{value}`) were
                  enough to trigger it. */}
              <title>{`${spoke.label} — ${spoke.value.toFixed(2)}`}</title>
              {/* Hit area, larger than the mark, so the vertex is clickable on a
                  touch target rather than only under a precise cursor. */}
              <circle cx={x} cy={y} r={14} fill="transparent" />
              <VertexMark
                x={x}
                y={y}
                role={spoke.role}
                provenance={spoke.provenance}
                selected={isSelected}
              />
            </g>

            <text
              x={lx}
              y={ly}
              className="cd-print__axis-label"
              fill={isSelected ? "rgb(var(--text-ink))" : "rgb(var(--chart-label))"}
              textAnchor={anchorFor(lx)}
              dominantBaseline="middle"
            >
              {truncate(spoke.label, 17)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/**
 * The vertex mark carries shape AND dash — role and provenance on separate
 * channels, per the R14 resolution. A synthetic spoke is not recoloured; it is
 * drawn hollow and dashed so the colour still says what the value is about.
 */
function VertexMark({
  x,
  y,
  role,
  provenance,
  selected,
}: {
  x: number;
  y: number;
  role: FingerprintSpoke["role"];
  provenance: FingerprintSpoke["provenance"];
  selected: boolean;
}) {
  const shape = ROLE_SHAPE[role] ?? "circle";
  const isSynthetic = provenance === "synthetic";
  const colour = roleColour(role);

  return (
    <g transform={`translate(${x - 7} ${y - 7})`}>
      <ShapeGlyph
        shape={shape}
        role={role}
        size={14}
        hollow={isSynthetic}
        dash={isSynthetic ? "2 2" : undefined}
        strokeWidth={selected ? 2.5 : undefined}
      />
      {selected ? (
        <circle cx={7} cy={7} r={11} fill="none" stroke={colour} strokeWidth={1.5} opacity={0.55} />
      ) : null}
    </g>
  );
}

/**
 * The degenerate case. One or two spokes cannot enclose an area, so the values
 * are listed with a fixed 0..1 track instead — the same numbers, drawn in a form
 * that does not pretend to be a shape.
 */
function SpokeList({ spokes, count }: { spokes: readonly FingerprintSpoke[]; count: number }) {
  return (
    <div className="cd-print__list">
      <p className="cd-print__list-note">
        Only {count} {count === 1 ? "category" : "categories"} scored, which is not enough to draw a
        radar — a polygon needs three points. The same values are listed here instead.
      </p>
      <ul>
        {spokes.map((spoke) => (
          <li key={spoke.axis} className="cd-print__list-row">
            <span className="cd-print__list-label">{spoke.label}</span>
            <span className="cd-print__list-track" aria-hidden="true">
              <span
                className="cd-print__list-fill"
                style={{ width: `${clamp01(spoke.value) * 100}%`, backgroundColor: roleColour(spoke.role) }}
              />
            </span>
            <span className="cd-print__list-value cd-tabular">{spoke.value.toFixed(2)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SpokeDetail({ spoke }: { spoke: FingerprintSpoke }) {
  return (
    <div className="cd-print__detail" role="region" aria-label={`Detail for ${spoke.label}`}>
      <h4>{spoke.label}</h4>
      <p>
        Score <strong className="cd-tabular">{spoke.value.toFixed(3)}</strong>, relative to the other
        categories in this profile. Provenance: {spoke.provenance}.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Markers
// ---------------------------------------------------------------------------

function MarkerList({ model }: { model: TasteFingerprintViewModel }) {
  if (model.markers.length === 0) {
    return (
      <p className="cd-print__markers-empty">
        No taste tags were harvested, so the fingerprint has no tag layer.
      </p>
    );
  }

  return (
    <div className="cd-print__markers">
      <span className="cd-print__markers-title">Taste tags, strongest first</span>
      <ul>
        {model.markers.map((marker, index) => (
          <li key={marker.id} className="cd-print__marker">
            <span className="cd-print__marker-rank cd-tabular">{index + 1}</span>
            <ShapeGlyph shape={ROLE_SHAPE[marker.role] ?? "circle"} role={marker.role} size={11} />
            <span className="cd-print__marker-label">{marker.label}</span>
            <span className="cd-print__marker-weight cd-tabular">{marker.weight.toFixed(2)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/** Angle for a spoke, starting at 12 o'clock and running clockwise. */
function angleFor(index: number, total: number): number {
  return (Math.PI * 2 * index) / total - Math.PI / 2;
}

/**
 * Every coordinate this chart emits comes through here, and `polarPoint` rounds
 * them. That is a hydration requirement, not a tidy-up: this is a Client
 * Component, so these sines and cosines are computed once on the server and
 * again in the browser, and the two V8 builds can disagree in the last ULP.
 */
function polar(index: number, total: number, t: number): [number, number] {
  const { x, y } = polarPoint(CX, CY, R * t, angleFor(index, total));
  return [x, y];
}

function ringPoints(total: number, ring: number): string {
  return Array.from({ length: total }, (_, index) => {
    const [x, y] = polar(index, total, ring);
    return `${x},${y}`;
  }).join(" ");
}

/** Labels on the left half are right-anchored so they grow away from the chart. */
function anchorFor(x: number): "start" | "middle" | "end" {
  const offset = x - CX;
  if (offset > 8) return "start";
  if (offset < -8) return "end";
  return "middle";
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}
