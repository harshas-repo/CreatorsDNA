import { NextResponse } from "next/server";

import { getProviderContext } from "@/lib/providers";
import { PRODUCTION_CACHE_REQUIREMENT } from "@/lib/cache/cache";
import { noStore } from "@/lib/api/respond";

/**
 * `GET /api/health` — data-source status.
 *
 * Doc 02 §33 wants failures surfaced rather than swallowed, and the single most
 * important failure here is silent: running on synthetic data when you believe
 * you are running on Qloo. This endpoint makes that state machine-readable and
 * is linked from the footer, so it is a page a judge can open.
 *
 * It reports configuration, not a live probe. A probe would spend quota on every
 * health check, and `reachable` is only ever set by a real analysis call.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const context = await getProviderContext();
  const health = await context.provider.health();

  return NextResponse.json(
    {
      ok: health.ok,
      provider: {
        id: context.provider.id,
        requested: context.config.providerId,
        degraded: context.degraded,
        configured: health.configured,
        reachable: health.reachable ?? null,
        source: health.source,
      },
      capabilities: health.capabilities,
      cache: {
        driver: context.config.cache.driver,
        durable: context.cache.durable,
        ttlSeconds: context.config.cache.ttlSeconds,
        // Rendered verbatim, as the constant's own doc comment requires: a
        // non-durable cache on a serverless host would turn every visitor into a
        // fresh burst of live calls, and that must be impossible to miss.
        productionRequirement: context.cache.durable ? null : PRODUCTION_CACHE_REQUIREMENT,
      },
      qloo: {
        baseUrl: context.config.qloo.baseUrl,
        apiKeyPresent: context.config.qloo.apiKey !== undefined,
        maxConcurrency: context.config.qloo.maxConcurrency,
        captureProbeOutput: context.config.qloo.captureProbeOutput,
      },
      notices: context.notices,
      lastError: health.lastError
        ? {
            code: health.lastError.code,
            message: health.lastError.message,
            recoverable: health.lastError.recoverable,
          }
        : null,
      checkedAt: new Date().toISOString(),
    },
    { headers: noStore() },
  );
}
