# Decisions, assumptions and trade-offs

## Assumptions

### Signup collects email only; the market is asked afterwards

`POST /api/users` takes `{ email }` and nothing else, because a one-field form has the least
friction at the moment of conversion. The success screen then asks "Which market do you want to
replay first?" (`forex | crypto | stocks | indices | futures`) and saves it with
`PATCH /api/users/:id { preferredMarket }`. That is the only field PATCH accepts, and it is
required. This replaces the earlier `name` + `experienceLevel` assumption: both were removed
from the API and, through migration v2, from the database.

### The admin token keeps the name `ADMIN_API_TOKEN`

The brief calls it `ADMIN_TOKEN`. The code, `compose.yaml` and the README already used
`ADMIN_API_TOKEN`, and renaming it would silently disable listing on any deployment whose `.env`
still has the old name. Kept as is.

## Trade-offs

### The signup list requires an admin token

`GET /api/users` returns every signup's email, so it is not public. It requires
`Authorization: Bearer <ADMIN_API_TOKEN>`. A missing or wrong header returns 401, and so does an
unset `ADMIN_API_TOKEN`, which disables the list. The token is compared with
`crypto.timingSafeEqual` on SHA-256 digests of both values, so the buffers are always the same
length.

### PATCH is authorised by knowing the user's id

`POST` and `PATCH` have no authentication. The random v4 uuid returned by the signup response
is the capability that lets the success screen save the preferred market. Anyone holding the id
can change that one field and sees that user's record in the response. They cannot
change the email (PATCH is strict and rejects it) or reach any other user. Because the id is
the only thing authorising PATCH, **it must never leave the signup response**:

- no analytics event properties (a constraint for the analytics step: when events arrive via
  `/add-event`, they carry a separate opaque analytics id, never `users.id`);
- no application logs (the 500 path logs the route and error only);
- no list response to unauthenticated callers (already true: the list is 401 without the token);
- the id is in the URL path, so proxy or Caddy access logs must not record request paths for
  `/api/users/*`.

### A malformed user id returns 404, not 400

`PATCH /api/users/not-a-uuid` returns `404 not_found`, the same as an unknown uuid, so the
response does not reveal the id format.

### Duplicate email: 409 from the UNIQUE index, not a pre-check

The repository inserts and maps better-sqlite3's `SQLITE_CONSTRAINT_UNIQUE` to `email_taken`
(409). Checking first with a `SELECT` would race between two concurrent signups. Email is
trimmed and lowercased by the shared zod schema first, so `Ann@x.com` and `ann@x.com` collide.
The 409 lets anyone check whether an email has an account. This is accepted for signup UX; the
rate limit below caps how fast that check can be run from one IP.

### 422 for validation, 400 only for an unparseable body

A body that is not JSON at all (empty, truncated, not JSON) is a syntax error: `400 bad_request`.
Well-formed JSON that fails the schema (wrong type, bad email, unknown key, bad enum, bad
`limit` or cursor, a malformed `Idempotency-Key`) is `422 validation_error` with `fields`. This
follows RFC 9110 (422 is "understood, but cannot be processed") and the IETF idempotency-key
draft, and lets the island treat 422 as "show the field error" without guessing.

### Idempotency-Key on POST, stored in SQLite

`POST /api/users` accepts an optional `Idempotency-Key` header (1–255 printable ASCII). The
island sends a `crypto.randomUUID()` per normalised email value: Retry reuses it, editing the
email to another address makes a new one, and editing it back reuses the first. Otherwise a lost
201 followed by an edit would turn into a 409, and `sign_up` would never fire. In the repository, inside the same `IMMEDIATE` transaction as the insert:

- The key is looked up. Same key and same request hash (SHA-256 of the normalised email): the
  stored 201 body is replayed with `Idempotent-Replayed: true`, and no second row is written.
  Same key, different hash: `422 idempotency_key_reused`.
- On a miss, the user is inserted and the key, hash and 201 body are stored in
  `idempotency_keys`. Only 201s are stored; a retry after a 409 recomputes to 409 anyway.
- Keys older than 24 h are ignored, and pruned on each keyed write.

Why it matters: if the 201 is lost (network drop, tab backgrounded), a retry would otherwise
get 409 "email taken" for the account it just created, and the user would never see the
success screen or the id needed for PATCH. better-sqlite3 is synchronous, so two requests with
the same key cannot interleave on one node.

Trade-offs: the replay returns the user as it was at creation, not after a later PATCH (the
standard "same response" semantics). Keys are global, not per client; a key is a random uuid,
so another client would need both the key and the email to get a replay.

### Rate limit: 5 POSTs per 60 s per IP, in memory, single node

`src/lib/server/rate-limit.ts` is a fixed-window counter per client IP: the sixth
`POST /api/users` inside 60 s gets `429 rate_limited` with `Retry-After` in seconds. It runs
before the body is read, so malformed attempts count too. State is per process: it resets on
restart and is not shared between replicas, which matches the one-replica deployment. Expired
windows are pruned once more than 10,000 IPs are tracked. Scaling out needs a shared store.

**Which IP.** In Astro 7.4's node adapter (`astro/dist/core/app/node.js`), `clientAddress` is
the socket peer unless `security.allowedDomains` is configured, and even then it is the
left-most `X-Forwarded-For` entry, which the client controls. This repo sets no
`allowedDomains`, so behind Caddy `clientAddress` is Caddy's address and every visitor would
share one bucket. With `TRUST_PROXY=1` the limiter uses the right-most `X-Forwarded-For` entry
instead. Caddy ignores incoming `X-Forwarded-*` values from untrusted clients and sets the
header itself, so that entry is the real client IP and cannot be forged. `compose.prod.yaml`
sets `TRUST_PROXY: '1'`; the local `compose.yaml` and `npm start` leave it off, so a forged
header has no effect when nothing is in front. If a CDN is ever put in front of Caddy, Caddy's
`trusted_proxies` must be configured, or the right-most entry becomes the CDN's address.

### Keyset pagination for the list

The list is ordered by `(created_at DESC, id DESC)`, backed by an index on those columns, and
paged with a keyset cursor: base64url of the last row's `created_at|id`, opaque to clients. It
fetches `limit + 1` rows to know whether there is a next page. Unlike `OFFSET`, a signup that
arrives mid-pagination does not shift pages and cause repeated or skipped rows, and the cost
does not grow with the page number. A malformed cursor returns 422.

## Brand kit

### `tokens/` and `source/` folders missing

The brand kit's README describes `tokens/tokens.css`, `tokens/tokens.json` and `source/*.pdf`,
but the delivered kit contains only `README.md`, `brand-kit.html` and `logos/`.
`src/styles/tokens.css` was therefore generated from the `PRIM` (44 primitives) and `SEM`
(60 semantic tokens) objects inside `brand-kit.html`, with names slugified
("Electric Blue" → `--electric-blue`). `card-bg-translucent` is `color-mix()` of `dark-900` at
60%, as the README specifies.

### `btn-bg-primary-disabled` → undefined `blue-950`

The kit points this token at `blue-950`, which does not exist (the blue scale stops at
`blue-900` `#012054`); the kit's own HTML falls back to `#000000`, which is invisible on the
`#030303` page background.
**Decision:** repoint to `dark-500` (`#3A3A3A`), the value `btn-bg-secondary-disabled` already
uses: no invented brand value, and disabled reads the same on every button type. Alternatives
rejected: `blue-900` (identical to the pressed state), a new `blue-950` (unapproved brand
value), `#000000` (invisible).

### `text-brand` contrast on `bg-primary`

`text-brand` (`#0260FD`) on `bg-primary` (`#030303`) is about **4.0:1**: it passes WCAG AA for
large text (≥ 3:1) but fails for body text (4.5:1). Use it for headings or large text only.

### `text-brand-small` — a semantic token the kit does not have

Small blue text (the eyebrow, step numbers, FAQ markers) needs AA body contrast, and no kit
token points text at a lighter blue. **Decision:** add `--text-brand-small: var(--blue-500)`
(`#2C7BFD`, about 5.3:1 on `#030303`) instead of referencing the primitive from a component.
`text-brand` itself is unchanged, so large brand text keeps the kit's Electric Blue.

## Landing page

### Signup island: `client:visible`, `method="post"` before hydration

`SignupIsland.vue` is the only island. `client:visible` is enough: the CTA is in the hero, above
the fold, so the island hydrates as soon as the page loads. The email `<form>` keeps
`method="post"` and no `action` as a safe default only: before hydration the form sits inside a
closed `<dialog>`, which is not rendered, so it cannot be submitted. If that ever changed, a
pre-hydration submit would POST to the page and the email would still never end up in a URL,
history or access log. After hydration, `@submit.prevent` sends JSON to `/api/users`.

### The CTA opens a native `<dialog>` with the signup flow

The hero CTA is a `<button aria-haspopup="dialog">` rendered by the island. It opens the email
form and then the market picker in a native `<dialog>` via `showModal()`. Before this, the CTA
was a link to an inline form below it.

- **Why a native dialog, not a library.** `showModal()` provides focus containment, Esc, an
  inert background and the top layer, with no dependency and no focus-trap code to maintain.
  The island adds only what the platform does not: focus on open, closing on a backdrop click,
  explicit focus return to the CTA, and blocking the close while a request is in flight. That
  last one keeps a result from landing in a closed dialog.
- **Trade-off: one more click.** The visitor now clicks the CTA before reaching the email field,
  where the inline form showed the field on the page. That cost is a candidate for the
  experiment (inline form vs modal), not settled here.
- **Trade-off: the CTA is inert before hydration.** The server-rendered button does nothing
  until the island hydrates; there is no `href` fallback. This is acceptable because the CTA is
  above the fold and `client:visible` hydrates it on load, so the window is the time to download
  and run the island chunk.
- **Limit: Esc may bypass the block.** Under the HTML close-watcher rules (as implemented in
  Chrome), a second Esc with no user activation in between can close a dialog even though
  `cancel` is cancelled. If that happens mid-request, the state persists in the island: the
  result shows when the dialog is reopened, but its live announcement is missed. Not verified in
  a browser.
- **Heading levels.** The dialog's `h2` names it ("Create your free account"), so the success
  heading, "Your free account is ready", is now an `h3`. It is still focused after a 201.

### Input border uses `--border-brand`

WCAG 1.4.11 needs 3:1 for the input's boundary. The neutral border tokens (`--border-primary`,
`--border-secondary`, `--border-tertiary`) are about 1.2–1.8:1 on `--bg-primary`, so the email
input uses `--border-brand` (about 4.0:1). The market options use `--btn-border-outline`, as
outline-button-style choices. No token was added.

In the invalid state the border stays `--border-brand` and only thickens to 2px:
`--border-error` (`error-dark`) is about 2.5:1 on `--bg-primary`, below 3:1. The error text
(`--text-error`, `role="alert"`) carries the meaning. The kit has no error border that passes.

### The problem line is an eyebrow above the h1

"Testing a strategy live costs time and money." sits directly above the h1 in the hero, so
the problem and the promise read in one view at 375 px. A separate section was rejected: it
would push the CTA down and need a heading of its own.

### Section headings are functional labels

The copy has no headings for the steps and the FAQ, so they are labelled "How it works" and
"FAQ": navigation labels, not claims about the product.

### Fonts through Astro's Fonts API, not `@fontsource/*` packages

The built-in Fonts API (Astro 6+) downloads the files at build time and serves them from this
origin. It emits only the configured weights (Lato 700; Nunito Sans 400 and 700, latin,
normal), `font-display: swap`, a preload only where asked (Lato, the h1 font), and fallback
faces with `size-adjust` and ascent/descent overrides so the swap barely moves text. It needs no
extra dependency.

### No `og:image`

The repo has only SVG logos, and most platforms do not render SVG as `og:image`. The page
ships `og:title`, `og:description`, `og:url` and `og:type`, and is `noindex`.

### JSON-LD carries only what the copy supports

`SoftwareApplication` has `name`, `description` (the subhead), `url` and an `Offer` at
`price: 0`. **Assumption:** `priceCurrency: USD`, because schema.org needs a currency next to a
price and the copy names none. `applicationCategory` and `operatingSystem` were dropped, along
with `og:site_name`: the copy doesn't state them, and the footer says this demo is not
affiliated with FX Replay.

## Analytics and experiments

### The inline `<head>` script: the single exception to "zero JS outside islands"

The A/B arm must be known before first paint. Otherwise the trust line pops in after
hydration, which is flicker and CLS. The page is prerendered, so the server cannot choose
per visitor. **Decision:** one blocking inline script, about 1.7 KB, with no network request.
It sets `<html data-variant>` (the sticky assignment) and `<html data-consent>` (so the banner
never flashes for a returning visitor), and CSS does the rest. It is not hand-written in the
layout. `src/experiments/boot.ts` exports `bootHead()`, which is unit-tested, and `BaseLayout`
inlines it with `Function#toString`. It must therefore stay self-contained (no imports, no
closures), and a test runs the exact serialised string on its own. Rejected: an
`astro:middleware` assignment (it would make the landing page on-demand, losing prerendered
LCP), and assigning in the island (flicker).

### Event names follow the brief and GA4, not past tense

`/add-event` asked for past-tense `object_action` names. The brief names the events
`page_view`, `sign_up`, `cta_click` and so on. `page_view` and `sign_up` are GA4 recommended
events, which GA4 reports natively. **Decision:** the brief's names. `/add-event` now prefers GA4's
recommended name and otherwise the catalogue's `object_action` style.

### `signup_form_start` ignores the automatic focus on open

The brief defines it as "first focus inside the modal". But the dialog focuses the email input
itself on open, so a literal first focus would equal `signup_modal_open`, and the funnel step
would carry no information. **Decision:** the first focus the **user** causes, any typing, or a
submit (Enter on the auto-focused input causes neither a focus nor an input event). The
island's own `focus()` calls are flagged around the synchronous `focusin` they dispatch. A
`focusin` with no `relatedTarget` on the element the island focused is the browser restoring
focus after a tab switch, so it does not count either. The guard is
`src/composables/useFormStart.ts`, unit-tested. It fires once per page view.

### `experiment_exposure` fires on page view, for both arms

The `/new-experiment` default says to fire when the arm is rendered in view, once per session.
The brief asks for once per page view, for both arms. The trust line sits under the hero CTA,
above the fold, so page load is when it is seen. **Decision:** the brief's rule, from the
analytics island's mount. Analysis deduplicates per `session_id` where it needs to.

### `session_id` is ours, and GA4 receives it as `fxr_session_id`

gtag has its own `session_id` field (`gtag('get', id, 'session_id')`). Sending a parameter of
that name risks colliding with GA4's sessionisation. **Decision:** `session_id` in the dataLayer
(the brief's name) and `fxr_session_id` in GA4. It is a per-tab uuid in `sessionStorage`. It is
not a cross-visit identifier.

### Pre-consent events are buffered in memory and replayed on Accept

`page_view` and `experiment_exposure` fire on load, before most visitors answer the banner.
Dropping them would make GA4's denominator undercount exactly the sessions the experiment
needs. **Decision:** keep this page view's events in memory (at most 100), send them only
after Accept, and discard them on Reject. Nothing leaves the browser before consent, and nothing
is written to storage for it.

### Consent banner: equal buttons, analytics only, no withdraw link yet

Accept and Reject have the same style, so neither choice is nudged. Accept grants
`analytics_storage` only; the three ads signals stay `denied`. The banner is a fixed region,
first in tab order after the skip link. `scroll-padding-bottom` keeps focused elements from
sitting under it (WCAG 2.4.11). It is 240px below 768px and 120px from 768px up. Those values
come from the banner heights QA measured (216px at 320, 192px at 375, 108px from 768) plus
headroom for text resizing. **Known gap:** no
link to change the choice later. That is required where GDPR applies, and listed under "With
more time".

### The experiment cookie is set before consent

The sticky `fxr_exp_trust-line-v1` cookie is written on first load, whatever the visitor
chooses. It holds only the arm (`control` | `variant`), no identifier, and is never sent to a
third party. Under a strict ePrivacy reading, A/B cookies are not strictly necessary.
**Accepted** for the challenge deployment. For a real EU launch: assign without storage until
consent, or treat the cookie as consent-gated.

### Referrer and URL are reduced before analytics

`referrer` is the origin only. A `utm_*` value is dropped unless it is a plain slug: at most 100
characters of `[A-Za-z0-9._-]`, with fewer than 7 digits. That rules out spaces (names,
queries), `@` (emails), `+` and long digit runs (phone numbers). `utm_term` can carry a
searcher's own words, so a campaign tagged with spaces loses its tag, and so does a numeric
id of 7+ digits (e.g. an Ads campaign id in `utm_campaign`): lost data, accepted over bad data.
A name written as one slug (`jane_doe`) cannot be told from a campaign slug. In the GA4
`config`, `page_location` keeps only the path and the cleaned `utm_*`, and `page_referrer` is
the origin. A query string can carry an email
(`?email=…` from a partner link), and nothing in the analytics path may.

## Stack

### Astro 7, not 6

The brief's context says FX Replay runs Astro 6; the current stable release is Astro 7
(Vite 8). Chose current stable. For this project, the v7 breaking changes only remove
`@astrojs/db` and some transition internals, and neither is used.

### better-sqlite3, not `node:sqlite`

`node:sqlite` on Node 26 LTS is Stability 1.2 (Release Candidate), not Stable. better-sqlite3
ships prebuilt binaries for the target platforms, so no native compile is needed. Access is
behind a repository module, so swapping to `node:sqlite` once it is stable is a two-module
change (`db.ts`, `users-repository.ts`).

### TypeScript pinned to 6.0

TypeScript 7 (the native port) is not yet supported by typescript-eslint (`<6.1`) or
`@astrojs/check` (`^5 || ^6`).

## Containerisation

### One replica, by design

SQLite has a single writer, and the database is one file on one named volume. The service runs
exactly once. Scaling out means moving to a networked database first.

### `legacy-peer-deps=true` in a project `.npmrc`

`eslint-plugin-jsx-a11y@6.10.2` declares `eslint` up to 9 as a peer, and the repository pins
eslint 10. Local installs only worked because a global npmrc set `legacy-peer-deps`; a clean
`npm ci` (the Docker build included) failed with `ERESOLVE`. The project `.npmrc` makes this
explicit. Remove it once jsx-a11y declares eslint 10 support.

### `npm ci --ignore-scripts` in the image

better-sqlite3 13 bundles `prebuilds/<platform>-<arch>.node`, and `lib/binding.js` loads it
directly. Because the package has a `binding.gyp`, npm would still run an implicit
`node-gyp rebuild`, which needs Python and a compiler that the slim image lacks. No other Linux
dependency has an install script (`hasInstallScript` in `package-lock.json`). The runtime stage
proves the binding loads, so if a future dependency needs a script, the build fails loudly.

### Ingress through the host's shared Caddy

The container joins the external `edge` network and publishes no port, the same pattern as the
other stacks on that host. Publishing a port was rejected because Docker bypasses the host
firewall.

## With more time

- **A "Cookie settings" link** in the footer to withdraw or change consent, which sends a
  Consent Mode `update` to `denied`.
- **Server-side event collection** (or GA4 Measurement Protocol for `sign_up`), so the
  conversion count does not depend on the visitor accepting cookies or blocking gtag.js.

- **`/api/health`** that opens the database and runs `select 1`. The healthcheck then targets
  it instead of `GET /`, which proves only that the server answers.
- **CI/CD**: on every push, run typecheck, lint, format check and tests, then
  `docker compose build`. On the main branch, push the image to a registry and deploy by
  pulling it, instead of building on the server.
- **Scheduled backups** of the SQLite volume (the online `backup()` command in the README),
  copied off the host.
- **A smaller image**: the runtime carries the whole production `node_modules`. Check which
  packages the standalone server actually imports and trim the rest.

- **Sessions or real auth for PATCH**, instead of the id-as-capability above, and per-admin
  credentials instead of one shared `ADMIN_API_TOKEN`.
- **Move the user id out of the PATCH URL** (for example a token in the body or a session), so
  access logs cannot capture it.
- **A 1200×630 PNG `og:image`** for link previews.
- **A shared rate-limit store** (or limiting at Caddy) if the service ever runs more than one
  replica; and a per-email limit, which the per-IP window does not provide.
