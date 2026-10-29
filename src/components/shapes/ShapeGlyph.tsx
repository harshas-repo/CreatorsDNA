import { roleColour } from "@/lib/design/colourRoles";
import type { NodeShape } from "@/lib/design/colourRoles";
import type { ColourRole } from "@/lib/contracts/viewModels";

/**
 * The shape glyph — the redundant non-colour encoding doc 05 §11 requires.
 *
 * Colour alone is not an accessible channel: it fails under greyscale printing,
 * under the three common forms of colour-vision deficiency, and in a cropped
 * screenshot. So every role that can be plotted as a datum also has a SHAPE, and
 * the shape is drawn from the same `ROLE_SHAPE` table the legend reads. One
 * table, two consumers — that is what stops a chart and its legend drifting apart.
 *
 * Drawn in a normalised 0..24 viewBox so the same component serves a 10px legend
 * swatch and a 40px network node without a second implementation.
 */

const SIZE = 24;
const CENTRE = SIZE / 2;

export interface ShapeGlyphProps {
  shape: NodeShape;
  role: ColourRole;
  /** 0..1. Applied as fill opacity so a low-weight node reads as fainter, not smaller. */
  fillOpacity?: number;
  /** True for a discovered/hollow node — the `ring` role and cross-domain marks. */
  hollow?: boolean;
  /**
   * SVG `stroke-dasharray`, from `provenanceDash()`. Passed through to the shape
   * itself rather than left to inheritance: the inner element sets its own
   * `stroke-width`, which would override anything inherited from the root `<svg>`.
   * Dash is how provenance is encoded, and provenance must never be encoded by
   * recolouring the role (R14).
   */
  dash?: string;
  /** Overrides the default outline weight — used for the selected state. */
  strokeWidth?: number;
  size?: number;
  className?: string;
}

export function ShapeGlyph({
  shape,
  role,
  fillOpacity = 1,
  hollow = false,
  dash,
  strokeWidth,
  size = SIZE,
  className,
}: ShapeGlyphProps) {
  const colour = roleColour(role);
  const fill = hollow ? "none" : colour;
  const weight = strokeWidth ?? (hollow ? 2.5 : 1.75);

  return (
    <svg
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {renderShape(shape, {
        fill,
        colour,
        strokeWidth: weight,
        opacity: fillOpacity,
        dash,
      })}
    </svg>
  );
}

function renderShape(
  shape: NodeShape,
  style: {
    fill: string;
    colour: string;
    strokeWidth: number;
    opacity: number;
    dash: string | undefined;
  },
) {
  const common = {
    fill: style.fill,
    fillOpacity: style.opacity,
    stroke: style.colour,
    strokeWidth: style.strokeWidth,
    strokeDasharray: style.dash,
    strokeLinejoin: "round" as const,
  };

  switch (shape) {
    case "circle":
      return <circle cx={CENTRE} cy={CENTRE} r={8.5} {...common} />;
    case "ring":
      // A ring is a circle with the fill knocked out. Drawing it as `fill="none"`
      // rather than a donut path means the interior stays transparent, so an
      // overlapping edge shows through — which is the visual difference between
      // "declared" and "discovered" that the legend claims.
      return <circle cx={CENTRE} cy={CENTRE} r={8.5} {...common} fill="none" strokeWidth={3} />;
    case "square":
      return <rect x={4.5} y={4.5} width={15} height={15} rx={2.5} {...common} />;
    case "diamond":
      return <path d="M12 3 L21 12 L12 21 L3 12 Z" {...common} />;
    case "triangle":
      return <path d="M12 3.5 L21.5 20 L2.5 20 Z" {...common} />;
  }
}

/**
 * Shape names in words, for the legend's text column and for `aria-label`s.
 *
 * Screen-reader users get "diamond" where sighted users get a colour, so the two
 * channels carry the same information rather than the shape being decoration.
 */
export const SHAPE_LABEL: Record<NodeShape, string> = {
  circle: "circle",
  ring: "ring",
  square: "square",
  diamond: "diamond",
  triangle: "triangle",
};
