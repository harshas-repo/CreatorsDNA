// Live-wire divergence guards for the Qloo contract.
//
// Every failure pinned here was found the same way: a real response from the
// hackathon host was rejected by a schema written against the DOCUMENTED shape,
// and because Zod validates a whole array, one non-conforming sibling discarded
// results that were perfectly usable. Nothing threw at Qloo's end — the API
// returned 200 and our own contract threw the answer away.
//
// These run against the real schemas and the real mapper. No network, no mocks:
// the payloads below are transcribed from captured live responses.

import { describe, expect, it } from "vitest";

import {
  qlooEntityResultSchema,
  qlooInsightsResponseSchema,
  qlooSearchResponseSchema,
} from "@/lib/contracts/qloo";
import { mapEntityResultSet, mapSearchResponse } from "@/lib/providers/qloo/mapper";

import type { DataSource } from "@/lib/contracts/domain";

const LIVE_SOURCE: DataSource = {
  mode: "live",
  providerId: "qloo",
  label: "Qloo Insights API (live)",
  isIllustrative: false,
};

/**
 * Transcribed from the live `/search` response for "dream pop", which failed
 * schema validation on 2026-10-26 and surfaced to the creator as a 502
 * `malformed_response` — a hard error where eight usable candidates should have
 * appeared.
 *
 * The first item is the one that broke it. Qloo sent `"image": {}` for a
 * videogame with no artwork. `nullish()` on the image OBJECT does not cover
 * that: an empty object is present, so `url` was still required, its absence
 * failed the item, and the array failed with it. The two siblings below are
 * ordinary, well-formed results that were discarded for somebody else's missing
 * thumbnail — which is the part worth pinning, because a test asserting only
 * "the imageless entity parses" would still pass if the array rejection
 * returned.
 */
const IMAGELESS = {
  name: "Dreampop",
  entity_id: "58075A73-6926-4201-818B-B9051EE226FD",
  types: ["urn:entity:videogame"],
  properties: {
    description: "Match the color of your hands with the bubbles to pop them.",
    developer: "kaberikram",
    external: { metacritic: { id: "1400787075" } },
    image: {},
    platforms: ["Meta Quest"],
    release_date: "2024-06-05",
    release_year: 2024,
  },
  popularity: 0.9597609347428298,
  disambiguation: "2024-06-05, kaberikram",
  tags: [{ name: "Arcade", tag_id: "urn:tag:genre:media:arcade", type: "urn:tag:genre:media", value: "urn:tag:genre:media:arcade" }],
};

const IMAGED = {
  name: "Shoegaze & Dreampop Comp Disc 1",
  entity_id: "A3F3644C-3681-44AE-A637-A4F4D1A69BA3",
  types: ["urn:entity:album"],
  properties: {
    duration: { album: 0 },
    external: { spotify: {} },
    image: { url: "https://images.qloo.com/i/A3F3644C-3681-44AE-A637-A4F4D1A69BA3-420x-auto.jpg" },
    track_count: 0,
  },
  popularity: 0.34998101789346386,
  disambiguation: "Shoegaze & Dreampop Comp Disc 1",
};

const ALSO_IMAGED = {
  name: "Dream Pops",
  entity_id: "49D18DD4-7DF3-47CB-B68D-45BCC9989F3C",
  types: ["urn:entity:brand"],
  properties: { image: { url: "https://images.qloo.com/i/49D18DD4-7DF3-47CB-B68D-45BCC9989F3C-420x-auto.jpg" } },
  popularity: 0.2,
};

describe("live wire divergence — an entity with no artwork", () => {
  it("does not reject the siblings that came back with it", () => {
    const parsed = qlooSearchResponseSchema.safeParse({
      success: true,
      duration: 3.1,
      results: [IMAGELESS, IMAGED, ALSO_IMAGED],
    });

    // The assertion that actually failed in production. If this is false, one
    // imageless entity is still discarding the whole result set.
    expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues)).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.results).toHaveLength(3);

    const mapped = mapSearchResponse(parsed.data, LIVE_SOURCE);
    expect(mapped.matches).toHaveLength(3);
    // Every candidate reaches the creator, including the imageless one.
    expect(mapped.matches.map((m) => m.entity.name)).toEqual([
      "Dreampop",
      "Shoegaze & Dreampop Comp Disc 1",
      "Dream Pops",
    ]);
  });

  it("maps a missing image to no imageUrl rather than to a placeholder", () => {
    const parsed = qlooSearchResponseSchema.parse({
      success: true,
      results: [IMAGELESS, IMAGED],
    });
    const [imageless, imaged] = mapSearchResponse(parsed, LIVE_SOURCE).matches;

    // `undefined`, not "" and not a guessed CDN path. `ContentThumbnail` treats
    // `undefined` as "draw the role glyph", which is the honest empty state;
    // an empty string would be a URL that exists but cannot load.
    expect(imageless?.entity.imageUrl).toBeUndefined();
    // The relaxation must not have cost the positive case.
    expect(imaged?.entity.imageUrl).toBe(
      "https://images.qloo.com/i/A3F3644C-3681-44AE-A637-A4F4D1A69BA3-420x-auto.jpg",
    );
  });

  it("keeps a non-string url away from an <img src>", () => {
    // `image` is validated as `unknown` now, because `properties` is the part of
    // the payload the live host varies most and one divergent field used to
    // discard a whole result set. The guarantee that matters did not move with it:
    // a url that is not a string must never reach `entity.imageUrl`, and it is
    // enforced in the mapper, which is where the value is actually read.
    const parsed = qlooSearchResponseSchema.parse({
      success: true,
      results: [
        { name: "X", entity_id: "x", properties: { image: { url: 42 } } },
        { name: "Y", entity_id: "y", properties: { image: { url: "https://example.test/y.jpg" } } },
      ],
    });
    const [badUrl, goodUrl] = mapSearchResponse(parsed, LIVE_SOURCE).matches;

    expect(badUrl?.entity.imageUrl).toBeUndefined();
    expect(goodUrl?.entity.imageUrl).toBe("https://example.test/y.jpg");
  });

  it("covers the insights endpoint too, which shares the properties schema", () => {
    // `/search` and `/v2/insights` have different envelopes but the same
    // `properties` shape, so an imageless brand in a recommendation set was
    // failing the same way. Pinning it here stops the two endpoints drifting.
    const parsed = qlooInsightsResponseSchema.safeParse({
      success: true,
      results: { entities: [IMAGELESS, IMAGED] },
    });
    expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues)).toBe(true);
    if (!parsed.success) return;
    expect(mapEntityResultSet(parsed.data, LIVE_SOURCE).entities).toHaveLength(2);
  });

  it("still accepts the other empty-object divergences already relaxed", () => {
    // Recorded earlier against the live host and relaxed one at a time as each
    // was discovered. Grouped here because they are the same defect class — an
    // object the documentation says carries fields, sent empty — and a future
    // tightening of `qlooPropertiesSchema` would regress all of them at once.
    const parsed = qlooEntityResultSchema.safeParse({
      name: "Lo-fi",
      entity_id: "73FE5E9F-678A-4ACB-BF26-926B4F460E50",
      types: ["urn:entity:place"],
      properties: {
        duration: {},
        image: {},
        release_country: "South Korea",
        external: { spotify: {} },
        business_rating: 4.3,
      },
    });
    expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues)).toBe(true);
  });
});
