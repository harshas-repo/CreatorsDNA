import type { AffinityReading, AffinityScale, NormalisedScore } from "@/lib/contracts/domain";
import { clamp, round } from "@/lib/utils/deterministic";

/**
 * Affinity scale handling — doc 03 §15, doc 04 §4.4.
 *
 * The problem: Qloo's concept documentation says affinity runs **0–100 and is
 * expressed as a percentage**, but the JSON encoding was never verified against
 * the live host (assumption A2), and the field's very presence is unverified
 * (assumption A1). Meanwhile three OTHER numeric scales appear in the same
 * response object:
 *
 *   query.affinity          0–100   (per concept docs)
 *   query.measurements.*    signed decimals, e.g. −0.0407
 *   query.age/gender.*      signed deltas, e.g. +0.43 / −0.28
 *   query.explainability.*  0–1 normalised
 *   popularity              0–1 catalogue percentile
 *
 * Conflating them is the single most likely source of a wrong-but-plausible
 * score. So the adapter detects the scale from what actually arrived, records
 * the observation, and normalises conservatively.
 */

export interface AffinityScaleDetection {
  scale: AffinityScale;
  /**
   * True when every observed value sits in [0, 1]. That is genuinely ambiguous:
   * it could be a 0–1 encoding, or a 0–100 encoding whose scores all happen to
   * be very low. The ambiguity is recorded rather than guessed away, and it is
   * exactly what the live probe should resolve.
   */
  ambiguous: boolean;
  observedMin?: number;
  observedMax?: number;
  sampleSize: number;
}

/** Infer the affinity scale from a result set's raw values. */
export function detectAffinityScale(values: Array<number | undefined>): AffinityScaleDetection {
  const observed = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));

  if (observed.length === 0) {
    return { scale: "absent", ambiguous: false, sampleSize: 0 };
  }

  const min = Math.min(...observed);
  const max = Math.max(...observed);

  if (max > 100 || min < 0) {
    // Outside both documented ranges. Do not rescale; flag it.
    return { scale: "mixed", ambiguous: false, observedMin: min, observedMax: max, sampleSize: observed.length };
  }

  if (max <= 1) {
    return {
      scale: "unit",
      ambiguous: true,
      observedMin: min,
      observedMax: max,
      sampleSize: observed.length,
    };
  }

  // At least one value exceeds 1 and none exceeds 100 → the documented 0–100 scale.
  return {
    scale: "percent",
    ambiguous: false,
    observedMin: min,
    observedMax: max,
    sampleSize: observed.length,
  };
}

/** Map a raw affinity onto 0..1 using a detected scale. */
export function scaleAffinity(raw: number | undefined, scale: AffinityScale): number | undefined {
  if (raw === undefined || !Number.isFinite(raw)) return undefined;
  switch (scale) {
    case "percent":
      return clamp(raw / 100);
    case "unit":
      return clamp(raw);
    case "absent":
    case "mixed":
      // Unusable. Returning a number here would silently invent a score.
      return undefined;
  }
}

export function toAffinityReading(raw: number | undefined, scale: AffinityScale): AffinityReading {
  return { raw, scaled: scaleAffinity(raw, scale), scale };
}

// ---------------------------------------------------------------------------
// Within-set normalisation — the rule that makes weighting safe
// ---------------------------------------------------------------------------

/**
 * The spread at which a set counts as a near-tie.
 *
 * 0.02 is doc 03 §15's own example: it calls "91 vs 92" on a 0–100 affinity
 * meaningless, and 1/100 of the documented range is 0.01, so a band twice that
 * wide is the smallest gap the documentation treats as real. It is compared
 * against the SCALED affinities, never the normalised ones — after min-max the
 * set always spans 0..1 by construction, so measuring clustering there reports
 * "not clustered" precisely when the provider distinguished nothing.
 */
export const CLUSTER_TOLERANCE = 0.02;

/**
 * Doc 03 §15: *"Because scores are normalized per query, compare brands based
 * on their relative position in the results, not just the raw score."*
 *
 * Consequence: **two affinities from two different API calls are not on the same
 * scale and must never be added.** Each component of the 45/20/15/10/10 model
 * is therefore normalised WITHIN its own result set before weighting.
 *
 * Doc 04 §4.4 fixes the exact rule, including the tied case:
 *
 *     if max(a) > min(a):  norm(r) = (a_r − min) / (max − min)
 *     else:                norm(r) = (N − index(r)) / N
 *
 * The `else` branch exists because doc 03 §15 documents that top results
 * commonly cluster — "the system has identified a cluster of strong matches…
 * all may be viable". A degenerate min-max would divide by zero, and a list of
 * ten near-equal brands is an expected outcome, not a failure.
 *
 * @param values Raw per-entry values, already mapped to 0..1 (or `undefined`).
 * @param ranks  0-based rank per entry, from Qloo's `index` where present,
 *               otherwise from array order.
 */
export function normalizeWithinSet(
  values: Array<number | undefined>,
  ranks: number[],
): NormalisedScore[] {
  const size = values.length;
  if (size === 0) return [];

  const defined = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const min = defined.length > 0 ? Math.min(...defined) : 0;
  const max = defined.length > 0 ? Math.max(...defined) : 0;
  const canMinMax = defined.length >= 2 && max > min;
  // Carried onto every entry so a reader of one score can see how much the
  // provider actually distinguished the set it came from. `undefined` when
  // nothing was scored: there is no spread to report.
  const setSpread = defined.length > 0 ? round(max - min, 6) : undefined;

  return values.map((value, i) => {
    const rank = ranks[i] ?? i;
    if (canMinMax && typeof value === "number" && Number.isFinite(value)) {
      return {
        value: clamp((value - min) / (max - min)),
        method: "minmax" as const,
        rank,
        setSize: size,
        setSpread,
      };
    }
    return {
      value: rankFallbackValue(rank, size),
      method: defined.length === 0 ? ("unavailable" as const) : ("rank" as const),
      rank,
      setSize: size,
      setSpread,
    };
  });
}

/**
 * True when the provider distinguished the top of this set by less than
 * `CLUSTER_TOLERANCE`. Doc 03 §15: a tight cluster at the top is an expected
 * outcome, not a failure, and no single winner should be manufactured from it.
 *
 * Takes the SCALED affinities. Passing normalised values would invert the
 * answer, because min-max stretches any non-zero spread to the full 0..1 range.
 */
export function detectClustering(values: Array<number | undefined>, tolerance = CLUSTER_TOLERANCE): boolean {
  const defined = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (defined.length < 3) return false;
  const sorted = [...defined].sort((a, b) => b - a);
  const head = sorted.slice(0, Math.min(5, sorted.length));
  const spread = (head[0] ?? 0) - (head[head.length - 1] ?? 0);
  return spread <= tolerance;
}

/**
 * The documented tied-case formula, `(N − index) / N`, with `index` 1-based so
 * the lowest-ranked entry lands on 0. A lone result is special-cased to 1: it is
 * the top of its own set, and the formula would otherwise score it 0.
 */
function rankFallbackValue(rankZeroBased: number, size: number): number {
  if (size <= 1) return 1;
  const indexOneBased = Math.min(size, Math.max(1, rankZeroBased + 1));
  return clamp((size - indexOneBased) / size);
}

/**
 * Doc 03 §15: *"A slight difference, like 91 versus 92, usually indicates
 * similar relevance."* Ties are broken by `index`, never by pretending a
 * one-point gap is meaningful.
 *
 * Returns true when the gap to the previous item is too small to mean anything,
 * so the UI can avoid manufacturing a spurious winner.
 */
export function isClusteredWithPrevious(
  current: number,
  previous: number | undefined,
  tolerance = 0.02,
): boolean {
  if (previous === undefined) return false;
  return Math.abs(previous - current) <= tolerance;
}

/** Deterministic ordering: score desc, then rank asc, then id — never unstable. */
export function sortByScore<T extends { score: number; rank?: number; id: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const ra = a.rank ?? Number.MAX_SAFE_INTEGER;
    const rb = b.rank ?? Number.MAX_SAFE_INTEGER;
    if (ra !== rb) return ra - rb;
    return a.id.localeCompare(b.id);
  });
}
