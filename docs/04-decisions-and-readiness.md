# CreatorsDNA — Decisions, Feasibility & Implementation Readiness

> **Document 04 of the CreatorsDNA context set.**
> Records the decisions taken on **2026-10-22**, the Taste DNA feasibility investigation they
> commissioned, and an honest split between what can be built now and what must wait for a live API
> key.
>
> Reads against [`01-product-context.md`](01-product-context.md), [`02-technical-spec.md`](02-technical-spec.md),
> [`03-qloo-api-reference.md`](03-qloo-api-reference.md) and
> [`05-visual-design-skill.md`](05-visual-design-skill.md). Where this document and doc 03 state API
> facts, **doc 03 is the reference and this document is the reasoning**.
>
> *This document was written before doc 05 arrived and has since been amended in place: R5 is closed,
> R12–R15 opened, S16–S19 and W12–W13 added. Doc 05 §18 holds the design-side reconciliation.*
>
> **Status: decisions recorded. No application code written. Build not authorised.**

---

## 1. Decision Record

Five decisions were issued on 2026-10-22 and are binding (D1–D5). Three further decisions were taken
later the same day after doc 05 arrived (D6–D8). Each is restated with its consequences, because the
consequences are where the work is.

### D1 — Documentation precedence

> Treat the official Qloo hackathon documentation and **verified live API behaviour** as authoritative
> for the hackathon environment. Use the GitHub documentation as a secondary reference and document
> contradictions.

**Consequences**

- `docs.qloo.com` (hackathon guide + Insights Deep Dive OpenAPI) wins over `github.com/qloo/docs-public`
  on any conflict about the **hackathon host, auth, endpoints, and parameter support**.
- **Verified live behaviour wins over both.** A documented parameter that the live key ignores is
  treated as unavailable, regardless of what either doc says. This matters because of the silent-ignore
  behaviour in doc 03 §11.
- `github.com/qloo/docs-public` remains authoritative-by-default for **concept semantics** — what an
  affinity score *means*, how signals work, how entities are modelled — because those pages exist only
  there and the reference pages do not contradict them.
- Contradictions are **documented, never silently resolved**. The register is doc 03 §12 (now 17 items).
  Resolving one requires either a live probe result or an explicit human decision, and the resolution
  must be written back into §12 with its evidence.

**Already applied:** doc 03's header now states this precedence, and §15–§17 were built from the GitHub
concept pages under it.

### D2 — Prioritise validating Taste DNA

> Investigate whether entity recommendations, affinity scores, and returned tags can reliably support
> personalised taste discovery if the tag endpoint is unsuitable.

**Consequence:** this document §4. **Answer: yes — reliably — without the tag endpoint.** The design
is entity-first, with tags harvested *from entity results* rather than requested from
`filter.type=urn:tag`. Full analysis and the fallback hierarchy below.

### D3 — Small curated brand registry

> Start with a small, curated registry of real brands. Enrich it with Qloo data where supported, and
> use verified official sources for partnership links.

**Consequence:** this document §5. Replaces 01 §16's "50–200 brands" with a smaller list whose
**partnership routes are human-verified**, and sources all descriptive metadata from Qloo at runtime.

### D4 — Secrets, caches, and fixtures out of version control

> Keep API keys, private response caches, and other sensitive data out of version control. Never commit
> captured Qloo responses; use synthetic fixtures for tests.

**Consequence:** this document §8. This is now a **hard rule**, and it is doubly binding: our own
decision *and* Qloo's stated restriction ("Do not store Qloo response data in a public repository",
doc 03 §1). Note the repo is **not currently git-initialised**, so the rules must be in place before
the first commit, not retrofitted.

### D5 — Preserve the core product vision

> Qloo-powered cultural intelligence, unexpected affinities, untapped content opportunities, and
> evidence-based brand recommendations. **No LLM APIs.**

**Consequence:** unchanged from 01 §4–§14 and 02 §8–§18, and reaffirmed. Two things this rules out that
might otherwise look tempting after reading Qloo's docs:

- **No LLM for natural-language output.** All copy comes from deterministic templates (01 §26, 02 §16).
  Qloo's `properties.description` and `query.explainability` are *data*, and may be rendered — that is
  not an LLM call.
- **No ML of our own.** Qloo is the sole intelligence engine. Our scoring is deterministic arithmetic
  over Qloo output, tunable and explainable (02 §15).

### D6 — Technology stack *(decided 2026-10-22, resolves R2)*

> **Next.js (App Router) + TypeScript.**

**Why it fits the constraints**

- **Route Handlers** (`app/api/**/route.ts`) give a server-side proxy by construction, so `QLOO_API_KEY`
  never reaches the client bundle — satisfies §8.2 rule 8, 02 §12 and 02 §22 without extra
  architecture.
- **Server Components by default** suit the marketing site's scroll storytelling and doc 05 §14's
  performance preference; Client Components are opt-in for the six visualisations.
- **TypeScript gives S2's typed adapter real teeth.** The adapter's view-models become the shared
  contract between the API track and the design track (§7.3), which is exactly the early agreement
  §7.3 asks for.
- React's ecosystem covers the 17-component library (02 §19 + doc 05 §18.6) and the charting needs of
  doc 05 §10 without hand-building.
- Single deployable; matches 01 §42 / 02 §13's "simple architecture" requirement.

**Consequences that must be designed for**

1. ⚠️ **Serverless filesystems are ephemeral — this collides with the caching mandate.** Doc 03 §13
   made server-side caching *mandatory in practice* (monthly quota + `take ≤ 50` + verbose
   unsuppressable fields), and F23 permits caching with **no time limit**. On a serverless host, local
   disk does not persist between instances. The cache therefore needs **durable storage** (a KV or blob
   store) rather than the filesystem — or the design must accept a cold cache and pre-compute demo
   profiles. This interacts directly with **R7 (quota)**, which is still unknown. **Decide the cache
   backend before S10, not during it.**
2. **The WebGL hero chunk must be code-split and client-only** (`next/dynamic` with `ssr: false`), with
   a pre-rendered static fallback for unsupported devices — doc 05 §14 requires graceful degradation.
3. **Charting and graph libraries are not yet chosen** and doc 05 §17 deliberately does not prescribe
   them. Visualisations A/D (network graphs) and B/C/E (bars, scatter, breakdown) have different needs;
   pick per chart rather than forcing one library. → **R16**
4. **Scroll-animation library not chosen.** GSAP ScrollTrigger and Framer Motion are the two credible
   routes; doc 05 §5's pinned scenes and §14's reduced-motion requirement both bear on the choice.
   → **R16**
5. **Ten design-token categories (doc 05 §15)** map naturally to CSS custom properties plus a typed
   token object, so tokens stay swappable per 02 §29.

### D7 — 3D approach: hybrid *(decided 2026-10-22, resolves R12)*

> **Pre-rendered 3D artwork animated with CSS transforms across the site, with real-time WebGL reserved
> for the single signature hero animation.**

This is the reading that satisfies doc 05 §2 ("one of the most important elements") and §14 ("WebGL …
only when the visual result justifies the complexity") **simultaneously**, rather than trading one off
against the other. §6 asks for exactly **one** signature animation — so exactly one surface pays the
WebGL cost.

**Consequences**

| Area | Requirement |
| --- | --- |
| **Ambient / scroll motion** | Layered pre-rendered stills driven by CSS transforms (float, drift, parallax, cursor tilt). No WebGL. Cheap, works everywhere, trivially respects reduced-motion. |
| **Signature hero moment** | One real-time WebGL scene, lazy-loaded, client-only, code-split (D6 consequence 2). |
| **Fallback** | The hero must degrade to the pre-rendered composition when WebGL is unsupported or too expensive (§14). The fallback is therefore not extra work — it is the same artwork used everywhere else. |
| **Video, if used** | §6's rule binds: **the final frame must match the resting composition** so looping or playback completion produces no visible jump. |
| **Mobile** | Simplify the composition rather than shrinking it (§4); fewer moving objects (§14). |
| **Assets** | Still images + optionally short loops, compressed (WebP/AVIF; WebM/MP4). Must read as **one family** with consistent materials, lighting, and composition (§15). |
| **App surfaces** | §9 forbids forcing 3D into every screen — the app carries the identity through palette, typography, rounded geometry, curves, and accents, not through 3D objects. |

**This makes R13 (asset source) the next blocking design decision.** Hybrid needs a *family* of
pre-rendered shapes plus one WebGL scene, and §2 forbids "random stock illustrations" while §15 demands
consistent materials and lighting across the whole set. Family consistency is the hard part of any
generation route.

### D8 — Design guidance stays a context document *(decided 2026-10-22)*

> Doc 05 is **binding context**, not an invocable skill. No `/design-review`-style skill is created.

**Rationale:** `AGENTS.md` auto-loads on every task, so the design direction governs all work without
anyone needing to remember to invoke it. A separate skill would be a second source of truth for the
same rules. If a checklist-style audit is wanted later, it should be generated *from* doc 05 rather
than maintained beside it.

---

## 2. Confirmed Facts

Established from documentation, internally consistent across sources, and safe to design against.
"Confirmed" here means *confirmed as documented* — items marked `[probe]` in §3 still need live
verification before code trusts their exact behaviour.

| # | Fact | Source |
| --- | --- | --- |
| F1 | Hackathon host is `https://hackathon.api.qloo.com`. Keys 401 against `api.qloo.com` and `staging.api.qloo.com`. | Hackathon guide |
| F2 | Auth is the `X-Api-Key` header. Not `Authorization: Bearer`, not a query param. | Hackathon guide |
| F3 | `/v2/insights` is **GET** with query-string params. POST is documented as failing on the hackathon host. | Hackathon guide |
| F4 | `/recommendations` and `/recs` are **legacy and unsupported** for the hackathon. `/v2/insights/search` is invalid. | Hackathon guide |
| F5 | `signal.interests.entities` is supported for **all ten** entity types. | Entity Type Guide allow-lists |
| F6 | `filter.results.entities` and `filter.results.tags` exist, are supported for all ten entity types, and are documented as "often used to **assess the affinity of an entity/tag towards input**". | Insights OpenAPI + Parameter Reference |
| F7 | `feature.explainability=true` returns per-result `query.explainability` with **0–1 normalised** per-input-entity contributions; entities ≥0.1 always included. Also an aggregate over top 3/5/10/all. Applies to Brand. | Insights OpenAPI |
| F8 | Affinity scores are **0–100**, expressed as a percentage, and are **normalised per query**. | *Interpreting Affinity Scores*, *Affinity*, *FAQs* |
| F9 | Basic Insights affinity = **cosine similarity of entity embeddings**. | *Affinity Score Methodology* |
| F10 | **`index`** is the rank position; **lower index = higher relevance**; distinct from affinity. | *Interpreting Affinity Scores* |
| F11 | Top results commonly cluster at similar scores; *"91 versus 92"* is not meaningful. | *Interpreting Affinity Scores*, *FAQs* |
| F12 | Affinity **decreases as inputs/filters are added** — documented behaviour, not an error. | *Interpreting Affinity Scores* |
| F13 | Affinity is **not** a survey percentage. "95" ≠ "95% of people". | *FAQs* |
| F14 | The response field is named **`query.affinity`**. | Insights OpenAPI (`heatmap.dimensions` description) |
| F15 | Entity results carry `name`, `entity_id`, `type`, `subtype`, `disambiguation`, `popularity` (0–1), `properties` (`description`, `image.url`, `websites[]`, `akas[]`), `tags[]` (`{id,name,type}`), `query`, `external` (instagram/twitter/imdb). | Recommendation Insights response example |
| F16 | Demographic outputs are **signed** deltas (`+0.43`, `-0.28`), not 0–100. | Demographics use-case response |
| F17 | Six scalar `*.weight` GET params exist (entities, tags, age, gender, audiences, location) plus `bias.content_based`, `bias.trends`, `bias.quality`. | Insights OpenAPI |
| F18 | `backfill.cross_domain.take` default 20, **max 20**, appends cross-domain results *"when primary results are insufficient"*. | Insights OpenAPI |
| F19 | `diversify.by=subtype` caps results per subtype and **applies to `filter.type=urn:tag` only**. | Insights OpenAPI |
| F20 | `operator.filter.tags` defaults to **union**; `operator.signal.interests.tags` defaults to **intersection**. | Insights OpenAPI |
| F21 | `take` default 20, **max 50**; `page` 1–100. | Hackathon guide + OpenAPI |
| F22 | Unsupported parameters are **silently ignored** — a 200 response can look personalised while being generic. | Hackathon guide + doc 03 §11 |
| F23 | Server-side caching is permitted with **no time limit**; Qloo response data must **not** go in a public repository. | Hackathon guide |
| F24 | Qloo recognises 10 entity types for insights: artist, book, brand, destination, movie, person, place, podcast, tv_show, videogame — plus `urn:heatmap`, partial `urn:entity:locality`, deprecated `urn:entity:audience`, and (per use-case pages) `urn:tag` / `urn:demographics`. | Insights OpenAPI + use-case pages |
| F25 | Signals are weighted consumer interactions assembled into a **signal array** representing taste. Qloo runs bot detection over them and handles no PII. | *Signals* |
| F26 | Cross-category insight is an **officially documented Qloo use case** ("affinities between a band and a travel destination"). | *Affinity* |
| F27 | OpenStreetMap data is used under **ODbL**, which carries an attribution obligation. | *FAQs* |

**F26 is strategically useful:** the "unexpected affinity" premise at the centre of this product
(01 §9) is not an invention — it is a capability Qloo markets. That is worth reflecting in the product's
own explanation of its method.

---

## 3. Assumptions Requiring a Live Probe

Everything below is **unverified**. No code may treat any of these as true until the probe in §6
returns evidence. Each is labelled with what breaks if the assumption is wrong.

| # | Assumption | Why it is only an assumption | If false |
| --- | --- | --- | --- |
| A1 | `query.affinity` is present on insights **entity** results when signals are supplied | Field *name* confirmed (F14) but the OpenAPI types result items as `{}`; no entity-response example shows it | The entire Taste Fit component loses its input; would fall back to `index` rank only |
| A2 | `query.affinity` is **0–100** in the JSON, matching the concept docs | Heatmap dimension fields are 0–1; `measurements` are signed decimals. Encoding could differ | All scorer constants and any threshold are wrong by 100× |
| A3 | `filter.type=urn:tag` is **accepted** at all | Absent from the OpenAPI `filter.type` enum, but documented on the Taste Analysis page | Tag insights unavailable → M1 path dead (M2/M3 unaffected) |
| A4 | `filter.type=urn:tag` **honours** `signal.interests.entities` | Entity Type Guide lists only 5 params for Tag (no signals); Taste Analysis page says signals are accepted **and required** | Tag results are generic, not personalised → breaches 02 §16 honesty rule |
| A5 | Tag results carry **scores**, not `"query": {}` | The documented Taste Analysis response literally shows `"query": {}`; concept docs say the score "represents the relevance of tags to a taste vector" | M3 tag weighting loses its affinity input; would weight by frequency only |
| A6 | `filter.type=urn:demographics` is accepted | Absent from the OpenAPI enum | Audience-Demographic component (20%) has no source; weight redistributed |
| A7 | `feature.explainability=true` **populates** on the hackathon key | Documented, but the docs also note it may return `query.explainability.warning` instead; entitlement unknown | "Why this brand?" (P0, 02 §11) falls back to deterministic template reasons |
| A8 | `urn:entity:videogame` is the correct spelling | OpenAPI enums say `videogame`; hackathon + Entity Type guides say `video_game` | 403 on the gaming test archetype (02 §41) |
| A9 | Age buckets are the **6-value** set | Three-way disagreement (doc 03 §12 #13) | Demographic signal silently ignored (F22) → A6-style degradation |
| A10 | `filter.results.entities` scores a supplied registry rather than merely restricting | Wording is "filter by a comma-separated list… often used to assess the affinity" | Brand scoring becomes "top 50 brands, hope ours appear" — much weaker, and registry size must shrink to ≤50 |
| A11 | **POST** fails on the hackathon host | Guide says it will; Parameter Reference documents POST-only params | If POST *works*, per-entity signal weights unlock — a genuine upgrade, worth knowing either way |
| A12 | GET accepts **URN slug** IDs (`urn:entity:movie:inception`), not just GUIDs | Only seen in a POST example | `/search` resolution stays mandatory — no change, just no shortcut |
| A13 | The `*.weight` params have a usable, discoverable scale | Docs say only "higher values increase the influence"; no range, no default | Leave them unset; do all weighting ourselves (already the v1 plan) |
| A14 | Tag namespaces include **taste-level** tags, not just plot keywords | Concept docs promise *"award-winning"*, *"Foodie Destination"*; observed `/v2/tags` samples were plot keywords | Taste DNA tags need heavy curation, or stay entity-only |
| A15 | Monthly **quota** is sufficient for multi-call profiles | Never stated anywhere | Caching must become pre-computation; demo profiles baked in advance |
| A16 | `akas` and other verbose fields cannot be suppressed | No output-field-selection param found in the OpenAPI | Cache payloads stay large; storage planning changes |

**A1, A2, A10 and A15 are the four that gate the design.** The rest are recoverable with fallbacks
already specified.

---

## 4. Taste DNA Feasibility (D2)

**Question:** can entity recommendations, affinity scores, and returned tags reliably support
personalised taste discovery if the tag endpoint is unsuitable?

**Answer: yes.** Three mechanisms exist. One is contested; two are on solid documented ground and are
sufficient between them.

### 4.1 The three mechanisms

| | Mechanism | Documentary support | Verdict |
| --- | --- | --- | --- |
| **M1** | **Tag insights** — `filter.type=urn:tag` + `signal.interests.entities` → scored taste tags directly | Taste Analysis page says supported; concept docs say the score is tag↔taste-vector relevance. **But** Entity Type Guide lists no signal params for Tag, `urn:tag` is absent from the OpenAPI enum, and the sample response shows `"query": {}` | ⚠️ **Unverified. Do not depend on it.** Enrichment only, if A3/A4/A5 pass. |
| **M2** | **Entity recommendations** — `filter.type=urn:entity:{type}` + `signal.interests.entities` + `sort_by=affinity` + `feature.explainability=true` | `signal.interests.entities` allow-listed for all ten types (F5); `sort_by=affinity` documented; `query.affinity` named (F14); affinity semantics fully documented (F8–F13) | ✅ **Primary.** Strongest ground of anything in the API. |
| **M3** | **Tags harvested from entity results** — every result carries `tags[]`, and every result carries its own affinity; aggregate | `tags[]` = `{id,name,type}` confirmed in the response shape (F15). The aggregation is **our** deterministic arithmetic — no API dependency, no LLM | ✅ **Secondary, and the answer to D2.** Produces scored taste tags without touching M1. |

### 4.2 M3 — how tags become taste without the tag endpoint

Each entity result `r` in a signalled recommendation call carries both an affinity `a_r` and a tag list
`T_r`. For any tag `t`:

```
rawWeight(t)   = Σ  f(a_r)          over all results r where t ∈ T_r
support(t)     = count of such r
tagScore(t)    = rawWeight(t) / totalWeight        → normalised 0..1
```

where `f(a_r)` is the **within-result-set normalised** affinity (see §4.4 — never the raw 0–100 value
mixed across calls).

Three properties make this sound:

1. **Co-occurrence is the signal.** A tag appearing on many high-affinity results is a genuine
   characteristic of the taste vector. This is the same logic Qloo describes for its own taste analysis
   (*"content models highlight similar attributes between entities"*), computed by us over data we
   already fetched.
2. **`support(t)` separates taste from noise.** A tag on one result is an anecdote; a tag on twelve is
   a pattern. Require `support ≥ 2` (tunable) before a tag is surfaced.
3. **It is fully deterministic and explainable.** Every displayed tag can show *which entities carried
   it* — which satisfies 01 §26 / 02 §16 evidence requirements better than an opaque API score would.

**Required guardrail:** the namespace curation in doc 03 §17. Without an allow-list of tag *types*, M3
will happily surface `"Woman Farting"` with `support = 3`. That is real data and still unacceptable.
The allow-list cannot be written before the probe — but the *mechanism* (config-driven lists, filter
function, tests) can be.

### 4.3 Mapping mechanisms to the four Taste DNA components (01 §8)

| Component | Mechanism | Deterministic derivation | Depends on unverified assumption? |
| --- | --- | --- | --- |
| **Core tastes** | M2 in-domain + M3 | Categories the creator declared → high-affinity results within them; top tags by `tagScore` with `support ≥ 2` | A1, A2 only (recoverable via `index` rank) |
| **Cultural connections** | M2 across categories | Group results by `subtype`; connections = subtypes appearing across multiple declared categories | No |
| **Emerging signals** | M2 + `backfill.cross_domain.take` | High normalised affinity **and low `popularity`** — both fields confirmed (F15). Optionally `bias.trends` | No (`bias.trends` scale is A13, but it is optional) |
| **Unexpected affinities** | M2 cross-domain + set difference | `unexpected = categories(returned) − categories(declared)`; then rank within by normalised affinity | No |

**"Emerging signals" needs no new API surface at all.** `affinity` high + `popularity` low is the
definition of under-recognised-but-aligned, and both numbers are in every response. That is a genuinely
nice result: a P0 component that rests entirely on confirmed facts.

**"Unexpected affinities" is bookkeeping, not inference.** It requires only that we record which
categories came from explicit creator input and compare against which categories produced results. That
is also exactly how the 01 §12 *explicit signals vs discovered affinities* distinction gets enforced in
the UI — the same set that defines "unexpected" defines what must be visually labelled as discovered.

### 4.4 The normalisation rule (mandatory)

Because affinity is normalised **per query** (F8) and drops as filters are added (F12), raw scores from
different calls are not comparable. Every affinity must be normalised **within its own result set**
before entering any weighted score:

```
Given a result set R of size N with affinities a_r:
  if max(a) > min(a):  norm(r) = (a_r − min(a)) / (max(a) − min(a))
  else:                norm(r) = (N − index(r)) / N        // F11: ties are normal; fall back to rank
```

The `else` branch is not an edge case — F11 says clusters of near-equal top scores are *expected*, and
exact ties are plausible. A divide-by-zero here would be a real bug.

**Consequence for 01 §13 / 02 §15:** the 45/20/15/10/10 weights survive intact. What changes is that
each component is computed from **rank-normalised within-set values**, not raw affinities. This is
recorded as a correction in doc 03 §13, not yet applied to 01/02.

### 4.5 Fallback hierarchy

If the probe disappoints, degrade in this order. Each level still produces a real, honest Taste DNA:

| Level | Condition | Taste DNA source | Still honest? |
| --- | --- | --- | --- |
| **L0** | Everything works (A1–A5 pass) | M2 affinity + M3 scored tags + M1 tag insights | ✅ |
| **L1** | M1 dead (A3/A4/A5 fail) | M2 affinity + M3 harvested tags | ✅ **Expected baseline — design for this** |
| **L2** | `query.affinity` absent or unscaled (A1/A2 fail) | M2 **`index` rank** + M3 frequency-weighted tags | ✅ Rank is documented (F10) and is a real signal |
| **L3** | Explainability absent (A7 fails) | Deterministic template reasons from our own score breakdown | ✅ 02 §11 already requires this fallback |
| **L4** | Signals ignored entirely (F22 detected) | **Hard fail.** Do not render. Show the degraded state. | ⛔ Rendering generic output as personalised breaches 02 §16 |

**L1 is the design target.** Build the pipeline so that L0's extra tag insights are an *enhancement
layer*, and so that L2 requires changing one function, not the architecture.

**L4 is the only unacceptable outcome**, and doc 03 §11's mitigation applies: compare every signalled
call against an unpersonalised baseline and fail loudly if they are identical.

---

## 5. Brand Registry (D3)

### 5.1 Division of labour

| Field | Source | Why |
| --- | --- | --- |
| `name`, `description`, `region`, `image`, `website`, social handles | **Qloo at runtime** (F15) | Verifiable, current, zero manual maintenance, and cannot drift from the entity we scored |
| `entity_id` | **Qloo `/search`**, resolved once and cached | The link that makes scoring possible |
| Partnership / affiliate / ambassador route | **Human-verified official source only** | Qloo cannot know whether a brand runs creator programmes. This is the only field that must be curated. |
| Category, notes, verification date, source URL | **Us** | Provenance and auditability |

This inverts 01 §16 / 02 §21, which assumed a fully hand-curated record. The registry becomes **small
and thin**: identity + partnership route + provenance. Everything descriptive is fetched.

### 5.2 Rules

1. **Real brands only.** No invented brands, no plausible-sounding placeholders (01 §26, 02 §16).
2. **Every partnership claim needs a source URL** captured at curation time, plus the date verified.
   An unverified claim is omitted, not hedged.
3. **No contact details, no named individuals, no invented campaign metrics.** If Qloo does not return
   it and we cannot verify it, it does not appear (01 §26).
4. **Registry size ≤ 50 per scoring call**, because `take` max is 50 (F21). A larger registry means
   multiple calls or pagination — decide after A10 confirms how `filter.results.entities` behaves.
5. **Registry content is not Qloo response data**, so it *may* be committed. But it must contain **no
   captured Qloo fields** — only IDs we resolved and partnership facts we verified. Keep cached Qloo
   enrichment in the ignored cache directory (§8), not in the registry file.
6. **Brands must be scored, not selected by hand.** The registry defines the *candidate pool*; ranking
   comes from Qloo affinity + our deterministic score. A brand appearing in the registry is not a
   recommendation.

### 5.3 What can be done now

Brand **identification** and **partnership verification** need no API key: real brand names, their
categories, and official partnership-page URLs are publicly researchable. What needs the key is the
`entity_id` linkage.

So: build the registry **schema, validation, and curation harness** now; populate a first tranche of
names and verified partnership URLs now; **link `entity_id`s after the probe.**

---

## 6. Live Probe Plan

One script, run once the key exists, producing a machine-readable report. Ordered so the design-gating
questions are answered first and a quota exhaustion cannot strand the important tests.

**Budget: target ≤ 25 requests total.** Every response is written to the **ignored** cache directory
(§8) — never to the repo.

| Priority | Test | Settles | Requests |
| --- | --- | --- | --- |
| **P0-1** | `GET /v2/insights?filter.type=urn:entity:movie&signal.interests.entities=<2 ids>&sort_by=affinity&take=5` — inspect for `query.affinity`, its **range**, and `index` | A1, A2, F8, F10 | 1 |
| **P0-2** | Same call **without** signals; diff the result sets | F22 silent-ignore detection — the single most important test in the plan | 1 |
| **P0-3** | `filter.type=urn:entity:videogame` then `urn:entity:video_game` | A8 | 2 |
| **P0-4** | `filter.type=urn:entity:brand&signal.interests.entities=<ids>&filter.results.entities=<3 known brand ids>&feature.explainability=true` | A10, A7, F6, F7 | 1 |
| **P0-5** | `filter.type=urn:tag&signal.interests.entities=<ids>` | A3, A4, A5 | 1 |
| **P0-6** | `filter.type=urn:demographics&signal.interests.entities=<ids>` | A6, F16 | 1 |
| **P0-7** | `signal.demographics.age=25_to_29,30_to_34` — check response keys and whether the param was honoured | A9 | 1 |
| **P1-8** | `GET /v2/tags/types` — full taxonomy dump | A14, doc 03 §17 allow-list | 1 |
| **P1-9** | `backfill.cross_domain.take=20` with a single-category signal — does it actually return cross-domain items? | F18's "when insufficient" caveat | 1 |
| **P1-10** | `diversify.by=subtype&diversify.take=3` on `urn:tag` | F19 | 1 |
| **P1-11** | `operator.signal.interests.tags` union vs intersection with 3 tags | F20 | 2 |
| **P1-12** | Inspect `tags[]` across ~50 entity results: which namespaces actually appear, and at what quality | A14, M3 viability | 0 (reuses P0-1/4/9) |
| **P2-13** | POST with a weighted signal array | A11 | 1 |
| **P2-14** | GET with a URN slug ID | A12 | 1 |
| **P2-15** | `signal.interests.entities.weight` at two values — is there an observable difference? | A13 | 2 |
| **P2-16** | Rate-limit discovery: burst 10 rapid calls, record status codes and any `Retry-After` | A15 | 10 |

**Output:** a written probe report appended to doc 03 §12 as resolutions, plus updated A-rows in §3.
**No application code is written from probe results until the report exists.**

P2-16 is deliberately last: it is the only test that could exhaust quota, and everything above it
matters more.

---

## 7. What Can Be Built Now vs What Must Wait

**No API key is available** — verified absent from environment variables and from every file in the
workspace. The repo is also **not yet git-initialised**.

### 7.1 Safe to build now (no key required)

| # | Work item | Why it is safe | Refs |
| --- | --- | --- | --- |
| S1 | **Repo scaffolding + `.gitignore`** covering `.env*`, cache dir, probe output — in place **before** the first commit. **Now fully specified:** Next.js App Router + TypeScript (D6). | D4; cheaper now than retrofitted | §8 · D6 |
| S2 | **Qloo adapter interface** (typed ports: `resolveEntities`, `getInsights`, `getTagTypes`) + a **synthetic in-memory implementation** | The single highest-value unblocked item. Lets the whole app be built and tested against a fake, with the real client dropped in later behind one seam | 02 §13, §14 |
| S3 | **Deterministic scoring engine** — normalisation (§4.4), the 45/20/15/10/10 weighting, tiebreakers | Pure functions over typed input; fully unit-testable with synthetic fixtures. Constants that depend on A2 isolated behind one config object | 01 §13, 02 §15 |
| S4 | **Taste DNA assembly** — M2/M3 aggregation, the four components (§4.3), the fallback hierarchy (§4.5) | Pure functions. Design for **L1**, treat L0 tags as an enhancement layer | 01 §8, 02 §17 |
| S5 | **Unexpected-affinity + untapped-opportunity derivation** | Set difference and affinity-vs-coverage arithmetic over declared inputs — no API dependency at all | 01 §9, §10 |
| S6 | **Template-based NL generation** (no LLM) | Deterministic string composition; must encode F13 — never "N% of people" | 01 §26, 02 §16 |
| S7 | **Design system / component library** — the 15 components of 02 §19 **plus** the two doc 05 adds (culture-to-brand map, taste fingerprint) | Pure UI, and now **visually specified** — doc 05 resolved R5. Theme swappable per 01 §39 | 02 §19 · 05 §10, §15, §18.6 |
| S8 | **Public marketing website** — hero, scroll storytelling, content sections | No live data. Any example result must be **clearly labelled illustrative** | 01 §30–§38 · 02 §27 · 05 §4, §5, §8 |
| S9 | **Onboarding flow + creator signal capture + validation** | Explicit user input, no API | 01 §17, 02 §28 |
| S10 | **Caching layer**, keyed by canonical parameter set — ⚠️ *but see R17 first*: the key design and invalidation logic are safe to build now, the **storage backend is not**, because a serverless filesystem is ephemeral (D6 consequence 1) | Server-side caching is explicitly permitted (F23); key design needs no live data | 02 §32 · R17 |
| S11 | **Synthetic fixtures** for all five test archetypes + the "five different Taste DNAs" assertion | D4 mandates synthetic; the assertion is the only reliable F22 detector | 02 §41, doc 03 §11 |
| S12 | **Error, empty, and degraded-state UI**, including the L4 hard-fail state | Must exist before real data can fail in public | 02 §24, §33 |
| S13 | **Brand registry schema, validation, and curation harness**; first tranche of real brand names + verified partnership URLs | Publicly researchable; `entity_id` linkage deferred | §5.3 |
| S14 | **Tag namespace allow/deny-list mechanism** (config + filter + tests), lists left empty | Mechanism is testable with synthetic tags; *content* needs P1-8/P1-12 | doc 03 §17 |
| S15 | **The probe script itself** — written, reviewed, not run | Ready to execute the moment a key lands | §6 |
| S16 | **Design tokens** — all ten categories of doc 05 §15, including graph/chart styling, node & connection styles, motion duration & easing, shape treatments | Pure config; four of the ten are absent from 02 §19 and are newly required | 05 §15 |
| S17 | **Data colour-role mapping** — the provenance palette (creator-provided / Qloo-discovered / CreatorsDNA-derived / illustrative) | Needs only **R14**; then it is config plus tests. It is what enforces 01 §12 in the UI | 05 §10A, §12 · 01 §12 |
| S18 | **Motion system** — reduced-motion handling, ambient/cursor/scroll/microinteraction primitives, off-viewport pausing | Behaviour is fully specified and testable without assets; the *assets* themselves wait on R12/R13 | 05 §6, §14 |
| S19 | **Visualisation scaffolding** for the six required charts (A–F), incl. node-count strategies: filtering, grouping, progressive disclosure, graph↔list switch | Chart structure and interaction contracts are data-shape-driven and testable against synthetic fixtures. Only the *real* data waits | 05 §10, §11 · 03 F21 |

**S2 is the keystone.** With a typed adapter and a synthetic implementation, S3–S6 and S12 are all
ordinary testable engineering, and swapping in the real client becomes a one-file change. Without it,
everything blocks on the key.

**S16–S19 are newly unblocked by doc 05** and form a coherent second track that shares no dependency
with the API track. Between them they cover tokens, colour semantics, motion, and chart scaffolding —
i.e. most of the visible product — without a single Qloo call.

### 7.2 Must wait for the key

| # | Blocked item | Blocking assumption |
| --- | --- | --- |
| W1 | Scorer **constants and thresholds** | A2 (0–100 vs 0–1) |
| W2 | Real `entity_id`s for creator interests | — |
| W3 | Brand registry ↔ Qloo `entity_id` linkage | A10 |
| W4 | Tag type **allow/deny list content** | A14, P1-8, P1-12 |
| W5 | Whether M1 tag insights exist at all | A3, A4, A5 |
| W6 | Explainability availability → "Why this brand?" final design | A7 |
| W7 | Demographic component wiring | A6, A9 |
| W8 | Caching aggressiveness / pre-computation strategy | A15 |
| W9 | Weight tuning against real output | A13 |
| W10 | Any demo profile, screenshot, or example containing real Qloo data | F23 + D4 |
| W11 | The videogaming test archetype | A8 |
| W12 | **3D shape assets** — the actual signature visual world | **R13 only** (R12 is resolved by D7). Not API-blocked, but decision-blocked and on the critical path for the hero. |
| W13 | Real interface previews on the marketing site (doc 05 §8) | Depends on the app existing and on W10 |

### 7.3 Rough split

**19 workstreams are unblocked** (S1–S19); **13 items remain blocked** (W1–W13). Doc 05 moved four items
from "structurally possible but visually undefined" into fully unblocked, and added a second track —
tokens, colour semantics, motion, chart scaffolding — that has **no dependency on the API at all**.

What is blocked is still **constants, identifiers, content, and two design decisions** — not
architecture.

**Interpretation:** the key gates *correctness of values*, not *existence of the system*. Provided S2
is built first, a late-arriving key costs days, not a redesign. The one scenario that would force a
redesign is **L4** (signals silently ignored), which is why P0-2 is the second request in the probe.

**New observation after doc 05:** the two tracks are genuinely independent. The API track (S2–S6,
S10–S12, S15) and the design track (S7, S8, S16–S19) can proceed in parallel, and neither waits on the
other. The only shared dependency is the **data shape** each visualisation consumes — which is why S2's
typed adapter should define the view-models the charts render, so both tracks agree on one contract
early.

---

## 8. Version Control Hygiene (D4)

Binding rules. The repo is not yet git-initialised, so these must be satisfied by the first commit.

### 8.1 Never committed

```
.env  .env.*  !.env.example
.qloo-cache/          # all cached Qloo responses
probe-output/         # raw probe results
*.key  *.pem
```

`.env.example` **is** committed and contains key **names with empty values only**.

### 8.2 Rules

1. **API key exists only as a server-side environment variable.** Never in client code, never in a
   bundle, never in a query string, never in a commit, never pasted into chat or a doc (02 §22, §33).
2. **No captured Qloo response is ever committed** — not as a fixture, not as a test snapshot, not in a
   README, not in a screenshot. This satisfies both D4 and F23.
3. **All test fixtures are synthetic.** Hand-authored, obviously fictional where appropriate, and
   structurally faithful to the documented shapes (F15). A fixture that *looks* like real Qloo output
   is a liability.
4. **Cache directory is ignored from day one**, before any call is made — not added after a leak.
5. **Probe output stays local.** The probe *report* (§6) may be committed; the raw responses may not.
   The report records findings, ranges, and field presence — not payloads.
6. **Demo content uses synthetic data** until W10 clears, and even then any real-data screenshot must be
   checked for the key, for `akas` noise, and for anything implying a survey percentage (F13).
7. **The brand registry file may be committed** but must contain no cached Qloo fields — only resolved
   IDs and human-verified partnership facts with source URLs (§5.2 rule 5).
8. **Server-only enforcement.** All Qloo calls live behind server routes; the client never sees the key
   or talks to Qloo directly (02 §13, §22).

### 8.3 A note on the honesty constraint

D4 and 01 §27 ("no fabricated screenshots") pull in slightly different directions: we may not commit
real Qloo data, and we may not fake screenshots. The resolution is that **demo data must be visibly
synthetic** — labelled as such in the UI — rather than disguised as real. That is honest *and*
committable. This applies to the marketing site especially.

---

## 9. Remaining Decisions Needed

Ordered by how much they block.

| # | Decision | Why it matters | Blocks |
| --- | --- | --- | --- |
| **R1** | **API key status** — requested? ETA? | Provisioning takes business days. It is the only true critical path. | All of §7.2 |
| ~~**R2**~~ | ✅ **RESOLVED — D6.** **Next.js (App Router) + TypeScript.** | Unblocks S1–S19. Note the consequence nobody had anticipated: a **serverless filesystem is ephemeral**, which collides with the mandatory server-side cache (§1 D6 consequence 1). The cache backend must be chosen before S10. | — |
| **R3** | **Priority conflict A** — 01 §51 lists the public website as **P0 #1**; 02 §43's P0 list **omits it entirely** while §27/§42/§45 still require a presentation-quality site. | Build order. Still unresolved from the doc-02 review. **New evidence (doc 05 §17):** the design skill names the *signature hero* and *scroll storytelling* among the top five implementation priorities — both website-only surfaces — which favours 01 §51's position. Evidence, not a decision. | S8 scheduling |
| **R4** | **Priority conflict B** — 01 §51 puts unexpected affinities at **P0 #6**; 02 §43 puts unexpected-affinity ***visualization*** in **P1**. | Working assumption recorded as *detection P0, rich visualization P1* — needs confirming. Doc 05 §10A makes the Taste DNA network a **required** visualisation, which raises the cost of deferring it. | S4, S7 scope |
| ~~**R5**~~ | ✅ **RESOLVED 2026-10-22 by [`docs/05-visual-design-skill.md`](05-visual-design-skill.md).** The visual theme both 01 §39 and 02 §29 deferred as "provided separately" is now supplied: creative direction, 3D shape language, palette, hero, scroll storytelling, motion, typography, six required data visualisations, data colour system, ten design-token categories, and an avoid-list. | Design system and marketing site are now **visually** unblocked, not merely structurally. See doc 05 §18 for reconciliation against docs 01–04. | — |
| **R6** | **Repository visibility** — public or private? | We are defaulting to the stricter public reading (§8). If private, caching and fixture rules can relax slightly. | §8 strictness |
| **R7** | **Quota** — what is the monthly limit on the hackathon key? | Determines whether caching suffices or demo profiles must be pre-computed. Not documented anywhere. | A15, W8 |
| **R8** | **Demo creators** — real named creators, or fictional personas? | Real names risk implying endorsement and need real data (W10). Personas are safe and synthetic but less convincing. Interacts with 01 §27. | S9, S8, S11 |
| **R9** | **First brand tranche** — how many brands, and which categories? | Registry size interacts with the `take ≤ 50` limit and A10. Suggest starting **≤ 40 across 4–6 categories** so one call can score the whole pool. | S13, W3 |
| **R10** | **Apply the recorded corrections to docs 01/02?** | Now spanning **03 §13** (API corrections, including the material affinity-normalisation change to 01 §13 / 02 §15) **and 05 §18.6** (design corrections, including two new components for 02 §19). Per instruction they are **recorded, not applied**. | Doc consistency |
| **R11** | **ODbL attribution** — will any map or geographic surface ship? | F27. If yes, the public site needs an OpenStreetMap attribution line. | S8 legal |
| ~~**R12**~~ | ✅ **RESOLVED — D7.** **Hybrid:** pre-rendered 3D artwork + CSS transforms site-wide, with real-time WebGL reserved for the **single** signature hero animation. Satisfies doc 05 §2 and §14 simultaneously rather than trading one off. | Hero fallback is free — it is the same pre-rendered artwork used everywhere else. The WebGL chunk must be code-split and client-only. | — |
| **R13** | **Where do the 3D assets come from** — commissioned, generated, or built in code? **Now the top design blocker**, promoted by D7: the hybrid approach needs a whole *family* of pre-rendered shapes **plus** one WebGL scene. | Doc 05 §2 demands "an original visual world … even before reading the brand name" and forbids "random stock illustrations"; §15 demands the shapes read as **one recognizable family** with consistent materials, lighting, and composition. Family consistency across many assets is the hard part, whichever route is chosen — and it is harder for generation than for a single modelling session. | W12, S8, the hero, brand identity |
| **R14** | **Data colour-role mapping.** Doc 05 §12 permits choosing it during implementation but requires it be **documented and reused**. | Small decision, high leverage: it is the mechanism that enforces 01 §12's explicit-vs-discovered provenance distinction in the UI. Cheap to fix now, expensive to retrofit across six visualisations. | S4, S7 |
| **R15** | **Is the taste fingerprint (doc 05 §10F) P0 or P1?** | A net-new component absent from both 01 §51 and 02 §43 priority lists. It is achievable — the Taste DNA components in §4.3 supply exactly the inputs it needs — but nobody has prioritised it yet. | S4, S7 scope |
| **R16** | **Charting, graph, and scroll-animation libraries.** Opened by D6 — doc 05 §17 deliberately does not prescribe any. Visualisations A/D are network graphs; B/C/E are bars, scatter, and breakdowns; the site needs pinned scroll scenes. | Pick **per chart** rather than forcing one library (D6 consequence 3–4). Scroll choice is constrained by §5's pinned scenes and §14's reduced-motion requirement. Not urgent, but cheap to decide alongside S7/S19. | S8, S19 |
| **R17** | ⚠️ **Cache backend.** Opened by D6: a serverless filesystem is **ephemeral**, but doc 03 §13 made server-side caching mandatory and F23 permits indefinite caching. | Needs a durable KV/blob store, **or** an accepted cold cache with pre-computed demo profiles. Interacts directly with **R7 (quota)** — a tight quota makes durable caching essential rather than optional. **Must be settled before S10.** | S10, R7 |

**Closed so far: R2 (D6), R5 (doc 05), R12 (D7).** Plus D8 settled that doc 05 stays a context document
rather than becoming an invocable skill.

**R13 and R17 are now the two most actionable.** Neither depends on a third party. **R13** is the top
*design* blocker — the hybrid approach needs a coherent family of assets before the hero can exist.
**R17** is the top *engineering* blocker — building S10's cache on a filesystem that evaporates would be
rework, and the answer depends on R7, which may need asking Qloo directly.

**R1 remains the only true critical path**, because it is the only one nobody here can close.

Full detail on R12–R15 at [doc 05 §18.7](05-visual-design-skill.md#187-new-decisions-required);
D6–D8 consequences at [§1](#1-decision-record).

---

## 10. Change Log

| Date | Change |
| --- | --- |
| 2026-10-22 | Doc 04 created. Decisions D1–D5 recorded. Doc 03 extended with §15 (affinity semantics), §16 (weight & operator controls), §17 (tag namespace curation); §12 grown from 10 to 17 contradictions; §13 given six further corrections; §14 converted from open questions to resolved decisions. Docs 01 and 02 **unchanged**. |
| 2026-10-22 | Amended on arrival of **doc 05** (visual design skill). **R5 closed** — the deferred visual theme is now supplied. **R12–R15 opened** (3D approach, 3D asset source, data colour-role mapping, taste-fingerprint priority). **S16–S19 added** (design tokens, colour roles, motion system, visualisation scaffolding) and **W12–W13 added** (3D assets, real interface previews). S7/S8 upgraded from structurally- to visually-unblocked. §7.3 recount: 19 unblocked / 13 blocked. R3 given new supporting evidence; R4, R2, R10 annotated. Docs 01, 02 and 03 **unchanged** by this amendment. |
| 2026-10-22 | **D6–D8 recorded.** **R2 closed** — Next.js (App Router) + TypeScript. **R12 closed** — hybrid 3D: pre-rendered artwork + CSS transforms site-wide, WebGL for the single signature hero only. **D8** — doc 05 stays binding context, not an invocable skill. **R16 opened** (charting / graph / scroll libraries). **R17 opened** ⚠️ (cache backend — serverless filesystems are ephemeral, which collides with the mandatory server-side cache; this consequence was not anticipated by any source document). R13 promoted to top design blocker. S1/S10/W12 annotated. Docs 01, 02, 03 **unchanged**; doc 05 §18.7 updated to mark R12 resolved. |
