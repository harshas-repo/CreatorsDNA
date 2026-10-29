import "server-only";

import { getConfig, type AppConfig } from "@/lib/env";
import { createCache, type KeyValueCache } from "@/lib/cache/cache";
import type { DataSource } from "@/lib/contracts/domain";
import { getAllBrands } from "@/lib/data/brandRegistry";

import { QlooProvider } from "./qloo/provider";
import { SyntheticProvider } from "./synthetic/provider";
import type { CulturalIntelligenceProvider, ProviderId } from "./provider";

/**
 * The provider factory — the single place that decides where cultural data comes
 * from.
 *
 * Selection rules, in order:
 *
 *   1. `CREATORSDNA_PROVIDER` names the provider (default `synthetic`).
 *   2. `qloo` without `QLOO_API_KEY` is DOWNGRADED to `synthetic` by
 *      `loadConfig()`. That downgrade is deliberate: it makes an unverified live
 *      call impossible rather than merely unlikely.
 *   3. If constructing the live provider still throws for any reason, the factory
 *      degrades to synthetic and records why. A broken credential must produce a
 *      working, clearly-labelled illustrative product — never a blank page.
 *
 * Everything downstream (scoring, Taste DNA, opportunities, copy, the six
 * visualisations) receives `ProviderContext.source` and must honour
 * `isIllustrative`. That flag is the mechanism that keeps synthetic output from
 * ever being presented as a Qloo discovery.
 */

export interface ProviderContext {
  provider: CulturalIntelligenceProvider;
  cache: KeyValueCache;
  config: AppConfig;
  /** Provenance/label attached to every result set from this context. */
  source: DataSource;
  /** True when the requested provider could not be used. */
  degraded: boolean;
  /** Human-readable reasons, shown in the status UI and `/api/health`. */
  notices: string[];
}

let context: ProviderContext | undefined;

export async function getProviderContext(): Promise<ProviderContext> {
  if (context) return context;
  context = await buildContext();
  return context;
}

async function buildContext(): Promise<ProviderContext> {
  const config = getConfig();
  const cache = await createCache(config.cache);
  const notices = [...config.warnings];

  if (!cache.durable) {
    notices.push(
      `Cache driver "${cache.id}" is not durable: entries are lost on process restart and are not shared between serverless instances. Acceptable for development; see PRODUCTION_CACHE_REQUIREMENT before deploying.`,
    );
  }

  if (config.providerId === "qloo") {
    try {
      const provider = new QlooProvider({
        config: config.qloo,
        cache,
        ttlSeconds: config.cache.ttlSeconds,
      });
      return {
        provider,
        cache,
        config,
        source: provider.source,
        degraded: false,
        notices,
      };
    } catch (error) {
      // Most likely `not_configured`. Degrade rather than fail the whole app.
      notices.push(
        `Live Qloo provider could not be constructed (${describe(error)}). Falling back to synthetic development data.`,
      );
    }
  }

  const provider = new SyntheticProvider({
    brands: getAllBrands(),
    cache,
  });
  const degraded = config.providerId !== "synthetic";
  return { provider, cache, config, source: provider.source, degraded, notices };
}

/** Convenience accessor for Server Components and Route Handlers. */
export async function getProvider(): Promise<CulturalIntelligenceProvider> {
  return (await getProviderContext()).provider;
}

export async function getProviderId(): Promise<ProviderId> {
  return (await getProviderContext()).provider.id;
}

/**
 * Build a one-off context, bypassing the process memo.
 *
 * Used by tests to pin the synthetic provider with a specific option set (e.g.
 * `simulateSilentIgnore` for the L4 hard-fail path) without leaking that state
 * into other suites.
 */
export async function createProviderContext(
  config: AppConfig = getConfig(),
  cache?: KeyValueCache,
): Promise<ProviderContext> {
  const resolvedCache = cache ?? (await createCache(config.cache));
  const notices = [...config.warnings];
  if (config.providerId === "qloo" && config.qloo.apiKey) {
    const provider = new QlooProvider({
      config: config.qloo,
      cache: resolvedCache,
      ttlSeconds: config.cache.ttlSeconds,
    });
    return {
      provider,
      cache: resolvedCache,
      config,
      source: provider.source,
      degraded: false,
      notices,
    };
  }
  const provider = new SyntheticProvider({ brands: getAllBrands(), cache: resolvedCache });
  return {
    provider,
    cache: resolvedCache,
    config,
    source: provider.source,
    degraded: config.providerId !== "synthetic",
    notices,
  };
}

/** Test hook. */
export function resetProviderContext(): void {
  context = undefined;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
