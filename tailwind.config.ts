import type { Config } from "tailwindcss";

/**
 * CreatorsDNA Tailwind configuration.
 *
 * Every colour is a reference to a CSS custom property defined in
 * `src/app/globals.css` (the design-token layer required by doc 05 §16).
 * The variables hold raw RGB channel triplets so Tailwind's opacity
 * modifier (`/40`) keeps working.
 *
 * Single source of truth = globals.css. Nothing is duplicated here.
 */
const channels = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

const config: Config = {
  content: ["./src/**/*.{ts,tsx,mdx}"],

  /**
   * Tailwind tree-shakes everything written inside `@layer components`, and it
   * decides what to keep by scanning source files for class-name STRINGS. A
   * variant composed at runtime — `` `cd-kind--${kind.kind}` `` — never appears
   * as a literal, so the scanner cannot see it and the rule is purged from the
   * production build while the development build keeps it.
   *
   * That is a silent failure and an expensive one: the purged rules are exactly
   * the state and provenance encodings. `.cd-path__chip--unavailable` carries the
   * dashed border that distinguishes "this dimension could not be judged" from
   * "it was judged and scored zero" — R14's requirement that provenance is
   * encoded by pattern, not colour. Without it the two look identical, and the
   * product starts implying it measured things it did not.
   *
   * Every entry below is therefore an enumerated variant, never a wildcard. A
   * `pattern: /--.*$/` would also work, but it would keep dead selectors alive
   * forever and hide the next genuine purge. Enumerating means adding a variant
   * to one of these families is a two-line change (CSS + here) that fails loudly
   * in review rather than quietly in production.
   *
   * PREFERRED FOR NEW CODE: don't compose the class name at all. A typed lookup
   * (`const CLASS: Record<Kind, string> = { direct: "cd-kind--direct", … }`)
   * puts the literal in the source where the scanner can see it, needs no entry
   * here, and makes a new variant without a style a compile error instead of an
   * unstyled element.
   */
  safelist: [
    // Affinity classification — how a row surfaced (AffinityRanking, MediaKit)
    { pattern: /^cd-rank__kind--(direct|cross_category|traced|inferred)$/ },
    { pattern: /^cd-kind--(direct|cross_category|traced|inferred)$/ },
    // Content thumbnail aspect ratios
    { pattern: /^cd-thumb--(portrait|square|wide)$/ },
    // Status/state tone (States.tsx)
    { pattern: /^cd-state--(critical|warning)$/ },
    // Culture-to-brand pathway chips: availability and provenance
    { pattern: /^cd-path__chip--(available|unavailable|warning|synthetic)$/ },
    // Creator observation severity (CreatorHeader)
    { pattern: /^cd-creator__obs--(critical|info|warning)$/ },
    // Taste bubble glyph ink, chosen from the role's luminance
    { pattern: /^cd-bubble__glyph--(light|dark)$/ },
  ],
  theme: {
    extend: {
      colors: {
        /* ---- Core palette (doc 05 §4) ---- */
        cobalt: channels("color-cobalt"),
        coral: channels("color-coral"),
        sun: channels("color-sun"),
        lime: channels("color-lime"),
        violet: channels("color-violet"),
        magenta: channels("color-magenta"),
        ivory: channels("color-ivory"),
        charcoal: channels("color-charcoal"),
        navy: channels("color-navy"),
        stone: channels("color-stone"),

        /* ---- Surfaces ---- */
        canvas: channels("surface-canvas"),
        panel: channels("surface-panel"),
        glass: channels("surface-glass"),

        /* ---- Semantic text ---- */
        ink: channels("text-ink"),
        "ink-muted": channels("text-muted"),
        "ink-inverse": channels("text-inverse"),

        /* ---- Data roles (doc 05 §7) ----
         * Bound to provenance, never to "good vs bad". Red/green are
         * deliberately absent from this palette (doc 01 §53). */
        role: {
          taste: channels("role-taste"),
          secondary: channels("role-secondary"),
          brand: channels("role-brand"),
          content: channels("role-content"),
          audience: channels("role-audience"),
          geo: channels("role-geo"),
          neutral: channels("role-neutral"),
          support: channels("role-support"),
        },
      },
      fontFamily: {
        display: ["var(--font-display)", "system-ui", "sans-serif"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      fontSize: {
        "display-hero": ["var(--text-display-hero)", { lineHeight: "0.95", letterSpacing: "-0.03em" }],
        "display-lg": ["var(--text-display-lg)", { lineHeight: "1.0", letterSpacing: "-0.025em" }],
        "display-md": ["var(--text-display-md)", { lineHeight: "1.1", letterSpacing: "-0.02em" }],
        lead: ["var(--text-lead)", { lineHeight: "1.45" }],
        body: ["var(--text-body)", { lineHeight: "1.6" }],
        small: ["var(--text-small)", { lineHeight: "1.5" }],
        micro: ["var(--text-micro)", { lineHeight: "1.4", letterSpacing: "0.04em" }],
      },
      borderRadius: {
        pill: "var(--radius-pill)",
        card: "var(--radius-card)",
        blob: "var(--radius-blob)",
      },
      boxShadow: {
        lift: "var(--shadow-lift)",
        glow: "var(--shadow-glow)",
        inset: "var(--shadow-inset)",
      },
      spacing: {
        section: "var(--space-section)",
        block: "var(--space-block)",
      },
      transitionTimingFunction: {
        expressive: "var(--ease-expressive)",
        standard: "var(--ease-standard)",
      },
      keyframes: {
        "float-slow": {
          "0%, 100%": { transform: "translate3d(0,0,0) rotate(0deg)" },
          "50%": { transform: "translate3d(0,-18px,0) rotate(4deg)" },
        },
        "drift-x": {
          "0%, 100%": { transform: "translate3d(0,0,0)" },
          "50%": { transform: "translate3d(24px,-10px,0)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        "pulse-ring": {
          "0%": { transform: "scale(0.85)", opacity: "0.55" },
          "100%": { transform: "scale(1.6)", opacity: "0" },
        },
      },
      animation: {
        "float-slow": "float-slow var(--duration-slow) var(--ease-expressive) infinite",
        "drift-x": "drift-x var(--duration-slower) var(--ease-expressive) infinite",
        shimmer: "shimmer var(--duration-slow) linear infinite",
        "pulse-ring": "pulse-ring var(--duration-medium) var(--ease-expressive) infinite",
      },
    },
  },
  plugins: [],
};

export default config;
