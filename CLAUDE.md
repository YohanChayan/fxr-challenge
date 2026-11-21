# CLAUDE.md — FX Replay "Try FX Replay Free"

Project instructions for Claude Code. This file is self-contained: it assumes no global or
personal configuration. Where a global rule conflicts with this file, this file wins inside
this repository.

## What the product is

A marketing landing page plus signup flow for **"Try FX Replay Free"**. One business goal:
**increase conversion from marketing traffic to account creation.** Built for the FX Replay
Growth Engineer take-home: time-boxed to ~6 hours, where "a smaller, thoughtfully executed
solution" beats breadth. Analytics, the experiment and the AI workflow are part of the product,
not afterthoughts.

Deliverables live in `docs/` (one file per brief section) plus `README.md` and `AI_LOG.md`.

## Stack and why

| Piece         | Choice                                                                                                            | Why                                                                                                                                                            |
| ------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework     | **Astro 7**, output `static` (default)                                                                            | The landing page is prerendered HTML: best LCP, no server needed to render it                                                                                  |
| Interactivity | **Vue 3 islands only**                                                                                            | Only the signup form needs JS; everything else ships zero JS                                                                                                   |
| API           | **Astro server endpoints** (`src/pages/api/**`, `export const prerender = false`) on **@astrojs/node** standalone | One deployable, one origin, no CORS                                                                                                                            |
| Persistence   | **SQLite via better-sqlite3**, file on a mounted volume (`data/`)                                                 | Real constraints (unique email → 409) at near-zero ops cost. `node:sqlite` is only Release Candidate (1.2) on Node 26, so not chosen — see `docs/DECISIONS.md` |
| Validation    | **zod**, one schema per contract in `src/lib/schemas/`, imported by both the island and the endpoint              | Client and server can never disagree about what is valid                                                                                                       |
| Language      | TypeScript **strict**, pinned to `~6.0` (TS 7 breaks typescript-eslint and `astro check`)                         |                                                                                                                                                                |
| Runtime       | Node **26 LTS** (`.nvmrc`)                                                                                        |                                                                                                                                                                |
| Quality       | ESLint (TS strict, astro, jsx-a11y strict, vue), Prettier, Vitest                                                 |                                                                                                                                                                |

## Folder map

```
src/
  pages/            routes; index.astro is the landing page
  pages/api/        server endpoints (Users API) — on-demand, never prerendered
  components/       .astro components (zero JS)
  components/signup/ the signup island: SignupIsland.vue (CTA + dialog), EmailForm, MarketPicker
  composables/      island state machines (useSignup.ts) — no DOM access
  types/            hand-written, type-only contracts; z.infer types stay in lib/schemas/
  lib/schemas/      zod schemas shared by client and server
  lib/api/          browser fetch clients for the API, parsed with lib/schemas
  lib/server/       server-only code (db, repositories) — never imported by islands
  analytics/        taxonomy.ts (the event catalogue) and the typed track(), consent, GA4 loader
  experiments/      flags.ts (A/B registry) and boot.ts (the one inline <head> script)
  components/analytics/ AnalyticsIsland.vue: consent banner, page_view, experiment_exposure
  styles/tokens.css design tokens generated from the brand kit
  assets/logos/     brand SVGs
docs/               the brief's deliverables + DECISIONS.md + experiments/
.claude/            agents, commands, hooks, settings
AI_LOG.md           one entry per working session
```

## Rules

1. **Semantic tokens only.** Style with `var(--bg-primary)`, `var(--text-primary)`,
   `var(--border-brand)` etc. from `src/styles/tokens.css`. Never reference a primitive
   (`--dark-900`, `--blue-600`) and never write a hex/rgb literal outside `tokens.css`.
   If no semantic token fits, stop and say so; do not invent one silently.
   Note: `--text-brand` on `--bg-primary` is ~4.0:1 — use it for large text only (see DECISIONS).
2. **Every analytics event exists in `src/analytics/taxonomy.ts`.** `track()` is typed from the
   taxonomy, so an unknown event or a wrong property is a type error. Add events with
   `/add-event`, never by hand-editing call sites.
3. **No PII in analytics.** No email, name, phone, IP or free text in event properties. Users
   are identified by an opaque id only.
4. **Zero JS outside islands.** `.astro` components ship no client script. Interactivity is a
   Vue island with the least eager `client:*` directive that works.
5. **Performance budget** (p75, mobile): **LCP < 2.5s, CLS < 0.1, INP < 200ms.** No
   third-party script on the critical path. Images sized, fonts preloaded with `font-display: swap`.
6. **Accessibility: WCAG 2.2 AA.** Semantic HTML first, labelled inputs, errors announced
   (`aria-live`/`aria-describedby`), visible focus, 4.5:1 text contrast, respects
   `prefers-reduced-motion`.
7. **Never commit secrets.** No keys or credentials in code, docs or fixtures; `.env*` is ignored
   and unreadable to Claude. Document required variables in `.env.example`.
8. **Docs never claim anything the repo or the live URL doesn't show.** No "we monitor X" without
   the code or config that does it. Proposals are labelled as proposals.
9. **Stay in scope.** Build what the brief asks for; anything else goes in `docs/DECISIONS.md`
   as "with more time". Never add a dependency without saying why.
10. **Never commit, push, or touch a server.** The human does git and deploys.

### Browser use

**In this repo, `qa-a11y-perf` is explicitly allowed to drive a browser through the Playwright
MCP server** (`.mcp.json`), against two targets only: `http://localhost:4321` and the challenge
deployment `https://fxr-challenge.yhndevside.com`, using only test emails of the form
`qa+<timestamp>@example.com`. **Production is `fxreplay.com`: never test there.** No other agent
opens a browser.

## Definition of done

A change is done when all of these hold:

- [ ] `npm run typecheck`, `npm run lint`, `npm run format:check` and `npm test` pass
- [ ] New logic has a Vitest test (schemas, API handlers, repository)
- [ ] If events changed: `analytics-auditor` reports clean
- [ ] If UI or the signup flow changed: `qa-a11y-perf` ran the flow and screenshots exist
- [ ] `reviewer` has reviewed the diff and its blocking findings are resolved
- [ ] The relevant `docs/` section is updated and claims only what exists
- [ ] An `AI_LOG.md` entry records what was delegated, done by hand, rejected, and validated

## Agents and commands

| Need                                                   | Use                       |
| ------------------------------------------------------ | ------------------------- |
| Build a feature within these rules                     | `implementer` agent       |
| Verify the event taxonomy against the code             | `analytics-auditor` agent |
| Run the signup flow, a11y tree, responsive screenshots | `qa-a11y-perf` agent      |
| Review a diff for correctness, trade-offs, scope creep | `reviewer` agent          |
| Add an analytics event                                 | `/add-event`              |
| Start an A/B experiment                                | `/new-experiment`         |

Hooks (`.claude/settings.json`): every edit is formatted and linted **for that file only**; the
full typecheck runs once when Claude stops, because `astro check` is too slow for every edit.

## Commands

```sh
npm run dev           # http://localhost:4321
npm run build && npm start
npm run typecheck     # astro check + vue-tsc
npm run lint
npm test
```

Check Astro/Vue/zod APIs against current docs (context7) rather than memory: this repo is on
Astro 7 / Vite 8, newer than most training data.
