import "server-only";

import { MemoryCache } from "@/lib/cache/memory";
import { runAnalysis } from "@/lib/analysis/pipeline";
import { getAllBrands } from "@/lib/data/brandRegistry";
import { SyntheticProvider } from "@/lib/providers/synthetic/provider";
import type { CreatorAnalysis } from "@/lib/contracts/viewModels";

import type { ArchetypeId } from "@/lib/demo/archetypes";
import { FIXED_TIMESTAMP, archetypeProfile } from "@/lib/demo/archetypes";

/**
 * The worked example shown on the public site (doc 02 §27, sections 6–9).
 *
 * It is a REAL run of the real pipeline over a real archetype profile — not a
 * hand-written object shaped like a `CreatorAnalysis`. That choice costs a few
 * milliseconds of build time and buys something a mock cannot: the numbers on the
 * marketing page are produced by the same code path as the numbers in the app, so
 * the two cannot disagree. A hand-written example drifts the first time the
 * scoring weights change, and it drifts in the direction of still looking
 * plausible.
 *
 * ALWAYS SYNTHETIC, REGARDLESS OF CONFIGURATION
 * --------------------------------------------
 * This does not go through `getProviderContext()`. If it did, a deployment with a
 * live Qloo key would spend real API quota rendering a public marketing page, and
 * the example would change whenever the catalogue did. The examples on the site
 * are illustrations; they are labelled as such by the same `DataSource` banner
 * the app uses, and they are pinned so a visitor sees the same thing in six
 * months that the person who wrote the surrounding copy saw.
 *
 * The fixed timestamp matters for the same reason: without it `generatedAt` is
 * "now", so the "Generated …" line under the example changes between renders and
 * the copy written around the example stops describing what is on screen.
 *
 * `/` prerenders statically (`next build` reports it as `○ Static`), so the run
 * happens once at build time either way. The difference is reproducibility: with
 * a fixed timestamp a rebuild produces the same page byte for byte, and the page
 * only changes when the product changed. With `new Date()` every deploy —
 * including one that touched nothing here — would silently republish the examples
 * under a new date, which is exactly the drift this module exists to prevent.
 */

/** Which archetype the public examples are drawn from. */
export const EXAMPLE_ARCHETYPE: ArchetypeId = "streetwear";

export interface ExampleAnalysis {
  analysis: CreatorAnalysis;
  /** Degradations recorded while building it, so the page can show them. */
  degradations: readonly string[];
}

/**
 * Memoised per process.
 *
 * The run is deterministic, so the memo cannot serve a stale answer — it only
 * stops the same computation happening once per request. A module-level `Map` is
 * the right store here rather than the cache interface: this is build/render-time
 * data with no TTL semantics, and putting it through `KeyValueCache` would imply
 * it could expire.
 */
const memo = new Map<ArchetypeId, ExampleAnalysis>();

export async function exampleAnalysis(id: ArchetypeId = EXAMPLE_ARCHETYPE): Promise<ExampleAnalysis> {
  const cached = memo.get(id);
  if (cached !== undefined) return cached;

  const built = await build(id);
  memo.set(id, built);
  return built;
}

async function build(id: ArchetypeId): Promise<ExampleAnalysis> {
  const brands = getAllBrands();
  // The provider requires a cache; this one is never hit twice, because the whole
  // analysis is memoised above and the synthetic catalogue does not change. The
  // TTL is therefore arbitrary rather than tuned — 3600s and a small entry bound
  // so a dev server that re-renders the page a thousand times cannot grow.
  const provider = new SyntheticProvider({ brands, cache: new MemoryCache(3600, 256) });

  const outcome = await runAnalysis({
    profile: archetypeProfile(id),
    provider,
    brands,
    // The archetype interests are already resolved to entity ids, so re-running
    // the search stage would only add work and a second place to differ.
    resolveInterests: false,
    generatedAt: FIXED_TIMESTAMP,
  });

  /**
   * A non-renderable example is a BUILD failure, not a fallback. The alternative
   * — rendering the marketing page with an empty Taste DNA — would show a
   * visitor a product that appears broken, on the one page whose job is to
   * convince them it is not. Throwing here means `next build` fails loudly and
   * the example gets fixed before it ships.
   *
   * `outcome.renderable`, not `outcome.taste.renderable`: the taste stage only
   * reports false at L4, so an archetype whose interests stopped resolving would
   * pass the narrower check and ship a page with every chart blanked.
   */
  if (!outcome.renderable) {
    throw new Error(
      `The public-site example for archetype "${id}" is not renderable. ` +
        `Resolved signals: ${outcome.hasSignals ? "yes" : "none"}. ` +
        `Degradations: ${outcome.taste.degradations.join("; ") || "(none recorded)"}. ` +
        `Fix the archetype or the synthetic catalogue — do not ship an empty example.`,
    );
  }

  return { analysis: outcome.analysis, degradations: outcome.taste.degradations };
}
