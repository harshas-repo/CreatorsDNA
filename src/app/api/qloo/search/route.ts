import { z } from "zod";
import { NextResponse, type NextRequest } from "next/server";

import { getProvider } from "@/lib/providers";
import { badRequest, errorResponse, noStore } from "@/lib/api/respond";
import { describeIssues } from "@/lib/api/schemas";

/**
 * `GET|POST /api/qloo/search` — resolve free text to cultural entities.
 *
 * Doc 03 §8 step 1: every signal the analysis uses starts here. Doc 02 §7 is the
 * rule that shapes the RESPONSE, not just the request — when more than one entity
 * matches, all of them come back with `ambiguous: true` and the creator chooses.
 * Auto-selecting the top hit would substitute our guess for their intent, and
 * every number downstream would then be about a different thing than they asked
 * about.
 *
 * GET is supported because the onboarding search box fires this on every
 * keystroke (debounced). A GET with query params is cacheable by the browser and
 * costs nothing to replay; a POST would not be.
 *
 * `not_found` is NOT an error here: an empty match list is a legitimate, common
 * result and returns 200 with `matches: []`. The provider already encodes that.
 */
export const dynamic = "force-dynamic";

const querySchema = z.object({
  q: z.string().trim().min(1, "A search query is required.").max(120),
  types: z
    .string()
    .optional()
    .transform((raw) => (raw === undefined ? undefined : raw.split(",").map((t) => t.trim()).filter(Boolean))),
  take: z.coerce.number().int().min(1).max(20).default(8),
});

export async function GET(request: NextRequest) {
  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) return badRequest(describeIssues(parsed.error, "Invalid search request"));

  try {
    const provider = await getProvider();
    const result = await provider.search({
      query: parsed.data.q,
      types: parsed.data.types,
      take: parsed.data.take,
    });
    return NextResponse.json(result, { headers: noStore() });
  } catch (error) {
    return errorResponse(error);
  }
}

const bodySchema = z.object({
  query: z.string().trim().min(1).max(120),
  types: z.array(z.string()).optional(),
  take: z.number().int().min(1).max(20).default(8),
  tagIds: z.array(z.string()).optional(),
});

export async function POST(request: NextRequest) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return badRequest("Request body must be valid JSON.");
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return badRequest(describeIssues(parsed.error, "Invalid search request"));

  try {
    const provider = await getProvider();
    const result = await provider.search(parsed.data);
    return NextResponse.json(result, { headers: noStore() });
  } catch (error) {
    return errorResponse(error);
  }
}
