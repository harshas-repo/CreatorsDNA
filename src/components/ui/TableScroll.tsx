import type { ReactNode } from "react";

/**
 * A horizontally scrollable wrapper for wide tables.
 *
 * Doc 02 §31 makes desktop primary, but the methodology and comparison tables
 * carry four or five columns of prose, and a `<table>` sizes to its
 * max-content width — so on a narrow viewport it does not shrink, it overflows,
 * and the columns past the fold become unreachable rather than merely small.
 *
 * `tabIndex={0}` is the part that is easy to forget. A scroll container that only
 * a pointer can scroll is a scroll container a keyboard user cannot use at all:
 * there is no element inside it to focus, so there is nothing for Tab to land on
 * and no way to send it an arrow key. Making the wrapper focusable gives the
 * region its own tab stop, which is the standard remedy.
 *
 * It is a component rather than a repeated `<div>` because the `role`,
 * `tabIndex` and `aria-label` have to travel together. Written out several times
 * by hand, one of them would lose the `tabIndex` and fail silently — the table
 * would still look fine to anyone testing with a mouse.
 *
 * Only wrap tables that can actually overflow. A two-column table of short
 * strings gains a tab stop and no scroll, which is a net loss for a keyboard
 * user crossing the page.
 */

export interface TableScrollProps {
  /** Announced as the name of the scrollable region. */
  label: string;
  children: ReactNode;
  className?: string;
}

export function TableScroll({ label, children, className }: TableScrollProps) {
  return (
    <div
      className={`cd-table-scroll${className ? ` ${className}` : ""}`}
      role="region"
      aria-label={label}
      tabIndex={0}
    >
      {children}
    </div>
  );
}
