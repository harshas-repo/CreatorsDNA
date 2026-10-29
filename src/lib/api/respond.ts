import "server-only";

import { NextResponse } from "next/server";

import { ProviderError } from "@/lib/contracts/domain";

/**
 * Shared Route Handler plumbing.
 *
 * The point of centralising this is that error shape is a contract with the
 * client, and four routes independently inventing four shapes is how a UI ends up
 * with `if (err.message.includes("rate"))` in it. Every failure leaves here as
 * `{ error: { code, message, recoverable, status } }`.
 *
 * `recoverable` is the field that matters most: it tells the client whether to
 * show a retry affordance or a degraded state (doc 02 §33, doc 04 §4.5). Guessing
 * it from the HTTP status would be wrong — a 429 is recoverable and a 400 usually
 * is not, but `not_found` on search is a legitimate EMPTY result, not an error.
 */

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    recoverable: boolean;
    status: number;
    /** Only present for a provider failure that carried an upstream status. */
    upstreamStatus?: number;
  };
}

const STATUS_FOR_CODE: Record<string, number> = {
  not_configured: 503,
  unauthorized: 502,
  forbidden_type: 502,
  invalid_request: 400,
  not_found: 404,
  rate_limited: 429,
  quota_exhausted: 503,
  timeout: 504,
  network: 502,
  malformed_response: 502,
  unsupported: 501,
  unknown: 500,
};

export function errorResponse(error: unknown): NextResponse<ApiErrorBody> {
  if (error instanceof ProviderError) {
    const status = error.status ?? STATUS_FOR_CODE[error.code] ?? 500;
    return NextResponse.json(
      {
        error: {
          code: error.code,
          message: error.message,
          recoverable: error.recoverable,
          status,
          upstreamStatus: error.status,
        },
      },
      { status },
    );
  }

  if (isZodError(error)) {
    return NextResponse.json(
      {
        error: {
          code: "invalid_request",
          message: describeZodIssues(error),
          recoverable: false,
          status: 400,
        },
      },
      { status: 400 },
    );
  }

  // An unexpected throw is never recoverable by the client and its message may
  // contain internals, so it is logged here and genericised on the wire.
  console.error("[api] unexpected error", error);
  return NextResponse.json(
    {
      error: {
        code: "unknown",
        message: "The request could not be completed. Nothing was fabricated in its place.",
        recoverable: false,
        status: 500,
      },
    },
    { status: 500 },
  );
}

export function badRequest(message: string): NextResponse<ApiErrorBody> {
  return NextResponse.json(
    { error: { code: "invalid_request", message, recoverable: false, status: 400 } },
    { status: 400 },
  );
}

/**
 * Structural check for a zod validation failure without importing zod's class.
 *
 * Binding to `ZodError` would work, but it ties this module to one validator and
 * to its major version. Duck-typing `issues` keeps the seam provider-agnostic,
 * which is the principle the rest of the boundary follows.
 */
interface ZodIssueLike {
  path: Array<string | number>;
  message: string;
}

function zodIssues(value: unknown): ZodIssueLike[] | undefined {
  if (!(value instanceof Error) || value.name !== "ZodError") return undefined;
  const issues = (value as { issues?: unknown }).issues;
  if (!Array.isArray(issues)) return undefined;
  return issues.filter(
    (issue): issue is ZodIssueLike =>
      typeof issue === "object" &&
      issue !== null &&
      Array.isArray((issue as { path?: unknown }).path) &&
      typeof (issue as { message?: unknown }).message === "string",
  );
}

function isZodError(value: unknown): boolean {
  return zodIssues(value) !== undefined;
}

/**
 * Turn issues into one sentence the UI can show verbatim.
 *
 * zod's own `message` is a JSON dump of the issue array — technically complete
 * and completely unreadable. Field paths are rendered with dot notation so
 * "selectedInterests.0.query" tells the creator which input to fix.
 */
function describeZodIssues(value: unknown): string {
  const issues = zodIssues(value) ?? [];
  if (issues.length === 0) return value instanceof Error ? value.message : "Invalid request body.";
  const parts = issues
    .slice(0, 5)
    .map((issue) => (issue.path.length === 0 ? issue.message : `${issue.path.join(".")}: ${issue.message}`));
  const suffix = issues.length > 5 ? ` (+${issues.length - 5} more)` : "";
  return `Invalid request body. ${parts.join("; ")}${suffix}`;
}

/**
 * No-store on every response.
 *
 * These routes return per-creator analysis. Caching them at a shared edge would
 * leak one creator's taste profile to another, and the provider layer already
 * caches the expensive upstream calls where sharing IS safe.
 *
 * Note: `export const dynamic = "force-dynamic"` must be declared in each route
 * module itself. Next reads that binding statically from the route file, so a
 * re-export from a helper would be silently ignored — which is why there is no
 * shared constant for it here.
 */
export function noStore(): Record<string, string> {
  return { "Cache-Control": "no-store, max-age=0" };
}
