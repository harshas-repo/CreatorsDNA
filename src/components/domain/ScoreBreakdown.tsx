import type {
  BrandFitViewModel,
  ColourRole,
  ScoreComponent,
} from "@/lib/contracts/viewModels";
import { NOMINAL_WEIGHTS } from "@/lib/contracts/viewModels";
import { roleColour } from "@/lib/design/colourRoles";
import { fitHeadline } from "@/lib/copy/generate";

/**
 * `ScoreBreakdown` (doc 02 §30).
 *
 * The reusable rendering of "here are the dimensions behind a score, here is
 * what each one was worth, and here is what could not be computed". Chart E
 * (`BrandFitBreakdown`) is the full-page version with the overall figure, the
 * rationale prose and the frame chrome; this is the embeddable version that fits
 * inside a `BrandCard` or a media kit.
 *
 * Both render through `ScoreComponentRow` below, which is the point: doc 02 §30
 * says do not duplicate UI logic, and a second copy of the renormalisation
 * display would eventually show the weights differently in a card than in the
 * chart it summarises. Chart E imports the row rather than owning a private one.
 *
 * No `"use client"` directive. Nothing here holds state or touches the DOM, so
 * the module is usable from a Server Component page and from a client chart
 * alike — adding the directive would push it into the browser bundle for no
 * reason and break the server-rendered card grids.
 */

export interface ScoreBreakdownProps {
  components: readonly ScoreComponent[];
  /**
   * When supplied, the overall figure is rendered above the rows. It is OPTIONAL
   * because doc 05 §10E forbids an unexplained overall percentage: a breakdown
   * used purely to show the dimensions must be able to omit it, and a caller that
   * does supply it also supplies the disclosure that goes with it.
   */
  overall?: BrandFitViewModel["overall"];
  /** Hide the per-row `basis` sentence. For narrow card layouts. */
  compact?: boolean;
  /**
   * Whether to render `overall.disclosure` under the rows. True by default,
   * because a breakdown that shows a number without the sentence qualifying it
   * is exactly what doc 05 §10E warns against. Chart E passes false — not to
   * suppress the disclosure, but because `VizFrame` already renders it in the
   * footnote area and printing it twice would read as two different caveats.
   */
  showDisclosure?: boolean;
  className?: string;
}

export function ScoreBreakdown({
  components,
  overall,
  compact = false,
  showDisclosure = true,
  className,
}: ScoreBreakdownProps) {
  const available = components.filter((component) => component.available);
  const missing = components.length - available.length;

  return (
    <div className={`cd-score${className ? ` ${className}` : ""}`}>
      {overall !== undefined ? <Overall overall={overall} /> : null}

      <ul className="cd-fit__list">
        {components.map((component) => (
          <ScoreComponentRow key={component.dimension} component={component} compact={compact} />
        ))}
      </ul>

      {/* The missing-dimension count is rendered even when it is zero-cost to
          omit, because a 3-of-5 breakdown that looks like a complete one is the
          overstatement `componentsUsed / componentsTotal` exists to prevent. */}
      {missing > 0 ? (
        <p className="cd-fit__missing">
          {missing} of {components.length} dimensions could not be computed and were excluded
          rather than assumed.
          {/* At zero contributors there are no remaining weights and no total, so
              the renormalisation sentence would describe arithmetic that never
              happened — the same degenerate case `coverageNote` and `Overall`
              branch on. */}
          {available.length > 0
            ? " The remaining weights were renormalised so the total still sums to 1 — they were not padded with a neutral value."
            : " With nothing left to renormalise, no total was computed and no figure is shown."}
        </p>
      ) : null}

      {/* §6.4: which dimensions were unavailable and WHY, in the same place as the
          weights that were redistributed because of it. The row above already
          renders each dimension's `basis`; this is the reason for the ones that
          have no value, and without it a reader has to reconstruct the arithmetic
          from a diagnostic panel to work out what the score is resting on. */}
      {overall !== undefined && overall.evidence.unavailable.length > 0 ? (
        <div className="cd-fit__unavailable">
          <span className="cd-eyebrow">Not assessed</span>
          <ul>
            {overall.evidence.unavailable.map((entry) => (
              <li key={entry.dimension}>
                <span className="cd-fit__unavailable-dim">{entry.label}</span>
                <span className="cd-fit__unavailable-why">{entry.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* §6.4: renormalisation is arithmetically correct and rhetorically
          dangerous. This is the sentence that says how much of the intended
          assessment is actually missing, so a 2-of-5 score cannot read as a full
          one. It is rendered whenever the assessment is partial, including when the
          score itself is unrenderable — that case needs it most. */}
      {overall !== undefined && overall.evidence.coverageNote.length > 0 ? (
        <p className="cd-fit__coverage">{overall.evidence.coverageNote}</p>
      ) : null}

      {overall !== undefined && showDisclosure ? (
        <p className="cd-viz__footnote">{overall.disclosure}</p>
      ) : null}
    </div>
  );
}

function Overall({ overall }: { overall: BrandFitViewModel["overall"] }) {
  // Doc 02 §16 and §6.3: when the evidence cannot support an alignment claim, the
  // number is withheld and the LABEL says why. `renderable` is false in two distinct
  // situations and the old copy named only one of them — nothing at all could be
  // computed, or things could be computed but none of them measured culture. The
  // second is the one §6 exists for: a score assembled from audience, geography and
  // coverage alone is a real number about logistics and says nothing about fit, so
  // it must not wear a "Clear alignment" badge however high it lands.
  if (!overall.renderable) {
    return (
      <div className="cd-fit__overall cd-fit__overall--none">
        <span className="cd-fit__overall-label">{overall.label}</span>
        <p>
          {overall.componentsUsed === 0
            ? "None of the five dimensions could be computed for this brand, so there is no fit score to show. A zero here would be a fabricated verdict."
            : `${overall.componentsUsed} of ${overall.componentsTotal} dimensions could be computed, but none of them measures cultural compatibility, so no fit score is shown. The dimensions that were assessed are listed below — they are real, and they are about audience, geography and coverage rather than about fit.`}
        </p>
      </div>
    );
  }

  return (
    <div className="cd-fit__overall">
      <div className="cd-fit__overall-figure">
        <span className="cd-metric cd-fit__overall-value">{Math.round(overall.value * 100)}</span>
        <span className="cd-fit__overall-max">/100</span>
      </div>
      <div className="cd-fit__overall-meta">
        <span className="cd-fit__overall-label">{fitHeadline({ overall })}</span>
        <span className="cd-fit__overall-count">
          {overall.componentsUsed} of {overall.componentsTotal} dimensions contributed
        </span>
        {/* §6.3: a partial subset must be identified as one, in the headline block
            and not only in the footnote underneath it. */}
        {overall.evidence.partial ? (
          <span className="cd-fit__overall-partial">Partial assessment</span>
        ) : null}
        {/* The qualitative label is shown alongside, never instead of, the number:
            doc 05 §10E prefers a label in headline positions but forbids dropping
            the basis. */}
        <span className="cd-fit__overall-scale" aria-hidden="true">
          <ScaleMarker value={overall.value} label={overall.label} />
        </span>
      </div>
    </div>
  );
}

/** A 0..1 strip with the score marked, so the number has a visual range to sit in. */
export function ScaleMarker({ value, label }: { value: number; label: string }) {
  return (
    <span className="cd-fit__scale">
      <span className="cd-fit__scale-track" />
      <span
        className="cd-fit__scale-mark"
        style={{ insetInlineStart: `${Math.min(100, Math.max(0, value * 100))}%` }}
      />
      <span className="cd-sr-only">{label}</span>
    </span>
  );
}

/**
 * One scored dimension.
 *
 * The renormalisation is DRAWN, not just described: the ghost track is the share
 * of the total this dimension was allocated, the fill is how much of that share
 * it scored. Doc 02 §15 requires omitted dimensions to be renormalised rather
 * than defaulted to 0.5; making that visible is what turns a rule into something
 * a sceptical reader can check.
 */
export function ScoreComponentRow({
  component,
  compact = false,
}: {
  component: ScoreComponent;
  compact?: boolean;
}) {
  const nominal = NOMINAL_WEIGHTS[component.dimension];
  const renormalised = component.effectiveWeight !== nominal;

  return (
    <li className={`cd-fit__row${component.available ? "" : " cd-fit__row--off"}`}>
      <div className="cd-fit__row-head">
        <span className="cd-fit__dim">{component.label}</span>
        <span className="cd-fit__weights cd-tabular">
          {renormalised ? (
            <>
              <s title="Nominal weight before renormalisation">{pct(nominal)}</s>
              <span aria-hidden="true">→</span>
              <strong>{pct(component.effectiveWeight)}</strong>
            </>
          ) : (
            <strong>{pct(component.effectiveWeight)}</strong>
          )}
        </span>
      </div>

      <div className="cd-fit__track" aria-hidden="true">
        {/* Ghost track = the share of the total this dimension was allocated. */}
        <span className="cd-fit__ghost" style={{ width: `${component.effectiveWeight * 100}%` }} />
        {component.available && component.value !== undefined ? (
          <span
            className={`cd-fit__fill${component.provenance === "synthetic" ? " cd-fit__fill--synthetic" : ""}`}
            // Colour stays bound to the ROLE. Provenance gets its own channel —
            // the hatched modifier class — because recoding a synthetic value to
            // `neutral` would destroy the information the colour carries and
            // still leave provenance readable only by people who know to look.
            style={{
              width: `${component.value * component.effectiveWeight * 100}%`,
              backgroundColor: roleColour(dimensionRole(component.dimension)),
            }}
          />
        ) : null}
      </div>

      <div className="cd-fit__row-foot">
        {component.available && component.value !== undefined ? (
          <span className="cd-fit__value cd-tabular">{component.value.toFixed(2)}</span>
        ) : (
          <span className="cd-fit__value cd-fit__value--off">not available</span>
        )}
        {/*
          An AVAILABLE dimension's basis is explanation, and a compact card can
          afford to drop it. An UNAVAILABLE dimension's basis is the actionable
          half — it names which of the creator's own inputs is missing — so it
          survives compaction. Dropping it leaves the words "not available" with
          no next step attached, which is the dead end the card exists to close.
        */}
        {!component.available || !compact ? (
          <span
            className={`cd-fit__basis${component.available ? "" : " cd-fit__basis--missing"}`}
          >
            {component.basis}
          </span>
        ) : null}
      </div>
    </li>
  );
}

/**
 * Dimension → colour role.
 *
 * Mirrors `DIMENSION_ROLE` in `buildersBrand.ts`. That duplication is deliberate
 * and small: the analysis table builds view-models server-side and this one
 * paints them, and importing the analysis layer into a component that runs in
 * the browser would drag the whole pipeline into the client bundle. Both are
 * keyed by the same closed `ScoreDimension` union, so a new dimension is a
 * compile error here until it is given a colour — the switch has no default
 * branch for exactly that reason.
 *
 * Exported so chart E and this component cannot disagree about which colour a
 * dimension wears.
 */
export function dimensionRole(dimension: ScoreComponent["dimension"]): ColourRole {
  switch (dimension) {
    case "taste_fit":
      return "taste";
    case "audience_demographic":
      return "audience";
    case "content_compatibility":
      return "content";
    case "geographic":
      return "geo";
    case "opportunity_gap":
      return "brand";
  }
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}
