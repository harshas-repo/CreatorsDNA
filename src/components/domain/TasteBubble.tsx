import type { Provenance } from "@/lib/contracts/domain";
import type { ColourRole } from "@/lib/contracts/viewModels";
import { ROLE_SHAPE, inkOnRole, provenanceDash, roleColour } from "@/lib/design/colourRoles";
import { ShapeGlyph } from "@/components/shapes/ShapeGlyph";

/**
 * `TasteBubble` (doc 02 §30).
 *
 * One taste signal as a sized circle: the label says what it is, the AREA says
 * how strong it is. Used where a chip is too small to carry weight — the
 * marketing Taste DNA example, and the grouped view of the network.
 *
 * Radius is `sqrt(weight)`, not `weight`. That is not a stylistic choice: a
 * circle's perceived magnitude is its area, and area grows with r². Mapping
 * weight straight onto radius would make a 0.5 signal look a quarter as
 * important as a 1.0 one, exaggerating every difference on the chart. Taking the
 * square root makes area proportional to value, which is the only mapping where
 * "twice as big" means "twice as strong".
 *
 * There is a floor radius below that, and it is declared rather than hidden: a
 * zero-weight bubble would otherwise disappear entirely and read as "not in the
 * data" instead of "in the data, scored low". The floor means the variable part
 * of the area is proportional, not the whole area — a trade made knowingly, in
 * favour of not losing categories.
 */

const MIN_R = 9;
const MAX_R = 34;
const BOX = 96;
const CENTRE = BOX / 2;

export interface TasteBubbleProps {
  label: string;
  /** 0..1 relative weight within its set. Drives area. */
  weight: number;
  role: ColourRole;
  provenance?: Provenance;
  /** Support count — how many entities carried this signal. */
  count?: number;
  /** True when the bubble came from cross-domain backfill: beyond the niche. */
  crossDomain?: boolean;
  selected?: boolean;
  onSelect?: () => void;
  className?: string;
}

export function TasteBubble({
  label,
  weight,
  role,
  provenance = "derived",
  count,
  crossDomain = false,
  selected = false,
  onSelect,
  className,
}: TasteBubbleProps) {
  const clamped = Math.min(1, Math.max(0, weight));
  const radius = MIN_R + Math.sqrt(clamped) * (MAX_R - MIN_R);
  const colour = roleColour(role);
  const dash = provenanceDash(provenance);

  // A button when it is interactive, a group when it is not. Keeping the same
  // SVG in both means the drawing cannot differ between a clickable bubble on
  // the app and a static one on the marketing page.
  const body = (
    <>
      {crossDomain ? (
        // An overlay ring AROUND the bubble rather than a different fill: the
        // colour channel already encodes the role, and spending it on "cross
        // domain" too would leave one of the two facts unencoded (R14).
        <circle
          className="cd-bubble__crossdomain"
          cx={CENTRE}
          cy={CENTRE}
          r={radius + 5}
          fill="none"
          stroke={roleColour("support")}
          strokeWidth={1.5}
          strokeDasharray="2 3"
        />
      ) : null}

      <circle
        className="cd-bubble__fill"
        cx={CENTRE}
        cy={CENTRE}
        r={radius}
        fill={colour}
        fillOpacity={selected ? 0.95 : 0.72}
        stroke={selected ? roleColour("support") : colour}
        strokeWidth={selected ? 2.5 : 1.25}
        strokeDasharray={dash}
      />

      {/* The role's shape is drawn inside the bubble so the redundant
          non-colour encoding survives when the bubble is printed in greyscale
          or viewed without colour (doc 05 §11). */}
      <g transform={`translate(${CENTRE - 7} ${CENTRE - 7}) scale(0.583)`}>
        <ShapeInRole role={role} />
      </g>

      {count !== undefined ? (
        <text className="cd-bubble__count" x={CENTRE} y={CENTRE + radius + 12} textAnchor="middle">
          {count}
        </text>
      ) : null}
    </>
  );

  const svg = (
    <svg viewBox={`0 0 ${BOX} ${BOX}`} className="cd-bubble__svg" aria-hidden="true" focusable="false">
      {body}
    </svg>
  );

  return (
    <div className={`cd-bubble${selected ? " cd-bubble--selected" : ""}${className ? ` ${className}` : ""}`}>
      {onSelect !== undefined ? (
        <button
          type="button"
          className="cd-bubble__control"
          onClick={onSelect}
          aria-pressed={selected}
          aria-label={`${label}, weight ${Math.round(clamped * 100)} of 100 within this set${
            count !== undefined ? `, supported by ${count} ${count === 1 ? "entity" : "entities"}` : ""
          }${crossDomain ? ", beyond your declared niche" : ""}`}
        >
          {svg}
        </button>
      ) : (
        <span className="cd-bubble__control">
          {svg}
          <span className="cd-sr-only">
            {label}, weight {Math.round(clamped * 100)} of 100 within this set
          </span>
        </span>
      )}
      <span className="cd-bubble__label">{label}</span>
    </div>
  );
}

/**
 * The role's shape, knocked out of the bubble fill.
 *
 * The INK is chosen per role by `inkOnRole()`, which compares WCAG contrast
 * against both palette inks. One fixed knockout colour cannot work: cobalt and
 * violet need ivory, while sun, lime and coral need charcoal. A wrong choice here
 * is invisible rather than obviously broken, which is why it is computed from the
 * palette instead of picked by eye.
 *
 * The ink is applied from CSS (`.cd-bubble__glyph--light|dark`) rather than as a
 * prop, because `ShapeGlyph` writes its stroke as an SVG presentation attribute
 * on the shape element itself. An attribute on the child beats anything inherited
 * from the `<svg>` root, so a class on the root alone would silently do nothing —
 * the rule has to target the shape, which the CSS below does with `> *`.
 *
 * The SHAPE still comes from `ROLE_SHAPE`, so the bubble and the charts cannot
 * disagree about which shape means which role — only about its ink.
 */
function ShapeInRole({ role }: { role: ColourRole }) {
  const shape = ROLE_SHAPE[role] ?? "circle";
  return (
    <ShapeGlyph
      shape={shape}
      role={role}
      size={24}
      hollow
      className={`cd-bubble__glyph cd-bubble__glyph--${inkOnRole(role)}`}
    />
  );
}
