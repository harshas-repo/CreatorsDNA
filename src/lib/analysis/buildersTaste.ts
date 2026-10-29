import type { CreatorSignals } from "@/lib/contracts/creator";
import type { DataSource, NormalisedScore, Provenance } from "@/lib/contracts/domain";
import type {
  AffinityRankItem,
  AffinityRankingViewModel,
  ColourRole,
  FallbackLevel,
  LegendEntry,
  TasteDnaNetworkViewModel,
  TasteEdge,
  TasteFingerprintViewModel,
  TasteNode,
  VisualizationMeta,
} from "@/lib/contracts/viewModels";
import { NODE_COUNT_LIMITS, ROLE_MEANING, ROLE_SHAPE } from "@/lib/design/colourRoles";
import { isClusteredWithPrevious } from "@/lib/scoring/affinity";
import { hashToHex, round, stableKey } from "@/lib/utils/deterministic";

import { METHODOLOGY } from "./thresholds";
import type { PooledEntity, TasteCategory, TasteDnaResult } from "./tasteDna";

/**
 * Builders for the three taste-side visualisations: A (Taste DNA network),
 * B (cultural affinity ranking) and F (taste fingerprint).
 *
 * These are the "consistent view-models" the execution decision asks for: each
 * builder takes domain data plus a `VisualizationMeta` and returns a plain,
 * serialisable object. The components render them and do no arithmetic of their
 * own, which is what keeps the six charts from drifting apart and what makes
 * them testable without a DOM.
 *
 * Colour policy (R14, `src/lib/design/colourRoles.ts`): every node and edge
 * carries a `role`, never a literal colour. Node KIND is additionally encoded by
 * shape and provenance by line style, so the graph stays legible in greyscale.
 */

// ---------------------------------------------------------------------------
// Shared meta
// ---------------------------------------------------------------------------

export function visualizationMeta(input: {
  source: DataSource;
  provenance: Provenance;
  methodology: string;
  fallbackLevel: FallbackLevel;
  renderable?: boolean;
  omittedReason?: string;
}): VisualizationMeta {
  return {
    source: input.source,
    provenance: input.provenance,
    methodology: input.methodology,
    renderable: input.renderable ?? true,
    omittedReason: input.omittedReason,
    fallbackLevel: input.fallbackLevel,
    containsSynthetic: input.source.isIllustrative || input.provenance === "synthetic",
  };
}

/** `VisualizationMeta` for a level-L4 hard fail: never renderable, reason stated. */
export function unrenderableMeta(
  source: DataSource,
  fallbackLevel: FallbackLevel,
  reason: string,
): VisualizationMeta {
  return {
    source,
    provenance: "derived",
    methodology: METHODOLOGY.withinSetNormalisation,
    renderable: false,
    omittedReason: reason,
    fallbackLevel,
    containsSynthetic: source.isIllustrative,
  };
}

/**
 * Legend entries for a set of roles, deduplicated and order-preserving.
 *
 * Exported so every visualisation builds its legend the same way: a legend is
 * the redundant non-colour encoding doc 05 §11 requires, so it must not drift
 * between charts.
 */
export function legendFor(roles: readonly ColourRole[]): LegendEntry[] {
  const seen = new Set<ColourRole>();
  return roles
    .filter((role) => {
      if (seen.has(role)) return false;
      seen.add(role);
      return true;
    })
    .map((role) => ({
      role,
      label: ROLE_MEANING[role].label,
      shape: ROLE_SHAPE[role],
      description: ROLE_MEANING[role].usedFor,
    }));
}

// ---------------------------------------------------------------------------
// A. Taste DNA network
// ---------------------------------------------------------------------------

/**
 * Node roles are bound to node KIND, not to individual items.
 *
 * That is what makes the colour stable and learnable: cobalt always means "you
 * said this", violet always means "the data source found this", sun always means
 * "a derived descriptor", stone always means "grouping structure". Doc 05 §12
 * asks for exactly this — stable visual roles reused consistently.
 */
const NODE_ROLE = {
  declared_interest: "taste",
  discovered_entity: "secondary",
  taste_tag: "content",
  derived_category: "neutral",
} as const satisfies Record<TasteNode["kind"], ColourRole>;

export interface NetworkInput {
  dna: TasteDnaResult["dna"];
  pool: readonly PooledEntity[];
  signals: CreatorSignals;
  source: DataSource;
  level: FallbackLevel;
  renderable: boolean;
  /** Cap on discovered-entity nodes; tags and categories are capped separately. */
  maxEntityNodes?: number;
  maxTagNodes?: number;
}

export function buildTasteDnaNetwork(input: NetworkInput): TasteDnaNetworkViewModel {
  if (!input.renderable) {
    return {
      viz: "taste-dna-network",
      meta: unrenderableMeta(input.source, input.level, input.dna.levelDescription),
      nodes: [],
      edges: [],
      legend: [],
      groups: [],
      readableNodeLimit: NODE_COUNT_LIMITS.full,
    };
  }

  const maxEntityNodes = input.maxEntityNodes ?? NODE_COUNT_LIMITS.full;
  const maxTagNodes = input.maxTagNodes ?? 10;
  const nodes: TasteNode[] = [];
  const edges: TasteEdge[] = [];

  // -- Declared interests: the creator's own inputs. ------------------------
  const declaredIds = new Set(input.signals.entityIds);
  for (const declared of input.dna.declared) {
    nodes.push({
      id: `declared:${declared.id}`,
      label: declared.label,
      role: NODE_ROLE.declared_interest,
      provenance: "creator",
      kind: "declared_interest",
      weight: 1,
      crossDomain: false,
    });
  }

  // -- Derived categories: the grouping layer. ------------------------------
  const categories = input.dna.categories.slice(0, 12);
  for (const category of categories) {
    nodes.push({
      id: `category:${category.id}`,
      label: category.label,
      role: NODE_ROLE.derived_category,
      provenance: "derived",
      kind: "derived_category",
      weight: round(category.score, 4),
      category: category.id,
      crossDomain: false,
    });
  }

  // -- Discovered entities. --------------------------------------------------
  const entities = input.pool
    .filter((entity) => !declaredIds.has(entity.id))
    .slice(0, maxEntityNodes);
  for (const entity of entities) {
    const category = entity.subtype ?? entity.type;
    nodes.push({
      id: `entity:${entity.id}`,
      label: entity.name,
      role: NODE_ROLE.discovered_entity,
      provenance: entity.provenance,
      kind: "discovered_entity",
      weight: round(entity.rank.value, 4),
      category,
      crossDomain: entity.origin === "cross_domain_backfill",
      entity: {
        id: entity.id,
        name: entity.name,
        subtype: entity.subtype,
        popularity: entity.popularity,
        imageUrl: entity.imageUrl,
      },
    });

    // Declared interest → discovered entity: the recommendation relation.
    // Strength is the entity's within-set normalised affinity, never a raw one.
    for (const declaredId of declaredIds) {
      const contributed = entity.explainability.contributions.find(
        (contribution) => contribution.signalEntityId === declaredId,
      );
      if (contributed === undefined) continue;
      edges.push({
        id: `rec:${declaredId}->${entity.id}`,
        source: `declared:${declaredId}`,
        target: `entity:${entity.id}`,
        strength: round(contributed.score, 4),
        relation: "recommended",
        role: NODE_ROLE.discovered_entity,
      });
    }

    // Entity → its category.
    if (categories.some((category) => category.id === (entity.subtype ?? entity.type))) {
      edges.push({
        id: `cat:${entity.id}->${category}`,
        source: `entity:${entity.id}`,
        target: `category:${category}`,
        strength: 1,
        relation: "categorised",
        role: NODE_ROLE.derived_category,
      });
    }
  }

  // -- Derived taste tags (method M3). --------------------------------------
  const tags = input.dna.coreTastes.slice(0, maxTagNodes);
  for (const tag of tags) {
    nodes.push({
      id: `tag:${tag.tag.id}`,
      label: tag.tag.name,
      role: NODE_ROLE.taste_tag,
      provenance: tag.provenance,
      kind: "taste_tag",
      weight: round(tag.score, 4),
      crossDomain: false,
    });
    // Tag → the entities that carried it: the co-occurrence evidence trail.
    for (const contributor of tag.contributedBy.slice(0, 4)) {
      if (!nodes.some((node) => node.id === `entity:${contributor.entityId}`)) continue;
      edges.push({
        id: `co:${tag.tag.id}->${contributor.entityId}`,
        source: `entity:${contributor.entityId}`,
        target: `tag:${tag.tag.id}`,
        strength: round(contributor.weight, 4),
        relation: "co_occurs",
        role: NODE_ROLE.taste_tag,
      });
    }
  }

  // -- Fallback edges -------------------------------------------------------
  // When explainability is absent (level L3) there are no contribution links, so
  // the graph would be a set of disconnected islands. Connect each declared
  // interest to the categories it plausibly produced, marked `categorised` and
  // provenance `derived`, so the structure is visible and honestly labelled as
  // ours rather than the data source's.
  const hasRecommendationEdges = edges.some((edge) => edge.relation === "recommended");
  if (!hasRecommendationEdges) {
    for (const category of categories) {
      for (const declared of input.dna.declared) {
        edges.push({
          id: `derived:${declared.id}->${category.id}`,
          source: `declared:${declared.id}`,
          target: `category:${category.id}`,
          strength: round(category.score, 4),
          relation: "categorised",
          role: NODE_ROLE.derived_category,
        });
      }
    }
  }

  const groups = categories.map((category) => ({
    id: category.id,
    label: category.label,
    role: NODE_ROLE.derived_category,
    nodeIds: nodes
      .filter((node) => node.category === category.id)
      .map((node) => node.id),
  }));

  return {
    viz: "taste-dna-network",
    meta: visualizationMeta({
      source: input.source,
      provenance: dominantProvenance(nodes.map((node) => node.provenance)),
      methodology: `${METHODOLOGY.withinSetNormalisation} ${METHODOLOGY.m3Tags}`,
      fallbackLevel: input.level,
    }),
    nodes,
    edges,
    legend: legendFor([
      NODE_ROLE.declared_interest,
      NODE_ROLE.discovered_entity,
      NODE_ROLE.taste_tag,
      NODE_ROLE.derived_category,
    ]),
    groups,
    readableNodeLimit: NODE_COUNT_LIMITS.full,
  };
}

// ---------------------------------------------------------------------------
// B. Cultural affinity ranking
// ---------------------------------------------------------------------------

/**
 * Soft bands.
 *
 * These are LABELS, not thresholds with meaning. Doc 03 §15 is explicit that
 * affinity is normalised per query and depressed by filters, and that top
 * results genuinely cluster — so a band boundary cannot claim to separate "good"
 * from "bad". The wording says "relative to this result set" and nothing more,
 * and doc 05 §12's ban on red/green good-bad encoding is respected by giving all
 * three bands the same neutral role.
 */
const AFFINITY_BANDS = [
  { id: "upper", label: "Upper part of this result set", min: 0.66, max: 1 },
  { id: "middle", label: "Middle of this result set", min: 0.33, max: 0.66 },
  { id: "lower", label: "Lower part of this result set", min: 0, max: 0.33 },
] as const;

export interface RankingInput {
  pool: readonly PooledEntity[];
  source: DataSource;
  level: FallbackLevel;
  renderable: boolean;
  /** Entity ids the creator selected. These get the `taste` role so the chart
   *  visually separates "you said this" from "this was found". */
  declaredEntityIds?: readonly string[];
  /** Entity id → the name the creator saw when selecting it. Used to label the
   *  evidence trail when the data source returned only an id. */
  declaredNames?: Record<string, string>;
  maxItems?: number;
  tieTolerance?: number;
}

export function buildAffinityRanking(input: RankingInput): AffinityRankingViewModel {
  if (!input.renderable || input.pool.length === 0) {
    return {
      viz: "cultural-affinity-ranking",
      meta: unrenderableMeta(
        input.source,
        input.level,
        input.pool.length === 0
          ? "No results were returned, so there is nothing to rank."
          : "The ranking cannot be shown at this fallback level.",
      ),
      items: [],
      normalisation: "unavailable",
      setSize: 0,
      legend: [],
      bands: [],
    };
  }

  const tolerance = input.tieTolerance ?? 0.02;
  const maxItems = input.maxItems ?? 20;
  const declared = new Set(input.declaredEntityIds ?? []);
  const ordered = [...input.pool].sort(
    (a, b) => b.rank.value - a.rank.value || a.rank.rank - b.rank.rank || a.name.localeCompare(b.name),
  );

  const items: AffinityRankItem[] = ordered.slice(0, maxItems).map((entity, index) => ({
    id: entity.id,
    label: entity.name,
    category: entity.subtype ?? entity.type,
    score: round(entity.rank.value, 4),
    rank: index + 1,
    role: declared.has(entity.id) ? "taste" : "secondary",
    provenance: entity.provenance,
    // Doc 03 §15: a one-point gap is not a real gap. Marking it stops the UI from
    // manufacturing a winner out of noise.
    clusteredWithNeighbour:
      index > 0
        ? isClusteredWithPrevious(
            ordered[index]!.rank.value,
            ordered[index - 1]!.rank.value,
            tolerance,
          )
        : false,
    // Explainability contributions become the inspect-on-click evidence trail.
    // When explainability is absent (level L3) this is empty and the UI says so
    // rather than substituting a guess.
    support: entity.explainability.contributions.map((contribution) => ({
      entityId: contribution.signalEntityId,
      // `signalName` is optional in the contract because the mapper may only have
      // an id to work with. Falling back to the declared name and then to the id
      // keeps the evidence trail usable without inventing a label.
      entityName:
        contribution.signalName ??
        input.declaredNames?.[contribution.signalEntityId] ??
        contribution.signalEntityId,
      weight: round(contribution.score, 4),
    })),
    definition: entity.disambiguation || entity.description || undefined,
  }));

  // How many of the SHOWN rows are the creator's own confirmed interests. They
  // sit in this ranking at full weight rather than at a normalised position, so
  // the count belongs in the methodology line next to the coverage figure: a
  // reader who is told "20 of 20 results" and sees 6 bars at identical full
  // length is otherwise left to guess whether that is a tie or a different kind
  // of row.
  const confirmedInRanking = items.filter((item) => item.role === "taste").length;

  return {
    viz: "cultural-affinity-ranking",
    meta: visualizationMeta({
      source: input.source,
      provenance: dominantProvenance(items.map((item) => item.provenance)),
      methodology: `${METHODOLOGY.withinSetNormalisation} Ranking covers ${items.length} of ${input.pool.length} results${
        confirmedInRanking > 0
          ? `, ${confirmedInRanking} of them confirmed by you`
          : ""
      }.`,
      fallbackLevel: input.level,
    }),
    items,
    normalisation: dominantMethod(input.pool),
    setSize: input.pool.length,
    legend: legendFor(["taste", "secondary"]),
    bands: [...AFFINITY_BANDS],
  };
}

/**
 * Which normalisation the ranking's footnote should name.
 *
 * The pool is a merge of separately-normalised result sets, so there is no single
 * true answer and this is a plurality. Two rules keep the plurality honest:
 *
 *  1. Creator-confirmed entities are counted but do not win while a real
 *     normalisation is present. They were never normalised at all, and their rows
 *     already carry the `confirmed` marker, so naming the method that produced the
 *     other bars describes more of the arithmetic on screen than naming one that
 *     produced none of it.
 *  2. They DO win when they are all there is. A creator whose niche is narrow
 *     enough that expansion returned nothing would otherwise fall through to
 *     `unavailable` and be told "no usable affinity was returned" while looking at
 *     a full chart of their own confirmed interests.
 */
function dominantMethod(pool: readonly PooledEntity[]): NormalisedScore["method"] {
  const counts: Record<NormalisedScore["method"], number> = {
    minmax: 0,
    rank: 0,
    declared: 0,
    unavailable: 0,
  };
  for (const entity of pool) counts[entity.rank.method] += 1;
  if (counts.minmax > 0 && counts.minmax >= counts.rank && counts.minmax >= counts.unavailable) {
    return "minmax";
  }
  if (counts.rank > 0 && counts.rank >= counts.unavailable) return "rank";
  if (counts.declared > 0) return "declared";
  return "unavailable";
}

// ---------------------------------------------------------------------------
// F. Taste fingerprint
// ---------------------------------------------------------------------------

export interface FingerprintInput {
  dna: TasteDnaResult["dna"];
  source: DataSource;
  level: FallbackLevel;
  renderable: boolean;
  /** Identity of the creator, mixed into the signature. */
  creatorId: string;
  maxSpokes?: number;
  maxMarkers?: number;
}

/**
 * Build the taste fingerprint (doc 05 §10F).
 *
 * The doc's explicit requirement is that two creators with different data cannot
 * receive the same decorative graphic. `signature` is therefore a hash over the
 * ACTUAL profile values — category scores and tag weights, not just their names —
 * so a change in any number changes the glyph. It is also stable across renders,
 * which is what lets the shape be used as an identity rather than a random
 * decoration.
 */
export function buildTasteFingerprint(input: FingerprintInput): TasteFingerprintViewModel {
  if (!input.renderable) {
    return {
      viz: "taste-fingerprint",
      meta: unrenderableMeta(input.source, input.level, input.dna.levelDescription),
      signature: "",
      spokes: [],
      markers: [],
      legend: [],
    };
  }

  const maxSpokes = input.maxSpokes ?? 8;
  const maxMarkers = input.maxMarkers ?? 10;

  const spokes = input.dna.categories.slice(0, maxSpokes).map((category) => ({
    axis: category.id,
    label: category.label,
    value: round(category.score, 4),
    role: "content" as ColourRole,
    provenance: "derived" as Provenance,
  }));

  const markers = input.dna.coreTastes.slice(0, maxMarkers).map((tag) => ({
    id: tag.tag.id,
    label: tag.tag.name,
    weight: round(tag.score, 4),
    role: "taste" as ColourRole,
  }));

  const signature = hashToHex(
    stableKey({
      creator: input.creatorId,
      spokes: spokes.map((spoke) => [spoke.axis, spoke.value]),
      markers: markers.map((marker) => [marker.id, marker.weight]),
      emerging: input.dna.emergingSignals.map((signal) => [signal.id, signal.affinity]),
    }),
  );

  return {
    viz: "taste-fingerprint",
    meta: visualizationMeta({
      source: input.source,
      provenance: "derived",
      methodology: METHODOLOGY.fingerprint,
      fallbackLevel: input.level,
    }),
    signature,
    spokes,
    markers,
    legend: legendFor(["taste", "content"]),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Dominant provenance across a set of values.
 *
 * `synthetic` wins outright: if any value on screen is illustrative, the whole
 * visualisation must carry the illustrative banner. Biasing the other way would
 * let one synthetic value hide inside an otherwise-live chart.
 */
export function dominantProvenance(values: readonly Provenance[]): Provenance {
  if (values.length === 0) return "derived";
  if (values.includes("synthetic")) return "synthetic";
  if (values.every((value) => value === "creator")) return "creator";
  if (values.includes("qloo")) return "qloo";
  return "derived";
}

export type { TasteCategory };
