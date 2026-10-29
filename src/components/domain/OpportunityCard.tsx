import type { DataSource } from "@/lib/contracts/domain";
import type { OpportunityPoint } from "@/lib/contracts/viewModels";
import { describeOpportunityPoint } from "@/lib/copy/generate";
import { AffinityBar } from "@/components/domain/AffinityBar";
import { QlooInsightBadge } from "@/components/ui/Provenance";

/**
 * `OpportunityCard` (doc 02 §30).
 *
 * One point from the opportunity-gap scatter, as a card: what the category is,
 * how much cultural affinity it carries, how much of it the creator already
 * covers, and the gap between those two.
 *
 * The quadrant is a PROP rather than being computed here. `quadrantFor()` lives
 * in `src/lib/analysis/opportunities.ts`, and importing the analysis layer into a
 * component that renders in the browser would pull the whole scoring pipeline
 * into the client bundle for one switch statement. The builder already knows the
 * quadrant; passing it keeps the arithmetic server-side and the card dumb.
 *
 * Coverage is labelled as self-reported on every card, not once in a page-level
 * footnote. Doc 05 §10C requires the coverage methodology to be identified rather
 * than implied, and the gap score is the single most actionable number in the
 * product — which is exactly why its weakest input should be the most visible
 * thing about it.
 */

export interface OpportunityQuadrant {
  label: string;
  description: string;
}

export interface OpportunityCardProps {
  point: OpportunityPoint;
  quadrant?: OpportunityQuadrant;
  /** Needed by `QlooInsightBadge` to refuse the badge on illustrative data. */
  source: DataSource;
  selected?: boolean;
  onSelect?: () => void;
  className?: string;
}

export function OpportunityCard({
  point,
  quadrant,
  source,
  selected = false,
  onSelect,
  className,
}: OpportunityCardProps) {
  const Wrapper = onSelect !== undefined ? "button" : "article";
  const declared = point.coverageBasis === "creator_declared";

  return (
    <Wrapper
      {...(onSelect !== undefined
        ? { type: "button" as const, onClick: onSelect, "aria-pressed": selected }
        : {})}
      className={`cd-opp-card${selected ? " cd-opp-card--selected" : ""}${
        onSelect !== undefined ? " cd-opp-card--clickable" : ""
      }${className ? ` ${className}` : ""}`}
    >
      <header className="cd-opp-card__head">
        <h4 className="cd-opp-card__label">{point.label}</h4>
        {/* The gap score is derived arithmetic, never a retrieved value, so it is
            badged as such even when the affinity beneath it came from the data
            source. Two badges on one card is deliberate: they answer different
            questions about different numbers. */}
        <QlooInsightBadge provenance={point.provenance} source={source} />
      </header>

      {quadrant ? (
        <p className="cd-opp-card__quadrant">
          <span className="cd-opp-card__quadrant-label">{quadrant.label}</span>
          <span className="cd-opp-card__quadrant-desc">{quadrant.description}</span>
        </p>
      ) : null}

      <div className="cd-opp-card__bars">
        <AffinityBar
          label="Cultural affinity"
          value={point.affinity}
          role={point.role}
          provenance={point.provenance}
          basis="Mean of the data source's affinities for this category's entities, min-max normalised within their own result set. It is a relative position in that set, not a measured percentage of anything."
        />
        <AffinityBar
          label={declared ? "Your declared coverage" : "Your coverage (assumed by us)"}
          value={point.coverage}
          role="content"
          // An inferred zero is a CreatorsDNA derivation, not something the
          // creator said. Labelling it `creator` put our assumption in their
          // mouth and the badge next to it read as self-reported.
          provenance={declared ? "creator" : "derived"}
          basis={COVERAGE_BASIS[point.coverageBasis]}
        />
      </div>

      <p className="cd-opp-card__gap">
        <span className="cd-eyebrow">Gap score</span>
        <strong className="cd-metric cd-opp-card__gap-value">{point.gapScore.toFixed(2)}</strong>
        <span className="cd-opp-card__gap-scale">on a 0–1 scale</span>
      </p>

      <p className="cd-opp-card__prose">{describeOpportunityPoint(point)}</p>

      <p className="cd-opp-card__support cd-viz__footnote">
        {point.supportCount > 0
          ? `Based on ${point.supportCount} ${point.supportCount === 1 ? "entity" : "entities"} in this category.`
          : "No supporting entities were available for this category."}
      </p>
    </Wrapper>
  );
}

/**
 * Coverage basis, in the words the card is allowed to use.
 *
 * Nothing here is measured from published content — there is no crawling step —
 * so `measured` is unreachable in practice and is spelled out only so a future
 * measurement cannot silently reuse the self-reported wording.
 *
 * `inferred_zero` is the common case when a creator fills in some categories and
 * leaves the rest blank. It is our default, and saying so is the difference
 * between an assumption the creator can correct and one they cannot see.
 */
const COVERAGE_BASIS: Record<OpportunityPoint["coverageBasis"], string> = {
  creator_declared: "Self-reported by you during onboarding. Not measured from your published content.",
  inferred_zero:
    "Assumed by CreatorsDNA. You declared coverage for other categories but not this one, so it is treated as uncovered. Correct it in the coverage step if that is wrong.",
  measured: "Measured from your published content.",
  unavailable: "No coverage information was available, so this figure could not be computed.",
};
