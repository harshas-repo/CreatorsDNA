import { NextResponse, type NextRequest } from "next/server";

import { getProvider } from "@/lib/providers";
import { badRequest, errorResponse, noStore } from "@/lib/api/respond";
import { describeIssues, tasteBodySchema } from "@/lib/api/schemas";

/**
 * `POST /api/qloo/taste` — tag-level taste (method M1).
 *
 * `filterType` is pinned to `urn:tag` here and NOT caller-supplied, because this
 * route means one thing: give me the cultural tags behind these signals.
 *
 * The response is expected to be UNSCORED. Doc 03 §9 and doc 04 §4.1 both record
 * that the documented example returns `"query": {}`, and `TagResultSet.unscored`
 * is the flag that says so. Callers must check it: M1 is an enrichment layer at
 * half weight (`M1_INFLUENCE = 0.5`), never the primary source. Treating an
 * unscored tag list as scored would let an unranked list drive the Taste DNA.
 *
 * The `urn:tag` support question is contradiction #1 / assumption A3, still
 * unverified against the live host. That is why this route exists separately
 * from `/recommendations`: when the key arrives, this is the one to probe first,
 * and a failure here degrades to M3 without touching anything else.
 */
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return badRequest("Request body must be valid JSON.");
  }

  const parsed = tasteBodySchema.safeParse(raw);
  if (!parsed.success) return badRequest(describeIssues(parsed.error, "Invalid taste request"));

  const body = parsed.data;

  try {
    const provider = await getProvider();
    const capabilities = provider.capabilities();

    if (!capabilities.supported.tagRecommendations) {
      return NextResponse.json(
        {
          error: {
            code: "unsupported",
            message: `Tag recommendations are not supported by the "${provider.id}" provider${
              capabilities.unsupportedReasons.tagRecommendations
                ? `: ${capabilities.unsupportedReasons.tagRecommendations}`
                : ""
              }. Taste tags will be derived from entity co-occurrence (method M3) instead.`,
            recoverable: true,
            status: 501,
          },
        },
        { status: 501, headers: noStore() },
      );
    }

    const result = await provider.recommendTags({
      filterType: "urn:tag",
      signals: body.signals,
      take: Math.min(body.take, capabilities.maxTake),
      explainability: body.explainability,
      tagTypes: body.tagTypes,
      diversifyBySubtype: body.diversifyBySubtype,
      scope: body.scope,
    });

    return NextResponse.json(result, { headers: noStore() });
  } catch (error) {
    return errorResponse(error);
  }
}
