import Link from "next/link";

import { archetypeProfile } from "@/lib/demo/archetypes";
import { EXAMPLE_ARCHETYPE, exampleAnalysis } from "@/lib/demo/exampleAnalysis";
import { presentExampleCreatorAnalysis } from "@/lib/demo/examplePresentation";
import { InsightSection } from "@/components/domain/InsightSection";
import { ProgressTracker } from "@/components/domain/ProgressStep";
import { HeroComposition } from "@/components/site/HeroComposition";
import { HeroShapes } from "@/components/site/HeroShapes";
import { HERO_SHAPE_LIMIT, heroShapeInputs, heroShapeLayout } from "@/components/site/heroLayout";

/**
 * The public website (doc 02 §26–§27, doc 01 §23–§28).
 *
 * EIGHT BLOCKS, IN THE ORDER DOC 02 §27 ARGUES THEM. The order is not
 * decorative: it is the argument. Hero → problem → why the existing answer is
 * incomplete → how this one works → what powers it → workflow → roadmap → CTA.
 * Moving the Qloo explanation after the worked examples, for instance, would ask
 * a reader to accept four charts before telling them where the numbers came
 * from.
 *
 * THE FOUR WORKED EXAMPLES LIVE ON `/examples`
 * --------------------------------------------
 * They used to sit between the Qloo explanation and the workflow rail. Doc 01
 * §27 is explicit that they must be the real product — "Do not make fake
 * screenshots that differ from the actual product" — and they still are; they
 * are simply on their own page now, so this one can argue and that one can show
 * the evidence. `src/app/examples/page.tsx` carries the same rule: every chart
 * there is the actual component over an actual `CreatorAnalysis` produced by
 * `exampleAnalysis()`, and all four come from ONE profile so a reader following
 * the Taste DNA through to the brand overlap is following one creator's
 * reasoning rather than four cherry-picked results.
 *
 * Doc 02 §31: desktop is primary, mobile is not an afterthought. Every layout
 * below is a single column that gains columns at a breakpoint, never the reverse.
 */

export default async function HomePage() {
  const { analysis: rawAnalysis } = await exampleAnalysis();
  // Presented through the example presentation copy, so the hero source chip and
  // the provenance styling read as the product's own output rather than wrapped
  // in the in-app development-data framing. See `examplePresentation.ts`.
  const analysis = presentExampleCreatorAnalysis(rawAnalysis);
  const creator = archetypeProfile(EXAMPLE_ARCHETYPE);

  // Laid out here rather than in the client so the composition is part of the
  // server render and the boundary only carries primitives. The desktop limit is
  // used unconditionally: `HeroShapes` hides the tail on coarse pointers and
  // narrow viewports, so one list serves both and the reduced field is always a
  // prefix of the full one. See `HERO_SHAPE_LIMIT_COARSE`.
  const heroField = heroShapeLayout(
    heroShapeInputs(analysis.network.nodes, HERO_SHAPE_LIMIT),
  );

  return (
    <>
      {/* ------------------------------------------------------------------ */}
      {/* 1. Hero — doc 01 §24                                                */}
      {/* ------------------------------------------------------------------ */}
      <section className="cd-section cd-hero" aria-labelledby="hero-title">
        {/* Doc 05 §4: the 3D composition extends behind the typography. It is the
            identity layer; `HeroComposition` below is the evidence layer, and both
            are drawn from the same analysis. Decorative and `aria-hidden`. */}
        <HeroShapes placements={heroField} />

        <div className="cd-container cd-hero__inner">
          <div className="cd-hero__copy">
            <p className="cd-hero__eyebrow cd-eyebrow">Cultural intelligence for creators</p>

            {/* One beat plain, one beat emphasised: the split is what the type
                scale is laid out around, so the sentence keeps two halves. */}
            <h1 id="hero-title" className="cd-hero__title">
              Find the brands{" "}
              <span className="cd-hero__title-em">that share your taste.</span>
            </h1>

            <p className="cd-hero__lede cd-measure">
              CreatorsDNA maps creator and brand taste to uncover the cultural intersections
              that make partnerships meaningful.
            </p>

            <div className="cd-hero__actions">
              {/* Doc 01 §29: no login, no signup, straight into the application. */}
              <Link href="/analyze" className="cd-button cd-button--primary cd-button--lg">
                Discover my Taste DNA
              </Link>
              <a href="#how" className="cd-button cd-button--ghost cd-button--lg">
                See how it works
              </a>
            </div>

          </div>

          <HeroComposition analysis={analysis} creatorName={creator.displayName} />
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* 2. Problem — doc 01 §25                                             */}
      {/* ------------------------------------------------------------------ */}
      <section className="cd-section" aria-labelledby="problem-title">
        <div className="cd-container">
          <InsightSection
            id="problem"
            index="01"
            title="Your taste reaches further than what you named"
            headingLevel={2}
            lede={
              <>
                A creator confirms a few interests. The cultural graph reveals the wider set of
                affinities connected to them — evidence CreatorsDNA later compares against a
                brand&rsquo;s own taste to look for overlap.
              </>
            }
          >
            <div className="cd-split">
              <div className="cd-split__col cd-split__col--declared">
                <p className="cd-split__head cd-eyebrow">What the creator declares</p>
                <ul className="cd-split__list">
                  {analysis.tasteDna.declared.map((entry) => (
                    <li key={entry.id} className="cd-split__item">
                      {entry.label}
                    </li>
                  ))}
                </ul>
                <p className="cd-split__caption">
                  Confirmed during onboarding. This is the entire input.
                </p>
              </div>

              <p className="cd-split__arrow" aria-hidden="true">
                →
              </p>

              <div className="cd-split__col cd-split__col--discovered">
                <p className="cd-split__head cd-eyebrow">What the cultural graph reveals</p>
                <ul className="cd-split__list">
                  {analysis.tasteDna.discovered.slice(0, 8).map((entry) => (
                    <li key={entry.id} className="cd-split__item cd-split__item--discovered">
                      {entry.label}
                    </li>
                  ))}
                </ul>
                <p className="cd-split__caption">
                  Related affinities connected to those interests — modelled from this result set,
                  not a percentage of any audience.
                </p>
              </div>
            </div>

            <p className="cd-punchline">
              {creator.displayName} declared {listOrNothing(analysis.tasteDna.declared.map((d) => d.label))}. The
              cultural graph connects those to {listOrNothing(analysis.tasteDna.discovered.slice(0, 5).map((d) => d.label))}.{" "}
              <strong>This wider picture is the first step toward a creator&ndash;brand cultural intersection.</strong>
            </p>
          </InsightSection>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* 3. Why traditional matching is incomplete — doc 01 §28               */}
      {/* ------------------------------------------------------------------ */}
      <section className="cd-section cd-section--sunken" aria-labelledby="different-title">
        <div className="cd-container">
          <InsightSection
            id="different"
            index="02"
            eyebrow="Why existing tools fall short"
            title="They measure reach. We look for cultural fit."
            headingLevel={2}
            lede={
              <>
                Follower counts, engagement and demographics help describe an audience. They
                don&rsquo;t necessarily reveal the cultural overlap between a creator and a brand.
              </>
            }
          >
            {/* Doc 01 §28's comparison, transcribed. A table rather than five
                cards: doc 02 §29 puts "generic three-card sections" on the avoid
                list, and a side-by-side comparison is a table's job. */}
            <table className="cd-table cd-compare">
              <caption className="cd-sr-only">
                Traditional creator tools compared with CreatorsDNA
              </caption>
              <thead>
                <tr>
                  <th scope="col">Traditional creator tools</th>
                  <th scope="col">CreatorsDNA</th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON.map((row) => (
                  <tr key={row.traditional}>
                    <th scope="row">{row.traditional}</th>
                    <td>{row.ours}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <p className="cd-compare__note">
              Traditional tools help measure who a creator can reach. CreatorsDNA explores what a
              creator and a brand have in common culturally.
            </p>
          </InsightSection>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* 4. How CreatorsDNA works                                            */}
      {/* ------------------------------------------------------------------ */}
      <section className="cd-section" aria-labelledby="how-title">
        <div className="cd-container">
          <InsightSection
            id="how"
            index="03"
            eyebrow="How it works"
            title="From creator taste to brand connection."
            headingLevel={2}
            lede={
              <>
                CreatorsDNA maps two cultural profiles, finds their intersection, and uses that
                evidence to surface potential partnership opportunities.
              </>
            }
          >
            <ol className="cd-stages">
              {STAGES.map((stage, index) => (
                <li key={stage.title} className="cd-stage">
                  <span className="cd-stage__index cd-tabular" aria-hidden="true">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div className="cd-stage__body">
                    <h3 className="cd-stage__title">{stage.title}</h3>
                    <p className="cd-stage__text">{stage.text}</p>
                  </div>
                </li>
              ))}
            </ol>

            <p className="cd-punchline">
              <strong>The overlap is the starting point. The opportunity is what creators can explore from it.</strong>
            </p>
          </InsightSection>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* 5. Qloo explanation — doc 01 §26                                    */}
      {/* ------------------------------------------------------------------ */}
      <section className="cd-section cd-section--sunken" aria-labelledby="qloo-title">
        <div className="cd-container">
          <InsightSection
            id="qloo"
            index="04"
            eyebrow="Powered by Qloo"
            title="Qloo maps cultural taste. CreatorsDNA connects the dots."
            headingLevel={2}
            lede={
              <>
                Qloo provides cultural intelligence by revealing relationships between interests
                and entities. CreatorsDNA uses that intelligence to build creator and brand taste
                profiles, compare their cultural evidence, and identify potential intersections.
              </>
            }
          >
            {/* Doc 01 §26's flow, in product language. Written as a chain rather
                than a diagram because the chain has to be readable by a screen
                reader and the words carry the meaning. */}
            <ol className="cd-flow">
              {QLOO_FLOW.map((step) => (
                <li key={step.label} className="cd-flow__step">
                  <span className="cd-flow__label">{step.label}</span>
                  <span className="cd-flow__text">{step.text}</span>
                </li>
              ))}
            </ol>

            <p className="cd-qloo__example">
              <strong>
                Qloo provides the cultural intelligence.
                <br />
                CreatorsDNA turns it into creator&ndash;brand connections.
              </strong>
            </p>

            <div className="cd-datasource cd-datasource--synthetic" role="note">
              <span className="cd-datasource__label">Synthetic example data</span>
              <span className="cd-datasource__body">
                The examples on this page use a fixed development dataset. They illustrate how
                CreatorsDNA works and are not live Qloo discoveries. Run an analysis to see
                retrieved results.
              </span>
            </div>
          </InsightSection>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* 5. Product workflow — doc 02 §28                                    */}
      {/* ------------------------------------------------------------------ */}
      <section className="cd-section" aria-labelledby="workflow-title">
        <div className="cd-container">
          <InsightSection
            id="workflow"
            index="05"
            eyebrow="Product workflow"
            title="From your interests to potential brand matches."
            headingLevel={2}
            lede={
              <>
                Explore the full journey, from confirming your interests to reviewing cultural
                affinities, brand intersections and potential partnership opportunities.
              </>
            }
          >
            <ProgressTracker steps={FLOW_STEPS} ariaLabel="Application flow" />
          </InsightSection>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* 6. Roadmap — doc 01 §34/§35                                        */}
      {/* ------------------------------------------------------------------ */}
      <section className="cd-section cd-section--sunken" aria-labelledby="moat-title">
        <div className="cd-container">
          <InsightSection
            id="moat"
            index="06"
            eyebrow="Roadmap"
            title="Finding a match is the beginning."
            headingLevel={2}
            lede={
              <>
                CreatorsDNA can identify potential cultural connections today. The longer-term
                opportunity is to learn which connections lead to real partnerships, with creator
                participation and verified outcomes.
              </>
            }
          >
            <ol className="cd-flow cd-flow--chain" aria-label="The outcome loop">
              {MOAT_CHAIN.map((link) => (
                <li key={link} className="cd-flow__step cd-flow__step--chain">
                  <span className="cd-flow__label">{link}</span>
                </li>
              ))}
            </ol>

            <ul className="cd-layers">
              {MOAT_LAYERS.map((layer) => (
                <li key={layer.title} className="cd-layer">
                  <h3 className="cd-layer__title">{layer.title}</h3>
                  <p className="cd-layer__text">{layer.text}</p>
                </li>
              ))}
            </ul>
          </InsightSection>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* 7. CTA — doc 01 §29                                                */}
      {/* ------------------------------------------------------------------ */}
      <section className="cd-section cd-cta" id="cta" aria-labelledby="cta-title">
        <div className="cd-container cd-cta__inner">
          <h2 id="cta-title" className="cd-cta__title">
            Discover where your taste connects.
          </h2>
          <p className="cd-cta__text">
            Map your cultural world, explore brand taste, and discover the intersections that
            could lead to your next partnership.
          </p>
          <div className="cd-cta__actions">
            <Link href="/analyze" className="cd-button cd-button--accent cd-button--lg">
              Map my taste DNA
            </Link>
            <Link href="/methodology" className="cd-button cd-button--ghost cd-button--lg">
              Read the methodology
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------
// Section content
// ---------------------------------------------------------------------------

/**
 * Doc 01 §28's comparison, in the vocabulary the product now uses: the left column
 * is what traditional tools measure, the right is what CreatorsDNA builds toward.
 * Order matters — it moves from the crudest reach measure to the specific
 * creator–brand output.
 */
const COMPARISON = [
  { traditional: "Follower count", ours: "Creator Taste DNA" },
  { traditional: "Engagement rate", ours: "Cultural affinities" },
  { traditional: "Audience demographics", ours: "Brand Taste DNA" },
  { traditional: "Content niche", ours: "Cultural intersection" },
  { traditional: "Keyword matching", ours: "Potential partnership opportunities" },
] as const;

const STAGES = [
  {
    title: "Map creator taste",
    text: "Creators confirm the interests that represent them. CreatorsDNA uses those signals to map the wider cultural world connected to their taste.",
  },
  {
    title: "Build Creator Taste DNA",
    text: "Qloo's cultural intelligence reveals related interests and affinities. CreatorsDNA organises the available evidence into a structured picture of the creator's cultural world.",
  },
  {
    title: "Map Brand Taste DNA",
    text: "CreatorsDNA examines the cultural evidence available for brands to build a comparable picture of their cultural associations.",
  },
  {
    title: "Find the intersection",
    text: "We compare Creator Taste DNA with Brand Taste DNA to identify the cultural overlap that can inform a potential partnership.",
  },
] as const;

/** Doc 01 §26's chain, in product language rather than API language. */
const QLOO_FLOW = [
  { label: "Creator Taste", text: "Start with the creator's confirmed interests." },
  { label: "Cultural Intelligence", text: "Use Qloo to discover related cultural entities and affinities." },
  { label: "Taste DNA", text: "Organise the available evidence into a creator taste profile." },
  { label: "Brand Taste", text: "Build a brand taste profile from available cultural evidence." },
  { label: "The Intersection", text: "Compare the two profiles to find supported cultural overlap." },
] as const;

/**
 * Doc 02 §28's twelve-step flow, all shown complete.
 *
 * The same twelve stages the analyze flow's rail shows, but described rather than
 * addressed: the rail says "Tell us about your work" where this says "Creator
 * profile", because a visitor reading the landing page is not yet inside the flow.
 * That rewording applies only to the four capture stages. The result stages carry no
 * instruction to rephrase, so they use the rail's exact words — the labels stay in
 * step with `STAGE_LABEL` in `analyze/flowTypes.ts`, because the rail renders the
 * real application flow.
 */
const FLOW_STEPS = [
  { label: "Welcome", status: "complete" as const },
  { label: "Creator profile", status: "complete" as const },
  { label: "Select interests", status: "complete" as const, hint: "Search and disambiguate" },
  { label: "Audience signals", status: "complete" as const, optional: true, hint: "Never mandatory" },
  { label: "Analyze", status: "complete" as const },
  { label: "Taste DNA", status: "complete" as const },
  { label: "Unexpected affinities", status: "complete" as const },
  { label: "Untapped connections", status: "complete" as const },
  { label: "Brands you overlap with", status: "complete" as const },
  { label: "Brand detail", status: "complete" as const },
  { label: "Pitch", status: "complete" as const, hint: "Template-generated, editable" },
  { label: "Media kit", status: "complete" as const, hint: "Printable, disclosure included" },
] as const;

const MOAT_CHAIN = ["Taste", "Opportunity", "Action", "Outcome"] as const;

const MOAT_LAYERS = [
  {
    title: "Taste DNA profiles",
    text: "A structured, versioned taste graph per creator rather than a self-described niche.",
  },
  {
    title: "Cultural relationship modelling",
    text: "How declared interests map onto returned categories, accumulated across every run.",
  },
  {
    title: "Opportunity detection",
    text: "Which affinities recur as untapped for which kinds of creator.",
  },
  {
    title: "Creator opportunity history",
    text: "What one creator was shown, acted on and declined.",
  },
  {
    title: "Partnership outcomes",
    text: "Contacted, replied, met, signed, campaigned — the half that does not exist yet.",
  },
  {
    title: "Taste-to-brand conversion",
    text: "Which taste signals predict a signed partnership rather than a plausible one.",
  },
  {
    title: "Opt-in creator network",
    text: "Creators who chose to be discoverable on taste, not follower count.",
  },
  {
    title: "Brand-side discovery",
    text: "The same infrastructure, queried the other way: which creators fit this brand.",
  },
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Join labels the way the copy layer does, with an explicit word for the empty
 * case. An empty list rendering as a blank gap in a sentence is how a marketing
 * page ends up reading "The data came back with ." — technically correct, and
 * obviously broken to anyone who sees it.
 */
function listOrNothing(labels: readonly string[]): string {
  if (labels.length === 0) return "nothing";
  if (labels.length === 1) return labels[0]!;
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}
