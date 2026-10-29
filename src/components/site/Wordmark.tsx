/**
 * The wordmark.
 *
 * Drawn as inline SVG rather than set in text so the glyph is identical on every
 * machine regardless of which font in the display stack resolved, and so the
 * "DNA" mark can carry the double-helix motif that the rest of the identity
 * reuses (doc 05 §4: a recognisable, ownable mark rather than a generic logotype).
 *
 * `currentColor` for the wordmark and the role tokens for the helix means it
 * recolours correctly in both themes with no extra code.
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={className ?? "cd-wordmark"}>
      <svg
        viewBox="0 0 24 24"
        width="22"
        height="22"
        aria-hidden="true"
        focusable="false"
        className="cd-wordmark__mark"
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
      <span className="cd-wordmark__text">
        Creators<b>DNA</b>
      </span>
    </span>
  );
}
