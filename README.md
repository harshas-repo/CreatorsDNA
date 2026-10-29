# CreatorsDNA

> **Find the brands that share your taste.**

CreatorsDNA maps creator and brand taste to uncover the cultural intersections that make partnerships meaningful. It is a Qloo-powered cultural-intelligence tool for content creators: you describe what you make, it resolves your interests against a cultural catalogue, and it returns a **Taste DNA** plus the brands whose taste genuinely overlaps yours — with the evidence, not just a score.

---

## Table of contents

- [What it does](#what-it-does)
- [Honesty by design](#honesty-by-design)
- [Tech stack](#tech-stack)
- [Getting started](#getting-started)
- [Testing and verification](#testing-and-verification)
- [Project structure](#project-structure)
- [How the analysis works](#how-the-analysis-works)
- [Data and privacy](#data-and-privacy)
- [License](#license)

## What it does

Given a short, honest description of your work, CreatorsDNA walks you through a guided 12-step analysis and produces:

- **Taste DNA** — the cultural graph of what you actually make, and the seal derived from it.
- **Unexpected affinities** — categories that came back which you never explicitly named.
- **Untapped connections** — cultural ground you reach but have not made content in yet.
- **Brands you overlap with** — ranked on real taste intersection, not on the order the data happened to come back in.
- **Brand detail** — one brand at a time: the shared taste first, then the chain of evidence that found it.
- **Pitch** — a template-built opening message you can edit.
- **Media kit** — one printable, press-ready page you can save as a PDF, disclosures included.

The analysis is **streamed**: each pipeline stage is reported as it runs, so the progress you see reflects real work rather than an invented percentage.

## Honesty by design

CreatorsDNA is built around one rule: **never invent data.**

- It ships with a clearly-labelled **synthetic** provider, so the entire app runs end-to-end with no API key. Whenever synthetic data is in use, the UI shows a persistent banner so it can never be mistaken for live discoveries.
- With a Qloo key it switches to the **live** Qloo Insights API. When a result cannot be produced honestly, the app says so and explains the fallback level instead of filling the gap.
- The media kit carries the same disclosures as the screen version — a kit that dropped them would be the one document a brand keeps.

The in-app **Methodology** page ([`src/app/methodology`](src/app/methodology/page.tsx)) describes the product methodology in full.

## Tech stack

| Layer | Choice |
| --- | --- |
| Framework | [Next.js 15](https://nextjs.org/) (App Router) |
| UI | React 19 · TypeScript (strict) |
| Styling | Tailwind CSS 3 · PostCSS |
| Motion / 3D | Framer Motion · Three.js |
| Validation | Zod |
| Testing | Vitest + Testing Library (jsdom) |
| Linting | ESLint 9 (`eslint-config-next`) |
| Data | Qloo Insights API, or the built-in synthetic provider |

## Getting started

### Prerequisites

- **Node.js >= 20.9.0** (see `engines` in [`package.json`](package.json))
- **npm** (ships with Node)

### 1. Clone and install

```bash
git clone https://github.com/harshas-repo/CreatorsDNA.git
cd CreatorsDNA
npm install
```

### 2. Configure the environment (optional)

The app runs with **no configuration at all**, using labelled synthetic data. To use the live Qloo Insights API instead, copy the template and add your key:

```bash
# Windows (PowerShell)
Copy-Item .env.example .env

# macOS / Linux
cp .env.example .env
```

Then edit `.env`. The variables that matter most:

| Variable | Purpose | Default |
| --- | --- | --- |
| `CREATORSDNA_PROVIDER` | `synthetic` (labelled dev data) or `qloo` (live API) | `synthetic` |
| `QLOO_API_KEY` | Your Qloo Insights API key — required for `qloo` | *(empty)* |
| `QLOO_API_BASE_URL` | Qloo host. Hackathon keys work **only** against `https://hackathon.api.qloo.com` | `https://hackathon.api.qloo.com` |
| `QLOO_TIMEOUT_MS` | Per-request timeout (live insights calls can be slow) | `30000` |
| `CACHE_DRIVER` | `memory`, `filesystem`, or `kv` | `memory` |

The full list is documented inline in [`.env.example`](.env.example).

> **Security:** `.env` is git-ignored and must **never** be committed — only `.env.example` is tracked. See [`.gitignore`](.gitignore).

### 3. Run the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The analysis wizard lives at [`/analyze`](http://localhost:3000/analyze).

### 4. Production build

```bash
npm run build
npm run start
```

## Testing and verification

```bash
npm run test           # run the Vitest suite once
npm run test:watch     # re-run tests on change
npm run test:coverage  # run tests and write a coverage report
npm run typecheck      # tsc --noEmit
npm run lint           # next lint
npm run verify         # typecheck + lint + test + build — the full gate
```

The suite covers the analysis pipeline, the taste-DNA and brand-overlap scoring, the deterministic helpers, the flow/state-machine vocabulary, and the design-system contrast and colour rules. Run `npm run verify` before opening a pull request.

> **Tip:** don't run `npm run build` while `npm run dev` is running in the same checkout. They share the `.next` directory, and the dev server will start returning `500`s until you restart it.

## Project structure

```
src/
  app/                 # Next.js App Router
    page.tsx           # Landing page
    analyze/           # The 12-stage analysis wizard
    examples/          # Worked examples
    methodology/       # Product methodology
    api/               # Route handlers
      analyze/         # Streamed analysis (NDJSON)
      qloo/            # Qloo proxy: search, resolve, recommendations, taste
      health/          # Health / config check
  components/          # UI, domain and site components
  lib/                 # Analysis pipeline, providers, utilities
  data/                # Curated brand registry (brands.json)
docs/                  # Product, technical, API, decisions and design docs
tests/                 # Vitest suites
```

## How the analysis works

1. **Describe** — you enter your name and a free-text description of your work.
2. **Review** — each phrase is resolved against the cultural catalogue and you confirm the match you actually meant; nothing is silently guessed.
3. **Context** *(optional)* — audience and coverage detail.
4. **Analyze** — the pipeline runs and streams each stage as it completes.
5. **Results** — Taste DNA, unexpected affinities, untapped connections, ranked brands, brand detail, a pitch, and a printable media kit.

The flow keeps your results beside a canonical key of the input they were built from. Edit the profile afterwards and a banner tells you the results are stale, with a one-click re-run — so the numbers on screen always describe the form you can see.

## Data and privacy

- No captured Qloo response is ever committed — responses are identifiable and reveal the query. See [`.gitignore`](.gitignore).
- The brand registry is curated, checked-in data, enriched from Qloo where supported. Partnership links come from verified official sources and are never scraped at runtime.

## License

Released under the [MIT License](LICENSE).
