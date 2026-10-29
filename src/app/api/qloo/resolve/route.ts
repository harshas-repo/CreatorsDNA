import { z } from "zod";
import { NextResponse, type NextRequest } from "next/server";

import { getProvider } from "@/lib/providers";
import { badRequest, errorResponse, noStore } from "@/lib/api/respond";
import { describeIssues } from "@/lib/api/schemas";
import type { ResolveEntry, ResolveResponse } from "@/lib/api/resolve";

/**
 * `POST /api/qloo/resolve` — batch-resolve phrases into candidate entities.
 *
 * This is the review stage's backend. The creator writes a description, the
 * client extracts candidate phrases (`src/lib/analysis/extractTerms.ts`), and
 * this route asks the catalogue about all of them at once so one screen can show
 * what resolved, what matched several things, and what matched nothing.
 *
 * Why a batch route rather than N calls to `/api/qloo/search`:
 *
 *  - The API key never leaves the server either way, but N browser requests mean
 *    N debounced round-trips the creator watches one at a time. One request means
 *    one spinner and one coherent review screen.
 *  - The provider cache is shared, so a phrase that was already searched during
 *    onboarding costs nothing here.
 *
 * WHY THE VERDICT IS RETURNED RATHER THAN DECIDED.
 * -----------------------------------------------
 * `status` reports what the catalogue did — `matched` (exactly one), `multiple`
 * (more than one), `none` (zero), `error` (the call failed). It never picks a
 * winner. Doc 02 §7: when several entities match, all of them are presented and
 * the creator chooses, because choosing for them would make every number
 * downstream describe a different thing than the thing they asked about, and the
 * error would be invisible since the result would still look plausible.
 *
 * A phrase that comes back `none` or `multiple`-and-unconfirmed is NOT a signal.
 * The client keeps it as a context-only term and sends it in `contextTerms`,
 * which reaches no provider call. That is the honest alternative to the old
 * behaviour, which dropped it without telling anyone.
 */
export const dynamic = "force-dynamic";

/**
 * Concurrency cap.
 *
 * Not `Promise.all` over the whole list: 24 simultaneous upstream requests to a
 * rate-limited host is how a review screen turns into a wall of 429s, and a 429
 * is reported to the creator as "we could not check this" — indistinguishable
 * from "the catalogue has never heard of it". Four in flight keeps the round-trip
 * short without pretending the host has no limits.
 */
const CONCURRENCY = 4;

const bodySchema = z.object({
  phrases: z
    .array(z.string().trim().min(1).max(120))
    .min(1, "At least one phrase is required.")
    // Matches `analyzeBodySchema.interests.max(24)` and `MAX_CANDIDATES`, so the
    // review stage can never resolve more phrases than it could submit.
    .max(24, "At most 24 phrases can be resolved at once."),
  types: z.array(z.string().max(80)).max(12).optional(),
  take: z.number().int().min(1).max(10).default(5),
});

export type { ResolveEntry, ResolveResponse, ResolveStatus } from "@/lib/api/resolve";

export async function POST(request: NextRequest): Promise<Response> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return badRequest("Request body must be valid JSON.");
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return badRequest(describeIssues(parsed.error, "Invalid resolve request"));

  // Deduplicate before spending any calls. Two identical phrases are one question
  // and must produce one answer, or the review screen shows the same suggestion
  // twice with two separate confirm buttons.
  const phrases = [...new Set(parsed.data.phrases)];

  try {
    const provider = await getProvider();
    const { types, take } = parsed.data;

    const results: ResolveEntry[] = new Array(phrases.length);
    let cursor = 0;

    const worker = async (): Promise<void> => {
      for (;;) {
        const index = cursor;
        cursor += 1;
        if (index >= phrases.length) return;
        results[index] = await resolveOne(phrases[index]!, provider, types, take);
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, phrases.length) }, () => worker()),
    );

    const payload: ResolveResponse = { results, source: provider.source };
    return NextResponse.json(payload, { headers: noStore() });
  } catch (error) {
    return errorResponse(error);
  }
}

async function resolveOne(
  phrase: string,
  provider: Awaited<ReturnType<typeof getProvider>>,
  types: readonly string[] | undefined,
  take: number,
): Promise<ResolveEntry> {
  try {
    // Copied into a mutable array: the provider interface takes `string[]`, and
    // widening the parameter to `readonly` here would only move the mismatch to the
    // call site of every other consumer of `provider.search`.
    const result = await provider.search({
      query: phrase,
      types: types === undefined ? undefined : [...types],
      take,
    });
    if (result.matches.length === 0) return { phrase, status: "none", matches: [] };
    if (result.matches.length === 1) {
      return { phrase, status: "matched", matches: result.matches };
    }
    return { phrase, status: "multiple", matches: result.matches };
  } catch (error) {
    // Reported as `error`, never as `none`. Conflating the two would tell the
    // creator the catalogue has no such thing when all we know is that the lookup
    // did not complete — and they would then leave a real entity unconfirmed.
    return {
      phrase,
      status: "error",
      matches: [],
      message: error instanceof Error ? error.message : "The lookup did not complete.",
    };
  }
}
