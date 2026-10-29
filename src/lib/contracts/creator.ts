import { z } from "zod";

import type { CulturalTag, Provenance } from "./domain";
import { QLOO_AGE_BUCKETS, QLOO_GENDERS } from "./qloo";

/**
 * Creator profile contract.
 *
 * Doc 02 §39/§40 make demographics and location OPTIONAL — never mandatory.
 * The schema encodes that: only `selectedInterests` is required, and even an
 * empty list is representable so the degraded path can be tested.
 */

export const CONTENT_PLATFORMS = [
  "youtube",
  "tiktok",
  "instagram",
  "twitch",
  "podcast",
  "newsletter",
  "other",
] as const;
export type ContentPlatform = (typeof CONTENT_PLATFORMS)[number];

/**
 * Platform names as a creator would write them.
 *
 * Declared next to the union rather than inside a component because two places
 * render it (`CreatorHeader` and `MediaKit`), and doc 02 §30 forbids duplicating
 * UI logic across pages. Keyed by the closed union with no fallback lookup, so
 * adding a platform is a compile error here until it is given a label — a
 * `Record<string, string>` with a `?? platform` default would silently print the
 * raw id instead.
 */
export const PLATFORM_LABEL: Record<ContentPlatform, string> = {
  youtube: "YouTube",
  tiktok: "TikTok",
  instagram: "Instagram",
  twitch: "Twitch",
  podcast: "Podcast",
  newsletter: "Newsletter",
  other: "Other",
};

/**
 * Audience context — who the creator says they make content for.
 *
 * Same closed-union + exhaustive-`Record` shape as `CONTENT_PLATFORMS` above,
 * and for the same reason: an unlabelled member is a compile error rather than a
 * raw id printed on screen. These two vocabularies are OURS, not Qloo's — which
 * is why they live here and not in `qloo.ts` alongside `AGE_BUCKET_LABEL`. That
 * label map exists because the age buckets ARE Qloo's enum and are sent to Qloo;
 * these are never sent anywhere.
 *
 * The distinction the whole feature rests on:
 *   - Creator Taste DNA is derived from confirmed interests and provider data.
 *   - Audience context is ONLY what the creator ticked on a form. It is not
 *     measured follower data, not verified demographics, and not a signal.
 * `toCreatorSignals` deliberately does not read it. If it ever did, an unverified
 * self-description would start driving every number downstream.
 */
export const AUDIENCE_GROUPS = [
  "students",
  "gamers",
  "creative_professionals",
  "fashion_beauty",
  "technology",
  "fitness_wellness",
  "entertainment_pop",
  "food_lifestyle",
  "business",
  "general",
  "other",
] as const;
export type AudienceGroup = (typeof AUDIENCE_GROUPS)[number];

export const AUDIENCE_GROUP_LABEL: Record<AudienceGroup, string> = {
  students: "Students and learners",
  gamers: "Gamers",
  creative_professionals: "Creative professionals",
  fashion_beauty: "Fashion and beauty enthusiasts",
  technology: "Technology enthusiasts",
  fitness_wellness: "Fitness and wellness enthusiasts",
  entertainment_pop: "Entertainment and pop-culture fans",
  food_lifestyle: "Food and lifestyle enthusiasts",
  business: "Entrepreneurs and business professionals",
  general: "General audience",
  other: "Other",
};

/** What the creator says people come to their content for. See `AUDIENCE_GROUPS`. */
export const CONTENT_PURPOSES = [
  "entertainment",
  "education",
  "inspiration",
  "reviews",
  "tutorials",
  "stories",
  "lifestyle",
  "community",
  "other",
] as const;
export type ContentPurpose = (typeof CONTENT_PURPOSES)[number];

export const CONTENT_PURPOSE_LABEL: Record<ContentPurpose, string> = {
  entertainment: "Entertainment and humor",
  education: "Education and learning",
  inspiration: "Inspiration and motivation",
  reviews: "Product recommendations and reviews",
  tutorials: "Tutorials and practical guidance",
  stories: "Personal stories and relatable experiences",
  lifestyle: "Lifestyle and trends",
  community: "Community and shared interests",
  other: "Other",
};

/**
 * The same tick, read as a FORM OF EXPRESSION rather than as a reason to watch.
 *
 * `CONTENT_PURPOSE_LABEL` above is the audience-facing reading — an answer to
 * "what do people come to your content for?", which is the question the context
 * stage actually asks. This map is the creator-facing reading of the identical
 * answer: not why somebody watches, but what the maker does. Both are needed
 * because Content DNA and Audience Context are two layers over one input, and a
 * sentence reading "a collaboration in the form of a practical walkthrough" cannot
 * be built out of the label "Tutorials and practical guidance" without either
 * duplicating the vocabulary or splitting a display string — the failure
 * `AudienceWords` exists to prevent.
 *
 * Keyed by the closed union with no fallback, so a new purpose is a compile error
 * here until it has been given a form. The same guard the two label maps use.
 *
 * Pronoun-free throughout. These phrases reach a second-person screen, a
 * third-person document a brand forwards, and a first-person pitch, and one map
 * serves all three — "your community" in a media kit would address the reader as
 * though they were the creator.
 *
 * `other` is deliberately `undefined`. The creator typed their own words behind
 * that chip and those words arrive in `ContentDna.angles` verbatim; there is no
 * form of expression we can honestly name for a phrase we have never seen. A
 * fallback reading "a piece in their own style" would look like a description of
 * their method while saying nothing at all, and it would fire for exactly the
 * creators who took the trouble to answer in their own words.
 */
export const CONTENT_PURPOSE_APPROACH: Record<ContentPurpose, string | undefined> = {
  entertainment: "an entertainment-led piece",
  education: "an explainer",
  inspiration: "an inspiration-led piece",
  reviews: "a review or recommendation",
  tutorials: "a practical walkthrough",
  stories: "a story-led piece",
  lifestyle: "a lifestyle piece",
  community: "a community-led piece",
  other: undefined,
};

/**
 * The two optional audience-context answers, plus the free text behind "Other".
 *
 * Every field defaults empty so a profile saved before this existed parses
 * unchanged — that is the backward-compatibility requirement, and it is why the
 * arrays use `.default([])` rather than `.optional()`: a reader can then ask
 * `context.groups.length` without a null check on data that may predate the field.
 */
export const audienceContextSchema = z.object({
  groups: z.array(z.enum(AUDIENCE_GROUPS)).default([]),
  purposes: z.array(z.enum(CONTENT_PURPOSES)).default([]),
  /** The creator's own words, only carried when `groups` contains "other". */
  groupsOther: z.string().trim().max(120).optional(),
  /** The creator's own words, only carried when `purposes` contains "other". */
  purposesOther: z.string().trim().max(120).optional(),
});
export type AudienceContext = z.infer<typeof audienceContextSchema>;

/**
 * Audience context already reduced to display strings.
 *
 * This exists so `lib/copy/generate.ts` can consume it with a `import type` and
 * keep its no-runtime-imports rule intact: the copy layer receives WORDS, never
 * ids, so it never needs the label maps and therefore never needs a value import.
 * Ids stay on the wire and in the draft; only labels reach a sentence.
 */
export interface AudienceWords {
  /** Group labels in selection order, with the creator's own text appended. */
  groups: string[];
  /** Purpose labels in selection order, with the creator's own text appended. */
  purposes: string[];
}

/**
 * Resolve the ids to labels and fold in the "Other" text.
 *
 * Returns `undefined` rather than `{ groups: [], purposes: [] }` when the creator
 * answered neither question, because every caller's first act is a truthiness
 * check and an empty object is truthy. A caller that renders "You create for: "
 * with nothing after it is a worse failure than one extra `undefined` here.
 *
 * The `other` chip itself is never rendered as the word "Other". It is a control
 * that reveals a text field, not an answer, so what it contributes is the creator's
 * own phrase — and if they typed nothing, it contributes nothing. "You say you
 * create for Fashion and beauty enthusiasts, Other and amateur astronomers" states
 * one group and names one control.
 */
export function audienceContextWords(
  context: AudienceContext | undefined,
): AudienceWords | undefined {
  if (context === undefined) return undefined;

  const groups = context.groups
    .filter((group) => group !== "other")
    .map((group) => AUDIENCE_GROUP_LABEL[group]);
  const otherGroups = context.groups.includes("other") ? context.groupsOther?.trim() : undefined;
  if (otherGroups !== undefined && otherGroups.length > 0) groups.push(otherGroups);

  const purposes = context.purposes
    .filter((purpose) => purpose !== "other")
    .map((purpose) => CONTENT_PURPOSE_LABEL[purpose]);
  const otherPurposes = context.purposes.includes("other")
    ? context.purposesOther?.trim()
    : undefined;
  if (otherPurposes !== undefined && otherPurposes.length > 0) purposes.push(otherPurposes);

  if (groups.length === 0 && purposes.length === 0) return undefined;
  return { groups, purposes };
}

/**
 * Creator Content DNA — how the creator expresses themselves, reduced to words.
 *
 * The third of the three layers the product keeps apart, and the only one that is
 * DERIVED rather than captured:
 *
 *   - **Taste DNA** — the cultural world the creator belongs to, computed by the
 *     pipeline from confirmed entities and provider data. "What cultural world are
 *     you part of?"
 *   - **Content DNA** — this. Assembled from answers the creator already gave: the
 *     categories they said they cover, the purposes they ticked, the platforms they
 *     selected. "How do you express yourself inside that world?"
 *   - **Audience Context** — `AudienceWords` above. "Who do you intend to reach,
 *     and what do people come to your content for?"
 *
 * Content DNA and Audience Context share ONE input: the purposes answer reads both
 * as an angle (here) and as a reason to watch (there). That is the reuse §1 asks
 * for rather than a duplicate field — but it is also why the two are separate types
 * instead of one bag of strings. A builder handed both folded together could not
 * tell a claim about the MAKER from a claim about the AUDIENCE, and that difference
 * is the whole honesty argument: one is a statement of method, the other is a
 * statement of intent about people this product has never measured.
 *
 * NOTHING HERE IS EVIDENCE. Like `AudienceWords`, this is never sent to a provider,
 * never resolved to an entity, never read by `toCreatorSignals`, and never present
 * in `analysisCacheKey`. It cannot create an intersection, raise a fit score or move
 * a confidence value. Its only consumers are the copy builders, where it names the
 * FORM an already-established overlap would take — and `contentDnaFor()` in the copy
 * layer is the single gate that keeps it to that.
 *
 * Every field is a display string, for the reason `AudienceWords` gives: the copy
 * layer holds its no-runtime-imports rule by only ever receiving words.
 */
export interface ContentDna {
  /**
   * What the creator says the work is about: the labels behind the coverage they
   * declared. Empty when they declared none — the common case — and left empty
   * rather than filled from Taste DNA. The categories the analysis derives describe
   * the cultural world the creator sits in, not the content they make, and borrowing
   * them here would erase the exact distinction this type exists to hold.
   */
  topics: string[];
  /**
   * The angle labels, in the creator's own selection order, with the words they typed
   * behind "Other" appended verbatim — the same treatment `audienceContextWords`
   * gives them, so the control is never printed as the word "Other".
   */
  angles: string[];
  /**
   * The first angle that has a form of expression — "a practical walkthrough" — for
   * the builders that shape a collaboration idea rather than print a list. Absent
   * when nothing was ticked, or when only "Other" was; see `CONTENT_PURPOSE_APPROACH`.
   */
  approach?: string;
  /** Format labels, e.g. "YouTube". Empty when no platform was selected. */
  formats: string[];
  /**
   * The synthesis without the format tail: what the work is and how it is made,
   * e.g. "Tutorials and practical guidance, covering Films".
   *
   * Not a convenience duplicate of `positioning`. The pitch already states the
   * platforms in their own sentence, so printing `positioning` there would name
   * them twice inside one email a brand is meant to read — and a builder cannot
   * strip the tail off a composed string without splitting display text, which is
   * the failure `AudienceWords` exists to prevent. Absent when neither an angle nor
   * a topic was stated.
   */
  method?: string;
  /**
   * The concise synthesis: one phrase naming the approach, the focus and the format.
   *
   * Deliberately SUBJECTLESS, so a second-person screen, a third-person document and
   * a first-person pitch can each put their own pronoun in front of the same phrase.
   * Three composed copies would be three chances for the kit and the screen to
   * describe the same creator differently. Absent when too little was stated for one
   * to be honest.
   */
  positioning?: string;
}

/**
 * A cultural interest the creator selected. Resolution to a Qloo entity id
 * happens through `/search` (doc 03 §8 step 1) and multiple hits must be
 * presented rather than silently guessed (doc 02 §7).
 */
export const selectedInterestSchema = z.object({
  /** Free-text as typed, retained so the UI can show what the creator meant. */
  query: z.string().min(1),
  /** Resolved Qloo entity id. Absent until resolution succeeds. */
  entityId: z.string().optional(),
  name: z.string().optional(),
  subtype: z.string().optional(),
  disambiguation: z.string().optional(),
  imageUrl: z.string().optional(),
  resolution: z.enum(["unresolved", "resolved", "ambiguous", "not_found"]).default("unresolved"),
  /** Optional per-interest emphasis. NOTE: per-entity weights are POST-only and
   *  may be unavailable on the hackathon host — treated as a UI hint first. */
  emphasis: z.enum(["low", "normal", "high"]).default("normal"),
});
export type SelectedInterest = z.infer<typeof selectedInterestSchema>;

/**
 * Declared content coverage. Doc 05 §10C forbids inferring coverage without
 * data, so this is explicitly creator-entered and the methodology must be
 * labelled wherever the opportunity gap is shown.
 */
export const contentCoverageSchema = z.object({
  /** Creator-declared categories they already cover. */
  coveredCategories: z.array(z.string()).default([]),
  /** Optional tag ids resolved from the above, when Qloo could map them. */
  coveredTagIds: z.array(z.string()).default([]),
  /** 0..1 self-reported saturation per category. Creator-entered, not derived. */
  saturation: z.record(z.string(), z.number().min(0).max(1)).default({}),
  methodology: z
    .string()
    .default("Creator-declared content categories. Coverage is self-reported, not measured."),
});
export type ContentCoverage = z.infer<typeof contentCoverageSchema>;

export const audienceDemographicsSchema = z.object({
  ageBuckets: z.array(z.enum(QLOO_AGE_BUCKETS)).default([]),
  gender: z.enum(QLOO_GENDERS).optional(),
  /** Optional; the `/v2/audiences` endpoint is deprecated, so treat as best-effort. */
  audienceIds: z.array(z.string()).default([]),
});
export type AudienceDemographics = z.infer<typeof audienceDemographicsSchema>;

export const locationSchema = z.object({
  /**
   * Natural-language place, sent as `signal.location.query` (fuzzy match).
   *
   * Doc 03 §7: a `signal.location.query` that matches no locality is a 400, and
   * doc 03 §10 lists NO country parameter for signals at all. So this field is
   * only ever populated with something the creator resolved to a real locality —
   * never with a country name, which would take the whole insights call down.
   */
  query: z.string().optional(),
  /** Resolved locality id, preferred over the free-text query when present. */
  localityId: z.string().optional(),
  city: z.string().optional(),
  /**
   * Country name, used ONLY by the geographic-fit dimension. It is not a Qloo
   * signal and is never sent as one; see `toSignalBlock`.
   */
  country: z.string().optional(),
});
export type CreatorLocation = z.infer<typeof locationSchema>;

export const creatorProfileSchema = z.object({
  id: z.string().min(1),
  handle: z.string().min(1),
  displayName: z.string().min(1),
  platforms: z.array(z.enum(CONTENT_PLATFORMS)).default([]),
  /** The creator's stated niche, in their own words. */
  niche: z.string().optional(),
  /**
   * The creator's own description of their work, in free text.
   *
   * This is the primary input of the discovery flow, and it is NEVER sent to Qloo
   * as a signal. It is the source the candidate phrases are extracted from, and
   * it is retained so the results and the media kit can quote the creator's own
   * words. Treating it as a signal would mean an unconfirmed guess driving every
   * downstream number.
   */
  description: z.string().optional(),
  selectedInterests: z.array(selectedInterestSchema).default([]),
  /**
   * Phrases from `description` that were never confirmed as entities.
   *
   * Kept rather than dropped: the creator wrote them, so the results acknowledge
   * them. They contribute no signal, appear in no request, and are reported back
   * through `CreatorAnalysis.contextTerms` so nothing vanishes silently.
   */
  contextTerms: z.array(z.string()).default([]),
  coverage: contentCoverageSchema.default({}),
  /** Optional by design (doc 02 §39). */
  demographics: audienceDemographicsSchema.optional(),
  /** Optional by design (doc 02 §40). */
  location: locationSchema.optional(),
  /**
   * Optional, creator-reported audience context: who they say they create for and
   * what people come to the content for.
   *
   * NOT a signal and NOT a scoring input. `toCreatorSignals` does not read it,
   * `analysisCacheKey` does not read it, and no intersection, fit score or
   * confidence value changes when it is present. Its only consumers are the
   * explanation and copy builders, where it adds a second, clearly-labelled
   * sentence about why an overlap the evidence ALREADY established might matter
   * to this creator. Absent, everything renders exactly as it did before.
   */
  audience: audienceContextSchema.optional(),
});
export type CreatorProfile = z.infer<typeof creatorProfileSchema>;

/** A resolved signal ready to be sent to Qloo. */
export interface CreatorSignals {
  entityIds: string[];
  /** Interest id → resolved entity id, so explainability can be mapped back. */
  entityNames: Record<string, string>;
  tagIds: string[];
  demographics?: AudienceDemographics;
  location?: CreatorLocation;
  /** Interests that never resolved. Surfaced honestly rather than dropped. */
  unresolved: Array<{ query: string; reason: "not_found" | "ambiguous" }>;
}

/**
 * Extract the usable signals from a profile.
 *
 * Only `resolution === "resolved"` interests contribute an entity id. An
 * unresolved interest must never be silently dropped (doc 02 §7) — it is
 * reported back so the UI can ask the creator to disambiguate.
 */
export function toCreatorSignals(profile: CreatorProfile): CreatorSignals {
  const entityIds: string[] = [];
  const entityNames: Record<string, string> = {};
  const unresolved: CreatorSignals["unresolved"] = [];

  for (const interest of profile.selectedInterests) {
    if (interest.entityId && interest.resolution === "resolved") {
      entityIds.push(interest.entityId);
      entityNames[interest.entityId] = interest.name ?? interest.query;
      continue;
    }
    if (interest.resolution === "ambiguous" || interest.resolution === "not_found") {
      unresolved.push({ query: interest.query, reason: interest.resolution });
    } else {
      unresolved.push({ query: interest.query, reason: "not_found" });
    }
  }

  const tagIds = profile.coverage.coveredTagIds.filter((id) => id.length > 0);

  return {
    entityIds: dedupe(entityIds),
    entityNames,
    tagIds: dedupe(tagIds),
    demographics: profile.demographics,
    location: profile.location,
    unresolved,
  };
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

/** Convenience for the network visualisation: nodes the creator supplied. */
export function creatorProvidedTags(tags: CulturalTag[]): CulturalTag[] {
  return tags.filter((t) => t.provenance === ("creator" satisfies Provenance));
}
