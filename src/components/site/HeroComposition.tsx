import { ROLE_SHAPE, provenanceDash, roleColour } from "@/lib/design/colourRoles";
import { ContentThumbnail } from "@/components/domain/ContentThumbnail";
import { EntityCard } from "@/components/domain/EntityCard";
import { TasteChip } from "@/components/domain/TasteChip";
import { ShapeGlyph } from "@/components/shapes/ShapeGlyph";
import { TasteSeal } from "@/components/shapes/TasteSeal";

import type { CreatorAnalysis, TasteNode } from "@/lib/contracts/viewModels";

/**
 * The hero visual (doc 01 §24).
 *
 * Doc 01 §24 lists what the hero may be built from — "cultural entity cards,
 * taste connections, visual relationship maps, creator profile elements, content
 * thumbnails, brand cards, dynamic typography, layered visual composition" — and
 * what it must not be: robot illustrations, a glowing brain, gradient blobs, AI
 * sparkles and **generic 3D shapes**. Every item on the forbidden list is a
 * picture OF an abstraction. Every item on the allowed list is a picture OF THE
 * PRODUCT. So this composition is assembled from the real components over the
 * real analysis, and contains no illustration at all.
 *
 * That also settles doc 01 §27 ("do not make fake screenshots that differ from
 * the actual product"): nothing here is drawn to look like the product, because
 * nothing here is anything but the product. When the charts change, the hero
 * changes with them, and a hero that has silently started advertising a layout
 * nobody ships becomes impossible.
 *
 * THREE BANDS, ONE CARD
 * ---------------------
 * The panel reads as a fragment of a creator's Taste DNA: identity (seal, name,
 * fallback level) → connections (the reduced relationship map beside the words
 * that name it) → consequence (the strongest brand fit). Two satellites overlap
 * the panel's edges — an entity card and a chip cluster — which is the "layered
 * visual composition" §24 asks for, done with real components instead of
 * decorative geometry.
 *
 * A Server Component. `TasteSeal` and `ContentThumbnail` are client leaves, but
 * nothing here needs to respond to input, so the whole composition prerenders.
 */

// ---------------------------------------------------------------------------
// Map geometry
// ---------------------------------------------------------------------------

const MAP_BOX = 300;
const MAP_CENTRE = MAP_BOX / 2;
const INNER_RADIUS = 58;
const OUTER_RADIUS = 124;
/**
 * Deliberately far below `network.readableNodeLimit`. Doc 05 §11's readability
 * rule is about the full chart, where a reader can pan, zoom and group; a hero
 * has none of those affordances, so it gets a stricter cap of its own rather
 * than inheriting a number chosen for a different interaction model.
 */
const INNER_LIMIT = 4;
const OUTER_LIMIT = 8;

const RELATION_WORD: Record<string, string> = {
  declared: "declared by the creator",
  recommended: "recommended from their interests",
  co_occurs: "co-occurs with",
  categorised: "grouped into the same category as",
};

interface HeroCompositionProps {
  analysis: CreatorAnalysis;
  /** Display name from the profile the example analysis was built from. */
  creatorName: string;
}

export function HeroComposition({ analysis, creatorName }: HeroCompositionProps) {
  const { network, tasteDna, fingerprint, opportunities, source } = analysis;

  // Declared interests form the inner ring: they are what the creator said, so
  // they sit at the centre of the picture and everything else hangs off them.
  const declared = network.nodes
    .filter((node) => node.kind === "declared_interest")
    .slice(0, INNER_LIMIT);
  const declaredIds = new Set(declared.map((node) => node.id));

  // Everything else on the outer ring, strongest first. The tie-break on label
  // is not cosmetic: `weight` is a float, and two equal weights would otherwise
  // order by whatever the provider returned, so the same profile could draw two
  // different maps on two builds.
  const discovered = network.nodes
    .filter((node) => !declaredIds.has(node.id))
    .sort((a, b) => b.weight - a.weight || a.label.localeCompare(b.label))
    .slice(0, OUTER_LIMIT);

  const drawn: TasteNode[] = [...declared, ...discovered];
  const drawnIds = new Set(drawn.map((node) => node.id));
  const placed = new Map<string, { x: number; y: number }>();

  declared.forEach((node, index) => {
    placed.set(node.id, ringPosition(index, declared.length, INNER_RADIUS, 0));
  });
  // Offset the outer ring by half a step. Without it an outer node can land
  // directly behind an inner one, and an edge that disappears under a node reads
  // as a missing connection rather than an occluded one.
  discovered.forEach((node, index) => {
    placed.set(
      node.id,
      ringPosition(index, discovered.length, OUTER_RADIUS, Math.PI / Math.max(discovered.length, 1)),
    );
  });

  const edges = network.edges.filter(
    (edge) => drawnIds.has(edge.source) && drawnIds.has(edge.target),
  );

  // The satellite entity card wants the strongest discovered node that actually
  // carries an entity payload — a tag or a derived category has nothing to show.
  const satelliteNode = discovered.find((node) => node.entity !== undefined);
  const brand = opportunities[0];
  const coreTastes = tasteDna.coreTastes.slice(0, 3);

  return (
    <div className="cd-hero__stage">
      <div className="cd-hero__panel cd-panel">
        {/* --- Identity ------------------------------------------------- */}
        <header className="cd-hero__id">
          <TasteSeal signature={fingerprint.signature} size={56} showHash={false} />
          <div className="cd-hero__id-text">
            <p className="cd-hero__id-eyebrow cd-eyebrow">
              Taste DNA · {analysis.fallbackLevel}
            </p>
            <p className="cd-hero__id-name">{creatorName}</p>
          </div>
          <span className="cd-hero__id-source cd-chip" title={source.label}>
            {source.isIllustrative ? "Synthetic data" : source.label}
          </span>
        </header>

        {/* --- Connections ---------------------------------------------- */}
        <div className="cd-hero__links-band">
          <div className="cd-hero__map" aria-hidden="true">
            <svg
              className="cd-hero__map-edges"
              viewBox={`0 0 ${MAP_BOX} ${MAP_BOX}`}
              preserveAspectRatio="xMidYMid meet"
              focusable="false"
            >
              {edges.map((edge) => {
                const from = placed.get(edge.source);
                const to = placed.get(edge.target);
                if (from === undefined || to === undefined) return null;
                return (
                  <path
                    key={edge.id}
                    d={curve(from, to)}
                    fill="none"
                    stroke={roleColour(edge.role, 0.5)}
                    strokeWidth={0.8 + edge.strength * 1.8}
                    // Provenance rides on the edge as well as the node. An edge
                    // that is ours rather than retrieved is dashed, matching
                    // `PROVENANCE_STYLE` — recolouring it instead would break
                    // R14, which reserves colour for semantic role.
                    strokeDasharray={provenanceDash(source.isIllustrative ? "synthetic" : "qloo")}
                  />
                );
              })}
            </svg>

            {drawn.map((node) => {
              const at = placed.get(node.id);
              if (at === undefined) return null;
              const shape = ROLE_SHAPE[node.role] ?? "circle";
              return (
                <span
                  key={node.id}
                  className="cd-hero__map-node"
                  style={{
                    insetInlineStart: `${(at.x / MAP_BOX) * 100}%`,
                    insetBlockStart: `${(at.y / MAP_BOX) * 100}%`,
                  }}
                >
                  <ShapeGlyph
                    shape={shape}
                    role={node.role}
                    // Discovered nodes are hollow, declared ones filled — the
                    // same distinction the full network's legend claims, so the
                    // reduced map cannot contradict it.
                    hollow={node.kind !== "declared_interest"}
                    dash={provenanceDash(node.provenance)}
                    fillOpacity={0.45 + node.weight * 0.55}
                    size={Math.round(13 + node.weight * 9)}
                  />
                </span>
              );
            })}
          </div>

          {/* The words for the picture. The map is `aria-hidden` because a
              reduced graph with no labels is not a readable alternative to
              anything; this list is what every reader gets, sighted or not. */}
          <ol className="cd-hero__links">
            {discovered.slice(0, 5).map((node) => (
              <li key={node.id} className="cd-hero__link">
                <ShapeGlyph
                  shape={ROLE_SHAPE[node.role] ?? "circle"}
                  role={node.role}
                  hollow={node.kind !== "declared_interest"}
                  dash={provenanceDash(node.provenance)}
                  size={14}
                  className="cd-hero__link-glyph"
                />
                <span className="cd-hero__link-label">{node.label}</span>
                {node.crossDomain ? (
                  <span className="cd-hero__link-flag">cross-domain</span>
                ) : null}
              </li>
            ))}
          </ol>

          <ul className="cd-sr-only">
            {edges.slice(0, 12).map((edge) => {
              const from = drawn.find((node) => node.id === edge.source);
              const to = drawn.find((node) => node.id === edge.target);
              if (from === undefined || to === undefined) return null;
              return (
                <li key={edge.id}>
                  {from.label} {RELATION_WORD[edge.relation] ?? "connects to"} {to.label}.
                </li>
              );
            })}
          </ul>
        </div>

        {/* --- Consequence ---------------------------------------------- */}
        {brand !== undefined ? (
          <footer className="cd-hero__brand">
            <ContentThumbnail
              alt={`${brand.name} artwork`}
              role="brand"
              provenance={source.isIllustrative ? "synthetic" : "qloo"}
              size={44}
            />
            <div className="cd-hero__brand-text">
              <p className="cd-hero__brand-eyebrow cd-eyebrow">Strongest fit</p>
              <p className="cd-hero__brand-name">{brand.name}</p>
              {/* The qualitative label, never the bare percentage. Doc 05 §10E:
                  an unexplained overall number is the least trustworthy thing a
                  product can show, and a hero footer has no room for the
                  breakdown. So this shows the word plus how much of it was
                  evidenced, and the full chart is three scrolls away. */}
              <p className="cd-hero__brand-fit">
                {brand.fit.overall.label}
                <span className="cd-hero__brand-basis cd-tabular">
                  {brand.fit.overall.componentsUsed}/{brand.fit.overall.componentsTotal} dimensions
                </span>
              </p>
            </div>
          </footer>
        ) : null}
      </div>

      {/* --- Satellites: the layered composition ------------------------- */}
      {satelliteNode?.entity !== undefined ? (
        <EntityCard
          entity={satelliteNode.entity}
          role={satelliteNode.role}
          provenance={satelliteNode.provenance}
          affinity={satelliteNode.weight}
          setSize={drawn.length}
          crossDomain={satelliteNode.crossDomain}
          className="cd-hero__satellite cd-hero__satellite--entity"
        />
      ) : null}

      {coreTastes.length > 0 ? (
        <div className="cd-hero__satellite cd-hero__satellite--chips cd-glass">
          <p className="cd-hero__satellite-title cd-eyebrow">Core taste signals</p>
          <div className="cd-hero__satellite-chips">
            {coreTastes.map((taste) => (
              <TasteChip
                key={taste.tag.name}
                label={taste.tag.name}
                role="taste"
                provenance={taste.provenance}
                weight={taste.score}
                count={taste.support}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

function ringPosition(
  index: number,
  total: number,
  radius: number,
  offset: number,
): { x: number; y: number } {
  // A single node would divide by zero and sit at the ring's start angle, which
  // is fine — but a lone node at the top of an empty ring looks broken rather
  // than spare, so it goes in the centre instead.
  if (total <= 1) return { x: MAP_CENTRE, y: MAP_CENTRE };
  const angle = (Math.PI * 2 * index) / total - Math.PI / 2 + offset;
  return {
    x: MAP_CENTRE + radius * Math.cos(angle),
    y: MAP_CENTRE + radius * Math.sin(angle),
  };
}

/**
 * A quadratic curve between two ring positions, bowed toward the centre.
 *
 * Straight chords across a ring cross each other into an unreadable star past
 * about six nodes. Pulling the control point a quarter of the way toward the
 * centre makes neighbouring edges fan apart instead, which is the difference
 * between a diagram and a scribble at hero scale.
 */
function curve(from: { x: number; y: number }, to: { x: number; y: number }): string {
  const midX = (from.x + to.x) / 2;
  const midY = (from.y + to.y) / 2;
  const controlX = midX + (MAP_CENTRE - midX) * 0.35;
  const controlY = midY + (MAP_CENTRE - midY) * 0.35;
  return `M ${from.x.toFixed(1)} ${from.y.toFixed(1)} Q ${controlX.toFixed(1)} ${controlY.toFixed(
    1,
  )} ${to.x.toFixed(1)} ${to.y.toFixed(1)}`;
}
