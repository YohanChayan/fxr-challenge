# Architecture overview

## Overall application structure

### Code layout

```
src/
  pages/index.astro         the landing page, prerendered
  pages/api/users/          the Users API endpoints (on demand), thin wrappers over the handlers
  components/*.astro        page sections, zero client JS
  components/signup/        the signup island: SignupIsland.vue (CTA + <dialog>), EmailForm.vue,
                            MarketPicker.vue, markets.ts (labels)
  components/analytics/     AnalyticsIsland.vue: consent banner, page_view, experiment_exposure
  analytics/                taxonomy.ts (event catalogue), track.ts, consent.ts, page-view.ts
  experiments/              flags.ts (registry), boot.ts (the inline <head> script)
  composables/useSignup.ts  the signup state machine; no DOM access
  lib/api/users.ts          browser fetch client: createUser, updatePreferredMarket
  lib/schemas/user.ts       zod contracts and their inferred types, shared by client and server
  lib/server/               server-only: db, http helpers, rate limit, handlers, repository
  types/                    hand-written contract types, type-only: signup.ts and
                            analytics-globals.d.ts (browser);
                            users.ts, http.ts, rate-limit.ts (server)
```

Request and response types are inferred from the zod schemas and live only in
`lib/schemas/user.ts`; `types/` holds the types zod cannot infer (state unions, result unions,
dependency shapes). Module-private types (the SQL row shapes, the cursor, the rate-limit window)
stay inside their modules. The island imports `types/signup.ts` and the schemas, never a server
module or a server type file.

## Major technical decisions

## Important trade-offs

## API / integration approach

The signup island and the API share **one origin and one contract**. The Users API is a set of
Astro server endpoints (`src/pages/api/users/`, `prerender = false`) in the same deployable as the
landing page, so there is no CORS. Request and response shapes are zod schemas in
`src/lib/schemas/user.ts`. The island and the endpoints import the same file, so client and
server validation cannot drift apart.

### Contract

| Method and path        | Body / query                                     | Success                     | Errors                       |
| ---------------------- | ------------------------------------------------ | --------------------------- | ---------------------------- |
| `POST /api/users`      | `{ email }`; optional `Idempotency-Key` header   | `201 { user }`              | 400, 409, 413, 422, 429, 500 |
| `PATCH /api/users/:id` | `{ preferredMarket }` (required, the only field) | `200 { user }`              | 400, 404, 413, 422, 500      |
| `GET /api/users`       | `?limit=1..100` (default 20) `&cursor=`          | `200 { users, nextCursor }` | 401, 422, 500                |

- **User:** `{ id, email, preferredMarket, createdAt, updatedAt }`. `id` is a random uuid.
  `preferredMarket` is `forex | crypto | stocks | indices | futures`, or `null` until it is set.
  Timestamps are ISO 8601.
- **Signup is email only.** The success screen then asks for the market and sends `PATCH`.
- **Idempotency.** A `POST` with an `Idempotency-Key` seen in the last 24 h and the same email
  returns the original `201` body again, with `Idempotent-Replayed: true`, and creates nothing.
  The same key with a different email is `422 idempotency_key_reused`.
- **Rate limit.** `POST` allows 5 requests per 60 s per client IP; the sixth gets `429` with
  `Retry-After` in seconds.
- **The list** is newest first, with keyset pagination on `(created_at, id)`. `nextCursor` is
  opaque and is `null` on the last page. The list requires `Authorization: Bearer
<ADMIN_API_TOKEN>`; without a valid token, or if the token is unset, it returns 401.

### One error envelope

Every error returns `{ error: { code, message, fields? } }`. The client branches on `code`, a
closed union exported from the schema module, never on the status text:

| `code`                   | Status | When                                                                                                                                         |
| ------------------------ | ------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `bad_request`            | 400    | Body is empty or not JSON                                                                                                                    |
| `unauthorized`           | 401    | List without a valid admin token (also sends `WWW-Authenticate: Bearer`)                                                                     |
| `not_found`              | 404    | Unknown id, or one that is not a uuid                                                                                                        |
| `email_taken`            | 409    | Email already registered; `fields.email` is set so the form can show it inline                                                               |
| `payload_too_large`      | 413    | Body over 16 KiB                                                                                                                             |
| `validation_error`       | 422    | Valid JSON that fails the schema, unknown keys, bad `limit` or cursor, malformed `Idempotency-Key`; `fields` per field (none for the header) |
| `idempotency_key_reused` | 422    | `Idempotency-Key` already used with a different email                                                                                        |
| `rate_limited`           | 429    | More than 5 `POST`s in 60 s from one IP; `Retry-After` header                                                                                |
| `internal`               | 500    | Anything unexpected: a generic message for the client, details in the server log only                                                        |

### Validation, failures and async behaviour

- **Normalise, then enforce.** The schema trims and lowercases the email. A `UNIQUE` index on
  `users.email` enforces uniqueness. The insert itself is the uniqueness check, with no SELECT
  beforehand, so two concurrent signups with the same email cannot both succeed. The repository
  maps the constraint error to `email_taken`, so the handler returns 409, never 500.
- **Expected failures are values, not exceptions.** `users-repository.ts`, the only module that
  contains SQL, returns `email_taken`, `idempotency_key_reused`, `not_found` and
  `invalid_cursor` as typed results. The handlers (`users-handlers.ts`) stay thin. `POST` runs
  rate limit, then body, then schema, then the `Idempotency-Key` header, then the repository.
  Each handler wraps the repository call in one `try/catch` that turns anything unexpected into
  `internal`. That includes opening the database for the first time.
- **Create is one transaction.** The idempotency lookup, the user insert and the key write
  commit together (`IMMEDIATE`), so a stored key always points at a user that exists.
- **Rate limiting is in memory** (`rate-limit.ts`): per process, so it resets on restart and
  assumes the single replica. The client IP is `clientAddress` (the socket peer). With
  `TRUST_PROXY=1`, set in `compose.prod.yaml`, it is the right-most `X-Forwarded-For` entry,
  the one the shared Caddy sets.
- **Bodies are read defensively.** The body is read as a stream and counted, so an oversized
  body gets 413 even when it is sent chunked. An empty or malformed body gets 400. The node
  adapter's `bodySizeLimit` is set to 16 KiB as a second guard.
- **Responses are never cached:** every API response sends `Cache-Control: no-store`.
- **SQLite** runs in WAL mode with a 5 s busy timeout. `db.ts` migrates the file on open,
  keyed on `PRAGMA user_version`: v1 is the original `users` table, and v2 adds
  `preferred_market`, drops `name` and `experience_level`, and creates `idempotency_keys`. Each
  step runs in its own transaction, so an existing `data/app.db` upgrades without a reset. The
  file is at `DATABASE_PATH` (default `./data/app.db`).

### The analytics island and the inline head script

`src/components/analytics/AnalyticsIsland.vue` is mounted once in `BaseLayout` with
`client:load`. On mount it fires `page_view` and `experiment_exposure`, and it starts GA4 when
the visitor accepted earlier. It also renders the consent banner. One inline `<head>` script,
`src/experiments/boot.ts` serialised by `BaseLayout`, runs before first paint. It sets
`<html data-variant>`, the sticky A/B assignment, and `<html data-consent>`. It is the only JS
outside an island (DECISIONS).

### The signup island

`src/components/signup/SignupIsland.vue`, mounted in the hero's `.cta-group` with
`client:visible`. It renders the "Try FX Replay free" CTA as a `<button aria-haspopup="dialog">`
and a native `<dialog>` that the CTA opens with `showModal()`. The platform provides focus
containment, Esc and an inert page behind the dialog. The island adds the rest:

- The dialog is named by its `h2`, "Create your free account", and has a visible Close button.
  Esc, Close and a click on the backdrop close it, and focus returns to the CTA.
- On open, focus goes to the email input, or to the success heading after a signup.
- While a `POST` or `PATCH` is in flight, closing is blocked: the `cancel` event is cancelled
  and Close is `aria-disabled` (see the Esc limit in DECISIONS).
- The page does not scroll while the dialog is open (`html:has(.signup-dialog[open])`).
- The open animation runs only under `prefers-reduced-motion: no-preference`.

Inside the dialog, `EmailForm.vue` and `MarketPicker.vue` are presentational. The state lives
in `src/composables/useSignup.ts`, and the requests are made by `src/lib/api/users.ts`, which
parses every response with the shared `UserResponseSchema` and `ErrorResponseSchema`. It returns
typed results and never throws.

The state is one discriminated union: `idle`; `invalid` (inline error tied with
`aria-describedby` and `role="alert"`; 409 and 422 field errors land here); `submitting` (button
`aria-disabled`, input readonly, form `aria-busy`); `error` (network, 429 with the wait, 5xx; a Retry
button that reuses the Idempotency-Key and moves focus to the email input before resubmitting); and `success`. On success the form is replaced by a
focused heading and a market `fieldset` whose Save sends the `PATCH`. Save is `aria-disabled`,
not `disabled`, while saving, so focus is not lost. One persistent `aria-live` region inside the
dialog announces both steps. A success is final: closing and reopening the dialog shows the
success state, never a second signup. The user id is kept in component state only.

Analytics events fire from the island (`cta_click`, `signup_modal_open`, `signup_form_start`,
`signup_modal_close`) and from `useSignup.ts`, where each request's outcome is known. That
includes `sign_up`, which fires only on a 201. There is no server-side event. The catalogue and
the GA4 consent flow are in `docs/ANALYTICS.md`. The trade-offs behind
these choices are in `docs/DECISIONS.md`: `PATCH` is authorised only by knowing the uuid, the
409 lets anyone check whether an email is registered (the rate limit slows that down), and the
list needs a token.

## Deployment architecture

One container runs everything: the prerendered pages and the on-demand API endpoints, both
served by `@astrojs/node` in standalone mode (`node ./dist/server/entry.mjs`, port 4321).

```
browser ──HTTPS──► Caddy (shared, on the host) ──edge network──► fxr-challenge-web:4321
                                                                     │
                                                                     └── /app/data/app.db
                                                                         (named volume fxr-challenge_data)
```

- **Image** (`Dockerfile`): multi-stage. `deps` (`npm ci`), then `build` (`astro build`), then
  `prod-deps` (`npm ci --omit=dev`), then `runtime` on `node:26.13.1-slim`. The runtime runs as
  the non-root `node` user, with `NODE_ENV=production`. The build fails if the better-sqlite3
  binding does not load in the runtime image.
- **Compose** (`compose.yaml`): one service, `fxr-web` (container `fxr-challenge-web`), with
  `restart: unless-stopped`, `init: true`, a 256 MB memory limit and a healthcheck (`GET /`
  through node's `fetch`, because the slim image has no curl). On its own it is the local run,
  publishing `127.0.0.1:4321`. In production, `compose.prod.yaml` removes the port and joins the
  external `edge` network.
- **Exactly one replica.** SQLite has a single writer, and the database is one file on one
  volume.
- **Configuration** comes from the environment at `up` time, never from the image:
  `DATABASE_PATH` (set in `compose.yaml`), `TRUST_PROXY=1` (set in `compose.prod.yaml`, because
  Caddy is in front), and the optional `ADMIN_API_TOKEN` (from a git-ignored `.env`).

## Infrastructure considerations

### Hosting

The challenge deployment is `https://fxr-challenge.yhndevside.com`, on a single VPS that
already runs other Docker Compose stacks behind one shared Caddy. That Caddy terminates TLS and
reverse-proxies to `fxr-challenge-web:4321` over the external `edge` network. Its site file is
`docker/prod/caddy/fxr-challenge.yhndevside.com.caddy`. The container publishes no host port,
because Docker bypasses the host firewall. Deploys are manual: the steps are in the README,
under "Deploy to the server".

### Deployment
Manual and reproducible. On the host: a git checkout at `/srv/apps/fxr-challenge`, then
`docker compose build && docker compose up -d` with `COMPOSE_FILE=compose.yaml:compose.prod.yaml`
set in the server's `.env`. The image is built on the host from the multi-stage Dockerfile.
`PUBLIC_GA4_ID` is passed as a build arg, because it is public and inlined into the page.
`ADMIN_API_TOKEN` is injected at `up` time and is never part of the image.
Compose waits for the healthcheck to report `healthy`.
**Next:** build the image in CI, push it to a registry, and deploy by digest, so the host never compiles.

### CI/CD
None today. Quality gates run locally and through Claude Code hooks (lint on edit, typecheck on stop).
**Next:** GitHub Actions on every PR (typecheck, lint, test, `astro build`, and Lighthouse CI with a
budget); on `main`, build and push the image, then deploy over SSH with a one-command rollback to the
previous digest.

### DNS
An `A` record points `fxr-challenge.yhndevside.com` straight at the VPS (DigitalOcean nameservers,
no CDN proxy). There is no AAAA record.
**Next:** Cloudflare DNS with proxying, for edge caching, DDoS protection and hiding the origin IP.

### CDN / edge
No CDN. The shared Caddy is the edge: automatic Let's Encrypt TLS, HTTP/2, HTTP/3 advertised,
zstd/gzip compression, and HTTP → HTTPS (308).
**Next:** a CDN in front. The landing is static, so almost every request could be served from the
edge, and only `/api/*` would reach the origin.

### Caching
| Resource | Cache-Control | Why |
|---|---|---|
| HTML (`/`) | `public, max-age=0` + ETag | Always revalidated, so a deploy or experiment change is visible at once |
| `/_astro/*` (JS, CSS, fonts, images) | `public, max-age=31536000, immutable` | Content-hashed filenames |
| `/api/*` | `no-store` | User data, never cached |

With a CDN, the HTML would get a short edge TTL (`s-maxage=60`) and be purged on deploy. The
experiment is assigned client-side, so a cached HTML page is the same for both arms.

### Observability
Today: Docker's healthcheck (`GET /` every 30s) and container logs (the `local` driver, rotated at
10 MB × 3). There are no application logs containing user data (see DECISIONS).
**Next:**
- An external uptime check with alerting.
- A DB-aware `/api/health`, since the current check doesn't touch SQLite.
- Sentry for client and server errors.
- **A conversion alert:** daily `sign_up` count vs. the trailing baseline, and GA4 `sign_up` vs.
  rows in the database. A silent tracking break looks exactly like a conversion drop.

### Security
- Host: default-deny firewall (22/80/443 only), key-only SSH with root login disabled, fail2ban,
  unattended upgrades.
- The container runs as non-root and publishes no host port. Caddy reaches it over a private
  Docker network, because Docker bypasses the host firewall.
- Secrets live in a `chmod 600` `.env`, excluded from the image and from git.
- App: strict zod validation with unknown fields rejected, a 16 KiB body cap, an in-memory rate
  limit on signup, the signup list behind a bearer token, and no PII in analytics.
- Headers: HSTS, nosniff, Referrer-Policy, X-Frame-Options and Permissions-Policy, set in Caddy.
**Next:** a CSP (the inline experiment script needs a hash), and Turnstile/honeypot on signup.

### Reliability
- One replica by design: SQLite has a single writer.
- `restart: unless-stopped` brings the container back after a crash or a reboot. The host has 24 GB
  of free disk, and the app uses ~31 MiB of its 256 MiB limit.
- **Known gaps:** there are no backups of the SQLite volume, and an `unhealthy` container is flagged
  but not restarted.
**Next:** a nightly SQLite `.backup()` copied off-host, and on the FX Replay scale, Postgres with
point-in-time recovery plus at least two app instances behind the load balancer.

## What I would change for a production FX Replay system
