# CreatorsDNA — Qloo API Reference (Hackathon)

> **Document 03 of the CreatorsDNA context set.**
> Derived from the official Qloo hackathon developer guide, the linked reference pages, and the Qloo
> concept documentation. Supplements [`01-product-context.md`](01-product-context.md) and
> [`02-technical-spec.md`](02-technical-spec.md). Decisions and readiness live in
> [`04-decisions-and-readiness.md`](04-decisions-and-readiness.md).
>
> **⚠️ Everything in this document is derived from documentation, not from live calls.** No API key
> was available at time of writing. Qloo's own docs contradict each other in several places
> (see [§12](#12-documentation-contradictions--must-verify-live)). Every item marked **[VERIFY]**
> must be confirmed against the live hackathon endpoint before it is relied upon in code.
>
> **Documentation precedence (decided 2026-10-22):** `docs.qloo.com` and **verified live behaviour**
> are authoritative for the hackathon environment. `github.com/qloo/docs-public` is a **secondary
> reference**. Where they disagree, the contradiction is recorded in §12 — never silently resolved.
>
> **Sources studied — `docs.qloo.com` reference (primary):**
> - Qloo Agentic Hackathon Developer Guide — `docs.qloo.com/reference/qloo-llm-hackathon-developer-guide`
> - API Overview — `/reference/api-overview`
> - Insights API Deep Dive (full OpenAPI) — `/reference/insights-api-deep-dive`
> - Parameter Overview — `/reference/parameter-overview`
> - Parameter Reference — `/reference/parameters`
> - Entity Type Parameter Guide — `/reference/available-parameters-by-entity-type`
> - Recommendation Insights — `/reference/basic-insights-use-case`
> - Taste Analysis — `/reference/taste-analysis`
> - Demographic Insights — `/reference/demographics-use-case`
> - Key Use Cases — `/reference/use-cases`
> - Search Entities (`/search`) — `/reference/get-search`
> - Search Entities by ID (`/entities`) — `/reference/get-entities`
> - Search Tags (`/v2/tags`) — `/reference/get-tags`
> - Get Tag Types (`/v2/tags/types`) — `/reference/get-tag-types`
> - Get Audiences (`/v2/audiences`) — `/reference/get-audiences`
>
> **Sources studied — `github.com/qloo/docs-public` (secondary; supplied §15–§17):**
> - `docs/affinity-score.md` — what an affinity score is
> - `docs/affinity-score-methodology.md` — vectorisation + cosine similarity
> - `docs/interpreting-affinity-scores.md` — **ranges, per-query normalisation, index vs score**
> - `docs/signals.md` — signal arrays, weighting, geospatial association, bot detection
> - `docs/entities.md` — entity types, validation, tag metadata
> - `docs/filters.md` — output filtering, OR-by-default behaviour
> - `docs/faqs.md` — affinity FAQ, data sources, ODbL attribution
> - `recipes/recipes.md` — seven code recipes (bodies are interactive; only request URLs are static)
>
> **Not yet studied:** `openapi-schema.json` (the repo's complete v2 spec — larger than the Insights
> Deep Dive OpenAPI), `analysis-compare`, `get-trending`, `get-trends-category`, `get-trends-entity`,
> `heatmaps-use-case`, `insights-with-location-use-case`, `legacy-insights-parameter-mapping`,
> `methodologies`, `data-foundation`, `processing-methodology`, `representative-data-and-patterns`,
> `glossary`, `audiences`, `insights-platform`, `generating-insights`, `navigating-the-insights-ui`.
> None of these gate P0. `openapi-schema.json` is the one worth pulling before the scorer is written.

---

## 1. Environment & Authentication

### Base URL — the single most important fact

```
https://hackathon.api.qloo.com
```

Hackathon API keys **only** work against this host. They **do not** work against:

- `https://staging.api.qloo.com`
- `https://api.qloo.com`

> Using the wrong base URL is the **most common cause of 401 errors**. Nearly every curl example in
> Qloo's docs uses `api.qloo.com` or `staging.api.qloo.com` — the host must be rewritten in all of
> them before use.

The base URL alone is not a valid endpoint; a path must always be appended.

### Auth header

```
X-Api-Key: <key>
```

- **Not** `Authorization: Bearer <key>` → returns `401 "No API key found in request"`.
- **Not** a query parameter.
- Header name is case-insensitive in practice; docs show both `X-Api-Key` and `x-api-key`.

### Key provisioning

- Requested via the API key form linked from the hackathon guide; keys are provisioned **manually**
  and emailed, typically within a few business days. Check spam.
- Keys stay active through the end of the judging period, then are deactivated.
- Rate limits and a monthly quota apply, set "high enough for typical hackathon projects". Limits can
  be raised per-user by posting in `#api-help` on the Qloo Hackathon Discord
  (https://discord.gg/rF9PKsD5Q7).

### Caching & data handling — ⚠️ binding constraint

> "Private server-side caching is fine and there is no time limit on how long you can keep cached
> responses. **Do not store Qloo response data in a public repository** — that makes the data
> publicly accessible outside the terms of your API key."

Consequences for this repo:

1. Server-side caching of Qloo responses is **encouraged** (and required by 02 §32).
2. Cached responses must be **git-ignored** — no committed JSON fixtures of real Qloo output.
3. Therefore any fallback/demo fixture (02 §34) must be **synthetic**, not a captured Qloo response.

### Other API-level facts

- **No response field filtering.** The full response is always returned; extract what is needed
  client-side. Verbose fields such as `akas` cannot be suppressed.
- **Unsupported parameters are silently ignored** — they do not error. See [§11](#11-the-silent-parameter-trap).

---

## 2. Endpoint Inventory

### Primary

| Method | Path | Purpose | Notes |
| --- | --- | --- | --- |
| `GET` | `/v2/insights` | **Main engine.** Recommendations, taste analysis, demographics | Query-string params. `filter.type` always required. |
| `GET` | `/search` | Resolve entity **name → Qloo ID** | Response `results` is a **flat array** |
| `GET` | `/entities` | Entity lookup **by ID** (or external IDs) | Param `entity_ids` |
| `GET` | `/v2/tags` | Tag search → valid tag IDs | |
| `GET` | `/v2/tags/types` | Tag types supported per entity category | Use to choose good tag namespaces |
| `GET` | `/v2/audiences` | Audience IDs for `signal.demographics.audiences` | **Flagged `deprecated: true`** in its own OpenAPI |
| `GET` | `/v2/audiences/types` | List audience types | |

### Secondary (P2 for CreatorsDNA — see 02 §5)

| Path | Purpose |
| --- | --- |
| `/v2/analysis/compare` | Compare two groups of entities |
| `/v2/trending` | Time-series popularity trends for an entity |

### Forbidden / invalid

- ❌ `/recommendations` and `/recs` — **legacy, not supported for the hackathon.** Explicitly called
  out in the hackathon guide.
- ❌ `/v2/insights/search` — `/search` and `/v2/insights` are separate endpoints; do not combine paths.

### GET vs POST on `/v2/insights`

The hackathon guide states plainly:

> "`/v2/insights` is a GET request. Parameters go in the query string, not a JSON body. Sending a
> POST request with a JSON body will fail even if your parameters are otherwise correct."

Yet several parameters are documented as **POST-only** (`signal.interests.entities.query`,
`filter.exclude.entities.query`, and the weighted object-array forms of `signal.interests.entities` /
`signal.interests.tags`).

**Decision: use GET for everything in v1.** It covers all parameters CreatorsDNA needs. Per-entity and
per-tag weights are the only casualty, and 02 §15's scoring model does not require them.
**[VERIFY]** whether POST works at all on the hackathon host before relying on it.

---

## 3. Entity Types — and a Naming Trap

### `filter.type` values for `/v2/insights`

Per the Insights OpenAPI enum:

```
urn:entity:artist
urn:entity:book
urn:entity:brand
urn:entity:locality      (partially supported — signal.interests.entities only)
urn:entity:movie
urn:entity:person
urn:entity:place
urn:entity:podcast
urn:entity:tv_show
urn:entity:videogame     ← see trap below
urn:heatmap
urn:entity:audience      (deprecated — do not use)
```

Plus, documented on the use-case pages but **absent from that enum**:

```
urn:tag            → Taste Analysis (02 §9)
urn:demographics   → Demographic Insights
```

### ⚠️ `videogame` vs `video_game`

| Source | Value |
| --- | --- |
| Insights OpenAPI enum | `urn:entity:videogame` |
| `/search` OpenAPI enum | `urn:entity:videogame` |
| Hackathon Developer Guide | `urn:entity:video_game` |
| Entity Type Parameter Guide ("Video Game" section) | implies `urn:entity:video_game` |

**[VERIFY]** which the hackathon host accepts. An unsupported type returns
`403 "You do not have permission to access urn:entity:..."`. Test both before shipping gaming
creators — gaming is one of 02 §41's five required test archetypes.

### `/search` `types` ≠ `/v2/insights` `filter.type`

The hackathon guide warns these lists differ. `/search` additionally accepts **search-only legacy
types** that are **not** valid in Insights:

```
urn:entity:actor
urn:entity:album
urn:entity:author
urn:entity:director
urn:entity:locality
```

`urn:entity:audience` is accepted by `/search` but deprecated.

**Implication:** an entity resolved via `/search` may carry a type that cannot be used as a
`filter.type`. CreatorsDNA must map search-result types onto the Insights-supported set, and must not
assume a 1:1 relationship.

### Common 403 mistakes called out in the docs

| Want | ❌ Wrong | ✅ Correct |
| --- | --- | --- |
| Music | `urn:entity:music` | `urn:entity:artist` |
| Food & drink | `urn:entity:food_and_drink` | `urn:entity:place` or `urn:entity:brand` |
| Actors / authors / directors | deprecated per-type | `urn:entity:person` |

### Types CreatorsDNA will use

| Role | Types |
| --- | --- |
| **Creator input signals** (02 §6) | `artist`, `brand`, `movie`, `tv_show`, `videogame`, `podcast`, `book`, `person` |
| **Opportunity results** | `brand` (primary) |
| **Taste DNA** | `urn:tag` results, plus cross-category entity results grouped by `subtype` |
| **Audience validation** | `urn:demographics` |
| **Future** (01 §12) | `destination`, `place` |

---

## 4. `/v2/insights` — Parameter Reference

`filter.type` is **always required**, plus **at least one valid signal or filter**.

### Signals — what the creator brings

| Parameter | Type | Notes |
| --- | --- | --- |
| `signal.interests.entities` | comma-separated UUIDs | **The core CreatorsDNA input.** "Entity IDs that influence the affinity score." |
| `signal.interests.entities.weight` | number ≥0, or `very_low`…`very_high` | Global influence of entity signals |
| `signal.interests.entities.include` | comma-separated UUIDs | Force entities to contribute even if core signal logic wouldn't infer them |
| `signal.interests.entities.query` | **POST only** | `[{name, address, resolve_to: place\|brand\|both}]` |
| `signal.interests.tags` | comma-separated tag IDs | Must be **real tag IDs** from `/v2/tags`, not freeform strings |
| `signal.interests.tags.weight` | number ≥0 or weight string | |
| `operator.signal.interests.tags` | `union` \| `intersection` | `union` = results containing ≥1 tag, scored by highest-affinity tag. `intersection` (or empty) = results containing **all** tags, affinity merged |
| `signal.demographics.age` | comma-separated | `24_and_younger` \| `25_to_29` \| `30_to_34` \| `35_to_44` \| `45_to_54` \| `55_and_older` |
| `signal.demographics.age.weight` | | |
| `signal.demographics.gender` | `male` \| `female` | |
| `signal.demographics.gender.weight` | | |
| `signal.demographics.audiences` | comma-separated audience IDs | IDs from `/v2/audiences`. Invalid values → `"at least one valid signal or filter is required"` |
| `signal.demographics.audiences.weight` | | |
| `signal.location` | WKT or locality UUID | `POINT(lon lat)` — **longitude first**. Or a `urn:entity:locality` Qloo ID |
| `signal.location.query` | string | Fuzzy, case-insensitive natural language ("New York City", "The Big Apple"). If nothing matches → **400**. Response includes `query.locality.signal` |
| `signal.location.radius` | integer metres, ≤800000 | Docs **discourage** it — overrides dynamic density discovery. Ignored if a UUID or POLYGON is passed |
| `signal.location.weight` | | |

### Filters — what to return

| Parameter | Notes |
| --- | --- |
| `filter.type` | **Required.** See §3 |
| `filter.results.entities` | Comma-separated entity IDs. *"Often used to assess the affinity of an entity towards input."* → **the key parameter for scoring CreatorsDNA's curated brand registry.** See §8 |
| `filter.results.tags` | Comma-separated tag IDs. Same idea for tags → **the key parameter for scoring Taste DNA tags.** See §8 |
| `filter.tags` | Restrict results to entities carrying these tags |
| `operator.filter.tags` | `intersection` \| `union` (default `union`) |
| `filter.exclude.entities` / `filter.exclude.tags` | Remove from results (+ `operator.exclude.tags`) |
| `filter.parents.types` | Restrict to tags associated with given entity types |
| `filter.popularity.min` / `.max` | 0–1 popularity percentile |
| `filter.external.exists` | e.g. `external.resy`, `external.michelin` (+ operator) |
| `filter.release_year.min/max`, `filter.release_date.min/max` | movie / tv_show |
| `filter.content_rating`, `filter.rating.min/max`, `filter.release_country` | movie / tv_show |
| `filter.publication_year.min/max` | book |
| `filter.date_of_birth.*`, `filter.date_of_death.*`, `filter.gender` | person |
| `filter.location*`, `filter.geocode.*`, `filter.price_*`, `filter.hotel_class.*`, `filter.hours`, `filter.address`, `filter.references_brand`, `bias.quality` | place / destination |
| `filter.results.entities.query` | Resolve a name to a result filter |

### Output & ranking controls

| Parameter | Values / default | Relevance |
| --- | --- | --- |
| `take` | default **20**, max **50** | Hard ceiling per call → pagination or multiple calls needed |
| `page` | 1–100, default 1 | **Recommended** pagination mechanism |
| `offset` | integer | Supported but "less commonly used than `page`" |
| `sort_by` | `affinity` \| `distance` \| `rating` \| `quality` | `distance` requires `filter.location`; `quality` is place-only |
| `feature.explainability` | boolean, default `false` | **See §5 — central to 02 §11/§37** |
| `bias.trends` | `off`,`very_low`,`low`,`mid`,`medium`,`high`,`very_high`; default `medium` | How strongly trends reshape results. Consider `low`/`off` for stable demo output |
| `bias.content_based` | 0–1, default 0.5 | "Strength content-based metadata has on the recommendations affinity score" |
| `diversify.by` | `properties.geocode.city` \| `properties.geocode.metro` \| `subtype` | `subtype` is **`urn:tag` only** — caps results per tag subtype. Useful to stop Taste DNA being dominated by one namespace |
| `diversify.take` | integer ≥1 | Per-group cap |
| `backfill.cross_domain.take` | default 20, max 20 | **"Cross-domain backfill results appended when primary results are insufficient."** → directly serves 01 §9 *Unexpected Affinities*. See §8 |
| `backfill.content_based.take` | default 10, max 10 | Content-similarity backfill when other signals unavailable |
| `output.heatmap.boundary`, `heatmap.dimensions` | | heatmap only — not used in v1 |

---

## 5. Explainability — available, and central to the product

02 §11 and §37 make explainability a **P0 pillar** ("Why this brand?"). Good news: it exists.

```
feature.explainability=true
```

**Applicable `filter.type`s** (per Parameter Reference): Artist, Book, **Brand**, Destination, Movie,
Person, Place, Podcast, TV Show, Video Game. Not documented for `urn:tag` or `urn:demographics`.

### What it returns

**Per recommendation** — each result gains a `query.explainability` section showing which input
entities (e.g. from `signal.interests.entities`) contributed to that recommendation, and by how much:

- scores **normalized 0–1**
- entities scoring **≥ 0.1 are always included**
- lower-impact entities **may be omitted** to reduce response size

**Aggregate** — a top-level `query.explainability` object giving the **average influence of each input
entity** across top-N result subsets (top 3, top 5, top 10, all).

**Failure mode** — if explainability cannot be computed, a warning appears at
`query.explainability.warning` and results still return normally. Must be handled, not assumed.

### Why this matters for CreatorsDNA

This is the raw material for 02 §11's target UI:

```
Nike — Strong match because:
  creator signal:   Formula 1     (0.42)
  creator signal:   Travis Scott  (0.31)
  creator signal:   Nike          (0.18)
```

It converts "why this brand?" from a template guess into **Qloo-attributed evidence**, which is
exactly what 01 §20 demands ("make it clear Qloo is doing meaningful work") and what 02 §16 forbids
faking.

### ⚠️ Caveats

1. `feature.explainability` appears in the Parameter Reference and the Insights OpenAPI, but is
   **missing from every table in the Entity Type Parameter Guide**. Since unsupported params are
   silently ignored (§11), it could be a no-op. **[VERIFY]** it actually populates `query.explainability`
   on the hackathon host for `filter.type=urn:entity:brand`.
2. It may be **key-entitlement gated** (02 §11 says "if supported by the API key/account").
   **[VERIFY]** with the real key.
3. Design a **deterministic fallback** for "Why this fits" that works from our own scoring dimensions
   (02 §15) alone, so the feature degrades gracefully rather than breaking if explainability is
   unavailable. 02 §37: "Do not make unsupported claims if explainability is unavailable."

---

## 6. Response Shapes

### `/v2/insights` — entity results

OpenAPI declares `{ success, results: { entities: [], duration } }` with **untyped items** (`{}`), so
the real shape must come from live calls. From the documented Recommendation Insights example:

```jsonc
{
  "success": true,
  "results": {
    "entities": [
      {
        "name": "Everything Everywhere All at Once",
        "entity_id": "F0D354AA-BA7E-49D2-8ABA-9A8250F5C852",
        "type": "urn:entity",
        "subtype": "urn:entity:movie",
        "disambiguation": "2022, Daniel Scheinert, Daniel Kwan",
        "popularity": 0.9984116946335868,        // 0–1 percentile
        "properties": {
          "description": "A middle-aged Chinese immigrant is swept up into…",
          "image": { "url": "https://staging.images.qloo.com/i/…-420x-outside.jpg" },
          "release_year": 2022,
          "release_date": "2022-04-08",
          "content_rating": "R",
          "duration": 139,
          "production_companies": ["A24", "AGBO", "IAC Films"],
          "release_country": ["United States"],
          "websites": ["https://a24films.com/films/…", "https://www.instagram.com/…"],
          "akas": [ /* verbose, multilingual, cannot be suppressed */ ],
          "short_descriptions": [ /* verbose, multilingual */ ]
        },
        "tags": [
          { "id": "urn:tag:keyword:media:multiverse", "name": "Multiverse", "type": "urn:tag:keyword:media" },
          { "id": "urn:tag:streaming_service:media:neon_tv", "name": "Neon Tv", "type": "urn:tag:streaming_service:media" }
        ],
        "query": {
          "measurements": { "audience_growth": -0.04072975141723856 }
          // + "affinity" when signals are supplied        [VERIFY]
          // + "explainability" when feature.explainability=true
        },
        "external": {
          "instagram":  [{ "id": "everythingeverywheremovie" }],
          "twitter":    [{ "id": "allatoncemovie" }],
          "wikidata":   [{ "id": "q83808444" }],
          "imdb":         [{ "id": "tt6710474", "user_rating": 7.8, "user_rating_count": 549113 }],
          "metacritic":   [{ "id": "…", "critic_rating": 81, "user_rating": 7.8 }],
          "rottentomatoes":[{ "id": "…", "user_rating": "89", "user_rating_count": "2500" }],
          "letterboxd":   [{ "id": "…" }]
        }
      }
    ]
  },
  "duration": 34
}
```

#### 💡 Significant finding for the brand registry

`properties.websites`, `external.instagram`, `external.twitter`, `properties.image.url` and
`properties.description` are **real, Qloo-sourced, verifiable brand data**.

02 §21 requires the brand registry to contain only verifiable information and forbids invented
contacts. Rather than hand-curating websites and socials for 50–200 brands, CreatorsDNA can:

- hand-curate only what Qloo **cannot** supply — `creator_partnership_url`, `affiliate_url`,
  `ambassador_url`, `contact_route`, `verification_date` (the partnership routes of 02 §22)
- source `name`, `category`, `website`, `region`, imagery and description **from Qloo at runtime**

This shrinks the manual dataset, keeps it honest, and makes it far easier to expand (01 §16).
**[VERIFY]** the image host on the hackathon environment — the example uses `staging.images.qloo.com`,
which may not be reachable or licensed for our use.

#### Note on `query`

In the example above the request used **only filters** (`filter.tags`, `filter.release_year.min`) and
no signals, so `query` carries `measurements` but no affinity. When `signal.interests.*` is supplied,
`query.affinity` is expected. **[VERIFY]** its exact key name, range, and whether it is 0–1 or signed.

### `/v2/insights` — tag results (`filter.type=urn:tag`)

```jsonc
{
  "success": true,
  "results": {
    "tags": [
      {
        "tag_id": "urn:tag:keyword:media:brady_bunch",
        "tag_value": "urn:tag:keyword:media:brady_bunch",
        "name": "Brady Bunch",
        "subtype": "urn:tag:keyword:media",
        "types": ["urn:entity:tv_show", "urn:entity:movie", "urn:entity:actor", "…"],
        "query": {}                     // ⚠️ EMPTY in the documented example
      }
    ]
  },
  "duration": 25
}
```

**⚠️ Two problems with using this for Taste DNA:**

1. **No scores.** The documented response returns `"query": {}` — no affinity values. 02 §17's
   algorithm requires "rank by relevance/affinity". If tag insights genuinely return unscored tags,
   ranking must come from elsewhere (see §8).
2. **Wrong granularity.** The example uses `filter.tag.types=urn:tag:keyword:media`, which returns
   *plot keywords* — the documented sample includes "Mining Accident", "Anthropomorphic Elephant",
   "Gasoline Fire", "Woman Farting", "Eiffel Tower Destroyed". These are **not** cultural taste
   categories. Nothing resembling 01 §8's "Sneakers / Streetwear / Hip-hop / Motorsport" will come
   out of a media-keyword namespace.

   **Tag namespace selection is therefore a core product decision, not an implementation detail.**
   Call `/v2/tags/types` to enumerate namespaces per entity category, and prefer genre / style /
   interest namespaces (`urn:tag:genre:*`, `urn:tag:style:qloo:*`, audience namespaces such as
   `urn:audience:hobbies_and_interests`) over `urn:tag:keyword:*`.
   **[VERIFY]** by enumerating tag types live before designing the Taste DNA taxonomy.

### `/v2/insights` — demographic results (`filter.type=urn:demographics`)

```jsonc
{
  "success": true,
  "results": {
    "demographics": [
      {
        "entity_id": "urn:tag:genre:media:action",
        "query": {
          "age": {
            "24_and_younger": 0,     "25_to_29": 0.43,  "30_to_34": 0.23,
            "35_to_44": -0.02,       "45_to_54": -0.28, "55_and_older": -0.17
          },
          "gender": { "male": 0.08, "female": -0.08 }
        }
      }
    ]
  },
  "duration": 77
}
```

- Required: `filter.type=urn:demographics` **plus** one of `signal.interests.entities` or
  `signal.interests.tags`. Both may be supplied to compare an entity against a category.
- **Scores are signed affinities, not 0–1.** Positive = stronger-than-average alignment for that
  group; negative = lower affinity. Our scoring layer must normalise these before they feed the 20%
  Audience/Demographic dimension (02 §15) — and must not present a negative value as a percentage.
- One demographics block is returned **per input signal**, keyed by `entity_id` (which may hold a tag
  URN rather than a UUID).
- This is **modelled cultural demography around an entity/tag** — it is *not* the creator's actual
  audience. 01 §37's honesty rules apply in full: label it "Qloo-derived", never "your followers".

### `/search`

```jsonc
{ "success": true, "duration": 0.1, "results": [ /* flat array of entities */ ] }
```

Note `results` is a **flat array** here, unlike `/v2/insights` where it is `results.entities`. The two
endpoints must not be handled by one shared response parser without accounting for this.

| Parameter | Values |
| --- | --- |
| `query` | free text, e.g. `Beyonce` |
| `types` | array, comma-separated — see §3 (differs from `filter.type`) |
| `sort_by` | `match` (default) \| `distance` \| `popularity` |
| `take` | integer, **exclusiveMaximum 200** |
| `page` | 1–100, default 1 |
| `filter.location` | `lat,lon` **or** WKT **or** a Qloo entity UUID |
| `filter.radius` | miles, default 10, max 100 — geolocated categories only |
| `filter.tags` | array of tag IDs |
| `filter.popularity` | minimum popularity, 0–1 |
| `filter.rating` | minimum business rating, 0–5 |
| `filter.address` | partial string match, supports comma-separated terms |
| `filter.exists` | pattern `^external\.\w+$`, e.g. `external.resy` |
| `operator.filter.tags` | `intersection` \| `union` (default `union`) |

Error responses use `{ code, reason, message }`. `404` = no results, `429` = rate limit.

02 §7 requires that multiple search hits be **presented to the user as selectable results** rather
than silently guessed — `/search` returning a ranked array with `disambiguation` supports this well.
Use `sort_by=match` and show `name` + `subtype` + `disambiguation` to disambiguate.

### `/entities`

Lookup by `entity_ids` (array of UUIDs) **or** by external ID namespaces:
`external.facebook.ids`, `external.instagram.ids`, `external.imdb.ids`, `external.igdb.ids`,
`external.itunes.ids`, `external.goodreads.ids`, `external.goodreads_author.ids`,
`external.isbn10.ids`, `external.isbn13.ids`, …

Useful for hydrating full metadata for a chosen entity, and for resolving a brand from a known social
handle. `400 "entity_ids must be specified."` if none given.

### `/v2/tags`

| Parameter | Notes |
| --- | --- |
| `filter.query` | partial string search on tag/audience name |
| `filter.tag.types` | comma-separated tag types, **exact match**. Enumerate via `/v2/tags/types` |
| `filter.results.tags` | comma-separated tag IDs — *"assess the affinity of a tag towards input"* → scoring hook, see §8 |
| `filter.parents.types` | ⚠️ documented with an **audience** enum (`urn:audience:*`), not entity types — likely a docs error. **[VERIFY]** |
| `filter.popularity.min/max` | 0–1 |
| `feature.typo_tolerance` | boolean, default false |
| `feature.semantic_search` | boolean, default false, **beta** — semantic similarity on `filter.query`. Potentially valuable for mapping a creator's free-text interest to the right tag namespace. **[VERIFY]** availability |
| `page`, `take` | take default 20, max 50 |

Response: `{ success, duration, results: { tags: [] } }`.

### `/v2/audiences`

Params: `filter.query`, `filter.parents.types`, `filter.audience.types`, `filter.results.audiences`,
`filter.popularity.min/max`, `page`, `take`. Response: `results.entities[]`.

Audience **type** URNs (used as `filter.parents.types`):

```
urn:audience:communities
urn:audience:global_issues
urn:audience:hobbies_and_interests      ← most relevant to CreatorsDNA
urn:audience:investing_interests
urn:audience:leisure                    ← relevant
urn:audience:life_stage
urn:audience:lifestyle_preferences_beliefs  ← relevant
urn:audience:political_preferences
urn:audience:professional_area
urn:audience:spending_habits            ← relevant to brand partnership fit
```

⚠️ This endpoint is marked `"deprecated": true` in its own OpenAPI definition, yet the Parameter
Reference still directs you to it for `signal.demographics.audiences` IDs. **[VERIFY]** it responds on
the hackathon host. Given the deprecation flag, **treat audiences as optional** in v1 — 02 §39 already
says demographics must never be mandatory.

---

## 7. Error Handling Matrix

Maps to 01 §44 and 02 §33. Every case needs a friendly product message; never surface raw errors.

| Status | Cause | CreatorsDNA response |
| --- | --- | --- |
| `401` | Wrong base URL (**most common**), or key not in `X-Api-Key` | Config/deploy error — log server-side, show generic failure. Never expose the key or host in UI |
| `403` | Unsupported `filter.type` / entity type not permitted | Fall back to a supported type; log. Likely the `videogame` trap |
| `404` | Missing endpoint path, or no results from `/search` | "We couldn't find that. Try another name." |
| `400` | No valid signal or filter; invalid tag/audience IDs; `signal.location.query` matched no locality | Validate inputs **before** calling. Message: "We couldn't complete the cultural analysis right now. Please try again." |
| `429` | Rate limit | Back off and retry once; else friendly retry message. Drives the caching requirement |
| `5xx` | Qloo server error | Friendly retry message |
| Network error | Timeout / DNS / CORS | Friendly retry message |
| **`200` + empty `entities`** | **(a)** params silently ignored because invalid for that `filter.type`; **(b)** no data for that entity/region in the hackathon environment | Hardest case — indistinguishable from outside. Distinguish by validating params against an allow-list first, then treat as "no data". 01 §44 lists "empty result" explicitly |

Error body shape: `{ code, reason, message }`.

---

## 8. Recommended Call Architecture for CreatorsDNA

Concrete mapping from 01 §19 / 02 §14 onto real endpoints. All calls server-side (02 §12, §13).

### Step 1 — Resolve creator selections (`/search`)

```
GET /search?query=<name>&types=urn:entity:artist,urn:entity:brand,urn:entity:movie,…&sort_by=match&take=10
```

Present multiple hits to the user (02 §7). Persist per selection: `name`, `entity_id`, `subtype`,
`disambiguation`, `properties.image.url` (01 §18). Debounce the input (02 §32) and cache by query.

### Step 2 — Build the Taste DNA (two complementary calls)

**(a) Tag-level taste.** 02 §9 assumes `filter.type=urn:tag` + `signal.interests.entities`:

```
GET /v2/insights?filter.type=urn:tag
                &signal.interests.entities=<id1,id2,…>
                &filter.tag.types=<curated cultural namespaces>
                &diversify.by=subtype&diversify.take=<n>
                &take=50
```

⚠️ The Entity Type Parameter Guide's Tag table does **not** list `signal.interests.entities` or
`filter.tag.types` as supported — only `filter.type`, `diversify.by`, `diversify.take`, `offset`,
`take`. The Taste Analysis page says the opposite. **[VERIFY]** which is true. If signals are ignored,
this call returns generic popular tags and is worthless for a personalised Taste DNA.

**(b) Score the tags.** Because (a) may return unscored tags (`query: {}`), obtain affinity via
`filter.results.tags`:

```
GET /v2/insights?filter.type=urn:tag
                &signal.interests.entities=<creator ids>
                &filter.results.tags=<candidate tag ids>
                &take=50
```

`filter.results.tags` is documented as "assess the affinity of a tag towards input" — this is the
scoring hook 02 §17's "rank by relevance/affinity" needs. **[VERIFY]** the returned score key.

**(c) Fallback / complement — entity-derived taste.** Cross-category **entity** results reliably
carry `popularity`, `tags[]`, and (with signals) `query.affinity`. Grouping those by `subtype` and
harvesting their `tags[]` gives a scored, personalised taste profile even if tag-insights underdeliver:

```
GET /v2/insights?filter.type=urn:entity:artist&signal.interests.entities=<ids>&take=50
GET /v2/insights?filter.type=urn:entity:movie &signal.interests.entities=<ids>&take=50
…
```

Then normalise → dedupe → group by category → rank → split explicit vs discovered (02 §17).
Budget: each `filter.type` is a separate call, and `take` caps at 50 — this is the main quota cost.
Cache aggressively.

### Step 3 — Unexpected affinities

01 §9 / 02 §18. Two deterministic sources:

1. **Our own comparison** — discovered signals not present in the creator's explicit selections, above
   an affinity threshold, in a culturally meaningful category, and distant from the declared niche
   (02 §18's four criteria). This is the primary mechanism and needs no extra Qloo feature.
2. **`backfill.cross_domain.take`** — Qloo natively appends cross-domain results when in-domain
   results are insufficient. Results arriving via cross-domain backfill are a strong, *API-sourced*
   signal of "beyond your niche". **[VERIFY]** whether the response flags which results came from
   backfill; if not, this can only be inferred.

### Step 4 — Untapped opportunities

Purely CreatorsDNA-side (02 §19): compare declared content categories against Step 2 affinity.
**No Qloo call required.** Deterministic gap = high affinity + low coverage.

### Step 5 — Brand opportunities

**(a) Discovery** — let Qloo propose brands:

```
GET /v2/insights?filter.type=urn:entity:brand
                &signal.interests.entities=<creator ids>
                &signal.demographics.age=<…>&signal.demographics.gender=<…>   (optional, 02 §39)
                &signal.location.query=<creator location>                      (optional, 02 §40)
                &feature.explainability=true
                &sort_by=affinity&take=50
```

**(b) Scoring the curated registry** — the more reliable path for our own verified brands:

```
GET /v2/insights?filter.type=urn:entity:brand
                &signal.interests.entities=<creator ids>
                &filter.results.entities=<registry brand ids, comma-separated>
                &feature.explainability=true
                &take=50
```

`filter.results.entities` "assesses the affinity of an entity towards input", so this returns an
affinity for **each specific brand we care about** rather than hoping it appears in a top-50 list.
This is the strongest available basis for the 45% Taste Fit weight (02 §15).
**[VERIFY]** that `filter.results.entities` does not merely *restrict* without scoring, and check
whether >50 registry brands requires paging.

### Step 6 — Demographic validation (optional)

```
GET /v2/insights?filter.type=urn:demographics&signal.interests.entities=<top signals>
```

Only if the creator supplied demographics (02 §10, §39 — never mandatory). Normalise the signed
scores before feeding the 20% Audience dimension.

### Step 7 — Explainability → "Why this brand?"

From `query.explainability` per recommendation plus the aggregate top-level object (§5). Map each
contributing `signal.interests.entities` ID back to the creator's original selection to render
02 §11's "creator signal: Formula 1" list. Fall back to our own score dimensions if unavailable.

### Call budget

With `take ≤ 50` and a monthly quota, the per-analysis cost is roughly:
1 × `/search` per selection + 1 × tag insights + 1 × tag scoring + N × entity-category calls +
1–2 × brand calls + 0–1 × demographics. **Cache every response server-side, keyed by the sorted
parameter set, and deduplicate in-flight requests** (02 §32). Never commit cached payloads (§1).

---

## 9. Parameter Validity by `filter.type`

The Entity Type Parameter Guide defines an allow-list per type. **Params outside the list are silently
ignored.** Abbreviated to what CreatorsDNA needs — all ten entity types support the same core set:

**Common to artist / book / brand / movie / person / place / podcast / tv_show / video_game:**

```
filter.type                      (required)
signal.interests.entities
signal.interests.tags
signal.demographics.age / .gender / .audiences (+ .weight each)
filter.tags / operator.filter.tags
filter.exclude.entities / filter.exclude.tags / operator.exclude.tags
filter.results.entities / filter.results.entities.query
filter.parents.types
filter.popularity.min / .max
filter.external.exists / operator.filter.external.exists
bias.trends
offset / take
```

**Notable exceptions:**

| Type | Difference |
| --- | --- |
| `destination` | `signal.interests.entities` is **Required** (not optional). Adds `filter.geocode.*`, `filter.location*` |
| `place` | Adds `bias.quality`, `sort_by`, `filter.location*`, `filter.geocode.*`, price/hotel/rating/resy/tripadvisor filters, `filter.references_brand`, `filter.hours`, `filter.address` |
| `movie` | Adds `filter.release_year.*`, `filter.release_country`, `filter.content_rating`, `filter.rating.*` |
| `tv_show` | Adds `filter.release_year.*`, `filter.finale_year.*`, `filter.latest_known_year.*`, `filter.release_country`, `filter.content_rating`, `filter.rating.*` |
| `book` | Adds `filter.publication_year.*` |
| `person` | Adds `filter.gender`, `filter.date_of_birth.*`, `filter.date_of_death.*` |
| **`tag`** | ⚠️ Lists **only** `filter.type`, `diversify.by`, `diversify.take`, `offset`, `take`. **No signals at all.** Contradicts the Taste Analysis page — see §12 |
| `heatmap` | Geospatial only; not used in v1 |

⚠️ `feature.explainability`, `backfill.*`, `bias.content_based`, `signal.location*`, `sort_by`,
`page`, `diversify.*` and the `.weight` variants **do not appear in these per-type tables at all**,
despite being documented in the Parameter Reference and the Insights OpenAPI. The two Qloo references
are not in sync. **Treat the Entity Type Parameter Guide as necessary-but-not-sufficient**, and verify
anything load-bearing against live behaviour.

---

## 10. Full Insights Parameter List (from the live OpenAPI)

Complete enumeration, for building a validation allow-list:

```
backfill.content_based.take        filter.geocode.admin2_region       filter.results.entities.query
backfill.cross_domain.take         filter.geocode.country_code        filter.results.tags
bias.content_based                 filter.geocode.name                filter.tags
bias.quality                       filter.hotel_class.max/.min        filter.type
bias.trends                        filter.hours                       heatmap.dimensions
diversify.by                       filter.latest_known_year.max/.min  offset
diversify.take                     filter.location                    operator.filter.exclude.tags
feature.explainability             filter.location.geohash            operator.filter.external.exists
filter.address                     filter.location.metro              operator.filter.references_brand
filter.content_rating              filter.location.query              operator.filter.release_country
filter.date_of_birth.max/.min      filter.location.radius             operator.filter.tags
filter.date_of_death.max/.min      filter.parents.types               operator.signal.interests.tags
filter.dimensions.hotel_class      filter.popularity.max/.min         output.heatmap.boundary
filter.dimensions.price_level      filter.price_level.max/.min        page
filter.entities.query              filter.price_range.from/.to        signal.demographics.age(+.weight)
filter.exclude.entities            filter.properties.business_rating  signal.demographics.audiences(+.weight)
filter.exclude.entities.query      filter.properties.resy.rating      signal.demographics.gender(+.weight)
filter.exclude.location(.query)    filter.publication_year.max/.min   signal.interests.entities(+.weight)
filter.exclude.location.geohash    filter.rating.max/.min             signal.interests.entities.include
filter.exclude.location.radius     filter.references_brand            signal.interests.entities.query
filter.exclude.tags                filter.release_country             signal.interests.tags(+.weight)
filter.exists                      filter.release_date.max/.min       signal.location(+.weight)
filter.external.exists             filter.release_year.max/.min       signal.location.query
filter.external.resy.*             filter.resy.rating_count.*         signal.location.radius
filter.external.tripadvisor.*      filter.finale_year.max/.min        sort_by
filter.gender                                                         take
```

---

## 11. The Silent Parameter Trap

> "Use only documented Qloo parameters. Custom, unsupported, or deprecated parameters will not work,
> and **invalid parameters are silently ignored rather than returning an error**. If you are getting
> empty results with no error, verify your parameters against the Entity Type Parameter Guide before
> assuming a data issue."

This is the single most dangerous behaviour for CreatorsDNA, because the failure mode is **plausible-
looking but wrong output**, not an error:

- Pass `signal.interests.entities` with `filter.type=urn:tag` and it may be ignored → we get generic
  popular tags and present them as a *personalised* Taste DNA. **Directly violates 02 §16 (no fake
  scoring) and 01 §50 (no fake Qloo results) while returning HTTP 200.**
- Pass `feature.explainability=true` and it may be ignored → "Why this brand?" silently renders empty.
- Pass `urn:entity:video_game` when the host wants `videogame` → 403, which at least is loud.

### Required mitigation

1. Maintain an explicit **allow-list of parameters per `filter.type`** in code, and validate every
   outgoing request against it. Never let a caller pass an arbitrary param through.
2. **Assert that personalisation actually happened.** If a Taste DNA request returns results identical
   to an unpersonalised baseline, treat it as a failure — do not render it as the creator's profile.
3. Log the full outgoing parameter set server-side for every call, so a wrong-but-200 response is
   diagnosable.
4. Cover this in the 02 §41 archetype tests: five different creators **must** produce five different
   Taste DNAs. Identical output = silent-ignore bug, not coincidence.

---

## 12. Documentation Contradictions — Must Verify Live

Qloo's docs disagree with themselves in the following places. Each is a real risk to a P0 feature.

| # | Contradiction | Sources | Risk | Action |
| --- | --- | --- | --- | --- |
| 1 | `urn:entity:videogame` vs `urn:entity:video_game` | Insights + `/search` OpenAPI enums **vs** Hackathon Guide + Entity Type Guide | 403 on a required test archetype (gaming) | Test both strings |
| 2 | Does `filter.type=urn:tag` accept `signal.interests.entities`? | Entity Type Guide says **no** (only 5 params) **vs** Taste Analysis page says **yes, and one signal is required** | Personalised Taste DNA silently becomes generic → breaches 02 §16 | Compare a signalled call against a baseline call; assert results differ |
| 3 | `urn:tag` / `urn:demographics` absent from the `filter.type` enum | Insights OpenAPI **vs** Taste Analysis + Demographics use-case pages | Core P0 features may 403 | Test both directly |
| 4 | `feature.explainability` missing from all Entity Type Guide tables | Parameter Reference + Insights OpenAPI **vs** Entity Type Guide | "Why this brand?" (P0, 02 §11) may be a silent no-op | Check for `query.explainability` in a live brand response |
| 5 | `/v2/audiences` marked `deprecated: true` yet still the documented source of audience IDs | Its own OpenAPI **vs** Parameter Reference | Audience signals may be unavailable | Treat audiences as optional in v1 (02 §39 already does) |
| 6 | `/v2/tags` `filter.parents.types` documents an **audience** enum, not entity types | `/v2/tags` + `/v2/tags/types` OpenAPI | Tag filtering by parent entity type may not work | Likely a docs copy/paste error; test empirically |
| 7 | Tag insights return `"query": {}` — no affinity scores | Taste Analysis response example **vs** *Interpreting Affinity Scores*, which states the Taste Analysis score "represents the relevance of tags to a taste vector" | 02 §17's "rank by relevance/affinity" has no input | Use `filter.results.tags` to score, or derive taste from entity results (§8 Step 2c). Probe both. |
| 8 | All doc examples use `api.qloo.com` / `staging.api.qloo.com` | Every curl sample, including all seven Code Recipes | Guaranteed 401 if copied verbatim | Rewrite host in every call; centralise base URL in config |
| 9 | `/v2/insights` is "GET only, POST will fail" — yet several params are POST-only | Hackathon Guide **vs** Parameter Reference + Insights OpenAPI (`signal.interests.entities.query`: "can only be supplied when using POST") | Per-entity / per-tag weights may be unreachable | **Reduced risk.** Scalar `*.weight` params *are* GET params (§16), which is all the 45/20/15/10/10 model needs. Per-entity weights are the only casualty. Use GET in v1. |
| 10 | `query.affinity` shape never specified | Insights OpenAPI declares entity result items as `{}` | Scoring layer (02 §15) depends on it | **Partly resolved.** The field *name* is confirmed — `heatmap.dimensions` says dimensions "influence the overall `query.affinity` ranking". The **range in JSON is not**: concept docs say 0–100 (§15), heatmap dims say 0–1. Capture the real value on the first live call. |
| 11 | Entity catalogue size | *Entities* concept page says **250 million**; *FAQs* says **500+ Million Entities** | Cosmetic, but do not quote a number in public copy without checking | Avoid citing an entity count in the UI/marketing site |
| 12 | `urn:entity:locality` is in the Insights `filter.type` enum but **absent** from the ten-type entity list | Insights OpenAPI **vs** *Entities* concept page | Unclear whether locality insights are usable | Not needed for CreatorsDNA P0. Ignore unless geographic scope changes. |
| 13 | Age bucket enums disagree three ways | Insights OpenAPI: `35_and_younger \| 36_to_55 \| 55_and_older`; Parameter Reference: `24_and_younger \| 25_to_29 \| 30_to_34 \| 35_to_44 \| 45_to_54 \| 55_and_older`; the demographics response example used a **third** mix | Audience-Demographic component (20% of the score) may silently no-op | Probe `signal.demographics.age` with 6-bucket values and check the response keys |
| 14 | Operator defaults are **asymmetric** | `operator.filter.tags` default = `union`; `operator.signal.interests.tags` default = `intersection` ("or leave this field empty") | Passing several taste tags as a *signal* silently ANDs them → near-empty results | Always set `operator.signal.interests.tags=union` explicitly (§16) |
| 15 | Input limits | *FAQs*: "How many inputs can I insert into any given query? **As many as you would like!**" vs `take` max **50**, `backfill.*.take` max **20** | Over-promising in design; pagination budget wrong | Trust the OpenAPI numeric bounds, not the FAQ prose |
| 16 | Tag quality / namespace | Concept docs promise taste-level tags: *"action-packed"*, *"award-winning"*, *"family-friendly"*, *"Great Shopping"*, *"Outdoor Activities"*, *"Foodie Destination"* — but `/v2/tags` samples in `urn:tag:keyword:media` returned plot keywords (*"Woman Farting"*, *"Gasoline Fire"*) | Taste DNA could be built from junk tags and still be "real data" | Curate an allow-list of tag **types** via `/v2/tags/types`; never accept all namespaces (§17) |
| 17 | Entity ID format | `/search` returns GUIDs (`F0D354AA-BA7E-…`); the Parameter Reference POST example uses **URN slugs** (`urn:entity:movie:inception`) | Unknown whether GET accepts URN slugs, which would remove a `/search` round-trip | Probe both forms; assume GUID-only until proven otherwise |

**Nothing above should be resolved by guessing.** 02 §35 is explicit: *"Do not guess endpoint
formats."* The first implementation task must be a small live probe script that settles the P0-gating
items — see the prioritised probe plan in **doc 04 §6**.

---

## 13. Impact on the Existing Context Documents

Changes this document forces on docs 01 and 02. **Not yet applied** — recorded for decision.

| Ref | Existing statement | Correction / refinement |
| --- | --- | --- |
| 01 §18, 02 §4 | "Qloo public API documentation repository: github.com/qloo/docs-public" and its `openapi-schema.json` | The **hackathon** source of truth is `docs.qloo.com` (hackathon guide + Insights Deep Dive OpenAPI). The GitHub repo was not consulted here and may lag. **Confirm which governs.** |
| 02 §6 | Entity types listed as `artist, book, brand, destination, movie, person, place, podcast, TV show, videogame` | Confirmed, **plus** `urn:heatmap`, `urn:entity:locality` (partial), `urn:entity:audience` (deprecated), `urn:tag`, `urn:demographics`. And the `videogame`/`video_game` spelling is unresolved. |
| 02 §9 | "taste analysis uses the Insights endpoint with `filter.type = urn:tag` and can use entity interests" | **Contested** by the Entity Type Parameter Guide. Also: tag results may be unscored and, in keyword namespaces, far too granular to be cultural tastes. Taste DNA design must not assume this works. |
| 02 §11, §37 | "`feature.explainability=true` … if supported by the API key/account" | **Confirmed to exist**, applies to Brand, and returns 0–1 per-input-entity contributions plus an aggregate. Still needs live + entitlement verification. A deterministic fallback remains necessary. |
| 02 §13 | Routes `/api/qloo/search`, `/api/qloo/taste`, `/api/qloo/recommendations`, `/api/analyze` | Still fine as **our** route names. Note `/recommendations` is banned as a *Qloo* path — avoid confusion by naming our proxy routes after our domain (e.g. `/api/analyze/brands`). |
| 02 §16 | "Scores must be derived from actual data… do not fabricate" | Strengthened: because unsupported params are **silently ignored**, a 200 response can *look* like real personalised data while being generic. Active verification is required, not just good intent. See §11. |
| 02 §21 | Brand registry fields hand-curated | Qloo already returns verifiable `name`, `website` (`properties.websites`), `region`, `description`, `image`, and social handles. Hand-curate **only** the partnership routes Qloo cannot know. Shrinks and strengthens the dataset. |
| 02 §25 | "lightweight local persistence… localStorage acceptable" | Unchanged for creator profiles. But **Qloo responses must not be committed** to a public repo (§1) — add cache paths to `.gitignore`. |
| 02 §32 | "caching where appropriate" | Now **mandatory in practice**: monthly quota + `take ≤ 50` + verbose unsuppressable fields (`akas`) make caching a functional requirement, not an optimisation. |
| 02 §34 | "fallback data… clearly separated in code" | Fallback fixtures must be **synthetic**, never captured Qloo responses, because of the public-repo restriction. |
| 02 §41 | Five test archetypes | Add an explicit assertion that the five produce **five different** Taste DNAs — this is the only reliable detector of the silent-ignore failure mode. |
| **01 §13, 02 §15** | Weighted score: Taste Fit 45% / Audience-Demographic 20% / Content Compatibility 15% / Geographic 10% / Opportunity Gap 10%, computed from Qloo affinity | **Materially affected.** Qloo affinity is **0–100 and normalised *per query*** — *"compare brands based on their relative position in the results, not just the raw score"* (§15). Two affinities from two different API calls are **not** on the same scale and must not be added directly. Each component must be rank-normalised *within its own result set* before weighting. The weights themselves are unaffected. |
| **01 §13, 02 §15** | "Taste Fit" treated as a single number | Should be **two** distinguishable inputs: Qloo affinity (0–100, per-query) and Qloo **index** (rank position, lower = more relevant). The docs state top results cluster tightly (91 vs 92 is *not* meaningful), so ranking must not over-read small score gaps. |
| 02 §15 | "Audience-Demographic 20%" | Now directly controllable: `signal.demographics.age.weight`, `.gender.weight`, `.audiences.weight` are **GET params** (§16), so demographic influence can be tuned server-side without a second call. Demographic *outputs* remain **signed** deltas, not 0–100 (§6). |
| 02 §17 | Taste DNA tags "ranked by relevance/affinity" | Achievable, but **not** via the naive `filter.type=urn:tag` path alone — see doc 04 §4 for the entity-derived design that does not depend on the contested tag endpoint. |
| 01 §16, 02 §21 | Brand registry 50–200 hand-curated entries | **Reduced scope confirmed** by decision (doc 04 §5): small curated list, Qloo-enriched at runtime, partnership links from verified official sources only. |
| *(new)* | — | **OpenStreetMap ODbL attribution.** FAQs list OSM as a data source under the Open Database License. If any map/geographic surface ships, the public site needs an OSM attribution line. Confirm before publishing. |

---

## 14. Decisions Taken (supersedes the former open questions)

All four questions raised in the first draft of this document were answered on 2026-10-22. The full
decision record, with rationale and consequences, lives in **`docs/04-decisions-and-readiness.md`**.
Summary:

| Former question | Resolution |
| --- | --- |
| Is the API key available? | **No.** Not present as an environment variable or in any workspace file. Nothing in §12 can be live-verified yet. Doc 04 §7 lists what is safe to build without it. |
| Which documentation governs? | **`docs.qloo.com` + verified live behaviour = authoritative** for the hackathon. `github.com/qloo/docs-public` is a **secondary reference**; contradictions get documented, not silently resolved. Both were studied — the GitHub repo supplied the concept pages (`affinity-score`, `interpreting-affinity-scores`, `affinity-score-methodology`, `signals`, `entities`, `filters`, `faqs`, `recipes`) that `docs.qloo.com` reference pages do not cover. → §15, §16 |
| Is the repository public? | Treated as **public by default**, which is the stricter reading. No captured Qloo responses in version control, ever; synthetic fixtures only. → doc 04 §8 |
| Brand registry scope? | **Small curated registry of real brands**, enriched with Qloo data where supported, partnership links from verified official sources only. → doc 04 §5 |

Core product vision reconfirmed and unchanged: Qloo-powered cultural intelligence, unexpected
affinities, untapped content opportunities, evidence-based brand recommendations, **no LLM APIs**.

---

## 15. Affinity Score Semantics — the most consequential new finding

Sources: *Affinity*, *Affinity Score Methodology*, *Interpreting Affinity Scores*, *FAQs* (all
`github.com/qloo/docs-public`, mirroring `docs.qloo.com`). These pages were **not** part of the
reference set studied for the first draft of this document, and they change the scoring design.

### Range and meaning

> "They range from **0 to 100** and are expressed as a percentage: **0** indicates no correlation,
> **100** represents a perfect match."

Not 0–1. This is distinct from two other numeric fields already documented in §6:

| Field | Range | Meaning |
| --- | --- | --- |
| `query.affinity` | **0–100** *(per concept docs; JSON encoding unverified)* | Strength of connection between the input signal and this result |
| `query.measurements.*` | signed decimals, e.g. `-0.0407` | Directional change metrics (`audience_growth`) |
| `query.age.*` / `query.gender.*` (demographics) | **signed** deltas, e.g. `+0.43`, `-0.28` | Stronger/weaker than average — **not** a 0–100 affinity |
| `query.explainability.*` | **0–1** normalised | Per-input-entity contribution (§5) |
| `<dim>_affinity_rank` (heatmap) | **0–1** normalised | Dimension rank |
| `popularity` | 0–1, e.g. `0.9984` | Catalogue popularity, independent of the query |

**Four different scales in one response object.** Conflating them is the single most likely source of
a wrong-but-plausible score. The scorer must treat each explicitly.

### How affinity is computed

> "**Vectorizing Entities**: entities are represented as data points in a multi-dimensional space…
> **Cosine Similarity**: this measures how similar two entities are based on their vector
> representations."

For **Basic Insights** specifically: *"A high score means the two entities are highly similar
(determined by the cosine similarity of their embeddings)."*

Signal inputs are weighted consumer interactions — transactions, reviews, likes, streams, comments,
posts, list inclusions — assembled into a **signal array** that "can be used to represent taste".
That is exactly what a creator's declared interests become. Qloo also runs bot detection over signal
arrays, and states it "does not handle or depend on any personally identifiable information".

### The normalisation trap — read this before writing the scorer

> "Because scores are **normalized per query**, compare brands based on their **relative position in
> the results**, not just the raw score."

> "Affinity scores **may decrease as more inputs or filters are applied**. For example, a score of 55
> could still represent a strong recommendation, but including demographic data may lower the final
> score."

Consequences for the 45/20/15/10/10 model (01 §13, 02 §15):

1. **Never add raw affinities from two different API calls.** A brand affinity from a
   `filter.type=urn:entity:brand` call and an artist affinity from a `filter.type=urn:entity:artist`
   call are on different per-query scales. Normalise **within each result set** first — rank-based or
   min-max over the returned set — then apply the weights.
2. **Adding demographic signals will depress scores.** That is documented behaviour, not a bug, and
   not a signal of poor fit. Thresholds must be relative, not absolute.
3. **Do not over-read small gaps.** *"A slight difference, like 91 versus 92, usually indicates
   similar relevance."* Ties must be broken by `index`, then by our own deterministic tiebreakers —
   never by pretending the 1-point gap is meaningful.

### Official interpretation bands

| Affinity | Relevance | Qloo's example |
| --- | --- | --- |
| `> 80` | Very High | Chappell Roan ↔ Sabrina Carpenter (artist query) |
| `60 – 80` | High | A local bakery ↔ Dunkin' Donuts (places query) |
| `= 50` | Medium | A sushi restaurant ↔ a library (places query) |
| `< 50` | Low | Chappell Roan ↔ a historical landmark (artist query) |

⚠️ These bands are **indicative and context-dependent**, and Qloo explicitly warns that filters lower
scores. Do **not** hard-code "≥80 = great match" into UI copy or into the untapped-opportunity rule.
Use them, at most, as a soft labelling layer, and state the basis in the UI.

### Index vs affinity

> "Affinity scores quantify the strength of a connection, while the **index** determines the relative
> order of results… **A lower index means higher relevance.**"

Also relevant: it is *normal* for many top results to share High/Very High scores — *"the system has
identified a cluster of strong matches… all may be viable"*. So a list of ten near-equal brands is an
expected outcome, not a failure. The UI must present that honestly rather than manufacturing a
spurious winner.

### Not a survey percentage

> "**No**, the score is not based on survey data or percentages of a sample… A score of 95 indicates a
> strong connection between entities, **not that 95% of people in a survey preferred it**."

This is a hard constraint on all generated copy. Any phrasing like *"95% of your audience…"* would be
a factual misrepresentation of the API. Templates must say *affinity*, *alignment*, or *fit* — never
*percent of people*. Reinforces 01 §26 / 02 §16.

### Cross-category insight is an officially documented use case

> "**Cross-Category Insights**: identify relationships across different entity types. *Example: a
> query for a demographic shows affinities between a band and a travel destination.*"

This is direct vendor-level validation of 01 §9's "unexpected affinity" premise. Worth citing in the
product's own explanation of why the approach is sound.

---

## 16. Signal Weight & Operator Controls (all available on GET)

Extracted from the Insights OpenAPI. Every parameter below is `in: query`, so **all of it works
without POST** — which retires most of contradiction #9.

### Scalar channel weights

Each dials how much one signal family influences the result:

| Parameter | Effect |
| --- | --- |
| `signal.interests.entities.weight` | Influence of interest entities, "in-domain or cross-domain" |
| `signal.interests.tags.weight` | Influence of interest tags |
| `signal.demographics.age.weight` | Influence of age signal |
| `signal.demographics.gender.weight` | Influence of gender signal |
| `signal.demographics.audiences.weight` | Influence of audience signal |
| `signal.location.weight` | Influence of location signal |

Type: `oneOf` number (`minimum: 0`) or a weight string. Docs say only *"higher values increase the
influence"* — **no documented scale, range, or default**. `[VERIFY]` empirically before exposing any
of these as user-tunable. Safe v1 stance: leave unset and rely on our own deterministic weighting.

### Ranking biases

| Parameter | Effect |
| --- | --- |
| `bias.content_based` | "The amount of strength content-based metadata has on the recommendations affinity score" |
| `bias.trends` | Trend-weighted ranking |
| `bias.quality` | Place quality score; **`filter.type=urn:entity:place` only**; accepts a number or `very_low\|low\|mid\|medium\|high\|very_high`; places without a quality score are **filtered out** |

`bias.content_based` is the interesting one for CreatorsDNA: it shifts ranking from pure
collaborative co-occurrence toward metadata similarity. That is a lever for the *Content
Compatibility* component (15%). Untested — treat as an experiment, not a dependency.

### Backfill

| Parameter | Default | Max |
| --- | --- | --- |
| `backfill.cross_domain.take` | 20 | **20** |
| `backfill.content_based.take` | — | — |

> "Controls the maximum number of **cross-domain backfill** results appended when primary results are
> insufficient."

Native cross-domain mechanism, and the closest thing Qloo offers to 01 §9's "beyond your niche".
Note the wording — *"when primary results are insufficient"* — so it is a **gap-filler, not a
guaranteed cross-domain feed**. Do not build "unexpected affinities" on the assumption that it always
returns 20 cross-domain items.

### Diversification

| Parameter | Effect |
| --- | --- |
| `diversify.by` | `properties.geocode.city`, `properties.geocode.metro`, or `subtype`. *"Set to `subtype` to cap results per tag subtype; **applies to `filter.type=urn:tag` only**."* Groups are ranked by their highest-affinity member; members ordered by individual affinity. |
| `diversify.take` | Max results per group (`minimum: 1`, example `5`) |

`diversify.by=subtype` is the mechanism for a **balanced** Taste DNA instead of ten near-duplicates
from one category.

### Operators — note the asymmetric defaults

| Parameter | Controls | **Default** |
| --- | --- | --- |
| `operator.filter.tags` | Combining multiple `filter.tags` | **`union`** (OR) |
| `operator.signal.interests.tags` | Combining multiple `signal.interests.tags` | **`intersection`** (AND) — *"or leave this field empty"* |
| `operator.filter.exclude.tags` | Combining exclusions | `union` |
| `operator.filter.external.exists` | Combining external keys (`resy`, `michelin`, `tablet`) | `union` |
| `operator.filter.references_brand` | Combining brand IDs — **PLACE insights only** | `union` |
| `operator.filter.release_country` | Combining countries | `union` |

⚠️ **The signal-tag operator defaults to AND while every filter operator defaults to OR.** Passing a
creator's five taste tags as `signal.interests.tags` without setting
`operator.signal.interests.tags=union` will demand entities carrying **all five** and return very
little. Under union mode, *"the tag with the highest affinity is used for scoring"*; under
intersection, *"affinity scores [are] merged across them"*.

Also, per *Filters*: *"When multiple filtering attributes are specified, they are treated inclusively
(OR condition) by default rather than exclusively (AND condition)."*

**Rule: set every operator explicitly. Never rely on a documented default.** Given contradiction #14
and the silent-ignore behaviour (§11), an implicit default is an unaudited assumption.

### Other signal params

| Parameter | Notes |
| --- | --- |
| `signal.interests.entities.include` | *"Additional entity IDs to explicitly include when computing interest signals… force certain entities to contribute to affinity calculations even if they would not normally be inferred by the core signal logic."* Useful for pinning a creator's own flagship works into the signal. |
| `signal.interests.entities.query` | **POST only.** JSON array of `{name, address}` with `resolve_to` (place / brand / both). Free-text → entity resolution. Would remove the `/search` round-trip **if** POST works. |
| `signal.location` / `.query` / `.radius` | Location signals |

---

## 17. Tag Namespace Curation — required before Taste DNA ships

Contradiction #16 is not cosmetic. Two very different kinds of tag live in the same system:

| Kind | Examples | Fit for Taste DNA |
| --- | --- | --- |
| **Taste-level** (what the concept docs promise) | *"action-packed"*, *"award-winning"*, *"family-friendly"*, *"Great Shopping"*, *"Outdoor Activities"*, *"Foodie Destination"* | ✅ This is what 01 §8 / 02 §17 describe |
| **Plot keywords** (`urn:tag:keyword:media`) | *"Mining Accident"*, *"Anthropomorphic Elephant"*, *"Gasoline Fire"*, *"Woman Farting"* | ❌ Too granular; would make the profile look broken |

Per *Entities*, tags are themselves entities that "categorize and enrich other entities", and
*"there are endless tags available in our system"*. So the namespace is large and **uneven in
quality**. A Taste DNA built from unfiltered tag harvesting can be 100% real Qloo data and still be
embarrassing — which violates the spirit of 01 §26 and 02 §16 even while satisfying the letter.

**Required controls:**

1. Enumerate `/v2/tags/types` once and **cache the taxonomy**.
2. Maintain an explicit **allow-list of tag types** in config (genre, mood/theme, cuisine, activity,
   lifestyle-style namespaces), reviewed against real output.
3. Maintain a **deny-list** for `urn:tag:keyword:*` and any namespace observed to yield plot-level or
   crude terms.
4. Never surface a tag that has not passed the allow-list, even if Qloo returned it with a high score.
5. Record the allow/deny decision in the response metadata so a bad tag is traceable to a config gap,
   not a mystery.

This is a **curation task requiring real API output** — it cannot be completed before the key arrives.
Doc 04 §7 therefore places it in the *must-wait* column, with the mechanism (config-driven lists,
filter function, tests) in the *safe-now* column.
