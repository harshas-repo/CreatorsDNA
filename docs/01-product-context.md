# CreatorsDNA — Product Context

> **Document 01 of the CreatorsDNA context set.**
> This is the canonical product context. Every feature built, changed, or reviewed must be
> consistent with this document. Additional context documents will be added to `docs/` and
> indexed in [`AGENTS.md`](../AGENTS.md).
>
> **Status:** Context only. Do not implement from this document until an explicit build
> instruction is given.
> **Pending inputs:** visual design theme (noted as "provided separately" in §39), Qloo API
> credentials and confirmed endpoint list (§18).

---

## 1. Product Name

**CreatorsDNA** — a cultural intelligence platform for content creators.

### Core idea

Creators usually understand their own content niche, but they do not necessarily understand the
broader cultural tastes and interests of the audience around their content.

CreatorsDNA uses Qloo's cultural intelligence to transform a creator's explicit interests and
content signals into a richer **Taste DNA**, discover unexpected cultural affinities, identify
untapped content opportunities, and connect those affinities to relevant brand partnership
opportunities.

### The product is NOT simply

- a creator media kit generator
- an influencer database
- a brand database
- an email outreach tool
- a generic AI recommendation engine
- a social media analytics dashboard
- a chatbot

Those may be supporting capabilities, but they are not the core product.

### The core product is the pipeline

```
CREATOR SIGNALS
→ QLOO CULTURAL INTELLIGENCE
→ TASTE DNA
→ UNEXPECTED AFFINITIES
→ UNTAPPED OPPORTUNITIES
→ BRAND OPPORTUNITIES
→ ACTION
```

---

## 2. One-Line Product Description

CreatorsDNA helps creators discover what their audience is culturally connected to — beyond their
obvious niche — and turns those hidden affinities into new content and brand opportunities.

---

## 3. Core Product Promise

The central promise is:

> "Your niche tells you what you create.
> Your audience's taste tells you where you can go next."

**Alternative positioning:**

> "Turn your audience's cultural taste into your next opportunity."

**Another possible explanation:**

> "Most creator tools tell you who your audience is. CreatorsDNA helps you understand what your
> audience culturally belongs to — and what opportunities that creates."

The product should communicate that it is about **discovering hidden relationships** rather than
simply categorizing creators.

---

## 4. The Problem

Creators increasingly depend on partnerships, sponsorships, affiliate opportunities, and audience
growth.

The problem is not simply that creators don't know how to contact brands.

The deeper problem is that creators are usually forced to describe themselves through relatively
narrow categories:

- Fashion creator
- Fitness creator
- Gaming creator
- Travel creator
- Food creator
- Tech creator
- Lifestyle creator
- Beauty creator
- Music creator

Those labels are useful, but incomplete.

A creator may create fashion content while their audience also has strong affinities toward:

- sneakers
- hip-hop
- motorsport
- gaming
- movies
- travel
- technology
- food
- specific brands
- specific cultural figures

Traditional creator discovery and influencer tools tend to focus heavily on:

- follower count
- engagement
- demographics
- niche/category
- keywords
- platform
- location

Those signals tell us **WHAT** the creator does and **WHO** follows them. They do not fully explain
the cultural ecosystem around that audience.

### Missed opportunities this creates

1. Creators may never discover adjacent content categories their audience could respond to.
2. Creators may approach only obvious brands in their niche.
3. Creators may miss unexpected brand partnerships that are culturally relevant.
4. Creators may not understand why an apparently unrelated brand could actually fit their audience.
5. Creators may have audience interests that are significantly broader than the creator's own
   content positioning.

### Example

A creator identifies as: **"Men's fashion + lifestyle"**

A conventional system may recommend: Nike, Adidas, Zara, H&M, fashion retailers.

CreatorsDNA might discover that the creator's cultural taste also has strong relationships with:
sneakers, hip-hop, gaming, motorsport.

That creates additional opportunities. The product should be able to say:

> "You are a fashion creator, but your audience's cultural taste suggests a strong motorsport
> affinity that is currently underrepresented in your content."

That is the type of insight we want.

---

## 5. Why Qloo Is Fundamental

Qloo is **NOT** a decorative API integration. Qloo is the **central intelligence layer**.

Without Qloo, the product should lose its most important capability.

The product should not simply send creator information to an LLM and ask it to recommend brands.

- There will be **NO** dependency on an LLM API.
- The only AI/cultural intelligence engine is **Qloo**.
- Everything else should be deterministic logic, API integration, structured data processing,
  rules, scoring, filtering, templates, or automation.

The key reason Qloo matters is that it can connect cultural entities and interests **across
categories**.

### Example

Creator explicitly provides:

- Nike
- Formula 1
- Travis Scott
- fitness

Qloo can be used to discover related cultural entities/tags and cross-category relationships. The
product then uses those Qloo-derived signals to construct the creator's Taste DNA.

The important transformation is:

```
EXPLICIT CREATOR SIGNALS
→ QLOO CULTURAL GRAPH
→ RELATED/CONNECTED INTERESTS
→ CROSS-CATEGORY TASTE
→ OPPORTUNITY DISCOVERY
```

Qloo should therefore be deeply integrated into the product's logic.

---

## 6. No LLM API

This is an explicit technical constraint.

**DO NOT** assume access to:

- OpenAI API
- Claude API
- Gemini API
- Groq
- Bedrock
- any external generative AI API

The product should work without an LLM.

Natural-language-looking explanations should be produced through **deterministic templates
populated with real data**.

### Example

Instead of: *"An LLM thinks Nike would be a good fit."*

Use structured reasoning:

| Factor | Score |
| --- | --- |
| Taste overlap | 94 |
| Content compatibility | 88 |
| Audience alignment | 91 |
| Geographic relevance | 95 |
| Opportunity gap | 72 |

Then a deterministic template can produce:

> "Your audience shows strong affinity with sneaker and streetwear culture, while your current
> content already covers fashion and lifestyle. This creates a strong cultural fit with Nike."

The wording can be template-based.

---

## 7. Core Product Concept: Taste DNA

Every creator should receive a Taste DNA profile.

Taste DNA is **NOT** simply the list of things the creator entered. It is the **expanded cultural
profile derived through Qloo**.

### Example

**Creator input:** Fashion, Nike, Formula 1, Travis Scott, Fitness

**Qloo expansion:** Sneakers, Streetwear, Hip-hop, Motorsport, Gaming, Fitness culture, Premium
lifestyle, etc.

### The interface must distinguish

**EXPLICIT SIGNALS** — things the creator directly selected.

**DISCOVERED AFFINITIES** — things CreatorsDNA discovered through Qloo.

This distinction is extremely important.

We should never imply that Qloo measured the creator's followers directly if it did not.

**Use language such as:**

- "Qloo-derived cultural affinity"
- "Discovered cultural connection"
- "Modelled taste signal"
- "Based on the interests you provided"

**Do NOT claim:**

- "Your followers definitely love X"

…unless the product actually has first-party audience data proving that.

---

## 8. Taste DNA Structure

A creator's Taste DNA can contain several layers.

### Core tastes

Strongest cultural signals. *Examples:* Fashion, Fitness, Music, Gaming.

### Cultural connections

Related interests discovered through Qloo. *Examples:* Streetwear, Sneakers, Hip-hop, Motorsport.

### Emerging / adjacent signals

Interesting areas that are not currently central to the creator's identity. *Examples:* Travel,
Grooming, Gaming, Technology.

### Unexpected affinities

The most interesting discoveries. These are signals that the creator did not explicitly enter but
that Qloo identifies as culturally related.

---

## 9. The "Unexpected Affinity" Concept

This should be one of the **signature product features**.

CreatorsDNA should actively look for things that are:

- relevant
- culturally connected
- not obvious from the creator's primary niche

### Example

**Creator:** Fashion + Lifestyle

**Taste DNA:** Fashion, Sneakers, Music, Motorsport, Gaming

The system should identify **"Motorsport"** as an unexpected or adjacent affinity if it is strong in
Qloo results but not part of the creator's explicitly provided inputs.

The UI should make this visually interesting.

### Potential wording

- "Something you may not have expected"
- "Your hidden affinity"
- "Beyond your niche"
- "An unexpected connection"
- "Where your audience could take you next"

Avoid making unsupported claims about actual followers.

---

## 10. Untapped Opportunity

This is a **deterministic** concept.

The product should compare:

1. What the creator currently says they create
2. What their Qloo-derived Taste DNA suggests

If a cultural area has:

```
HIGH QLOO AFFINITY
+
LOW CURRENT CONTENT COVERAGE
```

…then it becomes an **Untapped Opportunity**.

### Example

**Creator content:** Fashion, Lifestyle, Fitness

**Qloo-derived taste:**

| Taste | Score |
| --- | --- |
| Fashion | 94 |
| Sneakers | 91 |
| Music | 88 |
| Motorsport | 84 |
| Gaming | 80 |

**Current content coverage:**

| Taste | Coverage |
| --- | --- |
| Fashion | High |
| Lifestyle | High |
| Fitness | High |
| Motorsport | Low |
| Gaming | Low |

The system can identify **MOTORSPORT** as an untapped opportunity.

The UI should explain:

> "Strong cultural affinity, but limited representation in your current content."

This is deterministic. No LLM is required.

---

## 11. Content Opportunity

The system can translate untapped affinities into content directions.

### Example

**Untapped affinity:** Motorsport

**Possible deterministic content concepts:**

- Motorsport-inspired fashion
- What I'd wear to a Grand Prix
- F1-inspired streetwear
- Racing culture × lifestyle
- Sneaker culture × motorsport

These can be generated from structured templates. Do not require an LLM.

Content concepts should be based on predefined combinations of:

```
creator category
+
taste category
+
brand category
```

The system should clearly distinguish **"Suggested direction"** from **"AI-generated idea"**.

---

## 12. Brand Opportunity

Brands are the commercial opportunity layer.

The goal is not: *"Find any brand."*

The goal is: *"Find brands that make cultural sense for this creator."*

- **Primary opportunity entity:** BRAND
- **Potential future entities:** destinations, places, events, entertainment properties,
  experiences

But the first version should focus primarily on brands.

---

## 13. Brand Recommendation Logic

Brand recommendations should use a **deterministic scoring system**.

### Example weights

| Factor | Weight |
| --- | --- |
| Taste Fit | 45% |
| Audience/Demographic Fit | 20% |
| Content Compatibility | 15% |
| Geographic Fit | 10% |
| Opportunity Gap | 10% |

These weights can be adjusted after implementation/testing.

The score should **NOT** simply equal Qloo's score.

Qloo provides cultural/taste signals. CreatorsDNA combines those signals with product-specific
factors.

```
CREATOR-BRAND FIT SCORE

Qloo cultural affinity
+ content compatibility
+ demographic alignment
+ location compatibility
+ opportunity gap
= CreatorsDNA score
```

**Each recommendation must have an explanation.**

---

## 14. Brand Recommendation UI

### Example

```
NIKE
94% Creator Fit

Taste alignment        95
Content compatibility  91
Audience alignment     89
Opportunity potential  93

WHY IT FITS
"Your creator profile has strong affinity with sneaker and streetwear culture, while your
content already overlaps with fashion and lifestyle."

PARTNERSHIP ROUTES
Affiliate · Ambassador · Creator partnerships · PR/contact · etc.
```

These routes should come from **structured real data**.

---

## 15. "Unexpected Brand" Feature

There should be a section specifically for **non-obvious** recommendations.

### Example

```
UNEXPECTED OPPORTUNITY

Gaming Brand X
87% Fit

"You might not have searched for this brand based on your current niche. Your Taste DNA shows
strong connections between gaming, streetwear and music culture."
```

This is important because it demonstrates the unique value of Qloo.

If the system only recommends obvious brands, it looks like a standard influencer marketplace.

---

## 16. Brand Data

**Do not build a massive fake database. Use real brand information.**

For the initial implementation, a smaller curated set is acceptable.

### Each brand record can contain

- `brand_name`
- `category`
- `website`
- `country` / `region`
- `partnership_route`
- `affiliate_route`
- `ambassador_route`
- `creator_program_url`
- `application_url`
- `contact_route`
- `shipping_region`
- `supported_creator_types`
- Qloo-related entities/tags if available
- `verification_date`

The application should **not invent contact information**. If a partnership route cannot be
verified, **do not fabricate it**.

The system can initially support a manageable real dataset. Potentially **50–200 brands** is
sufficient for a meaningful prototype depending on implementation time.

The dataset should be structured so it can easily be expanded later.

---

## 17. Creator Input

The application should **not require login**. No authentication is required for the hackathon
version. A creator should be able to try the product immediately.

Onboarding should feel like a **creator product**, not a corporate enterprise form.

### Potential flow

| Step | Prompt |
| --- | --- |
| 1 | What do you create? |
| 2 | What defines your content? |
| 3 | Choose things you love / feature / reference. |
| 4 | Tell us about your audience if you know it. |
| 5 | Generate Taste DNA. |

---

## 18. Qloo Entity Search

Users should be able to search for Qloo entities.

**Examples:** Nike, Adidas, Formula 1, Travis Scott, Marvel, GTA, Friends, The Weeknd, etc.

The application should use Qloo entity search to resolve user-selected entities into valid Qloo
IDs.

**Do not hardcode Qloo IDs** if the API provides a reliable entity search mechanism.

The system should store the selected entity:

- display name
- entity ID
- entity type
- entity category
- possibly image/metadata if available

> ⚠️ The exact entity types and supported Qloo endpoints should be **confirmed against the current
> Qloo API documentation before implementation**.

---

## 19. Qloo Data Flow

The intended conceptual flow is:

```
CREATOR INPUT
  ↓
QLOO ENTITY SEARCH        — Resolve user selections.
  ↓
QLOO TASTE / INSIGHTS     — Expand signals into related tastes, tags and entities.
  ↓
TASTE DNA CONSTRUCTION    — Normalize and rank returned signals.
  ↓
CROSS-CATEGORY DISCOVERY  — Use the strongest taste signals to discover relevant entities
                            in other categories, especially brands.
  ↓
DEMOGRAPHIC VALIDATION    — If audience demographics are supplied, use available Qloo
                            demographic capabilities where appropriate.
  ↓
DETERMINISTIC FIT ENGINE  — Combine Qloo affinity with product-specific scoring.
  ↓
RESULTS
  • Taste DNA
  • Unexpected affinities
  • Untapped opportunities
  • Brand opportunities
  • Content directions
```

---

## 20. Qloo Should Be Visible

The product should make it clear that Qloo is actually doing meaningful work.

**Do not** simply have "Powered by Qloo" in a footer.

Instead, the interface can show:

- "Qloo discovered"
- "Qloo cultural connection"
- "Cross-category affinity"
- "Derived through cultural relationships"

### Example

**Creator selected:** Fashion, Nike, F1

**Qloo discovered:** Sneakers, Streetwear, Hip-hop, Motorsport, Gaming

Then show the relationship **visually**.

This helps judges understand that Qloo is not just an API wrapper.

---

## 21. No Generic AI Chatbot

**Do NOT add a chatbot.** There is no reason for the creator to "chat with AI."

The experience should be an intentional **guided product workflow**.

The intelligence should appear through:

- discovery
- ranking
- explanations
- recommendations
- comparisons
- opportunity detection

…not through a chat window.

---

## 22. No Generic Dashboard

Do not make this look like: *Sidebar · Dashboard · Analytics · Reports · Settings* with cards
everywhere.

CreatorsDNA should feel like a **consumer-facing creator platform**.

Think more like:

- YouTube Studio
- Instagram
- Spotify Wrapped
- modern creator tools
- premium media platforms

…but do **NOT** copy their interfaces. The design should have a strong visual identity of its own.

---

## 23. Public Website

The product should have a **public-facing website AND an actual working application**.

The public website should communicate:

1. What CreatorsDNA is
2. The problem
3. Why existing creator discovery is incomplete
4. How cultural taste changes the problem
5. How Qloo powers the system
6. What the Taste DNA concept means
7. How brand opportunities work
8. Example output
9. Future potential
10. A clear CTA to try the application

The website should feel like the site of a **real startup/company**. It should not feel like a
hackathon landing page template.

---

## 24. Website Hero

**Potential core message:**

> "Your niche tells you what you create.
> Your audience's taste tells you where you can go next."

- **CTA:** "Discover My Taste DNA"
- **Secondary CTA:** "See How It Works"

The hero should visually communicate cultural connections.

**Avoid generic AI imagery. Avoid:**

- robot illustrations
- glowing brain
- generic gradient blobs
- floating AI sparkles
- generic 3D shapes

**Instead use:**

- creator/content imagery
- editorial layouts
- cultural entity cards
- taste connections
- visual relationship maps
- creator profile elements
- content thumbnails
- brand cards
- dynamic typography
- layered visual composition

---

## 25. Website Problem Section

Show the difference between:

**WHAT YOU CREATE** — and — **WHAT YOUR CULTURAL AUDIENCE CONNECTS WITH**

### Example

**Creator says:** Fashion, Lifestyle

**CreatorsDNA discovers:** Sneakers, Music, Motorsport, Gaming, Travel

Then explain:

> "Your niche is only the starting point."

---

## 26. Website Qloo Section

This section should explain Qloo in **product language**. Do not make it overly technical.

Show:

```
Creator signals
  ↓
Qloo cultural intelligence
  ↓
Connected interests
  ↓
Taste DNA
  ↓
Opportunities
```

Include a **real example**.

The purpose is to make the Qloo implementation obvious to judges.

---

## 27. Website Product Demo Section

Show screenshots/mockups of:

- Taste DNA
- Unexpected affinities
- Untapped opportunities
- Brand recommendations
- Why this brand
- Pitch generation

These should reflect the **actual application UI**.

> ⚠️ Do not make fake screenshots that differ from the actual product.

---

## 28. Website "Why It Is Different"

Possible comparison:

| Traditional creator tools | CreatorsDNA |
| --- | --- |
| Follower count | Cultural taste |
| Engagement | Cross-category affinity |
| Demographics | Unexpected interests |
| Niche | Untapped opportunities |
| Keywords | Taste-based brand fit |

The comparison should be **visually strong and concise**.

---

## 29. App Entry

The public site should have a prominent CTA: **"Try CreatorsDNA"**

- No login.
- No signup.
- The user should enter the actual application immediately.

---

## 30. Application Structure

Potential app flow:

1. Welcome
2. Creator profile
3. Content category
4. Entity selection
5. Audience information
6. Taste analysis
7. Taste DNA
8. Unexpected affinities
9. Untapped opportunities
10. Brand opportunities
11. Opportunity detail
12. Partnership route
13. Generate pitch
14. Creator media kit / profile

The exact navigation can be refined during implementation.

---

## 31. Creator Profile

The creator can provide:

- Name
- Creator handle
- Platform
- Category
- Location
- Optional profile image
- Optional audience demographics

This should be enough to personalize the output.

Do not require OAuth for the hackathon unless it is easy and reliable. The first version should
work **without account creation**.

---

## 32. Media Kit

A lightweight media kit can be generated from the profile.

### Example

```
CREATOR NAME
@handle

Fashion × Lifestyle

AUDIENCE
18–24
70% male
Nepal

TASTE DNA
Sneakers · Music · Motorsport · Gaming

TOP OPPORTUNITIES
Nike · Brand X · Brand Y

UNEXPECTED AFFINITY
Motorsport
```

This should be **shareable/exportable** if practical.

---

## 33. Pitch Generation

**No LLM. Use deterministic templates.**

### Example structure

1. Greeting
2. Creator introduction
3. Audience/cultural fit
4. Why the brand is relevant
5. Suggested collaboration
6. Call to action

The system should dynamically insert:

- creator name
- creator category
- relevant taste signals
- brand
- brand category
- recommended opportunity
- potential collaboration type

> ⚠️ Do not claim factual performance metrics that the creator has not supplied.

---

## 34. Outcome Tracking — Future Moat

The long-term product should learn from outcomes.

For each recommendation, track: Brand · Recommendation score · Creator action · Contacted ·
Replied · Meeting · Deal · Campaign · Outcome.

This creates:

```
TASTE → OPPORTUNITY → ACTION → OUTCOME
```

Over time this can improve recommendations.

This should be represented in the product **roadmap**, but does not need to be fully implemented in
the first version unless time permits.

---

## 35. Long-Term Moat

The potential moat is **NOT** simply the brand database.

### Potential moat layers

1. Creator Taste DNA profiles
2. Qloo-derived cultural relationship modeling
3. Untapped opportunity detection
4. Creator-specific opportunity history
5. Partnership outcome data
6. Taste-to-brand conversion patterns
7. Opt-in creator network
8. Brand-side taste-based creator discovery

### Long-term

- **Creator side:** "What opportunities fit me?"
- **Brand side:** "Which creators fit us?"

Both sides use the **same taste compatibility infrastructure**.

---

## 36. Future Brand Side

**Do not prioritize this in the initial implementation.**

Eventually a brand could enter: Brand · Category · Target audience · Cultural interests · Location
· Campaign type.

CreatorsDNA could find creators whose audiences have compatible cultural taste.

This becomes:

```
CREATOR ↔ AUDIENCE ↔ CULTURE ↔ BRAND
```

rather than:

```
CREATOR ↔ NICHE ↔ BRAND
```

This is a potential future marketplace.

---

## 37. Important Claims and Honesty

> **Never claim that Qloo directly knows the creator's actual followers unless the product has
> connected first-party audience data.**

**Use accurate wording:**

- "modelled taste"
- "cultural affinity"
- "based on your selected signals"
- "Qloo-derived"
- "audience taste hypothesis"
- "cultural relationship"

**Avoid unsupported statements such as:**

- ❌ "Your followers love gaming."

**Instead:**

- ✅ "Your selected interests show a strong cultural connection with gaming."

**If demographics are provided:**

- ✅ "Your audience profile strengthens this match."

---

## 38. Product Personality

CreatorsDNA should feel:

> Confident · Cultural · Visual · Modern · Creator-first · Editorial · Smart · Useful · Curious ·
> Premium

It should **NOT** feel:

> Corporate · Enterprise SaaS · Generic AI · Overly technical · Data-heavy · Boring ·
> Template-generated · "AI startup landing page"

---

## 39. Visual Design Direction

> ⏳ **The exact visual theme will be provided separately.**

For now, preserve the following principle:

**The product must be visually appealing and distinctive.** It should use multiple visual elements
rather than a simple grid of cards.

### Possible visual ingredients

- creator profile imagery
- content thumbnails
- entity chips
- taste bubbles
- relationship lines
- editorial typography
- asymmetric sections
- large numbers
- cultural entity cards
- brand cards
- visual comparisons
- progress/reveal animations
- interactive taste map
- horizontal scrolling sections
- layered content
- strong visual hierarchy

Avoid generic SaaS patterns.

> ⚠️ Do not create a page where every section is: *icon → heading → paragraph → three cards*.
> That would look like AI-generated website design.

---

## 40. Animation

Animation should be **intentional**.

### Possible moments

- Taste signals appearing one by one
- Qloo relationships connecting
- Taste DNA assembling
- Affinity scores revealing
- Opportunity cards sliding into view
- Untapped opportunity being highlighted
- Brand recommendation ranking appearing

**Use motion to communicate discovery.** Do not over-animate the entire site.

---

## 41. Responsiveness

The application should be responsive.

- **Desktop** is the primary hackathon presentation environment.
- It should also remain usable on **tablet/mobile**.

---

## 42. Data Architecture

Keep the architecture **simple and maintainable**.

### Potential data models

- `CreatorProfile`
- `CreatorSignal`
- `QlooEntity`
- `TasteSignal`
- `TasteAffinity`
- `Opportunity`
- `Brand`
- `BrandPartnershipRoute`
- `Recommendation`
- `Pitch`
- `Outcome`

Use structured JSON/data files or a lightweight local persistence approach if a database is
unnecessary for the hackathon.

> ⚠️ Do not introduce unnecessary backend complexity.

---

## 43. API Security

**Qloo API credentials must NEVER be exposed in client-side code.**

- If a backend/proxy is needed, use one.
- Never hardcode secrets.
- Use environment variables. Example: `QLOO_API_KEY`
- Do not commit secrets.

---

## 44. Error Handling

The product should gracefully handle:

- Qloo API failure
- invalid entity
- no recommendations
- rate limit
- network failure
- missing optional demographics
- brand without partnership route
- empty result

> ⚠️ Never show raw API errors to the user. Use friendly product messages.

---

## 45. Loading Experience

The Qloo analysis may take time. **Do not show a generic spinner.**

Make the loading state part of the product story. Example:

- Mapping your interests...
- Finding cultural connections...
- Exploring adjacent tastes...
- Looking beyond your niche...
- Identifying opportunity gaps...
- Building your Taste DNA...

This should feel like the product is genuinely performing an analysis.

---

## 46. Important Product Principle

**Every result should answer: "Why should I care?"**

Do not show raw Qloo results. Translate them into useful creator decisions.

| ❌ Bad | ✅ Good |
| --- | --- |
| "Affinity score: 0.83" | "Strong cultural connection with motorsport, but this interest is currently underrepresented in your content." |
| "Brand X — 0.89" | "Brand X is a strong match because its cultural audience overlaps with three of your strongest taste signals." |

---

## 47. The Core User Journey

The ideal demo should be:

```
LAND ON WEBSITE
  ↓  Understand the problem
  ↓  See why niche isn't enough
  ↓  Understand Qloo-powered Taste DNA
  ↓  Click "Try CreatorsDNA"
  ↓  Enter creator information
  ↓  Select several real Qloo entities
  ↓  Optionally add audience demographics
  ↓  Run analysis
  ↓  See Taste DNA
  ↓  Discover unexpected affinity
  ↓  See untapped opportunity
  ↓  Find brand opportunities
  ↓  Open a brand
  ↓  See WHY it fits
  ↓  Find partnership route
  ↓  Generate personalized pitch
  ↓  Optionally view creator media kit
```

The entire journey should feel **coherent**.

---

## 48. Hackathon Demonstration Goal

The judge should walk away understanding:

1. Creators have a problem beyond basic analytics.
2. CreatorsDNA identifies a deeper cultural profile.
3. Qloo is essential to discovering that profile.
4. Qloo enables cross-category relationships.
5. CreatorsDNA converts those relationships into actionable opportunities.
6. The system does not depend on an LLM.
7. The application is genuinely usable.
8. There is a credible path from prototype to real product.

---

## 49. What Makes This Different

The product should **NOT** be presented as:

> ❌ "An AI tool that helps creators find brands." — *too generic*

Instead:

> ✅ "CreatorsDNA is a cultural intelligence layer for creators."

or

> ✅ "CreatorsDNA discovers the cultural DNA behind a creator's content and turns it into new
> opportunities."

The strongest conceptual difference is:

```
Traditional:
Creator → niche → brand

CreatorsDNA:
Creator → cultural signals → Qloo → Taste DNA → hidden affinities
        → untapped content → brand opportunity
```

---

## 50. What NOT to Build

Do **NOT** build:

- generic chatbot
- generic AI assistant
- generic analytics dashboard
- fake follower analytics
- fake audience data
- huge fake brand database
- fabricated emails
- fabricated brand partnership information
- fake Qloo results
- generic "AI-generated" explanations
- unnecessary authentication
- unnecessary social media OAuth
- complex backend infrastructure unless needed
- fake creator marketplace
- fake campaign management platform
- generic media kit as the main product

The product should remain **focused**.

---

## 51. Priority Order

If development time becomes limited, prioritize:

### P0 — MUST HAVE

1. Beautiful public website
2. Working creator onboarding
3. Qloo entity search
4. Qloo taste/insight integration
5. Taste DNA
6. Unexpected affinities
7. Deterministic opportunity scoring
8. Brand recommendations
9. Explainable "why this fits"
10. No-login working experience

### P1 — SHOULD HAVE

11. Untapped opportunity detection
12. Content opportunity suggestions
13. Partnership routes
14. Deterministic pitch generation
15. Media kit

### P2 — FUTURE / ROADMAP

16. Outcome tracking
17. Taste evolution
18. Creator network
19. Brand-side discovery
20. Learned taste-to-deal conversion model

---

## 52. Final Product Definition

CreatorsDNA is a **creator-first cultural intelligence platform**.

It starts with simple creator signals. Qloo expands those signals into a richer cultural graph.
CreatorsDNA turns that graph into:

```
Taste DNA
+ Unexpected affinities
+ Untapped content opportunities
+ Brand opportunities
+ Actionable partnership routes
```

The fundamental insight is:

> A creator's niche is only a surface-level description. The deeper opportunity lies in
> understanding the cultural relationships surrounding that niche.

CreatorsDNA exists to expose those relationships and make them actionable.

---

## 53. Build Philosophy

When implementation begins:

1. Do not rush to create screens.
2. First understand the full product flow.
3. Then verify what the available Qloo API actually supports.
4. Then design the data flow.
5. Then implement the Qloo integration.
6. Then implement deterministic scoring.
7. Then build the application UI around actual data.
8. Then build the public marketing website around the actual product.

> The final result must feel like **a real product that happens to have been created for a
> hackathon**, not like a hackathon project pretending to be a product.

- The product must be **functional**.
- **Real Qloo calls** should drive the core intelligence.
- No fake Qloo responses should be used in the final demo if the API is available.
- If mock/fallback data is necessary for development or API failure, **clearly isolate it as
  fallback behavior** and ensure the real path works.

---

## 54. Final Experience Principle

The most important feeling we want the user to have is:

> **"I thought I knew my niche, but I didn't realize my audience could take me here."**

That moment is the heart of CreatorsDNA.
