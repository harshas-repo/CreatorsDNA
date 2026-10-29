import Link from "next/link";

import { getConfig } from "@/lib/env";
import { Wordmark } from "@/components/site/Wordmark";

/**
 * Site footer.
 *
 * Carries the global data-source disclosure. Execution decision 3 is explicit
 * that synthetic results must never be presented as Qloo discoveries, and a
 * banner buried on one page is not a disclosure — it has to be on every page,
 * including the marketing site where an example result is most likely to be
 * screenshotted and read out of context.
 *
 * Reading config here makes the route dynamic rather than statically generated.
 * That is the intended trade: a banner that can go stale is worse than a
 * server render, and the config read is a memoised process-wide object.
 */

const COLUMNS = [
  {
    title: "Product",
    links: [
      { href: "/#how", label: "How it works" },
      { href: "/analyze", label: "Map your taste DNA" },
      { href: "/examples", label: "Examples" },
      { href: "/methodology", label: "Methodology" },
    ],
  },
  {
    title: "Evidence",
    links: [
      { href: "/methodology#scoring", label: "Scoring model" },
      { href: "/methodology#fallbacks", label: "Fallback hierarchy" },
      { href: "/api/health", label: "Data-source status" },
    ],
  },
] as const;

export function SiteFooter() {
  const config = getConfig();
  const liveQloo = config.providerId === "qloo" && config.qloo.apiKey !== undefined;

  return (
    <footer className="cd-footer">
      <div className="cd-container">
        <div className="cd-footer__grid">
          <div className="cd-footer__brand">
            <Wordmark />
            <p className="cd-footer__tagline">
              CreatorsDNA maps creator and brand taste to uncover cultural
              intersections and potential partnership opportunities beyond
              conventional niche-based matching.
            </p>
          </div>

          {COLUMNS.map((column) => (
            <nav key={column.title} className="cd-footer__col" aria-label={column.title}>
              <h2 className="cd-eyebrow">{column.title}</h2>
              <ul>
                {column.links.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href}>{link.label}</Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div
          className={liveQloo ? "cd-datasource cd-datasource--live" : "cd-datasource cd-datasource--synthetic"}
          role="note"
        >
          <span className="cd-datasource__label">
            {liveQloo ? "Live Qloo data" : "Synthetic development data"}
          </span>
          <span className="cd-datasource__body">
            {liveQloo ? (
              <>
                Results on this deployment are retrieved from the Qloo Insights API
                using a configured key. Provenance is labelled per value.
              </>
            ) : (
              <>
                No Qloo API key is configured on this deployment, so every result is
                generated locally from a fixed synthetic catalogue. Nothing shown is a
                Qloo discovery, and no live API call has been made. Set{" "}
                <code>QLOO_API_KEY</code> and{" "}
                <code>CREATORSDNA_PROVIDER=qloo</code> to switch to live data.
              </>
            )}
          </span>
        </div>

        <div className="cd-footer__legal">
          <span>© {new Date().getFullYear()} CreatorsDNA</span>
          <span>
            Cultural data by{" "}
            <a href="https://qloo.com" rel="noreferrer noopener" target="_blank">
              Qloo
            </a>
            . Affinity scores describe cultural proximity, not survey percentages.
          </span>
        </div>
      </div>
    </footer>
  );
}
