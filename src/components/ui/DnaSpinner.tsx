/**
 * `DnaSpinner` — the product's own buffering indicator.
 *
 * The mark is a double helix (`Wordmark`), so the "working" state turns that same
 * glyph rather than a generic ring: the loading animation IS the logo in motion,
 * which is the one place a spinner can double as identity. It is used wherever the
 * flow waits on the catalogue — resolving interests on the review stage, and the
 * pipeline run on the analyzing stage — so a creator learns that this particular
 * helix turning means "reading, not stuck".
 *
 * PURE MARKUP + a CSS animation (`cd-spin`), so it is NOT `"use client"`: a Server
 * Component can render it and a client stage can drop it in without shipping any
 * JavaScript for it. The helix paths mirror `Wordmark`'s and are duplicated rather
 * than extracted on purpose — `Wordmark` is the identity component, and coupling a
 * transient loading state to it would let a spinner tweak move the logo.
 *
 * Decorative by contract: it renders `aria-hidden` and carries no text, because
 * every call site already states what is happening in a visible `role="status"`
 * line beside it. A spinner that also announced itself would be a second, nested
 * live region competing with the sentence that actually explains the wait.
 *
 * Reduced motion needs no special case here: the global `prefers-reduced-motion`
 * rule collapses every animation to a single near-instant iteration, so the helix
 * simply stands still and the adjacent status text carries the state.
 */
export interface DnaSpinnerProps {
  /** Square edge in CSS pixels. Defaults to 40. */
  size?: number;
  className?: string;
}

export function DnaSpinner({ size = 40, className }: DnaSpinnerProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      className={`cd-dna-spinner${className ? ` ${className}` : ""}`}
    >
      <path
        d="M7 2c0 6 10 6 10 12S7 20 7 22"
        fill="none"
        stroke="rgb(var(--role-taste))"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M17 2c0 6-10 6-10 12s10 6 10 8"
        fill="none"
        stroke="rgb(var(--role-brand))"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <g stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.55">
        <path d="M8.4 6.2h7.2" />
        <path d="M9.6 10.4h4.8" />
        <path d="M9.6 14.2h4.8" />
        <path d="M8.4 18.2h7.2" />
      </g>
    </svg>
  );
}
