import type { Metadata, Viewport } from "next";

import "./globals.css";
import { ThemeScript } from "@/components/theme/ThemeProvider";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SiteFooter } from "@/components/site/SiteFooter";

/**
 * Root layout.
 *
 * Two deliberate choices here:
 *
 *  1. Fonts are a RUNTIME <link>, not `next/font/google`. next/font downloads at
 *     build time, which would make `next build` fail on an offline machine. A
 *     runtime link degrades to the system fallbacks already declared in the
 *     token stack instead. See the §2 comment in `globals.css`.
 *  2. The theme is applied by a tiny blocking inline script rather than by React
 *     state, so a returning visitor with `dark` stored never sees a light flash.
 *     Because React does not own the initial attribute value, there is no
 *     hydration mismatch to reconcile.
 */

/**
 * Archivo's variable width axis is what produces the "expanded" display face;
 * requesting only `wght` would silently give the normal-width cut.
 */
const FONT_HREF =
  "https://fonts.googleapis.com/css2?" +
  [
    "family=Archivo:wdth,wght@100..125,400..800",
    "family=Inter:wght@300..800",
    "family=JetBrains+Mono:wght@400..700",
  ].join("&") +
  "&display=swap";

export const metadata: Metadata = {
  metadataBase: new URL("https://creatorsdna.example.com"),
  /**
   * The browser tab reads "CreatorsDNA" on every route and nothing else. A plain
   * string rather than `{ default, template }`: a template would append the
   * brand to each child segment's own title, which is how `/methodology` ended up
   * reading "Methodology — CreatorsDNA · CreatorsDNA". Child segments therefore
   * carry a `description` only and inherit this title.
   */
  title: "CreatorsDNA",
  description:
    "CreatorsDNA maps a creator's cultural taste graph, finds the connections they have not made content in, and compares that profile against the taste of real brands — with the evidence shown.",
  keywords: [
    "creator economy",
    "cultural intelligence",
    "taste graph",
    "brand partnerships",
    "Qloo",
  ],
  openGraph: {
    title: "CreatorsDNA — Your niche is just the beginning",
    description:
      "Cultural intelligence for creators: taste DNA, unexpected affinities, untapped cultural connections and the brands whose taste overlaps yours — with the evidence shown.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fdfbf7" },
    { media: "(prefers-color-scheme: dark)", color: "#090c22" },
  ],
  colorScheme: "light dark",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="stylesheet" href={FONT_HREF} />
        <ThemeScript />
      </head>
      <body>
        {/* Doc 05 §14: a skip link is the first focusable element on every page. */}
        <a href="#main" className="cd-skip-link">
          Skip to content
        </a>
        <SiteHeader />
        <main id="main">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
