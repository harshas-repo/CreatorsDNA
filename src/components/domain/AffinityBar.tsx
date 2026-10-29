import type { NormalisedScore, Provenance } from "@/lib/contracts/domain";
import type { ColourRole } from "@/lib/contracts/viewModels";
import { provenanceBorderStyle, roleColour } from "@/lib/design/colourRoles";
import { strengthWord } from "@/lib/copy/generate";

/**
 * `AffinityBar` (doc 02 §30).
 *
 * A single 0..1 value drawn as a bar. Small component, but it carries the one
 * rule the whole product is most likely to break: doc 03 §15 says affinity is
 * normalised PER QUERY and is never survey data, so a bar that looks like "78%"
 * invites exactly the reading "% of people" that is forbidden.
 *
 * Three things keep it honest:
 *
 *  1. The number is always paired with a word (`strengthWord`) and with the
 *     scale note that says what it was normalised against.
 *  2. `value` is `number | undefined`. An unscored dimension renders as
 *     "not scored" with NO bar, because a zero-length bar and a missing value
 *     look identical at a glance and mean opposite things (doc 02 §16).
 *  3. `clustered` renders a tie marker. When neighbours genuinely tie, drawing
 *     different lengths implies a ranking the data does not support.
 */

export type AffinityNormalisation = NormalisedScore["method"];

export interface AffinityBarProps {
  label: string;
  /** 0..1, normalised WITHIN its result set. `undefined` = not scored. */
  value: number | undefined;
  role: ColourRole;
  provenance: Provenance;
  /** How the value was computed. Rendered verbatim when supplied. */
  basis?: string;
  normalisation?: AffinityNormalisation;
  /** Size of the set `value` was normalised against. */
  setSize?: number;
  /** True when the gap to the neighbouring item is not meaningful (doc 03 §15). */
  clustered?: boolean;
  /** Optional rank position, 1-based, rendered ahead of the label. */
  rank?: number;
  className?: string;
}

export function AffinityBar({
  label,
  value,
  role,
  provenance,
  basis,
  normalisation,
  setSize,
  clustered = false,
  rank,
  className,
}: AffinityBarProps) {
  const scored = value !== undefined;
  const clamped = scored ? Math.min(1, Math.max(0, value)) : 0;
  const note = scaleNote(normalisation, setSize);

  return (
    <div className={`cd-affinity${scored ? "" : " cd-affinity--off"}${className ? ` ${className}` : ""}`}>
      <div className="cd-affinity__head">
        {rank !== undefined ? <span className="cd-affinity__rank cd-tabular">{rank}</span> : null}
        <span className="cd-affinity__label">{label}</span>
        {clustered ? (
          // A tie is marked rather than left to the reader to infer from two
          // bars that happen to look the same length.
          <span className="cd-affinity__tie" title="Effectively tied with its neighbour">
            tied
          </span>
        ) : null}
        <span className="cd-affinity__value cd-tabular">
          {scored ? (
            <>
              <strong>{Math.round(clamped * 100)}</strong>
              <span className="cd-affinity__word">{strengthWord(clamped)}</span>
            </>
          ) : (
            <span className="cd-affinity__word">not scored</span>
          )}
        </span>
      </div>

      <div
        className="cd-affinity__track"
        role="img"
        aria-label={
          scored
            ? `${label}: ${strengthWord(clamped)} cultural affinity, ${Math.round(clamped * 100)} of 100 relative to this result set`
            : `${label}: not scored`
        }
      >
        {scored ? (
          <span
            className={`cd-affinity__fill${provenance === "synthetic" ? " cd-affinity__fill--synthetic" : ""}`}
            // Colour = role. Provenance = border style + hatch. Two channels,
            // because collapsing them would make an illustrative brand score
            // indistinguishable from a retrieved one (R14).
            style={{
              width: `${clamped * 100}%`,
              backgroundColor: roleColour(role),
              borderStyle: provenanceBorderStyle(provenance),
            }}
          />
        ) : null}
      </div>

      {basis || note ? (
        <p className="cd-affinity__basis">
          {basis}
          {basis && note ? " " : null}
          {note}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The sentence that stops the bar reading as a percentage of people.
 *
 * Returns `undefined` rather than an empty string so the caller can tell "no
 * caveat needed" from "caveat is blank", and so an absent `normalisation` does
 * not silently assert a basis that was never supplied.
 */
function scaleNote(
  normalisation: AffinityNormalisation | undefined,
  setSize: number | undefined,
): string | undefined {
  switch (normalisation) {
    case "minmax":
      return setSize === undefined
        ? "Relative to this result set, not a percentage of people."
        : `Relative to the ${setSize} results in this set, not a percentage of people.`;
    case "rank":
      return "Every result in this set carried the same score, so position in the list is shown instead of a value. Position is not a measured difference.";
    case "declared":
      // Only reached when the WHOLE set is creator-confirmed — `dominantMethod`
      // prefers a real normalisation whenever one exists. So this can describe
      // every bar on screen without describing a bar it was not computed for.
      return "You confirmed this yourself, so it carries full weight. It was not ranked against anything, and the length is not a measured difference.";
    case "unavailable":
      return "No usable score arrived for this item, so no bar length is drawn rather than one being assumed.";
    default:
      return undefined;
  }
}
