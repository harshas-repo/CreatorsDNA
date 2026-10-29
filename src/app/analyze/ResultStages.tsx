"use client";

import { useEffect, useState } from "react";

import { brandsInConnection, quadrantFor } from "@/lib/analysis/opportunities";
import { partitionTasteDna } from "@/lib/analysis/tasteDna";
import { PLATFORM_LABEL } from "@/lib/contracts/creator";
import {
  brandCategoryLabel,
  describeBrandFit,
  describeBrandOpportunity,
  describeCoreTaste,
  describeOpportunities,
  describeTasteDna,
  describeUnexpectedAffinity,
  draftPitch,
  sourceVoice,
} from "@/lib/copy/generate";
import { BrandCard } from "@/components/domain/BrandCard";
import { CreatorHeader } from "@/components/domain/CreatorHeader";
import { InsightSection } from "@/components/domain/InsightSection";
import { MediaKit } from "@/components/domain/MediaKit";
import { OpportunityCard } from "@/components/domain/OpportunityCard";
import { PitchEditor } from "@/components/domain/PitchEditor";
import { PrintButton } from "@/components/domain/PrintButton";
import { SharedTaste } from "@/components/domain/SharedTaste";
import { TasteChip } from "@/components/domain/TasteChip";
import { AffinityRanking } from "@/components/viz/AffinityRanking";
import { BrandFitBreakdown } from "@/components/viz/BrandFitBreakdown";
import { CultureToBrandMap } from "@/components/viz/CultureToBrandMap";
import { OpportunityGap } from "@/components/viz/OpportunityGap";
import { TasteDnaNetwork } from "@/components/viz/TasteDnaNetwork";
import { TasteFingerprint } from "@/components/viz/TasteFingerprint";
import { EmptyState, HardFailState } from "@/components/ui/States";

import type {
  BrandOpportunity,
  CreatorAnalysis,
  OpportunityPoint,
} from "@/lib/contracts/viewModels";
import type { AnalyzeResponse, DraftProfile, SearchMatch, Stage } from "./flowTypes";
import {
  deriveNiche,
  describeAudience,
  describeContent,
  draftAudienceWords,
  isHardFail,
} from "./flowTypes";

/**
 * The seven result stages of doc 02 §28: Taste DNA, unexpected affinities,
 * untapped cultural connections, brands you overlap with, brand detail, pitch,
 * media kit.
 *
 * WHY THIS IS ONE DYNAMICALLY-IMPORTED MODULE
 * -------------------------------------------
 * Every component above is pure render logic, but several of them reach into the
 * analysis and copy layers — `OpportunityCard` imports `describeOpportunityPoint`,
 * `MediaKit` imports `sourceVoice`, this file imports `quadrantFor`. Importing any
 * of them from a client module puts `generate.ts`, `opportunities.ts` and the
 * scoring layer into a browser bundle.
 *
 * That cost is real and it is accepted deliberately, for two reasons. The
 * alternative is to re-implement the copy templates and the quadrant thresholds
 * in the browser, and two copies of a sentence about how a number was produced is
 * exactly the drift this codebase is built to prevent. And `AnalyzeFlow` loads this
 * module with `next/dynamic`, so none of it is in the initial `/analyze` payload —
 * it arrives only once an analysis actually exists to render.
 *
 * The consequence worth naming: these are Server Components rendered from a client
 * module, which makes them client components. They lose nothing here (no data
 * fetching, no `server-only` import) but they do arrive in the HTML only after
 * hydration. That is the correct trade for a wizard whose results do not exist
 * until the creator has typed something.
 *
 * ONE STAGE AT A TIME
 * -------------------
 * Doc 02 §28's sequence is not a long scroll, and collapsing it into one would be
 * a simpler implementation and a worse explanation. Each stage answers a question
 * the previous one raised: what is your taste → what came back that you did not
 * mention → where is the gap between that and what you already make → which brands
 * sit there → why this one → what do you say to them → what do you send. A reader
 * who gets all seven at once gets a report; one at a time, they get an argument.
 */

/**
 * How many brand cards the overlap list shows before asking to be expanded.
 *
 * A run can return a dozen brands and each card carries the verified overlap, the
 * fit headline and the discovery rank. Rendered all at once that is six rows of
 * two on a desktop — a scroll longer than the stage it belongs to, and the creator
 * reads the same four-sentence shape twelve times before reaching the footnote
 * that says what the list is.
 *
 * Pagination rather than a horizontal scroller, deliberately. These cards are
 * prose, not tiles: a horizontal strip either fixes a card width that truncates
 * the overlap sentence or lets the cards grow to their natural height, which puts
 * the page back where it started, sideways. Pagination keeps the `<ul>` semantics
 * and the natural tab order, adds no scroll region for focus to get trapped in,
 * and degrades to a plain list with the button gone once everything is shown.
 *
 * Six is three rows of two — enough to compare neighbours and short enough that
 * the "Show more" control is visible without hunting for it.
 */
const BRAND_PAGE_SIZE = 6;

export interface ResultStagesProps {
  /** One of `RESULT_STAGES`. The flow guarantees it; the switch has a default. */
  stage: Stage;
  response: AnalyzeResponse;
  /** The creator's own words, needed by the pitch draft and the media kit. */
  draft: DraftProfile;
  selectedBrandId: string | undefined;
  onSelectBrand: (brandId: string) => void;
  /** Brand ids the creator has set aside to pitch, in the order they added them. */
  shortlist: readonly string[];
  onToggleShortlist: (brandId: string) => void;
  /** Jump to an earlier stage — used by the empty states that can be fixed. */
  onGoto: (stage: Stage) => void;
  /** Resolve an unresolved interest to a catalogue entity, then re-run. */
  onResolveInterest?: (query: string, match: SearchMatch) => void;
}

export function ResultStages({
  stage,
  response,
  draft,
  selectedBrandId,
  onSelectBrand,
  shortlist,
  onToggleShortlist,
  onGoto,
  onResolveInterest,
}: ResultStagesProps) {
  /**
   * How far the brand list has been expanded.
   *
   * Held HERE rather than in `BrandsStage` because `BrandsStage` unmounts the
   * moment the stage changes. A creator who expands the list, opens a brand's
   * detail and presses "All brands" to come back would otherwise land on a freshly
   * collapsed six — repeating the scroll they just did, for no reason they can see.
   * This component stays mounted across result stages (only its `stage` prop
   * changes, and the `switch` below is what mounts and unmounts), so the expansion
   * survives the round trip.
   *
   * Declared above the early return that follows: a hook after a conditional
   * `return` is a different hook order on the two paths, which is the one rule
   * React cannot paper over.
   */
  const [brandsVisible, setBrandsVisible] = useState(BRAND_PAGE_SIZE);

  // Guarded here as well as in the flow, and the duplication is deliberate. The
  // failure mode of getting it wrong is the one doc 04 §4.5 exists to prevent: an
  // unpersonalised popularity list wearing a warning badge, which still reads as
  // "your taste". A single upstream check would mean any future caller of this
  // module could render it by accident.
  if (isHardFail(response)) {
    // Two very different causes share `L4` and need opposite messages. When NO
    // interest resolved (`hasSignals:false`) the fix is the creator's inputs, so
    // we name what failed to match and offer one-click candidates. When signals
    // WERE sent and the source still ignored them, that is a data-source fault
    // and `HardFailState`'s "not your interests" copy is the truth.
    return (
      <div className="cd-onboard__stage-body">
        {response.hasSignals ? (
          <HardFailState reasons={response.degradations} onRestart={() => onGoto("review")} />
        ) : (
          <NoSignalsRecovery
            unresolved={response.analysis.unresolvedInterests}
            onRestart={() => onGoto("review")}
            onResolve={onResolveInterest}
          />
        )}
      </div>
    );
  }

  switch (stage) {
    case "taste":
      return <TasteStage response={response} draft={draft} />;
    case "unexpected":
      return <UnexpectedStage response={response} />;
    case "untapped":
      return (
        <UntappedStage
          response={response}
          draft={draft}
          onSelectBrand={onSelectBrand}
          onGoto={onGoto}
        />
      );
    case "brands":
      return (
        <BrandsStage
          response={response}
          draft={draft}
          onSelectBrand={onSelectBrand}
          shortlist={shortlist}
          onToggleShortlist={onToggleShortlist}
          onGoto={onGoto}
          visible={brandsVisible}
          onShowMore={() => setBrandsVisible((count) => count + BRAND_PAGE_SIZE)}
        />
      );
    case "brand":
      return (
        <BrandStage
          response={response}
          draft={draft}
          selectedBrandId={selectedBrandId}
          onSelectBrand={onSelectBrand}
          shortlist={shortlist}
          onToggleShortlist={onToggleShortlist}
          onGoto={onGoto}
        />
      );
    case "pitch":
      return (
        <PitchStage
          response={response}
          draft={draft}
          selectedBrandId={selectedBrandId}
          onSelectBrand={onSelectBrand}
          shortlist={shortlist}
          onToggleShortlist={onToggleShortlist}
          onGoto={onGoto}
        />
      );
    case "kit":
      return <KitStage response={response} draft={draft} shortlist={shortlist} />;
    default:
      // Unreachable while the flow routes correctly. Returning the first result
      // stage rather than `null` means a routing mistake shows something true
      // instead of a blank panel with a rail that claims to be on step six.
      return <TasteStage response={response} draft={draft} />;
  }
}

// ---------------------------------------------------------------------------
// 6. Taste DNA
// ---------------------------------------------------------------------------

function TasteStage({ response, draft }: { response: AnalyzeResponse; draft: DraftProfile }) {
  const analysis = response.analysis;
  const voice = sourceVoice(response.source);

  // §4's three bands, read off the evidence trail rather than stored a second
  // time. A theme is CORE when at least one of the results carrying it is an
  // entity the creator confirmed themselves, and ADJACENT when it reached the
  // profile only through the catalogue's expansion of those entities.
  //
  // Computed once and handed to the copy layer, so the headline and the
  // core/adjacent chips below are two readings of one classification rather
  // than two classifications that could disagree.
  //
  // Marked here because the brand results use the same two words for the same
  // distinction (§10), and a creator who has never seen "adjacent" applied to
  // their own profile has no way to read it on a brand chip. `describeCoreTaste`
  // names the contributing results but never says which side of the
  // confirmed/derived line they fall on — that is the gap this closes, and it is
  // a fact about the trail rather than a judgement about how interesting the
  // theme is.
  const bands = partitionTasteDna(analysis.tasteDna);
  const coreIds = new Set(bands.core.map((entry) => entry.id));
  const taste = describeTasteDna(analysis.tasteDna, voice, bands);

  // Two suppressions, both of which remove a claim rather than a row:
  //
  //  - `support <= 0` means no entity result counted towards this tag. The
  //    sentence `describeCoreTaste` would then read "Surfaced because 0 results
  //    … carry it", which is self-defeating on its face and implies a
  //    measurement that never happened.
  //  - A tag whose name is one of the confirmed interests is circular: the
  //    analysis restating an input as a finding. It is already on screen in the
  //    confirmed column beside this one, where it belongs.
  //
  // Everything left keeps its full evidence trail, so nothing here is dropped for
  // being weak — only for being unsupported or for repeating what the creator
  // said.
  const declaredLabels = new Set(
    analysis.tasteDna.declared.map((entry) => entry.label.trim().toLowerCase()),
  );
  const coreTastes = analysis.tasteDna.coreTastes.filter(
    (entry) => entry.support > 0 && !declaredLabels.has(entry.tag.name.trim().toLowerCase()),
  );

  return (
    <div className="cd-onboard__stage-body">
      <CreatorHeader
        displayName={draft.displayName.trim() || analysis.creatorId}
        handle={draft.handle.trim() || undefined}
        platforms={draft.platforms}
        niche={deriveNiche(draft.description) || undefined}
        // Derived, not collected: every value inside comes from an answer this draft
        // already carries. `describeContent` returns `undefined` when nothing was
        // given, and the header then renders no Content DNA line at all.
        contentDna={describeContent(draft)}
        analysis={{
          source: response.source,
          fallbackLevel: analysis.fallbackLevel,
          generatedAt: response.generatedAt,
          observations: analysis.observations,
          sealSignature: analysis.fingerprint.signature,
        }}
        degradations={response.degradations}
      />

      <FailuresPanel failures={response.failures} />
      <UnresolvedPanel analysis={analysis} />

      <InsightSection
        id="result-taste"
        index="01"
        eyebrow="Taste DNA"
        title="Your cultural position, and what it connects to"
        headingLevel={2}
        lede={taste.headline}
        // `positioning` is the whole profile as one continuous reading, built
        // clause by clause from the lists below. `summary`/`declaredLine`/
        // `discoveredLine` say the same three things in three separate
        // sentences, so they are the fallback for a profile too thin to
        // narrate — never both, because printing the same fact twice is the
        // duplicate insight this stage is meant to be free of.
        copy={
          taste.positioning !== undefined
            ? [taste.positioning]
            : [taste.summary, taste.declaredLine, taste.discoveredLine]
        }
        meta={analysis.network.meta}
        details={{
          summary: "How to read this profile",
          body: (
            <div className="cd-reading-guide">
              <p>
                Nothing here measures your audience &mdash; no analytics, no follower count, no
                engagement rate. It is a model of your cultural position, built from the interests
                you confirmed and what {voice.providerNoun} associates with them.
              </p>
              <dl className="cd-reading-guide__terms">
                <div>
                  <dt>Confirmed</dt>
                  <dd>An entity you picked in the review step. It is here because you put it here.</dd>
                </div>
                <div>
                  <dt>Derived</dt>
                  <dd>
                    Something {voice.providerNoun} associates with what you confirmed. You did not
                    name it &mdash; it is a statement about the catalogue, not about your viewers.
                  </dd>
                </div>
                <div>
                  <dt>Core and adjacent</dt>
                  <dd>
                    A theme is <em>core</em> when an entity you confirmed carries it, and <em>adjacent</em>{" "}
                    when it arrived only through {voice.providerNoun}&rsquo;s expansion of them. The
                    brand results use the same two words.
                  </dd>
                </div>
                <div>
                  <dt>Any number on this page</dt>
                  <dd>
                    Normalised within this run only &mdash; it ranks items against each other in the
                    set that came back. Not a percentage of anything, and not comparable with
                    another creator or another run.
                  </dd>
                </div>
                <div>
                  <dt>Something absent</dt>
                  <dd>
                    Left out because no evidence supported it. Not hidden behind a filter, and not
                    scored at zero — those would mean the opposite.
                  </dd>
                </div>
              </dl>
            </div>
          ),
        }}
        aside={<ConfirmedVsDerived dna={analysis.tasteDna} meta={analysis.network.meta} voice={voice} />}
      >
        {coreTastes.length > 0 ? (
          <div className="cd-taste-core">
            <p className="cd-eyebrow">Themes these results carry, and why</p>
            <ul className="cd-aside-reasons">
              {coreTastes.slice(0, 6).map((scored) => {
                const described = describeCoreTaste(scored);
                return (
                  <li key={scored.tag.id}>
                    <TasteChip
                      label={described.label}
                      role="taste"
                      provenance={scored.provenance}
                      // A tag that came back unscored still has an evidence
                      // trail, and `describeCoreTaste` prints that trail rather
                      // than a figure. Feeding a zero here would dim the chip and
                      // read as "weak affinity", which is a measurement this tag
                      // never had.
                      weight={scored.score > 0 ? scored.score : undefined}
                      count={scored.support}
                    />
                    <span className="cd-aside-reason">
                      <span
                        className={`cd-kind ${
                          coreIds.has(scored.tag.id) ? "cd-kind--direct" : "cd-kind--adjacent"
                        }`}
                      >
                        {coreIds.has(scored.tag.id) ? "core" : "adjacent"}
                      </span>{" "}
                      {described.reason}
                    </span>
                  </li>
                );
              })}
            </ul>
            {coreTastes.length > 6 ? (
              <p className="cd-aside-note">
                {coreTastes.length - 6} more {coreTastes.length - 6 === 1 ? "theme" : "themes"}{" "}
                surfaced below these six. Nothing was dropped for being weak &mdash; the list is
                capped for reading, and the full set is in the graph above.
              </p>
            ) : null}
          </div>
        ) : (
          <p className="cd-aside-note">
            No theme could be evidenced. One is shown only when a result returned for your confirmed
            interests carries it, and in this run none did &mdash; so the profile rests on the
            entities and categories themselves.
          </p>
        )}

        {taste.emergingLine ? <p className="cd-aside-note">{taste.emergingLine}</p> : null}

        <TasteDnaNetwork model={analysis.network} />
        <TasteFingerprint model={analysis.fingerprint} />
      </InsightSection>
    </div>
  );
}

/**
 * The two columns doc 02 §17 asks the UI to keep apart: what the creator said,
 * and what the catalogue added.
 *
 * Rendered as two labelled blocks rather than one mixed chip cloud. Mixed, the
 * creator cannot tell which of the twenty things on screen they are responsible
 * for — and a derived entity that looks like a confirmed one is how a taste
 * profile starts claiming interests its subject never had.
 *
 * Each block states its own empty case. "You confirmed nothing" and "nothing was
 * discovered" are different results with different fixes, and a silently empty
 * column is neither.
 */
function ConfirmedVsDerived({
  dna,
  meta,
  voice,
}: {
  dna: CreatorAnalysis["tasteDna"];
  meta: CreatorAnalysis["network"]["meta"];
  voice: ReturnType<typeof sourceVoice>;
}) {
  return (
    <div className="cd-taste-split">
      <section className="cd-taste-split__col">
        <p className="cd-eyebrow">What you confirmed</p>
        {dna.declared.length === 0 ? (
          <p className="cd-aside-note">
            Nothing. No entity was confirmed in the review step, so this profile is built from
            categories rather than work you named &mdash; which is why it reads generally.
          </p>
        ) : (
          <>
            <ul className="cd-taste-split__chips">
              {dna.declared.slice(0, 12).map((entry) => (
                <li key={entry.id}>
                  <TasteChip label={entry.label} role="taste" provenance="creator" />
                </li>
              ))}
            </ul>
            <p className="cd-aside-note">
              {dna.declared.length} {dna.declared.length === 1 ? "interest" : "interests"}, all of
              them from your own review step{dna.declared.length > 12 ? `; ${dna.declared.length - 12} more not shown` : ""}.
            </p>
          </>
        )}
      </section>

      <section className="cd-taste-split__col">
        <p className="cd-eyebrow">What {voice.providerNoun} connected it to</p>
        {dna.discovered.length === 0 ? (
          <p className="cd-aside-note">
            Nothing beyond your selections. That is a result, not a failure: the catalogue returned
            no associated entity this profile could not already account for.
          </p>
        ) : (
          <>
            <ul className="cd-taste-split__chips">
              {dna.discovered.slice(0, 12).map((entry) => (
                <li key={entry.id}>
                  <TasteChip
                    label={entry.label}
                    role="secondary"
                    provenance={meta.provenance}
                    weight={entry.weight}
                  />
                </li>
              ))}
            </ul>
            <p className="cd-aside-note">
              {dna.discovered.length} derived {dna.discovered.length === 1 ? "affinity" : "affinities"}
              {dna.discovered.length > 12 ? `, ${dna.discovered.length - 12} more not shown` : ""}. Chip
              brightness is the affinity {voice.providerNoun} returned in this run; the border style
              says where the value came from.
            </p>
          </>
        )}
      </section>
    </div>
  );
}

/**
 * Every `PipelineFailure`, listed rather than summarised.
 *
 * A pipeline that skipped a step and quietly returned the rest is indistinguishable
 * from one that completed. The failures are recoverable-or-not by flag, and the
 * distinction is shown because it is the difference between "retrying may help" and
 * "this deployment cannot do that".
 */
function FailuresPanel({ failures }: { failures: AnalyzeResponse["failures"] }) {
  if (failures.length === 0) return null;

  return (
    <div className="cd-onboard__failures" role="status">
      <h3 className="cd-onboard__subtitle">
        {failures.length} {failures.length === 1 ? "step" : "steps"} did not complete
      </h3>
      <p className="cd-onboard__hint">
        The analysis continued where it could. Nothing below was substituted for a step that failed.
      </p>
      <ul className="cd-onboard__failure-list">
        {failures.map((failure, index) => (
          <li key={`${index}|${failure.step}|${failure.code}`}>
            <code className="cd-onboard__failure-step">{failure.step}</code>
            <span className="cd-onboard__failure-message">{failure.message}</span>
            <span
              className={
                failure.recoverable
                  ? "cd-onboard__failure-flag"
                  : "cd-onboard__failure-flag cd-onboard__failure-flag--fatal"
              }
            >
              {failure.recoverable ? "Retryable" : "Not retryable"}
            </span>
            <code className="cd-onboard__failure-code">{failure.code}</code>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * What the creator wrote that is NOT driving the analysis.
 *
 * Two lists, and keeping them apart is the whole point:
 *
 *   - `unresolvedInterests` — phrases sent as interests that the server could not
 *     resolve. Doc 02 §7 requires these to be reported rather than dropped, and the
 *     report belongs at the top of the results: a creator who named six things and
 *     sees a graph built from four will otherwise assume all six counted.
 *   - `contextTerms` — phrases that were never confirmed as entities in the review
 *     stage, so they were never sent as signals at all. These are the unmatched,
 *     the rejected and the ambiguous-and-left-alone.
 *
 * Both are presented as expected outcomes with a way to fix them, not as errors.
 * Neither list is allowed to be empty-and-silent: the second one used to not exist,
 * which meant a phrase the catalogue had never heard of simply vanished between the
 * form and the results, and the only evidence that anything had been lost was that
 * the analysis looked thin.
 */
function UnresolvedPanel({ analysis }: { analysis: CreatorAnalysis }) {
  const unresolved = analysis.unresolvedInterests;
  const context = analysis.contextTerms ?? [];
  if (unresolved.length === 0 && context.length === 0) return null;

  return (
    <div className="cd-onboard__unresolved" role="status">
      {unresolved.length > 0 ? (
        <>
          <h3 className="cd-onboard__subtitle">
            {unresolved.length}{" "}
            {unresolved.length === 1 ? "phrase was" : "phrases were"} sent but not matched
          </h3>
          <p className="cd-onboard__hint">
            These contributed nothing to the graph. They are listed so you can see which of your
            inputs the analysis is built on.
          </p>
          <ul className="cd-onboard__unresolved-list">
            {unresolved.map((interest) => (
              <li key={interest.query}>
                <span className="cd-onboard__unresolved-query">&ldquo;{interest.query}&rdquo;</span>
                <span className="cd-onboard__unresolved-reason">{interest.reason}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {context.length > 0 ? (
        <>
          <h3 className="cd-onboard__subtitle">
            {context.length} {context.length === 1 ? "phrase" : "phrases"} kept as context only
          </h3>
          <p className="cd-onboard__hint">
            You never confirmed these as an entity, so they were never sent and contribute no number
            below. They are listed because you wrote them, not because the analysis used them.
            Confirm one in the review stage and re-run to change that.
          </p>
          <ul className="cd-onboard__unresolved-list">
            {context.map((term) => (
              <li key={term}>
                <span className="cd-onboard__unresolved-query">&ldquo;{term}&rdquo;</span>
                <span className="cd-onboard__unresolved-reason">Not a confirmed entity</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

/**
 * The `L4` caused by the inputs, not by the source.
 *
 * Distinct from `HardFailState`: there the signals were sent and ignored, here
 * they never existed because nothing resolved. Telling a creator in THIS state
 * "it is not a problem with the interests supplied" would send them re-running
 * inputs that can never resolve. Instead we name each unmatched subject, say
 * why, and — where the catalogue holds something close — offer it as a one-click
 * fix, so a genre-only profile is a guided recovery rather than a dead end.
 */
function NoSignalsRecovery({
  unresolved,
  onRestart,
  onResolve,
}: {
  unresolved: CreatorAnalysis["unresolvedInterests"];
  onRestart: () => void;
  onResolve?: (query: string, match: SearchMatch) => void;
}) {
  return (
    <div className="cd-onboard__unresolved" role="status">
      <h2 className="cd-onboard__title">Nothing matched the catalogue, so there is no taste to show</h2>
      <p className="cd-onboard__lede cd-measure">
        The analysis is built only from subjects the catalogue recognises. None of your inputs
        resolved to one, so nothing was personalised &mdash; and nothing was invented instead.
      </p>
      <p className="cd-onboard__warning">
        Genres and scenes (&ldquo;dream pop&rdquo;, &ldquo;classic rock&rdquo;) rarely have an entry of their own
        &mdash; the catalogue holds specific artists, albums, shows, games and books. Pick the closest
        below, or go back and add the specific works that define your taste.
      </p>
      {unresolved.length > 0 ? (
        <ul className="cd-onboard__unresolved-list">
          {unresolved.map((interest) => (
            <li key={interest.query}>
              <span className="cd-onboard__unresolved-query">&ldquo;{interest.query}&rdquo;</span>
              <span className="cd-onboard__unresolved-reason">{interest.reason}</span>
              {onResolve ? <CandidateChips query={interest.query} onResolve={onResolve} /> : null}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="cd-onboard__actions">
        <button type="button" className="cd-button cd-button--primary cd-button--sm" onClick={onRestart}>
          Edit my interests
        </button>
      </div>
    </div>
  );
}

/** Live &ldquo;did you mean&rdquo; candidates for one unmatched subject. No matches renders nothing. */
function CandidateChips({
  query,
  onResolve,
}: {
  query: string;
  onResolve: (query: string, match: SearchMatch) => void;
}) {
  const [matches, setMatches] = useState<SearchMatch[] | undefined>(undefined);

  useEffect(() => {
    let live = true;
    const params = new URLSearchParams({ q: query, take: "3" });
    fetch(`/api/qloo/search?${params.toString()}`, { headers: { Accept: "application/json" } })
      .then((response) => (response.ok ? response.json() : undefined))
      .then((body: { matches?: SearchMatch[] } | undefined) => {
        if (live) setMatches(body?.matches ?? []);
      })
      .catch(() => {
        if (live) setMatches([]);
      });
    return () => {
      live = false;
    };
  }, [query]);

  if (matches === undefined || matches.length === 0) return null;

  return (
    <span className="cd-onboard__examples">
      <span className="cd-onboard__examples-label">Did you mean</span>
      {matches.map((match) => (
        <button
          key={match.entity.id}
          type="button"
          className="cd-chip cd-chip--filter"
          onClick={() => onResolve(query, match)}
        >
          {match.entity.name}
        </button>
      ))}
    </span>
  );
}

// ---------------------------------------------------------------------------
// 7. Unexpected affinities
// ---------------------------------------------------------------------------

function UnexpectedStage({ response }: { response: AnalyzeResponse }) {
  const analysis = response.analysis;
  const voice = sourceVoice(response.source);
  // `unexpectedLine` rather than a sentence written here. It is generated from the
  // same `tasteDna` the chart below is built from, so the prose and the picture
  // cannot disagree about how many affinities there were or how strong they are.
  const taste = describeTasteDna(analysis.tasteDna, voice, partitionTasteDna(analysis.tasteDna));

  // An "unexpected affinity" is a claim that something sits outside what the
  // creator told us. Two ways that claim can be false on its face:
  //
  //  - It names something the creator DID confirm. Then it is not beyond their
  //    niche, it is their niche, and printing it here contradicts the stage above.
  //  - It carries no reason. `reasons` is the four-criteria test of doc 02 §18;
  //    an empty list means the item reached this array without passing it, and
  //    there is nothing to show the creator that would let them check it.
  //
  // Both are removed rather than softened. A weak insight with confident wording
  // is worse than no insight: the creator acts on it.
  const declaredLabels = new Set(
    analysis.tasteDna.declared.map((entry) => entry.label.trim().toLowerCase()),
  );
  const seen = new Set<string>();
  const affinities = analysis.tasteDna.unexpectedAffinities.filter((affinity) => {
    const label = affinity.label.trim().toLowerCase();
    if (label.length === 0) return false;
    if (declaredLabels.has(label)) return false;
    if (affinity.reasons.length === 0) return false;
    if (seen.has(label)) return false;
    seen.add(label);
    return true;
  });
  const suppressed = analysis.tasteDna.unexpectedAffinities.length - affinities.length;

  return (
    <div className="cd-onboard__stage-body">
      <InsightSection
        id="result-unexpected"
        index="02"
        eyebrow="Unexpected affinities"
        title="The categories you never mentioned"
        headingLevel={2}
        lede={
          <>A category culturally close to your declared interests that you never selected.</>
        }
        details={{
          summary: "How these are found",
          body: (
            <p>
              By comparing the categories the data returned against the ones you declared — a set
              difference, not a guess. A modelled taste signal, not a measurement of your audience.
            </p>
          ),
        }}
        copy={taste.unexpectedLine === undefined ? undefined : [taste.unexpectedLine]}
        meta={analysis.affinityRanking.meta}
        aside={
          <>
            <p className="cd-eyebrow">Found in your profile</p>
            {affinities.length === 0 ? (
              <p className="cd-aside-note">
                None. Every category that came back was one you had already declared — a result, not
                a failure. It means the analysis found nothing you had not told it.
              </p>
            ) : (
              <>
                <ol className="cd-aside-list">
                  {affinities.slice(0, 6).map((affinity, index) => {
                    const described = describeUnexpectedAffinity(affinity, index, voice);
                    return (
                      <li key={affinity.id}>
                        <strong>{described.heading}</strong>
                        <span>{described.body}</span>
                      </li>
                    );
                  })}
                </ol>
                {affinities.length > 6 ? (
                  <p className="cd-aside-note">
                    {affinities.length - 6} more in the ranking below.
                  </p>
                ) : null}
              </>
            )}
            {suppressed > 0 ? (
              <p className="cd-aside-note">
                {suppressed} {suppressed === 1 ? "entry was" : "entries were"} withheld: each either
                named something you already confirmed, or had no recorded reason to count as
                unexpected. Both would have been a claim you could not check.
              </p>
            ) : null}
          </>
        }
      >
        <AffinityRanking model={analysis.affinityRanking} dna={analysis.tasteDna} voice={voice} />
      </InsightSection>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 8. Untapped cultural connections
// ---------------------------------------------------------------------------

function UntappedStage({
  response,
  draft,
  onSelectBrand,
  onGoto,
}: {
  response: AnalyzeResponse;
  /** Only read to explain WHY the chart is empty — an empty coverage list and a
   *  non-matching one have different fixes, and telling them apart is the
   *  difference between actionable advice and a shrug. */
  draft: DraftProfile;
  onSelectBrand: (brandId: string) => void;
  onGoto: (stage: Stage) => void;
}) {
  const analysis = response.analysis;
  const gap = analysis.opportunityGap;
  const points = gap.points;

  return (
    <div className="cd-onboard__stage-body">
      <InsightSection
        id="result-untapped"
        index="03"
        eyebrow="Untapped cultural connections"
        title="Your cultural profile reaches further than your content does"
        headingLevel={2}
        lede={
          <>
            Cultural ground your profile reaches strongly that is not the niche you declared &mdash;
            and the brands discovered sitting on it.
          </>
        }
        details={{
          summary: "What an untapped connection is, and is not",
          body: (
            <div className="cd-reading-guide">
              <p>
                Four things hold at once: it is supported by your Taste DNA, it is not simply the
                niche you declared, there is enough evidence to name it, and it reaches at least one
                brand found in this run &mdash; the criterion that turns an observation about your
                taste into something you can act on.
              </p>
              <p>
                Coverage is declared by you, never measured from your uploads, and the affinity is a
                position within this run rather than a share of anything. No &ldquo;untapped
                potential&rdquo; percentage is printed: the gap shown is affinity against your own
                declared coverage and nothing more.
              </p>
              <p>
                Where no brand sits on a connection, that is stated rather than hidden. The ground is
                still yours to make content in; the absence is about what this run discovered, not
                about the connection being weak.
              </p>
            </div>
          ),
        }}
        copy={
          points.length === 0
            ? undefined
            : [
                // `omittedCount` is 0 for the same reason the examples page
                // passes 0: the view-model does not carry it, the generator reads
                // it only in its "nothing could be computed" branch, and this is
                // the branch where something WAS computed. A guessed count would
                // be a false claim about the creator's own answers.
                describeOpportunities(points, 0),
              ]
        }
        meta={gap.meta}
      >
        {points.length === 0 ? (
          // The most likely cause is an empty coverage declaration, and
          // `ContextStage` warns about exactly this. The empty state points back
          // at the fix rather than leaving the creator with a blank axis and no
          // idea which of their answers caused it.
          <EmptyState
            title="No opportunity gaps could be plotted"
            message={
              draft.coveredCategories.length === 0
                ? "You did not list any categories you already cover, so there is nothing to compare against. An unknown coverage is omitted rather than drawn at zero — plotting it as “no coverage” would invent an opportunity out of missing data."
                : "None of the categories that came back matched the ones you listed, so no gap could be computed between them."
            }
            hint="Add the categories you already make, then re-run. They are offered from the entity types you confirmed, so the two sides of the subtraction are comparable."
            action={
              draft.coveredCategories.length === 0 ? (
                <button
                  type="button"
                  className="cd-button cd-button--primary cd-button--sm"
                  onClick={() => onGoto("context")}
                >
                  Add what you already cover to unlock this
                </button>
              ) : (
                <button
                  type="button"
                  className="cd-button cd-button--ghost cd-button--sm"
                  onClick={() => onGoto("review")}
                >
                  Back to the entities you confirmed
                </button>
              )
            }
          />
        ) : (
          <>
            <OpportunityGap model={gap} />
            <ul className="cd-onboard__cards">
              {points.slice(0, 6).map((point) => (
                <li key={point.id}>
                  <OpportunityCard
                    point={point}
                    quadrant={quadrantOf(point.affinity, point.coverage, analysis)}
                    source={response.source}
                  />
                  <ConnectionBrands
                    point={point}
                    connected={brandsInConnection(
                      point,
                      analysis.tasteDna.categories,
                      analysis.opportunities,
                    )}
                    onOpenBrand={(brandId) => {
                      onSelectBrand(brandId);
                      onGoto("brand");
                    }}
                  />
                </li>
              ))}
            </ul>
          </>
        )}
      </InsightSection>
    </div>
  );
}

/**
 * The brands a cultural connection actually reaches.
 *
 * §11 turned "untapped" from a gap score into an Untapped Cultural Connection, and
 * the fourth criterion is the one that makes it actionable: the dimension has to
 * connect the creator to a relevant brand. Without this line the stage says "you
 * have not made content about X" and stops, which is an observation rather than an
 * opportunity — and the creator still has to go and look for themselves.
 *
 * The join is over entity ids, not labels. `brandsInConnection` matches each shared
 * dimension's `tracedTo` against the entities this category carries, so a brand is
 * listed here because a specific catalogue entity links the two. Comparing the
 * category name against a brand's category string would be the fuzzy matching §8
 * rules out, and would list brands that share a word rather than a connection.
 *
 * Rendered in both states. Zero connected brands is an honest and common outcome —
 * the dimension is supported by the taste profile but nothing discovered in this run
 * sits on it — and a silently absent block would read as a rendering bug rather than
 * as a finding.
 */
function ConnectionBrands({
  point,
  connected,
  onOpenBrand,
}: {
  point: OpportunityPoint;
  connected: readonly BrandOpportunity[];
  onOpenBrand: (brandId: string) => void;
}) {
  if (connected.length === 0) {
    return (
      <p className="cd-connection cd-connection--empty">
        No brand found in this run sits on {point.label}. Your profile supports the connection, so
        the ground is still worth making content in — there is no brand behind it to approach yet.
      </p>
    );
  }

  const shown = connected.slice(0, 4);

  return (
    <div className="cd-connection">
      <p className="cd-eyebrow">
        {connected.length} {connected.length === 1 ? "brand" : "brands"} discovered in this
        intersection
      </p>
      <ul className="cd-connection__list">
        {shown.map((opportunity) => (
          <li key={opportunity.brandId}>
            <button
              type="button"
              className="cd-connection__item"
              onClick={() => onOpenBrand(opportunity.brandId)}
            >
              {opportunity.name}
              {/* The overlap in two words, so the creator can tell before clicking
                  whether this is a direct hit or the more interesting adjacent
                  bridge — §10's distinction, at the point the decision is made. */}
              <span className="cd-connection__kind">
                {opportunity.intersection?.kind === "adjacent" ? "adjacent" : "direct"}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {connected.length > shown.length ? (
        <p className="cd-connection__more">
          and {connected.length - shown.length} more on the brand list
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 9. Brands where your taste overlaps
// ---------------------------------------------------------------------------

function BrandsStage({
  response,
  draft,
  onSelectBrand,
  shortlist,
  onToggleShortlist,
  onGoto,
  visible,
  onShowMore,
}: {
  response: AnalyzeResponse;
  /** Read ONLY for the creator's audience-context answers and the content answers
   *  `describeContent` assembles, which the "why explore this" copy may add a
   *  sentence to. Nothing here changes the ranking. */
  draft: DraftProfile;
  onSelectBrand: (brandId: string) => void;
  shortlist: readonly string[];
  onToggleShortlist: (brandId: string) => void;
  onGoto: (stage: Stage) => void;
  /** How many cards to render. Owned by `ResultStages`; see `BRAND_PAGE_SIZE`. */
  visible: number;
  onShowMore: () => void;
}) {
  const analysis = response.analysis;
  const opportunities = analysis.opportunities;
  // `undefined` when the creator answered neither question, which is also the
  // signal for every card below to render the copy it rendered before this existed.
  const audienceWords = draftAudienceWords(draft);
  // The other self-reported layer, assembled from answers this draft already holds.
  // Both are computed once here rather than inside the map below: they are the same
  // value for every card, and calling `describeContent` per card would rebuild the
  // same four arrays once per brand for no reason.
  const contentDna = describeContent(draft);
  const verified = opportunities.filter((opportunity) => opportunity.partnership.available).length;
  const shortlisted = shortlistedIn(shortlist, opportunities);

  // Slicing the ALREADY-RANKED array, so pagination shows the top of the ranking
  // first and "Show more" reveals the next ones down. Nothing is re-sorted and
  // nothing is filtered out: every brand in the run is reachable from this stage.
  const shown = opportunities.slice(0, visible);
  const hidden = opportunities.length - shown.length;

  return (
    <div className="cd-onboard__stage-body">
      <InsightSection
        id="result-brands"
        index="04"
        eyebrow="Brands where your taste overlaps"
        title="Ranked on the cultural overlap, not the order they came back"
        headingLevel={2}
        lede={
          <>
            Each brand appears beside the taste it shares with yours, and whether that overlap is
            direct or reached through an adjacent connection. Open a card for what could not be
            judged, the reason to look, and the routes in.
          </>
        }
        details={{
          summary: "Where these brands come from, and what the ranking is",
          body: (
            <div className="cd-reading-guide">
              <p>
                Candidates come from a live catalogue query built on your Taste DNA — the interests
                you confirmed, expanded through the catalogue&rsquo;s own relationships. No stored
                list: change your interests and the brands change.
              </p>
              <p>
                Being returned is not being recommended. Each candidate gets its own cultural profile
                from the data that came back with it, that profile is compared with yours, and the
                order below is led by the overlap — so a brand the query returned highly cannot
                outrank one that genuinely sits on your ground.
              </p>
              <p>
                Each figure is a weighted blend of the dimensions that could be computed for that
                brand. The cultural ones measure descriptors the catalogue actually returned for it,
                not where it sat in the candidate list — discovery position is reported separately as
                metadata, never folded into the score. A brand whose cultural dimensions could not be
                compared carries no figure at all. Nothing here is a percentage of an audience, a
                likelihood of a deal, or comparable with another analysis.
              </p>
              <p>
                A dimension that could not be computed is excluded rather than defaulted, and the
                remaining weights renormalised. A brand returned with little more than a name stays on
                the list — it is a real brand — but its ranking is halved and its own block says the
                evidence is limited.
              </p>
              <p>
                Cultural relevance is not commercial intent: nothing here says a brand runs a creator
                programme or would respond to one.
              </p>
            </div>
          ),
        }}
        meta={analysis.brandMap.meta}
      >
        {opportunities.length === 0 ? (
          <EmptyState
            title="No brand surfaced in this run"
            message="Candidates come from a live catalogue query built on your cultural profile, not a stored list. Either it returned nothing for this profile, or nothing it returned could be compared with the data available."
            hint="Broader or more numerous interests usually change this. So does declaring the categories you already cover, which feeds the opportunity-gap dimension."
          />
        ) : (
          <>
            {/* §7.1: when nothing in the list is a verified cultural match, that is
                said out loud ABOVE the cards rather than left for a creator to infer
                from a wall of identical "could not establish" labels. Only rendered
                when there is something to say — a list containing a verified overlap
                demonstrates the opposite and needs no caveat, and an empty list is
                handled by the empty state. */}
            {analysis.brandEvidenceSummary?.message ? (
              <p className="cd-onboard__warning" role="status">
                {analysis.brandEvidenceSummary.message}
              </p>
            ) : null}

            <CultureToBrandMap model={analysis.brandMap} />

            <ShortlistBar
              shortlisted={shortlisted}
              onSelectBrand={onSelectBrand}
              onGoto={onGoto}
              total={opportunities.length}
            />

            <ul className="cd-onboard__cards">
              {shown.map((opportunity) => (
                <li key={opportunity.brandId}>
                  <BrandCard
                    opportunity={opportunity}
                    source={response.source}
                    // Still passed even though `showWhy` is off below: they are the
                    // inputs the hypothesis is built from, and dropping them would
                    // silently change what this card says the moment its density is
                    // turned back up. Keeping them costs one discarded copy build.
                    audience={audienceWords}
                    contentDna={contentDna}
                    // SUMMARY DENSITY. On this list the card is a doorway, not the
                    // room: the brand's name, the taste it was verified to share
                    // with yours and in what state, the fit headline with the
                    // sentence that says what the number is, the discovery rank
                    // chip, and the shortlist control.
                    //
                    // Everything else — the identity block, the hypothesis and its
                    // evidence chain, the per-dimension breakdown, the long
                    // discovery paragraph and the partnership routes — renders on
                    // the detail stage one click away, unaltered. Nothing is
                    // removed from the product here, only from this screen, and the
                    // detail stage is where a creator is actually deciding whether
                    // to write to somebody.
                    showIdentity={false}
                    showWhy={false}
                    showPartnership={false}
                    discoveryMeaning={false}
                    // No `selected` here, and the omission is deliberate. That
                    // styling is a border plus a tint, and `.cd-brand--selected`'s
                    // own CSS comment requires selection to be "a WORD plus a
                    // border plus a tint" — the word used to be the toggle button's
                    // "Hide evidence" label, which this card no longer has. Left in,
                    // it would tint whichever brand the creator last opened, a state
                    // they did not set on this screen and nothing here names.
                    shortlisted={shortlist.includes(opportunity.brandId)}
                    onToggleShortlist={() => onToggleShortlist(opportunity.brandId)}
                    // Opens the dedicated detail view. Setting the selection first
                    // is what makes `BrandStage` render this brand instead of its
                    // chooser, so these two calls are one action and not two.
                    onOpen={() => {
                      onSelectBrand(opportunity.brandId);
                      onGoto("brand");
                    }}
                  />
                </li>
              ))}
            </ul>

            {/* Rendered whenever there is anything to page through, and kept after
                the last click so the count still says the list is complete rather
                than leaving the creator to infer it from a missing button. The
                live region is what tells a screen-reader user that "Show 6 more"
                did something; the button's own label is the other half, since it
                recounts from 6 to 0 and then leaves. */}
            {opportunities.length > BRAND_PAGE_SIZE ? (
              <div className="cd-onboard__more">
                <p className="cd-onboard__more-count" aria-live="polite">
                  Showing {shown.length} of {opportunities.length} brands, in ranked order.
                </p>
                {hidden > 0 ? (
                  <button
                    type="button"
                    className="cd-button cd-button--ghost"
                    onClick={onShowMore}
                  >
                    Show {Math.min(hidden, BRAND_PAGE_SIZE)} more
                  </button>
                ) : null}
              </div>
            ) : null}

            <p className="cd-onboard__footnote">
              Alignment is exploratory: how a brand&rsquo;s cultural profile sits against yours. The
              order above is the strength of that overlap, not a recommendation to sign with anyone.
              Partnership routes are shown only where a verified one is on file —{" "}
              {verified} of {opportunities.length} brands in this run — on each brand&rsquo;s detail
              page.
            </p>
          </>
        )}
      </InsightSection>
    </div>
  );
}

/**
 * The shortlisted brands that still exist in this run, in the order they were added.
 *
 * Filtering rather than trusting the id list: the shortlist deliberately survives a
 * re-run, and after a profile edit some of those ids may no longer be in the
 * result set. Rendering one would show a brand card with no data behind it.
 */
function shortlistedIn(
  shortlist: readonly string[],
  opportunities: readonly BrandOpportunity[],
): BrandOpportunity[] {
  const byId = new Map(opportunities.map((opportunity) => [opportunity.brandId, opportunity]));
  return shortlist.flatMap((id) => {
    const found = byId.get(id);
    return found === undefined ? [] : [found];
  });
}

/**
 * Where the shortlist goes.
 *
 * The bar renders in all three states, including the empty one, because a control
 * that only appears once it has something in it is a control the creator cannot
 * find. What changes is the wording: empty says what shortlisting is for, filled
 * says how many and offers the next step.
 */
function ShortlistBar({
  shortlisted,
  onSelectBrand,
  onGoto,
  total,
}: {
  shortlisted: readonly BrandOpportunity[];
  onSelectBrand: (brandId: string) => void;
  onGoto: (stage: Stage) => void;
  total: number;
}) {
  if (shortlisted.length === 0) {
    return (
      <div className="cd-shortlist cd-shortlist--empty">
        <p>
          Nothing shortlisted yet. Set a brand aside and the pitch stage opens on it, already
          tailored, instead of asking you to pick again out of {total}.
        </p>
      </div>
    );
  }

  return (
    <div className="cd-shortlist">
      <div className="cd-shortlist__head">
        <p className="cd-eyebrow">
          Shortlisted — {shortlisted.length} of {total}
        </p>
        <p className="cd-shortlist__note">
          Kept for this session only. Nothing is sent anywhere and nothing is shared with a brand.
        </p>
      </div>
      <ul className="cd-shortlist__list">
        {shortlisted.map((opportunity) => (
          <li key={opportunity.brandId}>
            <button
              type="button"
              className="cd-shortlist__item"
              onClick={() => {
                onSelectBrand(opportunity.brandId);
                onGoto("pitch");
              }}
            >
              {opportunity.name}
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="cd-button cd-button--primary cd-button--sm"
        onClick={() => {
          // The FIRST shortlisted brand, not the highest scoring one. Ordering by
          // score here would silently overrule the order the creator chose, and
          // the pitch stage offers a switcher for the rest.
          onSelectBrand(shortlisted[0]!.brandId);
          onGoto("pitch");
        }}
      >
        Draft a pitch for {shortlisted[0]!.name}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 10. Brand detail
// ---------------------------------------------------------------------------

function BrandStage({
  response,
  draft,
  selectedBrandId,
  onSelectBrand,
  shortlist,
  onToggleShortlist,
  onGoto,
}: {
  response: AnalyzeResponse;
  /** Read ONLY for the creator's audience-context answers and Content DNA. See
   *  `BrandsStage`. */
  draft: DraftProfile;
  selectedBrandId: string | undefined;
  onSelectBrand: (brandId: string) => void;
  shortlist: readonly string[];
  onToggleShortlist: (brandId: string) => void;
  onGoto: (stage: Stage) => void;
}) {
  const analysis = response.analysis;
  const opportunity = analysis.opportunities.find((entry) => entry.brandId === selectedBrandId);

  if (opportunity === undefined) {
    return (
      <div className="cd-onboard__stage-body">
        <BrandChooser
          analysis={analysis}
          selectedBrandId={selectedBrandId}
          onSelectBrand={onSelectBrand}
          onGoto={onGoto}
        />
      </div>
    );
  }

  const voice = sourceVoice(response.source);
  const rationale = describeBrandFit(opportunity.fit, voice);
  const why = describeBrandOpportunity(
    opportunity,
    voice,
    draftAudienceWords(draft),
    describeContent(draft),
  );
  const isShortlisted = shortlist.includes(opportunity.brandId);
  // The single-brand chain, drawn by the same chart that draws all of them. A
  // separate one-brand renderer would be a second implementation of doc 05 §10D's
  // line-style rules, and the two would drift on exactly the distinction that
  // matters most: whose reasoning a link represents.
  const singlePath =
    opportunity.pathway !== undefined
      ? { ...analysis.brandMap, pathways: [opportunity.pathway] }
      : undefined;

  return (
    <div className="cd-onboard__stage-body">
      <InsightSection
        id="result-brand"
        index="05"
        eyebrow="Brand detail"
        title={opportunity.name}
        headingLevel={2}
        lede={
          <>
            What your cultural profile and {opportunity.name}&rsquo;s were found to share, then the
            chain that got you there. The overlap first, the figure second.
          </>
        }
        copy={rationale}
        meta={opportunity.fit.meta}
        aside={
          <div className="cd-brand-why">
            <p className="cd-eyebrow">Why explore this — as a hypothesis</p>
            <p className="cd-brand-why__hypothesis">{why.hypothesis}</p>
            {why.because.length > 0 ? (
              <>
                <p className="cd-eyebrow">The evidence chain</p>
                <ul className="cd-brand-why__because">
                  {why.because.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="cd-aside-note">
                No evidence chain to show. Nothing arrived naming your interests as the reason this
                brand came back, and the dimensions below say which could not be computed. What is
                left is that {voice.providerNoun} returned this brand for your confirmed interests —
                a reason to look, not an argument.
              </p>
            )}
            {why.missing.length > 0 ? (
              <>
                <p className="cd-eyebrow">Could not be judged</p>
                <ul className="cd-brand-why__missing">
                  {why.missing.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </>
            ) : null}
            <p className="cd-aside-note">{why.caveat}</p>
          </div>
        }
      >
        {/* The intersection leads the stage, ahead of the pathway drawing and the
            fit breakdown. §9: the score may support the ranking but must not replace
            the explanation, and on the one screen where a creator decides whether to
            write to a brand, the explanation is what they need first. */}
        <SharedTaste
          brandName={opportunity.name}
          brandTaste={opportunity.brandTaste}
          intersection={opportunity.intersection}
          variant="detail"
        />

        {singlePath !== undefined ? <CultureToBrandMap model={singlePath} /> : null}

        <BrandFitBreakdown model={opportunity.fit} />

        <div className="cd-onboard__brand-card">
          <BrandCard
            opportunity={opportunity}
            source={response.source}
            showBreakdown
            // The hypothesis and the evidence chain are already in the aside at
            // full length, and the intersection is already above at its `detail`
            // density. Repeating either inside the card two screens below is the
            // duplicate insight this page is otherwise careful to avoid.
            showWhy={false}
            showSharedTaste={false}
            selected
            shortlisted={isShortlisted}
            onToggleShortlist={() => onToggleShortlist(opportunity.brandId)}
            // No `onSelect`, and it was already dead before it was removed. The
            // breakdown is rendered unconditionally by `showBreakdown` above and
            // `selected` here is the literal `true`, so the button this handler
            // produced was permanently labelled "Hide evidence", hid nothing, and
            // set `selectedBrandId` to the value it already held. A control that
            // cannot do anything is worse than no control — it is the one that
            // teaches a creator not to trust the others.
          />
        </div>

        {/* Not scored-and-renderable is a different thing from scored-and-low. A
            zero here would read as "evaluated and rejected" when in fact no
            dimension could be computed at all (doc 02 §16). */}
        {opportunity.fit.overall.renderable ? null : (
          <p className="cd-onboard__warning">{opportunity.fit.overall.disclosure}</p>
        )}

        <div className="cd-onboard__actions">
          <button
            type="button"
            className="cd-button cd-button--primary"
            onClick={() => onGoto("pitch")}
          >
            Draft an outreach message
          </button>
          <button
            type="button"
            className={`cd-button${isShortlisted ? " cd-button--primary" : " cd-button--ghost"}`}
            aria-pressed={isShortlisted}
            onClick={() => onToggleShortlist(opportunity.brandId)}
          >
            {isShortlisted ? "Shortlisted — remove" : "Add to my shortlist"}
          </button>
          <button
            type="button"
            className="cd-button cd-button--ghost"
            onClick={() => onGoto("brands")}
          >
            All brands
          </button>
        </div>
      </InsightSection>
    </div>
  );
}

/**
 * Which brand?
 *
 * Shown when the detail stage is reached with nothing selected. Auto-picking the
 * top-scoring brand would be the small-scale version of the mistake doc 02 §7
 * forbids at search: a choice made silently on the creator's behalf. It costs one
 * click to avoid, and the click is the creator saying which relationship they want
 * to look at.
 */
function BrandChooser({
  analysis,
  selectedBrandId,
  onSelectBrand,
  onGoto,
}: {
  analysis: CreatorAnalysis;
  selectedBrandId: string | undefined;
  onSelectBrand: (brandId: string) => void;
  onGoto: (stage: Stage) => void;
}) {
  if (analysis.opportunities.length === 0) {
    return (
      <EmptyState
        title="There is no brand to open"
        message="This run scored no brands, so there is no detail to show."
        action={
          <button
            type="button"
            className="cd-button cd-button--ghost cd-button--sm"
            onClick={() => onGoto("brands")}
          >
            Back to the brand list
          </button>
        }
      />
    );
  }

  return (
    <div className="cd-onboard__chooser">
      <h2 className="cd-onboard__title">Which brand do you want to open?</h2>
      <p className="cd-onboard__hint">
        {analysis.opportunities.length} scored in this run. They are listed in score order, and none
        of them is preselected.
      </p>
      <ul className="cd-onboard__chooser-list">
        {analysis.opportunities.map((opportunity) => (
          <li key={opportunity.brandId}>
            <button
              type="button"
              className="cd-onboard__chooser-button"
              aria-pressed={selectedBrandId === opportunity.brandId}
              onClick={() => onSelectBrand(opportunity.brandId)}
            >
              <span className="cd-onboard__chooser-name">{opportunity.name}</span>
              {brandCategoryLabel(opportunity.category) ? (
                <span className="cd-onboard__chooser-category">
                  {brandCategoryLabel(opportunity.category)}
                </span>
              ) : null}
              {opportunity.isUntapped ? (
                <span className="cd-onboard__chooser-flag">Untapped for you</span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 11. Pitch
// ---------------------------------------------------------------------------

function PitchStage({
  response,
  draft,
  selectedBrandId,
  onSelectBrand,
  shortlist,
  onToggleShortlist,
  onGoto,
}: {
  response: AnalyzeResponse;
  draft: DraftProfile;
  selectedBrandId: string | undefined;
  onSelectBrand: (brandId: string) => void;
  shortlist: readonly string[];
  onToggleShortlist: (brandId: string) => void;
  onGoto: (stage: Stage) => void;
}) {
  const analysis = response.analysis;
  const opportunity: BrandOpportunity | undefined = analysis.opportunities.find(
    (entry) => entry.brandId === selectedBrandId,
  );

  // The switcher lists the shortlist first and the rest after, so a creator who
  // set three brands aside is not made to find them again in a list of twelve.
  const shortlisted = shortlistedIn(shortlist, analysis.opportunities);
  const others = analysis.opportunities.filter(
    (entry) => !shortlist.includes(entry.brandId),
  );
  const switcher = [...shortlisted, ...others];

  // Details the creator supplied for the DRAFT, not for the analysis. Committed by
  // an explicit button rather than on every keystroke: rebuilding the draft
  // replaces the editor's text, and doing that while somebody is typing in the
  // letter would throw away what they had written.
  const [pending, setPending] = useState({ work: "", deliverables: "", contact: "" });
  const [supplied, setSupplied] = useState({ work: "", deliverables: "", contact: "" });

  if (opportunity === undefined) {
    return (
      <div className="cd-onboard__stage-body">
        <BrandChooser
          analysis={analysis}
          selectedBrandId={selectedBrandId}
          onSelectBrand={onSelectBrand}
          onGoto={onGoto}
        />
      </div>
    );
  }

  const voice = sourceVoice(response.source);
  const audience = describeAudience(draft);
  const isShortlisted = shortlist.includes(opportunity.brandId);

  // Built here, on the client, from values already on screen. `draftPitch` is a
  // pure function of the analysis and the creator's own words — there is no LLM in
  // it (decision D5) — so every sentence it produces is traceable to something the
  // results page already showed. A pitch that could claim more than the analysis
  // did would be the most damaging sentence this product could help write.
  const pitch = draftPitch({
    creatorName: draft.displayName.trim() || analysis.creatorId,
    handle: draft.handle.trim() || undefined,
    niche: deriveNiche(draft.description) || undefined,
    dna: analysis.tasteDna,
    brandId: opportunity.brandId,
    brandName: opportunity.name,
    brandCategory: opportunity.category,
    drivers: opportunity.drivers,
    pathway: opportunity.pathway,
    // §24: the pitch is built on the shared taste, not on "I am a creator in your
    // niche". This is the same intersection the stage above renders, so the draft
    // cannot claim ground the creator has not just read.
    intersection: opportunity.intersection,
    fit: opportunity.fit,
    isUntapped: opportunity.isUntapped,
    platforms: draft.platforms.map((platform) => PLATFORM_LABEL[platform]),
    // The ONLY audience facts in this draft, and every one of them was typed by
    // the creator into the optional context step. Nothing here is measured:
    // CreatorsDNA holds no analytics connection and no follower count. When the
    // step was skipped this is empty and the draft carries a bracket saying so,
    // which beats both silence (the brand assumes there is no audience) and a
    // number we made up (the one claim most likely to be acted on and retracted).
    audience: audience.stated ? audience.lines.map((line) => `${line.label}: ${line.value}`) : [],
    // The same answers, structured, so the body can argue from them rather than
    // reprint a bullet. Gated inside `draftPitch` on an established overlap.
    audienceContext: audience.context,
    // Content DNA: how the creator says they make things. Also gated on an
    // established overlap for the body line, and used ungated only to name the FORM
    // of a collaboration idea whose subject already came from the evidence.
    contentDna: describeContent(draft),
    previousWork: splitSupplied(supplied.work),
    deliverables: splitSupplied(supplied.deliverables),
    contact: supplied.contact.trim() || undefined,
    voice,
  });

  return (
    <div className="cd-onboard__stage-body">
      <InsightSection
        id="result-pitch"
        index="06"
        eyebrow="Pitch"
        title={`An opening message to ${opportunity.name}`}
        headingLevel={2}
        lede={
          <>Template-built from the analysis above and your own words — not generated by a language model.</>
        }
        details={{
          summary: "How the draft stays honest",
          body: (
            <div className="cd-reading-guide">
              <p>
                Every sentence traces back to a figure you can already see, or to something you
                typed. The collaboration angle is labelled as a suggestion and is built from the
                interests you confirmed — not from a library of formats.
              </p>
              <p>
                Square brackets are gaps CreatorsDNA cannot fill: audience figures, portfolio links,
                what you would make, where replies go. Fill them in or delete the line — never send a
                bracket.
              </p>
              <p>
                Edit anything. The editor re-checks your version against the same forbidden claims
                before you copy it, and appends a disclosure only if you add one.
              </p>
            </div>
          ),
        }}
        aside={
          <div className="cd-pitch-supply">
            <p className="cd-eyebrow">Fill the brackets</p>
            <p className="cd-aside-note">
              Optional, and used only in this draft. Nothing here is stored, sent, or shown to a
              brand.
            </p>
            <label className="cd-pitch-supply__field">
              <span className="cd-pitch-supply__label">Recent work — one link or title per line</span>
              {/* `cd-input` is the shared field primitive: geometry lives there so
                  these three controls cannot drift a few pixels from every other
                  text field in the product. The modifier class only shrinks them
                  for the narrow aside. */}
              <textarea
                className="cd-input cd-pitch-supply__input"
                rows={3}
                placeholder="A link or a title, one per line"
                value={pending.work}
                onChange={(event) => setPending({ ...pending, work: event.target.value })}
              />
            </label>
            <label className="cd-pitch-supply__field">
              <span className="cd-pitch-supply__label">
                What you would make — one deliverable per line
              </span>
              <textarea
                className="cd-input cd-pitch-supply__input"
                rows={3}
                placeholder="One deliverable per line"
                value={pending.deliverables}
                onChange={(event) => setPending({ ...pending, deliverables: event.target.value })}
              />
            </label>
            <label className="cd-pitch-supply__field">
              <span className="cd-pitch-supply__label">Where replies should go</span>
              <input
                className="cd-input cd-pitch-supply__input"
                type="text"
                placeholder="An email address or a handle — yours to give, never ours to guess"
                value={pending.contact}
                onChange={(event) => setPending({ ...pending, contact: event.target.value })}
              />
            </label>
            <button
              type="button"
              className="cd-button cd-button--ghost cd-button--sm"
              onClick={() => setSupplied(pending)}
              // Disabled until there is a change to apply, so the button cannot be
              // used to silently discard edits the creator has made in the letter.
              disabled={
                pending.work === supplied.work &&
                pending.deliverables === supplied.deliverables &&
                pending.contact === supplied.contact
              }
            >
              Rebuild the draft with these
            </button>
            {audience.stated ? (
              <p className="cd-aside-note">
                Your audience lines come from the context step you filled in earlier. Edit them
                there, not here — this draft only quotes them.
              </p>
            ) : null}
          </div>
        }
      >
        {switcher.length > 1 ? (
          <div className="cd-pitch-switcher">
            <p className="cd-eyebrow">Writing to</p>
            <div className="cd-pitch-switcher__options" role="group" aria-label="Choose the brand this draft is for">
              {switcher.map((entry) => (
                <button
                  key={entry.brandId}
                  type="button"
                  className="cd-pitch-switcher__option"
                  aria-pressed={entry.brandId === opportunity.brandId}
                  onClick={() => onSelectBrand(entry.brandId)}
                >
                  {entry.name}
                  {shortlist.includes(entry.brandId) ? (
                    <span className="cd-pitch-switcher__flag">shortlisted</span>
                  ) : null}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {/* Keyed on the brand AND on the supplied details, so switching either one
            rebuilds the editor from the new draft. Without the key, `useState(draft)`
            inside `PitchEditor` would keep showing the letter written for the
            previous brand — the single worst thing this stage could do. */}
        <PitchEditor
          key={`${opportunity.brandId}|${supplied.work}|${supplied.deliverables}|${supplied.contact}`}
          draft={pitch}
          brandName={opportunity.name}
          illustrativeNotice={voice.illustrativeNotice}
        />

        <div className="cd-onboard__actions">
          <button
            type="button"
            className={`cd-button${isShortlisted ? " cd-button--primary" : " cd-button--ghost"}`}
            aria-pressed={isShortlisted}
            onClick={() => onToggleShortlist(opportunity.brandId)}
          >
            {isShortlisted ? "Shortlisted — remove" : "Add to my shortlist"}
          </button>
          <button
            type="button"
            className="cd-button cd-button--ghost"
            onClick={() => onGoto("brand")}
          >
            Back to the evidence
          </button>
          <button type="button" className="cd-button cd-button--ghost" onClick={() => onGoto("kit")}>
            On to the media kit
          </button>
        </div>
      </InsightSection>
    </div>
  );
}

/**
 * Free-text input → the list the draft template expects.
 *
 * Split on newlines, commas and semicolons because people paste either a list or
 * a sentence and both should work. Empty entries are dropped rather than kept, so
 * a trailing newline does not turn into a blank bullet in the letter.
 */
function splitSupplied(value: string): string[] {
  return value
    .split(/[\n,;]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

// ---------------------------------------------------------------------------
// 12. Media kit
// ---------------------------------------------------------------------------

function KitStage({
  response,
  draft,
  shortlist,
}: {
  response: AnalyzeResponse;
  draft: DraftProfile;
  shortlist: readonly string[];
}) {
  const analysis = response.analysis;
  const audience = describeAudience(draft);
  const description = draft.description.trim();

  return (
    <div className="cd-onboard__stage-body">
      <div className="cd-onboard__kit-bar">
        <p className="cd-onboard__hint">
          One page, print-ready. It carries the same disclosures as the screen version — a kit that
          dropped them would be the one document a brand keeps.
        </p>
        <PrintButton />
      </div>

      <MediaKit
        creator={{
          displayName: draft.displayName.trim() || analysis.creatorId,
          handle: draft.handle.trim() || undefined,
          platforms: draft.platforms,
          niche: deriveNiche(draft.description) || undefined,
          description: description.length > 0 ? description : undefined,
        }}
        analysis={analysis}
        audience={audience}
        contentDna={describeContent(draft)}
        preferredBrandIds={shortlist}
      />

      {!audience.stated ? (
        <p className="cd-onboard__footnote">
          The kit has no audience section. CreatorsDNA measures no audience, and the only figures it
          can print are the ones you entered in the optional context step — which you skipped or left
          empty. Fill it in, or expect a brand to ask you directly.
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

/**
 * Quadrant label from the view-model's own quadrant table.
 *
 * `quadrantFor()` is imported rather than reimplemented: its thresholds live in
 * `src/lib/analysis/thresholds.ts` and are the same ones `isUntapped()` uses, so a
 * second copy here would eventually label a point "untapped" on the card while the
 * chart plotted it elsewhere. The lookup goes through `gap.quadrants` so the WORDS
 * come from the data too — a renamed quadrant shows up without a code change.
 */
function quadrantOf(
  affinity: number,
  coverage: number,
  analysis: CreatorAnalysis,
): { label: string; description: string } | undefined {
  const id = quadrantFor(affinity, coverage);
  return analysis.opportunityGap.quadrants.find((quadrant) => quadrant.id === id);
}
