import { type NextRequest } from "next/server";

import { getProviderContext } from "@/lib/providers";
import { getAllBrands } from "@/lib/data/brandRegistry";
import { analysisCacheKey, runAnalysis, type PipelineFailure } from "@/lib/analysis/pipeline";
import { type StageEvent } from "@/lib/analysis/stages";
import { badRequest, errorResponse, noStore } from "@/lib/api/respond";
import { analyzeBodySchema, describeIssues, type AnalyzeBody } from "@/lib/api/schemas";
import type { CreatorProfile, SelectedInterest } from "@/lib/contracts/creator";
import type { CreatorAnalysis } from "@/lib/contracts/viewModels";
import type { DataSource } from "@/lib/contracts/domain";

/**
 * `POST /api/analyze` — the whole pipeline in one call.
 *
 * Takes a creator profile and STREAMS a complete `CreatorAnalysis`: Taste DNA,
 * the six visualisation view-models, brand fits, opportunities and the honesty
 * ledger. The success response is `application/x-ndjson` — one `{type:"stage"}`
 * line per pipeline boundary as it is reached, then a single `{type:"result"}`
 * line — so the analyzing screen lights up against real work instead of an
 * invented percentage. This is the route the app uses; the three `/api/qloo/*`
 * routes exist so the individual stages can be probed and debugged on their own.
 *
 * Three properties worth stating because they are easy to lose:
 *
 *  1. It never throws for a degraded data source. A failed provider call becomes
 *     a `PipelineFailure` and a lower fallback level, not a 500. The only 5xx
 *     here is a genuine crash.
 *  2. `fallbackLevel === "L4"` means DO NOT RENDER. The response still returns
 *     200 with an empty Taste DNA, because the creator needs to see WHY rather
 *     than a spinner that never resolves.
 *  3. Identical inputs are cached (doc 02 §32). The key is derived from the
 *     canonical parameter set, so a re-run of the same profile costs nothing and
 *     cannot produce a different answer.
 */
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<Response> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return badRequest("Request body must be valid JSON.");
  }

  const parsed = analyzeBodySchema.safeParse(raw);
  if (!parsed.success) return badRequest(describeIssues(parsed.error, "Invalid analysis request"));

  const body = parsed.data;
  const profile = toCreatorProfile(body);

  // Everything before the first byte is still request/response: a bad body, a
  // provider-context failure or a cache read error must return a real status and
  // the shared error envelope, which a stream that already sent 200 cannot. Only
  // once the analysis is genuinely under way do we switch to NDJSON, and from
  // there a failure becomes an `{type:"error"}` line rather than a status code.
  try {
    const context = await getProviderContext();
    const brands = getAllBrands();
    const cacheKey = analysisCacheKey(profile, brands, context.source);

    const cached = await context.cache.get<CachedAnalysis>(cacheKey);
    if (cached !== undefined) {
      // A cache hit still streams, so the client has exactly one code path — but
      // it replays the stage events that were ACTUALLY emitted for this analysis,
      // including the `skipped` ones.
      //
      // This used to synthesise a `done` for every stage on a hit, which reported
      // stages that had never run as completed. On a profile with no resolved
      // signals the four provider stages are `skipped`, and a cached replay of
      // that analysis told the creator demographics, tags, recommendations and
      // brands had all finished. The progress list is the one part of the analyzing
      // screen that claims to describe real work, so it has to describe the work
      // that was done.
      const { stageEvents, ...result } = cached;
      return ndjsonStream((emit) => {
        for (const event of stageEvents ?? []) emit({ type: "stage", ...event });
        emit({ type: "result", ...result, cached: true, notices: context.notices });
      });
    }

    return ndjsonStream(async (emit) => {
      const stageEvents: StageEvent[] = [];
      const outcome = await runAnalysis({
        profile,
        provider: context.provider,
        brands,
        onStage: (event) => {
          stageEvents.push(event);
          emit({ type: "stage", ...event });
        },
      });

      const payload: CachedAnalysis = {
        analysis: outcome.analysis,
        failures: outcome.failures,
        hasSignals: outcome.hasSignals,
        degradations: outcome.taste.degradations,
        // The pipeline's own verdict, which folds in `hasSignals`. Reading
        // `outcome.taste.renderable` here would report a no-signals analysis as
        // presentable — that flag is only false at L4, and a creator who confirmed
        // nothing never reaches the canary — and the cache guard below would then
        // pin their blank result for the whole TTL.
        renderable: outcome.renderable,
        source: context.source,
        generatedAt: outcome.analysis.generatedAt,
        cached: false,
        stageEvents,
      };

      // A non-renderable result is NOT cached. It is usually a transient provider
      // failure or an unresolved interest, and caching it would pin the creator to
      // a blank page until the TTL expired. A cache WRITE failure must not cost
      // the creator their result either, so it is swallowed and the result emitted
      // regardless; the next identical run simply recomputes.
      if (payload.renderable) {
        try {
          await context.cache.set(cacheKey, payload, context.config.cache.ttlSeconds);
        } catch (cacheError) {
          console.error("[api/analyze] cache write failed", cacheError);
        }
      }

      emit({ type: "result", ...payload, notices: context.notices });
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * Stream a sequence of NDJSON lines: one JSON object per `\n`-terminated line.
 *
 * Chosen over Server-Sent Events because the client only ever reads forward and
 * needs no reconnection or event-id semantics; NDJSON is the smaller contract and
 * adds no dependency. `no-store` still applies — this is per-creator analysis and
 * must never be cached at a shared edge (doc 02 §32).
 *
 * Errors after the first byte cannot change the status (200 is already on the
 * wire), so they are emitted as a `{type:"error"}` line the client surfaces. A
 * silent close would look like a truncated result and leave the creator staring
 * at a half-lit progress list with nothing to retry.
 */
function ndjsonStream(build: (emit: (line: unknown) => void) => void | Promise<void>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (line: unknown): void => {
        controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
      };
      try {
        await build(emit);
      } catch (error) {
        console.error("[api/analyze] stream failure", error);
        emit({
          type: "error",
          message: "The analysis could not be completed. Nothing was fabricated in its place.",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { ...noStore(), "Content-Type": "application/x-ndjson; charset=utf-8" },
  });
}

/**
 * What is stored. `notices` is excluded because it reflects current config, not
 * the analysis.
 *
 * `stageEvents` is stored with the result rather than reconstructed on replay:
 * which stages were skipped depends on the inputs (no resolved signals skips all
 * four provider calls; a single resolved interest skips the canary), and a
 * reconstruction can only guess. It is optional so an entry written before this
 * field existed still parses — the cache key version was bumped at the same time,
 * so such an entry cannot actually be hit.
 */
interface CachedAnalysis {
  analysis: CreatorAnalysis;
  failures: PipelineFailure[];
  hasSignals: boolean;
  degradations: string[];
  renderable: boolean;
  source: DataSource;
  generatedAt: string;
  cached: boolean;
  stageEvents?: StageEvent[];
}

/**
 * Map the wire shape onto the domain contract.
 *
 * A client-supplied `entityId` is honoured when it arrives with a `name`. That
 * pair is the documented disambiguation outcome (doc 02 §7 — the creator
 * searched, several entities matched, and they picked one), so trusting it is
 * correct, and NOT trusting it is worse: the route would re-search the same
 * wording and could resolve to the very entity the creator rejected. The choice
 * would be discarded silently, and every number downstream would describe
 * something other than what was asked about.
 *
 * `subtype` is forwarded when present but deliberately NOT required. It is
 * optional on `CulturalEntity` — plenty of real catalogue entries have no finer
 * URN — so gating trust on it would reject a legitimately chosen match.
 *
 * What this does NOT do is authenticate the id. A caller who invents both an id
 * and a name is believed. That is inherent to a public route with no account
 * system, and it is bounded rather than dangerous: the pipeline derives taste
 * from the RESOLVED ENTITY IT FETCHES, not from the supplied name, so an invented
 * id yields either nothing (unresolved, and reported as such) or the real entity
 * that id happens to denote. It cannot manufacture a profile.
 */
function toCreatorProfile(body: AnalyzeBody): CreatorProfile {
  const selectedInterests: SelectedInterest[] = body.interests.map((interest) => {
    const trustworthy = interest.entityId !== undefined && interest.name !== undefined;

    return {
      query: interest.query,
      entityId: trustworthy ? interest.entityId : undefined,
      name: trustworthy ? interest.name : undefined,
      subtype: trustworthy ? interest.subtype : undefined,
      disambiguation: interest.disambiguation,
      resolution: trustworthy ? "resolved" : "unresolved",
      emphasis: interest.emphasis,
    };
  });

  return {
    id: body.creatorId,
    handle: body.handle,
    displayName: body.displayName,
    platforms: body.platforms,
    niche: body.niche,
    description: body.description,
    selectedInterests,
    // Context-only phrases. They reach `CreatorAnalysis.contextTerms` and nothing
    // else: they are never added to `selectedInterests`, so they cannot become a
    // signal, and they are never dropped, so the creator's own words are still
    // acknowledged in the results.
    contextTerms: body.contextTerms,
    coverage: {
      coveredCategories: body.coverage.coveredCategories,
      coveredTagIds: [],
      saturation: body.coverage.saturation,
      // `coveredCategories` is only ever the categories the creator ticked, so this
      // string describes those. The inferred half of the picture — a category they
      // said nothing about is treated as uncovered — is stated here as well, because
      // a methodology that described only the declared half would let an inferred
      // zero read as their answer. `coverageWithBasis` stamps each point with its
      // own basis and the opportunity chart repeats the disclosure at chart level.
      methodology:
        "Creator-declared content categories, keyed to the categories your confirmed entities belong to. " +
        "Coverage is self-reported, not measured. A category you said nothing about is treated as uncovered, " +
        "and that zero is labelled as our inference wherever it is plotted rather than attributed to you.",
    },
    demographics:
      body.demographics === undefined
        ? undefined
        : {
            ageBuckets: body.demographics.ageBuckets,
            gender: body.demographics.gender,
            audienceIds: [],
          },
    location: body.location,
    // Audience context, omitted as a block when the creator answered neither
    // question — same discipline as `demographics` above. Two creators who both
    // skipped it produce the same profile object.
    //
    // The "Other" free text is dropped unless its own "other" chip is selected.
    // The client already does this, but the route does not get to assume that: a
    // stale string left in the field after the creator un-ticked "Other" would
    // otherwise be rendered back to them as something they said.
    audience:
      body.audience === undefined ||
      (body.audience.groups.length === 0 && body.audience.purposes.length === 0)
        ? undefined
        : {
            groups: body.audience.groups,
            purposes: body.audience.purposes,
            groupsOther: body.audience.groups.includes("other")
              ? body.audience.groupsOther
              : undefined,
            purposesOther: body.audience.purposes.includes("other")
              ? body.audience.purposesOther
              : undefined,
          },
  };
}
