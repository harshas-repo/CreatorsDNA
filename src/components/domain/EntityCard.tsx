import type { ReactNode } from "react";

import type { Provenance } from "@/lib/contracts/domain";
import type { ColourRole } from "@/lib/contracts/viewModels";
import { AffinityBar } from "@/components/domain/AffinityBar";
import { ContentThumbnail } from "@/components/domain/ContentThumbnail";
import { TasteChip } from "@/components/domain/TasteChip";

/**
 * `EntityCard` (doc 02 §30).
 *
 * One cultural entity — a film, a game, a cuisine, a brand — as a card. Used in
 * search results, in the network's inspect panel and in the media kit.
 *
 * The prop type is a STRUCTURAL SUBSET of `CulturalEntity`, not the entity
 * itself. Two reasons: `TasteNode["entity"]` is already a `Pick<>` of five
 * fields, so requiring the full entity would make the network unable to render
 * its own inspect panel; and a card that demanded `affinity`, `rank`, `tags` and
 * `explainability` could not be used for the entities we hold only partial data
 * for — which, without an API key, is all of them.
 *
 * Every field is optional except `name`, and an absent field is simply not
 * rendered. That is the doc 02 §21 rule at component level: a card that showed
 * "Popularity: —" for every synthetic entity would be a grid of holes implying
 * data was fetched and came back empty, when in fact nothing was fetched.
 */

export interface EntityCardEntity {
  id: string;
  name: string;
  /** Qloo subtype URN or label — the category the entity sits in. */
  subtype?: string;
  /** Disambiguation text, e.g. "2010 film". Required when names collide. */
  disambiguation?: string;
  description?: string;
  imageUrl?: string;
  /** 0..1 catalogue popularity, independent of the query (doc 03 §15). */
  popularity?: number | undefined;
}

export interface EntityCardProps {
  entity: EntityCardEntity;
  /** Defaults to `secondary` — most entities shown are discovered affinities. */
  role?: ColourRole;
  provenance?: Provenance;
  /** 0..1 affinity within its result set. Omitted = not scored. */
  affinity?: number | undefined;
  /** How `affinity` was computed. Passed straight to `AffinityBar`. */
  affinityBasis?: string;
  setSize?: number;
  tags?: readonly string[];
  /** True when the entity came from `backfill.cross_domain` (doc 03 §8 step 3). */
  crossDomain?: boolean;
  selected?: boolean;
  onSelect?: () => void;
  /** Slot for a use-site-specific action, e.g. "Add to interests". */
  action?: ReactNode;
  className?: string;
}

export function EntityCard({
  entity,
  role = "secondary",
  provenance = "qloo",
  affinity,
  affinityBasis,
  setSize,
  tags,
  crossDomain = false,
  selected = false,
  onSelect,
  action,
  className,
}: EntityCardProps) {
  const Wrapper = onSelect !== undefined ? "button" : "article";

  return (
    <Wrapper
      {...(onSelect !== undefined
        ? { type: "button" as const, onClick: onSelect, "aria-pressed": selected }
        : {})}
      className={`cd-entity${selected ? " cd-entity--selected" : ""}${
        onSelect !== undefined ? " cd-entity--clickable" : ""
      }${className ? ` ${className}` : ""}`}
    >
      <ContentThumbnail
        src={entity.imageUrl}
        alt={`Artwork for ${entity.name}`}
        role={role}
        provenance={provenance}
        size={72}
        className="cd-entity__thumb"
      />

      <div className="cd-entity__body">
        <header className="cd-entity__head">
          <h4 className="cd-entity__name">{entity.name}</h4>
          {entity.disambiguation ? (
            // Rendered whenever present, not only on collision: two results with
            // the same name in one list are indistinguishable without it, and the
            // reader cannot tell in advance which lists those are (doc 02 §7).
            <span className="cd-entity__disambiguation">{entity.disambiguation}</span>
          ) : null}
          {entity.subtype ? (
            <span className="cd-entity__subtype">{entity.subtype}</span>
          ) : null}
        </header>

        {entity.description ? (
          <p className="cd-entity__desc">{entity.description}</p>
        ) : null}

        {crossDomain ? (
          <p className="cd-entity__crossdomain">
            Beyond your declared niche — returned by the data source as a cross-domain
            result, not matched from your interests.
          </p>
        ) : null}

        {affinity !== undefined || affinityBasis !== undefined ? (
          <AffinityBar
            label="Cultural affinity"
            value={affinity}
            role={role}
            provenance={provenance}
            basis={affinityBasis}
            normalisation={affinity === undefined ? "unavailable" : undefined}
            setSize={setSize}
          />
        ) : null}

        {entity.popularity !== undefined ? (
          <p className="cd-entity__popularity">
            <span className="cd-eyebrow">Catalogue popularity</span>
            <span className="cd-tabular">{entity.popularity.toFixed(2)}</span>
            {/* Stated because the natural reading of two bars on one card is that
                they measure the same thing. Popularity is a property of the
                catalogue; affinity is a property of this query. */}
            <span className="cd-entity__popularity-note">
              Independent of your inputs — how widely known this entity is.
            </span>
          </p>
        ) : null}

        {tags && tags.length > 0 ? (
          <ul className="cd-entity__tags">
            {tags.map((tag) => (
              <li key={tag}>
                <TasteChip label={tag} role={role} provenance={provenance} />
              </li>
            ))}
          </ul>
        ) : null}

        {action ? <div className="cd-entity__action">{action}</div> : null}
      </div>
    </Wrapper>
  );
}
