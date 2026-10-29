import type { ProviderId } from "@/lib/providers/provider";

/**
 * Typed environment configuration.
 *
 * Server-only: it reads `process.env`, which Next.js does not inline for client
 * bundles. The guard below makes an accidental client import fail loudly rather
 * than silently shipping an empty key to the browser (doc 02 §12/§13).
 *
 * Every value has a safe default, so the whole application runs end-to-end with
 * an EMPTY environment on clearly-labelled synthetic data.
 */

/** The host hackathon keys actually work against (doc 03 §1). */
export const QLOO_HACKATHON_BASE_URL = "https://hackathon.api.qloo.com";

const HOSTS_THAT_REJECT_HACKATHON_KEYS = [
  "https://api.qloo.com",
  "https://staging.api.qloo.com",
];

export type CacheDriver = "memory" | "filesystem";

export interface QlooConfig {
  apiKey: string | undefined;
  baseUrl: string;
  keyHeader: string;
  timeoutMs: number;
  maxConcurrency: number;
  /** When true, raw responses are written to the git-ignored probe directory. */
  captureProbeOutput: boolean;
  probeOutputDir: string;
}

export interface CacheConfig {
  driver: CacheDriver;
  dir: string;
  ttlSeconds: number;
}

export interface AppConfig {
  providerId: ProviderId;
  qloo: QlooConfig;
  cache: CacheConfig;
  brandRegistryPath: string;
  /** Startup warnings worth surfacing in the health endpoint. */
  warnings: string[];
}

function readString(env: NodeJS.ProcessEnv, key: string, fallback: string): string {
  const value = env[key];
  return value === undefined || value.trim() === "" ? fallback : value.trim();
}

function readOptionalString(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key];
  return value === undefined || value.trim() === "" ? undefined : value.trim();
}

function readInt(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = readOptionalString(env, key);
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readBool(env: NodeJS.ProcessEnv, key: string, fallback: boolean): boolean {
  const raw = readOptionalString(env, key);
  if (raw === undefined) return fallback;
  return raw.toLowerCase() === "true" || raw === "1";
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const warnings: string[] = [];

  const requestedProvider = readString(env, "CREATORSDNA_PROVIDER", "synthetic").toLowerCase();
  const apiKey = readOptionalString(env, "QLOO_API_KEY");
  const baseUrl = readString(env, "QLOO_API_BASE_URL", QLOO_HACKATHON_BASE_URL).replace(/\/+$/, "");

  // Doc 03 §1: using the wrong base URL is the most common cause of 401s, and
  // nearly every example in Qloo's own docs points at the wrong host for this
  // environment. Fail loudly at config time rather than mysteriously at call time.
  if (HOSTS_THAT_REJECT_HACKATHON_KEYS.some((host) => baseUrl.startsWith(host))) {
    warnings.push(
      `QLOO_API_BASE_URL is set to ${baseUrl}. Hackathon API keys only work against ${QLOO_HACKATHON_BASE_URL}; this host returns 401 (doc 03 §1).`,
    );
  }

  let providerId: ProviderId = requestedProvider === "qloo" ? "qloo" : "synthetic";
  if (providerId === "qloo" && apiKey === undefined) {
    // Never attempt an unverified live call. Degrade to synthetic and say so.
    warnings.push(
      "CREATORSDNA_PROVIDER=qloo but QLOO_API_KEY is not set. Falling back to the synthetic provider so no unauthenticated live call is attempted.",
    );
    providerId = "synthetic";
  }
  if (requestedProvider !== "qloo" && requestedProvider !== "synthetic") {
    warnings.push(`Unknown CREATORSDNA_PROVIDER "${requestedProvider}"; using "synthetic".`);
  }

  const captureProbeOutput = readBool(env, "QLOO_CAPTURE_PROBE_OUTPUT", false);
  if (captureProbeOutput && env.NODE_ENV === "production") {
    // Probe capture writes raw Qloo responses to disk. That is only ever
    // acceptable locally — the output directory is git-ignored, but a deployed
    // filesystem is not a safe place for captured responses (doc 04 §8.2).
    warnings.push(
      "QLOO_CAPTURE_PROBE_OUTPUT is enabled in production and has been forced off. Raw Qloo responses must never be written on a deployed host.",
    );
  }

  return {
    providerId,
    qloo: {
      apiKey,
      baseUrl,
      keyHeader: readString(env, "QLOO_API_KEY_HEADER", "X-Api-Key"),
      timeoutMs: Math.max(1000, readInt(env, "QLOO_TIMEOUT_MS", 30_000)),
      // Default 1 until the real quota is known (assumption A15 / open item R7):
      // this prevents an accidental burst from exhausting a limited key.
      maxConcurrency: Math.max(1, readInt(env, "QLOO_MAX_CONCURRENCY", 1)),
      captureProbeOutput: captureProbeOutput && env.NODE_ENV !== "production",
      probeOutputDir: readString(env, "QLOO_PROBE_OUTPUT_DIR", "probe-output"),
    },
    cache: {
      driver: readString(env, "CACHE_DRIVER", "memory") === "filesystem" ? "filesystem" : "memory",
      dir: readString(env, "CACHE_DIR", ".cache"),
      ttlSeconds: Math.max(0, readInt(env, "CACHE_TTL_SECONDS", 3600)),
    },
    brandRegistryPath: readString(env, "BRAND_REGISTRY_PATH", "src/data/brands.json"),
    warnings,
  };
}

let cached: AppConfig | undefined;

/**
 * Process-wide memo. Config is read once; tests can bypass via `loadConfig`.
 *
 * Guarded so an accidental import from a Client Component fails loudly instead
 * of silently reading an undefined key in the browser.
 */
export function getConfig(): AppConfig {
  if (typeof window !== "undefined") {
    throw new Error(
      "getConfig() is server-only. Read configuration inside a Server Component or a Route Handler; never in a Client Component (doc 02 §12/§13).",
    );
  }
  cached ??= loadConfig();
  return cached;
}

/** Test hook. */
export function resetConfigCache(): void {
  cached = undefined;
}

export function isConfiguredForQloo(config: AppConfig = getConfig()): boolean {
  return config.providerId === "qloo" && config.qloo.apiKey !== undefined;
}
