# CreatorsDNA — Technical & Product Specification

> **Document 02 of the CreatorsDNA context set.**
> Supplements [`01-product-context.md`](01-product-context.md). Defines implementation principles,
> technical boundaries, API references, product requirements, architecture expectations, and
> quality standards.
>
> This is intentionally **not** a step-by-step coding instruction. Choose the best implementation
> approach based on the existing project/repository and the requirements below.
>
> **Status:** Context only. Do not implement until an explicit build instruction is given.
> **Known divergences from doc 01:** see [§48 Reconciliation Notes](#48-reconciliation-notes).

---

## 1. Product

- **Name:** CreatorsDNA
- **Product category:** Creator cultural intelligence / opportunity discovery.

### Core flow

```
Creator signals
→ Qloo cultural intelligence
→ Taste DNA
→ Unexpected affinities
→ Untapped opportunities
→ Brand opportunities
→ Explain why
→ Action
```

The product must feel like a **real consumer-facing creator platform** rather than a hackathon demo.

---

## 2. Primary Technical Constraint

**NO LLM API.**

Do not depend on: OpenAI, Claude, Gemini, Groq, Bedrock, or any other generative AI API.

The core intelligence comes from **Qloo**.

Other functionality should use:

- deterministic algorithms
- scoring
- filtering
- structured data
- API calls
- predefined templates
- local persistence where appropriate
- normal application logic

**Do not simulate AI behavior with a fake chatbot.**

---

## 3. Qloo Is the Core Intelligence

Qloo should be **deeply integrated** into the application.

The application must not simply call Qloo once and then ignore the result.

The Qloo-derived signals should directly influence:

- Taste DNA
- discovered affinities
- opportunity detection
- brand recommendations
- recommendation explanations

> **Test:** the core product should become meaningfully weaker if Qloo is removed.

---

## 4. Official Qloo References

Use the **current Qloo public API documentation as the source of truth**.

| Resource | URL |
| --- | --- |
| Public API docs repository | https://github.com/qloo/docs-public |
| OpenAPI specification | https://github.com/qloo/docs-public/blob/main/openapi-schema.json |
| Primary API overview | https://github.com/qloo/docs-public/blob/main/reference/api-overview.md |
| Insights API deep dive | https://github.com/qloo/docs-public/blob/main/reference/insights-api-deep-dive.md |
| Taste analysis | https://github.com/qloo/docs-public/blob/main/reference/taste-analysis.md |
| Demographic insights | https://github.com/qloo/docs-public/blob/main/reference/demographics-use-case.md |
| Recipes | https://github.com/qloo/docs-public/tree/main/recipes |
| Capabilities | https://www.qloo.com/capabilities |

Use these references when implementing the API.

> ⚠️ Do not rely on assumptions from **old Qloo API versions** if the current documentation differs.

---

## 5. Relevant Qloo Capabilities

The current Qloo API documentation indicates support for:

- Insights API
- entity recommendations
- taste analysis
- demographic insights
- location-based insights
- entity search
- entity lookup by ID
- tag search
- audience search
- audience types
- analysis
- comparison
- trending entities
- week-over-week trending

The first version of CreatorsDNA does **not** need every capability.

### Prioritize

1. Entity search
2. Insights / recommendations
3. Taste analysis
4. Demographic signals where useful
5. Explainability if supported by the API

### Potentially later

- trending
- analysis compare
- audience segments
- location insights

---

## 6. Qloo Entity Types

The current Qloo Insights API documentation lists supported entity categories including:

`artist` · `book` · `brand` · `destination` · `movie` · `person` · `place` · `podcast` · `tv_show` ·
`videogame`

Do not assume every category must be used. The application should use the categories that produce
the strongest creator cultural experience.

### Initial priority

**Creator input entities:**

- artist
- brand
- movie
- TV show
- videogame
- podcast
- book

**Opportunity entities:**

- brand

**Potential future opportunity entities:**

- destination
- place
- entertainment properties

---

## 7. Qloo Entity Search

Creator onboarding should support searching for entities.

**Example searches:** Nike, Formula 1, Travis Scott, Marvel, GTA, The Weeknd, Friends, etc.

Use Qloo's entity search/lookup capability to resolve user selections to actual Qloo entities.

> ⚠️ **Do not invent entity IDs.**

Store enough information to identify the selected entity:

- name
- Qloo ID
- entity type
- category/type
- image if available
- relevant metadata if available

**If search returns multiple results, present the user with selectable results rather than guessing
silently.**

---

## 8. Qloo Insights / Recommendations

Use **Qloo Insights** as the main recommendation mechanism.

Qloo's current documentation describes the Insights API as parameter-driven and capable of
combining:

- entities
- tags
- demographics
- audiences
- location

…to produce taste-driven results.

CreatorsDNA should use this to move from creator signals to cross-category recommendations.

### Conceptually

```
Input entities: creator-selected interests
  ↓
Qloo Insights
  ↓
Related cultural entities/tags
  ↓
Brand recommendations
```

> ⚠️ The exact request structure should be determined from the current OpenAPI/documentation rather
> than hardcoded based on this conceptual description.

---

## 9. Qloo Taste Analysis

Use Qloo's taste-analysis capability to discover **tag-level cultural signals** associated with the
creator's selected entities.

### Concept

```
Creator selects: fashion-related brand, artist, movie, game
  ↓
Qloo taste analysis
  ↓
Relevant cultural tags
  ↓
CreatorsDNA normalizes/ranks those tags
  ↓
Taste DNA
```

Qloo documentation indicates taste analysis uses the Insights endpoint with:

```
filter.type = urn:tag
```

…and can use entity interests and other signals.

> ⚠️ Verify the exact current parameters from the API schema before implementation.

---

## 10. Qloo Demographic Signals

Audience demographics are **optional** creator inputs.

**Potential inputs:** age range · gender · country/location

If the creator provides demographic information, use available Qloo demographic capabilities to
improve recommendation relevance.

**Do not require demographics.** A creator should still be able to use CreatorsDNA without knowing
their audience demographics.

The current Qloo demographic documentation supports age/gender affinity analysis around entities or
tags.

Reference: https://github.com/qloo/docs-public/blob/main/reference/demographics-use-case.md

---

## 11. Qloo Explainability

Investigate and use Qloo's explainability functionality **if supported by the API key/account**.

The current Qloo Insights documentation describes:

```
feature.explainability=true
```

…which can return metadata describing **which input entities contributed to recommendations**.

This is highly relevant to CreatorsDNA. Use it where possible to power **"Why this brand?"**

### Example conceptual output

```
Nike
Strong match because:
  - creator signal:    Formula 1
  - creator signal:    Travis Scott
  - creator signal:    Nike
  - discovered taste:  sneakers
  - discovered taste:  streetwear
```

> ⚠️ Do not expose raw API JSON to the user. Transform it into clear product UI.

---

## 12. Qloo API Key Security

The Qloo API key must **never** be exposed in browser/client-side source code.

Use a server-side API route, backend, serverless function, or equivalent secure architecture.

Use an environment variable, e.g. `QLOO_API_KEY=...`

- Never commit the key.
- Never hardcode the key.
- Never display the key in the UI.

---

## 13. API Architecture

Prefer a **simple** architecture.

### Conceptually

```
Frontend
  ↓
CreatorsDNA backend/API layer
  ↓
Qloo API
```

The frontend should **not** call Qloo directly if that would expose credentials.

The backend should provide application-specific endpoints such as:

```
/api/qloo/search
/api/qloo/taste
/api/qloo/recommendations
/api/analyze
```

Exact route naming is up to the implementation.

Keep the architecture easy to understand and maintain. **Do not create unnecessary microservices.**

---

## 14. Data Flow

Expected flow:

1. User enters creator information.
2. User searches for entities.
3. Application resolves entities through Qloo.
4. User selects several signals.
5. Application sends selected Qloo IDs and optional demographic/location information to Qloo
   Insights.
6. Qloo returns taste/recommendation information.
7. Application normalizes the returned results.
8. Application creates a Taste DNA profile.
9. Application identifies unexpected affinities.
10. Application compares current creator content categories against discovered taste categories.
11. Application identifies untapped opportunities.
12. Application requests/derives relevant brand recommendations.
13. Application applies deterministic scoring.
14. Application displays ranked opportunities.
15. Application provides explanation.
16. Application allows the creator to take action.

---

## 15. Deterministic Intelligence Layer

CreatorsDNA itself should add intelligence **beyond** Qloo.

**Do not simply display Qloo's affinity score.** Create a deterministic scoring layer.

### Possible dimensions

| Dimension | Weight |
| --- | --- |
| Qloo Taste Fit | 45% |
| Demographic/Audience Fit | 20% |
| Content Compatibility | 15% |
| Geographic Fit | 10% |
| Opportunity Gap | 10% |

These are **initial weights, not immutable**. The implementation can tune them based on what the
actual Qloo response provides.

> **The important requirement: the final score must be explainable.**

### Example

```
Brand X
Creator Fit: 91

  Taste Fit:        95
  Content Fit:      89
  Audience Fit:     90
  Location Fit:     94
  Opportunity Fit:  82
```

---

## 16. No Random / Fake Scoring

**Scores must be derived from actual data.**

Do not generate random numbers to make the interface look intelligent.

If a dimension cannot be calculated because data is missing:

- omit it
- use a clearly defined neutral fallback
- or mark it unavailable

**Do not fabricate.**

---

## 17. Taste DNA Algorithm

Create a **deterministic process** for converting Qloo outputs into Taste DNA.

### Conceptually

```
Input entities
+ Qloo tags
+ Qloo related entities
+ Qloo affinities
  ↓
Normalize
  ↓
Deduplicate
  ↓
Group by category
  ↓
Rank by relevance/affinity
  ↓
Separate explicit signals from discovered signals
  ↓
Produce Taste DNA
```

The UI should distinguish **"Your signals"** from **"Discovered by CreatorsDNA"**.

---

## 18. Unexpected Affinity Logic

An unexpected affinity should generally satisfy:

1. It was **not** explicitly selected by the creator.
2. Qloo-derived data indicates **meaningful relevance**.
3. It belongs to a **culturally meaningful category**.
4. It is **sufficiently different** from the creator's obvious category to be interesting.

> ⚠️ Avoid simply showing the top five Qloo results as "unexpected." There should be a
> **deterministic threshold/ranking mechanism**.

---

## 19. Untapped Opportunity Logic

Compare **creator's declared content categories** against **Qloo-derived cultural categories**.

### Potential logic

```
High affinity
+ low current content coverage
= untapped opportunity
```

The product should show: **Affinity · Current coverage · Opportunity gap**

This is a **CreatorsDNA-specific feature** rather than a Qloo feature.

---

## 20. Brand Recommendation Logic

Brand candidates can come from:

- Qloo brand recommendations
- curated real brand registry
- other legitimate real sources if added later

**Do not create fake brands.**

The initial brand registry can be relatively small. **Quality is more important than quantity.** A
smaller set of verified brands is preferable to thousands of fabricated records.

---

## 21. Brand Registry

If a local/curated registry is required, structure it cleanly.

### Example

```json
{
  "name": "...",
  "category": "...",
  "website": "...",
  "region": "...",
  "creator_partnership_url": "...",
  "affiliate_url": "...",
  "ambassador_url": "...",
  "contact_route": "...",
  "verification_date": "..."
}
```

- Only include information that can be **verified**.
- Do not invent emails.
- Do not scrape personal contact information.

### Amendment — the scored brand set is discovery-led (2026-10-24, user-approved)

> Appended, not rewritten: the verification rules above are unchanged. This records how the registry
> is *used* by the live pipeline, which the original section left implicit ("*if a local/curated
> registry is required*").

**Decision.** In live mode the brands that are scored and ranked are the ones Qloo **discovers** for
the creator's taste — a single `filter.type = urn:entity:brand` recommendation call over the declared
signals, normalised within that one result set (doc 04 §4.4). The curated registry is **demoted to
partnership-route enrichment**:

- a discovered brand that matches a registry entry by `qlooEntityId` inherits its verified
  partnership route via `mergeBrand`;
- a discovered brand with no registry match is built from Qloo metadata alone, flagged
  `discovered: true`, with `partnership: null` and a derived (not hand-curated) category;
- registry brands Qloo did **not** discover are no longer injected into the affinity ranking — doing
  so would mix normalisation sets.

**Rationale.** Scoring a fixed registry produced the same shortlist for every creator and a flat
"moderate" fit, because the candidates were never selected by the creator's taste. Discovery makes the
ranked set a function of the profile, while the registry still supplies the only thing it can honestly
supply — verified partnership routes (§22).

**Invariants preserved.** The provider seam is intact; the synthetic path exercises the same code
through a discovered-brand pool and is still labelled illustrative; the `maxBrands` cap and
`compareBrandFit` ordering are unchanged; "verifiable information only" and "do not invent contacts"
above still govern every registry field.

**Superseded reading.** The opener "*If a local/curated registry is required*" is now read as: the
registry is required for **partnership routes**, not for **candidate selection**.

---

## 22. Partnership Routes

A brand opportunity should ideally provide an **actionable next step**.

### Possible routes

- creator program
- affiliate program
- ambassador program
- partnership application
- PR contact
- partnership page
- official contact page

The system should link to the **real source**.

If no creator-specific route exists, show **"Official contact route"** rather than pretending a
creator program exists.

---

## 23. Content Opportunity Engine

Content opportunities should be **deterministic**.

### Example

- **Creator category:** Fashion
- **Untapped taste:** Motorsport

Template combinations can generate:

- "Fashion × Motorsport"
- "Motorsport-inspired outfit"
- "What I'd wear to a Grand Prix"
- etc.

The implementation can use structured templates.

> ⚠️ Do not call this "AI-generated content" because there is no LLM.

---

## 24. Pitch Generator

The pitch generator should use **deterministic templates**.

### Input

```
Creator
+ Brand
+ Creator category
+ Taste signals
+ Opportunity
+ Potential collaboration type
```

### Output

Structured outreach message. **The pitch should be editable.**

### Do not fabricate

- follower counts
- engagement
- previous campaigns
- audience percentages
- brand relationships
- campaign results

**Only use supplied/verified information.**

---

## 25. Persistence

**No login is required.** A lightweight local persistence solution is acceptable for the hackathon.

Potentially: `localStorage` · session state · lightweight backend persistence · or another simple
mechanism.

The architecture should make **future database integration possible**.

Do not introduce authentication unless required.

---

## 26. Website + App

There are **two connected experiences**.

| Experience | Purpose |
| --- | --- |
| **Public website** | Explain the product and convince users/judges. |
| **Application** | Actually use CreatorsDNA. |

The website CTA should enter the app **without login**.

---

## 27. Public Website Content

The website should include:

1. Hero
2. Problem
3. Why traditional creator matching is incomplete
4. How CreatorsDNA works
5. Qloo explanation
6. Taste DNA example
7. Unexpected affinity example
8. Untapped opportunity example
9. Brand opportunity example
10. Product workflow
11. Future moat
12. CTA

The website should feel like a **real company/product website**.

---

## 28. Application UX

The app should feel like a **premium creator product**.

### Suggested flow

```
Welcome
→ Creator profile
→ Select interests
→ Audience signals
→ Analyze
→ Taste DNA
→ Unexpected affinities
→ Untapped opportunities
→ Brand opportunities
→ Brand detail
→ Pitch
→ Media kit
```

The implementation **can change this flow if a better UX is found**.

---

## 29. Design Principle

**Do not produce generic AI SaaS design.**

### Avoid

- generic purple gradients
- glowing AI brain
- robot illustrations
- excessive glassmorphism
- generic three-card sections
- endless rounded cards
- generic dashboard sidebar
- meaningless decorative blobs
- "AI magic" sparkles everywhere

### The visual language should be

creator-focused · editorial · cultural · visual · premium · confident · dynamic

> ⏳ **The exact theme will be provided later.** The implementation should be flexible enough to
> apply the final theme **without rewriting the application**.

---

## 30. Design System

Create **reusable components**. Examples:

- `EntityCard`
- `TasteChip`
- `TasteBubble`
- `AffinityBar`
- `OpportunityCard`
- `BrandCard`
- `ScoreBreakdown`
- `InsightSection`
- `CreatorHeader`
- `ContentThumbnail`
- `ProgressStep`
- `SearchEntity`
- `PitchEditor`
- `MediaKit`
- `QlooInsightBadge`

**Do not duplicate UI logic across pages.**

---

## 31. Responsive Design

- **Desktop** is the primary experience.
- The product **must also work on mobile**.
- Do not design mobile as an afterthought.

---

## 32. Performance

**Avoid unnecessary Qloo calls.** Use:

- debounced entity search
- caching where appropriate
- request deduplication
- sensible result limits
- loading states
- error states

**Do not call Qloo repeatedly for identical requests.**

---

## 33. Qloo Rate Limit / Failure Handling

If Qloo returns `429`, `5xx`, network error, invalid entity, or empty result — **handle
gracefully**.

The application should provide a useful message. Example:

> "We couldn't complete the cultural analysis right now. Please try again."

**Do not expose raw stack traces.**

---

## 34. Fallback Data

Fallback data **may** be used during development. However:

- The final product should use **real Qloo data** when the API is available.
- **Do not present mock Qloo data as real Qloo output.**
- If a fallback mode is implemented, keep it **clearly separated in code**.

---

## 35. API Documentation Discovery

Before implementing Qloo calls, inspect https://github.com/qloo/docs-public and specifically:

- `reference/api-overview.md`
- `reference/insights-api-deep-dive.md`
- `reference/taste-analysis.md`
- `reference/demographics-use-case.md`
- `openapi-schema.json`
- `recipes/`

Use the current schema to determine:

- exact routes
- parameters
- authentication
- response structures
- entity types
- filter syntax
- pagination
- explainability
- errors

> ⚠️ **Do not guess endpoint formats.**

---

## 36. Current Qloo Insights Concept

The current Qloo documentation describes the Insights API as **parameter-driven**.

### Relevant inputs include

```
signal.interests.entities
signal.interests.tags
signal.demographics.age
signal.demographics.gender
signal.demographics.audiences
signal.location
```

### Relevant output filtering can include

```
filter.type
filter.tags
filter.results.entities
filter.results.tags
etc.
```

> ⚠️ The exact implementation should be **validated against the OpenAPI schema**.

---

## 37. Explainability

Investigate `feature.explainability=true`.

If supported for the recommendation request being used, **enable it**.

Use returned explanation metadata to strengthen **"Why this?"**

> ⚠️ Do not make unsupported claims if explainability is unavailable.

---

## 38. Qloo Tags

Tags may be useful for Taste DNA.

The current Qloo documentation describes tag-based Insights and a tags search API. Use tags to
enrich the creator profile where useful.

### Potential flow

```
Creator entities
→ Qloo tag analysis
→ normalized taste tags
→ category grouping
→ Taste DNA
```

> ⚠️ Do not expose raw URNs unless useful in a technical/debug view.

---

## 39. Qloo Demographics

**Optional.**

If provided, Age · Gender · Location can influence recommendations.

> Do not make demographics mandatory because CreatorsDNA's main differentiator is **cultural taste**,
> not demographic targeting.

---

## 40. Location

Location may be used to improve relevance.

### Example

**Creator location:** Nepal

Then the following should be considered where supported:

- brand opportunity filtering
- location-aware Qloo recommendations
- regional partnership availability

**Do not assume global availability for every brand.**

---

## 41. Testing

Test at least several creator archetypes:

1. Fashion creator
2. Gaming creator
3. Fitness creator
4. Travel creator
5. Lifestyle creator

**Verify that the output changes meaningfully based on different inputs.**

> ⚠️ The same static recommendations must not appear for every creator.

---

## 42. Acceptance Criteria

The implementation is successful if:

1. A user can enter CreatorsDNA **without login**.
2. A user can search/select **real Qloo entities**.
3. The application **resolves** those entities.
4. The application performs **real Qloo analysis**.
5. **Taste DNA changes** based on the selected inputs.
6. **Discovered affinities are distinct** from explicit inputs.
7. **Untapped opportunities** are calculated deterministically.
8. **Brand recommendations** are based on actual data.
9. **Recommendation scores are explainable**.
10. **Brand recommendations change** based on creator signals.
11. The application explains **WHY** a brand is recommended.
12. **Partnership routes** use real/verifiable information.
13. **Pitch generation works without an LLM**.
14. **Qloo API credentials remain server-side**.
15. **API errors are handled gracefully**.
16. The **public website** clearly explains the product.
17. The website **CTA leads directly to the functional app**.
18. The visual design **does not look like generic AI-generated SaaS**.
19. The product works on **desktop and mobile**.
20. The application feels **complete enough to demonstrate as a real product**.

---

## 43. Development Priority

### P0

- Qloo integration
- Entity search
- Taste analysis
- Taste DNA
- Brand recommendations
- Deterministic scoring
- Explainability
- Core app flow

### P1

- Untapped opportunities
- Unexpected affinity visualization
- Content opportunities
- Partnership routes
- Pitch generator
- Media kit

### P2

- Outcome tracking
- Taste evolution
- Creator network
- Brand-side marketplace
- Advanced analytics

> ⚠️ This list differs from doc 01 §51 — see [§48](#48-reconciliation-notes).

---

## 44. Future Architecture

The architecture should leave room for:

- Creator outcome history
- Taste evolution
- Creator similarity
- Brand-side creator discovery
- Partnership conversion data

These are **not required** for the first implementation.

---

## 45. Product Quality Bar

Do not optimize for *"it technically works."*

Optimize for: **"It looks like a product someone could actually use."**

The final result should be polished enough that a creator could plausibly use it to understand their
audience's cultural identity and find partnership opportunities.

- The **website** should be presentation-quality.
- The **application** should be functional.
- The **Qloo integration** should be real.
- The **recommendation logic** should be understandable.
- The **design** should be memorable.

---

## 46. Important Implementation Rule

> If a requirement is ambiguous, choose the **simplest robust implementation** that preserves the
> product's core idea.

**Do not introduce complexity simply to make the project look technically impressive.**

The strongest technical story is:

```
Qloo cultural intelligence
+ deterministic product intelligence
+ real data
+ excellent UX
```

---

## 47. Final Architectural Principle

CreatorsDNA is **not** an AI chatbot.
CreatorsDNA is **not** a media kit.
CreatorsDNA is **not** an influencer database.

**CreatorsDNA is a cultural intelligence product.**

- **Qloo** provides the cultural intelligence.
- **CreatorsDNA** converts that intelligence into creator decisions.

The application should make that relationship **obvious throughout the product**.

---

## 48. Reconciliation Notes

Divergences between this document and [`01-product-context.md`](01-product-context.md). Flagged for
explicit resolution before implementation — **not** silently resolved.

| # | Topic | Doc 01 | Doc 02 | Note |
| --- | --- | --- | --- | --- |
| A | **Public website priority** | §51 lists "Beautiful public website" as **P0 #1** | §43 P0 list **omits the website entirely**; §27/§42 (#16–17)/§45 still require a presentation-quality site | Likely doc 02 is scoping P0 to *engineering* effort while the website remains a hard acceptance criterion. **Needs confirmation.** |
| B | **Unexpected affinities priority** | §51 lists "Unexpected affinities" as **P0 #6** | §43 places "Unexpected affinity **visualization**" in **P1**; detection is implied by Taste DNA (P0) | Read as: *detection* is P0, *rich visualization* is P1. **Needs confirmation.** |
| C | **Design "avoid" list** | §39 avoids robot illustrations, glowing brain, gradient blobs, AI sparkles, generic 3D shapes | §29 adds generic purple gradients, excessive glassmorphism, endless rounded cards, meaningless decorative blobs | **Additive, no conflict.** Union of both lists applies. |
| D | **Scoring weights** | §13 — 45/20/15/10/10 | §15 — 45/20/15/10/10 | **Identical.** Both state weights are tunable. |
| E | **Brand record shape** | §16 field list includes `brand_name`, `shipping_region`, `supported_creator_types`, Qloo tags | §21 JSON example uses `name`, and omits those three fields | §21 is an *example* structure, not an exhaustive schema. Use the **union**, with §21 naming as the JSON convention. |
| F | **App flow** | §30 — 14 steps, "exact navigation can be refined" | §28 — 12 steps, "can change this flow if a better UX is found" | **Consistent.** Both explicitly permit refinement. |

### Newly specified in doc 02 (no doc 01 counterpart)

- Concrete Qloo documentation URLs and the instruction to derive schema from `openapi-schema.json`
  (§4, §35)
- Named Qloo parameters: `signal.interests.entities`, `filter.type = urn:tag`,
  `feature.explainability=true` (§9, §11, §36, §37)
- Supported entity type list (§6)
- Backend route naming convention `/api/qloo/*`, `/api/analyze` (§13)
- Explicit **no random/fake scoring** rule with defined missing-data behaviour (§16)
- Deterministic threshold requirement for "unexpected" classification (§18)
- Reusable component inventory (§30)
- Performance requirements: debounce, cache, dedupe (§32)
- Specific HTTP failure codes to handle (§33)
- Five test archetypes and the "output must change per input" rule (§41)
- 20-point acceptance criteria (§42)
- "Simplest robust implementation" tie-breaker rule (§46)

### Post-spec implementation amendments (user-approved)

Changes introduced *after* this spec was written, at the user's direction — recorded here so §48
stays the single place to reconcile the docs against the shipped system. These are amendments, not
silent rewrites: the original sections stand and are cross-referenced.

| Date | Section | Amendment |
| --- | --- | --- |
| 2026-10-24 | §21 Brand Registry | The scored/ranked brand set is now **Qloo-discovered** (`filter.type = urn:entity:brand`) in live mode; the curated registry is **demoted to partnership-route enrichment** (merge on `qlooEntityId`, else `discovered: true` with `partnership: null`). Undiscovered registry brands are no longer injected into the affinity ranking. Full decision + rationale in the §21 amendment note. |
