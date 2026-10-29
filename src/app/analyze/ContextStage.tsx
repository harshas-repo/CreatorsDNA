"use client";

import { AGE_BUCKET_LABEL, QLOO_AGE_BUCKETS, QLOO_GENDERS } from "@/lib/contracts/qloo";
import {
  AUDIENCE_GROUPS,
  AUDIENCE_GROUP_LABEL,
  CONTENT_PURPOSES,
  CONTENT_PURPOSE_LABEL,
} from "@/lib/contracts/creator";
import { Field, FieldHint, SaturationSlider } from "./CaptureStages";

import type { AudienceGroup, ContentPurpose } from "@/lib/contracts/creator";
import type { QlooAgeBucket, QlooGender } from "@/lib/contracts/qloo";
import type { CaptureStageProps } from "./CaptureStages";
import { categoryOptions } from "./flowTypes";

/**
 * Stage 4 — "Add optional context". Optional, and the optionality is the point.
 *
 * Three blocks, each feeding a named dimension, each saying out loud what
 * declining it costs:
 *
 *   - coverage feeds the opportunity-gap dimension and the untapped-opportunity
 *     chart;
 *   - age and gender feed the audience-demographic dimension, nominally 20% of a
 *     brand-fit score when available;
 *   - place and country feed the geographic dimension, nominally 10%.
 *
 * When a dimension cannot be evidenced the aggregator drops it and renormalises the
 * remaining weights, so nothing is scored at a neutral 0.5 and no fabricated
 * partial credit appears. That is doc 02 §16, and it is the reason this stage can
 * be skipped entirely without producing a wrong answer — it produces a smaller one,
 * labelled as smaller.
 *
 * A FOURTH BLOCK FEEDS NO DIMENSION.
 * ----------------------------------
 * "Who do you create for?" is last because it is a different kind of answer, and
 * the ordering is what says so. It is excluded from every score, every intersection
 * and the analysis cache key; its only effect is on the WORDS in an explanation of
 * an overlap the evidence already established. That is why it cannot manufacture a
 * match: there is no path from a ticked chip to a number. It is also why the block
 * says "changes no score" in its own heading, and why the audience it describes is
 * never called a measurement — it is the creator's statement of intent, and the
 * results keep it visually and verbally separate from the demographic buckets
 * above, which at least go into an arithmetic.
 *
 * THE COVERAGE VOCABULARY IS DERIVED, NOT TYPED.
 * ---------------------------------------------
 * The categories offered here come from `categoryOptions(draft.review)`, i.e. from
 * the entity types of the entities the creator CONFIRMED. The old flow asked for
 * free text ("film criticism", "music") while `deriveCategories` produced ids from
 * the catalogue's own types (`urn:entity:movie`). `coverageWithBasis` then looked
 * one vocabulary up in the other and usually missed, so a creator who said they were
 * saturated in film was plotted as having no coverage of it — their own declared
 * saturation turned into their own untapped opportunity.
 *
 * Offering the derived ids makes the two sides of the subtraction the same thing by
 * construction. There is deliberately no free-text category input: a category the
 * derivation will never produce is a coverage claim that can never be read back,
 * and a control that cannot affect the result is the thing this stage exists to
 * stop offering.
 *
 * The audience block is the one exception, and it is an exception for the opposite
 * reason: its chips affect no result either, but they are not a claim to be read
 * back against derived data — they are context for a human sentence. So a free-text
 * "Other" is appropriate there and would be a defect here.
 */
export function ContextStage({ draft, patch }: CaptureStageProps) {
  const options = categoryOptions(draft.review);

  function toggleBucket(bucket: QlooAgeBucket): void {
    patch({
      ageBuckets: draft.ageBuckets.includes(bucket)
        ? draft.ageBuckets.filter((existing) => existing !== bucket)
        : [...draft.ageBuckets, bucket],
      // Declaring anything un-skips the stage.
      contextSkipped: false,
    });
  }

  function toggleGroup(group: AudienceGroup): void {
    patch({
      audienceGroups: draft.audienceGroups.includes(group)
        ? draft.audienceGroups.filter((existing) => existing !== group)
        : [...draft.audienceGroups, group],
      contextSkipped: false,
    });
  }

  function togglePurpose(purpose: ContentPurpose): void {
    patch({
      audiencePurposes: draft.audiencePurposes.includes(purpose)
        ? draft.audiencePurposes.filter((existing) => existing !== purpose)
        : [...draft.audiencePurposes, purpose],
      contextSkipped: false,
    });
  }

  function toggleCategory(id: string): void {
    const has = draft.coveredCategories.includes(id);
    if (has) {
      const saturation = { ...draft.saturation };
      delete saturation[id];
      patch({
        coveredCategories: draft.coveredCategories.filter((existing) => existing !== id),
        saturation,
        contextSkipped: false,
      });
      return;
    }
    // Saturation defaults to 1 — "I cover this" with no qualification means fully.
    // `coverageWithBasis()` infers exactly that from `coveredCategories` alone, so
    // writing it explicitly keeps the record and the inference in agreement instead
    // of letting the slider start somewhere the pipeline would read differently.
    patch({
      coveredCategories: [...draft.coveredCategories, id],
      saturation: { ...draft.saturation, [id]: 1 },
      contextSkipped: false,
    });
  }

  return (
    <div className="cd-onboard__stage-body">
      <h2 className="cd-onboard__title">Add optional context</h2>
      <p className="cd-onboard__lede cd-measure">
        None of this is required. The first three blocks each feed one dimension of brand fit;
        decline one and it is dropped, the remaining weights renormalised, and the results say which
        were used. The last feeds no dimension — it only adds words to the explanations.
      </p>

      <section className="cd-onboard__block" aria-labelledby="context-coverage">
        <h3 className="cd-onboard__subtitle" id="context-coverage">
          What do you already make?
          <span className="cd-onboard__subtitle-note">
            from the <span className="cd-tabular">{options.length}</span> categor
            {options.length === 1 ? "y" : "ies"} your confirmed entities belong to
          </span>
        </h3>
        <p className="cd-onboard__hint">
          Self-reported, and labelled as self-reported everywhere it appears. Coverage is never
          measured from your uploads.
        </p>

        {options.length === 0 ? (
          <p className="cd-onboard__warning">
            No entity is confirmed yet, so there is no category to ask about. Go back and confirm at
            least one match — these categories come from what you confirmed, which is what makes the
            gap arithmetic compare like with like.
          </p>
        ) : (
          <>
            {/* Stated bluntly because the consequence is non-obvious and total. */}
            <p className="cd-onboard__warning">
              Declare nothing and every category is assumed uncovered. That assumption is ours, not
              your answer, so it is labelled &ldquo;assumed&rdquo; and drawn with a dashed marker —
              and the untapped chart says which points rest on it.
            </p>

            <ul className="cd-onboard__coverage">
              {options.map((option) => {
                const covered = draft.coveredCategories.includes(option.id);
                return (
                  <li key={option.id} className="cd-onboard__coverage-row">
                    <button
                      type="button"
                      className="cd-chip cd-chip--filter"
                      aria-pressed={covered}
                      onClick={() => toggleCategory(option.id)}
                    >
                      {option.label}
                      <span className="cd-onboard__coverage-count">
                        {option.count} confirmed
                      </span>
                      <span className="cd-sr-only">
                        {covered
                          ? " — you say you cover this. Activate to say you do not."
                          : " — you have not said you cover this. Activate to say you do."}
                      </span>
                    </button>

                    {covered ? (
                      <SaturationSlider
                        label={`How much of your output is ${option.label}?`}
                        value={draft.saturation[option.id] ?? 1}
                        onChange={(next) =>
                          patch({
                            saturation: { ...draft.saturation, [option.id]: next },
                            contextSkipped: false,
                          })
                        }
                      />
                    ) : null}
                  </li>
                );
              })}
            </ul>

            <p className="cd-onboard__note">
              A category you leave unselected is treated as uncovered. The results separate that
              assumption from a category you said you rarely cover — only one of them is your
              answer.
            </p>
          </>
        )}
      </section>

      <section className="cd-onboard__block" aria-labelledby="context-audience">
        <h3 className="cd-onboard__subtitle" id="context-audience">
          Who watches?
        </h3>
        <p className="cd-onboard__hint">
          Feeds the audience-demographic dimension, nominally 20% of a brand-fit score when it is
          available.
        </p>

        <div className="cd-onboard__fields">
          <fieldset className="cd-onboard__fieldset">
            <legend className="cd-onboard__label">Age ranges</legend>
            <FieldHint id="age">
              Select every range that applies. These are the buckets the data source accepts, not a
              free choice of ranges.
            </FieldHint>
            <div className="cd-onboard__toggles" aria-describedby="age-hint">
              {QLOO_AGE_BUCKETS.map((bucket) => (
                <button
                  key={bucket}
                  type="button"
                  className="cd-chip cd-chip--filter cd-tabular"
                  aria-pressed={draft.ageBuckets.includes(bucket)}
                  onClick={() => toggleBucket(bucket)}
                >
                  {AGE_BUCKET_LABEL[bucket]}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="cd-onboard__fieldset">
            <legend className="cd-onboard__label">Gender skew</legend>
            <FieldHint id="gender">
              The upstream parameter accepts two values and no others. If neither describes your
              audience, leave it unset — a dimension built on a category that does not fit is worse
              than none, and the score reports which it used.
            </FieldHint>
            <div className="cd-onboard__radios" aria-describedby="gender-hint">
              {GENDER_OPTIONS.map((option) => (
                <label key={option.word} className="cd-onboard__radio">
                  <input
                    type="radio"
                    name="gender-skew"
                    checked={draft.gender === option.value}
                    onChange={() => patch({ gender: option.value, contextSkipped: false })}
                  />
                  <span className="cd-onboard__radio-word">{option.word}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      </section>

      <section className="cd-onboard__block" aria-labelledby="context-place">
        <h3 className="cd-onboard__subtitle" id="context-place">
          Where is your audience?
        </h3>
        <p className="cd-onboard__hint">
          Feeds the geographic dimension, nominally 10% of a brand-fit score. An exact country match
          against the region the catalogue returned for a brand — coarse by design, since no
          proximity model could be justified from the data.
        </p>

        <div className="cd-onboard__fields">
          <Field
            label="Country"
            hint="The only geographic input compared against brand data. Leave it empty and the dimension is omitted and its weight redistributed — never guessed from a city."
          >
            {(control) => (
              <input
                {...control}
                className="cd-input"
                type="text"
                value={draft.country}
                maxLength={120}
                autoComplete="country-name"
                placeholder="Portugal"
                onChange={(event) => patch({ country: event.target.value, contextSkipped: false })}
              />
            )}
          </Field>

          <Field
            label="City or region"
            hint="Optional. Recorded as your own description of your audience and shown as such — NOT sent as a location signal, because a place the data source cannot match makes the whole request fail."
          >
            {(control) => (
              <input
                {...control}
                className="cd-input"
                type="text"
                value={draft.place}
                maxLength={120}
                placeholder="Lisbon"
                onChange={(event) => patch({ place: event.target.value, contextSkipped: false })}
              />
            )}
          </Field>
        </div>

        <p className="cd-onboard__note">
          The insights contract has no country parameter, so neither field is forwarded as a signal.
          The country is used here, by us, for the one comparison the brand data supports; the city
          stays yours.
        </p>
      </section>

      <section className="cd-onboard__block" aria-labelledby="context-intent">
        <h3 className="cd-onboard__subtitle" id="context-intent">
          Who do you create for?
          <span className="cd-onboard__subtitle-note">changes no score</span>
        </h3>
        <p className="cd-onboard__hint">
          Feeds no dimension, changes no fit score, and cannot create a match the cultural evidence
          did not already find. Where an overlap was established it can add one sentence about why
          that ground suits your content — always labelled as your statement, never as a
          measurement.
        </p>

        <div className="cd-onboard__fields">
          <fieldset className="cd-onboard__fieldset">
            <legend className="cd-onboard__label">Who do you primarily create for?</legend>
            <FieldHint id="audience-groups">
              Select every group that applies, or none. This is your intention, not an observation:
              nothing is checked against your followers, and the results never present it as who
              actually watches.
            </FieldHint>
            <div className="cd-onboard__toggles" aria-describedby="audience-groups-hint">
              {AUDIENCE_GROUPS.map((group) => (
                <button
                  key={group}
                  type="button"
                  className="cd-chip cd-chip--filter"
                  aria-pressed={draft.audienceGroups.includes(group)}
                  onClick={() => toggleGroup(group)}
                >
                  {AUDIENCE_GROUP_LABEL[group]}
                </button>
              ))}
            </div>

            {draft.audienceGroups.includes("other") ? (
              <Field
                label="Who else?"
                hint="Your own words: shown quoted and attributed to you, never folded into the list above as though we had defined it."
              >
                {(control) => (
                  <input
                    {...control}
                    className="cd-input"
                    type="text"
                    value={draft.audienceGroupsOther}
                    maxLength={120}
                    placeholder="Amateur astronomers"
                    onChange={(event) =>
                      patch({ audienceGroupsOther: event.target.value, contextSkipped: false })
                    }
                  />
                )}
              </Field>
            ) : null}
          </fieldset>

          <fieldset className="cd-onboard__fieldset">
            <legend className="cd-onboard__label">
              What do people primarily come to your content for?
            </legend>
            <FieldHint id="audience-purposes">
              Select every reason that applies, or none. Describes what you offer, not what an
              audience was measured to want.
            </FieldHint>
            <div className="cd-onboard__toggles" aria-describedby="audience-purposes-hint">
              {CONTENT_PURPOSES.map((purpose) => (
                <button
                  key={purpose}
                  type="button"
                  className="cd-chip cd-chip--filter"
                  aria-pressed={draft.audiencePurposes.includes(purpose)}
                  onClick={() => togglePurpose(purpose)}
                >
                  {CONTENT_PURPOSE_LABEL[purpose]}
                </button>
              ))}
            </div>

            {draft.audiencePurposes.includes("other") ? (
              <Field
                label="What else?"
                hint="Your own words: shown quoted and attributed to you, never folded into the list above as though we had defined it."
              >
                {(control) => (
                  <input
                    {...control}
                    className="cd-input"
                    type="text"
                    value={draft.audiencePurposesOther}
                    maxLength={120}
                    placeholder="Learning to fix old synthesizers"
                    onChange={(event) =>
                      patch({ audiencePurposesOther: event.target.value, contextSkipped: false })
                    }
                  />
                )}
              </Field>
            ) : null}
          </fieldset>
        </div>

        <p className="cd-onboard__note">
          Decline both and every explanation reads as it did before this block. Nothing is inferred
          to fill the gap, and no brand becomes more or less of an opportunity because of it.
        </p>
      </section>

      <p className="cd-onboard__note">
        None of this is verified against your analytics. It is what you say about your own audience
        and output, and the results label it creator-declared rather than measured.
      </p>
    </div>
  );
}

const GENDER_LABEL: Record<QlooGender, string> = {
  male: "Skews male",
  female: "Skews female",
};

/**
 * Built from `QLOO_GENDERS` rather than written out, so the control cannot offer a
 * value the upstream parameter would reject — and so that if the contract ever
 * widens beyond the binary two, the option appears here instead of the question
 * having to be remembered by whoever edits the form.
 *
 * The trailing option's value is the ABSENCE of a value. Without it, "not stated"
 * and "not yet answered" are the same control state, distinguishable only by
 * nothing being highlighted — which reads as an unanswered question rather than a
 * deliberate refusal, and this whole stage is about making the refusal explicit
 * enough that the rail can mark it skipped.
 */
const GENDER_OPTIONS: ReadonlyArray<{ value: QlooGender | undefined; word: string }> = [
  ...QLOO_GENDERS.map((gender) => ({ value: gender, word: GENDER_LABEL[gender] })),
  { value: undefined, word: "Not stated" },
];
