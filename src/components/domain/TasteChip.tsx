import type { ReactNode } from "react";

import type { Provenance } from "@/lib/contracts/domain";
import type { ColourRole } from "@/lib/contracts/viewModels";
import { ROLE_SHAPE, provenanceBorderStyle, roleColour } from "@/lib/design/colourRoles";
import { ShapeGlyph } from "@/components/shapes/ShapeGlyph";

/**
 * `TasteChip` (doc 02 §30).
 *
 * The compact form of one taste signal — a tag, a category or a declared
 * interest. Used in the onboarding selection grid, in filter bars and in card
 * footers, which is precisely why it is a shared component: doc 02 §30 says do
 * not duplicate UI logic, and three pages each hand-rolling a pill is how
 * "selected" comes to mean a filled background on one page and a bold border on
 * another.
 *
 * Two encodings, always together:
 *   - COLOUR (and the role's shape) says what KIND of thing this is.
 *   - BORDER STYLE says where it came from, via `provenanceBorderStyle`.
 * A chip whose border went solid on selection would destroy the provenance
 * channel, so selection is carried by `aria-pressed` + a filled background and
 * the border style is left alone.
 */

export interface TasteChipProps {
  label: string;
  /** Defaults to `taste` — a chip with no stated role is about the creator's taste. */
  role?: ColourRole;
  provenance?: Provenance;
  /** 0..1. Drives fill opacity, so a weak signal reads fainter rather than smaller. */
  weight?: number;
  /** Support count, e.g. how many entities carried this tag. */
  count?: number;
  /** Present only in filter mode. Omitting it renders a non-interactive chip. */
  selected?: boolean;
  onSelect?: () => void;
  /** Trailing content, e.g. a remove control. Kept as a slot so the chip does
   *  not grow a prop per use site. */
  trailing?: ReactNode;
  className?: string;
}

export function TasteChip({
  label,
  role = "taste",
  provenance = "creator",
  weight,
  count,
  selected,
  onSelect,
  trailing,
  className,
}: TasteChipProps) {
  const interactive = onSelect !== undefined;
  const shape = ROLE_SHAPE[role];
  // `weight` is 0..1 and drives opacity, but never below a floor: a chip that
  // fades to invisible still occupies layout space, and an unreadable label is
  // worse than a faint one.
  const opacity = weight === undefined ? 1 : 0.35 + Math.min(1, Math.max(0, weight)) * 0.65;

  const classes = [
    "cd-chip",
    "cd-taste-chip",
    interactive ? "cd-chip--filter" : "",
    className ?? "",
  ]
    .filter((part) => part.length > 0)
    .join(" ");

  const style = {
    borderColor: roleColour(role),
    borderStyle: provenanceBorderStyle(provenance),
    backgroundColor: selected === true ? roleColour(role, 0.14) : undefined,
  } as const;

  const content = (
    <>
      {shape ? (
        <ShapeGlyph shape={shape} role={role} size={13} fillOpacity={opacity} className="cd-taste-chip__glyph" />
      ) : null}
      <span className="cd-taste-chip__label">{label}</span>
      {count !== undefined ? <span className="cd-chip__count cd-tabular">{count}</span> : null}
      {trailing}
    </>
  );

  if (!interactive) {
    return (
      <span className={classes} style={style}>
        {content}
      </span>
    );
  }

  return (
    <button
      type="button"
      className={classes}
      style={style}
      // `aria-pressed`, not `aria-checked`: this is a toggle button in a filter
      // bar, not an option in a radiogroup, and the CSS keys off the same
      // attribute so the visual state cannot diverge from the announced one.
      aria-pressed={selected === true}
      onClick={onSelect}
    >
      {content}
    </button>
  );
}
