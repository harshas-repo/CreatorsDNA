import type { DataSource } from "@/lib/contracts/domain";
import type { CreatorAnalysis } from "@/lib/contracts/viewModels";
import { SYNTHETIC_FIT_DISCLOSURE } from "@/lib/copy/generate";

/**
 * Presentation layer for the public example route (`/examples`).
 *
 * WHAT THIS IS FOR
 * ----------------
 * `/examples` exists so a visitor can visualise what the product does: it runs
 * one archetype profile through the real pipeline and renders the real charts.
 * That run is produced by the synthetic provider (see `exampleAnalysis.ts`), so
 * its view-models are stamped `provenance: "synthetic"` and carry the
 * illustrative-data banners the in-app results surface needs.
 *
 * Those banners are right inside the app, where a live key may or may not be
 * configured and the reader must know which they are looking at. On the example
 * page they are noise: the reader is not being told "this is your result", they
 * are being shown "this is the shape of a result". So this module produces a
 * PRESENTATION COPY that drops the development-data framing while making no
 * competing claim.
 *
 * THE ONE RULE IT MUST NOT BREAK
 * ------------------------------
 * It never turns a synthetic value into a Qloo value. Provenance `synthetic`
 * maps to `derived` — "Calculated by CreatorsDNA from the inputs shown" — which
 * is true of every number on the page, because they were all produced by
 * CreatorsDNA's own deterministic pipeline over a fixed catalogue. Nothing here
 * maps to `qloo`, `EXAMPLE_SOURCE.isIllustrative` stays false without borrowing
 * Qloo's name (the neutral `EXAMPLE_VOICE` keys off `providerId`, not off
 * Qloo), and the `QlooInsightBadge` is suppressed rather than flipped to "on".
 * The example is presented as the product's own output, not as a Qloo discovery.
 */

/**
 * The neutral source the example page presents through.
 *
 * `providerId: "example"` is what `sourceVoice()` keys on to return
 * `EXAMPLE_VOICE` instead of the live (Qloo) or synthetic voice. `mode` is
 * `cached` rather than `synthetic` so no downstream `mode === "synthetic"`
 * check re-arms the illustrative labelling on this copy.
 */
export const EXAMPLE_SOURCE: DataSource = {
  mode: "cached",
  providerId: "example",
  label: "Example profile",
  isIllustrative: false,
};

/**
 * Return a presentation copy of a real analysis with the development-data
 * framing removed, for the example route only.
 *
 * A structural clone rather than a mutation: `exampleAnalysis()` is memoised per
 * process and the same object backs other surfaces, so the transform must not
 * edit it in place. The walk is generic on purpose — provenance lives on nodes,
 * points, ranking items, fit components and every `meta`, and enumerating those
 * paths by hand would silently miss one the moment a view-model gains a field.
 */
export function presentExampleAnalysis<T>(analysis: T): T {
  return present(analysis) as T;
}

function isDataSource(value: object): boolean {
  return (
    "mode" in value &&
    "providerId" in value &&
    "label" in value &&
    "isIllustrative" in value &&
    typeof (value as DataSource).providerId === "string" &&
    typeof (value as DataSource).isIllustrative === "boolean"
  );
}

function present(value: unknown): unknown {
  if (Array.isArray(value)) {
    // Drop the development-data caveat that `describeBrandFit` bakes into a
    // brand-fit rationale at build time. It is a fixed, exported sentence, so
    // matching it exactly is safe and cannot catch a legitimate line.
    return value.map(present).filter((entry) => entry !== SYNTHETIC_FIT_DISCLOSURE);
  }

  if (value === null || typeof value !== "object") {
    return value;
  }

  // A data source is replaced wholesale rather than field-by-field, so the copy
  // carries `EXAMPLE_SOURCE` identically everywhere it appeared.
  if (isDataSource(value)) {
    return EXAMPLE_SOURCE;
  }

  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    switch (key) {
      // Provenance is normalised to `derived` for the example: "Calculated by
      // CreatorsDNA from the inputs shown". `synthetic` is the in-app
      // "illustrative" class; `qloo` is stamped on catalogue-reported brand
      // metadata, but nothing on this page was returned by Qloo, so leaving it
      // would both mislabel fixture data and advertise a Qloo discovery. Both
      // collapse to `derived` — what every figure here actually is. `creator`
      // ("You") is preserved. Nothing ever maps TO `qloo`.
      case "provenance":
        out[key] = entry === "synthetic" || entry === "qloo" ? "derived" : present(entry);
        break;
      // Drives the "Illustrative explanation" chip in the culture-to-brand map.
      // `unavailable` reads "No explanation returned", which is neutral.
      case "explainabilityStatus":
        out[key] = entry === "synthetic" ? "unavailable" : present(entry);
        break;
      // The unconditional illustrative banner in VizFrame / InsightSection.
      case "containsSynthetic":
        out[key] = false;
        break;
      // Free-text entity fields the synthetic catalogue fills with fixture
      // disambiguation ("Synthetic music entity", "Invented … used for
      // development data"). `AffinityRanking` renders `definition` in its
      // click-to-expand detail, so this text is one interaction away from the
      // reader. Drop it only when it reveals the development-data origin;
      // genuine descriptions (curated registry notes, quadrant and legend copy)
      // never match and are preserved.
      case "definition":
      case "disambiguation":
      case "description":
        out[key] =
          typeof entry === "string" && revealsSyntheticOrigin(entry) ? undefined : present(entry);
        break;
      default:
        out[key] = present(entry);
    }
  }
  return out;
}

/**
 * True when a free-text field is fixture copy that names its own development-data
 * origin. Matches the two shapes the synthetic catalogue produces — the
 * `Synthetic {category} entity` disambiguation and the `Invented … development
 * data` description — without touching ordinary prose.
 */
function revealsSyntheticOrigin(text: string): boolean {
  return /^(synthetic|invented)\b/i.test(text) || /\bdevelopment data\b/i.test(text);
}

/**
 * Narrow helper for the callers that already hold a `CreatorAnalysis`: keeps the
 * return type concrete so the page does not have to cast.
 */
export function presentExampleCreatorAnalysis(analysis: CreatorAnalysis): CreatorAnalysis {
  return presentExampleAnalysis(analysis);
}
