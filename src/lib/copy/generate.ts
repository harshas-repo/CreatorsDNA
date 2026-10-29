import type {
  DataSource,
  ObservationCode,
  PipelineObservationCode,
  ProviderErrorCode,
  Provenance,
} from "@/lib/contracts/domain";
// Type-only, like every other import here, and the reason it can be: the copy layer
// receives audience context already resolved to WORDS by `audienceContextWords`, and
// Content DNA already composed by `describeContent`, so it never needs an id→label
// map or the approach map and the no-runtime-imports rule below survives both intact.
import type { AudienceWords, ContentDna } from "@/lib/contracts/creator";
// Type-only, so the no-runtime-imports rule above survives this: the BANDS are
// computed by `partitionTasteDna` in the analysis layer and handed in, rather
// than re-derived here. Re-deriving them would create a second copy of the
// core/adjacent classification that could drift from the first — and a headline
// that disagrees with the chart beside it is worse than either alone.
import type { TasteDnaBands } from "@/lib/analysis/tasteDna";
import type {
  AffinityRankItem,
  BrandFitViewModel,
  BrandOpportunity,
  BrandPathway,
  OpportunityPoint,
  ScoreComponent,
  SharedTasteDimension,
  TasteDna,
  TasteIntersection,
} from "@/lib/contracts/viewModels";

/**
 * Template-based natural-language generation (decision D5, doc 01 §6, doc 02 §16).
 *
 * NO LLM. Every sentence here is a deterministic function of real values. The
 * same input always produces the same string, which is what makes the copy
 * testable and — more importantly — auditable: a reviewer can read this file and
 * know the complete set of claims the product is capable of making.
 *
 * NO RUNTIME IMPORTS EITHER. Every import below is `import type`, so this module
 * carries no dependency into whatever bundle includes it. That is what lets a
 * client component call `describeOpportunityPoint()` without dragging the scoring
 * layer into the browser, and it is why the previous `alignmentLabel` re-export —
 * which nothing consumed — was removed: it was the only thing making this file
 * look like it depended on `@/lib/scoring`. Keep it that way.
 *
 * THE HONESTY RULES, encoded rather than merely intended
 * ------------------------------------------------------
 * 1. **Never "N% of people".** Fact F13: Qloo affinity is not survey data and
 *    never was. No template in this file renders a percentage of an audience.
 *    `FORBIDDEN_PATTERNS` exists so a test can assert that over generated output.
 *
 * 2. **Never claim the followers were measured.** Doc 01 §37. Templates say
 *    "your selected interests show…", never "your followers love…".
 *
 * 3. **Never say "Qloo-derived" about synthetic data.** This is the subtlest and
 *    most dangerous of the three, because it is a single adjective. `SourceVoice`
 *    is derived from `DataSource.isIllustrative` and is the ONLY way a template
 *    obtains an attribution noun, so the wrong one cannot be typed by accident.
 *
 * 4. **Prefer a qualitative label over a bare number.** Doc 05 §10E. Numbers
 *    appear only alongside the basis that produced them.
 */

// ---------------------------------------------------------------------------
// Source voice — the attribution gate
// ---------------------------------------------------------------------------

export interface SourceVoice {
  /** Noun for the data source, e.g. "Qloo". */
  providerNoun: string;
  /** Adjective for derived values, e.g. "Qloo-derived". */
  derivedAdjective: string;
  /** Prefix for a whole panel when the data is illustrative. */
  illustrativeNotice: string | undefined;
  /**
   * Overrides the two-way `affinityNoun()` split for a voice that must name
   * neither Qloo nor the synthetic dataset. Absent on the live and synthetic
   * voices, which keep the original phrasing.
   */
  affinityPhrase?: string;
  isIllustrative: boolean;
}

const LIVE_VOICE: SourceVoice = {
  providerNoun: "Qloo",
  derivedAdjective: "Qloo-derived",
  illustrativeNotice: undefined,
  isIllustrative: false,
};

const SYNTHETIC_VOICE: SourceVoice = {
  providerNoun: "the synthetic development dataset",
  derivedAdjective: "generated for illustration",
  illustrativeNotice:
    "Illustrative data. Everything described here was generated locally for development, not returned by Qloo.",
  isIllustrative: true,
};

/**
 * Neutral attribution for the public example route (`/examples`).
 *
 * The examples exist to let a visitor visualise what the product does, so the
 * copy names no outside source at all: it never borrows Qloo's name for results
 * Qloo did not return, and it never waves the synthetic dataset at a reader who
 * is looking at the product's own output. Paired with `EXAMPLE_SOURCE` in
 * `src/lib/demo/examplePresentation.ts`, which suppresses the illustrative-data
 * banners on that route and nowhere else.
 */
export const EXAMPLE_VOICE: SourceVoice = {
  providerNoun: "the catalogue",
  derivedAdjective: "derived",
  illustrativeNotice: undefined,
  affinityPhrase: "modelled cultural affinity",
  isIllustrative: false,
};

/**
 * The only sanctioned way to obtain an attribution.
 *
 * `isIllustrative` wins over `providerId`: a cached live response is still live,
 * but anything flagged illustrative must never borrow Qloo's name regardless of
 * which provider produced it.
 *
 * The public example route presents its output through `EXAMPLE_SOURCE`
 * (`providerId: "example"`, `isIllustrative: false`), which resolves to the
 * neutral `EXAMPLE_VOICE`: the examples are the product's own output shown so a
 * visitor can visualise what it does, so the copy names neither Qloo nor the
 * development dataset.
 */
export function sourceVoice(source: DataSource): SourceVoice {
  if (source.isIllustrative) return SYNTHETIC_VOICE;
  if (source.providerId === "example") return EXAMPLE_VOICE;
  return LIVE_VOICE;
}

export function voiceForProvenance(provenance: Provenance): SourceVoice {
  return provenance === "synthetic" ? SYNTHETIC_VOICE : LIVE_VOICE;
}

// ---------------------------------------------------------------------------
// Forbidden claims
// ---------------------------------------------------------------------------

/**
 * Re-exported from `./honesty` so that every existing import site keeps working.
 *
 * The rules live in their own dependency-free module because `PitchEditor`
 * checks creator-edited text in the browser on every keystroke, and this file
 * imports the scoring layer — importing the checks from here would pull the
 * templates and `brandFit` into the client bundle for seven regular
 * expressions. `./honesty` has no imports at all, so the client copy stays small.
 */
export {
  EDITED_PITCH_DISCLOSURE,
  FORBIDDEN_PATTERNS,
  assertHonestCopy,
  checkCopyBatch,
  findHonestyViolations,
} from "./honesty";
export type { HonestyViolation } from "./honesty";

// ---------------------------------------------------------------------------
// Qualitative vocabulary
// ---------------------------------------------------------------------------

/**
 * Strength wording.
 *
 * Deliberately free of value judgement. Doc 05 §12 forbids implying an
 * opportunity is good or bad, so these describe the STRENGTH OF THE ALIGNMENT
 * THE DATA SHOWS and nothing else.
 */
export function strengthWord(value: number): string {
  if (value >= 0.8) return "strong";
  if (value >= 0.6) return "clear";
  if (value >= 0.4) return "moderate";
  if (value >= 0.2) return "limited";
  return "little";
}

/** Approved attribution phrases, from doc 01 §7 and §37. */
export function affinityNoun(voice: SourceVoice): string {
  if (voice.affinityPhrase !== undefined) return voice.affinityPhrase;
  return voice.isIllustrative ? "modelled cultural affinity" : "Qloo-derived cultural affinity";
}

function list(words: readonly string[], conjunction = "and"): string {
  if (words.length === 0) return "";
  if (words.length === 1) return words[0]!;
  if (words.length === 2) return `${words[0]} ${conjunction} ${words[1]}`;
  return `${words.slice(0, -1).join(", ")}, ${conjunction} ${words[words.length - 1]}`;
}

function topLabels<T>(items: readonly T[], pick: (item: T) => string, count = 3): string[] {
  return items.slice(0, count).map(pick);
}

// ---------------------------------------------------------------------------
// Taste DNA
// ---------------------------------------------------------------------------

export interface TasteDnaCopy {
  headline: string;
  /**
   * Which evidence trail the headline actually rests on.
   *
   * Not decoration — the four values make a claim that the prose alone cannot
   * carry. `declared` means every taste named in the headline traces to an
   * entity the creator confirmed; `adjacent` means none of them do, and the
   * headline says so instead of borrowing the authority of the word "centres";
   * `categories` means no taste descriptor survived at all and the sentence
   * falls back to where the catalogue placed the confirmed work; `none` means
   * there was nothing to build from. A UI or a test can assert on this rather
   * than on a string it would have to re-parse.
   */
  basis: "declared" | "adjacent" | "categories" | "none";
  summary: string;
  declaredLine: string;
  discoveredLine: string;
  /**
   * The profile as one continuous reading, in the order the evidence runs:
   * what the creator confirmed → where the catalogue places it → what that
   * connects to → what falls outside it → what the whole thing is not.
   *
   * `undefined` when there is nothing to narrate. Every clause is built only from
   * a list that is non-empty, so a thin profile produces a short honest paragraph
   * rather than one with gaps papered over by generic filler — which is the
   * difference between a story about this creator and a paragraph about creators.
   */
  positioning: string | undefined;
  emergingLine: string | undefined;
  unexpectedLine: string | undefined;
}

/**
 * The headline is built from the CORE band, never from `dna.coreTastes` whole.
 *
 * `coreTastes` is a single ranked list mixing two different kinds of evidence:
 * descriptors carried by entities the creator confirmed, and descriptors carried
 * by whatever else the catalogue returned for those interests. The second kind
 * outnumbers the first almost every time, because one confirmed interest expands
 * into dozens of results — so a headline read off the top of the combined list
 * describes the expansion, not the creator. That is how a profile built from a
 * tattoo studio and a live-music pub came to announce itself as "Pizza, Indian,
 * Mediterranean, South Indian, … and Farmstay": every one of those words was a
 * real tag on a real returned result, and none of them was traceable to anything
 * the creator had confirmed.
 *
 * The bands are passed in rather than recomputed here so the headline and the
 * core/adjacent split rendered beside it cannot disagree.
 */
export function describeTasteDna(
  dna: TasteDna,
  voice: SourceVoice,
  bands: TasteDnaBands,
): TasteDnaCopy {
  const core = topLabels(bands.core, (entry) => entry.label);
  const adjacent = topLabels(bands.adjacent, (entry) => entry.label);
  const categories = topLabels(dna.categories, (category) => category.label);
  const declared = topLabels(dna.declared, (entry) => entry.label);

  const basis: TasteDnaCopy["basis"] =
    core.length > 0
      ? "declared"
      : adjacent.length > 0
        ? "adjacent"
        : categories.length > 0
          ? "categories"
          : "none";

  const headline =
    basis === "declared"
      ? `Your taste DNA centres on ${list(core)}.`
      : basis === "adjacent"
        ? // Deliberately NOT "centres on". These descriptors reached the profile
          // only through the catalogue's expansion of what the creator confirmed,
          // so claiming them as the centre of their taste would attribute to the
          // creator a preference they never expressed.
          `No taste descriptor could be traced to the interests you confirmed. Related ground the catalogue connects them to includes ${list(
            adjacent,
          )}.`
        : basis === "categories"
          ? `No taste descriptor could be traced to the interests you confirmed. The catalogue places them in ${list(
              categories,
            )}.`
          : "Your taste DNA could not be built from the available data.";

  const summary =
    basis === "none"
      ? `Based on the interests you provided, no ${affinityNoun(
          voice,
        )} could be established. The fallback notes below explain what was missing.`
      : basis === "declared"
        ? `Based on the interests you provided, ${affinityNoun(voice)} connects your declared taste — ${list(
            declared,
          ) || "as selected"} — to ${list(categories) || "the categories shown"}. The headline names only the descriptors traceable to what you confirmed; the rest of the list below is related ground reached through the catalogue's expansion of it. This is a modelled taste signal derived from those inputs, not a measurement of your audience.`
        : `Based on the interests you provided, ${affinityNoun(voice)} returned related ground but nothing traceable to the specific interests you confirmed — ${list(
            declared,
          ) || "as selected"}. What follows is the catalogue's expansion of those inputs, labelled as such. This is a modelled taste signal, not a measurement of your audience.`;

  const declaredLine =
    dna.declared.length > 0
      ? `You selected ${dna.declared.length} ${
          dna.declared.length === 1 ? "interest" : "interests"
        }: ${list(topLabels(dna.declared, (entry) => entry.label, 8), "and")}.`
      : "You have not selected any interests yet.";

  const discoveredLine =
    dna.discovered.length > 0
      ? `${dna.discovered.length} further ${
          dna.discovered.length === 1 ? "affinity was" : "affinities were"
        } discovered from those inputs, including ${list(
          topLabels(dna.discovered, (entry) => entry.label),
        )}.`
      : "Nothing beyond your selections was discovered.";

  const emergingLine =
    dna.emergingSignals.length > 0
      ? `Emerging signals — high affinity, low catalogue popularity — include ${list(
          topLabels(dna.emergingSignals, (signal) => signal.label),
        )}.`
      : undefined;

  const unexpectedLine =
    dna.unexpectedAffinities.length > 0
      ? `Beyond your niche: ${list(
          topLabels(dna.unexpectedAffinities, (affinity) => affinity.label),
        )}.`
      : undefined;

  return {
    headline,
    basis,
    summary,
    declaredLine,
    discoveredLine,
    positioning: positioning(dna, voice),
    emergingLine,
    unexpectedLine,
  };
}

/**
 * The narrative paragraph, assembled clause by clause.
 *
 * Each clause has a guard, and the guards are the point: a sentence about
 * cross-category movement is only emitted when a cross-category result actually
 * exists. The alternative — a fixed four-sentence shape with "various" or
 * "related culture" in the empty slots — is the generic content requirement one
 * asks to omit rather than pad with.
 */
function positioning(dna: TasteDna, voice: SourceVoice): string | undefined {
  const declared = topLabels(dna.declared, (entry) => entry.label, 4);
  const categories = topLabels(dna.categories, (category) => category.label, 3);
  const discovered = topLabels(dna.discovered, (entry) => entry.label, 4);
  if (declared.length === 0 && categories.length === 0) return undefined;

  const clauses: string[] = [];

  clauses.push(
    declared.length > 0
      ? `It starts with what you confirmed: ${list(declared)}.`
      : "No specific entity was confirmed, so this profile starts from categories rather than from work you named.",
  );

  if (categories.length > 0) {
    clauses.push(`The catalogue places that work in ${list(categories)}.`);
  }

  if (discovered.length > 0) {
    clauses.push(
      `From there ${voice.providerNoun} connects you to ${list(
        discovered,
      )} — none of which you named yourself.`,
    );
  }

  // The unexpected affinities are the actionable part of the story, so they get
  // their own clause rather than being folded into the discovery list above.
  if (dna.unexpectedAffinities.length > 0) {
    const labels = topLabels(dna.unexpectedAffinities, (affinity) => affinity.label, 3);
    clauses.push(
      `${list(labels)} ${dna.unexpectedAffinities.length === 1 ? "sits" : "sit"} outside the categories you confirmed, which is where the room to move is.`,
    );
  }

  clauses.push(
    `Read all of it as a modelled position in culture derived from your own inputs — ${affinityNoun(
      voice,
    )}, not a measurement of the people who watch you.`,
  );

  return clauses.join(" ");
}

/**
 * The one-line "why" behind a highlighted core taste.
 *
 * This exists because a bare tag reads as a verdict. A creator who makes dream
 * pop and sees "other singer-songwriter" as their top taste has no way to check
 * it — which is exactly the "not sure that should be the best match" complaint.
 * It is not a verdict: the tag surfaced because it is the one carried by the
 * most entities the data source returned for the interests they declared, and
 * that trail is already computed as `contributedBy`. Naming those entities turns
 * an assertion into evidence the creator can inspect, and frames them as results
 * the data RETURNED — recommendations, not something the creator declared.
 *
 * `support` counts entity RESULTS, never a percentage of an audience, and no
 * word here ranks or promises (doc 01 §37, doc 05 §12, fact F13).
 */
export function describeCoreTaste(taste: TasteDna["coreTastes"][number]): {
  label: string;
  reason: string;
} {
  const label = taste.tag.name;
  const contributors = taste.contributedBy
    .map((entry) => entry.entityName.trim())
    .filter((name) => name.length > 0);
  const results = `${taste.support} ${taste.support === 1 ? "result" : "results"}`;
  if (contributors.length === 0) {
    return { label, reason: `Surfaced because ${results} returned for your declared interests carry it.` };
  }
  const strongest = contributors.slice(0, 3);
  const more =
    contributors.length > strongest.length ? ` (+${contributors.length - strongest.length} more)` : "";
  return {
    label,
    reason: `Surfaced because ${results} returned for your declared interests carry it — strongest ${list(
      strongest,
    )}${more}.`,
  };
}

// ---------------------------------------------------------------------------
// Unexpected affinity (doc 01 §9 wording)
// ---------------------------------------------------------------------------

/**
 * Doc 01 §9 supplies the approved framings — "Beyond your niche", "An unexpected
 * connection", "Something you may not have expected" — and warns against making
 * unsupported claims about actual followers. `HEADING_CHOICES` rotates through
 * them deterministically by index so a page of six does not repeat one phrase
 * six times, while still producing identical output for identical input.
 */
export const UNEXPECTED_HEADINGS = [
  "Beyond your niche",
  "An unexpected connection",
  "Something you may not have expected",
  "Where your taste could take you next",
] as const;

export function describeUnexpectedAffinity(
  affinity: TasteDna["unexpectedAffinities"][number],
  index: number,
  voice: SourceVoice,
): { heading: string; body: string } {
  const heading = UNEXPECTED_HEADINGS[index % UNEXPECTED_HEADINGS.length]!;
  const source = affinity.apiSourced
    ? `The data source flagged this as a cross-domain result.`
    : `CreatorsDNA identified this by comparing the returned categories against the ones you declared.`;
  return {
    heading,
    body: `${affinity.label} (${affinity.category}) shows ${strengthWord(
      affinity.affinity,
    )} ${affinityNoun(voice)} even though you did not select it. ${source} This is a modelled taste signal, not a measurement of your audience.`,
  };
}

// ---------------------------------------------------------------------------
// Brand fit rationale (doc 01 §6's structured reasoning)
// ---------------------------------------------------------------------------

/**
 * The development-data caveat appended to a brand-fit rationale when the source
 * is illustrative. Exported as a constant so the example presentation layer can
 * recognise and drop the exact line rather than pattern-matching prose that
 * could drift. See `src/lib/demo/examplePresentation.ts`.
 */
export const SYNTHETIC_FIT_DISCLOSURE =
  "These figures are generated development data. They are not a real assessment of this brand and must not be quoted.";

/**
 * The rationale lines rendered inside the brand-fit breakdown.
 *
 * Doc 01 §6 shows the intended shape: a factor table, then a deterministic
 * sentence built from it. This produces that sentence from the components
 * themselves, so the prose can never disagree with the bars next to it — they
 * are the same data.
 */
export function describeBrandFit(
  fit: BrandFitViewModel,
  voice: SourceVoice,
): string[] {
  const lines: string[] = [];
  const used = fit.components.filter((component) => component.available);
  const omitted = fit.components.filter((component) => !component.available);

  if (!fit.overall.renderable) {
    // Two distinct situations reach this branch and they need different sentences.
    // Nothing at all could be computed, or things could be computed but none of
    // them measured culture — the second being the case §6.3 exists for, where a
    // high number assembled from audience, geography and coverage would otherwise
    // be presented as an alignment claim. Naming the dimensions that WERE assessed
    // is what stops "no score" reading as "no data about this brand at all".
    const assessed = fit.components.filter((component) => component.available);
    lines.push(
      assessed.length === 0
        ? `No fit score is shown for ${fit.brandName}. None of the five dimensions could be computed from the available data, and inventing one would misrepresent what is known.`
        : `No fit score is shown for ${fit.brandName}. ${assessed.length} of ${
            fit.overall.componentsTotal
          } dimensions could be assessed — ${list(
            assessed.map((component) => component.label.toLowerCase()),
          )} — but none of them measures cultural compatibility, so there is no alignment to claim. What was assessed is listed in the breakdown and is about audience, geography and coverage rather than about fit.`,
    );
    return lines;
  }

  const strongest = [...used].sort(
    (a, b) => (b.value ?? 0) - (a.value ?? 0) || b.effectiveWeight - a.effectiveWeight,
  )[0];
  const weakest = [...used].sort((a, b) => (a.value ?? 0) - (b.value ?? 0))[0];

  lines.push(
    `${fit.brandName} shows ${fit.overall.label.toLowerCase()} with your profile, at ${Math.round(
      fit.overall.value * 100,
    )} on a 0–100 fit scale built from your own inputs.`,
  );

  if (strongest && strongest.value !== undefined) {
    lines.push(
      `The strongest dimension is ${strongest.label.toLowerCase()} (${Math.round(
        strongest.value * 100,
      )}), ${strongest.basis.toLowerCase()}`,
    );
  }
  if (weakest && weakest !== strongest && weakest.value !== undefined) {
    lines.push(
      `The weakest is ${weakest.label.toLowerCase()} (${Math.round(weakest.value * 100)}).`,
    );
  }

  lines.push(fit.overall.disclosure);

  if (omitted.length > 0) {
    lines.push(
      `Not shown: ${list(omitted.map((component) => component.label))}. ${list(
        omitted
          .map((component) => component.basis)
          .filter((basis) => basis.length > 0)
          .slice(0, 1),
      ) || "The underlying data was not available."}`,
    );
  }

  if (voice.isIllustrative) {
    lines.push(SYNTHETIC_FIT_DISCLOSURE);
  }

  return lines;
}

/**
 * One-line summary for a card, always paired with the breakdown elsewhere.
 *
 * Deliberately not called a "verdict": doc 05 §12 is explicit that cultural fit
 * is exploratory, and the word would leak into the UI through the label it
 * produces. It reads `overall.label` (qualitative) plus the dimension count, so
 * the line cannot state a number without also stating how much evidence is
 * behind it.
 *
 * When the score is unrenderable the label is returned on its own. That label is
 * already the honest sentence §6.3 asks for — "Not enough comparable evidence" —
 * and it is set by the scoring layer, which knows WHY. Restating a fixed string
 * here would be a second source of truth about a score's meaning, and the two
 * would eventually disagree in exactly the case that matters.
 *
 * Takes a `Pick` rather than the whole view-model because it reads nothing else.
 * That is what lets `ScoreBreakdown` call it with only `overall` in hand instead
 * of casting a partial object to the full type.
 */
export function fitHeadline(fit: Pick<BrandFitViewModel, "overall">): string {
  if (!fit.overall.renderable) return fit.overall.label;
  return `${fit.overall.label} · ${fit.overall.componentsUsed} of ${fit.overall.componentsTotal} dimensions`;
}

// ---------------------------------------------------------------------------
// What a fit score means (doc 05 §10E)
// ---------------------------------------------------------------------------

/**
 * The interpretation of the number, in words, for the place the number is shown.
 *
 * Doc 05 §10E forbids an unexplained overall percentage, and the existing
 * `disclosure` explains which dimensions were OMITTED but not what the figure
 * that remains actually is. A creator reading "72" on a brand card has no way to
 * tell whether that is a probability, a share of an audience, or a rank — and the
 * most damaging guess they could make is the first one.
 *
 * The rank guess is the one §4 exists to close. This used to say the figure was a
 * position within the set of brands returned in the same run, which was true while
 * taste fit was a min-max normalised discovery affinity and stopped being true the
 * moment it became a measured overlap. It now says what each dimension is, and
 * says out loud that none of them is a list position.
 *
 * Returns `undefined` when nothing was scored, because there is then no number to
 * explain and rendering "not scored" twice would read as a bug.
 */
export function explainFitScore(fit: BrandFitViewModel): string | undefined {
  if (!fit.overall.renderable) return undefined;
  const omitted = fit.overall.componentsTotal - fit.overall.componentsUsed;
  const used = fit.components
    .filter((component) => component.available)
    .map((component) => component.label.toLowerCase());
  return (
    `${Math.round(fit.overall.value * 100)} of 100 is a weighted blend of ${
      fit.overall.componentsUsed
    } of ${fit.overall.componentsTotal} dimensions${
      used.length > 0 ? ` — ${list(used)}` : ""
    }. Each one is a measurement in its own right and carries the basis sentence shown beside it: ` +
    `the cultural ones count descriptors the catalogue returned for this brand, not where it sat in a list of candidates. ` +
    `It is not a percentage of any audience, not a likelihood of a deal, and not comparable to a score from another analysis.` +
    (omitted > 0
      ? ` The other ${omitted} had no evidence and were left out rather than scored at zero, so the weights of the rest were renormalised to sum to 1.`
      : "")
  );
}

// ---------------------------------------------------------------------------
// The shared taste: what the intersection actually found
// ---------------------------------------------------------------------------

/**
 * The names of the cultural dimensions both sides share, strongest first.
 *
 * §15 wants "your creator profile and this brand both show strong cultural
 * connections around X, Y and Z", and X, Y, Z have to be the dimensions the
 * comparison found — not the interests the drivers happened to name. So they come
 * off `intersection.shared`: the same list the ranking sorted on, which is what
 * stops the sentence and the order of the brand list disagreeing about why a brand
 * is here at all.
 *
 * Returns `[]` rather than a fallback when nothing overlapped. §7 lets a sparse
 * brand stay a candidate; it does not let us invent shared ground for one.
 */
export function sharedTasteLabels(
  intersection: TasteIntersection | undefined,
  count = 3,
): string[] {
  if (intersection === undefined) return [];
  return intersection.shared
    .map((dimension) => dimension.label.trim())
    .filter((label) => label.length > 0)
    .slice(0, count);
}

/**
 * The one shared dimension that matters most to the creator's own profile.
 *
 * `shared` arrives sorted by creator-side weight descending, so the first entry is
 * the overlap carrying most of THEIR taste rather than the one the brand happens to
 * weight highest. That is the right pick for a line reading "your strongest overlap
 * is…": the creator is the one deciding whether to write the email.
 */
export function strongestSharedTaste(
  intersection: TasteIntersection | undefined,
): SharedTasteDimension | undefined {
  return intersection?.shared[0];
}

/**
 * Direct overlap, or a bridge across adjacent ground — said out loud.
 *
 * §10 makes the distinction load-bearing and §15 forbids flattening it: an adjacent
 * connection is the interesting discovery, and presenting it as a straightforward
 * match would be the overstatement this product exists to avoid. `undefined` when
 * there is no overlap to characterise, so the caller omits the clause rather than
 * printing "unknown".
 */
export function intersectionKindPhrase(
  intersection: TasteIntersection | undefined,
): string | undefined {
  if (intersection === undefined || intersection.kind === "none") return undefined;
  return intersection.kind === "direct"
    ? "ground reached from interests you confirmed yourself"
    : "ground reached through an adjacent connection, not something you declared outright";
}

// ---------------------------------------------------------------------------
// Why explore this brand (doc 05 §12: a hypothesis, never a verdict)
// ---------------------------------------------------------------------------

export interface BrandWhyCopy {
  /**
   * The reason to look at this brand, phrased as something to test. Always
   * present, including when nothing could be scored — a brand the data source
   * returned for your interests is worth a look even without a defensible number.
   */
  hypothesis: string;
  /** The evidence chain in plain words. Empty when there is none to show. */
  because: string[];
  /**
   * What could not be established: the intersection's own evidence gaps first,
   * then the scored dimensions that were left out, each carrying its reason.
   */
  missing: string[];
  /** What the relevance does NOT mean. Always present. */
  caveat: string;
}

/**
 * Why a creator might explore this brand, and what the evidence will not support.
 *
 * The distinction this exists to hold: Qloo cultural relevance is a statement
 * about where a brand sits in a catalogue relative to the interests the creator
 * confirmed. It is not a statement about the brand's intentions. Doc 05 §12
 * forbids implying an opportunity is proven, and the failure mode is specific — a
 * creator reads a high fit score as "this brand wants to sponsor me", pitches on
 * that basis, and the retraction lands on them.
 *
 * Every `because` line names the thing it came from. A reason that could not be
 * traced to a shared dimension, a driver, a pathway segment, a scored dimension or
 * the creator's own coverage and audience-context answers is not emitted at all:
 * requirement one is that weak evidence produces no insight rather than a generic one.
 *
 * `audience` is the creator's self-reported answer to who they create for and what
 * people come to their content for. It is NOT measured follower data and it is not
 * evidence: it can add one sentence explaining why an overlap the evidence already
 * established might suit their work, and it cannot add an overlap. Absent, this
 * function returns exactly what it returned before the field existed.
 *
 * `content` is their Content DNA — the same kind of statement, about the maker rather
 * than the audience: the angle they ticked, the categories they said they cover, the
 * platforms they publish on. Through `contentDnaFor` it obeys the identical gate, and
 * it does one more thing than the audience sentence: it supplies the FORM in the
 * hypothesis, so two creators whose taste overlaps the same brand get two different
 * hypotheses rather than the same one with their names swapped. It cannot supply the
 * overlap. Absent, the copy is byte-identical to what this function produced before.
 */
export function describeBrandOpportunity(
  opportunity: Pick<
    BrandOpportunity,
    | "name"
    | "category"
    | "fit"
    | "pathway"
    | "isUntapped"
    | "drivers"
    | "discovered"
    | "intersection"
    | "metadata"
  >,
  voice: SourceVoice,
  audience?: AudienceWords,
  content?: ContentDna,
): BrandWhyCopy {
  const { name, fit } = opportunity;
  const category = brandCategoryLabel(opportunity.category);
  const drivers = (opportunity.drivers ?? [])
    .map((driver) => driver.name.trim())
    .filter((driver) => driver.length > 0)
    .slice(0, 3);

  const because: string[] = [];

  // THE INTERSECTION LEADS. §1 makes the shared taste the reason a brand is
  // recommended at all, so it is the first thing a creator reads about it — ahead
  // of the discovery trail, which explains how the brand was FOUND and is the
  // weaker of the two claims. §28 is explicit that a catalogue returning a brand is
  // not a CreatorsDNA recommendation.
  //
  // When nothing overlapped, nothing is said here. The brand still gets its drivers
  // line, its missing evidence and its caveat, and that is the honest whole of it:
  // inventing a connection to fill the slot is the failure §7 describes.
  const shared = sharedTasteLabels(opportunity.intersection);
  const strongest = strongestSharedTaste(opportunity.intersection);
  const overlapKind = intersectionKindPhrase(opportunity.intersection);
  const strengthLabel = opportunity.intersection?.strengthLabel;

  if (shared.length > 0) {
    because.push(
      `Your cultural profile and ${name} both show connections around ${list(shared)}${
        overlapKind === undefined ? "" : ` — ${overlapKind}`
      }.${strengthLabel === undefined ? "" : ` ${strengthLabel}.`}`,
    );
  }

  if (strongest !== undefined) {
    because.push(
      `Your strongest single overlap is ${strongest.label.toLowerCase()}. ${
        strongest.creatorEvidence
      } ${strongest.brandEvidence}`,
    );
  }

  // AFTER the two evidence lines, because it is the second of the two claims this
  // copy has to keep apart: what the creator and the brand demonstrably share, and
  // then why that might matter to the work the creator says they make. Placing it
  // first would read as the reason for the recommendation.
  const stated = audienceContextFor(audience, shared);
  if (stated !== undefined) {
    const clauses: string[] = [];
    if (stated.groups.length > 0) clauses.push(`you create for ${list(stated.groups)}`);
    if (stated.purposes.length > 0) {
      clauses.push(`people come to your work for ${list(stated.purposes)}`);
    }
    because.push(
      `You say ${clauses.join(", and that ")}. That is your own statement of intent, not a ` +
        `measurement of who watches — a reason this overlap might suit the content you make, ` +
        `not evidence for it.`,
    );
  }

  // THIRD, after both evidence lines and after the audience sentence, because it
  // answers a question the audience sentence raises: "the content you make" — what is
  // it? Through the same gate, so a brand with no established overlap gets no line
  // here either. §5's last requirement is the reason that matters: where nothing
  // overlapped, this sentence would be the only thing connecting the creator's work
  // to the brand, and reading it would be reading a cultural match that was never
  // found.
  const statedContent = contentDnaFor(content, shared);
  if (statedContent?.positioning !== undefined) {
    because.push(
      `How you make things — ${statedContent.positioning} — is the form that overlap would ` +
        `take. That is your own account of your method, not part of the comparison above, and ` +
        `not a reason of its own: nothing matched your content to ${name}.`,
    );
  }

  if (drivers.length > 0) {
    because.push(
      `${voice.providerNoun} returned ${name} against interests you confirmed yourself — ${list(
        drivers,
      )}. ${
        shared.length > 0
          ? "That chain is how the brand was found; the overlap above is why it is worth a look."
          : "That chain is the reason this brand is in your results at all."
      }`,
    );
  }

  const bridges = pathwayBridges(opportunity.pathway, [name, ...drivers]);
  if (bridges.length > 0) {
    because.push(
      shared.length > 0
        ? `The trail ${voice.providerNoun} followed to reach them runs through ${list(
            bridges,
          )}, which is how the overlap above was found.`
        : `The path between you runs through ${list(
            bridges,
          )} — cultural ground your confirmed taste and this brand both sit on.`,
    );
  }

  const tasteFit = fit.components.find((component) => component.dimension === "taste_fit");
  if (tasteFit?.available && tasteFit.value !== undefined) {
    because.push(
      `${capitalise(strengthWord(tasteFit.value))} cultural overlap with your profile, measured against the other brands returned in the same run.`,
    );
  }

  if (opportunity.isUntapped) {
    because.push(
      category
        ? `It sits in ${category}, which you told us you do not cover heavily — so there is room to make something new here rather than repeat what you have already made.`
        : `It sits in a category you told us you do not cover heavily, so there is room to make something new here rather than repeat what you have already made.`,
    );
  }

  const description = opportunity.metadata?.description?.trim();
  if (description !== undefined && description.length > 0) {
    because.push(`What ${voice.providerNoun} holds on them: ${description}`);
  }

  const hypothesis = fit.overall.renderable
    ? shared.length > 0
      ? `A hypothesis to test, not a deal: your taste and ${name}'s overlap around ${list(
          shared,
        )}, ${
          statedContent?.approach === undefined
            ? "which may make them worth exploring for a collaboration that feels native to the content you already make"
            : // §4: this is where Content DNA differentiates two creators who overlap the
              // same brand. The overlap clause is identical for both — it comes from the
              // comparison — and only the form differs, so neither gets a stronger claim
              // than the other and neither gets a match the evidence did not find.
              `and ${statedContent.approach} is the kind of piece you already make — so a collaboration there is one you could start without inventing a format for it`
        }. Nothing here says ${name} runs a creator programme, is looking for partners, or would respond.`
      : `A hypothesis to test, not a deal: ${name} sits close to the work you confirmed, so an approach built on that closeness is more specific than a cold pitch. Nothing here says ${name} runs a creator programme, is looking for partners, or would respond.`
    : `No fit score is shown for ${name}, because none of the dimensions could be computed from what came back. It is still listed: ${voice.providerNoun} returned it for your confirmed interests, and that alone is a reason to look, but there is no number to argue from.`;

  const caveat =
    `Cultural relevance is not commercial intent. A strong figure means ${name} sits near your taste ` +
    `in the catalogue this data came from — it does not mean they sponsor creators, that a campaign ` +
    `exists, or that an introduction would land.`;

  // The reason an unavailable dimension was left out is the actionable half: it
  // tells the creator which of their own answers would change the picture. A
  // basis that says nothing beyond "not computed" adds no information, so it is
  // dropped rather than printed as filler.
  //
  // The intersection's own gaps come first, and when they exist the
  // `content_compatibility` entry is dropped: both read the same overlap primitive,
  // so keeping the pair would state one fact twice — once as a terse dimension
  // basis, once with the detail that makes it checkable. §14 asks for the missing
  // evidence, not for it printed twice.
  const intersectionMissing = opportunity.intersection?.missing ?? [];
  const missing = fit.components
    .filter(
      (component) =>
        !component.available &&
        !(intersectionMissing.length > 0 && component.dimension === "content_compatibility"),
    )
    .map((component) => ({
      label: component.label,
      reason: component.basis.trim(),
    }))
    .filter((entry) => entry.reason.length > 0 && entry.reason !== "Not computed for this analysis.")
    .map((entry) => `${entry.label} — ${entry.reason}`);

  return { hypothesis, because, missing: [...intersectionMissing, ...missing], caveat };
}

// ---------------------------------------------------------------------------
// The same claim, re-voiced for a document a brand reads
// ---------------------------------------------------------------------------

export interface KitBrandNote {
  /** The alignment, in third person. Empty string means there is nothing to say. */
  line: string;
  /** The evidence chain, each entry traceable to something on the page. */
  because: string[];
  /**
   * What could not be judged: the intersection's own evidence gaps first, then the
   * scored dimensions that were left out, each carrying its reason.
   */
  missing: string[];
  /** What the alignment does NOT mean. Always present. */
  caveat: string;
}

/**
 * Brand alignment as it appears in the media kit.
 *
 * This is not `describeBrandOpportunity` with the pronouns swapped, and the
 * difference is not stylistic. That function addresses the creator as "you"
 * because it is on a screen only they see. A media kit is attached to an email
 * and forwarded; the reader is a brand, and "interests you confirmed yourself"
 * in a document they are holding accuses them of something they did not do.
 *
 * So the kit gets its own third-person builder over the SAME evidence fields. The
 * evidence is shared by taking it from the same view-model, which is what stops
 * the two versions drifting apart about what was actually found — the thing that
 * matters — while letting the grammar differ, which is the thing that does not.
 *
 * `creatorName` is used in place of "you". It is the display name the creator
 * typed, so the document names them the way they named themselves.
 *
 * `audience` is their self-reported audience context, third-person here for the same
 * reason everything else is: "you say you create for gamers" in a document a brand
 * is holding addresses the wrong person. It is attributed to the creator and called
 * a statement of intent, never a measurement — a brand that reads it as follower data
 * will repeat it back as fact, and the retraction lands on the creator.
 *
 * `content` is their Content DNA, re-voiced for the same reason and carrying the same
 * attribution: it says how the creator describes their own method, and it says that
 * this description was not part of the comparison. A kit that printed "documentary
 * storytelling on YouTube" next to an overlap would invite the reader to treat the
 * format as a finding.
 */
export function describeBrandFitForKit(
  opportunity: Pick<
    BrandOpportunity,
    | "name"
    | "category"
    | "fit"
    | "pathway"
    | "isUntapped"
    | "drivers"
    | "intersection"
    | "metadata"
  >,
  creatorName: string,
  voice: SourceVoice,
  audience?: AudienceWords,
  content?: ContentDna,
): KitBrandNote {
  const { name, fit } = opportunity;
  const category = brandCategoryLabel(opportunity.category);
  const drivers = (opportunity.drivers ?? [])
    .map((driver) => driver.name.trim())
    .filter((driver) => driver.length > 0)
    .slice(0, 3);
  const who = creatorName.trim().length > 0 ? creatorName.trim() : "The creator";

  const because: string[] = [];

  // The shared taste leads here too, and for the same reason: §25 wants the kit to
  // say WHY a connection exists, and the overlap is the only part of this that was
  // actually compared rather than merely returned by a query. The creator side is
  // re-voiced rather than quoted — `creatorEvidence` addresses "you", and the reader
  // of this document is the brand. `brandEvidence` is used verbatim because it is
  // already written about the brand in the third person.
  const shared = sharedTasteLabels(opportunity.intersection);
  const strongest = strongestSharedTaste(opportunity.intersection);
  const strengthLabel = opportunity.intersection?.strengthLabel;

  if (shared.length > 0) {
    because.push(
      `${who}'s cultural profile and ${name} both carry connections around ${list(shared)}.${
        strengthLabel === undefined ? "" : ` ${strengthLabel}.`
      }`,
    );
  }

  if (strongest !== undefined) {
    because.push(
      `The strongest single overlap is ${strongest.label.toLowerCase()} — ${
        strongest.kind === "direct"
          ? `ground reached from interests ${who} confirmed as their own`
          : "an adjacent connection in that profile, not one declared outright"
      }. ${strongest.brandEvidence}`,
    );
  }

  // Same gate, same position, same reason as in `describeBrandOpportunity`: the
  // overlap first because it is the claim that was tested, the creator's own intent
  // second because it is the claim that was merely made.
  const stated = audienceContextFor(audience, shared);
  if (stated !== undefined) {
    const clauses: string[] = [];
    if (stated.groups.length > 0) clauses.push(`they create for ${list(stated.groups)}`);
    if (stated.purposes.length > 0) {
      clauses.push(`people come to their work for ${list(stated.purposes)}`);
    }
    because.push(
      `${who} says ${clauses.join(", and that ")}. That is their own statement of intent, not ` +
        `measured follower data — a reason this overlap could suit the work they make, not ` +
        `evidence for it.`,
    );
  }

  // Same gate, same position as in `describeBrandOpportunity`, third person for the
  // reason the whole builder is. The closing clause is the one that matters in a
  // forwarded document: a brand reading an overlap next to a format will otherwise
  // assume the format was part of what matched.
  const statedContent = contentDnaFor(content, shared);
  if (statedContent?.positioning !== undefined) {
    because.push(
      `${who} describes their own work as ${statedContent.positioning} — the form that overlap ` +
        `would take. It is their own account of their method, not part of the comparison ` +
        `above, and not a reason of its own: nothing matched their content to ${name}.`,
    );
  }

  if (drivers.length > 0) {
    because.push(
      `${who} confirmed ${list(drivers)} as their own interests. ${voice.providerNoun} returned ${name} against them.`,
    );
  }

  const bridges = pathwayBridges(opportunity.pathway, [name, ...drivers]);
  if (bridges.length > 0) {
    because.push(
      shared.length > 0
        ? `The trail ${voice.providerNoun} followed runs through ${list(bridges)}.`
        : `The path between the two runs through ${list(bridges)} — cultural ground both sit on.`,
    );
  }

  const tasteFit = fit.components.find((component) => component.dimension === "taste_fit");
  if (tasteFit?.available && tasteFit.value !== undefined) {
    because.push(
      `${capitalise(strengthWord(tasteFit.value))} cultural overlap with that profile, measured against the other brands returned in the same run.`,
    );
  }

  if (opportunity.isUntapped) {
    because.push(
      category
        ? `${name} sits in ${category}, which ${who} has not covered heavily. A first piece here would be new ground rather than a repeat.`
        : `${name} sits in a category ${who} has not covered heavily. A first piece here would be new ground rather than a repeat.`,
    );
  }

  const description = opportunity.metadata?.description?.trim();
  if (description !== undefined && description.length > 0) {
    because.push(`Catalogue description: ${description}`);
  }

  const noFigure =
    "No fit figure is shown, because none of the scoring dimensions could be computed.";

  const line =
    shared.length > 0
      ? `${who}'s cultural profile and ${name} overlap around ${list(shared)}.${
          fit.overall.renderable ? "" : ` ${noFigure}`
        }`
      : fit.overall.renderable && drivers.length > 0
        ? `${name} surfaced against interests ${who} confirmed, and the connection is traceable.`
        : drivers.length > 0
          ? `${name} surfaced against interests ${who} confirmed. ${noFigure}`
          : `${name} was returned by ${voice.providerNoun} for this profile. No specific interest was named as the reason, so the connection below is the aggregate position and nothing narrower.`;

  const caveat =
    `Cultural relevance is not commercial intent. This describes where ${name} sits in the catalogue ` +
    `relative to a declared taste profile. It is not a statement that ${name} runs a creator ` +
    `programme, is looking for partners, or has an active campaign.`;

  // Same dedupe as `describeBrandOpportunity`, for the same reason: the
  // intersection and the `content_compatibility` dimension read one overlap
  // primitive, and a document a brand forwards should not state one gap twice.
  const intersectionMissing = opportunity.intersection?.missing ?? [];
  const missing = fit.components
    .filter(
      (component) =>
        !component.available &&
        !(intersectionMissing.length > 0 && component.dimension === "content_compatibility"),
    )
    .map((component) => ({ label: component.label, reason: component.basis.trim() }))
    .filter(
      (entry) => entry.reason.length > 0 && entry.reason !== "Not computed for this analysis.",
    )
    .map((entry) => `${entry.label} — ${entry.reason}`);

  return { line, because, missing: [...intersectionMissing, ...missing], caveat };
}

// ---------------------------------------------------------------------------
// A collaboration concept, labelled as a suggestion
// ---------------------------------------------------------------------------

export interface CollaborationConcept {
  /** Always says it is a suggestion. Never "a proposal to" or "an offer". */
  label: string;
  idea: string;
  /** Which of the creator's own values the idea was built from. */
  basis: string;
}

/**
 * One collaboration idea, derived from evidence that actually exists.
 *
 * There is no LLM here and no library of generic formats: the FAMILY of idea is
 * chosen by which evidence is present, and only the wording rotates on a hash of
 * the brand id. That ordering matters. Picking the idea by hash would produce
 * confident-sounding suggestions with nothing behind them, which is worse than
 * none — a creator pastes it into an email and cannot answer the brand's first
 * question about why that idea.
 *
 * The families are tried strongest-evidence-first: what the two profiles were
 * actually compared and found to share (§24), then what the creator declared and
 * the brand was returned against, then the creator's strongest taste as a last
 * resort. An overlap between two cultural profiles is the only one of the three
 * that is a statement about BOTH sides, which is why it leads.
 *
 * Returns `undefined` when there is nothing to build from. Omitting the section is
 * the correct output; "a social media campaign" is not a concept, it is a
 * placeholder wearing one.
 *
 * `contentDna` changes the FORM of the idea and nothing else about it. That is the
 * whole of the differentiation it is here for: two creators whose taste overlaps the
 * same brand get two different suggestions, because one makes practical walkthroughs
 * and the other makes story-led pieces. But the FAMILY of idea each gets is still
 * chosen by the evidence, the evidence cited in `basis` is still the evidence, and a
 * creator who stated no angle gets the byte-identical suggestion this function
 * produced before. There is no table pairing an angle with a brand or a category — the
 * form is read from the creator alone, so it can neither manufacture a match nor
 * flatter one, and it fires the same way whichever brand is being described.
 */
export function proposeCollaboration(input: {
  brandId: string;
  brandName: string;
  category?: string;
  isUntapped: boolean;
  drivers?: ReadonlyArray<{ name: string; score: number }>;
  coreTastes?: ReadonlyArray<{ tag: { name: string } }>;
  /** Platform labels, e.g. "YouTube". Used only to name the format. */
  platforms?: readonly string[];
  /** The shared taste between the two profiles. Leads the idea when present. */
  intersection?: TasteIntersection;
  /** How the creator says they make things. Shapes the form of the idea only. */
  contentDna?: ContentDna;
}): CollaborationConcept | undefined {
  const seed = input.brandId.length > 0 ? input.brandId : input.brandName;
  const category = brandCategoryLabel(input.category);
  const driver = (input.drivers ?? [])
    .map((entry) => entry.name.trim())
    .find((name) => name.length > 0);
  const taste = (input.coreTastes ?? [])
    .map((entry) => entry.tag.name.trim())
    .find((name) => name.length > 0);
  const surface = input.platforms?.[0];
  const where = surface ? `on ${surface}` : "in your own format";

  // The one place Content DNA touches a collaboration idea. `approach` is a phrase
  // about the CREATOR — "a practical walkthrough" — resolved from their own ticked
  // angle, so it cannot vary by brand and cannot read the overlap. Both wrappers are
  // no-ops when it is absent, which is what keeps every suggestion below identical to
  // the one this function produced before the field existed.
  const form = input.contentDna?.approach;
  const shape =
    form === undefined
      ? ""
      : ` It would take the form of ${form}, which is the shape the work already takes rather than one invented for this.`;
  const shaped = (idea: string): string => `${idea}${shape}`;
  const grounded = (basis: string): string =>
    form === undefined
      ? basis
      : `${basis} The form of the piece is how I say I make things — not something the comparison found, and not a claim about what ${input.brandName} wants.`;

  const shared = sharedTasteLabels(input.intersection);
  if (shared.length > 0) {
    const lead = shared[0]!;
    return {
      label: "Suggested angle — not agreed with the brand",
      idea: shaped(
        pickVariant(
          [
            `A ${where} piece built on the ground we both sit on — ${list(
              shared,
            )} — with ${input.brandName} inside that world rather than wrapped around it.`,
            `${lead} as the spine of a ${where} piece, and ${
              input.brandName
            } brought in where it genuinely belongs in that story rather than interrupting it.`,
          ],
          seed,
        ),
      ),
      basis: grounded(
        `${list(shared)} ${
          shared.length === 1 ? "appears" : "appear"
        } in both my taste profile and what the catalogue holds on ${input.brandName}${
          input.isUntapped
            ? ", and it is ground I said I do not cover heavily yet, so a first piece here would be new rather than a repeat"
            : ""
        }. The idea comes from that comparison, not from an assumption about what your brand wants.`,
      ),
    };
  }

  if (driver !== undefined && input.isUntapped) {
    return {
      label: "Suggested angle — not agreed with the brand",
      idea: shaped(
        pickVariant(
          [
            `A first piece in ${category ?? "this space"}, opening with ${driver} and treating ${
              input.brandName
            } as part of that world rather than as a sponsor read.`,
            `${driver} as the entry point: a ${where} piece that puts ${
              input.brandName
            } into a subject you have affinity for but have not covered yet.`,
          ],
          seed,
        ),
      ),
      basis: grounded(
        `${driver} is an interest you confirmed, and you told us you do not cover ${
          category ?? "this category"
        } heavily. Both halves come from your own inputs.`,
      ),
    };
  }

  if (driver !== undefined) {
    return {
      label: "Suggested angle — not agreed with the brand",
      idea: shaped(
        pickVariant(
          [
            `A ${where} piece built around ${driver}, with ${
              input.brandName
            } present as part of the subject rather than interrupting it.`,
            `${driver} as the spine of the piece, and ${
              input.brandName
            } brought in where it genuinely belongs in that story.`,
          ],
          seed,
        ),
      ),
      basis: grounded(
        `${driver} is one of the interests you confirmed, and it is what ${
          input.brandName
        } was returned against.`,
      ),
    };
  }

  if (taste !== undefined) {
    return {
      label: "Suggested angle — not agreed with the brand",
      idea: shaped(
        pickVariant(
          [
            `A ${where} piece that puts ${taste} next to what ${
              input.brandName
            } makes, and lets the connection be the story.`,
            `${taste} as the framing, with ${input.brandName} appearing in it rather than around it.`,
          ],
          seed,
        ),
      ),
      basis: grounded(
        `${taste} is the strongest tag in your taste profile. No specific interest drove this brand, so the idea stays at that level rather than inventing a narrower hook.`,
      ),
    };
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// How an affinity surfaced (doc 02 §17: declared vs discovered)
// ---------------------------------------------------------------------------

export type AffinityKind = "direct" | "cross_category" | "traced" | "inferred";

export interface AffinityClassification {
  kind: AffinityKind;
  /** Chip text. Short enough to sit beside a bar label. */
  chip: string;
  /**
   * The same distinction in one or two words, for the place there is no room for
   * `chip` — a column at the right edge of a bar chart, where "Cross-category
   * discovery" would run into the next row. Same meaning, no abbreviation that
   * changes it.
   */
  short: string;
  /** One sentence naming the evidence, or naming its absence. */
  why: string;
}

/**
 * Direct match, cross-category discovery, traced discovery, or our inference.
 *
 * Four rather than the three the brief names, because "discovered" covers two
 * situations a creator reads very differently: something reached from their own
 * interests inside a category they already work in, and something reached into a
 * category none of their interests sit in. The second is the interesting one and
 * collapsing them would hide it.
 *
 * The classification is derived, not asserted:
 *
 *   - `role === "taste"` is set by the ranking builder when the entity id is one
 *     of the confirmed signals, so DIRECT means literally "you confirmed this".
 *   - `support` is Qloo's own explainability — the signal entities it named as
 *     contributing. Non-empty means the trail exists and can be printed.
 *   - cross-category is the item's category compared against the categories the
 *     confirmed entities actually sit in, taken from `dna.categories`.
 *
 * The fallback is `inferred`, and its wording says so. An item with no
 * explainability rests on an aggregate score alone, and calling that a discovery
 * would be the exact overstatement this function exists to prevent.
 */
export function classifyAffinity(
  item: Pick<AffinityRankItem, "label" | "category" | "role" | "support">,
  dna: Pick<TasteDna, "declared" | "categories">,
  voice: SourceVoice,
): AffinityClassification {
  if (item.role === "taste") {
    return {
      kind: "direct",
      chip: "You confirmed this",
      short: "confirmed",
      why: `${item.label} is one of the entities you picked in the review step. It is shown with the affinity ${voice.providerNoun} returned for it, not with a score we computed.`,
    };
  }

  const traced = item.support
    .map((entry) => entry.entityName.trim())
    .filter((name) => name.length > 0)
    .slice(0, 3);

  if (traced.length > 0) {
    const crossCategory =
      item.category !== undefined && !declaredCategoryIds(dna).has(item.category);
    return {
      kind: crossCategory ? "cross_category" : "traced",
      chip: crossCategory ? "Cross-category discovery" : "Reached from your interests",
      short: crossCategory ? "cross-category" : "traced",
      why: crossCategory
        ? `${voice.providerNoun} named ${list(traced)} as the reason ${item.label} came back, and it sits in a category none of your confirmed entities do. This is the discovery worth a second look.`
        : `${voice.providerNoun} named ${list(traced)} as the reason ${item.label} came back, inside ground your confirmed interests already sit in.`,
    };
  }

  return {
    kind: "inferred",
    chip: "Our reading, not traced",
    short: "our read",
    why: `${item.label} came back in the result set, but no explainability arrived naming which of your interests produced it. Its position rests on the aggregate score alone, so treat it as an indication rather than a traced connection.`,
  };
}

/**
 * The category ids the creator's confirmed entities actually sit in.
 *
 * Derived from `dna.categories`, which groups the returned pool by category and
 * carries each group's entity ids — so intersecting those ids with `declared`
 * gives the confirmed set's categories without a second source of truth. An id
 * Qloo spells as a full URN and one it spells as a bare tail would not match by
 * string equality, but both are compared as they came back on the SAME item, so
 * the comparison is internally consistent.
 */
function declaredCategoryIds(dna: Pick<TasteDna, "declared" | "categories">): Set<string> {
  const declared = new Set(dna.declared.map((entry) => entry.id));
  const ids = new Set<string>();
  for (const category of dna.categories) {
    if (category.entities.some((entity) => declared.has(entity.id))) ids.add(category.id);
  }
  return ids;
}

/** Lowercase-first sentence repair, so a strength word can open a line. */
function capitalise(value: string): string {
  return value.length === 0 ? value : `${value[0]!.toUpperCase()}${value.slice(1)}`;
}

// ---------------------------------------------------------------------------
// Opportunity gap
// ---------------------------------------------------------------------------

export function describeOpportunityPoint(point: OpportunityPoint): string {
  const coverage =
    point.coverage <= 0.05
      ? "you have not declared any coverage"
      : point.coverage >= 0.95
        ? "you have declared this as fully covered"
        : `you have declared roughly ${Math.round(point.coverage * 100)}% coverage of your own output`;
  return `${point.label}: ${strengthWord(point.affinity)} cultural affinity, and ${coverage}. Gap score ${point.gapScore.toFixed(
    2,
  )} on a 0–1 scale. Coverage is self-reported by you, not measured from your content.`;
}

export function describeOpportunities(
  points: readonly OpportunityPoint[],
  omittedCount: number,
): string {
  if (points.length === 0) {
    return omittedCount > 0
      ? `No opportunity gap could be computed. ${omittedCount} ${
          omittedCount === 1 ? "category was" : "categories were"
        } left out because you have not declared whether you cover them.`
      : "No opportunity gap could be computed from the available data.";
  }
  const top = points[0]!;
  // The observation stops at the observation. How the gap is defined is printed
  // once, on the viz frame's Method line; how coverage was established is
  // printed once, in that frame's "Coverage basis" footnote. A third parameter
  // used to append the latter here too, which put the same sentences on screen
  // four times in one section.
  return `The widest gap is ${top.label} — ${strengthWord(
    top.affinity,
  )} affinity against declared coverage of ${Math.round(top.coverage * 100)}%.`;
}

// ---------------------------------------------------------------------------
// Degraded / unavailable states (doc 02 §24, doc 04 §4.5)
// ---------------------------------------------------------------------------

export function describeComponent(component: ScoreComponent): string {
  if (component.available && component.value !== undefined) {
    return `${component.label}: ${strengthWord(component.value)} (${Math.round(
      component.value * 100,
    )} of 100), carrying ${Math.round(component.effectiveWeight * 100)}% of the final score. ${
      component.basis
    }`;
  }
  return `${component.label}: not available. ${
    component.basis === "Not computed for this analysis."
      ? "This dimension was not computed for this analysis."
      : component.basis
  } It was excluded from the score rather than given a default value.`;
}

export function describeFallback(
  level: TasteDna["level"],
  levelDescription: string,
  degradations: readonly string[],
): string {
  if (level === "L4") {
    return "This profile cannot be shown. The signals you provided do not appear to have influenced the results, so anything rendered here would be generic output presented as personalised. That is a hard failure, not a partial one.";
  }
  if (degradations.length === 0) {
    return `Fallback level ${level}. ${levelDescription}`;
  }
  return `Fallback level ${level}. ${levelDescription} What was missing: ${list(degradations, "and")}`;
}

/** The persistent banner required whenever illustrative data is on screen. */
export function illustrativeBanner(voice: SourceVoice): string | undefined {
  return voice.illustrativeNotice;
}

/**
 * Empty-state copy.
 *
 * Each variant names the CAUSE and the NEXT ACTION. A bare "No results" tells the
 * creator nothing they can act on, and doc 02 §24 requires these states to exist
 * before real data can fail in public.
 */
export function emptyStateCopy(
  cause: "no_signals" | "no_results" | "unresolved_interests" | "provider_error" | "no_brands",
  detail?: string,
): { title: string; body: string; action: string } {
  switch (cause) {
    case "no_signals":
      return {
        title: "No interests selected yet",
        body: "Your Taste DNA is derived from the interests you choose. Nothing has been selected, so there is nothing to derive from.",
        action: "Select your interests",
      };
    case "no_results":
      return {
        title: "No results for these interests",
        body: `The data source returned nothing for the signals provided.${detail ? ` ${detail}` : ""} Try a broader or differently spelled interest — very specific inputs often match nothing.`,
        action: "Adjust your interests",
      };
    case "unresolved_interests":
      return {
        title: "Some interests could not be resolved",
        body: `One or more of your interests matched several entries or none at all.${detail ? ` ${detail}` : ""} Nothing was guessed: pick the match you meant and the rest of your profile will build normally.`,
        action: "Resolve your interests",
      };
    case "provider_error":
      return {
        title: "The data source could not be reached",
        body: `${detail ?? "The request failed."} Your inputs are safe — this is a data-source problem, not a problem with your profile.`,
        action: "Try again",
      };
    case "no_brands":
      return {
        title: "No brands where your taste overlaps",
        body: "Brand candidates come from a live catalogue query built on your Creator Taste DNA — your confirmed interests expanded through the catalogue's own relationships — not from a stored list. Either that query returned nothing for this profile, or nothing it returned could be compared against your taste with the data available.",
        action: "Review your confirmed interests",
      };
  }
}

// ---------------------------------------------------------------------------
// What a diagnostic observation means for the creator (§11)
// ---------------------------------------------------------------------------

/**
 * The practical consequence of each observation code, in plain language.
 *
 * The codes and their `detail` strings stay exactly as they are. They name the
 * documented assumption that failed, the wire index a payload diverged at, the
 * endpoint parameter a call required, the namespace policy that withheld a tag —
 * and that is the right vocabulary for whoever has to fix it, printed underneath
 * this sentence in a collapsed block. It is the wrong vocabulary for a creator
 * deciding whether to write to a brand, so this is what they read first.
 *
 * Keyed by the closed `ObservationCode` union with no fallback branch and no
 * index signature, deliberately: a new code is a compile error here until somebody
 * has written what it means for the person reading the result. A `?? code` default
 * would let a new diagnostic reach the creator-facing UI as a bare snake_case key —
 * which is the exact failure this map exists to prevent — and it would fail
 * silently, in production, on the first run that hit it. `explainObservation`
 * further down does carry a fallback, and the reason it can is that by then the
 * code has already been widened to `string` at the serialization boundary; this map
 * keeps its exhaustiveness and the fallback only catches what no closed union could.
 *
 * Each entry states a CONSEQUENCE rather than restating the code, and three
 * distinctions are carried through all of them because §11 names them explicitly.
 * A provider that failed is not a catalogue that had nothing. Evidence that was
 * insufficient is not overlap that was absent. And a position in a returned list is
 * not a measurement of cultural compatibility.
 */
export const OBSERVATION_CONSEQUENCE: Record<ObservationCode, string> = {
  affinity_absent:
    "The catalogue returned these results with no relevance figures attached, so nothing here is ordered by strength. The list is in the order it arrived, and that order carries no meaning.",
  affinity_scale_percent:
    "The relevance figures came back on the scale the catalogue documents, so they are being read the way the source intended. No conclusion in your result rests on a guess about units.",
  affinity_scale_unit:
    "The relevance figures all sat between 0 and 1, and the catalogue does not say whether that is a proportion or a percentage whose scores happen to be very low. They are shown as uninterpreted numbers rather than as percentages, and nothing in your result depends on reading them as either.",
  affinity_scale_mixed:
    "One result set came back mixing two different scales, so its figures contradict each other and none of them is used. That is a problem with what the catalogue sent, not with the results you can still see.",
  explainability_warning:
    "The catalogue could only partly explain why it returned some of these results, so the reasons given for those brands rest on our own cultural comparison rather than on an explanation from the source.",
  explainability_absent:
    "The catalogue gave no reason for its results at all. Every reason shown beside a brand was built from the cultural comparison; none of them is an explanation the source provided.",
  tag_results_unscored:
    "The catalogue's tag list arrived without the figures needed to rank it, so your taste profile was built from the tags carried by the results themselves instead. It is still traceable to real catalogue entries — it was assembled by a different route than the obvious one.",
  signals_appear_ignored:
    "The catalogue returned results that do not reflect the interests you confirmed, which means the request was not honoured. Nothing below can be trusted as an answer about your taste, so this run is marked unusable rather than quietly presented as a result.",
  scores_clustered:
    "The top results were close enough together that the catalogue treats them as one group of strong matches. Their order on your screen is not a ranking, and the gap between them is not meaningful.",
  backfill_unflagged:
    "The catalogue does not mark which of its results came from outside the topic you asked about, so the unexpected affinities are worked out by set difference rather than read from a flag. They are genuinely things you did not confirm; what cannot be said is whether the source considered them off-topic.",
  type_substituted:
    "A category name had to be adjusted to the spelling the catalogue uses, so the results shown for it are results for the adjusted term. Both names are given rather than the substitution being hidden.",
  empty_result_set:
    "A catalogue call came back with nothing usable. Whether the catalogue had no answer, or had one we could not read, is stated in the detail below — and the two are deliberately not presented alike, because one is a fact about the topic and the other is a gap in this run.",
  items_rejected:
    "Some entries in a catalogue response did not match the documented format and were left out, so the set behind part of your result is incomplete. What survived is still real catalogue data, but this run should not be read as having seen everything the source returned.",
  entity_type_excluded:
    "Some results were not the kind of thing the call asked for — a venue or a person where a brand was wanted, for instance — and were removed. What you see is filtered to the right kind of entity rather than being whatever arrived.",
  synthetic_data:
    "This run was generated locally from illustrative data, with no live catalogue call behind it. Every figure is a placeholder showing the shape of the product; none of it describes real brands or real cultural relationships.",
};

/**
 * The practical consequence of each PROVIDER failure, in plain language.
 *
 * These reach the same list as `OBSERVATION_CONSEQUENCE` does, via `attempt()`
 * turning a thrown `ProviderError` into a `PipelineFailure` that
 * `mergeObservations` flattens in beside the mapper's observations. They are a
 * separate map because they mean a different kind of thing: an observation is
 * something the adapter noticed about a response it was handed, while these record
 * that no usable response was ever handed over.
 *
 * §11 asks for exactly one distinction here and it is carried through all twelve
 * entries: **a provider that failed is not a catalogue that had nothing.** An
 * empty brand section reads the same on screen whether the source was unreachable
 * or the source was reached and had no answer, and those two facts have different
 * consequences — one may succeed on a retry, one will not. `not_found` is the only
 * entry that says the source looked and had nothing; every other entry says the
 * question went unanswered, and says so in words rather than leaving the reader to
 * infer it from an empty panel.
 *
 * `malformed_response` gets the longest treatment of the twelve because it is the
 * one the observed run actually produced, and the one easiest to misread. The
 * source did answer. What it sent could not be read against the documented format,
 * so it was not used and nothing was guessed at — reinterpreting a malformed
 * payload would put an invented fact into a result the creator is being asked to
 * act on.
 */
export const PROVIDER_ERROR_CONSEQUENCE: Record<ProviderErrorCode, string> = {
  not_configured:
    "No live catalogue call could be made, because this deployment has no data-source credentials. Nothing below was retrieved from the catalogue — and nothing was invented to fill the space either.",
  unauthorized:
    "The data source rejected the credentials this deployment uses, so it did not answer. That is a configuration problem on our side. It says nothing about your taste, and it is not the catalogue telling you there was nothing to find.",
  forbidden_type:
    "The data-source account is not permitted to query that kind of entity, so the call was refused rather than answered. What is missing here is missing because of an account permission, not because the catalogue has nothing on the subject.",
  invalid_request:
    "The data source refused the request itself as badly formed, so it never looked anything up. The fault is in how the query was built rather than in your interests, and no answer came back — empty or otherwise.",
  not_found:
    "The catalogue was reached, it looked, and it had no entry matching that search. This is the one case where an empty result is a fact about the subject rather than a gap in this run.",
  rate_limited:
    "The data source is temporarily turning requests away because too many have arrived, so this call was refused unanswered. Retrying later may succeed; meanwhile the part of your result that depended on it is missing rather than empty.",
  quota_exhausted:
    "This deployment has used its allowance of data-source calls, so the request was turned away unanswered. Nothing was retrieved for the part of your result that needed it, and nothing was substituted in its place.",
  timeout:
    "The data source did not answer in time, so this call was abandoned rather than completed. That is a failure to reach the source, not the source saying there was nothing to find — the two look identical in an empty section and are not the same thing.",
  network:
    "The data source could not be reached at all, so this call never arrived. What is missing below is missing because the request failed, not because the catalogue had no answer to give.",
  malformed_response:
    "The data source answered, but what it sent did not match the documented format, so the response could not be read and was not used. That is a failure to read an answer rather than the absence of one — the catalogue may well have had something to say. Guessing at what a malformed payload meant would put an invented fact into a result you are being asked to act on, so nothing was guessed. A run carrying this note should not be read as having seen everything the source returned.",
  unsupported:
    "The data source cannot perform that kind of query at all, so it was not asked. The corresponding part of your result is unavailable because of a capability limit, not empty because of a finding.",
  unknown:
    "A call failed for a reason this build does not classify, so it was recorded rather than explained away. The technical detail below is the only account of it. Treat the affected part of your result as missing, not as empty.",
};

/**
 * The practical consequence of each PIPELINE failure, in plain language.
 *
 * These are the facts only the pipeline knows, and they cluster around one theme:
 * a step that could not run, and the guarantee that nothing was put in its place.
 * §13 forbids a static or curated list standing in for a live discovery result, so
 * every entry that describes a missing step also says what was NOT substituted —
 * because the alternative reading, that the app quietly fell back to a plausible
 * list, is the one a creator would otherwise assume.
 *
 * The two canary entries carry a second distinction the brief asks for: an absent
 * check is not a passed one. `ignore_check_unavailable` and
 * `ignore_check_inconclusive` both mean the system could not establish whether the
 * source was honouring its signals, and saying so calmly is the whole point. A
 * creator who reads "no problems found" from a check that never ran has been told
 * something false by an omission.
 */
export const PIPELINE_FAILURE_CONSEQUENCE: Record<PipelineObservationCode, string> = {
  no_resolved_signals:
    "None of your selected interests could be matched to an entry in the catalogue, so there was nothing to personalise a search with and the data source was never called. The result is therefore about your interests as you typed them rather than about what the catalogue knows, and no substitute profile was built to fill the gap.",
  no_mappable_entity_type:
    "Your interests did match catalogue entries, but none of them is a kind of thing the catalogue can search for related items of, so no recommendations could be requested. Nothing was swapped for a nearby type: a recommendation built on the wrong kind of entity is a fabrication with a plausible shape.",
  brand_discovery_empty:
    "The catalogue was asked for brands related to your confirmed interests and returned none. That is an answer rather than a crash, and no static or curated list was substituted — so the brand section is empty instead of being filled with names that merely look plausible next to your taste.",
  brand_discovery_failed:
    "The call that finds brands did not return a usable result set, so no brands could be assessed. This is a failure to obtain an answer, not the catalogue saying there are none, and the two are kept apart because one may succeed on a retry and the other will not. No fallback list was substituted.",
  entity_scoring_unsupported:
    "The data source cannot score a specific list of entities, so your own confirmed interests could not be read back out of it to check their relative strength. What follows is built without that confirmation rather than pretending the confirmation happened.",
  declared_readback_empty:
    "The data source was asked to return your confirmed interests by their exact ids and returned none of them. Your interests are still what you selected; what could not be established is how the source ranks them, so no claim below rests on a strength figure for your own declared taste.",
  ignore_check_unavailable:
    "Only one of your interests resolved, so there was no smaller set of interests to compare it against and the check for whether the source is quietly ignoring your signals could not run. This is an absent check, not a passed one — nothing was found to be wrong, and nothing was verified either.",
  ignore_check_inconclusive:
    "The two recommendation sets shared too few entries to compare their ordering, so the check for whether the source is quietly ignoring your signals could not be settled. That is not a clean result. It is one that could not be decided either way on the data available.",
};

/**
 * All three families merged, keyed on plain `string`.
 *
 * The widening is forced and it is the reason `explainObservation` exists rather
 * than the caller indexing a map directly. `mergeObservations` flattens mapper
 * observations, provider errors and pipeline facts into one list, so
 * `CreatorAnalysis["observations"]` types its `code` as `string` — it crosses the
 * NDJSON boundary and a cached or replayed run may carry a code this build no
 * longer knows. Indexing a `Record<ClosedUnion, string>` with a cast would
 * typecheck and return `undefined` at runtime: `noUncheckedIndexedAccess` adds
 * `| undefined` for index signatures and arrays, not for a `Record` keyed on a
 * finite union. Spreading into a `Record<string, string>` makes the lookup
 * genuinely `string | undefined`, which is what makes the fallback below sound
 * rather than merely defensive.
 *
 * The three maps stay separate and separately exported so each remains exhaustive
 * against its own closed union. Merging them here costs that nothing.
 */
const CONSEQUENCE_BY_CODE: Readonly<Record<string, string>> = {
  ...OBSERVATION_CONSEQUENCE,
  ...PROVIDER_ERROR_CONSEQUENCE,
  ...PIPELINE_FAILURE_CONSEQUENCE,
};

/**
 * What an observation means for the person reading the result (§11).
 *
 * Takes the widened `code` string rather than a union member, for the reason given
 * on `CONSEQUENCE_BY_CODE`. The fallback is a sentence, never the bare code: the
 * whole point of this function is that a snake_case key is not an explanation, so
 * returning one on the path where the key is least familiar would defeat it. The
 * code is still rendered, in the nested technical disclosure underneath — an
 * unexplained diagnostic is more useful to whoever has to fix it than a
 * confidently wrong paraphrase would be.
 *
 * Calm, as §11 asks. Nothing here says "error" or "failed" about the creator's own
 * input, because in every one of these cases the input was fine and the data behind
 * the answer was not.
 */
export function explainObservation(code: string): string {
  return (
    CONSEQUENCE_BY_CODE[code] ??
    "A note was recorded about the data behind this result under a diagnostic this build has no plain-language explanation for. The technical detail below is the only account of it, and the part of your result it refers to should be read as missing rather than as empty."
  );
}

// ---------------------------------------------------------------------------
// Pitch draft (doc 02 §28 step 11)
// ---------------------------------------------------------------------------

/**
 * What a pitch draft reads. Deliberately a narrow struct rather than the whole
 * `CreatorAnalysis`: the pitch is about ONE brand, and taking the aggregate would
 * make it easy to leak another brand's numbers into this one's email.
 *
 * The brand-specific fields (`brandId`, `brandCategory`, `drivers`, `pathway`,
 * `intersection`) are what stop every draft reading the same. They are all optional
 * so a caller with only a fit view-model still gets an honest draft — it just leans
 * harder on the fit breakdown for its specificity.
 */
export interface PitchInput {
  creatorName: string;
  handle?: string;
  /** The creator's own words. Quoted as theirs, never restated as a fact. */
  niche?: string;
  dna: Pick<TasteDna, "coreTastes" | "categories" | "unexpectedAffinities">;
  /** Stable id, used ONLY to seed the deterministic variant choice. */
  brandId: string;
  brandName: string;
  /** Descriptive category id (snake_case), when the analysis carried one. */
  brandCategory?: string;
  /** Declared interests the data source named as driving this recommendation. */
  drivers?: ReadonlyArray<{ name: string; score: number }>;
  /** The interest → affinity → brand path: how this brand was found. */
  pathway?: BrandPathway;
  /**
   * The cultural intersection with this brand — the shared taste itself.
   *
   * §24 makes this a core input: the draft opens on "our content and your brand
   * share a cultural connection around X, Y and Z", which is a statement about two
   * profiles that were actually compared rather than about the route a query took.
   * Optional so an older caller still gets an honest draft, which then falls back
   * to `pathway` instead of inventing an overlap.
   */
  intersection?: TasteIntersection;
  /** Untapped: high affinity against coverage the creator said they do not have. */
  isUntapped?: boolean;
  /** Platform labels, e.g. "YouTube". Names the format in the suggested angle. */
  platforms?: readonly string[];
  /**
   * Audience facts the CREATOR typed. Never derived.
   *
   * The analysis holds no audience measurement of any kind, so the only honest
   * source for this is the creator's own form. When it is absent the draft carries
   * a bracketed placeholder saying so — which is deliberate: a pitch that silently
   * omits audience leaves the brand assuming there is nothing, and a pitch that
   * fills the gap itself would be inventing the one number most likely to be acted
   * on and later retracted.
   */
  audience?: readonly string[];
  /**
   * The same creator-reported answers, resolved to words and kept as two lists.
   *
   * Not a duplicate of `audience` above, and the difference is why both exist:
   * `audience` is a flat list of pre-rendered "Label: value" strings that become the
   * "what I can add" bullets, so it can only be PRINTED. This carries the two
   * answers separately, which is what lets the body argue from them — "I make my work
   * for X" — instead of unparsing a bullet. Both come from the same optional form and
   * neither is derived from anything. Absent, the draft is byte-identical to the one
   * this function produced before the field existed.
   */
  audienceContext?: AudienceWords;
  /**
   * The creator's Content DNA: the angle they ticked, the categories they cover, the
   * formats they publish in.
   *
   * Not a third copy of the audience answers, and the split is the same one the type
   * draws: `audienceContext` says who the work is FOR, this says how it is MADE. Both
   * are the creator's own words about their own work and neither is evidence.
   *
   * Two consumers, one gated and one not. The body sentence goes through
   * `contentDnaFor` and so needs an established overlap, for the reason that gate
   * gives. `proposeCollaboration` receives it ungated, because there it only names
   * the FORM of a suggestion whose subject matter already came from a confirmed
   * interest or a shared taste — it adds no connection between the creator and the
   * brand, so there is nothing for an overlap to authorise. Absent, the draft is
   * byte-identical to the one this function produced before the field existed.
   */
  contentDna?: ContentDna;
  /** Previous work the creator supplied, in their own words. */
  previousWork?: readonly string[];
  /** What the creator is offering to make. Absent → a placeholder. */
  deliverables?: readonly string[];
  /** Contact details. Absent → a placeholder. */
  contact?: string;
  fit: BrandFitViewModel;
  voice: SourceVoice;
}

/**
 * A tiny deterministic string hash (FNV-1a), used ONLY to choose between
 * pre-written variants so two brands do not open identically. It is not a random
 * seed and not cryptographic: the same id always yields the same index, which is
 * exactly the "identical input → identical output" rule every template here obeys.
 * Kept local rather than imported so this module stays free of runtime
 * dependencies (see the header) — a six-line hash is cheaper than breaking that.
 */
function variantIndex(seed: string, modulus: number): number {
  if (modulus <= 1) return 0;
  let hash = 2166136261; // FNV-1a offset basis
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619); // FNV-1a prime
  }
  return Math.abs(hash) % modulus;
}

function pickVariant<T>(variants: ReadonlyArray<T>, seed: string): T {
  return variants[variantIndex(seed, variants.length)]!;
}

/**
 * Subject, opening and closing variants, chosen by a hash of the brand id.
 *
 * Every variant is hand-written and honesty-checked like any other template: none
 * claims a measured audience, a percentage of people, a guarantee or a "best"
 * verdict (doc 01 §37, doc 05 §12, fact F13). The rotation exists so a creator
 * comparing two drafts sees two different emails, not one template with the brand
 * name swapped — which is the whole complaint this rework answers.
 */
const SUBJECT_VARIANTS: ReadonlyArray<(creator: string, brand: string) => string> = [
  (creator, brand) => `${creator} × ${brand} — a cultural fit worth a look`,
  (creator, brand) => `Why ${brand} surfaced in ${creator}'s taste data`,
  (creator, brand) => `A specific intro: ${creator} × ${brand}`,
  (creator, brand) => `${brand}, and the culture ${creator} actually makes`,
];

const OPENING_VARIANTS: ReadonlyArray<(brand: string) => string> = [
  (brand) =>
    `I'll be specific about why I'm writing: ${brand} came out of my own taste mapping, not a list I'm working down.`,
  (brand) =>
    `Rather than a generic intro — here's the concrete reason ${brand} is the brand I'm writing to.`,
  (brand) =>
    `I don't send many of these, so let me say plainly why ${brand}: the fit below is built from the interests I actually declared.`,
  (brand) =>
    `This isn't a blast. ${brand} surfaced from my own taste data, and every number below is specific to you.`,
];

const CLOSING_VARIANTS: ReadonlyArray<(brand: string) => string> = [
  (brand) =>
    `Happy to send the full ${brand} breakdown, or to talk through what a collaboration could look like.`,
  (brand) =>
    `If this resonates, I'd welcome a conversation about what ${brand} and I could make together — the full evidence is available.`,
  (brand) =>
    `Glad to share the complete breakdown for ${brand}, or simply talk it through. No pressure either way.`,
];

/**
 * Snake_case category id → a readable phrase, or `undefined` when there is
 * nothing honest to say (absent, empty, or the catch-all "other").
 *
 * Exported because a card that prints `food_beverage` under a brand name is a
 * data leak into the interface, not a label. `"other"` maps to `undefined` on
 * purpose: it is the fallback bucket for brands the classifier could not place,
 * and rendering "other" tells the creator the analysis worked when it did not.
 */
export function brandCategoryLabel(category: string | undefined): string | undefined {
  if (category === undefined) return undefined;
  const words = category.replace(/_/g, " ").trim();
  return words.length > 0 && words !== "other" ? words : undefined;
}

/**
 * A one-line, dimension-specific framing for the "Why this brand" section.
 *
 * Which dimension is strongest differs per brand, so this is what makes the
 * section read differently for a taste-led match than for a geography-led one. It
 * states no number — `describeBrandFit` supplies those immediately after — and it
 * never upgrades an indication into a promise (doc 05 §12).
 */
function strongestDimensionLead(fit: BrandFitViewModel): string | undefined {
  if (!fit.overall.renderable) return undefined;
  const used = fit.components.filter(
    (component) => component.available && component.value !== undefined,
  );
  if (used.length === 0) return undefined;
  const strongest = [...used].sort(
    (a, b) => (b.value ?? 0) - (a.value ?? 0) || b.effectiveWeight - a.effectiveWeight,
  )[0]!;

  switch (strongest.dimension) {
    case "taste_fit":
      return "The strongest tie is cultural taste: what I make and what this brand stands for sit in the same space.";
    case "content_compatibility":
      return "The strongest tie is content: the descriptors below are ones this brand and my own taste tags share.";
    case "audience_demographic":
      return "The strongest tie is the demographic dimension, which reflects the audience I declared — not a measurement of anyone.";
    case "geographic":
      return "The strongest tie is geography: where I'm based matches the market the data returned for this brand.";
    case "opportunity_gap":
      return "The strongest tie is that this is open ground for me: clear affinity against coverage I have not already saturated.";
    default:
      return undefined;
  }
}

/**
 * The cultural ground between the creator's declared interests and the brand: the
 * intermediate nodes of the interest → affinity → brand path. The brand itself and
 * the declared interests (already named by the drivers line) are excluded, so the
 * sentence adds the middle step rather than repeating the two ends.
 */
function pathwayBridges(pathway: BrandPathway | undefined, exclude: readonly string[]): string[] {
  if (pathway === undefined || pathway.segments.length < 2) return [];
  const seen = new Set(exclude);
  const bridges: string[] = [];
  for (const segment of pathway.segments.slice(0, -1)) {
    const label = segment.to.label.trim();
    if (label.length > 0 && !seen.has(label)) {
      seen.add(label);
      bridges.push(label);
    }
  }
  return bridges.slice(0, 3);
}

/**
 * The gate every audience-context sentence passes through, in one place.
 *
 * Returns `undefined` — meaning "say nothing" — unless an overlap was actually
 * established. That single condition is the whole mechanism that stops a ticked chip
 * from manufacturing a cultural match: the sentence this gates is structurally a
 * comment ON an overlap the evidence produced, so where there is none there is
 * nothing to comment on. A brand that surfaced on drivers alone never gets one,
 * because there the creator's answer would be the only thing linking the two —
 * which is exactly the "this audience group and this brand category sound
 * compatible" inference the feature must not make.
 *
 * It also returns `undefined` when the creator answered neither question, which is
 * what makes the feature additive rather than a rewrite: with no context, every
 * builder below emits precisely what it emitted before this existed.
 *
 * NO PAIRING TABLE, and no matching of group labels against shared-dimension
 * labels. "Gamers" beside a gaming-culture overlap reads well, and so would "Gamers"
 * beside a skincare overlap if the creator ticked both — the honest sentence is
 * identical in both cases, because what it claims is what the creator SAID, not a
 * compatibility we decided. A lexical rule would be a hardcoded pairing wearing a
 * plausibility costume, and it would fire on any brand whose name merely resembles a
 * word the creator ticked.
 *
 * The gate is here rather than in each builder so that three surfaces cannot drift
 * apart about when a sentence is permitted. The GRAMMAR stays with each builder,
 * because "you", "they" and "I" are three different documents and this file already
 * keeps them separate over shared evidence.
 */
function audienceContextFor(
  audience: AudienceWords | undefined,
  shared: readonly string[],
): AudienceWords | undefined {
  if (shared.length === 0 || audience === undefined) return undefined;
  if (audience.groups.length === 0 && audience.purposes.length === 0) return undefined;
  return audience;
}

/**
 * The Content DNA gate. Same condition, same reason, kept as its own function.
 *
 * Two functions rather than one generic predicate because the two payloads are
 * differently shaped and a shared signature would have to accept a union or a
 * callback — more machinery than the four lines it replaces, and further from the
 * thing a reviewer needs to see, which is the refusal itself.
 *
 * It returns `undefined` unless an overlap was actually established, exactly like
 * `audienceContextFor`. Content DNA describes the creator and never the brand, so the
 * risk it guards is narrower — but it is the same risk: with no shared dimension, a
 * sentence naming the creator's method beside a brand is the only thing on the page
 * connecting them, and a reader will supply the connection themselves. §5 states it
 * outright: where nothing is shared, Content DNA must not make the brand look
 * culturally matched.
 *
 * Unlike the audience gate it does not check for emptiness, because "is there
 * anything to say" differs per surface — the prose builders need `positioning`, the
 * collaboration builder needs `approach`, and a creator who ticked only "Other" has
 * one and not the other. Each caller checks the field it intends to print, which is
 * what it already does for `AudienceWords.groups` and `.purposes`.
 */
function contentDnaFor(
  content: ContentDna | undefined,
  shared: readonly string[],
): ContentDna | undefined {
  if (shared.length === 0 || content === undefined) return undefined;
  return content;
}

/**
 * A template-built outreach draft. NO LLM (decision D5) — every sentence is a
 * deterministic function of the values already on screen, so the pitch cannot
 * claim something the analysis did not produce.
 *
 * Most sentences are derived from the BRAND, not just the creator: the subject,
 * opening and closing rotate on a hash of the brand id; the body names the cultural
 * ground this specific brand was compared and found to share, the declared interests
 * that drove the recommendation, and the dimension that is strongest for THIS brand.
 * Two different brands therefore produce two materially different emails, while the
 * same brand always produces the same one.
 *
 * The draft says out loud what it is NOT based on. That is not hedging for its
 * own sake: a pitch that quietly implies "N% of my audience matches your buyer"
 * is the single most damaging sentence this product could help a creator write,
 * because the brand will act on it and the creator will be the one who has to
 * retract it. Doc 01 §37 and fact F13 both forbid it, so the draft pre-empts it.
 */
export function draftPitch(input: PitchInput): string {
  const {
    creatorName,
    handle,
    niche,
    dna,
    brandId,
    brandName,
    brandCategory,
    drivers,
    pathway,
    intersection,
    isUntapped,
    platforms,
    audience,
    audienceContext,
    contentDna,
    previousWork,
    deliverables,
    contact,
    fit,
    voice,
  } = input;
  const lines: string[] = [];

  const identity = handle ? `${creatorName} (@${handle})` : creatorName;
  // Seed every variant choice from the brand id (falling back to the name), so the
  // rotation is stable per brand and identical input yields identical output.
  const seed = brandId.length > 0 ? brandId : brandName;

  lines.push(`Subject: ${pickVariant(SUBJECT_VARIANTS, seed)(creatorName, brandName)}`);
  lines.push("");
  lines.push(`Hi ${brandName} team,`);
  lines.push("");
  lines.push(pickVariant(OPENING_VARIANTS, seed)(brandName));
  lines.push("");
  lines.push(
    niche
      ? `I'm ${identity}. I describe my own work as "${niche}".`
      : `I'm ${identity}, a content creator.`,
  );

  if (platforms !== undefined && platforms.length > 0) {
    lines.push(`I publish on ${list(platforms.slice(0, 4))}.`);
  }

  // The brand-specific reason comes BEFORE the creator's general profile: this is
  // the sentence that differs most between brands, so it earns the top slot.
  const category = brandCategoryLabel(brandCategory);
  const driverNames = (drivers ?? [])
    .map((driver) => driver.name)
    .filter((name) => name.trim().length > 0)
    .slice(0, 3);
  if (driverNames.length > 0) {
    lines.push("");
    lines.push(
      `${brandName} is not a cold choice: it surfaced against interests I declared myself — ${list(
        driverNames,
      )} — and that chain is why I'm writing to you${
        category ? ` rather than another ${category} brand` : ""
      }.`,
    );
  } else if (category) {
    lines.push("");
    lines.push(
      `I'm writing to ${brandName} specifically, not to every ${category} brand — the fit below is computed against the culture I actually make.`,
    );
  }

  // §24: the shared-ground sentence comes from the intersection when one exists.
  // "We both sit on X" is a claim about two cultural profiles that were actually
  // compared; "the path between us runs through X" is a claim about the route a
  // catalogue query took. The first is what a brand can respond to, so it takes the
  // slot, and the pathway remains the fallback for a caller that computed no
  // intersection — never a second, competing version of the same sentence.
  const shared = sharedTasteLabels(intersection);
  if (shared.length > 0) {
    const strengthLabel = intersection?.strengthLabel;
    const strongest = strongestSharedTaste(intersection);
    lines.push("");
    lines.push(
      `Our content and your brand share a cultural connection around ${list(shared)}.${
        strengthLabel === undefined ? "" : ` ${strengthLabel}.`
      }`,
    );
    if (strongest !== undefined) {
      lines.push(
        `The strongest single overlap is ${strongest.label.toLowerCase()}, on ground ${
          strongest.kind === "direct"
            ? "I confirmed myself"
            : "that reached my profile through an adjacent connection rather than something I declared outright"
        } — so a piece built there is one I can already make, not one I would have to invent a reason for.`,
      );
    }
  } else {
    const bridges = pathwayBridges(pathway, [brandName, ...driverNames]);
    if (bridges.length > 0) {
      lines.push("");
      lines.push(
        `The path between us runs through ${list(
          bridges,
        )} — cultural ground my declared taste and ${brandName} both sit on.`,
      );
    }
  }

  // The second of the two claims this draft has to keep apart: the overlap above is
  // what the evidence established, and this is why the creator's own stated intent
  // makes it ground they can build on rather than borrow. Through the SAME gate as
  // every other audience sentence, so a brand with no established overlap gets no
  // line — in a pitch that would be the whole argument resting on "our audiences
  // sound compatible", which is the sentence most likely to be quoted back at the
  // creator as a claim they made.
  //
  // It also says out loud that it is not follower data. A brand reading "I make my
  // work for gamers" will otherwise treat it as a measured audience, and the pitch is
  // the one surface here that leaves the product.
  const intent = audienceContextFor(audienceContext, shared);
  if (intent !== undefined) {
    const clauses: string[] = [];
    if (intent.groups.length > 0) clauses.push(`I make my work for ${list(intent.groups)}`);
    if (intent.purposes.length > 0) clauses.push(`people come to it for ${list(intent.purposes)}`);
    lines.push("");
    lines.push(
      `${capitalise(clauses.join(", and "))} — so the ground above is one I can build on rather ` +
        `than borrow. That is my own description of my intent, not measured follower data, and ` +
        `not the evidence for the overlap.`,
    );
  }

  // The third layer, and the one that answers the question the two sentences above
  // leave open: the overlap is what was compared, the intent is who it is for, and
  // this is what the piece would actually be. `method` rather than `positioning`
  // because the platforms already have their own sentence two paragraphs up, and
  // naming them twice in one email reads as a template that lost track of itself.
  //
  // Through the same gate as every other stated-context sentence. A brand with no
  // established overlap gets no line here, so the draft can never rest on "my format
  // suits your category" — the inference §5 forbids and the one a brand is most
  // likely to quote back.
  const content = contentDnaFor(contentDna, shared);
  if (content?.method !== undefined) {
    lines.push("");
    lines.push(
      `How I make things: ${content.method}. That is my own account of my method, offered as ` +
        `the form a piece on the ground above would take — it was not part of the comparison ` +
        `that found the overlap, and it is not a claim about what you are looking for.`,
    );
  }

  const core = topLabels(dna.coreTastes, (tag) => tag.tag.name);
  const categories = topLabels(dna.categories, (category) => category.label);
  if (core.length > 0 || categories.length > 0) {
    const subject = core.length > 0 ? list(core) : list(categories);
    lines.push("");
    lines.push(
      `For context, my cultural profile — built from the interests I selected, not from any measurement of my audience — centres on ${subject}.`,
    );
  }

  const unexpected = dna.unexpectedAffinities[0];
  if (unexpected) {
    lines.push("");
    lines.push(
      `One connection I did not expect: ${unexpected.label} (${unexpected.category}). ${
        unexpected.apiSourced
          ? "The data source surfaced it as a cross-domain result."
          : "It came from comparing the categories returned against the ones I declared."
      } It is a modelled taste signal, not evidence about who watches me.`,
    );
  }

  // The suggested angle. Labelled as a suggestion in the body as well as in the
  // heading: an idea that reads as an agreed plan is how a creator ends up
  // promising a brand something nobody discussed.
  const concept = proposeCollaboration({
    brandId,
    brandName,
    category: brandCategory,
    isUntapped: isUntapped === true,
    drivers,
    coreTastes: dna.coreTastes,
    platforms,
    intersection,
    contentDna,
  });
  if (concept !== undefined) {
    lines.push("");
    lines.push("One idea, offered as a starting point rather than a proposal:");
    lines.push(`- ${concept.idea}`);
    lines.push(`- Why this and not something generic: ${concept.basis}`);
    lines.push(
      "- I have not assumed you want this, and I would rather hear what you are actually planning.",
    );
  }

  lines.push("");
  lines.push(`Why ${brandName}, specifically:`);
  const lead = strongestDimensionLead(fit);
  if (lead !== undefined) {
    lines.push(`- ${lead}`);
  }
  for (const rationale of describeBrandFit(fit, voice)) {
    lines.push(`- ${rationale}`);
  }

  lines.push("");
  lines.push(
    `To be clear about the basis: this profile comes from ${affinityNoun(
      voice,
    )} over interests I declared myself. It is not survey data, not a percentage of my audience, and not a promise of performance.`,
  );

  if (voice.isIllustrative) {
    lines.push("");
    lines.push(
      "Note: the figures above were produced by CreatorsDNA's development data set and are illustrative. They should not be quoted to a brand as a real assessment.",
    );
  }

  // What the creator has to supply. A bracketed placeholder is honest in a way a
  // smooth sentence is not: it cannot be mistaken for a claim, and it survives
  // being left in by accident because it visibly reads as unfilled.
  lines.push("");
  lines.push("What I can add if this is worth a conversation:");
  lines.push(...supplyLines("Audience", audience, AUDIENCE_PLACEHOLDER));
  lines.push(...supplyLines("Recent work", previousWork, WORK_PLACEHOLDER));
  lines.push(...supplyLines("What I would make", deliverables, DELIVERABLES_PLACEHOLDER));

  lines.push("");
  lines.push(
    contact !== undefined && contact.trim().length > 0
      ? `You can reach me at ${contact.trim()}.`
      : CONTACT_PLACEHOLDER,
  );

  lines.push("");
  lines.push(`Next step, if it is useful: ${pickVariant(CLOSING_VARIANTS, seed)(brandName)}`);
  lines.push("");
  lines.push(creatorName);

  return lines.join("\n");
}

/**
 * One "what I can add" line: the supplied values, or the placeholder.
 *
 * Returns an array because a supplied list becomes several bullets while a
 * placeholder stays one, and the caller pushes the result straight into `lines`.
 */
function supplyLines(
  label: string,
  values: readonly string[] | undefined,
  placeholder: string,
): string[] {
  const filled = (values ?? []).map((value) => value.trim()).filter((value) => value.length > 0);
  if (filled.length === 0) return [`- ${label}: ${placeholder}`];
  return filled.slice(0, 4).map((value) => `- ${label}: ${value}`);
}

/* The placeholders. Each one names what is missing AND why the draft does not
   fill it, so a creator who copies without editing sends a sentence that reads as
   an obvious gap rather than as an unsupported claim. None of them trips
   `FORBIDDEN_PATTERNS`: the audience one deliberately avoids a percentage, which
   is the whole reason it is a placeholder. */
const AUDIENCE_PLACEHOLDER =
  "[add your own figures here — CreatorsDNA does not measure audiences, so this draft states none]";
const WORK_PLACEHOLDER = "[link two or three pieces that are closest to this]";
const DELIVERABLES_PLACEHOLDER =
  "[what you would actually make — format, length, and how many pieces]";
const CONTACT_PLACEHOLDER =
  "[add your email or the contact you want replies to go to — CreatorsDNA does not hold one for you]";

/* `EDITED_PITCH_DISCLOSURE` — the line `PitchEditor` appends when a creator has
   edited the draft into text that trips the forbidden patterns — lives in
   `./honesty` and is re-exported near the top of this file. It is declared there
   rather than here so that the editor can use it without importing the scoring
   layer that this module pulls in. */

// ---------------------------------------------------------------------------
// Dev guard
// ---------------------------------------------------------------------------

/* The batch checker lives in `./honesty` and is re-exported near the top of this
   file, next to the patterns it applies. Keeping it there means the copy rules
   have exactly one implementation. */
