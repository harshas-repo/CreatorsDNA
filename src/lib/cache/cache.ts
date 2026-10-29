import type { CacheConfig } from "@/lib/env";
import { hashToHex, stableKey } from "@/lib/utils/deterministic";

/**
 * Provider-independent cache interface (open item R17 / doc 04 §1 D6).
 *
 * Why this exists as an interface rather than a concrete cache:
 *
 * Doc 03 §1 records a binding Qloo constraint — *"Private server-side caching is
 * fine and there is no time limit on how long you can keep cached responses"* —
 * and doc 02 §32 makes server-side caching mandatory in practice, because a
 * single analysis costs roughly a dozen Insights calls against a limited quota.
 *
 * But decision D6 put the app on Next.js, where a serverless filesystem is
 * EPHEMERAL: local disk does not persist between instances. So the durable cache
 * production needs cannot be the filesystem, and the backend choice (KV store vs
 * database) is still open because the deployment target and the real quota are
 * both unknown.
 *
 * The resolution: define the seam now, ship a local development driver, and keep
 * the architecture ready for a durable adapter. No paid infrastructure
 * dependency is introduced before those facts are known.
 */

export interface CacheStats {
  driver: string;
  durable: boolean;
  hits: number;
  misses: number;
  writes: number;
  evictions: number;
  size: number;
}

export interface CacheEntry<T> {
  value: T;
  storedAt: string;
  /** ISO timestamp; absent means "no expiry", which Qloo explicitly permits. */
  expiresAt?: string;
}

export interface KeyValueCache {
  readonly id: string;
  /**
   * True only when entries survive a process restart AND a new serverless
   * instance. `memory` and `filesystem` are both false on a serverless host —
   * that flag is what the health endpoint reports, so a deployment mistake is
   * visible rather than silently degrading hit rates to zero.
   */
  readonly durable: boolean;
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
  stats(): Promise<CacheStats>;
}

/**
 * ⚠️ PRODUCTION CACHE ADAPTER — REQUIRED, NOT YET IMPLEMENTED.
 *
 * Rendered verbatim in the health endpoint and the README so the gap is
 * impossible to miss.
 */
export const PRODUCTION_CACHE_REQUIREMENT = `A durable KeyValueCache adapter is required before production deployment.

Reason: server-side caching of Qloo responses is mandatory in practice (doc 02 §32)
and Qloo permits retaining them indefinitely (doc 03 §1), but decision D6 targets
Next.js, where a serverless filesystem is ephemeral. The bundled "memory" and
"filesystem" drivers therefore lose every entry on each new instance, which would
turn a ~12-call analysis into ~12 live calls per visitor against a limited quota.

To implement: a class satisfying KeyValueCache backed by a durable store
(KV/blob store or database). No paid dependency has been added yet because the
deployment target and the real Qloo quota (open items R7/R17) are both unknown.

Constraint: cached Qloo responses must never be committed to version control, and
must never be written to a public location (doc 04 §8.2).`;

// ---------------------------------------------------------------------------
// Key helpers
// ---------------------------------------------------------------------------

/**
 * Build a cache key from the sorted parameter set (doc 03 §8: "cache every
 * response server-side, keyed by the sorted parameter set"). Two logically
 * identical requests must collide on purpose.
 */
export function cacheKey(namespace: string, params: unknown): string {
  return `${namespace}:${hashToHex(stableKey(params))}`;
}

// ---------------------------------------------------------------------------
// In-flight deduplication
// ---------------------------------------------------------------------------

/**
 * Doc 02 §32 / doc 03 §8 require deduplicating in-flight requests. Two
 * components asking for the same analysis in the same tick must produce ONE
 * upstream call — with a default concurrency of 1 and a limited quota, the
 * alternative is a self-inflicted rate limit.
 */
const inFlight = new Map<string, Promise<unknown>>();

export async function dedupe<T>(key: string, work: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key);
  if (existing) return existing as Promise<T>;

  const promise = work().finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, promise);
  return promise;
}

/** Test hook: assert nothing is left pending. */
export function inFlightCount(): number {
  return inFlight.size;
}

// ---------------------------------------------------------------------------
// Cache-through helper
// ---------------------------------------------------------------------------

export interface CacheThroughOptions {
  ttlSeconds?: number;
  /** Bypass the cache for this call. Used by the probe. */
  forceRefresh?: boolean;
}

export interface CacheThroughResult<T> {
  value: T;
  fromCache: boolean;
  key: string;
}

/**
 * Read-through cache with in-flight deduplication.
 *
 * Failures to STORE are swallowed: a cache write problem must never fail an
 * analysis that already has its data. Failures to FETCH propagate normally.
 */
export async function cacheThrough<T>(
  cache: KeyValueCache,
  key: string,
  work: () => Promise<T>,
  options: CacheThroughOptions = {},
): Promise<CacheThroughResult<T>> {
  if (options.forceRefresh !== true) {
    const hit = await cache.get<T>(key);
    if (hit !== undefined) return { value: hit, fromCache: true, key };
  }

  const value = await dedupe(key, work);
  try {
    await cache.set(key, value, options.ttlSeconds);
  } catch {
    // Non-fatal by design.
  }
  return { value, fromCache: false, key };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

let singleton: KeyValueCache | undefined;

export async function createCache(config: CacheConfig): Promise<KeyValueCache> {
  if (config.driver === "filesystem") {
    const { FilesystemCache } = await import("./filesystem");
    return new FilesystemCache(config.dir, config.ttlSeconds);
  }
  const { MemoryCache } = await import("./memory");
  return new MemoryCache(config.ttlSeconds);
}

/** Process-wide cache instance. */
export async function getCache(config: CacheConfig): Promise<KeyValueCache> {
  singleton ??= await createCache(config);
  return singleton;
}

/** Test hook. */
export function resetCacheSingleton(): void {
  singleton = undefined;
}

export function isExpired<T>(entry: CacheEntry<T>, now = Date.now()): boolean {
  if (!entry.expiresAt) return false;
  const expires = Date.parse(entry.expiresAt);
  return Number.isFinite(expires) && expires <= now;
}

export function expiresAt(ttlSeconds: number | undefined, from = Date.now()): string | undefined {
  if (ttlSeconds === undefined || ttlSeconds <= 0) return undefined;
  return new Date(from + ttlSeconds * 1000).toISOString();
}
