import { archetypeProfile } from "@/lib/demo/archetypes";
import { EXAMPLE_ARCHETYPE, exampleAnalysis } from "@/lib/demo/exampleAnalysis";
import { presentExampleCreatorAnalysis } from "@/lib/demo/examplePresentation";
import { quadrantFor } from "@/lib/analysis/opportunities";
import { partitionTasteDna } from "@/lib/analysis/tasteDna";
import {
  describeOpportunities,
  describeTasteDna,
  describeUnexpectedAffinity,
  sourceVoice,
} from "@/lib/copy/generate";
import { InsightSection } from "@/components/domain/InsightSection";
import { BrandCard } from "@/components/domain/BrandCard";
import { OpportunityCard } from "@/components/domain/OpportunityCard";
import { TasteChip } from "@/components/domain/TasteChip";
import { AffinityRanking } from "@/components/viz/AffinityRanking";
import { BrandFitBreakdown } from "@/components/viz/BrandFitBreakdown";
import { CultureToBrandMap } from "@/components/viz/CultureToBrandMap";
import { OpportunityGap } from "@/components/viz/OpportunityGap";
import { TasteDnaNetwork } from "@/components/viz/TasteDnaNetwork";

import type { CreatorAnalysis } from "@/lib/contracts/viewModels";

/**
 * `/examples` — the four worked examples (doc 02 §27, doc 01 §27).
 *
 * These used to sit on the landing page between the Qloo explanation and the
 * workflow rail. They were moved here whole: the landing page argues, this page
 * shows the evidence, and a reader who wants the charts can go straight to them
 * without scrolling past four sections of prose first.
 *
 * THE EXAMPLES ARE THE REAL PRODUCT
 * --------------------------------
 * Doc 01 §27 is explicit: "Do not make fake screenshots that differ from the
 * actual product." So every section below renders the actual chart components
 * over an actual `CreatorAnalysis` produced by the actual pipeline
 * (`exampleAnalysis`). There are no images, no mock-ups and no hand-written
 * numbers. If the product changes, this page changes with it — which is the
 * point, because the alternative is a site that quietly starts advertising a
 * product nobody can use.
 *
 * All four examples come from ONE profile rather than four different ones. A
 * reader who follows the Taste DNA through to the brand overlap is following one
 * creator's reasoning; switching creators mid-page would break the chain and
 * invite the (correct) suspicion that each chart was cherry-picked.
 *
 * Doc 02 §31: desktop is primary, mobile is not an afterthought. Every layout
 * below is a single column that gains columns at a breakpoint, never the reverse.
 */

export default async function ExamplesPage() {
  const { analysis: rawAnalysis } = await exampleAnalysis();
  // Presented through the example presentation copy: the run is the real
  // pipeline's output, shown as the product's own result rather than wrapped in
  // the in-app development-data framing. See `examplePresentation.ts` for what
  // that drops and the one thing it never does (claim Qloo).
  const analysis = presentExampleCreatorAnalysis(rawAnalysis);
  const creator = archetypeProfile(EXAMPLE_ARCHETYPE);
  const voice = sourceVoice(analysis.source);
  const taste = describeTasteDna(analysis.tasteDna, voice, partitionTasteDna(analysis.tasteDna));

  return (
    <div id="examples" className="cd-examples">
      <div className="cd-container">
        <p className="cd-examples__head">
          <span className="cd-eyebrow">Example output</span>
          <h1 className="cd-examples__title">
            One creator, four results — the actual application UI, not mock-ups
          </h1>
          <span className="cd-examples__sub">
            Everything below is rendered from one profile run through the real pipeline:{" "}
            {creator.displayName} ({creator.handle}), {creator.niche}.
          </span>
        </p>
      </div>

      {/* 1. Taste DNA */}
      <section className="cd-section" aria-labelledby="taste-dna-title">
        <div className="cd-container">
          <InsightSection
            id="taste-dna"
            index="01"
            eyebrow="Taste DNA"
            title="The full graph, not a keyword list"
            headingLevel={2}
            lede={taste.headline}
            copy={[taste.summary, taste.declaredLine, taste.discoveredLine]}
            meta={analysis.network.meta}
            aside={
              <>
                <p className="cd-eyebrow">Core tastes</p>
                <ul className="cd-aside-chips">
                  {analysis.tasteDna.coreTastes.slice(0, 8).map((scored) => (
                    <li key={scored.tag.id}>
                      <TasteChip
                        label={scored.tag.name}
                        role="taste"
                        provenance={scored.provenance}
                        weight={scored.score}
                        count={scored.support}
                      />
                    </li>
                  ))}
                </ul>
                {taste.emergingLine ? <p className="cd-aside-note">{taste.emergingLine}</p> : null}
                <p className="cd-aside-note">
                  Fallback level {analysis.tasteDna.level}: {analysis.tasteDna.levelDescription}
                </p>
              </>
            }
          >
            <TasteDnaNetwork model={analysis.network} />
          </InsightSection>
        </div>
      </section>

      {/* 2. Unexpected affinity */}
      <section className="cd-section cd-section--sunken" aria-labelledby="unexpected-title">
        <div className="cd-container">
          <InsightSection
            id="unexpected"
            index="02"
            eyebrow="Unexpected affinity"
            title="The categories you never mentioned"
            headingLevel={2}
            lede={
              <>
                An unexpected affinity is a category close to your declared interests that you did
                not select. It comes from comparing what came back against what you said — a set
                difference, not a guess.
              </>
            }
            meta={analysis.affinityRanking.meta}
            aside={
              <>
                <p className="cd-eyebrow">Found in this profile</p>
                {analysis.tasteDna.unexpectedAffinities.length === 0 ? (
                  <p className="cd-aside-note">
                    None. Every returned category was already declared — which is a result, not a
                    failure.
                  </p>
                ) : (
                  <ol className="cd-aside-list">
                    {analysis.tasteDna.unexpectedAffinities.slice(0, 4).map((affinity, index) => {
                      const described = describeUnexpectedAffinity(affinity, index, voice);
                      return (
                        <li key={affinity.id}>
                          <strong>{described.heading}</strong>
                          <span>{described.body}</span>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </>
            }
          >
            {/* `dna` + `voice` turn on the "how this surfaced" column. The
                illustrative archetype has both, so the demo chart shows the same
                distinction the real one does — a page that hid the weakest class
                of row would be showing off the flattering half. */}
            <AffinityRanking
              model={analysis.affinityRanking}
              dna={analysis.tasteDna}
              voice={voice}
            />
          </InsightSection>
        </div>
      </section>

      {/* 3. Untapped cultural connections */}
      <section className="cd-section" aria-labelledby="untapped-title">
        <div className="cd-container">
          <InsightSection
            id="untapped"
            index="03"
            eyebrow="Untapped cultural connections"
            title="The taste profile reaches further than the declared niche"
            headingLevel={2}
            lede={
              <>
                Cultural ground the profile reaches strongly that is not the declared niche — and,
                in the application, the brands sitting on it. Coverage is declared by the creator,
                never measured from uploads. No &ldquo;untapped potential&rdquo; percentage is
                printed: the calculation behind one would not mean what it looks like.
              </>
            }
            copy={[
              // `omittedCount` is 0 because the view-model does not carry it:
              // categories the creator never declared a coverage answer for are
              // dropped during assembly and only counted inside the pipeline.
              // The generator uses it solely in its "nothing could be computed"
              // branch, and this section renders only when the gap IS
              // renderable, so the value cannot reach the output. Passing a
              // guess would be worse — a wrong omission count is a wrong claim
              // about the creator's own answers.
              describeOpportunities(analysis.opportunityGap.points, 0),
            ]}
            meta={analysis.opportunityGap.meta}
          >
            <OpportunityGap model={analysis.opportunityGap} />

            {analysis.opportunityGap.points.length > 0 ? (
              <ul className="cd-cards cd-cards--2">
                {analysis.opportunityGap.points.slice(0, 4).map((point) => (
                  <li key={point.id}>
                    <OpportunityCard
                      point={point}
                      quadrant={quadrantOf(point.affinity, point.coverage, analysis.opportunityGap)}
                      source={analysis.source}
                    />
                  </li>
                ))}
              </ul>
            ) : null}
          </InsightSection>
        </div>
      </section>

      {/* 4. Brands where your taste overlaps */}
      <section className="cd-section cd-section--sunken" aria-labelledby="brands-title">
        <div className="cd-container">
          <InsightSection
            id="brands"
            index="04"
            eyebrow="Brands where your taste overlaps"
            title="The overlap first, the figure second"
            headingLevel={2}
            lede={
              <>
                Candidates are discovered from the catalogue against the derived taste profile, then
                each one&rsquo;s own profile is read back and compared with the creator&rsquo;s.
                What the two share is what ranks them — a brand the query returned highly cannot
                outrank one that genuinely sits on the creator&rsquo;s ground. And no score appears
                alone: every figure comes with the dimensions behind it, their weights, and the
                dimensions that could not be computed.
              </>
            }
            meta={analysis.brandMap.meta}
          >
            <CultureToBrandMap model={analysis.brandMap} />

            {analysis.opportunities.length > 0 ? (
              <ul className="cd-cards cd-cards--2">
                {analysis.opportunities.slice(0, 4).map((opportunity) => (
                  <li key={opportunity.brandId}>
                    <BrandCard
                      opportunity={opportunity}
                      source={analysis.source}
                      showBreakdown
                      // The section lede above already makes the
                      // discovery-is-not-fit distinction in words, and this is a
                      // two-column demo grid where a fourth block on every card
                      // would push the overlap below the fold.
                      showDiscovery={false}
                    />
                  </li>
                ))}
              </ul>
            ) : null}

            {analysis.brandFits[0] ? <BrandFitBreakdown model={analysis.brandFits[0]} /> : null}

            <p className="cd-examples__footnote">
              Alignment is exploratory: the order above is the strength of that overlap, not a
              recommendation to sign with anyone. Partnership routes appear only where a verified
              one is on file —{" "}
              {analysis.opportunities.filter((o) => o.partnership.available).length} of{" "}
              {analysis.opportunities.length} brands in this run.
            </p>
          </InsightSection>
        </div>
      </section>
    </div>
  );
}

/**
 * Resolve a point's quadrant through the view-model's own quadrant list.
 *
 * `quadrantFor()` gives the id; the LABEL and DESCRIPTION come from
 * `analysis.opportunityGap.quadrants` rather than from `OPPORTUNITY_QUADRANTS`,
 * so the card and the scatter plot cannot describe the same quadrant in
 * different words. Returns `undefined` when the id is not in the model, which
 * `OpportunityCard` already handles by omitting the quadrant line — inventing a
 * label there would be worse than showing none.
 */
function quadrantOf(
  affinity: number,
  coverage: number,
  gap: CreatorAnalysis["opportunityGap"],
): { label: string; description: string } | undefined {
  const id = quadrantFor(affinity, coverage);
  return gap.quadrants.find((quadrant) => quadrant.id === id);
}
