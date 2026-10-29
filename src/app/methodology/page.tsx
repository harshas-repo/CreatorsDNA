import Link from "next/link";

import { getConfig } from "@/lib/env";
import { DEFAULT_THRESHOLDS } from "@/lib/analysis/thresholds";
import { countUnverifiedBrands, getAllBrands, getBrandRegistry } from "@/lib/data/brandRegistry";
import { DIMENSION_LABELS } from "@/lib/scoring/dimensions";
import {
  BROAD_OVERLAP_COUNT,
  CLEAR_OVERLAP,
  MAX_SHARED_DIMENSIONS,
  STRONG_OVERLAP,
} from "@/lib/analysis/intersection";
import { PROVENANCE_STYLE } from "@/lib/design/colourRoles";
import { EDITED_PITCH_DISCLOSURE, FORBIDDEN_PATTERNS } from "@/lib/copy/honesty";
import {
  FALLBACK_DESCRIPTIONS,
  FALLBACK_LEVELS,
  NOMINAL_WEIGHTS,
  SCORE_DIMENSIONS,
} from "@/lib/contracts/viewModels";
import { ProvenanceKey } from "@/components/ui/Provenance";
import { TableScroll } from "@/components/ui/TableScroll";
import { InsightSection } from "@/components/domain/InsightSection";

import type { Metadata } from "next";
import type { Provenance } from "@/lib/contracts/domain";
import type { ScoreDimension } from "@/lib/contracts/viewModels";

/**
 * The methodology page.
 *
 * `SiteFooter` links here four times — `/methodology`, `#scoring`, `#fallbacks`
 * and the health endpoint — so this is the page a reader lands on when they click
 * "how was this number produced?". That makes it the product's honesty surface,
 * and the rule applied throughout is the same one the rest of the codebase
 * follows: **nothing on this page is retyped from the implementation**. The
 * weights come from `NOMINAL_WEIGHTS`, the overlap thresholds from `intersection`,
 * the levels from `FALLBACK_DESCRIPTIONS`, the provenance classes from
 * `PROVENANCE_STYLE`, the forbidden phrasings from `FORBIDDEN_PATTERNS`. A
 * methodology page that paraphrases its own source drifts the first time the
 * source changes, and it drifts in the direction of still looking authoritative.
 *
 * The prose that IS hand-written is the part that cannot be generated: what each
 * dimension measures in plain language.
 *
 * The page renders per request, not at build time: the "current data status"
 * section states whether THIS DEPLOYMENT carries a Qloo key, which is a property
 * of the runtime environment. Prerendering would freeze that statement to the
 * build-time key state and let a live deployment claim it runs on synthetic data.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  description:
    "How CreatorsDNA compares a creator's taste with a brand's, ranks the overlap, normalises cultural affinity, degrades when data is missing, and what it refuses to claim.",
};

const TOC = [
  { id: "scoring", label: "Ranking & scoring" },
  { id: "normalisation", label: "Affinity & normalisation" },
  { id: "fallbacks", label: "Fallback hierarchy" },
  { id: "provenance", label: "Provenance" },
  { id: "honesty", label: "Claims we refuse" },
  { id: "data", label: "Current data status" },
] as const;

/**
 * Plain-language companion to each dimension.
 *
 * Transcribed from the calculators in `src/lib/scoring/dimensions.ts`, which is
 * the authority: if a calculator changes and this text does not, this text is
 * wrong. The omission column exists because doc 02 §16's rule — omit, use a
 * defined neutral fallback, or mark unavailable; never fabricate — is only
 * checkable if the reader can see which branch was taken.
 */
const DIMENSION_NOTES: Record<ScoreDimension, { measures: string; omitted: string }> = {
  taste_fit: {
    measures:
      "The verified cultural intersection, and nothing else: the share of your total derived taste weight that this brand's own catalogue descriptors also carry, established by exact descriptor identity. It is not a position in a returned candidate set and it is not comparable to another analysis. A measured zero is scored as zero rather than omitted, because zero there means both sides carried comparable descriptors and none matched — a finding, not a gap in one.",
    omitted:
      "No intersection was computed for the brand; the overlap could not be established, either because one side carried no comparable descriptors or because the two sides' descriptor namespaces share nothing and so cannot be compared with the supported taxonomy; or shared ground was verified only at classification level, where a recorded industry or category matched one of your tastes by name. That last case is genuine evidence and is listed among the shared dimensions, but it is too coarse to carry a numeric score, so no figure is shown rather than one being invented.",
  },
  audience_demographic: {
    measures:
      "The mean of the signed demographic deltas across the age buckets and gender you declared, mapped so that a delta of zero — exactly average — sits at 0.5. These are deviations from average, never shares of an audience.",
    omitted:
      "You provided no audience demographics (the input is optional), the data source returned none, or none of the buckets you declared appeared in what came back.",
  },
  content_compatibility: {
    measures:
      "The spread of the overlap: the share of your DISTINCT taste descriptors that this brand's own descriptors also carry, where taste fit reports that overlap's intensity. Both figures come from one comparison, so they cannot disagree about whether a comparison was possible. Your platform selection is not an input here and no platform-compatibility score is computed, because nothing in the returned brand data says which platforms a brand works with.",
    omitted:
      "Exactly when taste fit is omitted, for the same reason: the two read one comparison and report different aspects of it. Separately, your derived taste tags could not be counted, so no breadth figure exists.",
  },
  geographic: {
    measures:
      "An exact country match between your declared location and the region returned for the brand. Binary by design: the data supports a match test, not a distance or affinity model, and inventing partial credit would be a fabricated dimension.",
    omitted:
      "You provided no location, your location was not given as a country, or the data source returned no region for the brand.",
  },
  opportunity_gap: {
    measures:
      "Verified cultural affinity multiplied by the uncovered share of that category: affinity x (1 - coverage). The affinity is the intersection's verified strength, not the brand's position in the discovery results. Coverage comes from your own declaration, so a brand in a saturated niche scores below an equally aligned brand in an untouched one.",
    omitted:
      "No verified cultural affinity was established for the brand, or coverage is unknown because you never declared it. Coverage is never inferred from your uploads, and the discovery position is never substituted for either input — a ranking inside one candidate set is not a cultural measurement.",
  },
};

export default function MethodologyPage() {
  const config = getConfig();
  const registry = getBrandRegistry();
  const brands = getAllBrands();
  const unverified = countUnverifiedBrands();
  const liveQloo = config.providerId === "qloo" && config.qloo.apiKey !== undefined;
  const provenances = Object.keys(PROVENANCE_STYLE) as Provenance[];

  return (
    <div className="cd-method">
      {/* --- Header ------------------------------------------------------ */}
      <section className="cd-section" aria-labelledby="method-title">
        <div className="cd-container">
          <p className="cd-eyebrow">Methodology</p>
          <h1 id="method-title" className="cd-method__title">
            Every number in this product has a stated origin
          </h1>
          <p className="cd-method__lede cd-measure">
            CreatorsDNA compares cultural profiles, not audience sizes. There is no language model
            in the pipeline: every figure is produced by deterministic arithmetic over typed data,
            and the arithmetic is disclosed beside the result. This page is that disclosure in full.
          </p>

          <nav className="cd-method__toc" aria-label="Methodology sections">
            {TOC.map((entry) => (
              <Link key={entry.id} href={`#${entry.id}`} className="cd-method__toc-link">
                {entry.label}
              </Link>
            ))}
          </nav>
        </div>
      </section>

      {/* --- Scoring ----------------------------------------------------- */}
      <section className="cd-section cd-section--sunken" aria-labelledby="scoring-title">
        <div className="cd-container">
          <InsightSection
            id="scoring"
            index="01"
            eyebrow="Ranking & scoring"
            title="The intersection ranks; five weighted dimensions break its ties"
            headingLevel={2}
            lede={
              <>
                A brand is placed by how much cultural ground it genuinely shares with you, and only
                then by a weighted sum. The comparison comes first because a catalogue returning a
                brand is discovery, not a recommendation: without it, a brand the query happened to
                return highly could outrank one that actually sits on your ground. Your derived
                taste descriptors and the brand&rsquo;s own descriptors are the same catalogue
                representation, so a match is an identity between two catalogue entries rather than
                two words that look alike. Where the brand carried no comparable descriptors of its
                own, its recorded classification is matched against your taste at industry level and
                labelled as the coarser comparison it is.
              </>
            }
            copy={[
              `The intersection's ranking value is (directness x 0.2 + overlap x 0.6 + breadth x 0.2) x confidence. Directness is 1 when at least one shared dimension rests on a taste you confirmed yourself and 0 when every one was reached through an adjacent connection. Overlap is the share of your total derived taste weight that the brand also carries — a share of your own taste, never a percentage of any audience, never a position among the brands the catalogue returned, and never comparable to another creator. Breadth is the count of shared dimensions, capped at ${MAX_SHARED_DIMENSIONS} and divided by ${MAX_SHARED_DIMENSIONS}. Confidence is 0.5 when the brand's own cultural profile came back thin, which halves its ranking value rather than zeroing it: a sparse brand is pushed down the list, never removed from it, because removing it would hide a real brand behind a gap in our data about it. A brand with no intersection at all is given -1 — last, and still on the list.`,
              `The qualitative label beside a brand is decided by the STATE of the comparison before any arithmetic is consulted, because the arithmetic cannot tell a finding from a gap. Where comparable descriptors were examined and none matched, it reads "No shared taste found". Where they could not be examined — one side carried nothing comparable, or the two sides' descriptor namespaces share nothing the taxonomy supports — it reads "Could not establish shared taste", which is an admission about our evidence and not a claim about the brand. Only a verified overlap reaches the labels below.`,
              `Within a verified overlap the label is derived from that same overlap figure and is never chosen independently: at or above ${Math.round(
                STRONG_OVERLAP * 100,
              )}% it reads "Strong shared taste", at or above ${Math.round(
                CLEAR_OVERLAP * 100,
              )}% "Clear shared taste", and with ${BROAD_OVERLAP_COUNT} or more shared dimensions but a lower share, "Broad shared taste". "Strong" additionally requires at least two DISTINCT concepts, because a high share resting on one idea is intensity without spread: the catalogue's ids are hierarchical, so one brand was observed carrying five ids that all meant fashion, and counting ids would let a single concept buy a breadth claim it had not earned. Below all three thresholds the label names what was actually found — "One shared descriptor", or a count of them — rather than a qualitative word, because a negligible share of your taste weight is not "some shared taste" and no floor below ${Math.round(
                CLEAR_OVERLAP * 100,
              )}% earns a positive label. A brand whose profile came back thin is labelled on the evidence instead of the arithmetic — "Limited evidence, but some shared ground" — however the figure lands, because the arithmetic would then be resting on the coarse classification match already named above.`,
              `Nominal weights sum to ${Math.round(
                SCORE_DIMENSIONS.reduce((sum, d) => sum + NOMINAL_WEIGHTS[d], 0) * 100,
              )}%. The effective weight of a dimension is its nominal weight divided by the sum of the nominal weights of the dimensions that were actually available, so an omitted dimension redistributes its influence rather than dragging the score toward zero. A dimension that cannot be computed is OMITTED, never given a neutral default: a 0.5 placeholder would look like a measurement of "average" when it is in fact the absence of one. This weighted sum runs AFTER the intersection and only orders the brands the intersection left tied. Between the two sits one further comparison, applied only when both brands' coverage is actually known: an untapped brand — verified overlap, a strength at or above the clear-overlap line, and a declared coverage low enough that the creator has not covered it — is placed first. A brand whose coverage was never declared is neither promoted nor demoted by it, because "unknown" is not evidence either way. A brand with no renderable score sorts below one that has a score, always, so that "we could not score this" can never be mistaken for "we scored it and it lost"; and the discovery position is consulted only as a last tie-break between two brands whose evidence is otherwise genuinely equal.`,
            ]}
            aside={
              <>
                <p className="cd-eyebrow">What you see in the UI</p>
                <p className="cd-aside-note">
                  Chart E renders the nominal weight, the effective weight, the 0–1 value, whether
                  the dimension was available, and the basis string — for every dimension, including
                  the omitted ones. An overall figure never appears without them.
                </p>
                <p className="cd-aside-note">
                  The overall is marked non-renderable in two distinct situations, and the UI names
                  which one applies. Either no dimension could be computed at all, or dimensions
                  were computed but none of them measures cultural compatibility — a score built
                  only from audience deltas, a country match and a coverage gap is a real number
                  about logistics and says nothing about fit. In both cases the label reads
                  &ldquo;Not enough comparable evidence&rdquo; instead of a figure. A zero would read
                  as &ldquo;scored and found wanting&rdquo;, which is a different and false claim.
                  Chart E also lists each unavailable dimension with its reason and states how much
                  of the intended weighting the score actually rests on, so a partial assessment is
                  identified as one in the headline rather than only in a footnote.
                </p>
                <p className="cd-aside-note">
                  The shared taste itself is rendered <em>above</em> the score on every brand card
                  and on the brand detail step, so the figure never appears where it could be read
                  as the finding. That block also lists each shared dimension with the evidence for
                  both sides, whether it rests on a taste you confirmed or on an adjacent
                  connection, whether the match was an exact descriptor identity or the coarser
                  classification comparison, what could not be compared, and the comparison method
                  in full.
                </p>
                <p className="cd-aside-note">
                  Why the catalogue returned a brand is rendered in its own block, below the score
                  and visually quieter than both it and the shared taste. Three questions are kept
                  apart on the card on purpose — why it was discovered, what overlap was verified,
                  and what remains unknown — because a discovery path is not proof of a cultural
                  match, and on a card where all three are visible the reader has to be able to tell
                  them apart.
                </p>
              </>
            }
          >
            <TableScroll label="Brand-fit dimensions">
              <table className="cd-table cd-method__table">
                <caption className="cd-sr-only">
                  Brand-fit dimensions, their nominal weights, what each measures and when each is
                  omitted
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Dimension</th>
                    <th scope="col">Weight</th>
                    <th scope="col">What it measures</th>
                    <th scope="col">Omitted when</th>
                  </tr>
                </thead>
                <tbody>
                  {SCORE_DIMENSIONS.map((dimension) => (
                    <tr key={dimension}>
                      <th scope="row">
                        {DIMENSION_LABELS[dimension]}
                        <code className="cd-method__code">{dimension}</code>
                      </th>
                      <td className="cd-tabular">
                        {Math.round(NOMINAL_WEIGHTS[dimension] * 100)}%
                      </td>
                      <td>{DIMENSION_NOTES[dimension].measures}</td>
                      <td className="cd-method__omitted">
                        {DIMENSION_NOTES[dimension].omitted}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          </InsightSection>
        </div>
      </section>

      {/* --- Normalisation ----------------------------------------------- */}
      <section className="cd-section" aria-labelledby="normalisation-title">
        <div className="cd-container">
          <InsightSection
            id="normalisation"
            index="02"
            eyebrow="Affinity & normalisation"
            title="Affinity is a position inside one result set, never a quantity of people"
            headingLevel={2}
            lede={
              <>
                The cultural data source returns an affinity score for each entity it returns, scored
                against your signals within that one call. Those scores are normalised per query and
                depressed by whatever filters were applied, so a raw score from one call is not
                comparable to a raw score from another. Everything downstream therefore uses the
                within-set value.
              </>
            }
          >
            <ol className="cd-stages">
              {NORMALISATION_STEPS.map((step, index) => (
                <li key={step.title} className="cd-stage">
                  <span className="cd-stage__index cd-tabular" aria-hidden="true">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div className="cd-stage__body">
                    <h3 className="cd-stage__title">{step.title}</h3>
                    <p className="cd-stage__text">{step.text}</p>
                    <p className="cd-stage__detail">{step.detail}</p>
                  </div>
                </li>
              ))}
            </ol>
          </InsightSection>
        </div>
      </section>

      {/* --- Fallbacks ---------------------------------------------------- */}
      <section className="cd-section cd-section--sunken" aria-labelledby="fallbacks-title">
        <div className="cd-container">
          <InsightSection
            id="fallbacks"
            index="03"
            eyebrow="Fallback hierarchy"
            title="Five levels of degradation, and the level is always shown"
            headingLevel={2}
            lede={
              <>
                These are an ordered degradation chain, not a severity ranking of independent faults.
                L4 always wins; otherwise the reported level is the furthest point down the chain
                that had to be used. Every condition that applied is listed separately in the
                analysis, so collapsing to one level loses nothing.
              </>
            }
            aside={
              <>
                <p className="cd-eyebrow">Where this appears</p>
                <p className="cd-aside-note">
                  The level is rendered in the creator header, in each chart&apos;s metadata and on
                  the media kit. A reader is never left to infer from a sparse-looking chart that
                  something was missing.
                </p>
                <p className="cd-aside-note">
                  L4 is a hard failure. The product shows an unavailable state and stops rather than
                  rendering an empty profile that looks like a result.
                </p>
              </>
            }
          >
            <TableScroll label="Fallback levels">
              <table className="cd-table cd-method__table">
                <caption className="cd-sr-only">Fallback levels and what each one means</caption>
                <thead>
                  <tr>
                    <th scope="col">Level</th>
                    <th scope="col">Meaning</th>
                  </tr>
                </thead>
                <tbody>
                  {FALLBACK_LEVELS.map((level) => (
                    <tr key={level} data-level={level}>
                      <th scope="row" className="cd-method__level cd-tabular">
                        {level}
                      </th>
                      <td>{FALLBACK_DESCRIPTIONS[level]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          </InsightSection>
        </div>
      </section>

      {/* --- Provenance --------------------------------------------------- */}
      <section className="cd-section" aria-labelledby="provenance-title">
        <div className="cd-container">
          <InsightSection
            id="provenance"
            index="04"
            eyebrow="Provenance"
            title="Where a value came from is encoded separately from what it is about"
            headingLevel={2}
            lede={
              <>
                Colour is reserved for semantic role — taste, brand, content, audience, geography.
                Provenance rides on a different channel entirely: line style, node shape, a badge, a
                hatched background. Splitting the two is what lets a value survive being printed in
                greyscale, screenshotted at low fidelity, or viewed by someone who cannot
                distinguish the hues.
              </>
            }
          >
            <ProvenanceKey provenances={provenances} />

            <TableScroll label="Provenance classes">
              <table className="cd-table cd-method__table">
                <caption className="cd-sr-only">
                  The four provenance classes and what each one means
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Class</th>
                    <th scope="col">Meaning</th>
                  </tr>
                </thead>
                <tbody>
                  {provenances.map((provenance) => {
                    const style = PROVENANCE_STYLE[provenance];
                    return (
                      <tr key={provenance}>
                        <th scope="row">{style.label}</th>
                        <td>{style.description}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableScroll>

            <p className="cd-method__note">
              A component&apos;s provenance is the provenance of the <em>data</em> it was computed
              from, not of the arithmetic. A live affinity therefore reads as retrieved even though
              the normalisation is ours; synthetic input reads as synthetic, which is what forces the
              illustrative banner. The arithmetic is disclosed separately, in the basis string next
              to every bar.
            </p>
          </InsightSection>
        </div>
      </section>

      {/* --- Honesty ------------------------------------------------------ */}
      <section className="cd-section" aria-labelledby="honesty-title">
        <div className="cd-container">
          <InsightSection
            id="honesty"
            index="05"
            eyebrow="Claims we refuse"
            title="Generated copy is checked against a fixed list of forbidden phrasings"
            headingLevel={2}
            lede={
              <>
                Affinity is not survey data, and the product never implies that followers were
                measured. The rules below are enforced in code on every generated sentence, and again
                on any pitch a creator edits by hand.
              </>
            }
            aside={
              <>
                <p className="cd-eyebrow">Hand-edited pitches</p>
                <p className="cd-aside-note">{EDITED_PITCH_DISCLOSURE}</p>
                <p className="cd-aside-note">
                  The disclosure is appended rather than the export blocked. Preventing a creator
                  from sending their own email would be paternalistic; shipping it silently would put
                  an unverifiable audience claim into a business document carrying our name.
                </p>
              </>
            }
          >
            <TableScroll label="Forbidden phrasings">
              <table className="cd-table cd-method__table">
                <caption className="cd-sr-only">
                  Phrasings the generator refuses to produce, and why
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Pattern</th>
                    <th scope="col">Why it is refused</th>
                  </tr>
                </thead>
                <tbody>
                  {FORBIDDEN_PATTERNS.map((entry) => (
                    <tr key={entry.pattern.source}>
                      <th scope="row">
                        <code className="cd-method__code">{entry.pattern.source}</code>
                      </th>
                      <td>{entry.why}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          </InsightSection>
        </div>
      </section>

      {/* --- Current data status ------------------------------------------ */}
      <section className="cd-section cd-section--sunken" aria-labelledby="data-title">
        <div className="cd-container">
          <InsightSection
            id="data"
            index="06"
            eyebrow="Current data status"
            title={
              liveQloo
                ? "This deployment is configured with a Qloo API key"
                : "This deployment has no API key and runs entirely on synthetic data"
            }
            headingLevel={2}
            lede={
              liveQloo ? (
                <>
                  Values are retrieved through the Qloo Insights API and labelled per value by
                  provenance. Identical requests are cached and never repeated.
                </>
              ) : (
                <>
                  Every value in this build was generated locally from a fixed synthetic catalogue.
                  The API adapter, the request builder and the response mapper are implemented and
                  tested against the documented contract, but no live call has been made and nothing
                  here is a Qloo discovery. The same banner appears in the application.
                </>
              )
            }
          >
            <dl className="cd-method__status">
              <div className="cd-method__status-row">
                <dt>Provider</dt>
                <dd>
                  <code className="cd-method__code">{config.providerId}</code>
                </dd>
              </div>
              <div className="cd-method__status-row">
                <dt>Qloo API key</dt>
                <dd>{config.qloo.apiKey === undefined ? "not set" : "set"}</dd>
              </div>
              <div className="cd-method__status-row">
                <dt>Base URL</dt>
                <dd>
                  <code className="cd-method__code">{config.qloo.baseUrl}</code>
                </dd>
              </div>
              <div className="cd-method__status-row">
                <dt>Cache driver</dt>
                <dd>
                  <code className="cd-method__code">{config.cache.driver}</code>
                  <span className="cd-method__status-note">
                    TTL {config.cache.ttlSeconds}s
                    {config.cache.driver === "filesystem" ? ` · ${config.cache.dir}` : ""}
                  </span>
                </dd>
              </div>
              <div className="cd-method__status-row">
                <dt>Brand registry</dt>
                <dd>
                  {brands.length} entries · version {registry.version} · {unverified} awaiting
                  curator verification
                </dd>
              </div>
            </dl>

            <p className="cd-method__note">{registry.attribution}</p>

            {config.warnings.length > 0 ? (
              <ul className="cd-method__warnings">
                {config.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            ) : null}

            <p className="cd-method__note">
              Live status is served by{" "}
              <Link href="/api/health" className="cd-method__link">
                /api/health
              </Link>
              , which reports the same configuration at request time rather than at build time.
            </p>
          </InsightSection>
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page content
// ---------------------------------------------------------------------------

const NORMALISATION_STEPS = [
  {
    title: "Detect the scale before using it",
    text: "The concept documentation describes affinity as 0–100, but the JSON encoding was never verified. Rather than hard-coding one answer, the mapper inspects what actually arrived.",
    detail:
      "Values in (1, 100] are read as percent; values all within [0, 1] are read as unit. A mix of both is flagged as contradictory rather than averaged away, and a set where every value is inside [0, 1] is recorded as genuinely ambiguous — it could be a unit encoding, or a percent encoding whose scores all happen to be very low. One live call resolves it, and until then the ambiguity is on the record.",
  },
  {
    title: "Normalise within the result set",
    text: "Min-max across the candidates returned by one call. Nothing is compared across calls, because the scores are not commensurable.",
    detail:
      "When every candidate in a set ties, min-max degenerates — so the value falls back to being derived from position in the result set, and the basis string says which of the two methods produced it. The set size is carried alongside the value so a reader can see how much the normalisation had to work with, and the spread between the set's highest and lowest raw affinity is carried too, because that is the figure which makes the position interpretable: a rank of 1 over a spread of 0.017 is a weak claim, and printing the spread is what stops it reading as a strong one.",
  },
  {
    title: "Keep the normalised position as discovery metadata, not as fit",
    text: "A min-max value says where a result sat in the set that was returned. It does not say how well that result fits, and it is never used as though it did.",
    detail:
      "This is a correction, and the reason it is written down. Min-max stretches whatever spread a set happens to have across the full 0–1 range, so the leader of every set scores 1.00 however close the candidates were. One live brand call returned affinities spanning 0.8211 to 0.8382 — a spread of 0.017 — and feeding that position into the fit score awarded the top result a perfect cultural measurement it had earned only by being returned first. Where the other dimensions were unavailable, renormalisation then handed that figure most of the weight. The position is still computed, still carried on every brand, and still rendered — as the raw affinity exactly as returned, the detected scale, whether that scale could be resolved, the spread, the method and the call it came from — because 'why did this brand appear?' is a real question. It feeds no dimension and no ranking advantage.",
  },
  {
    title: "Do not normalise your own assertions",
    text: "An entity you confirmed yourself is scored at full weight under its own method, not min-maxed against the other things you confirmed.",
    detail:
      "Min-max always hands the lowest member of a set a value of zero. Applied to your confirmed interests, that would report one of the things you told us about as carrying no evidence at all — so they are excluded from the normalisation and marked separately instead. Their weight is deliberately not comparable to a recommendation's score, and every surface that shows them says which of the two produced the number.",
  },
  {
    title: "Mark clusters instead of ranking them",
    text: "Two adjacent results within a small tolerance of each other are labelled as a cluster rather than presented as first and second.",
    detail:
      "The data source documents a cluster of strong matches at the top of its result sets. Rendering those as a strict ordering invents a distinction the data does not contain, so the tie is marked in the UI and the prose says the gap to the neighbour is not meaningful.",
  },
  {
    title: "Harvest tags, then group",
    text: "Cultural tags are collected from the entities that carried them and weighted by affinity, then grouped by subtype into categories.",
    detail:
      "A tag must be supported by at least two distinct entities to surface at all, so a single odd result cannot become a taste signal. The entities that contributed to each tag are retained — that list is the provenance trail the UI shows on inspection.",
  },
  {
    title: "Derive by set arithmetic",
    text: `Unexpected affinities are returned categories minus declared categories. Untapped cultural connections are the derived categories whose affinity clears ${Math.round(
      DEFAULT_THRESHOLDS.unexpectedMinAffinity * 100,
    )}% of the normalised range while your declared coverage of them sits at or below ${Math.round(
      DEFAULT_THRESHOLDS.untappedCoverage * 100,
    )}%.`,
    detail:
      "Both are differences over data already on screen, which is why the product can show its working rather than assert a conclusion. The affinity floor is the same one unexpected affinities use, so the two features cannot disagree about what counts as meaningful relevance. Coverage is never inferred from a creator's uploads: where it was not declared, the zero is labelled as our inference rather than passed off as their answer, and a category with no coverage statement at all is omitted with the reason shown beside it. No 'untapped potential' percentage is printed anywhere — affinity against declared coverage would not mean what such a figure looks like it means.",
  },
  {
    title: "Compare the two profiles",
    text: "Brands discovered across that taste profile have their own cultural profile read back out of the same catalogue, and the two are intersected before either is ranked.",
    detail:
      "Both sides are the same catalogue representation, so a match is an identity between two catalogue entries rather than two words that look alike. No fuzzy or semantic matching is performed, nothing is inferred from a brand's name, and no brand-side audience data exists to infer from. Each shared dimension carries the evidence for both sides and records whether it rests on a taste the creator confirmed themselves or on an adjacent connection reached through the catalogue. A brand returned with little more than a name is marked as evidence-limited, keeps its place on the list, and is never given a confident overlap claim.",
  },
] as const;
