import type { CreatorSignals } from "@/lib/contracts/creator";
import type {
  CulturalEntity,
  CulturalTag,
  EntityResultSet,
  ProviderObservation,
  ScoredTasteTag,
  TagResultSet,
} from "@/lib/contracts/domain";
import {
  FALLBACK_DESCRIPTIONS,
  type CoverageBasis,
  type FallbackLevel,
  type TasteDna,
} from "@/lib/contracts/viewModels";
import { isSurfaceableTag } from "@/lib/providers/qloo/tagCuration";
import { clamp, normaliseCategory, round } from "@/lib/utils/deterministic";

import { categoryLabel } from "./categoryLabels";
import { DEFAULT_THRESHOLDS, type AnalysisThresholds } from "./thresholds";

/**
 * Re-exported so existing importers keep one source. The implementation moved to
 * `./categoryLabels` because a category label must be a property of the category
 * ID, not of one entity inside it — see that module's header.
 */
export { categoryLabel };

/**
 * Taste DNA assembly (doc 02 §17, doc 04 §4).
 *
 * The pipeline is exactly the documented one —
 *   input entities + tags + related entities + affinities
 *   → normalise → deduplicate → group by category → rank
 *   → separate explicit from discovered → Taste DNA
 *
 * and it is built for **L1**, the expected baseline. Two consequences of that
 * choice, both required by doc 04 §4.5:
 *
 *   - M1 (scored tag insights) is an ENHANCEMENT LAYER at half weight. The whole
 *     structure still stands when it is absent, which the documented evidence
 *     says is the likely case.
 *   - Reaching L2 means changing which value feeds the aggregation (`rank.value`
 *     is already used everywhere, and it is rank-derived automatically when
 *     affinity is absent), not restructuring anything.
 *
 * L4 is handled first and short-circuits: when the provider reports that signals
 * appear to have been ignored, this returns an empty Taste DNA at level L4 and
 * `renderable: false`. Rendering generic output as personalised is the one
 * outcome doc 02 §16 and doc 04 §4.5 both call unacceptable.
 */

/** How much weight an M1 scored tag contributes relative to M3 evidence. */
const M1_INFLUENCE = 0.5;

export interface PooledEntity extends CulturalEntity {
  /** Which result set this row was kept from, for the evidence trail. */
  sourceSet: number;
  /** True when the same id appeared in more than one result set. */
  duplicated: boolean;
}

export interface TasteDnaInput {
  signals: CreatorSignals;
  /** Creator-declared content categories, lowercased by the caller or not. */
  declaredCategories: readonly string[];
  entityResults: readonly EntityResultSet[];
  /** M1. May be present but `unscored`, which is the documented expectation. */
  tagResults?: TagResultSet;
  /**
   * Observations the pipeline itself produced, rather than a result-set mapper.
   *
   * The silent-ignore check (doc 03 §11) has to compare two calls against each
   * other, and no single mapper can do that — it only ever sees one response. So
   * the pipeline runs the comparison and injects its conclusion here, where the
   * L4 short-circuit can act on it alongside everything else.
   */
  pipelineObservations?: readonly ProviderObservation[];
  thresholds?: AnalysisThresholds;
}

export interface TasteDnaResult {
  dna: TasteDna;
  level: FallbackLevel;
  /** False only at L4. The UI must refuse to render when this is false. */
  renderable: boolean;
  /** Every condition that forced a degradation, in the order detected. */
  degradations: string[];
  /** Union of all provider observations, for the honesty panel. */
  observations: ProviderObservation[];
  /** Deduplicated entity pool, sorted by within-set normalised score. */
  pool: PooledEntity[];
  /** Derived taste tags before the `maxCoreTastes` cut. */
  allTags: ScoredTasteTag[];
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function assembleTasteDna(input: TasteDnaInput): TasteDnaResult {
  const thresholds = input.thresholds ?? DEFAULT_THRESHOLDS;
  const observations = [
    ...collectObservations(input.entityResults, input.tagResults),
    ...(input.pipelineObservations ?? []),
  ];

  // -- L4 short-circuit ----------------------------------------------------
  // Doc 03 §11's mitigation: the provider compares a signalled call against an
  // unpersonalised baseline and emits `signals_appear_ignored` when they match.
  // Nothing downstream may run in that state.
  const ignored = observations.filter((o) => o.code === "signals_appear_ignored");
  if (ignored.length > 0) {
    return {
      dna: emptyTasteDna("L4", input.signals),
      level: "L4",
      renderable: false,
      degradations: ignored.map((o) => o.detail),
      observations,
      pool: [],
      allTags: [],
    };
  }

  const pool = poolEntities(input.entityResults);
  const declaredCategories = normaliseCategoryList(input.declaredCategories, pool, input.signals);

  const degradations: string[] = [];
  const allTags = deriveCoreTastes(pool, input.tagResults, thresholds, degradations);
  const categories = deriveCategories(pool);
  const emergingSignals = deriveEmergingSignals(
    pool,
    thresholds,
    new Set(input.signals.entityIds),
  );
  const unexpectedAffinities = deriveUnexpectedAffinities(
    pool,
    categories,
    declaredCategories,
    input.signals,
    thresholds,
  );

  const level = determineLevel({
    pool,
    tagResults: input.tagResults,
    observations,
    allTags,
    degradations,
  });

  return {
    dna: {
      level,
      levelDescription: FALLBACK_DESCRIPTIONS[level],
      coreTastes: allTags.slice(0, thresholds.maxCoreTastes),
      categories,
      emergingSignals,
      unexpectedAffinities,
      declared: declaredList(input.signals),
      discovered: discoveredList(pool, input.signals),
    },
    level,
    renderable: level !== "L4",
    degradations,
    observations,
    pool,
    allTags,
  };
}

// ---------------------------------------------------------------------------
// Pooling & deduplication
// ---------------------------------------------------------------------------

/**
 * Merge every result set into one deduplicated pool.
 *
 * When an id appears in more than one set, the row kept is the one with the
 * HIGHER within-set normalised score. Cross-set comparison of raw affinities is
 * forbidden (doc 04 §4.4) — but within-set normalised values are both on 0..1
 * relative to their own set, so choosing the better of two is the only
 * defensible merge, and the discarded row is recorded rather than hidden.
 *
 * Recorded as assumption: this is a merge rule doc 04 does not specify. It is
 * deterministic, it never invents a value, and the alternative (keeping the
 * first row seen) would make output depend on call order.
 */
export function poolEntities(resultSets: readonly EntityResultSet[]): PooledEntity[] {
  const best = new Map<string, PooledEntity>();

  resultSets.forEach((resultSet, sourceSet) => {
    for (const entity of resultSet.entities) {
      const existing = best.get(entity.id);
      if (existing === undefined) {
        best.set(entity.id, { ...entity, sourceSet, duplicated: false });
        continue;
      }
      const pooled: PooledEntity = { ...existing, duplicated: true };
      if (entity.rank.value > existing.rank.value) {
        best.set(entity.id, { ...entity, sourceSet, duplicated: true });
      } else {
        best.set(entity.id, pooled);
      }
    }
  });

  return [...best.values()].sort(
    (a, b) => b.rank.value - a.rank.value || a.name.localeCompare(b.name),
  );
}

// ---------------------------------------------------------------------------
// Categories ("cultural connections", doc 04 §4.3)
// ---------------------------------------------------------------------------

export interface TasteCategory {
  id: string;
  label: string;
  subtype: string;
  score: number;
  entities: Array<{ id: string; name: string; weight: number }>;
}

/**
 * Group results by `subtype` and score each group by the mean within-set
 * normalised affinity of its members.
 *
 * Mean rather than max: a category represented by many decent results is a
 * stronger connection than one carried by a single outlier. Ties break on the
 * category id so the ordering is stable across runs.
 */
export function deriveCategories(pool: readonly PooledEntity[]): TasteCategory[] {
  const groups = new Map<string, PooledEntity[]>();
  for (const entity of pool) {
    const key = categoryId(entity);
    const bucket = groups.get(key);
    if (bucket) bucket.push(entity);
    else groups.set(key, [entity]);
  }

  return [...groups.entries()]
    .map(([id, members]) => ({
      id,
      // Labelled from the id alone. `members[0]` used to be passed in and its
      // `disambiguation` used as the category's name, which showed one entity's
      // description as the label for a whole set.
      label: categoryLabel(id),
      subtype: members[0]?.subtype ?? members[0]?.type ?? id,
      score: round(
        members.reduce((sum, member) => sum + member.rank.value, 0) / members.length,
        4,
      ),
      entities: members
        .map((member) => ({
          id: member.id,
          name: member.name,
          weight: round(member.rank.value, 4),
        }))
        .sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => b.score - a.score || b.entities.length - a.entities.length || a.id.localeCompare(b.id));
}

export function categoryId(entity: Pick<CulturalEntity, "subtype" | "type">): string {
  return entity.subtype ?? entity.type ?? "unknown";
}

/**
 * The category vocabulary a set of confirmed entities implies.
 *
 * This is the list the coverage step is rendered against, which is the whole
 * point of it: `coverageOf` normalises both sides with `normaliseCategory`, so a
 * saturation record keyed by these ids matches the derived categories by
 * construction. The previous flow asked creators to type free-text categories
 * ("Film criticism"), which could never match a derived id (`urn:entity:movie`),
 * so every coverage lookup fell through to its "not listed" branch and the
 * opportunity-gap chart compared two incommensurable vocabularies.
 *
 * Order is first-seen, which is affinity order because the pool is sorted.
 */
export function categoryIdsFor(entities: ReadonlyArray<Pick<CulturalEntity, "subtype" | "type">>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entity of entities) {
    const id = categoryId(entity);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Core tastes — method M3, with M1 as an enhancement layer
// ---------------------------------------------------------------------------

/**
 * Doc 04 §4.2, implemented literally:
 *
 *   rawWeight(t) = Σ norm(a_r)   over results r where t ∈ T_r
 *   support(t)   = count of such r
 *   tagScore(t)  = rawWeight(t) / totalWeight
 *
 * `norm(a_r)` is `entity.rank.value` — already within-set normalised by the
 * mapper, so the forbidden cross-call comparison never happens.
 *
 * The namespace curation filter (doc 03 §17) is applied BEFORE aggregation.
 * Without it a plot keyword carried by three results would surface as a taste,
 * which is exactly the failure doc 04 §4.2 names.
 */
export function deriveCoreTastes(
  pool: readonly PooledEntity[],
  tagResults: TagResultSet | undefined,
  thresholds: AnalysisThresholds,
  degradations: string[] = [],
): ScoredTasteTag[] {
  const raw = new Map<
    string,
    { tag: CulturalTag; weight: number; support: number; contributedBy: ScoredTasteTag["contributedBy"] }
  >();

  for (const entity of pool) {
    for (const tag of entity.tags) {
      if (!isSurfaceableTag(tag)) continue;
      const existing = raw.get(tag.id);
      const weight = entity.rank.value;
      if (existing) {
        existing.weight += weight;
        existing.support += 1;
        existing.contributedBy.push({
          entityId: entity.id,
          entityName: entity.name,
          weight: round(weight, 4),
        });
      } else {
        raw.set(tag.id, {
          tag,
          weight,
          support: 1,
          contributedBy: [
            { entityId: entity.id, entityName: entity.name, weight: round(weight, 4) },
          ],
        });
      }
    }
  }

  // M1 enhancement: scored tag insights, at reduced influence because the
  // capability is unverified (doc 04 §4.1). Only used when the API actually
  // returned scores — the documented example has `"query": {}`.
  const m1 = new Map<string, number>();
  if (tagResults && !tagResults.unscored && tagResults.tags.length > 0) {
    const maxM1 = Math.max(...tagResults.tags.map((entry) => entry.score), 0);
    if (maxM1 > 0) {
      for (const entry of tagResults.tags) {
        m1.set(entry.tag.id, (entry.score / maxM1) * M1_INFLUENCE);
      }
    }
  } else if (tagResults?.unscored) {
    degradations.push(
      "Tag insights were returned without scores, so taste tags are derived from entity co-occurrence (method M3) rather than from the tag endpoint (method M1).",
    );
  }

  const combined = new Map<string, { weight: number; support: number }>();
  for (const [id, entry] of raw) combined.set(id, { weight: entry.weight, support: entry.support });
  for (const [id, weight] of m1) {
    const existing = combined.get(id);
    if (existing) existing.weight += weight;
    else combined.set(id, { weight, support: 0 });
  }

  const totalWeight = [...combined.values()].reduce((sum, entry) => sum + entry.weight, 0);
  if (totalWeight <= 0) {
    degradations.push("No surfaceable taste tags could be derived from the returned results.");
    return [];
  }

  const provenance = pool[0]?.provenance ?? "derived";
  const scored: ScoredTasteTag[] = [...combined.entries()]
    .map(([id, entry]) => {
      const source = raw.get(id);
      return {
        tag: source?.tag ?? { id, name: tagNameFromId(id), provenance },
        score: round(entry.weight / totalWeight, 4),
        support: entry.support,
        contributedBy: (source?.contributedBy ?? []).sort(
          (a, b) => b.weight - a.weight || a.entityName.localeCompare(b.entityName),
        ),
        provenance: source ? "derived" : provenance,
      };
    })
    // Support filter: an M1-only tag has support 0 and is kept, because the API
    // itself asserted it. An M3 tag needs `minTagSupport` results behind it.
    .filter((entry) => entry.support >= thresholds.minTagSupport || entry.support === 0)
    .sort((a, b) => b.score - a.score || b.support - a.support || a.tag.name.localeCompare(b.tag.name));

  return collapseDuplicateTastes(scored);
}

/**
 * Collapse taste tags that differ only by namespace.
 *
 * Aggregation is keyed by `tag.id`, and Qloo carries the same surface word in
 * several namespaces (`urn:tag:genre:rock:qloo` and a MusicBrainz genre tag both
 * render as "Rock"). Both survive the id-keyed pass, so the taste list showed the
 * same word twice with two different scores — which reads as a bug to a creator
 * and wastes two of the handful of slots `maxCoreTastes` allows.
 *
 * Scores are already normalised fractions of `totalWeight`, so summing them keeps
 * the list summing to 1 without a second normalisation pass. The representative
 * tag object is the higher-scoring one, so the displayed definition and
 * provenance come from the stronger evidence rather than from whichever
 * namespace happened to sort first.
 */
export function collapseDuplicateTastes(scored: readonly ScoredTasteTag[]): ScoredTasteTag[] {
  const byName = new Map<string, ScoredTasteTag>();

  for (const entry of scored) {
    // A tag with no name cannot be deduplicated against anything; keying it by
    // its id keeps it distinct without inventing a name for it.
    const name = entry.tag.name.trim();
    const key = name.length === 0 ? `\u0000${entry.tag.id}` : name.toLowerCase();

    const existing = byName.get(key);
    if (existing === undefined) {
      byName.set(key, { ...entry, contributedBy: [...entry.contributedBy] });
      continue;
    }

    const representative = entry.score > existing.score ? entry : existing;
    const merged = mergeContributors(existing.contributedBy, entry.contributedBy);
    byName.set(key, {
      tag: representative.tag,
      score: round(existing.score + entry.score, 4),
      // Distinct entities, not summed counts: the same result carrying the word
      // in two namespaces is one piece of support, not two.
      support: merged.length > 0 ? merged.length : existing.support + entry.support,
      contributedBy: merged,
      provenance: representative.provenance,
    });
  }

  return [...byName.values()].sort(
    (a, b) => b.score - a.score || b.support - a.support || a.tag.name.localeCompare(b.tag.name),
  );
}

/** Union of two contributor lists, keeping the strongest weight per entity. */
function mergeContributors(
  a: ScoredTasteTag["contributedBy"],
  b: ScoredTasteTag["contributedBy"],
): ScoredTasteTag["contributedBy"] {
  const best = new Map<string, ScoredTasteTag["contributedBy"][number]>();
  for (const entry of [...a, ...b]) {
    const existing = best.get(entry.entityId);
    if (existing === undefined || entry.weight > existing.weight) best.set(entry.entityId, entry);
  }
  return [...best.values()].sort(
    (x, y) => y.weight - x.weight || x.entityName.localeCompare(y.entityName),
  );
}

// ---------------------------------------------------------------------------
// Emerging signals
// ---------------------------------------------------------------------------

/**
 * High normalised affinity + low catalogue popularity (doc 04 §4.3).
 *
 * Both numbers are in every response and neither depends on an unverified
 * assumption, which is why doc 04 calls this "a P0 component that rests
 * entirely on confirmed facts". Ranked by affinity descending, then by how
 * obscure the entity is, so the list is stable.
 *
 * Confirmed interests are excluded. An emerging signal is by definition something
 * the creator has NOT already named, and confirmed entities sit in the pool at full
 * weight — so without this filter they would pass the affinity test by construction
 * and be handed back to the person who supplied them as a discovery. The same rule
 * `deriveUnexpectedAffinities` applies as its criterion 1.
 */
export function deriveEmergingSignals(
  pool: readonly PooledEntity[],
  thresholds: AnalysisThresholds,
  declaredIds: ReadonlySet<string> = new Set(),
): TasteDna["emergingSignals"] {
  return pool
    .filter(
      (entity) =>
        !declaredIds.has(entity.id) &&
        entity.rank.value >= thresholds.emergingMinAffinity &&
        entity.popularity !== undefined &&
        entity.popularity <= thresholds.emergingMaxPopularity,
    )
    .sort(
      (a, b) =>
        b.rank.value - a.rank.value ||
        (a.popularity ?? 0) - (b.popularity ?? 0) ||
        a.name.localeCompare(b.name),
    )
    .slice(0, thresholds.maxEmerging)
    .map((entity) => ({
      id: entity.id,
      label: entity.name,
      affinity: round(entity.rank.value, 4),
      popularity: round(entity.popularity ?? 0, 4),
    }));
}

// ---------------------------------------------------------------------------
// Unexpected affinities
// ---------------------------------------------------------------------------

/**
 * The four criteria of doc 02 §18, applied as a deterministic filter and then a
 * deterministic ranking — never "the top five results", which the doc warns
 * against explicitly.
 *
 *   1. not explicitly selected by the creator
 *   2. meaningful relevance  → rank.value ≥ unexpectedMinAffinity
 *   3. culturally meaningful category → a real entity subtype, and the entity
 *      carries at least one surfaceable tag
 *   4. sufficiently different → tag-overlap with the declared categories below
 *      unexpectedMaxCategorySimilarity
 *
 * Ranking is `distance × affinity`: an affinity that is both strong and far from
 * the declared taste outranks one that is merely strong. `apiSourced` records
 * whether the row came from `backfill.cross_domain`, so the UI can distinguish
 * the API's own "beyond your niche" signal from our set difference.
 */
export function deriveUnexpectedAffinities(
  pool: readonly PooledEntity[],
  categories: readonly TasteCategory[],
  declaredCategories: readonly string[],
  signals: CreatorSignals,
  thresholds: AnalysisThresholds,
): TasteDna["unexpectedAffinities"] {
  const declaredIds = new Set(signals.entityIds);
  const declaredSet = new Set(declaredCategories.map(normaliseCategory));
  const declaredTagIds = declaredTagIdsFor(pool, declaredSet);

  const scored: Array<TasteDna["unexpectedAffinities"][number] & { distance: number }> = [];

  for (const entity of pool) {
    // Criterion 1.
    if (declaredIds.has(entity.id)) continue;

    const category = categoryId(entity);
    if (declaredSet.has(normaliseCategory(category))) continue;
    // A category must not be surfaced as one of its own members. An entity whose
    // id the creator already declared as a category is the category itself, and
    // presenting it as an "unexpected affinity" is a tautology.
    if (declaredSet.has(normaliseCategory(entity.id))) continue;

    // Criterion 2.
    if (entity.rank.value < thresholds.unexpectedMinAffinity) continue;

    // Criterion 3.
    const surfaceable = entity.tags.filter((tag) => isSurfaceableTag(tag));
    if (category === "unknown" || surfaceable.length === 0) continue;

    // Criterion 4.
    const overlap = descriptorOverlap(
      surfaceable.map((tag) => tag.id),
      declaredTagIds,
    );
    if (overlap.ratio > thresholds.unexpectedMaxCategorySimilarity) continue;

    const renderedCategory = categoryLabel(category);
    // Same rule from the other direction: when the entity's own name IS the
    // rendered category name, the row says nothing ("Rock" inside "Rock") and
    // reads as a duplicate of the category list.
    if (entity.name.trim().toLowerCase() === renderedCategory.toLowerCase()) continue;

    const distance = 1 - overlap.ratio;
    const reasons = buildUnexpectedReasons(entity, renderedCategory, overlap);
    scored.push({
      id: entity.id,
      label: entity.name,
      category: renderedCategory,
      affinity: round(entity.rank.value, 4),
      reasons,
      apiSourced: entity.origin === "cross_domain_backfill",
      distance: round(distance, 4),
    });
  }

  return scored
    .sort(
      (a, b) =>
        b.distance * b.affinity - a.distance * a.affinity ||
        b.affinity - a.affinity ||
        a.label.localeCompare(b.label),
    )
    .slice(0, thresholds.maxUnexpected)
    .map(({ distance: _distance, ...rest }) => rest);
}

/**
 * The four criteria as sentences, each tied to the evidence actually used.
 *
 * `rank.method` is consulted rather than assumed. The previous text always
 * claimed a min-max normalised 0–1 affinity, but the mapper falls back to rank
 * position when every affinity in a set ties, and to `unavailable` when it has
 * nothing to work with. Describing a rank-derived position as a measured
 * relevance is a claim the returned data does not support, so the wording follows
 * the method and the claim is omitted entirely when there is no basis.
 */
function buildUnexpectedReasons(
  entity: PooledEntity,
  renderedCategory: string,
  overlap: DescriptorOverlap,
): string[] {
  const reasons: string[] = [];
  reasons.push("You did not select this — it came from the recommendation set.");

  if (entity.rank.method === "minmax") {
    reasons.push(
      `Meaningful relevance: affinity ${entity.rank.value.toFixed(2)} on a 0–1 scale, min-max normalised within its own result set of ${entity.rank.setSize}. It is a position in that set, not a percentage of anything.`,
    );
  } else if (entity.rank.method === "rank") {
    reasons.push(
      `Meaningful relevance: the affinities in its result set were indistinguishable, so this is its position in that set (${entity.rank.value.toFixed(2)} of 1, higher is closer to the top) rather than a measured score.`,
    );
  } else {
    reasons.push(
      "Meaningful relevance: the data source returned no usable affinity for this result set, so no score is claimed — it qualified on category distance and the API's own inclusion, not on a number.",
    );
  }

  reasons.push(`Belongs to a distinct cultural category (${renderedCategory}).`);
  reasons.push(
    overlap.declaredCount === 0
      ? `Sufficiently different: your declared categories produced no descriptors to compare against, so this sits entirely outside them.`
      : `Sufficiently different: shares ${overlap.shared} of its ${overlap.candidateCount} descriptors with the ${overlap.declaredCount} your declared categories carry.`,
  );
  if (entity.origin === "cross_domain_backfill") {
    reasons.push("Flagged by the data source as a cross-domain result, not just inferred by us.");
  }
  return reasons;
}

/** Tag ids carried by entities inside the declared categories. */
function declaredTagIdsFor(
  pool: readonly PooledEntity[],
  declaredSet: ReadonlySet<string>,
): Set<string> {
  const ids = new Set<string>();
  for (const entity of pool) {
    if (!declaredSet.has(normaliseCategory(categoryId(entity)))) continue;
    for (const tag of entity.tags) {
      if (isSurfaceableTag(tag)) ids.add(tag.id);
    }
  }
  return ids;
}

export interface DescriptorOverlap {
  /** Jaccard overlap, 0..1. */
  ratio: number;
  /** Descriptors present on both sides. */
  shared: number;
  candidateCount: number;
  declaredCount: number;
}

/**
 * Descriptor overlap between a candidate and the creator's declared categories.
 *
 * Returns the raw counts alongside the ratio so the generated copy can cite
 * concrete numbers ("shares 2 of its 5 descriptors") instead of a bare
 * percentage, which is easier to misread as a share of an audience.
 */
function descriptorOverlap(
  candidateIds: readonly string[],
  declaredIds: ReadonlySet<string>,
): DescriptorOverlap {
  const candidate = new Set(candidateIds);
  if (candidate.size === 0 || declaredIds.size === 0) {
    return { ratio: 0, shared: 0, candidateCount: candidate.size, declaredCount: declaredIds.size };
  }
  let shared = 0;
  for (const id of candidate) if (declaredIds.has(id)) shared += 1;
  const union = new Set([...candidate, ...declaredIds]).size;
  return {
    ratio: union === 0 ? 0 : shared / union,
    shared,
    candidateCount: candidate.size,
    declaredCount: declaredIds.size,
  };
}

// ---------------------------------------------------------------------------
// Declared vs discovered (doc 01 §12, doc 02 §17)
// ---------------------------------------------------------------------------

function declaredList(signals: CreatorSignals): TasteDna["declared"] {
  return signals.entityIds.map((id) => ({ id, label: signals.entityNames[id] ?? id }));
}

function discoveredList(
  pool: readonly PooledEntity[],
  signals: CreatorSignals,
): TasteDna["discovered"] {
  const declared = new Set(signals.entityIds);
  return pool
    .filter((entity) => !declared.has(entity.id))
    .map((entity) => ({
      id: entity.id,
      label: entity.name,
      weight: round(entity.rank.value, 4),
    }));
}

// ---------------------------------------------------------------------------
// Fallback level
// ---------------------------------------------------------------------------

interface LevelInput {
  pool: readonly PooledEntity[];
  tagResults: TagResultSet | undefined;
  observations: readonly ProviderObservation[];
  allTags: readonly ScoredTasteTag[];
  degradations: string[];
}

/**
 * The furthest point down the doc 04 §4.5 chain that had to be used.
 *
 * L4 is checked before this function is ever called. Otherwise each condition is
 * tested in chain order and the deepest applicable one wins, with every
 * applicable condition pushed onto `degradations` so collapsing to a single
 * level loses nothing.
 */
export function determineLevel(input: LevelInput): FallbackLevel {
  const { pool, tagResults, observations, allTags, degradations } = input;
  let level: FallbackLevel = "L0";

  if (pool.length === 0) {
    degradations.push(
      "No results were returned for the supplied signals, so the profile shows declared interests only.",
    );
    return "L3";
  }

  // L2: affinity absent or unusable → rank only. `rank.method` is "minmax" only
  // when the mapper had at least two distinct affinity values to work with, so
  // this single test covers both "absent" and "unscaled".
  const hasAffinity = pool.some((entity) => entity.rank.method === "minmax");
  if (!hasAffinity) {
    degradations.push(
      "No usable affinity scores were returned, so positions within each result set are used instead (rank-derived Taste DNA).",
    );
    level = "L2";
  }

  // L1: M1 unusable.
  const m1Scored = tagResults !== undefined && !tagResults.unscored && tagResults.tags.length > 0;
  if (!m1Scored && level === "L0") {
    level = "L1";
  }

  // L3: explainability absent → template reasons from our own breakdown.
  const explainabilityAbsent =
    observations.some((o) => o.code === "explainability_absent") ||
    pool.every((entity) => entity.explainability.contributions.length === 0);
  if (explainabilityAbsent) {
    degradations.push(
      "The data source did not explain its results, so the reasons shown are generated from our own score breakdown rather than quoted from the API.",
    );
    if (level === "L0" || level === "L1" || level === "L2") level = "L3";
  }

  if (allTags.length === 0) {
    degradations.push("No taste tags could be derived; the profile shows categories only.");
  }

  return level;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function collectObservations(
  entityResults: readonly EntityResultSet[],
  tagResults: TagResultSet | undefined,
): ProviderObservation[] {
  const all: ProviderObservation[] = [];
  for (const resultSet of entityResults) all.push(...resultSet.meta.observations);
  if (tagResults) all.push(...tagResults.meta.observations);
  return all;
}

/**
 * The set of categories the creator explicitly declared.
 *
 * Built from the resolved entity ids' own subtypes plus the creator's declared
 * content categories. Using the resolved subtypes matters: it makes the
 * "unexpected" test a genuine set difference against what the data source
 * considers the creator's categories, not against free-text labels that may not
 * match Qloo's vocabulary.
 */
function normaliseCategoryList(
  declared: readonly string[],
  pool: readonly PooledEntity[],
  signals: CreatorSignals,
): string[] {
  const out = new Set<string>();
  for (const category of declared) {
    const normalised = normaliseCategory(category);
    if (normalised) out.add(normalised);
  }
  const declaredIds = new Set(signals.entityIds);
  for (const entity of pool) {
    if (declaredIds.has(entity.id)) out.add(normaliseCategory(categoryId(entity)));
  }
  // Interests that resolved but produced no pooled row still count as declared.
  return [...out].filter(Boolean);
}

function tagNameFromId(tagId: string): string {
  const tail = tagId.split(":").pop() ?? tagId;
  return tail.replace(/[_-]+/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function emptyTasteDna(level: FallbackLevel, signals: CreatorSignals): TasteDna {
  return {
    level,
    levelDescription: FALLBACK_DESCRIPTIONS[level],
    coreTastes: [],
    categories: [],
    emergingSignals: [],
    unexpectedAffinities: [],
    declared: declaredList(signals),
    discovered: [],
  };
}

/** Coverage of a category, 0..1, from the creator's own declaration. */
export function coverageOf(
  category: string,
  saturation: Record<string, number>,
  coveredCategories: readonly string[],
): number | undefined {
  return coverageWithBasis(category, saturation, coveredCategories).coverage;
}

// ---------------------------------------------------------------------------
// The three bands of a Creator Taste DNA
// ---------------------------------------------------------------------------

/**
 * One taste, placed in the band it belongs to.
 *
 * `weight` is this taste's share of the total weight across `coreTastes`, so the
 * two bands are comparable with each other and sum to 1 between them. It is a
 * within-profile share and means nothing outside this run.
 */
export interface TasteBandEntry {
  id: string;
  label: string;
  weight: number;
  /** The confirmed entities that carry this taste. Empty for an adjacent taste. */
  supportedBy: string[];
}

export interface TasteDnaBands {
  /** Strongest and most directly supported: traceable to a confirmed entity. */
  core: TasteBandEntry[];
  /** Related ground reached through the catalogue's expansion of what was confirmed. */
  adjacent: TasteBandEntry[];
  /** Evidence-supported connections that are not restatements of the declared niche. */
  unexpected: TasteDna["unexpectedAffinities"];
}

/**
 * Read an assembled `TasteDna` as the three bands the product talks about:
 * core / adjacent / unexpected.
 *
 * WHY THIS IS A SELECTOR AND NOT A NEW FIELD
 * ------------------------------------------
 * The distinction already exists in the data — `declared` vs `discovered` on the
 * entities, `contributedBy` on every taste tag, `unexpectedAffinities` for the
 * third band. Storing a fourth parallel copy of it would create a second
 * classification that could drift from the first, which is exactly what §4 warns
 * against. So this derives the bands on read, from fields that are already there,
 * and cannot disagree with them.
 *
 * WHAT DECIDES THE BAND
 * ---------------------
 * A taste is **core** when at least one of the entities that produced it is one the
 * creator confirmed, and **adjacent** when it reached the profile only through the
 * catalogue's expansion of those entities. That is a checkable fact about the
 * evidence trail, not a judgement about how interesting the taste is.
 *
 * One documented exception: when the creator confirmed no entity at all — which is
 * a legitimate outcome, and the reason the honest no-signal state exists — there is
 * no confirmed/unconfirmed distinction left to draw, so every taste is reported as
 * core rather than the whole profile being reported as adjacent ground the creator
 * never asked about.
 */
export function partitionTasteDna(dna: TasteDna): TasteDnaBands {
  const declaredIds = new Set(dna.declared.map((entry) => entry.id));
  const total = dna.coreTastes.reduce((sum, tag) => sum + tag.score, 0);

  const core: TasteBandEntry[] = [];
  const adjacent: TasteBandEntry[] = [];

  for (const tag of dna.coreTastes) {
    const supportedBy = tag.contributedBy
      .filter((entry) => declaredIds.has(entry.entityId))
      .map((entry) => entry.entityName)
      .filter((name) => name.trim().length > 0);
    const band: TasteBandEntry = {
      id: tag.tag.id,
      label: tag.tag.name,
      weight: total > 0 ? round(tag.score / total) : 0,
      supportedBy: [...new Set(supportedBy)].slice(0, 3),
    };
    if (supportedBy.length > 0 || declaredIds.size === 0) core.push(band);
    else adjacent.push(band);
  }

  return { core, adjacent, unexpected: dna.unexpectedAffinities };
}

/**
 * How a coverage figure was obtained.
 *
 *  - `creator_declared` — the creator stated a saturation for this category, or
 *    listed it as covered.
 *  - `inferred_zero`    — the creator declared coverage for OTHER categories and
 *    said nothing about this one, so it is treated as uncovered. That is a
 *    reasonable reading, but it is our inference and not their statement.
 *  - `unavailable`      — nothing was declared at all, so there is no basis for
 *    any figure.
 *
 * The distinction exists because `inferred_zero` was being stamped
 * `creator_declared` on the way out. An opportunity gap built on an inferred zero
 * is still worth showing — it is the honest default when a creator skips the
 * coverage step — but attributing it to them is putting words in their mouth, and
 * the gap then looks like a measured finding instead of an assumption.
 */
export type { CoverageBasis };

/** Narrowed to the three values this derivation can actually produce. */
export type DerivedCoverageBasis = Exclude<CoverageBasis, "measured">;

export function coverageWithBasis(
  category: string,
  saturation: Record<string, number>,
  coveredCategories: readonly string[],
): { coverage: number | undefined; basis: DerivedCoverageBasis } {
  const key = normaliseCategory(category);
  const explicit = saturation[key] ?? saturation[category.toLowerCase()];
  if (typeof explicit === "number") return { coverage: clamp(explicit), basis: "creator_declared" };
  if (coveredCategories.some((covered) => normaliseCategory(covered) === key)) {
    return { coverage: 1, basis: "creator_declared" };
  }
  if (coveredCategories.length > 0) return { coverage: 0, basis: "inferred_zero" };
  return { coverage: undefined, basis: "unavailable" };
}
