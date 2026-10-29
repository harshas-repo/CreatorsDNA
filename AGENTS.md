# CreatorsDNA — Agent Context

This repository is the **CreatorsDNA** cultural intelligence platform for content creators.

## Rule for all work in this repo

Before building any feature or making any change, load the relevant context documents below and
treat them as **binding product requirements**. Where a document and an ad-hoc instruction
conflict, surface the conflict instead of silently choosing one.

## Context documents

| # | Document | Scope | Status |
| --- | --- | --- | --- |
| 01 | [`docs/01-product-context.md`](docs/01-product-context.md) | Product vision, problem, Taste DNA concept, Qloo integration, scoring, brand data, website, app flow, design direction, priorities, build philosophy | ✅ Current |
| 02 | [`docs/02-technical-spec.md`](docs/02-technical-spec.md) | Implementation principles, Qloo API references and parameters, architecture, data flow, deterministic scoring, design system, performance, testing, 20-point acceptance criteria | ✅ Current |
| 03 | [`docs/03-qloo-api-reference.md`](docs/03-qloo-api-reference.md) | **Authoritative Qloo API detail** — hackathon host, auth, endpoint inventory, parameters by entity type, response shapes, error matrix, recommended call architecture, **affinity score semantics**, weight/operator controls, tag namespace curation, 17 documented contradictions needing live verification | ✅ Current · doc-derived, **not yet live-verified** |
| 04 | [`docs/04-decisions-and-readiness.md`](docs/04-decisions-and-readiness.md) | **Decision record (D1–D5)**, confirmed facts vs unverified assumptions, Taste DNA feasibility (mechanisms M1–M3, fallback levels L0–L4), brand registry approach, live probe plan, safe-now vs must-wait split, VCS hygiene, remaining decisions R1–R11 | ✅ Current · **read this first for current status** |
| 05 | [`docs/05-visual-design-skill.md`](docs/05-visual-design-skill.md) | **Binding visual direction** — creative direction, abstract 3D shape language, colour palette, hero, scroll storytelling, motion, typography, website content, app identity, **six data visualisations (A–F)**, visualisation interactions, data colour system, visual honesty, performance, design tokens, avoid-list, + §18 reconciliation | ✅ Current · **resolves R5 (visual theme)** |

More context documents will be added here as they are provided. Append new rows to this table when
they land.

**Doc 02 supplements doc 01; it does not replace it.** Where the two diverge, see
[`docs/02-technical-spec.md` §48 Reconciliation Notes](docs/02-technical-spec.md#48-reconciliation-notes)
— those items are **open questions**, not resolved decisions.

**Doc 03 is the API source of truth** and overrides the API assumptions in docs 01–02 where they
differ. Its [§13](docs/03-qloo-api-reference.md#13-impact-on-the-existing-context-documents) lists the
corrections it forces on those documents; they are **recorded there, not yet applied** to 01/02.

**Documentation precedence (decided, D1):** `docs.qloo.com` + **verified live behaviour** are
authoritative for the hackathon environment. `github.com/qloo/docs-public` is a **secondary reference**
(it supplied doc 03 §15–§17). Contradictions are documented in 03 §12 and **never silently resolved** —
resolution requires a probe result or an explicit human decision, written back with its evidence.

**Doc 04 is the current status.** It records what has been decided, what is confirmed, what is still an
assumption, and what may be built without an API key. Check it before starting any work.

## Non-negotiable constraints

**Intelligence**
- **No LLM API.** Qloo is the only AI/cultural intelligence engine. All natural-language output
  comes from deterministic templates populated with real data. (01 §6, §33 · 02 §2, §23, §24)
- **Qloo is load-bearing.** Removing it must meaningfully weaken the product. It is called for
  entity resolution, taste analysis, and cross-category discovery — not once and ignored.
  (01 §5, §20 · 02 §3)
- **Deterministic scoring layer on top of Qloo.** Never surface a raw Qloo affinity score. Weights:
  taste 45 / audience 20 / content 15 / geo 10 / opportunity gap 10 — tunable, always explainable.
  (01 §13 · 02 §15)
- **Qloo affinity is 0–100 and normalised *per query*.** Two affinities from two different API calls
  are **not** on the same scale and must never be added or compared directly. Normalise **within each
  result set** before weighting; handle the all-tied case by falling back to rank. (03 §15 · 04 §4.4)
- **Adding filters legitimately lowers affinity.** Documented behaviour, not a failure signal.
  Thresholds must be relative, never absolute. (03 §15)
- **Close scores are not meaningful.** "91 vs 92" indicates similar relevance; break ties with
  `index` (lower = more relevant), then with our own deterministic tiebreakers. A cluster of
  near-equal top results is an expected outcome — present it honestly rather than manufacturing a
  winner. (03 §15)
- **Never phrase affinity as a percentage of people.** Qloo states the score is *not* survey data:
  "95" does not mean 95% of anyone. Use *affinity*, *alignment*, or *fit*. (03 §15 · 01 §26)
- **Four different numeric scales appear in one Qloo response** — `query.affinity` (0–100),
  `query.explainability.*` (0–1), demographic deltas (**signed**), `popularity` (0–1). Conflating
  them is the most likely source of a wrong-but-plausible score. Treat each explicitly. (03 §6, §15)
- **Set every `operator.*` parameter explicitly.** Defaults are asymmetric: filter operators default
  to `union`, but `operator.signal.interests.tags` defaults to `intersection`. (03 §16)
- **Taste DNA is entity-first.** Build it from entity recommendations (M2) plus tags harvested and
  aggregated from those results (M3). Treat `filter.type=urn:tag` (M1) as an unverified enhancement
  layer, never a dependency. Design target is fallback level **L1**. (04 §4)
- **Curate tag namespaces before surfacing any tag.** An allow-list of tag *types* is required —
  unfiltered harvesting yields plot keywords alongside genuine taste tags. Real data is not
  automatically presentable data. (03 §17 · 04 §4.2)
- **No random or fabricated scores.** If a dimension lacks data: omit it, use a defined neutral
  fallback, or mark it unavailable. (02 §16)
- **No fake chatbot** to simulate AI behaviour. (02 §2)

**Honesty**
- **Never imply Qloo measured the creator's actual followers.** Use "Qloo-derived", "modelled
  taste", "based on your selected signals". (01 §7, §37)
- **No fabricated data.** Real brands only; never invent emails, contact info, partnership routes,
  follower counts, engagement, or campaign results. (01 §16 · 02 §21, §24)
- **Never present mock Qloo data as real output.** Fallbacks must be clearly separated in code.
  (01 §53 · 02 §34)
- **Every recommendation answers "why should I care?"** (01 §46 · 02 §11, §37)

**Architecture**
- **Secrets server-side only.** `QLOO_API_KEY` in env behind a backend proxy route; never in client
  code, never committed, never shown in UI. (01 §43 · 02 §12)
- **Derive request/response shapes from the current OpenAPI schema**, not from assumptions or older
  API versions. Do not guess endpoint formats or invent entity IDs. Doc 03 captures this; where
  Qloo's own docs contradict each other, resolve by live probe, never by guessing.
  (02 §4, §7, §35, §36 · 03 §12)
- **Qloo host is `https://hackathon.api.qloo.com`** — hackathon keys fail with 401 against
  `api.qloo.com` and `staging.api.qloo.com`. Every doc example uses the wrong host and must be
  rewritten. Auth is the **`X-Api-Key` header**, never `Authorization: Bearer`. (03 §1)
- **`/v2/insights` is a GET with query-string params.** Use GET for all of v1. Never call
  `/recommendations` or `/recs` — legacy and unsupported. (03 §2)
- **Unsupported parameters are silently ignored, not rejected.** A 200 response can therefore look
  like personalised data while being generic. Validate every request against a per-`filter.type`
  allow-list, and assert that personalisation actually occurred before rendering it. (03 §11)
- **`take` is capped at 50** per call; paginate with `page`. Combined with the monthly quota, this
  makes **server-side caching mandatory**, not optional. (03 §4, §8)
- **Never commit Qloo response data to the repo.** Private server-side caching is permitted with no
  time limit, but storing Qloo output in a public repository breaches the key's terms. Treat the repo
  as **public by default**. `.gitignore` covers `.env*` and cache/probe directories **before the first
  commit**; all fixtures are **synthetic**, never captured responses, snapshots, or screenshots.
  (03 §1 · 02 §34 · 04 §8)
- **Simple architecture.** Frontend → CreatorsDNA API layer → Qloo. No unnecessary microservices or
  backend complexity. (01 §42 · 02 §13, §46)
- **Stack: Next.js (App Router) + TypeScript** (decided — 04 D6). Qloo access goes through **Route
  Handlers** (`app/api/**/route.ts`) so the key is server-side by construction. Server Components by
  default; Client Components only for the interactive visualisations.
- ⚠️ **The cache backend must be durable, not the filesystem.** Serverless filesystems are ephemeral,
  but server-side caching is mandatory and permitted indefinitely. Settle the KV/blob choice **before**
  building the caching layer — building it on local disk would be rework. (04 D6 · R17)
- **Minimise Qloo calls.** Debounced search, caching, request deduplication. (02 §32)
- **No login, no authentication** unless explicitly required. Lightweight local persistence, but
  structured so a database can replace it later. (01 §17 · 02 §25)
- **Source verifiable brand metadata from Qloo at runtime** (`properties.websites`, `external.*`,
  `properties.image.url`, `description`) and hand-curate only the partnership routes Qloo cannot
  know. Every partnership claim needs a source URL and a verification date. (03 §6, §13 · 04 §5)
- **All Qloo access goes through one typed adapter** with a synthetic in-memory implementation for
  tests and offline work. This is the seam that lets the entire product be built before a key exists,
  and it makes the real client a one-file swap. (04 §7.1 S2)

**Product & UX**
- **No generic sidebar dashboard**, no chatbot, no corporate/enterprise feel. Consumer creator
  product. (01 §21, §22 · 02 §28)
- **Design must not read as generic AI SaaS.** Union of **all three** avoid-lists: robot illustrations,
  glowing brain/head, circuit-board imagery, purple gradients, purple-and-blue gradient hero, gradient
  blobs, random uncomposed blobs, AI sparkles, excessive glassmorphism, gradients on every element,
  generic three-card sections, repetitive three-column card grids, endless rounded cards, constant
  motion that harms reading, scroll interactions that block navigation, decorative graphs that
  represent no data, single-niche visual identity. (01 §39 · 02 §29 · 05 §16)
- **Three apparent conflicts in the avoid-lists are *not* conflicts** — do not "resolve" them by
  deleting either side: glass-like **3D materials** are wanted while **glassmorphism UI surfaces** are
  not; pillowy/liquid forms are wanted while **random uncomposed** blobs are not; **vivid violet** is a
  palette primary while the **purple→blue gradient** is banned. The distinction in each case is art
  direction and composition. (05 §18.4)
- **Theme must be swappable** without rewriting the application. (02 §29)
- **Reusable component library**, no duplicated UI logic across pages. (02 §30)
- **Desktop primary, mobile not an afterthought.** (01 §41 · 02 §31)
- **Graceful failure** on 429 / 5xx / network / invalid entity / empty result. Friendly product
  messages; never raw stack traces or API JSON. (01 §44 · 02 §33)
- **Narrative loading states**, not a generic spinner. (01 §45)

**Visual design & motion** *(doc 05 — binding; full detail there)*
- **Central concept: "a colorful universe of creativity."** Expressive 3D visual design **plus** bold
  graphic storytelling. Must suit creators across gaming, education, tech, comedy, beauty, travel, food,
  music, fitness, filmmaking, lifestyle — **no single niche may become the product's identity**.
  (05 §1)
- **Abstract 3D shapes are the signature visual language** and a brand asset across the website, hero,
  storytelling, transitions, and *selected* app areas. Curated material variety (glossy / matte /
  translucent / metallic / inflated) — **not** everything chrome or glass. Compositions must be
  art-directed with a clear focal point. (05 §2)
- **3D delivery is hybrid** (decided — 04 D7): **pre-rendered artwork animated with CSS transforms**
  site-wide, with **real-time WebGL reserved for the single signature hero animation**. The WebGL chunk
  must be code-split and client-only (`next/dynamic`, `ssr: false`), and its fallback is the same
  pre-rendered composition used everywhere else — so degradation is free, not extra work. (05 §2, §6, §14)
- **Palette:** electric cobalt, vivid coral/warm orange, bright yellow, acid lime, vivid violet, with
  pink/magenta as supporting accent — balanced by warm ivory, off-white, soft cream, charcoal, deep
  navy. **Colour must have hierarchy:** one main direction per section plus a few accents. (05 §3)
- **Website ≠ app in character, identical in identity.** The website is expressive and cinematic; the
  app is information-rich, readable, and organised, on **light or warm-neutral analytical surfaces**
  with colour carried by charts, nodes, highlights, and category markers. Never build an unrelated
  dashboard after the landing page, and **do not force 3D into every screen**. (05 §9)
- **Scroll storytelling, not repeated static sections.** A few memorable scenes with shapes that
  rearrange as the visitor scrolls. Animation must **enhance** the narrative, never delay access to
  information; no scroll hijacking or over-long pinned sections. (05 §5)
- **One signature animation.** Purposeful motion only — ambient, cursor, scroll-triggered, section
  transitions, microinteractions. If video is used, **its final frame must match the resting
  composition** so looping does not visibly jump. (05 §6)
- **Typography is a compositional element.** Oversized dominant headlines, concise supporting copy,
  asymmetric layouts, varied widths, occasional full-bleed. Cards only where they genuinely organise
  information. (05 §7)
- **Six required visualisations:** (A) Taste DNA network, (B) cultural affinity ranking,
  (C) opportunity-gap scatter, (D) culture-to-brand relationship map, (E) brand-fit breakdown,
  (F) **taste fingerprint**. Every one must answer a meaningful question. (05 §10)
- **Stable colour roles by provenance** — creator-provided / Qloo-discovered / CreatorsDNA-derived /
  illustrative — mapped consistently and **documented**. Reinforce meaning with size, shape, labels,
  line style, and grouping so nothing rests on colour alone. **Never use red/green alone to imply an
  opportunity is bad or good** — cultural fit is exploratory, not a binary judgement. (05 §12)
- **Graphs must stay readable as nodes grow** — filtering, grouping, progressive disclosure, or a
  simplified view; optionally a graph↔ranked-list switch. Never sacrifice clarity for an
  impressive-looking graph. (05 §11)
- **Omit or simplify a visualisation whose data cannot support it.** If a Qloo capability is
  unavailable or unvalidated, the chart does not render — it does not render estimated. (05 §13)
- **Never render a bare overall percentage.** The weighted score must always appear with its breakdown
  and methodology. (05 §10E · 03 §15)
- **Prefer lightweight CSS transforms, optimised vector artwork, and compressed assets.** WebGL or a 3D
  library **only when the result justifies the complexity**. Pause off-viewport ambient animation,
  degrade gracefully where 3D is unsupported, simplify compositions on mobile. (05 §14)
- **Reduced-motion, keyboard navigation, focus states, and touch are requirements**, not polish — and
  the experience must remain fully usable with animation disabled. (05 §6, §14)
- **Design tokens for ten categories**, including four 02 §19 omits: graph/chart styling, node and
  connection styles, motion duration and easing, shape treatments and decorative artwork. Shapes must
  read as **one family**. (05 §15)

## Verification before declaring work done

- Output must **change meaningfully** across the five test archetypes (fashion, gaming, fitness,
  travel, lifestyle). Identical recommendations for every creator = failure. (02 §41)
- Treat identical output as evidence of the **silent-parameter-ignore** failure mode, not coincidence.
  A signalled call must differ from an unpersonalised baseline. (03 §11)
- Check against the **20-point acceptance criteria** in (02 §42).

## Blocking: live API probe

**No API key is available** — confirmed absent from environment variables and from every file in the
workspace. Docs 03 and 04 are therefore **doc-derived only**, and 16 assumptions in
[04 §3](docs/04-decisions-and-readiness.md#3-assumptions-requiring-a-live-probe) remain unverified.

The prioritised probe plan is **[04 §6](docs/04-decisions-and-readiness.md#6-live-probe-plan)** —
16 tests, budget ≤ 25 requests, ordered so the design-gating questions are answered first and quota
exhaustion cannot strand the important ones.

**Four assumptions gate the design** (04 §3):

1. **A1/A2** — does `query.affinity` exist on entity results, and is it 0–100 or 0–1? Gates every
   scorer constant.
2. **A10** — does `filter.results.entities` *score* a supplied registry, or merely restrict? Gates the
   brand-recommendation approach.
3. **A15** — what is the monthly quota? Gates caching vs pre-computation strategy.
4. **F22 detection** — does a signalled call actually differ from an unpersonalised baseline? This is
   **P0-2, the second request in the probe**, because it is the only unacceptable failure mode (L4).

The rest are recoverable via the fallback hierarchy in
[04 §4.5](docs/04-decisions-and-readiness.md#45-fallback-hierarchy).

## What can be built without a key

**19 workstreams are unblocked** (04 §7.1 S1–S19); **13 items remain blocked** (04 §7.2 W1–W13).
Doc 05 removed the last visual blocker, and D6/D7 removed the last architectural ones.

What is blocked is still **constants, identifiers, content, and two decisions** — not architecture.

**Two independent tracks, no shared dependency** (04 §7.3):

- **API track** — S2–S6, S10–S12, S15. Keystone is **S2: the typed Qloo adapter with a synthetic
  implementation.** Build it first and the rest becomes ordinary testable engineering, with the real
  client a one-file swap. Skip it and everything waits on the key.
- **Design track** — S7, S8, S16–S19: tokens, colour semantics, motion system, visualisation
  scaffolding. **Needs no Qloo call at all.**

The one shared dependency is the **data shape** each visualisation consumes — so S2's adapter should
define the view-models the charts render, letting both tracks agree on one contract early.

**Still blocked on decisions, not on the key:** W12 (3D assets) waits on **R13**; the cache layer's
storage backend waits on **R17**.

## Outstanding inputs

Decided and no longer outstanding: documentation precedence (D1), Taste DNA direction (D2), brand
registry approach (D3), VCS hygiene (D4), product vision & no-LLM (D5) — see 04 §1. **Visual theme (R5)
— resolved by doc 05. Tech stack (R2) — D6, Next.js App Router + TypeScript. 3D approach (R12) — D7,
hybrid. Skill packaging — D8, doc 05 stays a context document.**

Still needed — full list with rationale at
[04 §9](docs/04-decisions-and-readiness.md#9-remaining-decisions-needed) and
[05 §18.7](docs/05-visual-design-skill.md#187-new-decisions-required):

- ⏳ **R1 — Qloo API key.** The only true critical path, and the only one nobody here can close; it
  depends on a third party. Provisioning takes business days. Also confirm `feature.explainability` is
  entitled on the key.
- ⏳ **R17 — Cache backend.** ⚠️ **Top engineering blocker**, opened by D6: a serverless filesystem is
  ephemeral but caching is mandatory. Needs a durable KV/blob store, or an accepted cold cache with
  pre-computed demo profiles. Interacts with R7. **Must be settled before building the cache layer.**
- ⏳ **R13 — Where the 3D assets come from.** **Top design blocker**, promoted by D7: hybrid needs a
  whole *family* of pre-rendered shapes plus one WebGL scene. §2 forbids stock illustrations; §15 demands
  consistent materials and lighting across the set — family consistency is the hard part.
- ⏳ **R3/R4 — Priority conflicts A & B** (02 §48): is the public website P0, and is unexpected-affinity
  *visualization* P0 or P1? **Doc 05 §17 supplies evidence for 01 §51's position** — it names the
  signature hero and scroll storytelling among the top five priorities, both website-only surfaces.
  Still needs an explicit decision.
- ⏳ **R7 — Quota** on the hackathon key. Not documented anywhere; may need asking Qloo directly.
  Determines whether R17's durable cache is essential or merely sensible.
- ⏳ **R6 — Repository visibility.** Defaulting to the stricter "public" reading.
- ⏳ **R8 — Demo creators:** real named creators or fictional personas? Doc 05 §8/§13 require any
  illustrative result to be **clearly labelled as illustrative**, which makes personas the safer route.
- ⏳ **R9 — First brand tranche:** how many, which categories? Suggested ≤ 40 across 4–6 categories so
  one call can score the whole pool.
- ⏳ **R10 — Apply the recorded corrections to docs 01/02?** Now spanning 03 §13 **and** 05 §18.6.
  Recorded, **not applied**, by instruction.
- ⏳ **R11 — ODbL attribution** if any map/geographic surface ships.
- ⏳ **R14 — Data colour-role mapping.** Doc 05 §12 allows choosing it at implementation time but
  requires it documented and reused. Cheap to fix now, expensive to retrofit across six visualisations.
- ⏳ **R15 — Is the taste fingerprint (05 §10F) P0 or P1?** Net-new component, absent from the 01/02
  priority lists.
- ⏳ **R16 — Charting, graph, and scroll-animation libraries.** Opened by D6; doc 05 §17 deliberately
  prescribes none. Choose per chart rather than forcing one library.
- ⏳ **Explicit build instruction.** Nothing is implemented until it is given.

## Current state

Context gathering, API investigation, and visual direction complete. Stack and 3D approach decided
(D6, D7). **No application code has been written.** Five context documents; docs 01, 02 and 03
unchanged since creation.
