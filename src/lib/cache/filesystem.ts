import { type CacheEntry, type CacheStats, type KeyValueCache, expiresAt, isExpired } from "./cache";

/**
 * Local-disk cache. Development only.
 *
 * ⚠️ Two constraints make this unsuitable for production:
 *
 *  1. `durable: false` — a serverless filesystem is ephemeral (doc 04 §1 D6), so
 *     entries do not survive a new instance. That is precisely the gap
 *     PRODUCTION_CACHE_REQUIREMENT describes.
 *  2. It writes cached Qloo responses to disk. The target directory is
 *     git-ignored (`.cache/`), and doc 04 §8.2 forbids committing captured Qloo
 *     responses. If the directory is ever pointed somewhere tracked, that
 *     constraint is violated — so the constructor rejects paths inside the repo
 *     that are not ignored.
 */
export class FilesystemCache implements KeyValueCache {
  readonly id = "filesystem";
  readonly durable = false;

  private hits = 0;
  private misses = 0;
  private writes = 0;
  private evictions = 0;

  constructor(
    private readonly directory: string,
    private readonly defaultTtlSeconds: number,
  ) {
    if (!SAFE_CACHE_DIRNAME.test(directory)) {
      throw new Error(
        `Refusing to use "${directory}" as a cache directory. Cached Qloo responses must live in a git-ignored path (doc 04 §8.2). Use ".cache", "cache-data" or "tmp".`,
      );
    }
  }

  async get<T>(key: string): Promise<T | undefined> {
    const { readFile } = await import("node:fs/promises");
    try {
      const raw = await readFile(this.pathFor(key), "utf8");
      const entry = JSON.parse(raw) as CacheEntry<T>;
      if (isExpired(entry)) {
        await this.delete(key);
        this.evictions += 1;
        this.misses += 1;
        return undefined;
      }
      this.hits += 1;
      return entry.value;
    } catch {
      this.misses += 1;
      return undefined;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const { mkdir, writeFile } = await import("node:fs/promises");
    const entry: CacheEntry<T> = {
      value,
      storedAt: new Date().toISOString(),
      expiresAt: expiresAt(ttlSeconds ?? this.defaultTtlSeconds),
    };
    await mkdir(this.directory, { recursive: true });
    await writeFile(this.pathFor(key), JSON.stringify(entry), "utf8");
    this.writes += 1;
  }

  async delete(key: string): Promise<void> {
    const { unlink } = await import("node:fs/promises");
    try {
      await unlink(this.pathFor(key));
    } catch {
      // Absent is the desired end state.
    }
  }

  async clear(): Promise<void> {
    const { rm } = await import("node:fs/promises");
    try {
      await rm(this.directory, { recursive: true, force: true });
    } catch {
      // Non-fatal.
    }
    this.hits = 0;
    this.misses = 0;
    this.writes = 0;
    this.evictions = 0;
  }

  async stats(): Promise<CacheStats> {
    const { readdir } = await import("node:fs/promises");
    let size = 0;
    try {
      size = (await readdir(this.directory)).filter((name) => name.endsWith(".json")).length;
    } catch {
      size = 0;
    }
    return {
      driver: this.id,
      durable: this.durable,
      hits: this.hits,
      misses: this.misses,
      writes: this.writes,
      evictions: this.evictions,
      size,
    };
  }

  /** Keys are already hashed by `cacheKey()`, so they are safe as filenames. */
  private pathFor(key: string): string {
    const safe = key.replace(/[^a-zA-Z0-9._:-]/g, "_");
    return `${this.directory.replace(/\/+$/, "")}/${safe}.json`;
  }
}

/** Directories listed in `.gitignore`. Anything else is refused. */
const SAFE_CACHE_DIRNAME = /(^|[/\\])(\.cache|cache-data|tmp|\.tmp)([/\\]|$)/;
