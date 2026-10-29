import type { AudienceWords, ContentDna } from "@/lib/contracts/creator";
import type { DataSource } from "@/lib/contracts/domain";
import type { BrandOpportunity } from "@/lib/contracts/viewModels";
import {
  brandCategoryLabel,
  describeBrandOpportunity,
  explainFitScore,
  fitHeadline,
  sourceVoice,
} from "@/lib/copy/generate";
import { ScoreBreakdown } from "@/components/domain/ScoreBreakdown";
import { SharedTaste } from "@/components/domain/SharedTaste";
import { ProvenanceBadge, QlooInsightBadge } from "@/components/ui/Provenance";

/**
 * `BrandCard` (doc 02 §30).
 *
 * One brand opportunity, in the order a creator would need it: who the brand is,
 * what the two cultural profiles were found to share, what the number means, why it
 * appeared, what could not be judged, and how a conversation would actually start.
 *
 * **The shared taste sits above the score, and that is the argument.** §9 allows a
 * ranking figure but forbids letting it replace the explanation, so the card states
 * what overlapped before it states how much. The score below is a weighted blend of
 * the dimensions that could be computed — not a position in this run, and not a
 * second opinion about the overlap above it.
 *
 * **Discovery is its own block, deliberately.** §10 keeps three questions apart:
 * why the catalogue returned this brand (`Discovery`), what the two cultural
 * profiles were verified to share (`SharedTaste`), and what could not be judged
 * (`why.missing` plus the breakdown's "Not assessed" list). Folding the first into
 * the second is exactly the error §4 exists to prevent — a brand that came back
 * first is not thereby a brand that overlaps, and on a card where both numbers are
 * visible the reader has to be able to tell them apart.
 *
 * **An `<article>`, never a `<button>`.** The partnership routes and the website
 * are links, and nesting a link inside a button is invalid HTML that browsers
 * resolve inconsistently — the usual outcome is that one of the two stops working.
 * So the card is a container and every affordance inside it is a real button or
 * anchor, rather than making the whole card clickable and discovering later that
 * the destination link cannot be.
 *
 * **`onOpen` gets a whole-card click without breaking that rule.** It renders one
 * more real `<button>` whose `::after` is stretched across the card (`inset: 0`
 * against the article, which is already `position: relative`). The card stays an
 * `<article>`, the button stays a button, and the shortlist control and any link
 * are lifted above the overlay with `z-index` so they keep working. This is the
 * same pattern a link-over-card uses, and it means a click anywhere on the card —
 * including on its padding — opens the detail stage, which is what "click the card"
 * means to a creator.
 *
 * **Partnership routes are rendered only when `available` is true.** Doc 02 §21
 * forbids invented contacts and `hasVerifiedRoute()` in the brand contract treats
 * an unverified URL as no route at all, because rendering it would imply an
 * endorsement nobody confirmed. The empty case says so in words: a card with a
 * silently missing section reads as a rendering bug, and a creator who cannot tell
 * whether the route is absent or hidden cannot act on either.
 *
 * **The website is not the partnership route and the card keeps them apart.**
 * `metadata.destination` is where the brand lives; the partnership block is a
 * verified way in. A catalogue URL is labelled with where it came from, because
 * "verified" would be true of one and not the other.
 */

export interface BrandCardProps {
  opportunity: BrandOpportunity;
  /** Needed by `QlooInsightBadge` to refuse the badge on illustrative data. */
  source: DataSource;
  /**
   * The creator's self-reported audience context, when the surface has one.
   *
   * Absent on the landing page, which renders an illustrative archetype with no
   * creator behind it, and absent whenever the creator skipped the question — in
   * both cases the "why explore this" block reads exactly as it did before this
   * prop existed. It can add one sentence to that block and cannot add a reason,
   * change the score or affect the order: the gate is inside
   * `describeBrandOpportunity`, not here, so a card cannot opt out of it.
   */
  audience?: AudienceWords;
  /**
   * The creator's Content DNA, when the surface has one.
   *
   * Same absence rules and same guarantee as `audience` above, because it travels to
   * the same builder through the same kind of gate: it can add one sentence to the
   * "why explore this" block naming how the creator says they make things, and it can
   * shape the FORM of the hypothesis. It cannot add a reason, change the score or
   * affect the order, and it is refused outright for a brand the evidence found no
   * overlap with.
   */
  contentDna?: ContentDna;
  /**
   * Whether to render the identity block (description, region, website, social).
   * On by default; grid views that already show these elsewhere turn it off so the
   * same fact is not printed twice on one screen.
   */
  showIdentity?: boolean;
  /**
   * Whether to render the "why explore this" block. On by default. Turned off on
   * the detail stage, which renders the same copy at full length with its own
   * headings — duplicating it two lines apart would read as a bug.
   */
  showWhy?: boolean;
  /**
   * Whether to render the shared-taste block. On by default. Turned off on the
   * detail stage, which renders the `detail` variant of the same component in its
   * main column — one implementation, two densities, and no second version of the
   * same facts on one screen.
   */
  showSharedTaste?: boolean;
  /** Renders the compact breakdown inline. Off by default for grid density. */
  showBreakdown?: boolean;
  /**
   * Whether to render the "why it came back" discovery block. On by default.
   *
   * §10 requires three things kept apart on the card: why the brand was
   * discovered, what cultural overlap was established, and what remains unknown.
   * The first two have their own sections (`SharedTaste` and this one) precisely
   * so that neither can be read as the other. Turned off on the landing page,
   * which is a two-column demo grid where the section lede already makes the
   * distinction in words and a fourth block on every card would push the overlap —
   * the one that matters — below the fold.
   */
  showDiscovery?: boolean;
  /**
   * Whether to render the partnership block. On by default.
   *
   * Turned off on the compact summary card in the brand list, where the routes
   * live on the detail stage instead. This is a density choice and not a change to
   * what is true: the same block, unaltered, renders one click away.
   */
  showPartnership?: boolean;
  /**
   * Whether to render the long `discovery.meaning` paragraph. On by default.
   *
   * Off on the compact summary card. The paragraph states the normalisation
   * method, the raw affinity, the scale caveat and the set-relativity warning in
   * one block of prose, which is the right thing to read on a detail stage and the
   * wrong thing to read twelve times down a list. The labelled rank chip above it
   * — the one number most at risk of being misread as a quality judgement — stays
   * on the card either way, and the full paragraph is one click away.
   */
  discoveryMeaning?: boolean;
  onSelect?: () => void;
  selected?: boolean;
  /** The creator has set this brand aside to pitch. See `onToggleShortlist`. */
  shortlisted?: boolean;
  /**
   * Absent means the surface has nowhere to keep a shortlist — the landing page's
   * illustrative archetype cards, for one. The button is then not rendered at all
   * rather than rendered dead.
   */
  onToggleShortlist?: () => void;
  /**
   * Open this brand's dedicated detail view.
   *
   * Absent on every surface that has no detail stage to open. When present the
   * card renders a stretched click target over itself (see the class comment), so
   * the whole card becomes the affordance rather than a button inside it.
   */
  onOpen?: () => void;
  className?: string;
}

export function BrandCard({
  opportunity,
  source,
  audience,
  contentDna,
  showIdentity = true,
  showWhy = true,
  showSharedTaste = true,
  showBreakdown = false,
  showDiscovery = true,
  showPartnership = true,
  discoveryMeaning = true,
  onSelect,
  selected = false,
  shortlisted = false,
  onToggleShortlist,
  onOpen,
  className,
}: BrandCardProps) {
  const { fit, partnership } = opportunity;
  const voice = sourceVoice(source);
  const category = brandCategoryLabel(opportunity.category);
  const why = describeBrandOpportunity(opportunity, voice, audience, contentDna);
  const scoreMeaning = explainFitScore(fit);

  return (
    <article
      className={`cd-brand${selected ? " cd-brand--selected" : ""}${
        shortlisted ? " cd-brand--shortlisted" : ""
      }${onOpen ? " cd-brand--openable" : ""}${className ? ` ${className}` : ""}`}
    >
      <header className="cd-brand__head">
        <div className="cd-brand__title">
          <h4 className="cd-brand__name">{opportunity.name}</h4>
          {category ? <span className="cd-brand__category">{category}</span> : null}
        </div>
        <div className="cd-brand__badges">
          {opportunity.isUntapped ? (
            // "Untapped" is a statement about the creator's own declared
            // coverage, not a promise about the brand, so the wording stays
            // about what they have not made yet. The tooltip states all three
            // conditions rather than the old "high cultural affinity", because
            // affinity is the discovery figure and §7.2 removed it from this
            // badge: a brand earns it from a verified overlap, a strength at or
            // above the published clear-overlap line, and a coverage figure the
            // creator actually declared.
            <span
              className="cd-brand__untapped"
              title="Verified cultural overlap, and a declared coverage low enough that you have not covered it yet"
            >
              Untapped for you
            </span>
          ) : null}
          {opportunity.discovered ? (
            // Names the candidate source. Without it a brand nobody curated looks
            // like one somebody did, and the missing partnership block then reads
            // as an omission rather than as the truth about this brand.
            <span className="cd-brand__origin">Found by {voice.providerNoun}</span>
          ) : null}
          {shortlisted ? <span className="cd-brand__shortlisted-flag">Shortlisted</span> : null}
          <QlooInsightBadge provenance={fit.meta.provenance} source={source} />
        </div>
      </header>

      {showIdentity ? <Identity metadata={opportunity.metadata} voice={voice} /> : null}

      {showSharedTaste ? (
        <SharedTaste
          brandName={opportunity.name}
          brandTaste={opportunity.brandTaste}
          intersection={opportunity.intersection}
        />
      ) : null}

      <div className="cd-brand__score">
        <p className="cd-brand__headline">{fitHeadline(fit)}</p>
        {scoreMeaning ? <p className="cd-brand__score-meaning">{scoreMeaning}</p> : null}
      </div>

      {showDiscovery && opportunity.discovery ? (
        <Discovery
          discovery={opportunity.discovery}
          providerNoun={voice.providerNoun}
          meaning={discoveryMeaning}
        />
      ) : null}

      {showWhy ? (
        <section className="cd-brand__why" aria-label={`Why ${opportunity.name} appeared`}>
          <span className="cd-eyebrow">Why explore this</span>
          <p className="cd-brand__hypothesis">{why.hypothesis}</p>
          {why.because.length > 0 ? (
            <ul className="cd-brand__because">
              {why.because.slice(0, 3).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : null}
          {why.missing.length > 0 ? (
            <p className="cd-brand__missing">
              Could not be judged: {why.missing.slice(0, 3).join("; ")}.
            </p>
          ) : null}
          <p className="cd-brand__caveat cd-viz__footnote">{why.caveat}</p>
        </section>
      ) : null}

      {showBreakdown ? (
        <ScoreBreakdown components={fit.components} overall={fit.overall} compact />
      ) : null}

      {showPartnership ? (
        <Partnership partnership={partnership} brandName={opportunity.name} />
      ) : null}

      {/* Rendered only when there is an action to put in it. An empty <footer> is
          not free: the card is a flex column with a gap, so a child with no
          contents still consumes one gap slot and leaves a band of dead space at
          the bottom of every card on a surface that has no shortlist — which is
          the landing page, i.e. the first one anyone sees. */}
      {onOpen || onSelect || onToggleShortlist ? (
        <footer className="cd-brand__actions">
          {onOpen ? (
            // The stretched click target. Visually an ordinary primary button in
            // the footer; its `::after` is what covers the rest of the card (see
            // `.cd-brand--openable` in globals.css). The accessible name repeats
            // the visible text and then names the brand, because a list of twelve
            // identically-named "Open the full evidence" buttons is a list a
            // screen-reader user cannot navigate. Containing the visible text
            // keeps WCAG 2.5.3 satisfied.
            <button
              type="button"
              className="cd-button cd-button--primary cd-button--sm cd-brand__open"
              onClick={onOpen}
              aria-label={`Open the full evidence for ${opportunity.name}`}
            >
              Open the full evidence
            </button>
          ) : null}
          {onSelect ? (
            <button
              type="button"
              className="cd-button cd-button--ghost cd-button--sm"
              onClick={onSelect}
              aria-pressed={selected}
            >
              {selected ? "Hide evidence" : "Show the evidence"}
            </button>
          ) : null}
          {onToggleShortlist ? (
            <button
              type="button"
              className={`cd-button cd-button--sm${
                shortlisted ? " cd-button--primary" : " cd-button--ghost"
              }`}
              onClick={onToggleShortlist}
              aria-pressed={shortlisted}
            >
              {shortlisted ? "Shortlisted — remove" : "Shortlist for a pitch"}
            </button>
          ) : null}
        </footer>
      ) : null}
    </article>
  );
}

/**
 * Why the catalogue returned this brand (§4.2, §10).
 *
 * Kept as its own block rather than folded into the score or the shared taste,
 * because it answers a different question. Discovery rank says the provider put
 * this brand in the candidate set and where in that set it landed; the overlap
 * block above says what the two cultural profiles were verified to share. §4 is
 * the finding that those two were being conflated — a min-max normalised position
 * inside a set spanning 0.017 of raw affinity was being read as a taste fit of
 * 1.00 — so the separation has to be visible on the card and not only true in the
 * data model.
 *
 * `meaning` is rendered verbatim. It already carries the rank, the endpoint, the
 * normalisation method, the raw affinity, the scale caveat, the set spread and the
 * set-relativity warning in one paragraph, and it was written to state each
 * limitation in the same breath as the number it limits. Rebuilding that here from
 * the fields would produce a second, shorter version of the same argument and the
 * two would drift.
 *
 * The chip repeats exactly one number from that paragraph. Scanning a card list is
 * how creators actually read it, and the figure most at risk of being misread as a
 * quality judgement is the rank — so it is the one that gets a labelled,
 * scannable form, with the eyebrow doing the disclaiming. Nothing else is
 * duplicated.
 *
 * `meaning` off keeps the chip and the eyebrow — the disclaiming stays — and drops
 * only the paragraph, for the summary card in the brand list where the same prose
 * would be read twelve times in a row. The detail stage renders it in full.
 */
function Discovery({
  discovery,
  providerNoun,
  meaning = true,
}: {
  discovery: NonNullable<BrandOpportunity["discovery"]>;
  providerNoun: string;
  meaning?: boolean;
}) {
  return (
    <section
      className="cd-brand__discovery"
      aria-label={`Why ${providerNoun} returned this brand`}
    >
      <span className="cd-eyebrow">Why it came back — not how well it fits</span>
      <p className="cd-brand__discovery-rank">
        Discovery rank {discovery.rank} of {discovery.setSize}
        <ProvenanceBadge provenance={discovery.provenance} className="cd-brand__meta-badge" />
      </p>
      {meaning ? (
        <p className="cd-brand__discovery-meaning cd-viz__footnote">{discovery.meaning}</p>
      ) : null}
    </section>
  );
}

/**
 * Who the brand is, from whichever source knew — and an explicit sentence when
 * none of them did.
 *
 * The empty case is rendered rather than skipped. A card that simply has no
 * description is indistinguishable from a card whose description failed to load,
 * and the second guess is the one that makes a creator distrust the whole result.
 */
function Identity({
  metadata,
  voice,
}: {
  metadata: BrandOpportunity["metadata"];
  voice: ReturnType<typeof sourceVoice>;
}) {
  if (metadata === undefined) {
    return (
      <p className="cd-brand__no-meta">
        {voice.providerNoun} returned this brand by name only — no description, region or website.
        Everything below is what we could judge from your own inputs and the match itself.
      </p>
    );
  }

  const destination = metadata.destination;
  const social = metadata.social ?? [];

  return (
    <div className="cd-brand__identity">
      {metadata.description ? (
        <p className="cd-brand__description">
          {metadata.description}
          <ProvenanceBadge provenance={metadata.provenance} className="cd-brand__meta-badge" />
        </p>
      ) : (
        <p className="cd-brand__no-meta">
          {voice.providerNoun} holds no description for this brand. Nothing is paraphrased to fill
          the space — the match below rests on your confirmed interests, not on a summary of it.
        </p>
      )}

      {metadata.curatorNote ? (
        <p className="cd-brand__curator">
          <span className="cd-eyebrow">Registry note</span>
          {metadata.curatorNote}
        </p>
      ) : null}

      {metadata.region || destination || social.length > 0 ? (
        <p className="cd-brand__facts">
          {metadata.region ? (
            <span className="cd-brand__fact">{metadata.region}</span>
          ) : null}
          {destination ? (
            <a
              className="cd-brand__fact cd-brand__fact--link"
              href={destination.href}
              target="_blank"
              rel="noreferrer noopener"
            >
              {destination.host}
              {/* The origin is printed, not implied. `registry` means a curator
                  checked this URL; `qloo` means the catalogue reported it and
                  nobody here has verified where it leads. */}
              <span className="cd-brand__fact-note">
                {destination.origin === "registry" ? "verified partnership page" : "catalogue website"}
              </span>
            </a>
          ) : null}
          {social.map((entry) => (
            <a
              key={`${entry.network}:${entry.href}`}
              className="cd-brand__fact cd-brand__fact--link"
              href={entry.href}
              target="_blank"
              rel="noreferrer noopener"
            >
              {entry.network}
            </a>
          ))}
        </p>
      ) : null}

      {destination === undefined && social.length === 0 ? (
        <p className="cd-brand__no-link">
          No website or profile URL came back with this brand, so none is linked. CreatorsDNA does
          not construct a URL from a brand name.
        </p>
      ) : null}
    </div>
  );
}

function Partnership({
  partnership,
  brandName,
}: {
  partnership: BrandOpportunity["partnership"];
  brandName: string;
}) {
  // `flatMap` rather than `map` + a type-predicate `filter`: the predicate would
  // have to name a type narrower than `keyof partnership`, and writing that by
  // hand is how a route key gets renamed in the contract while the predicate
  // keeps compiling against the old one.
  const routes = ROUTES.flatMap<BrandRoute>((route) => {
    const href = partnership[route.key];
    return typeof href === "string" && href.length > 0 ? [{ ...route, href }] : [];
  });

  if (!partnership.available) {
    return (
      <p className="cd-brand__no-route">
        No verified partnership route is on file for {brandName}. CreatorsDNA does not guess at
        contact details, and no route on file says nothing about whether one exists — only that we
        could not check it. If you pitch, you will be finding the contact yourself.
      </p>
    );
  }

  return (
    <div className="cd-brand__partnership">
      <span className="cd-eyebrow">How to start</span>
      {routes.length > 0 ? (
        <ul className="cd-brand__routes">
          {routes.map((route) => (
            <li key={route.key}>
              <a href={route.href} target="_blank" rel="noreferrer noopener">
                {route.label}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
      {/* `contactRoute` is free text — "Brand partnership form", "Via agency" —
          so it is rendered as a sentence, not as a link that cannot be built. */}
      {partnership.contactRoute ? (
        <p className="cd-brand__contact">{partnership.contactRoute}</p>
      ) : null}
      {partnership.verificationNote ? (
        <p className="cd-brand__verification cd-viz__footnote">
          {partnership.verificationNote}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The curated route keys, in the order a creator would try them.
 *
 * Typed against the contract rather than as free strings so that renaming a
 * field in `BrandOpportunity["partnership"]` is a compile error here instead of a
 * silently empty list on every card.
 */
const ROUTES = [
  { key: "creatorPartnershipUrl", label: "Creator partnership programme" },
  { key: "affiliateUrl", label: "Affiliate programme" },
  { key: "ambassadorUrl", label: "Ambassador programme" },
] as const satisfies ReadonlyArray<{
  key: keyof BrandOpportunity["partnership"];
  label: string;
}>;

/** Narrowed from `ROUTES`, so adding a route there widens this automatically. */
type RouteKey = (typeof ROUTES)[number]["key"];

/** A route that survived the "is there actually a URL" check. */
interface BrandRoute {
  key: RouteKey;
  label: string;
  href: string;
}
