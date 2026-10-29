# CreatorsDNA — Visual Design & Interaction Skill

> **Document 05 of the CreatorsDNA context set.**
> The visual direction and experience principles for the product. Supplied by the user 2026-10-22.
> **Binding** on all UI, website, visualisation, and motion work.
>
> Supplements [`01-product-context.md`](01-product-context.md), [`02-technical-spec.md`](02-technical-spec.md),
> [`03-qloo-api-reference.md`](03-qloo-api-reference.md) and [`04-decisions-and-readiness.md`](04-decisions-and-readiness.md).
> See [§18 Reconciliation Notes](#18-reconciliation-notes) for how this document relates to the earlier four.
>
> **This document resolves outstanding decision R5** (visual theme), which both 01 §39 and 02 §29 had
> deferred as "provided separately". It also supplies new evidence bearing on R3 (website priority).
>
> Status: **Context only. No implementation authorised.**

---

## Purpose

Design CreatorsDNA as a distinctive, colorful, interactive platform for content creators. The
experience should combine the visual energy of modern creative brands and entertainment platforms with
the clarity and usefulness of a sophisticated data exploration product.

CreatorsDNA helps creators discover their cultural interests, uncover unexpected affinities, identify
new content opportunities, and explore relevant brand partnerships using Qloo's cultural intelligence.

The design must communicate **creativity, exploration, discovery, and possibility**. It must not look
like a generic AI SaaS product, a traditional analytics dashboard, or a website designed exclusively
for one type of creator.

This skill defines the visual direction and experience principles. It **does not prescribe** a specific
framework, animation library, charting library, or implementation architecture. Inspect the existing
repository and choose appropriate technologies that fit the project.

---

## 1. Overall Creative Direction

The central concept is **a colorful universe of creativity**.

The visual identity should combine two complementary styles:

**A. Expressive 3D visual design**
Use abstract, dimensional, playful, polished shapes that appear to exist in a carefully art-directed
creative world.

**B. Bold graphic storytelling**
Combine those shapes with expressive typography, colorful backgrounds, overlapping compositions,
asymmetric layouts, and visually engaging transitions.

The result should feel like a modern creative platform rather than a conventional software company.

Take inspiration from the energy and visual variety of modern entertainment brands, creator platforms,
experimental digital studios, contemporary editorial design, and polished 3D motion graphics. Use these
as **general creative references, not as templates to copy**.

The experience should feel colorful, immersive, playful, sophisticated, and intentional.

It must be appropriate for creators working across gaming, education, technology, comedy, beauty,
travel, food, music, fitness, filmmaking, lifestyle, and many other categories.

**Do not make any one industry the visual identity of the entire product.**

---

## 2. Abstract 3D Shapes — The Signature Visual Language

Abstract 3D shapes are **one of the most important elements** of the CreatorsDNA identity.

They should be used as recognizable brand assets throughout the public website, hero section,
storytelling sections, transitions, and selected areas of the application.

The shapes should feel dimensional, tactile, expressive, and carefully designed rather than like random
stock illustrations.

Explore forms such as:

- Glossy spheres and imperfect organic balls.
- Inflated, pillowy geometric forms.
- Twisted ribbons and looping tubes.
- Smooth liquid-like sculptures.
- Rounded cubes and softened geometric structures.
- Interlocking rings and curved loops.
- Translucent glass-like shapes.
- Layered, folded, or twisted surfaces.
- Floating droplets and abstract particles.
- Sculptural forms that blend multiple colors.
- Compositions combining solid, translucent, matte, metallic, and glossy materials.

These shapes should have convincing volume, smooth surfaces, nuanced lighting, reflections, shadows, and
depth.

Some objects can look like polished plastic, some like translucent colored glass, and others like soft,
inflated material. **Contrast between materials makes compositions more interesting.**

Use carefully controlled lighting, ambient occlusion where appropriate, soft shadows, highlights,
reflections, and subtle depth of field when it helps the composition.

⚠️ **Avoid making everything chrome, metallic, or glass.** The material variety should feel curated.

Shapes should vary in scale and form. Combine a few visually dominant objects with smaller supporting
forms to establish a clear composition and focal point.

Use asymmetry, overlaps, negative space, and depth to make the artwork feel dynamic.

> The goal is to create an original visual world that people can associate with CreatorsDNA even before
> reading the brand name.

---

## 3. Color Palette and Visual Energy

Use a vibrant, expressive color system.

**Suggested primary colors:**

| Color | Role |
| --- | --- |
| Electric cobalt blue | Primary |
| Vivid coral or warm orange | Primary |
| Bright yellow | Primary |
| Acid lime green | Primary |
| Vivid violet | Primary |
| Pink or magenta | Supporting accent |

Balance these with **warm ivory, off-white, soft cream, charcoal, and deep navy**.

The palette should support multiple contrasting compositions rather than force every section to use
every color.

Use bright colors for the 3D shapes, graphic elements, visual highlights, interaction states, and data
categories. Use neutral backgrounds where needed to create contrast and improve readability.

Some sections may use bold full-bleed color backgrounds. Other sections should use warm, light
backgrounds with colorful objects floating within them. Dark, immersive sections can be used
selectively for dramatic contrast.

The overall experience should be colorful without becoming visually chaotic.

⚠️ **Do not apply rainbow gradients to every surface. Do not use the generic purple-and-blue gradient
associated with template-based AI products.**

**Color must have hierarchy.** A visually dominant section should have one main color direction with a
few complementary accents.

Maintain accessible contrast for all text, buttons, charts, and interactive elements.

---

## 4. Website Hero Section

The hero should immediately communicate that CreatorsDNA is a creative, modern, visually distinctive
product.

It should contain:

- A strong headline explaining the core value proposition.
- A short supporting description.
- A clear primary call to action to explore CreatorsDNA.
- A memorable 3D composition made from the signature abstract shapes.
- Subtle but noticeable movement that makes the scene feel alive.

**Possible headline direction:**

> "Your niche is just the beginning."

**Supporting copy direction:**

> "Discover the cultural interests connecting your content to unexpected opportunities."

These are **examples, not mandatory final copy**.

The 3D artwork should be a **major visual feature** rather than a tiny decoration beside a conventional
SaaS headline.

Explore compositions where the shapes occupy a substantial portion of the hero, extending around or
behind the typography while keeping all important text readable.

The objects can float at different depths, rotate gently, drift, stretch subtly, or respond to the
cursor. Use layered positioning to establish depth and dimension.

⚠️ The composition should look **art-directed at all times**. Randomly moving objects without a clear
composition are not acceptable.

The hero must work at desktop, tablet, and mobile sizes. On smaller screens, **simplify the
composition** if necessary instead of squeezing the desktop scene into a narrow viewport.

---

## 5. Scroll-Driven Storytelling

The public website should use scroll interactions to tell the CreatorsDNA story.

⚠️ **Do not create a long sequence of identical static sections containing a heading, paragraph, and
three cards.**

Instead, develop a few visually memorable storytelling scenes. Text and imagery should work together,
with abstract shapes changing their arrangement as the visitor moves through the page.

### Possible storytelling sequence

| Scene | Title | Direction |
| --- | --- | --- |
| 1 | **A world of creativity** | Introduce the brand through a vibrant composition of floating 3D forms. Establish the idea that every creator has a unique creative identity. |
| 2 | **Discover your cultural DNA** | As the visitor scrolls, the shapes gradually separate into clusters or arrange themselves around a central point. Supporting text explains how explicit interests can reveal broader cultural affinities. |
| 3 | **Find the unexpected** | Show distinct clusters becoming connected through animated lines, moving objects, or transformations. The text introduces the idea that creators can discover relevant interests beyond their existing niche. |
| 4 | **Turn discovery into opportunity** | Let the abstract composition become more structured. Shapes, connections, or graphic elements can transition into a representation of cultural affinities, content opportunities, and potential brand connections. |
| 5 | **Take the next step** | Bring the composition into a final, balanced arrangement alongside a clear call to action. |

These scenes are **creative directions, not mandatory literal storyboards**. Choose the most coherent
sequence for the actual website content.

Use scroll-triggered reveals, controlled parallax, pinned sections where appropriate, object
transformations, and carefully timed transitions.

**The animation should enhance the narrative rather than delay access to information.**

⚠️ Avoid excessive scroll hijacking, unnecessarily long pinned sections, animations that make text
difficult to read, and effects that prevent users from navigating normally.

---

## 6. Interactive Animation and Motion

Motion is a core part of the brand identity, **but it must be purposeful**.

Use several complementary types of motion:

| Type | Direction |
| --- | --- |
| **Ambient movement** | Shapes gently float, rotate, or move at different speeds. The movement should be subtle enough that it does not compete with the text. |
| **Cursor interaction** | Selected objects may react to pointer movement, subtly tilt, move toward or away from the cursor, or reveal depth through parallax. Keep these responses smooth and restrained. |
| **Scroll-triggered transformations** | Objects can change position, scale, rotation, arrangement, or visual relationships as the visitor moves between storytelling scenes. |
| **Section transitions** | Color fields, ribbons, shapes, or graphic elements can travel between sections to create continuity instead of abrupt, disconnected page changes. |
| **Microinteractions** | Buttons, navigation elements, selectable options, chart nodes, and cards should respond to hover, focus, selection, and clicks with appropriate feedback. |
| **Signature animation** | Create **one** particularly memorable hero animation or visual transformation that gives the brand a recognizable moment. |

Where technically appropriate, the signature animation may play through a carefully designed sequence
and resolve into a stable final composition. **If using video, ensure that its final frame matches the
intended resting visual** so that looping or playback completion does not create a visible jump.

⚠️ **Do not use motion everywhere.** A few well-designed animations are more effective than constant
movement across the entire interface.

All motion should remain smooth, deliberate, and performant.

**Respect reduced-motion preferences.** Provide static or simplified alternatives when motion is
disabled, and ensure the experience remains usable without animation.

---

## 7. Bold Graphic Design and Typography

The 3D world should be balanced with a strong graphic design system.

Use expressive typography, large headlines, carefully chosen font weights, varied text sizes, generous
spacing, and deliberate line breaks.

Headlines may be oversized and visually dominant. Supporting descriptions should remain concise and
readable.

**Use typography as a compositional element** rather than treating it as an afterthought.

Explore layouts where text overlaps visually with shapes without losing legibility, where a color field
creates a backdrop for a headline, or where a large number or phrase anchors a section.

Use asymmetric layouts, varied content widths, overlapping visual elements, and occasional full-bleed
sections.

⚠️ **Avoid repetitive three-column card grids as the default layout for every section.**

Use cards where they genuinely help organize information, such as brand opportunities or selectable
interests, but **do not let cards dictate the entire visual language**.

Maintain consistent typography, spacing, alignment, and responsive behavior throughout the site.

---

## 8. Public Website Content and Visual Storytelling

The public website should explain the value of CreatorsDNA through a visually engaging narrative.

**Potential sections include:**

- Hero and primary call to action.
- Why a creator's niche does not represent their entire cultural taste.
- How CreatorsDNA discovers cultural connections.
- An example of an unexpected affinity.
- How those discoveries lead to content opportunities.
- How cultural connections can inform brand partnerships.
- A preview of the actual app experience.
- A final call to explore personal Taste DNA.

Use a combination of abstract 3D artwork, graphic compositions, **real interface previews**, and
meaningful data visualization examples.

⚠️ The website should **not** be a generic marketing template filled with claims about AI.

**The visual design must help visitors understand what the product actually does.**

Any example results shown on the public website **must be clearly presented as illustrative examples**
unless they come from real, verified product results.

---

## 9. App Visual Identity

**The application must use the same visual identity as the public website.**

⚠️ Do not create a completely unrelated dashboard design after the landing page.

Reuse the same color palette, typography, shape language, rounded geometry, curves, visual accents, and
motion principles.

However, the application has a **different priority**: it must help creators understand their data and
make decisions.

| Surface | Character |
| --- | --- |
| Public website | Expressive and cinematic |
| Application | Information-rich, readable, interactive, well organized |

Use **light or warm-neutral surfaces for analytical content** where they improve readability. Introduce
colorful elements through charts, graph nodes, highlights, category markers, section headers, and
selected decorative forms.

Use dark or saturated backgrounds **selectively** rather than placing every analytical view on a
visually intense surface.

⚠️ Avoid excessive decoration inside dense analytical components. **The shapes should frame and
reinforce the information, not obscure it.**

⚠️ **Do not force 3D objects into every screen.** The application should primarily use meaningful
visualizations and interactive data components.

---

## 10. Data Visualization Principles

**Visualization is a core part of CreatorsDNA, not an optional decorative enhancement.**

The product should help creators understand relationships, patterns, gaps, and opportunities through
visual exploration.

> Every visualization must answer a meaningful question.

### A. Taste DNA network

**Purpose:** Show how the creator's selected interests connect to additional cultural interests.

- Use an interactive network or graph with distinguishable nodes, categories, and relationships.
- Allow users to explore individual nodes and inspect supporting information.
- **Distinguish creator-provided interests from Qloo-discovered entities and CreatorsDNA-derived
  categories.**

### B. Cultural affinity ranking

**Purpose:** Show which cultural categories or entities have the strongest supported relationship to the
creator's input interests.

- Use ranked bars, dot plots, or other appropriate visualizations.
- Provide labels, definitions, and supporting information for the displayed scores.
- ⚠️ **Do not invent affinity scores if the API does not provide the necessary data.**

### C. Opportunity-gap visualization

**Purpose:** Help creators discover categories with cultural relevance but relatively little existing
content coverage.

- A scatter plot or matrix may compare cultural affinity against current content coverage.
- Clearly explain what each axis represents and how the values are calculated.
- ⚠️ **Do not infer current content coverage without data.** If coverage is based on creator-entered
  categories or manually classified content, identify that methodology.

### D. Culture-to-brand relationship map

**Purpose:** Explain how the creator's original interests connect to an affinity and then to a potential
brand.

- Use a network, path diagram, or another suitable visualization.
- Where Qloo explainability data is available, **use the actual returned evidence**. Where it is
  unavailable, **distinguish deterministic CreatorsDNA matching from direct Qloo explanations**.

### E. Brand-fit breakdown

**Purpose:** Explain why a brand may be worth exploring.

- Display meaningful score components such as cultural fit, content compatibility, geographic
  relevance, and opportunity gap **where supporting data exists**.
- Explain the scoring methodology.
- ⚠️ **Avoid unexplained overall percentages that suggest a level of certainty the system cannot
  justify.**

### F. Taste fingerprint

**Purpose:** Provide a compact, distinctive visual summary of a creator's cultural profile.

- This can be a custom composition, radial visualization, or abstract graphic generated from **actual
  profile data**.
- ⚠️ It should reflect **real differences between creators** rather than simply assigning everyone the
  same decorative graphic.

---

## 11. Visualization Interactions

Where appropriate, visualizations should support:

- Hover or tap to inspect an item.
- Click to explore a node or category.
- Filtering by cultural category.
- Expanding a connection to reveal related entities.
- Comparing selected brand opportunities.
- Switching between a graph and a ranked list when that improves usability.
- Reading clear explanations of scores and relationships.
- Returning to the previous view without losing context.

Interactions should feel responsive and intuitive.

**Always provide labels and a usable alternative for important information represented by color or
spatial relationships.**

⚠️ **Graphs must remain readable when the number of nodes increases.** Use filtering, grouping,
progressive disclosure, or simplified views instead of displaying every result at once.

> Do not sacrifice clarity to create an impressive-looking graph.

---

## 12. Color System for Data

Use color **consistently** across the application.

Assign **stable visual roles** to different types of information. For example, creator-provided
interests may use one family of colors, discovered cultural affinities another, and opportunity
highlights a third.

Use the exact mapping consistently throughout the app.

The specific mapping can be chosen during implementation, **but it should be documented and reused**.

Use size, shape, labels, line styles, and grouping **alongside color** to communicate meaning.

⚠️ Avoid using arbitrary colors for each item without a clear reason.

⚠️ **Do not use red or green alone to imply that an opportunity is bad or good. Cultural fit is
exploratory, not a binary judgment.**

Ensure sufficient contrast for labels and interactive elements.

---

## 13. Data Integrity and Visual Honesty

**Visual polish must never come at the expense of factual accuracy.**

All charts, graphs, scores, and relationship maps must be based on **real retrieved data** or **clearly
documented deterministic calculations**.

Clearly distinguish:

1. Data returned directly by Qloo.
2. Creator-provided information.
3. CreatorsDNA-derived scores and classifications.
4. Illustrative or synthetic examples.

⚠️ **Never present illustrative examples as real Qloo results.**

⚠️ **Do not invent** audience demographics, affinity values, brand matches, historical trends, content
performance, or confidence levels.

If a particular Qloo capability is unavailable or cannot be validated, use a clearly explained fallback
or **omit that visualization** until reliable data is available.

> A visualization should be omitted or simplified if the underlying data cannot support it.

---

## 14. Performance and Responsive Design

The website should remain fast and responsive despite its visual richness.

- Prefer **lightweight CSS transforms, optimized vector artwork, carefully compressed assets, and
  efficient animation techniques** when they can achieve the desired effect.
- Use **WebGL or a 3D rendering library only when the visual result justifies the complexity**.
- Avoid unnecessary real-time 3D rendering, oversized video assets, excessive particle counts, and
  expensive effects on every element.
- **Pause or reduce ambient animation** when appropriate, particularly when content is outside the
  viewport.
- Provide **graceful fallbacks** if advanced 3D rendering is unsupported or too expensive on a device.
- On mobile, **simplify compositions**, reduce the number of moving objects, and prioritize readable
  content and functional interactions.
- The application should **not require complex animation** to understand a chart or access a feature.
- Respect **reduced-motion preferences, keyboard navigation, focus states, and touch interaction**.

---

## 15. Design Consistency

Create reusable **design tokens and components** for:

- Color palette.
- Typography.
- Spacing and layout.
- Borders and radii.
- Shadows and surface treatments.
- Buttons and interaction states.
- Graph and chart styling.
- Node and connection styles.
- Motion duration and easing.
- Shape treatments and decorative artwork.

Use these consistently across the website and app.

Abstract shapes should feel like **part of one recognizable family**, with consistent materials,
lighting, and composition principles.

⚠️ Avoid introducing unrelated illustrations or random visual styles in different sections.

> The design should feel intentionally art-directed rather than assembled from unrelated UI kits.

---

## 16. What to Avoid

Do not produce:

- A generic AI SaaS landing page with a purple gradient hero.
- A generic dashboard with a sidebar and rows of identical cards as the entire app.
- A visual identity dominated by fashion, music, gaming, or another single creator niche.
- Generic AI brains, robots, glowing heads, or circuit-board imagery.
- Random blobs and shapes with no visual composition.
- Excessive glassmorphism or gradients on every element.
- Constant motion that makes reading difficult.
- Scroll interactions that interfere with normal navigation.
- Decorative graphs that do not represent meaningful data.
- Fabricated scores or fake Qloo evidence.
- Repetitive layouts that make the site feel like a template.
- Heavy 3D effects that noticeably harm performance.
- Visual complexity that makes the app difficult to use.

---

## 17. Implementation Guidance

- Before implementation, **inspect the existing project structure, framework, dependencies, and current
  product specifications**.
- **Adapt this visual direction to the existing architecture** rather than replacing working
  infrastructure unnecessarily.
- Choose animation, rendering, and charting technologies based on **actual needs and repository
  compatibility**.
- Build a **coherent design system** rather than styling each section independently.
- **Prioritize the signature hero, scroll storytelling, typography, color system, and core data
  visualizations.**
- Use **real application data** wherever possible and build robust empty, loading, error, and fallback
  states.
- Test the visual experience at **desktop, tablet, and mobile** sizes.
- Check **animation performance, reduced-motion behavior, text contrast, graph readability, and
  interaction states**.

> The final result should feel like a polished, distinctive creative platform with a memorable visual
> identity and a genuinely useful analytical application.

---

## Final Design Principle

> **CreatorsDNA should look like a world built for creativity and feel like a tool built for discovery.**
>
> The colorful 3D shapes and graphic compositions establish the brand's personality. The scroll-driven
> website tells the story. The interactive visualizations inside the application turn that visual
> promise into something useful.
>
> Every visual element should contribute to the same idea: every creator has a wider cultural identity
> than their niche, and discovering that identity can reveal new possibilities.

---

## 18. Reconciliation Notes

*Added by the assistant, not part of the source document.* How doc 05 relates to docs 01–04.

### 18.1 What this document resolves

| Ref | Was | Now |
| --- | --- | --- |
| **R5** — visual theme | 01 §39 and 02 §29 both listed what to *avoid*; neither said what to *be*. Marked "provided separately". | ✅ **Resolved.** This document is the theme. Design tokens, palette, shape language, motion, and the six visualisations are all now specified. |
| **S7 / S8** blocked on theme | Doc 04 §7.1 said component structure could proceed but not visual design. | ✅ **Unblocked.** The design system and the marketing site can now be designed, not just structured. |
| 04 §8.3 — synthetic-vs-real tension | Resolved by reasoning: demo data must be *visibly* synthetic and labelled. | ✅ **Independently confirmed** by §8 and §13, which require illustrative examples to be clearly presented as such. Same conclusion, reached separately. |
| 01 §12 — explicit signals vs discovered affinities | Stated as a principle; no mechanism named. | ✅ **Mechanism supplied** by §10A and §12: distinct, stable color roles per provenance class. |

### 18.2 New evidence on an open conflict

**R3 — is the public website P0?** 01 §51 says yes (#1); 02 §43 omits it from P0 entirely.

Doc 05 §17 instructs: *"Prioritize the **signature hero, scroll storytelling**, typography, color
system, and core data visualizations."* Two of the top five named priorities are **website-only**
surfaces, and §2 makes the 3D shape language — used "throughout the public website, hero section,
storytelling sections" — a signature brand asset.

This is **evidence favouring 01 §51's position**, not a resolution. Still needs an explicit decision.

### 18.3 Genuinely new requirements (absent from docs 01–04)

| # | New requirement | Source | Consequence |
| --- | --- | --- | --- |
| N1 | **Abstract 3D shapes as the signature visual language** | §2 | Neither 01 nor 02 mentions 3D at all. This is a whole new asset-production workstream and a performance/architecture question. → **R12** |
| N2 | **Scroll-driven storytelling in ~5 scenes** | §5 | 01 §30–§38 listed website *sections*; this replaces static sections with choreographed scenes. Explicitly forbids "heading, paragraph, three cards" repetition. |
| N3 | **A single signature animation** | §6 | One memorable hero moment. If video, the final frame must match the resting composition — a specific production constraint. |
| N4 | **Visual continuity between website and app** | §9 | 01/02 required the app not to be a generic dashboard, but never required it to share the site's identity. Now it must. |
| N5 | **Two new visualisations** — culture-to-brand relationship map (**D**) and taste fingerprint (**F**) | §10 | **Not in 02 §19's 15-component list.** F in particular ("reflect real differences between creators") is a new deterministic generator. → **R13** |
| N6 | **No red/green good-or-bad encoding** | §12 | New accessibility/semantics rule. "Cultural fit is exploratory, not a binary judgment." |
| N7 | **Graph readability at scale** — filtering, grouping, progressive disclosure | §11 | Interacts with `take ≤ 50` (03 F21): the Taste DNA network must stay legible with ~50 nodes per category. |
| N8 | **Reduced-motion, keyboard, focus, touch** | §6, §14 | 02 §31 mentioned performance; these accessibility behaviours are newly explicit and testable. |
| N9 | **Four-way provenance distinction** in all visuals | §13 | Qloo-returned / creator-provided / CreatorsDNA-derived / illustrative-synthetic. More granular than 01 §53 or 02 §34. |

### 18.4 Apparent tensions — and why they are not contradictions

These pairs look like conflicts and are not. Recording them so a future implementer does not "resolve"
one by deleting the other.

| Looks like a conflict | Resolution |
| --- | --- |
| §2 wants **"translucent glass-like shapes"**; 02 §29 forbids **"excessive glassmorphism"** | Different things. Glass as a *3D material* on a sculptural object is wanted; glassmorphism as a *UI surface treatment* (frosted panels everywhere) is not. §16 bans "excessive glassmorphism … on every element" — the operative word is **excessive**, and §2 itself says material variety "should feel curated". |
| §2 wants **"inflated, pillowy"** and **"smooth liquid-like"** forms; 01 §39 forbids **"gradient blobs"**; §16 forbids **"random blobs … with no visual composition"** | Blobs are banned when *random and uncomposed*, wanted when *art-directed with volume, lighting, and a focal point*. §2 and §4 both stress composition. The distinction is art direction, not geometry. |
| §3 lists **"vivid violet"** as a primary colour; 01 §39 and §16 forbid **"purple gradients"** and the **"generic purple-and-blue gradient"** | Violet as a *solid or material colour* is in the palette. The banned thing is the specific purple→blue **gradient** used as a template AI-product hero treatment. §3 says so directly. |
| §3 wants vibrant colour everywhere; §9 wants **"light or warm-neutral surfaces for analytical content"** | Explicitly reconciled by §9 itself: the *website* is expressive and cinematic, the *app* is information-rich and readable. Colour enters the app through charts, nodes, highlights, and category markers — not through saturated page backgrounds. |
| §2 makes 3D shapes "one of the most important elements"; §14 says **"use WebGL … only when the visual result justifies the complexity"** and prefers CSS transforms | Not a contradiction but a **real architectural decision**. §9 also says "do not force 3D objects into every screen". The likely sweet spot is **pre-rendered/compressed 3D assets** (images or video) animated with CSS transforms, with real-time WebGL reserved for the signature moment — if then. → **R12** |
| §10E warns against **"unexplained overall percentages"**; 01 §13 / 02 §15 define a single weighted overall score | Compatible, and reinforced by 03 §15's finding that affinity is **not** a survey percentage. An overall score is acceptable **only when its breakdown is shown and the methodology explained** — which is exactly 02 §19's `ScoreBreakdown` component. Never render a bare "87% match". |
| §17 says "inspect the existing project structure, framework, dependencies" | Currently **vacuous** — the repository contains only context documents and no code. This instruction becomes meaningful once **R2** (tech stack) is decided. Until then there is nothing to adapt to, which is why §17's "adapt rather than replace" cannot yet be acted on. |

### 18.5 Convergent design — worth noting

The five-scene sequence in §5 maps almost one-to-one onto the product pipeline in 01 §3:

| Scene (doc 05 §5) | Pipeline stage (doc 01 §3) |
| --- | --- |
| 1 — A world of creativity | *(brand framing)* |
| 2 — Discover your cultural DNA | Creator signals → Qloo → **Taste DNA** |
| 3 — Find the unexpected | **Unexpected affinities** |
| 4 — Turn discovery into opportunity | **Untapped opportunities** → **Brand opportunities** |
| 5 — Take the next step | Explain why → **Action** |

The scroll narrative *is* the product pipeline. That is a strong sign the design direction and the
product concept were authored against the same mental model, and it means the website can explain the
product simply by walking a visitor through the thing the app actually does — satisfying §8's "the
visual design must help visitors understand what the product actually does."

Similarly, §10C's opportunity-gap scatter is precisely 01 §10's high-affinity / low-coverage quadrant,
and §10B's "do not invent affinity scores if the API does not provide the necessary data" lands exactly
on doc 04's assumptions **A1/A2**. The design document independently anticipates the API risk.

### 18.6 Corrections this document forces on docs 01–04

**Recorded, not applied** — consistent with the standing instruction not to silently rewrite the specs.

| Ref | Existing statement | Correction / addition |
| --- | --- | --- |
| 01 §39, 02 §29 | Theme "provided separately"; only avoid-lists given | Now supplied. The avoid-lists remain valid and are **supersets-compatible** with §16 — take the union. See §18.4 for the three apparent conflicts. |
| **02 §19** | 15-component design system | **Add at least two:** a culture-to-brand relationship/path component (§10D) and a **taste fingerprint** generator (§10F). Existing `TasteBubble` / `AffinityBar` / `ScoreBreakdown` cover §10A/B/E only partially. |
| **02 §19, §29** | Design tokens implied by "reusable component library" | §15 names **ten** explicit token categories, including ones 02 omits: *graph and chart styling*, *node and connection styles*, *motion duration and easing*, *shape treatments and decorative artwork*. |
| 01 §13, 02 §15 | Single weighted overall score | Must always be rendered **with its breakdown and methodology** (§10E). A bare percentage is now a spec violation, not just a style choice. Reinforces 03 §15 / F13. |
| 01 §12 | "Distinguish explicit signals from discovered affinities" | Now has a concrete mechanism: **stable color roles by provenance** (§10A, §12), plus size, shape, labels, and line style so meaning never rests on colour alone. |
| 02 §31 | Performance requirements | Extend with: pause off-viewport ambient animation, graceful degradation when 3D is unsupported or too expensive, mobile composition simplification, and the §14 asset-weight preferences. |
| 02 §33 | Graceful failure | Extend with §13's rule: **omit or simplify a visualisation** when the data cannot support it. An unavailable Qloo capability means the chart does not render — not that it renders empty or estimated. |
| 02 §41 | Five test archetypes | Add visual assertions: reduced-motion behaviour, keyboard navigation, focus states, touch interaction, text contrast, and graph readability at node count (§14, §17). |
| 04 §7.1 S7, S8 | "Design system can start structurally but not visually" | **Now visually unblocked** by R5's resolution — subject to R12 (3D approach). |
| 04 §9 | R5 open | **R5 closed.** New decisions **R12** (3D approach) and **R13** (component-list additions) opened. |

### 18.7 New decisions required

| # | Decision | Why it matters |
| --- | --- | --- |
| ~~**R12**~~ | ✅ **RESOLVED — [doc 04 D7](04-decisions-and-readiness.md#1-decision-record): hybrid.** Pre-rendered 3D artwork animated with CSS transforms site-wide, with real-time WebGL reserved for the **single** signature hero animation of §6. | This is the reading that satisfies §2 and §14 *simultaneously* instead of trading one against the other: §6 asks for exactly one signature animation, so exactly one surface pays the WebGL cost. The §14 fallback is free — it is the same pre-rendered artwork used everywhere else. The WebGL chunk must be code-split and client-only, and if video is used the §6 final-frame rule binds. |
| **R13** | **Where do the 3D assets come from?** Commissioned, generated, or built in code? §2 demands an "original visual world … even before reading the brand name" and forbids "random stock illustrations". **Promoted to the top design blocker by D7** — hybrid needs a whole *family* of pre-rendered shapes plus one WebGL scene. | A real production question with cost and schedule implications. Generated imagery is an option available in this environment and could produce the shape family quickly — but §15 requires the shapes to feel like **one consistent family** with shared materials and lighting, which is the hard part of generation. |
| **R14** | **Data colour-role mapping.** §12 permits choosing it during implementation but requires it be **documented and reused**. | Small decision, high leverage: it is the mechanism that enforces 01 §12's provenance distinction. Worth fixing before components are built, and cheap to change now, expensive later. |
| **R15** | **Is the taste fingerprint (§10F) P0 or P1?** It is a new component absent from 01/02 priority lists, and it must be generated deterministically from real profile data. | Affects scope. It is achievable — doc 04 §4.3's Taste DNA components provide exactly the inputs — but it is net-new work nobody has yet prioritised. |
