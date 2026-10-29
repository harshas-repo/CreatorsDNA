import type { BrandOpportunity } from "@/lib/contracts/viewModels";
import { ProvenanceBadge } from "@/components/ui/Provenance";

/**
 * `SharedTaste` — the cultural intersection, rendered.
 *
 * This is the component the whole rework exists to make possible. Before it there
 * was no place on screen where a creator could see WHAT overlapped between their
 * profile and a brand's; there was a fit score, a list of drivers and a pathway
 * drawing, none of which is a statement about two cultural profiles having been
 * compared. §1 makes the intersection the reason a brand recommendation exists, so
 * it gets its own block rather than being folded into the score's caption.
 *
 * WHY IT RENDERS ABOVE THE SCORE
 * ------------------------------
 * §9: a numerical score may stay as a supporting ranking mechanism, but it must not
 * replace the explanation. Position is the enforcement — a card that leads with a
 * number invites a creator to read "78" as a verdict before they have read what was
 * compared. Shared taste first, score second, and the score is then visibly the same
 * overlap expressed as a position within this run.
 *
 * DIRECT AND ADJACENT ARE NOT THE SAME CLAIM
 * -------------------------------------------
 * §10 makes the distinction load-bearing and forbids flattening it. A chip reached
 * from an interest the creator confirmed is coloured with the taste role and says
 * so; one reached only through the catalogue's expansion is coloured with the
 * secondary role, marked "adjacent", and dashed — the same treatment every other
 * derived value in the product carries. When EVERY shared dimension is adjacent the
 * block says out loud that this is a discovery rather than an obvious fit, because
 * that is the more interesting and the less certain of the two readings.
 *
 * SPARSE IS RENDERED, NOT HIDDEN
 * ------------------------------
 * §7 expects some brands to come back with little more than a name. `kind: "none"`
 * still renders the block, with the strength label saying no overlap could be
 * established and the missing-evidence list saying why. Omitting the section would
 * leave a creator unable to tell "no overlap found" from "failed to load" — the same
 * reasoning the brand card's identity block already applies to a missing
 * description.
 *
 * ONE IMPLEMENTATION, TWO DENSITIES
 * ---------------------------------
 * The grid and the brand-detail stage need the same facts at different lengths. A
 * `variant` prop rather than a second component: two renderers over one view-model
 * is how the card and the detail page end up disagreeing about what was found, which
 * is the exact drift §19 warns against.
 */

export interface SharedTasteProps {
  brandName: string;
  /** The brand's own cultural profile. Optional — an older payload may lack it. */
  brandTaste: BrandOpportunity["brandTaste"];
  intersection: BrandOpportunity["intersection"];
  /**
   * `card` is the tight version for a grid: the strength label and the shared
   * dimensions. `detail` adds the overlap figure with what it actually means, the
   * brand's own descriptors, what could not be compared, and the methodology.
   */
  variant?: "card" | "detail";
  className?: string;
}

/** How much evidence the catalogue held about this brand, in words. */
const DENSITY_LABEL = {
  rich: "Detailed cultural profile",
  partial: "Partial cultural profile",
  sparse: "Sparse cultural profile",
} as const;

/** What each descriptor kind is, for the reader who has never seen a Qloo tag. */
const DESCRIPTOR_KIND_LABEL = {
  tag: "their descriptor",
  industry: "industry",
  category: "classification",
} as const;

/** Cap on brand descriptors shown. Six shared dimensions is already a full block. */
const MAX_BRAND_DESCRIPTORS_SHOWN = 8;

export function SharedTaste({
  brandName,
  brandTaste,
  intersection,
  variant = "card",
  className,
}: SharedTasteProps) {
  if (intersection === undefined) return null;

  const shared = intersection.shared;
  const adjacentOnly = intersection.kind === "adjacent";

  return (
    <section
      className={`cd-shared${variant === "detail" ? " cd-shared--detail" : ""}${
        className ? ` ${className}` : ""
      }`}
      aria-label={`Cultural overlap between your profile and ${brandName}`}
    >
      <span className="cd-eyebrow">Shared taste</span>

      {/* The qualitative reading leads, not the figure. §29: when the evidence is
          thin, words rather than a number — and the label already says which. */}
      <p className="cd-shared__label">
        {intersection.strengthLabel}
        <ProvenanceBadge provenance={intersection.provenance} className="cd-shared__badge" />
      </p>

      {/* §5.2: the four overlap states must read differently to the creator, not
          only in the data model. The label above names the outcome; this says why,
          and it is the only place the distinction between "we compared and found
          nothing" and "we could not compare" is actually explained. Rendered for
          every state, because a verified overlap needs its basis stated too —
          especially the classification-only one, which is verified but carries no
          number and would otherwise look like a missing value. */}
      <p className="cd-shared__state" data-state={intersection.state}>
        {intersection.stateReason}
      </p>

      {shared.length > 0 ? (
        <ul className="cd-shared__list">
          {shared.map((dimension) => (
            <li
              key={dimension.id}
              className={`cd-shared__chip${
                dimension.kind === "direct"
                  ? " cd-shared__chip--direct"
                  : " cd-shared__chip--adjacent"
              }`}
              // Both halves of the evidence, on hover: where the creator side came
              // from and where the brand side came from. Kept in `title` rather than
              // in the flow so a grid of twelve cards stays scannable.
              title={`${dimension.creatorEvidence} ${dimension.brandEvidence}`}
            >
              {dimension.label}
              <span className="cd-shared__chip-kind">
                {dimension.kind === "direct" ? "you confirmed this" : "adjacent"}
              </span>
              {/* §5.4: an exact descriptor identity and a classification-level match
                  are not the same claim and must not look like one. The second is
                  coarser, and it is the reason no overlap figure is shown. */}
              {dimension.matchBasis === "classification" ? (
                <span className="cd-shared__chip-basis">classification match</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {adjacentOnly ? (
        <p className="cd-shared__bridge">
          Nothing here sits on ground you declared outright — the connection was reached through an
          adjacent path in the catalogue. That makes it a discovery worth testing rather than an
          obvious fit: the more interesting reading, and the less certain one.
        </p>
      ) : null}

      {variant === "detail" ? (
        <DetailBody brandName={brandName} brandTaste={brandTaste} intersection={intersection} />
      ) : null}
    </section>
  );
}

/**
 * The long form: the figure with its meaning, the brand's side of the comparison,
 * what could not be compared, and how the comparison was made.
 *
 * §14 asks a brand result to expose Brand → Brand Taste DNA → Shared Taste →
 * explanation → missing evidence. The card variant covers the middle three; this
 * covers all five, and it is the version a creator reads before deciding whether to
 * write to a brand at all.
 */
function DetailBody({
  brandName,
  brandTaste,
  intersection,
}: {
  brandName: string;
  brandTaste: BrandOpportunity["brandTaste"];
  intersection: NonNullable<BrandOpportunity["intersection"]>;
}) {
  // Only rendered when there ARE descriptors. An empty brand profile is already
  // stated at length in `intersection.missing`, and printing it twice would be more
  // output about less evidence — the opposite of what §31 asks for.
  const descriptors = brandTaste?.descriptors ?? [];
  // `stateReason` is now rendered above the block for every state, and in the
  // creator-side-gap case it is the same sentence `missing` carries. Dropping the
  // exact duplicate is safe because both are built from one constant in
  // `intersection.ts`; a partial match is left alone, since two lines that differ
  // are two facts.
  const missing = intersection.missing.filter((line) => line !== intersection.stateReason);

  return (
    <>
      {intersection.strength !== undefined ? (
        <p className="cd-shared__figure">
          <span className="cd-shared__figure-value">
            {Math.round(intersection.strength * 100)}
          </span>
          <span className="cd-shared__figure-note">
            Taste overlap: the share of your total derived taste weight that {brandName} also
            carries, established by exact descriptor identity. Not a percentage of any audience, not
            a likelihood of a deal, not this brand&apos;s rank among the ones returned, and not
            comparable to another creator or another analysis.
          </span>
        </p>
      ) : intersection.state === "verified_overlap" ? (
        // §5.4: a classification-only overlap is verified but too coarse to carry a
        // number. Saying nothing here would read as a figure that failed to load.
        <p className="cd-shared__figure-note">
          No overlap figure is shown. The shared ground above was established at classification
          level rather than by an exact descriptor identity, and putting a number on that would
          claim a precision the comparison does not have.
        </p>
      ) : null}

      {descriptors.length > 0 ? (
        <div className="cd-shared__brand">
          <span className="cd-eyebrow">
            {brandTaste === undefined
              ? `What the catalogue holds on ${brandName}`
              : DENSITY_LABEL[brandTaste.density]}
          </span>
          <ul className="cd-shared__brand-list">
            {descriptors.slice(0, MAX_BRAND_DESCRIPTORS_SHOWN).map((descriptor) => (
              <li key={descriptor.id} className="cd-shared__brand-item">
                {descriptor.label}
                <span className="cd-shared__brand-kind">
                  {DESCRIPTOR_KIND_LABEL[descriptor.kind]}
                </span>
              </li>
            ))}
          </ul>
          {/* §21: this is the cultural world the catalogue associates with the
              brand. It is not their customer audience, and the block never says it
              is — the basis sentence below is what stops that reading. */}
          <p className="cd-shared__brand-note">
            The cultural interests associated with {brandName} in the available catalogue data. Not
            a measurement of who buys from them.
          </p>
        </div>
      ) : null}

      {missing.length > 0 ? (
        <div className="cd-shared__missing">
          <span className="cd-eyebrow">What could not be compared</span>
          <ul>
            {missing.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <details className="cd-shared__method">
        <summary>How this comparison was made</summary>
        <p>{intersection.methodology}</p>
        {brandTaste !== undefined ? <p>{brandTaste.basis}</p> : null}
      </details>
    </>
  );
}
