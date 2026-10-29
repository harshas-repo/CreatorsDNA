import type { AudienceWords, ContentDna, ContentPlatform } from "@/lib/contracts/creator";
import { PLATFORM_LABEL } from "@/lib/contracts/creator";
import type { BrandOpportunity, CreatorAnalysis } from "@/lib/contracts/viewModels";
import { FALLBACK_DESCRIPTIONS } from "@/lib/contracts/viewModels";
import { categoryLabel } from "@/lib/analysis/categoryLabels";
import { partitionTasteDna } from "@/lib/analysis/tasteDna";
import {
  brandCategoryLabel,
  classifyAffinity,
  describeBrandFitForKit,
  describeTasteDna,
  fitHeadline,
  sourceVoice,
  strengthWord,
} from "@/lib/copy/generate";
import { TasteSeal } from "@/components/shapes/TasteSeal";
import { AffinityBar } from "@/components/domain/AffinityBar";
import { ScoreBreakdown } from "@/components/domain/ScoreBreakdown";
import { TasteChip } from "@/components/domain/TasteChip";
import { ProvenanceKey } from "@/components/ui/Provenance";
import { EmptyState, HardFailState } from "@/components/ui/States";
import { PrintButton } from "@/components/domain/PrintButton";

/**
 * `MediaKit` (doc 02 §30) — the one-page document a creator sends to a brand.
 *
 * A Server Component. The only interactive element is `PrintButton`, which lives
 * in its own client module so the rest of the document is not shipped as
 * JavaScript as well as HTML.
 *
 * A DOCUMENT, NOT A DASHBOARD
 * --------------------------
 * It is read top to bottom by someone deciding whether to reply to an email, so
 * the sections are ordered as an argument rather than as panels: who this is →
 * what they confirmed → where the catalogue places that → what is close to it →
 * what they have not made yet → which brands share that ground → who they are. A
 * grid of equal-weight cards would make every section look optional, and the
 * reader would skim all of them.
 *
 * THREE THINGS SHAPE IT
 * ---------------------
 * **The disclosure prints.** This is the one document in the product designed to
 * leave our control — it gets attached to an email and forwarded. Print
 * stylesheets conventionally strip toolbars, badges and banners, so if the
 * data-source note lived in chrome it would vanish at exactly the moment it
 * matters. It is therefore part of the content flow and explicitly kept by the
 * `@media print` rules.
 *
 * **The copy is re-voiced, not reused.** `describeOpportunityPoint()` and
 * `describeBrandOpportunity()` address the creator as "you". In a document a brand
 * reads, that sentence would accuse the reader of something they did not do. The
 * brand notes below come from `describeBrandFitForKit()` — a third-person builder
 * over the same evidence fields — and the white-space lines are written in the
 * third person too, with the shared vocabulary (`strengthWord`) reused so the
 * wording stays consistent with the rest of the product.
 *
 * **L4 refuses to render.** Doc 04 §4.5 makes a hard failure non-negotiable, and
 * a media kit is the worst possible place to discover an exception to it: the
 * output would be generic content presented as a personalised profile, in a
 * document someone is using to win a contract.
 *
 * WHAT IT WILL NOT CONTAIN
 * ------------------------
 * No audience size, no engagement rate, no follower count, no campaign result. The
 * audience section renders only what the creator typed into the optional context
 * step, labelled as theirs; when they typed nothing the section is omitted rather
 * than shown empty, because an empty audience table in a document a brand reads
 * says "no audience" when the truth is "not measured here".
 */

export interface MediaKitCreator {
  displayName: string;
  handle?: string;
  platforms?: readonly ContentPlatform[];
  /** The first sentence of what the creator wrote, quoted as theirs. */
  niche?: string;
  /**
   * The creator's own description of their work, in full.
   *
   * Quoted verbatim and attributed. It is the one paragraph in this document that
   * nobody but the creator wrote, and it is what makes the rest of the profile
   * legible to a reader who has never seen their channel.
   */
  description?: string;
}

/**
 * Audience facts the creator supplied themselves.
 *
 * Every value is a string the creator typed. Nothing here is measured: CreatorsDNA
 * holds no analytics connection, so there is no other source it could come from.
 */
export interface MediaKitAudience {
  /** False when the context step was skipped or left empty. */
  stated: boolean;
  lines: Array<{ label: string; value: string }>;
  /**
   * The audience-context answers in structured form, for the brand notes below.
   *
   * `lines` is already-rendered display text and the notes have to compose a
   * sentence, so they get the same answers split into groups and purposes instead.
   * Optional because a caller that only has the lines still produces a complete
   * kit — the notes then simply omit the audience sentence, which is what they did
   * before this existed.
   */
  context?: AudienceWords;
}

export interface MediaKitLimits {
  affinities?: number;
  categories?: number;
  opportunities?: number;
  brands?: number;
}

export interface MediaKitProps {
  creator: MediaKitCreator;
  analysis: CreatorAnalysis;
  /** Absent, or `stated: false`, means the audience section is not rendered at all. */
  audience?: MediaKitAudience;
  /**
   * The creator's Content DNA — how they say they express themselves.
   *
   * Rendered as its `positioning` summary and passed to the brand notes, which quote
   * it only where the evidence already established an overlap. Absent means the
   * section is not rendered and the notes read as they did before this prop existed.
   *
   * It gets its own section rather than joining the audience one, even though both are
   * "as stated by the creator": one describes the maker and the other describes the
   * people they intend to reach, and folding them under a single heading would make a
   * document a brand forwards look as though the product had measured an audience out
   * of a format choice. §2 asks for the layers kept distinct, and in a kit the
   * heading is what keeps them distinct.
   */
  contentDna?: ContentDna;
  /**
   * Brand ids the creator shortlisted. These lead the alignment section, in the
   * order they were added, because a creator who set three brands aside is telling
   * us which three they intend to approach.
   */
  preferredBrandIds?: readonly string[];
  /** Caps per list. A kit that runs to four pages is not a kit. */
  limits?: MediaKitLimits;
  className?: string;
}

const DEFAULT_LIMITS: Required<MediaKitLimits> = {
  affinities: 6,
  categories: 6,
  opportunities: 4,
  brands: 3,
};

export function MediaKit({
  creator,
  analysis,
  audience,
  contentDna,
  preferredBrandIds,
  limits,
  className,
}: MediaKitProps) {
  const cap = { ...DEFAULT_LIMITS, ...limits };
  const voice = sourceVoice(analysis.source);

  if (analysis.fallbackLevel === "L4") {
    return (
      <HardFailState
        reasons={[
          FALLBACK_DESCRIPTIONS.L4,
          "A media kit cannot be produced from this analysis, because everything in it would be generic output presented as a personalised profile.",
        ]}
        className={className}
      />
    );
  }

  const taste = describeTasteDna(analysis.tasteDna, voice, partitionTasteDna(analysis.tasteDna));
  const declared = analysis.tasteDna.declared;
  const affinities = analysis.affinityRanking.items.slice(0, cap.affinities);
  const categories = analysis.tasteDna.categories.slice(0, cap.categories);
  const opportunities = analysis.opportunityGap.points.slice(0, cap.opportunities);
  const brands = selectBrands(analysis.opportunities, preferredBrandIds ?? [], cap.brands);
  const description = creator.description?.trim();

  return (
    <article className={`cd-kit${className ? ` ${className}` : ""}`}>
      {/* Screen-only. `@media print` hides it, so the button never appears in
          the PDF the brand receives. */}
      <div className="cd-kit__toolbar">
        <PrintButton />
        <p className="cd-kit__toolbar-note">
          The saved PDF keeps the data-source disclosure and the methodology notes. It does
          not keep this toolbar.
        </p>
      </div>

      <header className="cd-kit__header">
        <TasteSeal signature={analysis.fingerprint.signature} size={92} showHash={false} />

        <div className="cd-kit__identity">
          <h1 className="cd-kit__name">{creator.displayName}</h1>
          {creator.handle ? <p className="cd-kit__handle">@{creator.handle}</p> : null}
          {creator.platforms && creator.platforms.length > 0 ? (
            <p className="cd-kit__platforms">
              {creator.platforms.map((platform) => PLATFORM_LABEL[platform]).join(" · ")}
            </p>
          ) : null}
          {creator.niche ? <p className="cd-kit__niche">{creator.niche}</p> : null}
        </div>

        <p className="cd-kit__source">
          <span className="cd-datasource__label">{analysis.source.label}</span>
          <span>Profile generated {analysis.generatedAt.slice(0, 10)}.</span>
        </p>
      </header>

      {description !== undefined && description.length > 0 ? (
        <blockquote className="cd-kit__quote">
          <p>{description}</p>
          <footer>
            — {creator.displayName}, in their own words. Quoted, not paraphrased.
          </footer>
        </blockquote>
      ) : null}

      {/* ---------------------------------------------------------------- */}
      <section className="cd-kit__section">
        <h2 className="cd-kit__section-title">Where this profile sits</h2>
        <p className="cd-kit__lede">{taste.headline}</p>
        {taste.positioning !== undefined ? (
          <p>{taste.positioning}</p>
        ) : (
          <p>{taste.summary}</p>
        )}
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className="cd-kit__section">
        <h2 className="cd-kit__section-title">Confirmed cultural interests</h2>
        <p>
          {declared.length === 0
            ? "No individual entity was confirmed for this profile, so what follows rests on categories rather than on named work."
            : `These ${declared.length} ${declared.length === 1 ? "interest was" : "interests were"} selected and confirmed by ${creator.displayName} directly. Everything else in this document is derived from them.`}
        </p>

        {declared.length > 0 ? (
          <ul className="cd-kit__chips">
            {declared.map((entry) => (
              <li key={entry.id}>
                <TasteChip label={entry.label} role="taste" provenance="creator" />
              </li>
            ))}
          </ul>
        ) : null}

        {categories.length > 0 ? (
          <table className="cd-kit__table">
            <caption className="cd-sr-only">
              Cultural categories this profile was placed in, with the entities that support each
            </caption>
            <thead>
              <tr>
                <th scope="col">Category</th>
                <th scope="col">Strength within this run</th>
                <th scope="col">Supporting entities</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((category) => (
                <tr key={category.id}>
                  <th scope="row">{category.label}</th>
                  <td>{strengthWord(category.score)}</td>
                  <td>
                    {category.entities.length === 0
                      ? "—"
                      : category.entities
                          .slice(0, 3)
                          .map((entity) => entity.name)
                          .join(", ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className="cd-kit__section">
        <h2 className="cd-kit__section-title">Strongest cultural affinities</h2>
        <p className="cd-kit__basis">
          {analysis.affinityRanking.normalisation === "declared" ? (
            <>
              Every value here is an interest the creator confirmed themselves, carried at full
              weight across {analysis.affinityRanking.setSize} results. Nothing was ranked against
              anything, so the equal lengths are not a measurement.
            </>
          ) : (
            <>
              Each value is normalised within this profile&apos;s own result set —{" "}
              {analysis.affinityRanking.setSize} results,{" "}
              {analysis.affinityRanking.normalisation === "rank"
                ? "compared by position, so the magnitudes carry no meaning of their own"
                : analysis.affinityRanking.normalisation === "minmax"
                  ? "compared by score"
                  : "no usable affinity was returned, so nothing is ranked"}
              .
            </>
          )}{" "}
          None of these figures is a percentage of any audience, and none was measured from
          followers. The word at the end of each row says how it surfaced.
        </p>

        {affinities.length === 0 ? (
          <EmptyState
            title="No affinities to show"
            message="The data source returned no scored results for this profile."
            hint="Nothing has been substituted for the missing values."
          />
        ) : (
          <ul className="cd-kit__bars">
            {affinities.map((item) => {
              const kind = classifyAffinity(item, analysis.tasteDna, voice);
              return (
                <li key={item.id}>
                  <AffinityBar
                    label={item.label}
                    value={item.score}
                    role={item.role}
                    provenance={item.provenance}
                    normalisation={analysis.affinityRanking.normalisation}
                    setSize={analysis.affinityRanking.setSize}
                    clustered={item.clusteredWithNeighbour}
                    rank={item.rank}
                  />
                  <span className={`cd-kind cd-kind--${kind.kind}`}>{kind.short}</span>
                  {item.category ? (
                    <span className="cd-kit__row-category">{categoryLabel(item.category)}</span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}

        <p className="cd-kit__note">
          <em>confirmed</em> — selected by the creator. <em>cross-category</em> — reached into a
          category none of their confirmed interests sit in. <em>traced</em> — reached from their
          interests inside ground they already work in. <em>our read</em> — no explanation arrived
          for it, so its position rests on the aggregate score alone.
        </p>
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className="cd-kit__section">
        <h2 className="cd-kit__section-title">What this creator has not made yet</h2>
        <p className="cd-kit__basis">{analysis.opportunityGap.coverageMethodology}</p>

        {opportunities.length === 0 ? (
          <EmptyState
            title="No white space identified"
            message="No category combined high cultural affinity with low declared coverage in this profile."
            // §7.2: an empty list here has two possible causes and the kit must not
            // pick one for the reader. The old hint asserted that the creator's
            // output already covers what they are close to, which is untrue whenever
            // coverage was simply never declared — and the basis sentence rendered
            // directly above says which case this is, so pointing at it is both
            // honest and non-duplicative.
            hint="The coverage basis above says which of two things this is: either the creator's declared output already covers the categories they are close to, or their coverage was never declared and the question could not be answered. An empty list here is not evidence that no white space exists."
          />
        ) : (
          <table className="cd-kit__table">
            <caption className="cd-sr-only">
              Categories with high affinity and low declared coverage
            </caption>
            <thead>
              <tr>
                <th scope="col">Category</th>
                <th scope="col">Cultural affinity</th>
                <th scope="col">Declared coverage</th>
              </tr>
            </thead>
            <tbody>
              {opportunities.map((point) => (
                <tr key={point.id}>
                  <th scope="row">{point.label}</th>
                  <td>{strengthWord(point.affinity)}</td>
                  <td className="cd-tabular">{Math.round(point.coverage * 100)}% (self-reported)</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <p className="cd-kit__note">
          Coverage is declared by the creator, not measured from their published output. The gap
          between the two columns is an indication of where a collaboration could land, not a
          forecast of performance.
        </p>
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className="cd-kit__section">
        <h2 className="cd-kit__section-title">Brands this profile overlaps with</h2>
        <p>
          {brands.length === 0
            ? `No brand in this run had evidence behind it worth putting in front of a partner, so none is listed.`
            : `Candidates came from a live catalogue query built on the taste profile above — the confirmed interests expanded through the catalogue&rsquo;s own relationships. Each one&rsquo;s cultural profile was then read back out of that same catalogue and compared with this one, and the order below is that comparison, not the order the query happened to return them in. ${
                brands.length === 1 ? "One is" : `${brands.length} are`
              } shown here${
                preferredBrandIds !== undefined && preferredBrandIds.length > 0
                  ? ", starting with the ones this creator set aside to approach"
                  : ""
              }.`}
        </p>

        {brands.length > 0 ? (
          <div className="cd-kit__brands">
            {brands.map((opportunity) => {
              const note = describeBrandFitForKit(
                opportunity,
                creator.displayName,
                voice,
                audience?.context,
                contentDna,
              );
              const preferred = preferredBrandIds?.includes(opportunity.brandId) === true;
              return (
                <section key={opportunity.brandId} className="cd-kit__brand">
                  <header className="cd-kit__brand-head">
                    <h3 className="cd-kit__brand-name">{opportunity.name}</h3>
                    {brandCategoryLabel(opportunity.category) ? (
                      <span className="cd-kit__brand-category">
                        {brandCategoryLabel(opportunity.category)}
                      </span>
                    ) : null}
                    {preferred ? (
                      <span className="cd-kit__brand-flag">Creator shortlist</span>
                    ) : null}
                  </header>

                  <p className="cd-kit__brand-headline">{note.line}</p>

                  {note.because.length > 0 ? (
                    <ul className="cd-kit__brand-evidence">
                      {note.because.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  ) : null}

                  {opportunity.fit.overall.renderable ? (
                    <>
                      <p className="cd-kit__brand-score">
                        {fitHeadline(opportunity.fit)}{" "}
                        <span className="cd-kit__brand-score-note">
                          {Math.round(opportunity.fit.overall.value * 100)} of 100, blending{" "}
                          {opportunity.fit.overall.componentsUsed} of{" "}
                          {opportunity.fit.overall.componentsTotal} dimensions. Each one measures
                          this brand on its own evidence, not its position among the others
                          returned — and the figure is not comparable to another
                          creator&rsquo;s kit.
                        </span>
                      </p>
                      <ScoreBreakdown
                        components={opportunity.fit.components}
                        overall={opportunity.fit.overall}
                        compact
                        showDisclosure={false}
                      />
                    </>
                  ) : (
                    <p className="cd-kit__brand-score">
                      {/* Two distinct causes, as in `ScoreBreakdown`: nothing could be
                          computed at all, or things were computed but none of them
                          measured culture. The kit goes to a brand, so naming the
                          second one honestly matters more here than anywhere — it is
                          the difference between "we could not assess this" and "we
                          assessed it and it scored low". */}
                      {opportunity.fit.overall.componentsUsed === 0
                        ? `No fit figure is shown for ${opportunity.name}. None of the scoring dimensions could be computed from what the catalogue returned, so a number here would be a zero dressed up as a measurement.`
                        : `No fit figure is shown for ${opportunity.name}. ${opportunity.fit.overall.componentsUsed} of ${opportunity.fit.overall.componentsTotal} dimensions could be computed, but none of them measures cultural compatibility, so a blended figure would read as an alignment verdict the evidence does not support.`}
                    </p>
                  )}

                  {note.missing.length > 0 ? (
                    <p className="cd-kit__note">
                      Could not be judged: {note.missing.join("; ")}.
                    </p>
                  ) : null}

                  <p className="cd-kit__note">{note.caveat}</p>

                  {opportunity.metadata?.destination ? (
                    <p className="cd-kit__brand-link">
                      <a
                        href={opportunity.metadata.destination.href}
                        target="_blank"
                        rel="noreferrer noopener"
                      >
                        {opportunity.metadata.destination.host}
                      </a>{" "}
                      —{" "}
                      {opportunity.metadata.destination.origin === "registry"
                        ? "partnership page verified in the CreatorsDNA registry"
                        : "website as reported by the catalogue"}
                      .
                    </p>
                  ) : null}
                </section>
              );
            })}
          </div>
        ) : null}

        <p className="cd-kit__note">
          Alignment is exploratory. It describes how a brand&rsquo;s cultural profile sits against
          this one; the order above is the strength of that overlap, not a recommendation to sign
          with anyone and not a statement that any brand listed runs a creator programme.
        </p>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Content DNA, ahead of Audience so the three layers read in the order the
          product defines them: what cultural world this creator is in (the sections
          above), how they express themselves inside it (here), and who they intend to
          reach (next). One summary line rather than the topics, angles and formats
          underneath it — a kit is one page, and the underlying answers are already
          visible in the coverage and platform lines the header carries. */}
      {contentDna?.positioning ? (
        <section className="cd-kit__section">
          <h2 className="cd-kit__section-title">How they make it</h2>
          <p className="cd-kit__lede">{`${contentDna.positioning} (self-reported)`}</p>
          <p>
            Assembled from answers {creator.displayName} gave about their own work — the
            categories they said they cover, the form they said they make it in, and where they
            publish. None of it was measured, none of it is a finding of this analysis, and
            none of it was compared against any brand listed here: where a note above mentions
            it, the overlap it follows was established without it.
          </p>
        </section>
      ) : null}

      {/* ---------------------------------------------------------------- */}
      {audience !== undefined && audience.stated ? (
        <section className="cd-kit__section">
          <h2 className="cd-kit__section-title">
            Audience, as stated by {creator.displayName}
          </h2>
          <p>
            Supplied by the creator, not measured by CreatorsDNA. There is no analytics connection
            in this product and no follower count anywhere in the run, so every line below is
            something they chose to state — a figure they gave, or their own answer to who they
            create for and what people come to their work for. None of it is an observation, and
            none of it describes verified customers of any brand listed below.
          </p>
          <dl className="cd-kit__audience">
            {audience.lines.map((line) => (
              <div key={line.label}>
                <dt>{line.label}</dt>
                <dd>{line.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : (
        <section className="cd-kit__section">
          <h2 className="cd-kit__section-title">Audience</h2>
          <p className="cd-kit__note">
            Not included. CreatorsDNA measures no audience — no follower count, no engagement rate,
            no demographic breakdown — and this document does not invent one. Ask{" "}
            {creator.handle ? `@${creator.handle}` : creator.displayName} directly for their current
            figures.
          </p>
        </section>
      )}

      {/* ---------------------------------------------------------------- */}
      <footer className="cd-kit__disclosure">
        <h2 className="cd-kit__section-title">Basis of this document</h2>

        <dl className="cd-kit__facts">
          <dt>Data source</dt>
          <dd>
            {analysis.source.label}.{" "}
            {analysis.source.isIllustrative
              ? "Generated locally for development. Nothing in this document is a Qloo discovery and no live API call was made."
              : "Retrieved through the Qloo Insights API, with provenance labelled per value."}
          </dd>

          <dt>Personalisation level</dt>
          <dd>
            {analysis.fallbackLevel} — {FALLBACK_DESCRIPTIONS[analysis.fallbackLevel]}
          </dd>

          <dt>Affinities</dt>
          <dd>{analysis.affinityRanking.meta.methodology}</dd>

          <dt>Opportunity gap</dt>
          <dd>{analysis.opportunityGap.meta.methodology}</dd>

          <dt>Inputs</dt>
          <dd>
            {declared.length} confirmed {declared.length === 1 ? "interest" : "interests"};{" "}
            {analysis.unresolvedInterests.length} could not be resolved and are excluded rather than
            guessed
            {analysis.contextTerms.length > 0
              ? `; ${analysis.contextTerms.length} ${
                  analysis.contextTerms.length === 1 ? "phrase was" : "phrases were"
                } kept as context only and never sent as a signal`
              : ""}
            .
          </dd>
        </dl>

        {analysis.observations.length > 0 ? (
          <p className="cd-kit__note">
            {analysis.observations.length}{" "}
            {analysis.observations.length === 1 ? "observation was" : "observations were"} recorded
            by the data layer while building this profile. They are visible in the interactive
            version of this analysis.
          </p>
        ) : null}

        <ProvenanceKey provenances={provenancesIn(analysis)} />

        <p className="cd-kit__generated">
          Produced by CreatorsDNA on {analysis.generatedAt.slice(0, 10)}. Values are relative to this
          profile and are not comparable to another creator&apos;s kit.
        </p>
      </footer>
    </article>
  );
}

/**
 * Which brands earn a place in a one-page document, and in what order.
 *
 * A kit lists three, so the selection is itself an argument. Three rules:
 *
 *  1. **Evidence, or not at all.** A brand needs a renderable fit figure, a named
 *     driver, or at least one dimension of shared taste. Without one of those the
 *     entry is a name in a document with no reason beside it — and being on the
 *     creator's shortlist does not waive the rule, because their intent is not
 *     something a partner can check.
 *  2. **The creator's own shortlist first**, in the order they added it. They know
 *     which brands they intend to approach; no ranking does.
 *  3. **Then the order the analysis already produced.** `opportunities` arrives
 *     ranked on the cultural intersection and this function preserves that order
 *     instead of re-sorting it.
 *
 * Rule 3 is a correction, not a style choice. This used to re-sort by driver count
 * and then by fit value, so the kit could lead with a brand the results page had
 * placed fourth: two documents over one run disagreeing about which connection was
 * strongest, with nothing on either to explain the difference. Shared taste is also
 * now accepted as evidence in rule 1, because a brand whose only support is the
 * overlap is precisely the one where the overlap is worth printing — under the old
 * test it was dropped from the kit for want of a fit figure it never needed.
 */
function selectBrands(
  opportunities: readonly BrandOpportunity[],
  preferred: readonly string[],
  limit: number,
): BrandOpportunity[] {
  const withEvidence = opportunities.filter(
    (opportunity) =>
      opportunity.fit.overall.renderable ||
      (opportunity.drivers ?? []).length > 0 ||
      (opportunity.intersection?.shared.length ?? 0) > 0,
  );

  const chosen: BrandOpportunity[] = [];
  const chosenIds = new Set<string>();
  for (const brandId of preferred) {
    if (chosenIds.has(brandId)) continue;
    const opportunity = withEvidence.find((item) => item.brandId === brandId);
    if (opportunity === undefined) continue;
    chosen.push(opportunity);
    chosenIds.add(brandId);
  }

  const rest = withEvidence.filter((opportunity) => !chosenIds.has(opportunity.brandId));

  return [...chosen, ...rest].slice(0, limit);
}

/** Every provenance class actually present, so the key cannot list unused ones. */
function provenancesIn(analysis: CreatorAnalysis) {
  const found = new Set(analysis.affinityRanking.items.map((item) => item.provenance));
  for (const point of analysis.opportunityGap.points) found.add(point.provenance);
  for (const fit of analysis.brandFits) {
    for (const component of fit.components) found.add(component.provenance);
  }
  return [...found];
}
