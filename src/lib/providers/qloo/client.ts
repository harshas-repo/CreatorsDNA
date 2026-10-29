// `z` is used only in type position (the `z.ZodType<T>` parameter of `parse`).
// The schemas themselves are imported as values from `@/lib/contracts/qloo`.
import type { z } from "zod";

import { ProviderError, type ProviderErrorCode } from "@/lib/contracts/domain";
import {
  qlooErrorSchema,
  qlooInsightsResponseSchema,
  qlooSearchResponseSchema,
  qlooTagsResponseSchema,
  unusableResultArray,
  type QlooInsightsResponse,
  type QlooSearchResponse,
  type QlooTagsResponse,
} from "@/lib/contracts/qloo";
import type { QlooConfig } from "@/lib/env";
import { hashToHex, stableKey } from "@/lib/utils/deterministic";

/**
 * Qloo HTTP client.
 *
 * Implements the doc 03 §11 mitigations that belong at transport level:
 *   #3 log the full outgoing parameter set server-side for every call, so a
 *      wrong-but-200 response is diagnosable
 *   plus: never surface raw errors to the UI (doc 03 §7), map every status onto
 *   a `ProviderErrorCode`, and validate every body against the zod contract so
 *   malformed JSON becomes a typed failure rather than a mystery downstream.
 *
 * This module performs NO live call unless an API key is present. `QlooProvider`
 * refuses to construct without one, so the app can never make an unverified
 * request by accident.
 */

export type QlooEndpoint = "insights" | "search" | "tags";

const ENDPOINT_PATHS: Record<QlooEndpoint, string> = {
  insights: "/v2/insights",
  search: "/search",
  tags: "/v2/tags",
};

export interface CallLogEntry {
  at: string;
  endpoint: QlooEndpoint;
  params: Record<string, string>;
  status: number | "network";
  durationMs: number;
  ok: boolean;
  errorCode?: ProviderErrorCode;
}

/** Ring buffer of recent calls. Never contains response bodies or the key. */
const callLog: CallLogEntry[] = [];
const CALL_LOG_LIMIT = 200;

export function recentCalls(): readonly CallLogEntry[] {
  return callLog;
}

export function clearCallLog(): void {
  callLog.length = 0;
}

// ---------------------------------------------------------------------------
// Concurrency gate
// ---------------------------------------------------------------------------

/**
 * A counting semaphore. Default concurrency is 1 until the real quota is known
 * (assumption A15 / open item R7): a burst of parallel Insights calls is the
 * fastest way to exhaust a limited hackathon key, and doc 03 §1 notes limits are
 * only raisable by asking in the Qloo Discord.
 */
class Semaphore {
  private queue: Array<() => void> = [];
  private active = 0;

  constructor(private readonly limit: number) {}

  async acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active += 1;
      return;
    }
    await new Promise<void>((resolve) => this.queue.push(resolve));
    this.active += 1;
  }

  release(): void {
    this.active -= 1;
    const next = this.queue.shift();
    if (next) next();
  }
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export interface QlooClientOptions {
  config: QlooConfig;
  /** Injectable for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

export class QlooClient {
  private readonly semaphore: Semaphore;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: QlooClientOptions) {
    const { config } = options;
    if (!config.apiKey) {
      // Hard stop. Doc 03 §1: a missing or mis-placed key returns
      // 401 "No API key found in request". Refusing to construct means the
      // application cannot issue an unauthenticated live call by accident.
      throw new ProviderError(
        "not_configured",
        "QlooClient requires an API key. Set QLOO_API_KEY, or leave CREATORSDNA_PROVIDER=synthetic.",
        { recoverable: true },
      );
    }
    this.semaphore = new Semaphore(config.maxConcurrency);
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async insights(params: Record<string, string>): Promise<QlooInsightsResponse> {
    return this.get("insights", params, qlooInsightsResponseSchema);
  }

  async search(params: Record<string, string>): Promise<QlooSearchResponse> {
    return this.get("search", params, qlooSearchResponseSchema);
  }

  async tags(params: Record<string, string>): Promise<QlooTagsResponse> {
    return this.get("tags", params, qlooTagsResponseSchema);
  }

  private async get<T>(
    endpoint: QlooEndpoint,
    params: Record<string, string>,
    schema: z.ZodType<T>,
  ): Promise<T> {
    const { config } = this.options;
    const search = new URLSearchParams();
    for (const key of Object.keys(params).sort()) {
      search.append(key, params[key] as string);
    }
    // The base URL alone is not a valid endpoint; a path must always be appended
    // (doc 03 §1).
    const url = `${config.baseUrl.replace(/\/+$/, "")}${ENDPOINT_PATHS[endpoint]}?${search.toString()}`;

    // Acquire the concurrency slot BEFORE arming the abort timer. maxConcurrency
    // is 1, so arming first would make every queued request burn its timeout
    // budget while waiting for the slot rather than while in flight — on a slow
    // host the pipeline's serialised insights calls would time out before they
    // were ever sent. `startedAt` moves with it so the call log measures the
    // request, not the queue wait.
    await this.semaphore.acquire();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    const startedAt = Date.now();

    let status: number | "network" = "network";
    let ok = false;
    let errorCode: ProviderErrorCode | undefined;

    try {
      // Doc 03 §1: `X-Api-Key`, never `Authorization: Bearer`, never a query
      // parameter. Doc 03 §2: `/v2/insights` is GET — a POST with a JSON body
      // fails even when the parameters are otherwise correct.
      const response = await this.fetchImpl(url, {
        method: "GET",
        headers: {
          [config.keyHeader]: config.apiKey as string,
          accept: "application/json",
        },
        signal: controller.signal,
        cache: "no-store",
      });

      status = response.status;
      const text = await response.text();

      if (!response.ok) {
        const error = this.mapError(response.status, text, params);
        errorCode = error.code;
        // 404 on /search means "no results" — a legitimate empty state, not a
        // failure the user needs to see as an error (doc 03 §7).
        if (!(endpoint === "search" && response.status === 404)) {
          throw error;
        }
        ok = true;
        return schema.parse(this.emptyEnvelope(endpoint));
      }

      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch (cause) {
        errorCode = "malformed_response";
        throw new ProviderError("malformed_response", "Qloo returned a response that was not valid JSON.", {
          status: response.status,
          recoverable: false,
          cause,
        });
      }

      if (config.captureProbeOutput) {
        // Opt-in, local-only, and written to a git-ignored directory. Raw Qloo
        // responses must never be committed (doc 04 §8.2).
        await this.writeProbeCapture(endpoint, params, json);
      }

      const parsed = schema.safeParse(json);
      if (!parsed.success) {
        errorCode = "malformed_response";
        throw new ProviderError(
          "malformed_response",
          "Qloo response did not match the documented contract. This is exactly the kind of divergence the probe exists to record.",
          { status: response.status, recoverable: false, cause: parsed.error },
        );
      }

      // The envelope now types result arrays as `unknown[]` so one divergent item
      // cannot discard a whole call (see `qlooInsightsResultsSchema`). That makes
      // this check load-bearing: a response in which NOTHING was readable is still
      // malformed, and must not be allowed to reach the pipeline as a successful
      // empty result set — that is the one confusion doc 03 §7 says cannot be
      // undone from the outside.
      const unusable = unusableResultArray(endpoint, parsed.data);
      if (unusable !== undefined) {
        errorCode = "malformed_response";
        throw new ProviderError(
          "malformed_response",
          `Qloo returned ${unusable.count} item${unusable.count === 1 ? "" : "s"} in ${unusable.path}, none of which matched the documented contract (first failure: ${unusable.issues.join("; ") || "unknown"}). The response was rejected rather than reinterpreted.`,
          { status: response.status, recoverable: false },
        );
      }

      ok = true;
      return parsed.data;
    } catch (error) {
      if (error instanceof ProviderError) {
        errorCode ??= error.code;
        throw error;
      }
      const isAbort = error instanceof Error && error.name === "AbortError";
      errorCode = isAbort ? "timeout" : "network";
      throw new ProviderError(
        errorCode,
        isAbort
          ? `Qloo request to ${endpoint} timed out after ${config.timeoutMs}ms.`
          : "Could not reach Qloo. Check network connectivity and the base URL.",
        { recoverable: true, cause: error },
      );
    } finally {
      clearTimeout(timer);
      this.semaphore.release();
      // Mitigation #3: log the full outgoing parameter set. The log deliberately
      // excludes the API key and response bodies.
      callLog.push({
        at: new Date(startedAt).toISOString(),
        endpoint,
        params,
        status,
        durationMs: Date.now() - startedAt,
        ok,
        errorCode,
      });
      if (callLog.length > CALL_LOG_LIMIT) callLog.shift();
    }
  }

  /** Doc 03 §7 error matrix, mapped onto product-level codes. */
  private mapError(status: number, body: string, params: Record<string, string>): ProviderError {
    const parsed = qlooErrorSchema.safeParse(safeJsonParse(body));
    const upstreamMessage = parsed.success
      ? (parsed.data.message ?? parsed.data.reason ?? undefined)
      : undefined;
    const detail = upstreamMessage ? ` Qloo said: "${upstreamMessage}".` : "";

    switch (status) {
      case 401:
        return new ProviderError(
          "unauthorized",
          `Qloo rejected the API key.${detail} The most common cause is the wrong base URL — hackathon keys only work against hackathon.api.qloo.com (doc 03 §1). The second is sending the key as Authorization: Bearer instead of X-Api-Key.`,
          { status, upstreamMessage },
        );
      case 403:
        return new ProviderError(
          "forbidden_type",
          `Qloo refused this entity type or endpoint.${detail} Likely the videogame/video_game naming trap, or a type this key is not entitled to (doc 03 §3).`,
          { status, upstreamMessage, recoverable: true },
        );
      case 404:
        return new ProviderError("not_found", `No results.${detail}`, {
          status,
          upstreamMessage,
          recoverable: true,
        });
      case 400: {
        // Doc 03 §7: validate inputs BEFORE calling. When it happens anyway the
        // usual causes are an empty signal set or an invalid tag/audience id.
        const hasSignals = Object.keys(params).some((key) => key.startsWith("signal."));
        const hint = hasSignals
          ? " A signal value was probably invalid and silently dropped (doc 03 §11)."
          : " No signal or filter reached the request.";
        return new ProviderError(
          "invalid_request",
          `Qloo rejected the request parameters.${detail}${hint}`,
          { status, upstreamMessage, recoverable: true },
        );
      }
      case 429:
        return new ProviderError(
          "rate_limited",
          `Qloo rate limit reached.${detail} Back off and retry once; this is what the caching requirement exists to prevent (doc 03 §7).`,
          { status, upstreamMessage, recoverable: true },
        );
      default:
        if (status >= 500) {
          return new ProviderError("unknown", `Qloo server error (${status}).${detail}`, {
            status,
            upstreamMessage,
            recoverable: true,
          });
        }
        return new ProviderError("unknown", `Unexpected Qloo response (${status}).${detail}`, {
          status,
          upstreamMessage,
          recoverable: true,
        });
    }
  }

  /** Minimal valid envelope for the tolerated 404-on-search case. */
  private emptyEnvelope(endpoint: QlooEndpoint): unknown {
    if (endpoint === "search") return { success: true, duration: 0, results: [] };
    if (endpoint === "tags") return { success: true, duration: 0, results: { tags: [] } };
    return { success: true, duration: 0, results: { entities: [] } };
  }

  /**
   * Write a raw capture for the doc 04 §6 probe.
   *
   * The target directory is git-ignored (`.gitignore` lists `probe-output/`),
   * and `loadConfig` forces this off in production. Captures are never committed
   * and never used as fixtures — fixtures are synthetic (doc 04 §8.2).
   */
  private async writeProbeCapture(
    endpoint: QlooEndpoint,
    params: Record<string, string>,
    body: unknown,
  ): Promise<void> {
    try {
      const { mkdir, writeFile } = await import("node:fs/promises");
      const { join } = await import("node:path");
      const dir = this.options.config.probeOutputDir;
      await mkdir(dir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const name = `${stamp}-${endpoint}-${hashToHex(stableKey(params))}.json`;
      await writeFile(
        join(dir, name),
        JSON.stringify({ endpoint, params, capturedAt: stamp, response: body }, null, 2),
        "utf8",
      );
    } catch {
      // Capture is a debugging aid. Failing to write it must never fail a call.
    }
  }
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
