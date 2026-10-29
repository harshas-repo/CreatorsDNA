import type { ExplainabilityContribution } from "@/lib/contracts/domain";
import { clamp, createRandom, round } from "@/lib/utils/deterministic";

import {
  SYNTHETIC_CATEGORIES,
  SYNTHETIC_ENTITIES,
  TRAITS,
  findSyntheticEntity,
  type SyntheticEntity,
  type Trait,
  type TraitVector,
} from "./catalogue";

/**
 * The synthetic affinity engine.
 *
 * It models what doc 03 §15 says Qloo actually does — *"entities are represented
 * as data points in a multi-dimensional space… cosine similarity measures how
 * similar two entities are based on their vector representations"* — so the
 * synthetic provider exercises the same numeric behaviour the live one will, at
 * the same 0–100 scale, rather than returning random numbers.
 *
 * That matters for two reasons:
 *   1. The scoring pipeline, normalisation and fallback levels get tested against
 *      realistic distributions instead of uniform noise.
 *   2. Doc 03 §11 mitigation #4 requires five creators to produce five different
 *      Taste DNAs. A similarity function makes that a real property of the data
 *      rather than an accident.
 */

// ---------------------------------------------------------------------------
// Entity resolution
// ---------------------------------------------------------------------------

/**
 * Resolve any id or free-text name to a synthetic entity.
 *
 * The catalogue is finite but creator input is not, so unrecognised strings get a
 * DETERMINISTIC pseudo-entity derived from their own characters. The same input
 * always yields the same traits, which keeps results stable across renders and
 * test runs while still differentiating one creator's inputs from another's.
 *
 * Resolution order matters: static catalogue, then REGISTERED dynamic entities,
 * then name match over both, then derivation. The dynamic step was missing
 * originally, which meant registry brands were registered but never resolvable —
 * `scoreEntities` silently fell through to `deriveEntity` and returned
 * `syn:derived:registry-<slug>` ids that matched nothing upstream, so every brand
 * lost its taste-fit dimension. Registering an entity must make it resolvable.
 */
export function resolveSyntheticEntity(idOrName: string): SyntheticEntity {
  const known = findSyntheticEntity(idOrName) ?? dynamicEntities.get(idOrName);
  if (known) return known;

  const byName = findByName(idOrName);
  if (byName) return byName;

  return deriveEntity(idOrName);
}

function findByName(name: string): SyntheticEntity | undefined {
  const needle = name.trim().toLowerCase();
  if (!needle) return undefined;
  // Search registered brands as well as the static catalogue, so a creator who
  // types "Nike" resolves to the curated entry rather than a derived guess.
  const candidates = allSyntheticEntities();
  // Exact, then substring — mirrors `/search` `sort_by=match` closely enough for
  // the disambiguation UI to be exercised.
  const exact = candidates.find((entity) => entity.name.toLowerCase() === needle);
  if (exact) return exact;
  return candidates.find(
    (entity) => entity.name.toLowerCase().includes(needle) || needle.includes(entity.name.toLowerCase()),
  );
}

const ALL_KNOWN: readonly SyntheticEntity[] = SYNTHETIC_ENTITIES;

/** Registry-backed brand entities, registered by the provider at construction. */
const dynamicEntities = new Map<string, SyntheticEntity>();

export function registerSyntheticEntities(entities: readonly SyntheticEntity[]): void {
  for (const entity of entities) dynamicEntities.set(entity.id, entity);
}

export function allSyntheticEntities(): SyntheticEntity[] {
  return [...ALL_KNOWN, ...dynamicEntities.values()];
}

/** Build a deterministic pseudo-entity from an arbitrary string. */
function deriveEntity(seed: string): SyntheticEntity {
  const existing = dynamicEntities.get(`syn:derived:${slugify(seed)}`);
  if (existing) return existing;

  const random = createRandom(`entity:${seed}`);
  const category = SYNTHETIC_CATEGORIES[Math.floor(random() * SYNTHETIC_CATEGORIES.length)] ?? "Culture";
  const type = TYPE_FOR_CATEGORY[category] ?? "urn:entity:person";

  // Three traits, deterministically chosen, so the entity has a coherent niche
  // rather than a smear across the whole vocabulary.
  const traits: TraitVector = {};
  const chosen = new Set<Trait>();
  while (chosen.size < 3) {
    const trait = TRAITS[Math.floor(random() * TRAITS.length)] as Trait;
    if (chosen.has(trait)) continue;
    chosen.add(trait);
    traits[trait] = round(0.55 + random() * 0.4, 3);
  }

  const entity: SyntheticEntity = {
    id: `syn:derived:${slugify(seed)}`,
    name: titleCase(seed),
    type,
    subtype: type,
    category,
    disambiguation: "Synthetic entity derived from creator input",
    description: `Invented ${category.toLowerCase()} entry generated deterministically from the text "${seed}".`,
    traits,
    popularity: round(0.15 + random() * 0.7, 3),
    tags: [
      {
        id: `urn:tag:genre:media:${slugify(seed)}`,
        name: titleCase(seed),
        type: "urn:tag:genre:media",
      },
    ],
  };
  dynamicEntities.set(entity.id, entity);
  return entity;
}

const TYPE_FOR_CATEGORY: Record<string, string> = {
  Music: "urn:entity:artist",
  Film: "urn:entity:movie",
  Television: "urn:entity:tv_show",
  Gaming: "urn:entity:videogame",
  Podcast: "urn:entity:podcast",
  Book: "urn:entity:book",
  Person: "urn:entity:person",
  Place: "urn:entity:place",
  Brand: "urn:entity:brand",
};

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unknown";
}

function titleCase(value: string): string {
  return value
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

// ---------------------------------------------------------------------------
// Vectors & similarity
// ---------------------------------------------------------------------------

/**
 * Aggregate a set of signal entities into one taste vector.
 *
 * Mean over the signal count (not over present traits), so a signal that lacks a
 * trait contributes zero to it. That is what makes a focused niche score higher
 * on its own traits than a broad one.
 */
export function aggregateTraits(entityIds: readonly string[]): TraitVector {
  if (entityIds.length === 0) return {};
  const total: Record<string, number> = {};
  for (const id of entityIds) {
    const entity = resolveSyntheticEntity(id);
    for (const [trait, weight] of Object.entries(entity.traits)) {
      total[trait] = (total[trait] ?? 0) + (weight ?? 0);
    }
  }
  const mean: TraitVector = {};
  for (const [trait, sum] of Object.entries(total)) {
    mean[trait as Trait] = sum / entityIds.length;
  }
  return mean;
}

/** Cosine similarity over two sparse trait vectors. Range 0..1 for non-negative weights. */
export function cosineSimilarity(a: TraitVector, b: TraitVector): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (const trait of TRAITS) {
    const va = a[trait] ?? 0;
    const vb = b[trait] ?? 0;
    dot += va * vb;
    normA += va * va;
    normB += vb * vb;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Map a cosine similarity onto the documented 0–100 affinity scale.
 *
 * A raw cosine over sparse positive vectors clusters near 0 for unrelated
 * entities, which would make every "low" result indistinguishable. The power
 * curve spreads the usable range while preserving order, and the floor keeps
 * results inside Qloo's documented "<50 = Low" band rather than at zero.
 *
 * The ±2 jitter is seeded by (signal set, entity), so it is stable per
 * combination but prevents artificial exact ties across unrelated entities.
 * Doc 03 §15's genuine clustering at the top still occurs naturally.
 */
export function syntheticAffinityPercent(
  signalVector: TraitVector,
  entity: SyntheticEntity,
  seed: string,
): number {
  const cosine = cosineSimilarity(signalVector, entity.traits);
  const base = 18 + 78 * cosine ** 0.75;
  const jitter = (createRandom(`${seed}:${entity.id}`)() - 0.5) * 4;
  return clamp(round(base + jitter, 2), 1, 99);
}

/**
 * Per-signal explainability contributions, normalised 0–1.
 *
 * Mirrors doc 03 §5: scores are normalised 0–1 and entities scoring ≥0.1 are
 * always included, while lower-impact ones may be omitted. The same threshold is
 * applied here so the rendering path is exercised identically.
 */
export function syntheticExplainability(
  entityIds: readonly string[],
  target: SyntheticEntity,
): ExplainabilityContribution[] {
  const scored = entityIds.map((id) => {
    const signal = resolveSyntheticEntity(id);
    return {
      signalEntityId: signal.id,
      signalName: signal.name,
      raw: cosineSimilarity(signal.traits, target.traits),
    };
  });

  const max = Math.max(...scored.map((s) => s.raw), 0);
  if (max === 0) return [];

  return scored
    .map((s) => ({
      signalEntityId: s.signalEntityId,
      signalName: s.signalName,
      score: round(s.raw / max, 3),
      provenance: "synthetic" as const,
    }))
    // Doc 03 §5: ≥0.1 always included; below that may be omitted.
    .filter((contribution) => contribution.score >= 0.1)
    .sort((a, b) => b.score - a.score || a.signalEntityId.localeCompare(b.signalEntityId));
}
