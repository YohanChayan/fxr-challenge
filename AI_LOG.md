# AI log

One entry per working session with Claude Code, newest last. The first four fields are the
prompt as given; the last four are filled in when the session ends.

## Template

```md
## <n>. <short title> — <YYYY-MM-DD>

**Goal:**
**Constraints:**
**Done when:**
**Verify by:**

**Delegated:** what Claude (or which agent/command) did
**Did myself:** what I decided or wrote by hand, and why
**Rejected / corrected:** AI output I changed or refused, and why
**Validated:** how I checked the result (commands, reading, QA runs)
```

---

## 1. Repository and Claude Code system setup — 2026-11-20

**Goal:** Set up the repo and the Claude Code system for this challenge. No feature code yet.
**Constraints:** Astro (current stable; FX Replay's own site runs Astro 6) + TypeScript strict. Vue only
for interactive islands. API as Astro server endpoints (@astrojs/node, standalone).
SQLite file on a volume: prefer the built-in node:sqlite if it is stable on the pinned
Node version, otherwise better-sqlite3; tell me which and why. zod schemas shared by
client and server. Pin Node to the current LTS in .nvmrc (my local Node is 26).
Check Astro/Vue docs with context7 instead of relying on memory.
**Done when:** the files below exist, `npm run dev` serves an empty page, and typecheck + lint pass.
**Verify by:** I read every file before we move on.

**Delegated:** Scaffold (create-astro, `astro add vue node`), tooling config, CLAUDE.md, the four
agents, the two commands, hooks and settings, `.mcp.json`, docs headings, and generating
`tokens.css` from the brand kit's `PRIM`/`SEM` objects with a one-off script.
**Did myself:** Chose `dark-500` for the undefined `btn-bg-primary-disabled`; approved adding
the Playwright MCP server; confirmed Astro 7 over 6.
**Rejected / corrected:**

- "Current stable Astro" is **7.4.13**, not 6, as the prompt implied; checked on npm and in
  the v7 upgrade guide.
- Latest TypeScript (7.0) is incompatible with typescript-eslint (`<6.1`) and `@astrojs/check`
  (`^5 || ^6`), so it is pinned to `~6.0`.
- `node:sqlite` is Stability 1.2 (Release Candidate) on Node 26, not Stable, so the rule
  selected better-sqlite3.
- `tseslint.config()` is deprecated; switched to ESLint's `defineConfig`.
- The template's `AGENTS.md` was removed: CLAUDE.md is the single instructions file.

**Validated:** _(to fill after review)_

## 2. Containerise with Docker Compose — 2026-11-21

**Goal:** One reproducible container plus a compose file the user deploys themselves to
`https://fxr-challenge.yhndevside.com`.
**Constraints:** Multi-stage build, runtime `node:26-slim`, production deps only, non-root,
`NODE_ENV=production HOST=0.0.0.0 PORT=4321`. One service, named volume at `/app/data`,
`DATABASE_PATH=/app/data/app.db` (agreed with the user-api session), `restart: unless-stopped`,
node-`fetch` healthcheck on `GET /`, exactly one replica. Optional `ADMIN_API_TOKEN` passed through
from the environment, never baked into the image. Don't touch `src/`. Never touch the server, never
read `.env*`, no CI/CD yet. Ask how traffic reaches the container.
**Done when:** `Dockerfile`, `.dockerignore`, `compose.yaml`, a README "Run with Docker" section,
and ARCHITECTURE "Deployment architecture" + "Hosting" exist.
**Verify by:** `docker compose build && up -d`; the healthcheck turns healthy; curl returns the page;
data survives `down && up`.

**Delegated:** Claude wrote the Dockerfile, `.dockerignore`, `compose.yaml`, `compose.prod.yaml`,
the Caddy site file, the project `.npmrc`, the README section, the ARCHITECTURE sections and the
DECISIONS entries.
**Did myself:** Chose ingress through the host's shared Caddy on the external `edge` network, with
no published port (the pattern of the other stacks on that host).
**Rejected / corrected:**

- The brief assumed better-sqlite3 "needs no compiler". In fact npm runs an implicit
  `node-gyp rebuild` for any package with a `binding.gyp`, and that failed on slim (no Python).
  The package loads its bundled `prebuilds/` directly, so the image installs with
  `--ignore-scripts`, and a build-time load check guards it.
- A clean `npm ci` failed with `ERESOLVE` (jsx-a11y vs eslint 10). It had only worked locally
  through a global `legacy-peer-deps`. Made explicit in a project `.npmrc`.
- A `compose.override.yaml` for local ports was rejected: Compose loads it automatically, so on
  the server it would silently publish a port.
- First layout: `compose.yaml` was production (external `edge`), with a `compose.local.yaml`
  overlay for local runs. In my own local run, plain `docker compose up` failed with "network
  edge declared as external, but could not be found". Flipped it: `compose.yaml` is local
  (port bound to `127.0.0.1` only), and `compose.prod.yaml` removes the port (`!reset`) and
  joins `edge`. This matches Arcadia's `compose.prod.yml`. Forgetting the overlay on the server
  exposes nothing; the site is just unreachable through Caddy.

**Validated:** Image built on linux/arm64 (OrbStack); the better-sqlite3 load check passed in the
runtime stage. Container `healthy`, `GET /` → 200, process uid 1000 (`node`), `/app/data` owned by
`node`. Users API: POST → 201, duplicate → 409 after `restart` and after `down` + `up`;
`GET /api/users` → 401 with no token, 401 with a wrong token, 200 with the right one.
`docker history` shows no `ADMIN_API_TOKEN`. `down` takes 0.3 s (SIGTERM reaches node through
`init`). The online `backup()` command produced a readable copy. Not verified: linux/amd64 (the
server's architecture, not checked) and the live deployment, which the user runs.

## 3. Users API: create, update, list — 2026-11-21

**Goal:** A Users API for the signup island to call: create, update and list, with one contract
for validation, failures and async behaviour.
**Constraints:** zod schemas shared by client and server. A repository is the only module that
contains SQL. Handlers stay thin. `DATABASE_PATH` is the name agreed with the dockerize session.
No UI, no analytics events, no Docker files, no new dependencies.
**Done when:** typecheck, lint, format:check and test pass; `reviewer` has reviewed the change;
ARCHITECTURE "API / integration approach" holds the contract table.
**Verify by:** Vitest (schemas, repository on `:memory:`, handler status codes); smoke test of the
built server.

**Delegated:**

- The scaffold session wrote the brief.
- `implementer` built the schemas, `db.ts`, the repository, the handlers, the routes,
  `.env.example`, the tests and the DECISIONS entries.
- `reviewer` reviewed the change: approve with fixes, no blocking findings.
- `implementer` then applied the fixes.
- Claude wrote the ARCHITECTURE section.

**Did myself:** Chose email-only signup, with name and experience level (`beginner |
intermediate | advanced`) set later via `PATCH`, so the update endpoint has a real job and the
form stays one field.
**Rejected / corrected:**

- **List auth, added by Claude.** A public `GET /api/users` would have published every signup's
  email on the live deployment. It now requires `ADMIN_API_TOKEN` and is disabled when the token
  is unset.
- **The analytics id.** Because the uuid alone authorises `PATCH`, analytics must carry a
  separate opaque id, never `users.id` (raised by the scaffold session).
- **Body size.** Reviewer found that the node adapter accepts bodies up to 1 GiB on an
  unauthenticated `POST`. The cap is now 16 KiB, returning 413 `payload_too_large` (a new error
  code), and it also covers chunked bodies.
- **DECISIONS claims the code didn't support.**
  - "No server logs" became "no application logs": the uuid sits in the `PATCH` URL, so proxy
    access logs could record it.
  - "One-file swap to `node:sqlite`" became "two modules".
  - Recorded that the 409 lets anyone check whether an email has an account.
- **Comments and tests.**
  - The analytics comment read as if the event already fired; it is now a `TODO`.
  - Added the missing 500-path tests, a test that the id is absent from error logs, and a
    `DATABASE_PATH` test.
- **A false alarm.** Claude warned that `--ignore-scripts` in the Docker build would drop
  better-sqlite3's native binary. The scaffold session checked: 13.2 bundles its prebuilds, so
  the warning was wrong.
- **Formatting.** `format:check` failed on `.claude/settings.local.json`, machine-local config.
  It is now in `.prettierignore` rather than reformatted.

**Validated:** typecheck, lint, format:check, and test (85 tests in 4 files) pass; `npm run build`
succeeds. A smoke test of the built server on a scratch database returned:

- `POST` 201, a duplicate 409, bad input 400;
- `PATCH` 200, an unknown id 404;
- `GET` 401 without the token, 200 with it, including a lowercase `bearer` scheme;
- 413 for an oversized body, both with Content-Length and chunked.

The dockerize session separately got `POST` 201 against the container. Not verified: the live
deployment, and `.env.example`'s contents (agents cannot read `.env*`; check by hand).

## 4. Landing page (static, zero JS) — 2026-11-21

**Goal:** Build the "Try FX Replay Free" landing page from my copy. Static Astro.
**Constraints:** Semantic tokens only; scoped plain CSS; dark-first. Lato headings and Nunito
Sans body, self-hosted, only the weights used, `font-display: swap`, h1 font preloaded. One h1.
Zero JS, with a marked slot for the signup island. Small blue text in blue-500. Brand logo;
"not affiliated" footer; `noindex`. Title, description, canonical, OG, JSON-LD
`SoftwareApplication` with a price-0 Offer. Landmarks, skip link, visible focus, reduced motion,
FAQ with native `<details>`. Copy as written. The "No credit card required" variant is not
rendered: a marked slot under the CTA.
**Done when:** it looks right at 375/768/1440, `npm run build` passes, and fonts and images cause
no CLS.
**Verify by:** `reviewer` on the diff, then `qa-a11y-perf` screenshots at 375/768/1440 on
localhost; I check the screenshots.

**Delegated:**

- Claude planned the page and built it: `BaseLayout.astro` and the header, hero, steps, FAQ and
  footer components.
- Fonts through Astro's built-in Fonts API (fontsource provider): no new dependency, and
  fallback faces with matched metrics.
- `reviewer` reviewed the result. `qa-a11y-perf` ran but was blocked (see below).

**Did myself:**

- Answered Claude's three questions. Small blue text uses a new semantic token,
  `--text-brand-small → blue-500`; I had written "blue-500 (#0260FD)", but #0260FD is blue-600.
  The problem line is an eyebrow above the h1. No `og:image` until a PNG exists.
- Approved adding `--browser chromium` to `.mcp.json`.

**Rejected / corrected:**

- **Claims the copy doesn't make.** The reviewer flagged JSON-LD `applicationCategory` and
  `operatingSystem`, and `og:site_name`, as unsupported by the copy and at odds with the "not
  affiliated" footer. They were dropped. `priceCurrency: USD` stays as a labelled assumption
  (schema.org needs a currency next to a price).
- **The meta description** had a sentence that wasn't in my copy. It is now the eyebrow plus the
  subhead, verbatim.
- **A PERFORMANCE.md overclaim.** "The swap does not shift layout" became "minimise". The
  reviewer also noticed that Astro orders the 400 Nunito fallback face before the bold one.
- **Hero glow** (a `--card-bg-secondary` gradient) removed. It cut the eyebrow's contrast margin
  and misused a card token.
- **Smaller fixes:**
  - the global focus rule no longer changes `border-radius`;
  - the skip link shows on `:focus`;
  - the signup slot is a plain `div`, so the island's form becomes the landmark;
  - the FAQ `+`/`−` markers have empty alt text.
- **QA blocked.** The Playwright MCP looked for Google Chrome, which isn't installed. It now uses
  the installed Chromium.

**Validated:**

- typecheck, lint, format:check and test (85) pass, and `npm run build` succeeds.
- The built `index.html` has one `h1`, no `<script>` except JSON-LD, and one font preload (Lato
  700). Three woff2 files, all `font-display: swap`, and `noindex` and a canonical URL. No hex
  values or primitive tokens outside `tokens.css`.
- `qa-a11y-perf` against the production build (local container, Chrome for Testing):
  - one h1, headings in order, landmarks, skip link to `main`, and the expected tab order;
  - a visible focus ring (4.0:1); the FAQ opens with Enter and Space;
  - every text colour passes AA, and the eyebrow is 5.26:1;
  - 0 JS requests, a single Lato preload, and 0 console errors; nothing animates under
    reduced motion;
  - no horizontal scroll at 375/768/1440, and the CTA above the fold at 375;
  - lab CLS 0 and LCP 56 ms.
- QA found three cosmetic issues: a 1–2 px skip-link sliver, the skip link's outline clipped
  when focused, and the FAQ column offset at 1440. All three were fixed and rechecked.
- I checked the screenshots in `qa-artifacts/` at 375/768/1440: approved.
- **Not verified:** whether screen readers announce the FAQ questions as expanded or collapsed
  (needs VoiceOver or NVDA).

## 5. Signup island and Users API to the brief's contract — 2026-11-21

**Goal:** Make signup work end to end. Bring the Users API up to the brief's contract (422
validation, a 429 rate limit, `Idempotency-Key`, a `preferred_market` enum) and build the Vue
island that fills the hero's `#signup` slot.
**Constraints:** Shared zod contracts first, then the server, then the island. Markets are
`forex | crypto | stocks | indices | futures`. PATCH accepts only `{ preferredMarket }`. `name`
and `experienceLevel` are removed from the API and the DB. Keep `ADMIN_API_TOKEN`. Semantic
tokens only. Exactly one analytics TODO, in the island's 201 branch, and no `track()` calls.
Keep the 413 cap, the constant-time bearer check, the keyset cursor, and the rule that the id
is never logged. No new dependencies.
**Done when:** typecheck, lint, format:check, test and build pass; `reviewer` has no blocking
findings left; `qa-a11y-perf` has run the flow on localhost with screenshots.
**Verify by:** Vitest; a smoke test of the built server; `qa-a11y-perf` (invalid email,
duplicate 409, success with focus and PATCH, the a11y tree, and 375/768/1440 screenshots); my
own reading of `users-handlers.ts`, `users-repository.ts` and `rate-limit.ts`.

**Delegated:**

- The main session planned the block, and I settled the open questions.
- `implementer` built:
  - the schemas (`MARKETS`, `IdempotencyKeySchema`, new error codes);
  - 400/422 in `http.ts` and the `PRAGMA user_version` migrations in `db.ts`;
  - the idempotent create in the repository, and `rate-limit.ts`;
  - the handler changes, `SignupForm.vue` and the `Hero.astro` mount;
  - `TRUST_PROXY` in `compose.prod.yaml`;
  - the tests and the DECISIONS / ARCHITECTURE / PERFORMANCE updates.

**Did myself:** Chose the markets, PATCH with `preferredMarket` only, keeping
`ADMIN_API_TOKEN`, 422 vs 400, the idempotency storage in SQLite, and the 5/60 s in-memory
limit.
**Rejected / corrected:**

- **The proxy IP.** The plan guessed that `clientAddress` behind Caddy is the proxy. The
  installed Astro 7.4.13 source confirms it: `X-Forwarded-For` is trusted only when
  `security.allowedDomains` matches, and even then the left-most (client-controlled) entry is
  used. So the limiter takes the right-most entry, and only under `TRUST_PROXY=1`. Caddy's docs
  confirm it discards client-sent `X-Forwarded-For` by default.
- **The live region.** A `:empty { display: none }` rule on the live region was removed before
  it shipped. A hidden live region can miss announcements.
- **The input border.** No neutral border token reaches 3:1 on `--bg-primary`, so the input
  uses `--border-brand` instead of inventing a token (DECISIONS).
- **The analytics TODO.** The server-side `TODO(analytics)` was removed. The only TODO is in
  the island's 201 branch, so `sign_up` cannot fire twice.

**Validated:**

- typecheck, lint and format:check pass; test passes (132 tests in 5 files); `npm run build`
  succeeds.
- A smoke test of the built server on a scratch database returned:
  - `POST` 201, then a replay with `Idempotent-Replayed: true`;
  - the same key with another email 422 `idempotency_key_reused`, and bad JSON 400;
  - `PATCH` 200 with `crypto` and 422 for `gold`;
  - 429 with `Retry-After: 60` on the sixth `POST`, and a forged `X-Forwarded-For` ignored
    without `TRUST_PROXY`.
- **`reviewer`:** no blocking findings; approved with fixes. Its should-fix items were applied in
  the main session:
  - the field error is now `role="alert"`, because re-focusing an already focused input
    announced nothing;
  - the invalid border stays `--border-brand` at 2px, because `--border-error` is about 2.5:1;
  - `.gitignore` now covers `*.db`, `*.db-shm` and `*.db-wal`.
    Nits fixed: the input is `readonly` while submitting, and ARCHITECTURE has the `fields` note.
    Nits left as notes: rollback after v2, the pre-hydration submit, IPv6 /64 buckets.
- **`qa-a11y-perf` on localhost** (production build, scratch DB): all six checks pass.
  - Invalid email: inline error, `aria-describedby` and `alert`.
  - Duplicate email: 409 shown inline.
  - Success: focus on the `h2`; 5 radios; `PATCH` 200 announced as "Saved: …".
  - Busy state: `aria-busy`, button disabled, input readonly; one POST for a triple click.
  - Network: the email appears in no URL, and there are no third-party requests.
  - Layout: CLS 0 on hydration and no overflow at 375/768/1440.
    QA found focus dropping to `<body>` during Save (the fieldset and button were `disabled`).
    Fixed in the main session: the fieldset is no longer disabled, and Save is `aria-disabled`
    with the existing re-entry guard. QA re-verified it with the keyboard: focus stays on Save
    during and after saving, and three presses send one `PATCH` (200).
- **QA findings left open:**
  - The 409 message offers no next step.
  - The hero CTA is still shown after success.
  - The invalid border can read like the focus ring.
  - The Node server does not compress JS; the proxy should.
- **Pending:** my own reading of the endpoint code.
- **Not verified:** the live deployment (it needs a redeploy; migration v2 runs on first open),
  and screen-reader announcements.

## 6. Signup in a modal dialog; types and code reorganised — 2026-11-21

**Goal:** Make the hero CTA a button that opens the signup flow in a native `<dialog>`, and split
the 461-line `SignupForm.vue` into `src/types/`, an API client, a composable and three
components.
**Constraints:** The API contract does not change. `showModal()` and no focus-trap dependency.
Keep every existing state and a11y fix. Block closing while a request is in flight. Scroll
lock. Semantic tokens only. No animation under reduced motion. Fits at 375px with a 16px
gutter. Exactly one `TODO(analytics)` in the 201 branch, and no `track()`. Hand-written exported
types go in `src/types/`, type-only; inferred types stay in `src/lib/schemas/user.ts`. No new
dependencies; no Vue component tests if they would need one.
**Done when:** typecheck, lint, format:check, test and build pass; the 132 existing tests still
pass; the API client and the composable have Vitest coverage; `reviewer` and `qa-a11y-perf` have
run.
**Verify by:** Vitest; a build and a read of the prerendered HTML; `qa-a11y-perf` on localhost
(open, Esc, backdrop, Close, focus return, busy block, reopen after success, 375px);
`reviewer` on the diff.

**Delegated:** `implementer` built:

- `src/types/` (signup, users, http, rate-limit), with the server modules now importing their
  types from there;
- `src/lib/api/users.ts` and `src/composables/useSignup.ts`;
- `src/components/signup/` (SignupIsland, EmailForm, MarketPicker, markets);
- the Hero and index changes, and deleting `SignupForm.vue`;
- the two new test files;
- the ARCHITECTURE, DECISIONS and PERFORMANCE updates.

**Did myself:** Chose the modal over the inline form, the native `<dialog>`, the blocked close
while busy, and the target layout of types and modules.
**Rejected / corrected:**

- **Test timing.** The first composable tests set the email and submitted in the same tick. The
  email watcher then ran during the submit and reset a fresh `invalid` state to `idle`. That
  cannot happen in the browser, where typing comes well before a submit, so the tests now flush
  the watcher after setting the email; the composable is unchanged.
- **Vue component tests.** Not added: they need `@vue/test-utils` and a DOM (`happy-dom` or
  `jsdom`), neither installed. The dialog behaviour is left to `qa-a11y-perf`.

**Validated:**

- typecheck: 0 errors, 0 warnings, 0 hints. lint is clean, and format:check passes.
- test passes: 165 tests in 7 files (the 132 existing, plus 33 for the API client and the
  composable). `npm run build` succeeds.
- The prerendered HTML has the CTA `<button aria-haspopup="dialog">` and a closed `<dialog>`.
- The island chunk is 28,626 bytes gzipped, and the Vue runtime 30,084 bytes.
- **`reviewer`:** no blockers; approved with fixes. Applied in the main session:
  - Retry moves focus to the email input before resubmitting, because the button vanished while
    submitting and dropped focus to `<body>`.
  - The submit button is `aria-disabled` instead of `disabled`, for the same reason.
  - The Esc-block comment and ARCHITECTURE no longer overclaim; they point at the Chrome limit
    in DECISIONS.
  - The pre-hydration `method="post"` is now described as a safe default, not a reachable path.
  - The form's duplicate `aria-label` is gone.
  - The panel scrolls instead of the dialog, so a press on a scrollbar is not a backdrop click.
  - `scrollbar-gutter: stable` while open.
    Left as is: `useSignup.ts` imports `MARKET_LABELS` from `components/signup/`, and there is no
    lint rule guarding island imports from server type files (with more time).
- **`qa-a11y-perf`**, run against the user's running `astro dev` server at the user's choice
  (the port was taken; not the production build, so perf numbers are indicative only): all 13
  checks pass.
  - Open, Esc, Close and backdrop: focus returns to the CTA, the background is inert and the
    page doesn't scroll.
  - Invalid email, 409 inline, and success with the market saved (`PATCH` 200).
  - Reopening after success shows the success state.
  - Retry and submit keep focus; one POST per triple click.
  - No overflow at 375/768/1440, CLS 0, reduced motion honoured.
  - The dialog cannot close while busy, except a third Esc in Chrome (non-cancelable `cancel`);
    the result then shows on reopen.
- **QA findings left open:**
  - The 409 message offers no next step.
  - A success that lands after a forced close is not announced until the dialog is reopened.
  - The dialog title still says "Create your free account" on the success screen.
- **Pending:** a QA run on the production build; my own reading of the island.
- **Not verified:** the production build in a browser, a real scrollbar-thumb press (headless
  Chrome uses overlay scrollbars), and real screen-reader speech.

## 7. Analytics layer and the trust-line-v1 experiment — 2026-11-21

**Goal:** A typed analytics layer, plus the "No credit card required" A/B experiment.
**Constraints:**

- `track()` is typed from `taxonomy.ts` and pushes to `window.dataLayer`.
- GA4 loads only after consent, with Consent Mode v2 defaults set to denied.
- Every event carries `event_id`, `session_id` and `variant`. No PII.
- 11 named events.
- `trust-line-v1`: 50/50, a sticky cookie, assigned by an inline `<head>` script before first
  paint. `experiment_exposure` fires once per page view, in both arms.

**Done when:** `analytics-auditor` reports clean, the experiment stub exists, and the build and
tests pass.
**Verify by:** `analytics-auditor`; then window.dataLayer on localhost; then GA4 DebugView.

**Delegated:**

- **Main session.** Ran the `/add-event` and `/new-experiment` flows, and built the code:
  - `src/analytics/` and `src/experiments/`
  - `AnalyticsIsland.vue` (the consent banner, `page_view` and exposure)
  - the signup instrumentation, the tests, the docs, and the `PUBLIC_GA4_ID` Docker build arg
- **`analytics-auditor`**, 3 passes: NOT CLEAN, then NOT CLEAN, then CLEAN.
- **`reviewer`:** approved with fixes.
- **`qa-a11y-perf`** on the user's running `astro dev`: 7 of 7 checks pass.

**Did myself:**

- **Taxonomy approach.** I led the design of the event taxonomy: I defined the event types per
  user scenario, then delegated the implementation.
- **Inline script.** The `<head>` script is `bootHead()` serialised with `Function#toString`, so
  the same code is unit-tested and also run from the built `dist/` in a clean VM.
- **GA4 parameter.** GA4 gets `fxr_session_id`: gtag has its own `session_id` field.
- **Consent buffer.** Pre-consent events are kept in memory and replayed on Accept, so GA4 does
  not lose `page_view` or exposure.

**Rejected / corrected:**

- `/add-event`'s past-tense naming rule: the brief's and GA4's names win, and the rule was
  amended.
- `/add-event`'s "no call sites": out of scope for this task.
- A literal "first focus" for `signup_form_start`: it would equal `signup_modal_open`.
- `/new-experiment`'s "in view, once per session": the brief asks for once per page view.

**Fixes from the reviews:**

- **Auditor:**
  - The full referrer reached GA4 (F1), now trimmed to the origin with `page_referrer`.
  - `step: 'email'` mixed up "never submitted" with "rejected" (F2), now a new `rejected` step.
  - Tab-refocus fired form_start (F3), now ignored.
  - A lost 201 followed by an edit lost the `sign_up` (F4b), now one idempotency key per email.
  - `utm_*` let free text, phones and names through (F6, R1), now a slug-only allowlist with
    fewer than 7 digits.
- **Reviewer:**
  - The `gtag`-already-defined path skipped the replay, now fixed.
  - The form-start guard had no test, now extracted to `useFormStart.ts` and tested.
  - Two overclaims in ANALYTICS.md were corrected.
- **QA:**
  - D1: `scroll-padding-bottom` of 180px was below the measured 192px and 216px phone banner.
    It is now 240px, and 120px from 768px up.

**Validated:**

- typecheck: 0 errors. lint is clean, format:check passes, and the build succeeds.
- tests: 9 files pass, including `analytics.test.ts`, `experiment-boot.test.ts` and new
  `use-signup` event tests.
- The emitted `dist/` boot script (1,722 bytes) runs in a fresh `vm` context. It assigns a new
  visitor, keeps a stored arm, and reassigns on a malformed cookie.
- **QA:**
  - Attributes are set before stylesheets, and CLS is 0 in both arms.
  - Exactly 1 `page_view` and 1 exposure, with all three context fields.
  - Reject loads nothing. Accept requests gtag.js once, with consent default → update → js →
    config, then the replay.
  - The signup events, in order, are correct for invalid, Esc-before-submit, 201 + market, and
    409 → `rejected`.
  - No email or user id anywhere in the dataLayer.
  - The banner does not cover the CTA or the trust line at 375, 768 or 1440.

**Not verified:**

- That gtag.js runs and sends hits: the QA browser blocks off-origin requests. Pending:
  GA4 DebugView, by the user.
- The production build in a browser.
- The banner below 375px wide.

**Open:**

- No consent-withdraw link (see "With more time").
- The experiment cookie is set before consent (accepted, DECISIONS).
- The experiment's guardrails, sample size and decision criteria are TODO.
- The 409 message offers no next step (QA D3, already known).

## 8. Hero background image — 2026-11-21

**Goal:** Add a hero background image without hurting LCP or CLS.
**Constraints:**

- Astro `<Picture>` in AVIF and WebP, widths 640, 1024 and 1672, `sizes="100vw"`.
- `fetchpriority="high"`, `loading="eager"`, and explicit width and height.
- Decorative.
- A `--bg-primary` overlay from the left, so the text keeps AA contrast.
- `object-position: right` on mobile.

**Done when:** The hero looks right at 375, 768 and 1440, and the text still meets AA.
**Verify by:** Lighthouse mobile before and after; `qa-a11y-perf` screenshots.

**Did myself:**

- Found the image, `bg_trading-sailboat-bg.webp`, 1672×941.
- Copied it to `src/assets/hero/hero-bg.webp` and wrote the `<Picture>` and overlay in
  `Hero.astro`.
- Set the `<img>` fallback to WebP. Astro's default was PNG, up to 1.3 MB per width.
- Sized the overlay from a per-column worst-pixel calculation: the 15px eyebrow needs about 0.92
  over the brightest pixels.
- Moved the light desktop gradient to 1024px and up, because at 768px the copy still reaches
  about 60% of the width.
- Ran Lighthouse 12 (via npx, not added as a dependency) against local production builds on port
  4322, three runs each.

**Delegated:**

- `reviewer`: found a blocker. `::before` painted under the `<picture>` at equal z-index (tree
  order), so the overlay had no effect. Fixed by moving it to `::after`. Also found that the
  desktop stops followed the viewport, not the centred 1120px container, so the copy drifted
  past them on wide screens. Fixed with `max(40%, calc(50% - 60px))`-style stops.
- `qa-a11y-perf`: took screenshots at 375, 768 and 1440 (`qa-artifacts/hero-bg-*.png`) and
  measured worst-case contrast with the text hidden. Its pre-fix measurement failed (1.0–2.4:1),
  which confirmed the reviewer's blocker.

**Rejected:**

- `<link rel="preload">` for the image. The `<picture>` is already in the initial HTML with
  `fetchpriority="high"`, and a multi-format preload risks a double download.

**Validated:**

- typecheck, lint, format:check and tests (213) pass.
- Lighthouse mobile LCP: 2.7–2.8 s before (the h1), 2.8–2.9 s after (the image: 24 KB AVIF, zero
  load delay, 85% render delay). CLS is 0 in both.
- After the fix, every hero text element passes AA at 375, 768, 1440 and 1920px. The tightest
  is the eyebrow at 375px, 5.11:1.
- The image is absent from the accessibility tree.
- The CTA still opens the dialog.

**Not verified:**

- DPR above 1.
- Safari and Firefox.
- The deployed URL.

**Follow-up, the same day:** the user reported that the image was cut off. `object-fit: cover`
cropped the bottom 190px at 1440, including the boat's hull, and more than half the image at
375px.

- Below 1024px the image is now an in-flow band under the CTA, with no overlay and a 6% top fade.
  Its edges are navy (rgb 0,14,33), not `--bg-primary`.
- From 1024px it uses `contain`, anchored right and bottom. The hero's min-height is
  `min(100vw × 941/1672, 720px)`, and the overlay hides the left seam.
- `qa-a11y-perf` at 375, 768, 1024, 1440 and 1920px: nothing is cropped. The minimum contrast at
  1024px and up is the eyebrow at 5.24:1, and the h1 is 7.08:1 at 1024px. CLS is 0.
- Lighthouse mobile is unchanged at 2.8–2.9 s.

**Open:**

- The bottom edge of the image meets the next section with a straight edge. The section border
  makes it read as a boundary.
- The lab LCP was over the 2.5 s budget before this change; the cause is render delay (CSS and
  fonts).

## 9. Security headers in Caddy — 2026-11-21

**Goal:** make the Caddy site file set the headers `docs/ARCHITECTURE.md` § Security says it sets.
**Constraints:** repo edit only, no server changes; leave Cache-Control to the Astro node adapter; no CSP yet.
**Done when:** the site file sets HSTS, nosniff, Referrer-Policy, X-Frame-Options and Permissions-Policy, strips `Server`/`Via`, and validates.
**Verify by:** `caddy validate` in a throwaway `caddy:2` container.

**Delegated:** a peer Claude session asked for it; Claude added the `header` block to `docker/prod/caddy/fxr-challenge.yhndevside.com.caddy`.
**Did myself:** nothing yet. Deploying is still manual: copy the file to `/srv/platform/caddy/sites/`, then `caddy reload`.
**Rejected / corrected:** nothing.
**Validated:** `caddy validate` reports "Valid configuration", and `caddy fmt --diff` shows no changes. The live headers are not checked until it is deployed.
