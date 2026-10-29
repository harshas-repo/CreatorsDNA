import {
  PROVENANCE_STYLE,
  ROLE_MEANING,
  ROLE_SHAPE,
  provenanceBorderStyle,
  provenanceStyle,
} from "@/lib/design/colourRoles";
import type { NodeShape } from "@/lib/design/colourRoles";
import type { ColourRole, LegendEntry } from "@/lib/contracts/viewModels";
import type { DataSource, Provenance } from "@/lib/contracts/domain";
import { ShapeGlyph } from "@/components/shapes/ShapeGlyph";

/**
 * Provenance and legend components.
 *
 * Doc 05 §13 makes four provenance classes a hard requirement, and doc 05 §11
 * requires a redundant non-colour encoding on every chart. Both live here so
 * there is exactly one implementation of each and no visualisation can drift.
 *
 * The rule this file enforces: PROVENANCE IS NOT COLOUR. Colour encodes what a
 * value is about (taste / brand / content / audience / geo). Provenance encodes
 * where it came from, and is carried by line style, node shape, a dashed badge
 * and — for synthetic data — a hatched background. That separation is what allows
 * a synthetic brand-fit score to be both coral (it is about a brand) and clearly
 * illustrative (it is dashed and hatched) at the same time.
 */

// ---------------------------------------------------------------------------
// Provenance badge
// ---------------------------------------------------------------------------

export function ProvenanceBadge({
  provenance,
  showLabel = true,
  className,
}: {
  provenance: Provenance;
  showLabel?: boolean;
  className?: string;
}) {
  const style = provenanceStyle(provenance);
  return (
    <span
      className={`cd-provenance ${style.badgeClass}${className ? ` ${className}` : ""}`}
      title={style.description}
    >
      {showLabel ? style.label : <span className="cd-sr-only">{style.label}</span>}
    </span>
  );
}

/**
 * `QlooInsightBadge` (doc 02 §30).
 *
 * Deliberately narrower than `ProvenanceBadge`: it answers "is THIS value a Qloo
 * discovery?" and refuses to say yes on illustrative data. Execution decision 3
 * is explicit that synthetic results must not be presented as Qloo findings, so
 * the badge is driven by `source.isIllustrative` as well as by provenance — a
 * value can be provenance `qloo` from a synthetic provider, which is the exact
 * combination that would otherwise slip through.
 *
 * The public example route presents through `EXAMPLE_SOURCE`
 * (`providerId: "example"`), which is neither a Qloo discovery nor development
 * data being disclosed to a user mid-analysis — it is the product's own output
 * shown so a visitor can visualise what it does. Neither "Qloo insight" nor
 * "Illustrative data" nor "Not from Qloo" belongs there, so the badge renders
 * nothing rather than making a source claim in either direction.
 */
export function QlooInsightBadge({
  provenance,
  source,
  className,
}: {
  provenance: Provenance;
  source: DataSource;
  className?: string;
}) {
  if (source.providerId === "example") return null;

  const isQloo = provenance === "qloo" && !source.isIllustrative;

  if (!isQloo) {
    return (
      <span className={`cd-qloo-badge cd-qloo-badge--off${className ? ` ${className}` : ""}`}>
        {source.isIllustrative ? "Illustrative data" : "Not from Qloo"}
      </span>
    );
  }

  return (
    <span className={`cd-qloo-badge cd-qloo-badge--on${className ? ` ${className}` : ""}`}>
      <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true" focusable="false">
        <circle cx="6" cy="6" r="4.5" fill="currentColor" />
      </svg>
      Qloo insight
    </span>
  );
}

// ---------------------------------------------------------------------------
// Legend
// ---------------------------------------------------------------------------

/**
 * The chart legend.
 *
 * Rendered from the `legend` array each view-model carries rather than built
 * inside a chart component, because `legendFor()` in the builders is the single
 * place that decides which roles a given chart actually uses. A legend computed
 * locally would eventually list a role the chart never draws, or omit one it does.
 *
 * Each row shows a shape AND a colour AND a word. That is three channels for one
 * fact, which is the point: any single one can be lost to print, to colour-blind
 * vision or to a screenshot crop and the legend still reads.
 */
export function Legend({
  entries,
  title = "Legend",
  className,
}: {
  entries: readonly LegendEntry[];
  title?: string;
  className?: string;
}) {
  if (entries.length === 0) return null;

  return (
    <div className={`cd-legend${className ? ` ${className}` : ""}`}>
      <span className="cd-legend__title">{title}</span>
      <ul className="cd-legend__list">
        {entries.map((entry) => (
          <li key={`${entry.role}|${entry.label}`} className="cd-legend__item">
            <LegendSwatch role={entry.role} shape={entry.shape} />
            <span className="cd-legend__label">{entry.label}</span>
            {entry.description ? (
              <span className="cd-legend__desc">{entry.description}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function LegendSwatch({ role, shape }: { role: ColourRole; shape?: NodeShape }) {
  const resolved = shape ?? ROLE_SHAPE[role] ?? "circle";
  return (
    <span className="cd-legend__swatch">
      <ShapeGlyph shape={resolved} role={role} size={14} />
    </span>
  );
}

/**
 * Provenance key — the "where did this come from" half of the legend.
 *
 * Shown separately from the colour legend because they answer different
 * questions, and merging them would imply a colour means a provenance.
 */
export function ProvenanceKey({
  provenances,
  className,
}: {
  provenances: readonly Provenance[];
  className?: string;
}) {
  const unique = [...new Set(provenances)];
  if (unique.length === 0) return null;

  return (
    <div className={`cd-provenance-key${className ? ` ${className}` : ""}`}>
      <span className="cd-legend__title">Source</span>
      <ul className="cd-legend__list">
        {unique.map((provenance) => {
          const style = PROVENANCE_STYLE[provenance];
          return (
            <li key={provenance} className="cd-legend__item">
              <span
                className="cd-provenance-key__line"
                aria-hidden="true"
                // Read from the shared table rather than derived from `dash` here.
                // Deriving it inline collapsed derived and synthetic onto the same
                // "dashed" border, so the key claimed two provenance classes looked
                // alike while the SVG lines next to it did not.
                style={{ borderStyle: provenanceBorderStyle(provenance) }}
              />
              <span className="cd-legend__label">{style.label}</span>
              <span className="cd-legend__desc">{style.description}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * The full colour-role system, rendered as prose.
 *
 * Doc 05 §12: the mapping must be "documented and reused". Reused is the easy
 * half; this is the documented half, and it belongs on the methodology page
 * where a sceptical reader can check that a colour was not chosen to flatter a
 * result.
 */
export function ColourSystemReference() {
  const roles = Object.keys(ROLE_MEANING) as ColourRole[];

  return (
    <div className="cd-colour-system">
      <table className="cd-table">
        <caption className="cd-sr-only">Colour roles and what each one means</caption>
        <thead>
          <tr>
            <th scope="col">Role</th>
            <th scope="col">Used for</th>
          </tr>
        </thead>
        <tbody>
          {roles.map((role) => (
            <tr key={role}>
              <th scope="row">
                <span className="cd-colour-system__role">
                  {ROLE_SHAPE[role] ? (
                    <ShapeGlyph shape={ROLE_SHAPE[role]!} role={role} size={12} />
                  ) : null}
                  {ROLE_MEANING[role].label}
                </span>
              </th>
              <td>{ROLE_MEANING[role].usedFor}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="cd-colour-system__note">
        Red and green are never used to imply good or bad. Cultural fit is
        exploratory, not a verdict, and a palette that reads as pass/fail would
        turn a suggestion into a judgement the data does not support.
      </p>
    </div>
  );
}
