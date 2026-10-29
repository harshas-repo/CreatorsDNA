import { type CacheEntry, type CacheStats, type KeyValueCache, expiresAt, isExpired } from "./cache";

/**
 * In-process cache. The default development driver.
 *
 * `durable: false` is the honest label: entries vanish on restart, and on a
 * serverless host they vanish on every new instance. That is acceptable for
 * development and unacceptable for production — see PRODUCTION_CACHE_REQUIREMENT.
 */
export class MemoryCache implements KeyValueCache {
  readonly id = "memory";
  readonly durable = false;

  private readonly store = new Map<string, CacheEntry<unknown>>();
  private hits = 0;
  private misses = 0;
  private writes = 0;
  private evictions = 0;

  constructor(
    private readonly defaultTtlSeconds: number,
    /** Safety bound so a long-running dev server cannot grow without limit. */
    private readonly maxEntries = 2000,
  ) {}

  async get<T>(key: string): Promise<T | undefined> {
    const entry = this.store.get(key) as CacheEntry<T> | undefined;
    if (!entry) {
      this.misses += 1;
      return undefined;
    }
    if (isExpired(entry)) {
      this.store.delete(key);
      this.evictions += 1;
      this.misses += 1;
      return undefined;
    }
    this.hits += 1;
    // Structured clone so a caller mutating the result cannot corrupt the cache.
    return structuredCloneSafe(entry.value);
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    this.evictIfFull();
    this.store.set(key, {
      value: structuredCloneSafe(value),
      storedAt: new Date().toISOString(),
      expiresAt: expiresAt(ttlSeconds ?? this.defaultTtlSeconds),
    });
    this.writes += 1;
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async clear(): Promise<void> {
    this.store.clear();
    this.hits = 0;
    this.misses = 0;
    this.writes = 0;
    this.evictions = 0;
  }

  async stats(): Promise<CacheStats> {
    return {
      driver: this.id,
      durable: this.durable,
      hits: this.hits,
      misses: this.misses,
      writes: this.writes,
      evictions: this.evictions,
      size: this.store.size,
    };
  }

  /** FIFO eviction of expired entries first, then oldest inserted. */
  private evictIfFull(): void {
    if (this.store.size < this.maxEntries) return;
    for (const [key, entry] of this.store) {
      if (isExpired(entry)) {
        this.store.delete(key);
        this.evictions += 1;
      }
      if (this.store.size < this.maxEntries) return;
    }
    const oldest = this.store.keys().next();
    if (!oldest.done) {
      this.store.delete(oldest.value);
      this.evictions += 1;
    }
  }
}

function structuredCloneSafe<T>(value: T): T {
  // structuredClone is available on Node 17+ and in modern browsers, but not in
  // every jsdom build. Fall back to JSON, which is sufficient for the plain data
  // this cache holds.
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}
