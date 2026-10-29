"use client";

import { useMemo, useState } from "react";

import { categoryLabel } from "@/lib/analysis/categoryLabels";
import { classifyAffinity } from "@/lib/copy/generate";

import type {
  AffinityRankingViewModel,
  AffinityRankItem,
  TasteDna,
} from "@/lib/contracts/viewModels";
import type { AffinityClassification, SourceVoice } from "@/lib/copy/generate";
import { roleColour } from "@/lib/design/colourRoles";
import { VizFrame } from "@/components/viz/VizFrame";
import { EmptyState } from "@/components/ui/States";

/**
 * B — Cultural affinity ranking (doc 05 §10B).
 *
 * Horizontal bars, strongest first. Four details carry most of the honesty
 * burden:
 *
 *  1. **Bands are labelled as indicative.** Doc 03 §15 is explicit that affinity
 *     bands are soft and that filters depress scores, so a band edge is drawn
 *     faintly and the band name is written on the chart rather than implied by a
 *     colour change alone.
 *  2. **Ties are marked.** `clusteredWithNeighbour` means the gap to the next
 *     item is inside the tie tolerance and therefore NOT meaningful. Without the
 *     marker, a bar chart turns an arbitrary ordering into a claim of rank — the
 *     single most common way a chart overstates its data.
 *  3. **The score is normalised within this ranking only.** The methodology line
 *     in the frame says so, and `normalisation` distinguishes minmax from
 *     rank-derived, because a rank-derived profile has no real magnitudes and
 *     must not be read as having them.
 *  4. **Each row says how it surfaced.** A confirmed entity, something reached
 *     across into a new category, something reached inside ground the creator
 *     already works in, and something that came back with no explainability at
 *     all are four different claims. Left undistinguished they all look like
 *     findings, and the fourth is the weakest of them.
 *
 * No axis is drawn in absolute units: the bars are relative by construction and
 * a numeric axis would invite the reader to treat 0.7 as "70% of something".
 */

const ROW_HEIGHT = 34;
const LABEL_WIDTH = 168;
const VALUE_WIDTH = 52;
/** Room for the one-word "how this surfaced" marker at the right edge. */
const KIND_WIDTH = 104;
const PAD_TOP = 28;
const PAD_BOTTOM = 12;

/**
 * The scale note under the chart.
 *
 * Lifted out of the JSX because `declared` cannot share the sentence frame the
 * other three use. "Scores are normalised within this ranking" is precisely what
 * is NOT true of a row the creator confirmed themselves — and that row is the one
 * a reader is most likely to mistake for a measurement, since it sits at full
 * length alongside bars that genuinely are min-maxed.
 */
function scaleNote(
  normalisation: AffinityRankingViewModel["normalisation"],
  setSize: number,
): string {
  switch (normalisation) {
    case "declared":
      return `Every row here is an interest you confirmed yourself, carried across ${setSize} results at full weight. Nothing was ranked against anything, so equal full lengths are not a measurement.`;
    case "minmax":
      return `Scores are normalised within this ranking of ${setSize} results (min–max over returned affinity).`;
    case "rank":
      return `Scores are normalised within this ranking of ${setSize} results (derived from result position, so magnitudes are not meaningful).`;
    case "unavailable":
      return `No usable affinity was returned for this ranking of ${setSize} results, so nothing is ranked.`;
  }
}

export interface AffinityRankingProps {
  model: AffinityRankingViewModel;
  /**
   * The taste profile the ranking was built from. Present turns on the
   * surfaced-how column; absent (the illustrative landing-page chart) leaves the
   * rows unlabelled rather than labelled with a guess.
   */
  dna?: TasteDna;
  voice?: SourceVoice;
}

export function AffinityRanking({ model, dna, voice }: AffinityRankingProps) {
  const [selected, setSelected] = useState<string | undefined>(undefined);

  // Memoised because the classification walks `dna.categories` per item and the
  // selection state changes on every click — without it, a chart of 40 rows
  // would redo 40 set-difference walks to move a highlight.
  const { items, kinds, hidden } = useMemo(
    () => prepare(model, dna, voice),
    [model, dna, voice],
  );

  const width = 720;
  const barArea = width - LABEL_WIDTH - VALUE_WIDTH - KIND_WIDTH - 24;
  const height = PAD_TOP + items.length * ROW_HEIGHT + PAD_BOTTOM;

  const active = selected === undefined ? undefined : items.find((item) => item.id === selected);
  const activeKind = active === undefined ? undefined : kinds.get(active.id);

  return (
    <VizFrame
      index="B"
      title="Cultural affinity ranking"
      subtitle="The cultural territories this profile is closest to, strongest first."
      meta={model.meta}
      legend={model.legend}
      provenances={[...new Set(items.map((item) => item.provenance))]}
      footnotes={
        <>
          <p className="cd-viz__footnote">
            {scaleNote(model.normalisation, model.setSize)} They describe cultural proximity, not a
            share of any audience.
          </p>
          {kinds.size > 0 ? (
            <p className="cd-viz__footnote">
              The word at the right of each row is how that row surfaced:{" "}
              <em>confirmed</em> means you picked it yourself, <em>cross-category</em> means it was
              reached into a category none of your confirmed interests sit in,{" "}
              <em>traced</em> means it was reached from your interests inside ground you already
              work in, and <em>our read</em> means no explanation arrived for it and its position
              rests on the aggregate score alone.
            </p>
          ) : null}
          {hidden > 0 ? (
            <p className="cd-viz__footnote">
              {hidden} {hidden === 1 ? "entry was" : "entries were"} hidden from this view: an
              exact duplicate of a row already shown, or a row with no label at all. Rank numbers
              are the ones the scoring produced, so a gap here is a hidden row, not a missing one.
            </p>
          ) : null}
        </>
      }
    >
      {items.length === 0 ? (
        <EmptyState
          title="No affinities to rank"
          message="The data source returned no results for these signals, so there is nothing to order."
          hint="Adding another interest usually gives the analysis enough to work with."
        />
      ) : (
        <div className="cd-rank">
          <svg
            viewBox={`0 0 ${width} ${height}`}
            className="cd-rank__svg"
            role="img"
            aria-label={`Cultural affinity ranking of ${items.length} items, strongest first`}
          >
            {/* Band backgrounds, drawn first so bars sit on top. */}
            {model.bands.map((band) => {
              const y = PAD_TOP + (1 - band.max) * items.length * ROW_HEIGHT;
              const bandHeight = (band.max - band.min) * items.length * ROW_HEIGHT;
              if (bandHeight <= 0) return null;
              return (
                <g key={band.id}>
                  <rect
                    x={LABEL_WIDTH}
                    y={y}
                    width={barArea}
                    height={bandHeight}
                    fill="rgb(var(--chart-band-mid))"
                    opacity={band.id === "high" ? 0.5 : 0.22}
                  />
                  <text
                    x={LABEL_WIDTH + 6}
                    y={y + 12}
                    className="cd-rank__band-label"
                    fill="rgb(var(--chart-label))"
                  >
                    {band.label}
                  </text>
                </g>
              );
            })}

            {items.map((item, index) => (
              <RankRow
                key={item.id}
                item={item}
                index={index}
                y={PAD_TOP + index * ROW_HEIGHT}
                barArea={barArea}
                selected={selected === item.id}
                onSelect={() => setSelected(selected === item.id ? undefined : item.id)}
                kind={kinds.get(item.id)}
              />
            ))}
          </svg>

          {active ? <SupportPanel item={active} kind={activeKind} /> : null}
        </div>
      )}
    </VizFrame>
  );
}

/**
 * What to draw, and what was left out.
 *
 * Two suppressions, both of which are about the rows themselves rather than about
 * a judgement on them:
 *
 *  - **No label.** A bar with an empty name communicates nothing and cannot be
 *    inspected, so it is dropped and counted rather than rendered as a blank row
 *    that looks like a rendering failure.
 *  - **Exact duplicate.** The result set can contain the same entity twice under
 *    different ids — a URN and a bare tail, or a backfilled copy. Two identical
 *    bars read as two independent confirmations of the same thing, which is the
 *    "duplicate insight" failure in its most literal form. The first (highest
 *    scoring, since the set arrives ordered) is kept.
 *
 * Ranks are NOT renumbered. Removing a row does not change the order of the ones
 * left, and renumbering would invent a ranking the scoring never produced. The
 * footnote explains the gap instead.
 */
function prepare(
  model: AffinityRankingViewModel,
  dna: TasteDna | undefined,
  voice: SourceVoice | undefined,
): { items: AffinityRankItem[]; kinds: Map<string, AffinityClassification>; hidden: number } {
  const items: AffinityRankItem[] = [];
  const seen = new Set<string>();
  let hidden = 0;

  for (const item of model.items) {
    const label = item.label.trim();
    if (label.length === 0) {
      hidden += 1;
      continue;
    }
    const key = label.toLowerCase();
    if (seen.has(key)) {
      hidden += 1;
      continue;
    }
    seen.add(key);
    items.push(item);
  }

  const kinds = new Map<string, AffinityClassification>();
  if (dna !== undefined && voice !== undefined) {
    for (const item of items) kinds.set(item.id, classifyAffinity(item, dna, voice));
  }

  return { items, kinds, hidden };
}

function RankRow({
  item,
  index,
  y,
  barArea,
  selected,
  onSelect,
  kind,
}: {
  item: AffinityRankItem;
  index: number;
  y: number;
  barArea: number;
  selected: boolean;
  onSelect: () => void;
  kind?: AffinityClassification;
}) {
  const barWidth = Math.max(2, item.score * barArea);
  const centre = y + ROW_HEIGHT / 2;

  return (
    <g
      className="cd-rank__row"
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
      aria-label={`${item.rank}. ${item.label}, affinity ${item.score.toFixed(2)}${
        item.clusteredWithNeighbour ? ", tied with its neighbour" : ""
      }${kind === undefined ? "" : `, ${kind.chip.toLowerCase()}`}`}
    >
      <text x={LABEL_WIDTH - 30} y={centre + 4} className="cd-rank__rank" textAnchor="end" fill="rgb(var(--chart-label))">
        {item.rank}
      </text>
      <text x={0} y={centre + 4} className="cd-rank__label" fill="rgb(var(--text-ink))">
        {truncate(item.label, 22)}
      </text>

      {/* Track: the full 0..1 extent, so a short bar reads as "low relative
          affinity" rather than as a bar that was drawn small. */}
      <rect
        x={LABEL_WIDTH}
        y={centre - 7}
        width={barArea}
        height={14}
        rx={7}
        fill="rgb(var(--chart-grid))"
        opacity={0.08}
      />
      <rect
        x={LABEL_WIDTH}
        y={centre - 7}
        width={barWidth}
        height={14}
        rx={7}
        fill={roleColour(item.role)}
        opacity={selected ? 1 : 0.86}
        stroke={selected ? "rgb(var(--chart-highlight-stroke))" : "none"}
        strokeWidth={selected ? 2 : 0}
      />

      {/* Tie marker: a notch at the bar end. Doc 03 §15 — inside a cluster of
          strong matches the ordering is not meaningful, and a bar chart says
          otherwise by default. */}
      {item.clusteredWithNeighbour ? (
        <g aria-label="Tied with its neighbour">
          {/* `<title>` must be the first child or browsers do not surface it. */}
          <title>Tied with the neighbouring item — this ordering is not meaningful</title>
          <circle cx={LABEL_WIDTH + barWidth + 7} cy={centre} r={3.5} fill="rgb(var(--chart-tie-marker))" />
        </g>
      ) : null}

      <text
        x={LABEL_WIDTH + barArea + 10}
        y={centre + 4}
        className="cd-rank__value"
        fill="rgb(var(--text-muted))"
      >
        {item.score.toFixed(2)}
      </text>

      {/* How the row surfaced. Set in mono and muted so it reads as a qualifier
          on the bar, not as a second value competing with it. */}
      {kind !== undefined ? (
        <text
          x={LABEL_WIDTH + barArea + VALUE_WIDTH + 6}
          y={centre + 4}
          className={`cd-rank__kind cd-rank__kind--${kind.kind}`}
          fill="rgb(var(--text-muted))"
        >
          {kind.short}
        </text>
      ) : null}

      {index === 0 ? null : <line x1={LABEL_WIDTH} x2={LABEL_WIDTH + barArea} y1={y} y2={y} stroke="rgb(var(--chart-grid))" opacity={0.08} />}
    </g>
  );
}

/** The inspect-on-click panel: what evidence sits behind one bar. */
function SupportPanel({
  item,
  kind,
}: {
  item: AffinityRankItem;
  kind?: AffinityClassification;
}) {
  return (
    <div className="cd-rank__detail" role="region" aria-label={`Evidence for ${item.label}`}>
      <div className="cd-rank__detail-head">
        <h4>{item.label}</h4>
        {/* `categoryLabel` rather than the raw id. `item.category` is a catalogue
            value and arrives as `urn:entity:artist` as often as `artist`; printing
            it verbatim shows the reader our encoding and reads as a broken label,
            which is the defect this map exists to prevent. */}
        {item.category ? (
          <span className="cd-eyebrow">{categoryLabel(item.category)}</span>
        ) : null}
        {kind !== undefined ? <span className={`cd-kind cd-kind--${kind.kind}`}>{kind.chip}</span> : null}
      </div>

      {kind !== undefined ? <p className="cd-rank__definition">{kind.why}</p> : null}
      {item.definition ? <p className="cd-rank__definition">{item.definition}</p> : null}

      {item.support.length > 0 ? (
        <>
          <p className="cd-eyebrow">
            What {item.support.length === 1 ? "it was reached from" : "they were reached from"}
          </p>
          <ul className="cd-rank__support">
            {item.support.map((entry) => (
              <li key={entry.entityId}>
                <span>{entry.entityName}</span>
                <span className="cd-tabular">{entry.weight.toFixed(3)}</span>
              </li>
            ))}
          </ul>
          <p className="cd-viz__footnote">
            The figure beside each name is the weight {item.support.length === 1 ? "it" : "they"}{" "}
            carried in producing this row, on the same within-run scale as the bar. It is not a
            share of an audience and it is not comparable to another analysis.
          </p>
        </>
      ) : (
        <p className="cd-rank__definition">
          No supporting entities were returned for this item, so its position rests on the
          aggregate score alone. There is no trail to inspect here, and none has been written to
          fill the space.
        </p>
      )}
    </div>
  );
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}
