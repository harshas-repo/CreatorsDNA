import type { ContentDna, ContentPlatform } from "@/lib/contracts/creator";
import { PLATFORM_LABEL } from "@/lib/contracts/creator";
import type { CreatorAnalysis, FallbackLevel } from "@/lib/contracts/viewModels";
import type { DataSource } from "@/lib/contracts/domain";
// A runtime import, and a cheap one: the copy layer is template strings with no
// runtime imports of its own (see its header), so this drags nothing into the
// bundle. It is what turns a diagnostic code into a sentence.
import { explainObservation } from "@/lib/copy/generate";
import { DegradedNotice } from "@/components/ui/States";
import { TasteSeal } from "@/components/shapes/TasteSeal";

/**
 * `CreatorHeader` (doc 02 §30).
 *
 * Who this analysis is about, and — inseparably — what it was built from. The
 * two are in one component on purpose. A results page that shows the creator's
 * name at the top and buries the data-source disclosure at the bottom invites the
 * reader to treat everything in between as established fact about them; putting
 * the source directly under the identity makes it part of the same statement.
 *
 * Doc 02 §26 says the app is entered WITHOUT login, so the identity here is
 * whatever the creator typed in onboarding. Nothing in this component implies an
 * account, and the handle is optional because an anonymous run has none.
 *
 * `observations` are rendered inside a collapsed `<details>`. Doc 02 §33 requires a
 * useful message rather than a raw dump, and §11 sharpens that: a technical
 * diagnostic key must not BE the explanation, so each entry leads with what the
 * note means for the person reading the result and demotes the code plus its detail
 * into a nested "Technical detail" disclosure. Nothing is removed — the codes and
 * their detail strings are what make a failure reproducible, and §11 forbids
 * dropping diagnostics to make a run look healthier. They are simply no longer the
 * first thing a creator reads.
 *
 * The list is not only the provider's, though it started that way. `mergeObservations`
 * flattens three families into it: what the adapter noticed about a response,
 * provider calls that failed, and facts only the pipeline knows. That is why
 * `explainObservation` takes a widened string rather than indexing a typed map —
 * and why the consequence sentences distinguish a source that failed from a source
 * that had nothing, which read identically in an empty panel.
 *
 * Collapsed-by-default keeps the header readable while leaving the full record one
 * click away for anyone who wants to audit a result.
 */

/** What this component reads off the analysis. Narrow, so a caller holding a
 *  partial result during loading can still render the header. */
export interface CreatorHeaderAnalysis {
  source: DataSource;
  fallbackLevel: FallbackLevel;
  generatedAt: string;
  observations: CreatorAnalysis["observations"];
  /**
   * The profile hash from `TasteFingerprintViewModel.signature`.
   *
   * Only the string is accepted, not the whole view-model, because the header
   * renders the seal — not chart F. Passing the model would make it natural to
   * reach for the radar too, and a radar at header size is unreadable: it looks
   * like a chart whose labels went missing. The seal exists precisely so an
   * identity mark can sit next to a name at 64px.
   */
  sealSignature?: string;
}

export interface CreatorHeaderProps {
  displayName: string;
  handle?: string;
  platforms?: readonly ContentPlatform[];
  /** The creator's stated niche, in their own words. */
  niche?: string;
  /**
   * The creator's Content DNA — how they say they express themselves.
   *
   * Rendered as its one-line `positioning` summary rather than as the topics, angles
   * and formats underneath it: those are already on screen elsewhere (the platforms
   * list directly above, the coverage answers in the context step), and printing all
   * three again would make the header a form recap. §6 asks for the concise summary
   * for exactly this reason.
   *
   * Optional and absent for an illustrative run with no creator behind it, in which
   * case the line is not rendered — the same rule the `audience` prop follows on
   * `BrandCard`. It sits next to the stated niche and carries the same attribution,
   * because both are the creator's own answers and neither is a measurement.
   */
  contentDna?: ContentDna;
  analysis: CreatorHeaderAnalysis;
  degradations?: readonly string[];
  className?: string;
}

export function CreatorHeader({
  displayName,
  handle,
  platforms,
  niche,
  contentDna,
  analysis,
  degradations,
  className,
}: CreatorHeaderProps) {
  const { source } = analysis;

  return (
    <header className={`cd-creator${className ? ` ${className}` : ""}`}>
      <div className="cd-creator__identity">
        {/* Gated on a non-empty signature, not merely on presence: with no hash
            the seal degenerates to a bare ring, which reads as an avatar that
            failed to load rather than as "no fingerprint in this result". */}
        {analysis.sealSignature ? (
          <div className="cd-creator__seal">
            <TasteSeal signature={analysis.sealSignature} size={64} showHash={false} />
          </div>
        ) : null}

        <div className="cd-creator__text">
          <h1 className="cd-creator__name">{displayName}</h1>
          {handle ? <p className="cd-creator__handle">@{handle}</p> : null}

          {platforms && platforms.length > 0 ? (
            <ul className="cd-creator__platforms">
              {platforms.map((platform) => (
                <li key={platform}>{PLATFORM_LABEL[platform]}</li>
              ))}
            </ul>
          ) : null}

          {niche ? (
            <p className="cd-creator__niche">
              <span className="cd-eyebrow">Stated niche</span>
              <span>{niche}</span>
            </p>
          ) : null}

          {/* The same markup as the niche above, so the two read as one pair of
              self-reported lines rather than as a measured value under a free-text
              one. Reusing `cd-creator__niche` is deliberate: a new class would mean
              new CSS for a line that is styled identically, and this feature is not
              supposed to touch the design system. */}
          {contentDna?.positioning ? (
            <p className="cd-creator__niche">
              <span className="cd-eyebrow">Content DNA</span>
              <span>{`${contentDna.positioning} (self-reported)`}</span>
            </p>
          ) : null}
        </div>
      </div>

      <div
        className={
          source.isIllustrative
            ? "cd-datasource cd-datasource--synthetic"
            : "cd-datasource cd-datasource--live"
        }
        role="note"
      >
        <span className="cd-datasource__label">{source.label}</span>
        <span className="cd-datasource__body">
          {source.isIllustrative
            ? "Generated locally for development. Nothing below is a Qloo discovery and no live API call was made."
            : "Retrieved through the Qloo Insights API. Provenance is labelled per value."}
          <span className="cd-creator__generated">
            Generated {formatUtc(analysis.generatedAt)}.
          </span>
        </span>
      </div>

      <DegradedNotice
        level={analysis.fallbackLevel}
        degradations={degradations ?? []}
        source={source}
      />

      {analysis.observations.length > 0 ? (
        <details className="cd-creator__observations">
          <summary>
            {analysis.observations.length} note
            {analysis.observations.length === 1 ? "" : "s"} about the data behind this result
          </summary>
          <ul>
            {analysis.observations.map((observation, index) => (
              <li
                key={`${index}|${observation.code}`}
                className={`cd-creator__obs cd-creator__obs--${observation.severity}`}
              >
                {/* §11: the consequence leads, in plain language. The code and its
                    detail are the developer diagnostic and are preserved in full —
                    they are what makes a failure reproducible — but they name wire
                    indices, endpoint parameters and documented assumption numbers,
                    which is not a sentence a creator can act on. Demoted into a
                    nested disclosure rather than deleted, so nothing is lost and
                    the primary explanation is no longer a snake_case key. */}
                <span className="cd-creator__obs-what">
                  {explainObservation(observation.code)}
                </span>
                <details className="cd-creator__obs-tech">
                  <summary>Technical detail</summary>
                  <code>{observation.code}</code>
                  <span>{observation.detail}</span>
                </details>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </header>
  );
}

/**
 * Format an ISO timestamp as UTC, by hand.
 *
 * `Intl.DateTimeFormat` is deliberately avoided: this component renders inside
 * client trees, and a locale- or timezone-sensitive format can produce different
 * strings on the server and in the browser, which React reports as a hydration
 * mismatch. Fixed-width UTC components are identical everywhere. The timestamp is
 * a record of when the analysis ran, not a localised courtesy, so UTC is also the
 * more honest choice — "3 minutes ago" would be wrong the moment the page is
 * cached.
 */
function formatUtc(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`;
}
