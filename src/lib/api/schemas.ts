import { z } from "zod";

import {
  QLOO_AGE_BUCKETS,
  QLOO_GENDERS,
  QLOO_INSIGHTS_ENTITY_TYPES,
  QLOO_SPECIAL_FILTER_TYPES,
} from "@/lib/contracts/qloo";
import { AUDIENCE_GROUPS, CONTENT_PLATFORMS, CONTENT_PURPOSES } from "@/lib/contracts/creator";

/**
 * Zod schemas for the request bodies of the `/api/qloo/*` and `/api/analyze`
 * routes.
 *
 * NOT marked `server-only`, and that is deliberate: there is no secret and no
 * `process.env` read in here, and the onboarding form imports
 * `analyzeInterestSchema` to validate inline before submitting. Duplicating the
 * same limits in a client component is how a form comes to accept input the API
 * then rejects (doc 02 §30: do not duplicate logic).
 *
 * Kept in one module because three routes accept overlapping shapes and a
 * divergence between them is exactly the kind of bug that shows up as "the
 * recommendations endpoint works but the analyze endpoint silently drops
 * demographics". Doc 03 §11 is the reason that matters: Qloo IGNORES parameters
 * it does not support rather than rejecting them, so a schema that is too loose
 * produces a 200 response about the wrong thing.
 *
 * Every field the provider cannot use is rejected here rather than passed
 * through, so an unknown parameter is a 400 the caller can see — not a value
 * quietly discarded upstream.
 */

/**
 * `filter.type` — the Insights enum plus the three documented special values.
 *
 * The spread needs `as const`: without it TypeScript widens the concatenation to
 * `string[]`, `z.enum` infers `z.ZodEnum<[string]>`, and every downstream
 * `filterType` silently stops being assignable to `QlooFilterType`. Keeping the
 * literal tuple is what makes an invalid type a compile error rather than a
 * runtime 400 from Qloo.
 */
export const FILTER_TYPES = [...QLOO_INSIGHTS_ENTITY_TYPES, ...QLOO_SPECIAL_FILTER_TYPES] as const;

export const filterTypeSchema = z.enum(FILTER_TYPES);

export type FilterTypeInput = z.infer<typeof filterTypeSchema>;

export const demographicsSchema = z.object({
  ageBuckets: z.array(z.string()).optional(),
  gender: z.string().optional(),
  audienceIds: z.array(z.string()).optional(),
});

/**
 * Location as a Qloo SIGNAL.
 *
 * Only the two fields `requests.ts` can actually send: `signal.location.query`
 * and `signal.location`. Doc 03 §10 enumerates every Insights parameter and there
 * is no country among them, and doc 03 §11 says an unsupported parameter is
 * silently ignored rather than rejected — so accepting a `country` here would
 * produce a 200 response about a location the API never saw. Rejecting it is the
 * only way the omission is visible.
 *
 * The analyze body uses `analyzeLocationSchema` below instead, which does carry a
 * country, because that one is a creator profile field and not a signal.
 */
export const locationSchema = z.object({
  query: z.string().max(120).optional(),
  localityId: z.string().optional(),
});

/**
 * Location as the creator declared it.
 *
 * `country` and `city` are profile metadata. `country` feeds the geographic-fit
 * dimension, which compares it against the region the catalogue returned for a
 * brand; neither is forwarded as a signal, and `toSignalBlock` omits the location
 * block entirely when `query` and `localityId` are both absent.
 *
 * Keeping this separate from `locationSchema` is what stops a country name from
 * reaching `signal.location.query`. That would not merely be ignored: doc 03 §7
 * makes a `signal.location.query` that matches no locality a 400, so a country
 * would take the entire insights call down with it.
 */
export const analyzeLocationSchema = z.object({
  query: z.string().max(120).optional(),
  localityId: z.string().optional(),
  city: z.string().max(120).optional(),
  country: z.string().max(120).optional(),
});

/**
 * The signal block sent to `/v2/insights`.
 *
 * Doc 03 §8 requires at least one signal, and the API rejects an empty one with
 * 400 "at least one valid signal or filter is required". Validating that HERE
 * turns a wasted upstream call into an immediate, explainable 400.
 */
export const signalBlockSchema = z
  .object({
    entityIds: z.array(z.string().min(1)).default([]),
    tagIds: z.array(z.string().min(1)).optional(),
    demographics: demographicsSchema.optional(),
    location: locationSchema.optional(),
  })
  .refine(
    (signals) =>
      signals.entityIds.length > 0 ||
      (signals.tagIds?.length ?? 0) > 0 ||
      signals.demographics !== undefined ||
      signals.location !== undefined,
    {
      message:
        "At least one signal is required: entityIds, tagIds, demographics or location. An empty signal set is rejected upstream and would produce no personalisation.",
      path: ["entityIds"],
    },
  );

export type SignalBlockInput = z.infer<typeof signalBlockSchema>;

/** Caps `take` at the documented maximum so a caller cannot request a page the API will truncate. */
const MAX_TAKE = 50;

export const takeSchema = z.number().int().min(1).max(MAX_TAKE).default(MAX_TAKE);

export const recommendBodySchema = z.object({
  filterType: filterTypeSchema,
  signals: signalBlockSchema,
  take: takeSchema,
  page: z.number().int().min(0).optional(),
  explainability: z.boolean().default(true),
  filterTagIds: z.array(z.string()).optional(),
  tagTypes: z.array(z.string()).optional(),
  diversifyBySubtype: z.number().int().min(1).max(10).optional(),
  crossDomainBackfill: z.boolean().default(false),
  candidateEntityIds: z.array(z.string()).optional(),
  candidateTagIds: z.array(z.string()).optional(),
  scope: z.string().max(200).optional(),
});

export const tasteBodySchema = z.object({
  signals: signalBlockSchema,
  take: takeSchema,
  explainability: z.boolean().default(true),
  tagTypes: z.array(z.string()).optional(),
  diversifyBySubtype: z.number().int().min(1).max(10).optional(),
  scope: z.string().max(200).optional(),
});

/**
 * The profile body for `/api/analyze`.
 *
 * Deliberately NOT the full `creatorProfileSchema`: there is no `resolution`
 * field on the wire. Resolution state is the server's to assign, and letting a
 * caller assert `resolution: "resolved"` would be the one input that could put
 * fabricated data into the pipeline.
 *
 * An `entityId` MAY be supplied, because that is the documented disambiguation
 * outcome (doc 02 §7): the creator searched, several entities matched, and they
 * picked one. The route honours it when a `name` comes with it — the pair is what
 * a real `/api/qloo/search` match would have carried — and otherwise treats the
 * interest as unresolved and re-searches. `subtype` rides along when present but
 * is NOT part of that test: it is optional on `CulturalEntity`, so requiring it
 * would discard a legitimate choice. See `toCreatorProfile`.
 */
export const analyzeInterestSchema = z.object({
  query: z.string().trim().min(1).max(120),
  entityId: z.string().min(1).optional(),
  name: z.string().max(120).optional(),
  subtype: z.string().max(80).optional(),
  disambiguation: z.string().max(200).optional(),
  emphasis: z.enum(["low", "normal", "high"]).default("normal"),
});

export const analyzeBodySchema = z.object({
  creatorId: z.string().trim().min(1).max(80).default("anonymous"),
  handle: z.string().trim().min(1).max(80).default("creator"),
  displayName: z.string().trim().min(1).max(120).default("Creator"),
  platforms: z.array(z.enum(CONTENT_PLATFORMS)).default([]),
  niche: z.string().max(240).optional(),
  /**
   * The creator's own description of their work. Retained for provenance and for
   * the media kit; never sent to Qloo. The entities that became signals are in
   * `interests`, each confirmed by the creator against a live search result.
   */
  description: z.string().trim().max(2000).optional(),
  interests: z.array(analyzeInterestSchema).max(24).default([]),
  /**
   * Phrases the creator wrote that were never confirmed as entities. They are
   * reported back through `CreatorAnalysis.contextTerms` and contribute nothing
   * to any request. Capped like `interests` so the field cannot be used to smuggle
   * an unbounded blob into the cached payload.
   */
  contextTerms: z.array(z.string().trim().min(1).max(120)).max(24).default([]),
  coverage: z
    .object({
      coveredCategories: z.array(z.string().max(80)).max(24).default([]),
      saturation: z.record(z.string(), z.number().min(0).max(1)).default({}),
    })
    .default({}),
  demographics: z
    .object({
      // Validated against the documented enums rather than `z.string()`: Qloo
      // silently ignores an age bucket it does not recognise (doc 03 §11), so a
      // typo here would produce a demographic dimension that looks populated and
      // contributes nothing. Rejecting it is the only way the creator finds out.
      ageBuckets: z.array(z.enum(QLOO_AGE_BUCKETS)).default([]),
      gender: z.enum(QLOO_GENDERS).optional(),
    })
    .optional(),
  /**
   * Optional, creator-reported audience context.
   *
   * Validated against the closed enums for the same reason `ageBuckets` is, but
   * the consequence of a bad value is different: nothing here reaches Qloo, so an
   * unknown id would not break a request — it would render as an unlabelled id in
   * a sentence the creator reads about their own audience. Rejecting it is still
   * the cheapest way to keep that from happening.
   *
   * Capped like `contextTerms`: this rides into the request body and out into
   * rendered copy, so it cannot be an unbounded blob.
   */
  audience: z
    .object({
      groups: z.array(z.enum(AUDIENCE_GROUPS)).max(AUDIENCE_GROUPS.length).default([]),
      purposes: z.array(z.enum(CONTENT_PURPOSES)).max(CONTENT_PURPOSES.length).default([]),
      groupsOther: z.string().trim().min(1).max(120).optional(),
      purposesOther: z.string().trim().min(1).max(120).optional(),
    })
    .optional(),
  location: analyzeLocationSchema.optional(),
});

export type AnalyzeBody = z.infer<typeof analyzeBodySchema>;

/**
 * The shape a caller SENDS, as opposed to `AnalyzeBody`, which is the shape the
 * route ends up with after defaults and transforms.
 *
 * The distinction is not pedantic: `z.infer` reports every `.default()` field as
 * required and non-optional, so a client typing its outgoing payload as
 * `AnalyzeBody` is forced to invent a `creatorId` and a `handle` it does not
 * have. Typing it as `z.input` lets the client omit them and get the server's
 * defaults, which is the whole reason those fields have defaults.
 */
export type AnalyzeInput = z.input<typeof analyzeBodySchema>;

/** Render zod issues as one sentence a UI can show verbatim. */
export function describeIssues(error: z.ZodError, prefix = "Invalid request"): string {
  const parts = error.issues
    .slice(0, 5)
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
  const suffix = error.issues.length > 5 ? ` (+${error.issues.length - 5} more)` : "";
  return `${prefix}. ${parts.join("; ")}${suffix}`;
}
