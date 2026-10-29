import { NextResponse, type NextRequest } from "next/server";

import { getProvider } from "@/lib/providers";
import { badRequest, errorResponse, noStore } from "@/lib/api/respond";
import { describeIssues, recommendBodySchema } from "@/lib/api/schemas";

/**
 * `POST /api/qloo/recommendations` — entity recommendations and candidate scoring.
 *
 * Method M2, the primary Taste DNA source (doc 04 §4.2). Two intents share this
 * route because they share an endpoint upstream:
 *
 *   - no `candidateEntityIds` → `recommendEntities`, a top-N discovery call;
 *   - with `candidateEntityIds` → `scoreEntities`, which asks the API to score a
 *     SPECIFIC set (doc 03 §8 step 5b) and is the strongest available basis for
 *     the 45% brand taste-fit weight.
 *
 * Splitting them into two routes would duplicate the validation and the error
 * mapping for no benefit; the branch is one `if`.
 *
 * `filterType` is REQUIRED and validated against the closed enum. Doc 03 §6 is
 * unambiguous that Insights has no generic entity type, so a caller cannot ask
 * for "anything" — and silently defaulting to `urn:entity:brand` would produce a
 * plausible-looking answer about brands for a creator who asked about music.
 */
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return badRequest("Request body must be valid JSON.");
  }

  const parsed = recommendBodySchema.safeParse(raw);
  if (!parsed.success) return badRequest(describeIssues(parsed.error, "Invalid recommendation request"));

  const body = parsed.data;

  try {
    const provider = await getProvider();
    const capabilities = provider.capabilities();

    // Doc 03 §11: unsupported parameters are silently ignored upstream, so
    // asking for a capability the provider does not have would return a 200 with
    // the feature quietly absent. Refusing here makes the gap visible instead.
    if (body.explainability && !capabilities.supported.explainability) {
      return NextResponse.json(
        {
          error: {
            code: "unsupported",
            message: `Explainability was requested but is not supported by the "${provider.id}" provider${
              capabilities.unsupportedReasons.explainability
                ? `: ${capabilities.unsupportedReasons.explainability}`
                : ""
              }. Re-request with explainability=false rather than assuming the reasons in the response are the API's.`,
            recoverable: true,
            status: 501,
          },
        },
        { status: 501, headers: noStore() },
      );
    }

    const take = Math.min(body.take, capabilities.maxTake);
    const shared = {
      filterType: body.filterType,
      signals: body.signals,
      take,
      page: body.page,
      explainability: body.explainability,
      filterTagIds: body.filterTagIds,
      tagTypes: body.tagTypes,
      diversifyBySubtype: body.diversifyBySubtype,
      crossDomainBackfill: body.crossDomainBackfill,
      scope: body.scope,
    };

    const result =
      body.candidateEntityIds !== undefined || body.candidateTagIds !== undefined
        ? await provider.scoreEntities({
            ...shared,
            candidateEntityIds: body.candidateEntityIds,
            candidateTagIds: body.candidateTagIds,
          })
        : await provider.recommendEntities(shared);

    return NextResponse.json(result, { headers: noStore() });
  } catch (error) {
    return errorResponse(error);
  }
}
