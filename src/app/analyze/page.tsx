import Link from "next/link";

import { getConfig } from "@/lib/env";
import { AnalyzeFlow } from "./AnalyzeFlow";

import type { Metadata } from "next";

/**
 * `/analyze` — the application (doc 02 §28).
 *
 * A Server Component shell around a client-side wizard, and the split is not
 * arbitrary. Everything on this page that describes the DEPLOYMENT is rendered
 * here, on the server, from configuration: whether a Qloo key exists, which
 * provider the build will use, what the operator was warned about. Everything that
 * describes the CREATOR is rendered by `AnalyzeFlow`, in the browser, from what
 * they type.
 *
 * That division is what keeps the honesty banners trustworthy. A "synthetic data"
 * notice computed in the browser from an API response is a notice the app produced
 * about itself; the same notice computed here from `getConfig()` is produced by the
 * thing that reads the environment. If the two ever disagree, the one on this page
 * is the one describing reality, and the results carry their own `DataSource`
 * banner from the response so a disagreement is visible rather than hidden.
 *
 * `getConfig()` is used rather than `getProviderContext()` for the same reason the
 * marketing page avoids the latter: constructing a provider context builds a cache
 * and, on a keyed deployment, can attempt a live connection. Neither belongs in a
 * static page shell.
 *
 * The page itself renders per request, not at build time. The banner here states
 * whether THIS DEPLOYMENT will call Qloo - a property of the runtime environment,
 * not of the build. Prerendering would freeze the banner to whatever key state
 * existed at build time, which is exactly the failure mode that makes a live
 * deployment claim synthetic data.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  description:
    "Build your cultural taste graph: declare the subjects you care about, see what comes back that you never mentioned, and find the brands that sit in the gap.",
};

export default function AnalyzePage() {
  const config = getConfig();
  const liveQloo = config.providerId === "qloo" && config.qloo.apiKey !== undefined;

  return (
    <>
      <section className="cd-section cd-onboard__intro">
        <div className="cd-container">
          <p className="cd-eyebrow">The application</p>
          <h1 className="cd-onboard__heading">Find out what your taste actually connects to</h1>
          <p className="cd-onboard__standfirst cd-measure">
            Twelve steps. Four ask you something; eight show you what came back and how it was
            produced. No account, nothing stored, and no result you cannot trace to an input you
            gave.
          </p>

          <div
            className={
              liveQloo ? "cd-datasource cd-datasource--live" : "cd-datasource cd-datasource--synthetic"
            }
            role="note"
          >
            <span className="cd-datasource__label">
              {liveQloo ? "Live Qloo data" : "Synthetic development data"}
            </span>
            <span className="cd-datasource__body">
              {liveQloo ? (
                <>
                  This deployment has a <code>QLOO_API_KEY</code>, so search and analysis call the
                  Qloo Insights API. Provenance is labelled per value, and anything CreatorsDNA
                  derived itself is marked as derived.
                </>
              ) : (
                <>
                  This deployment has no <code>QLOO_API_KEY</code>, so search and every result come
                  from a fixed synthetic catalogue. The API adapter, the request builder and the
                  response mapper are all implemented against the documented contract — but nothing
                  here is a Qloo discovery, and no live call produced it. Each result carries the
                  same banner.
                </>
              )}
            </span>
          </div>

          {config.warnings.length > 0 ? (
            <div className="cd-onboard__notices">
              <p className="cd-eyebrow">Configuration notices</p>
              <ul>
                {config.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <p className="cd-onboard__intro-links">
            <Link href="/methodology">How the numbers are produced</Link>
            <Link href="/examples">See an example run first</Link>
          </p>
        </div>
      </section>

      <section className="cd-section cd-section--sunken">
        <div className="cd-container">
          <AnalyzeFlow />
        </div>
      </section>
    </>
  );
}
