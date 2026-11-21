# Try FX Replay Free

A landing page and signup flow for FX Replay, built for the Growth Engineer challenge.
**Goal:** turn more marketing traffic into new accounts.

**Live:** https://fxr-challenge.yhndevside.com

## What's inside

- **Landing page.** Static HTML. The only JavaScript is the signup and consent components, plus
  one small inline script that assigns the A/B variant.
- **Signup.** Email in a modal dialog, then an optional "preferred market" step, backed by a
  small Users API with SQLite.
- **Analytics.** A typed event catalogue, GA4 that loads only after consent, and one A/B test
  (a "No credit card required" line).
- **AI workflow.** Claude Code rules, four agents, two commands and hooks, all committed in
  [`CLAUDE.md`](CLAUDE.md), [`.claude/`](.claude/) and [`.mcp.json`](.mcp.json).

## Stack

**Why Astro:** a small project, and the page is mostly content. Astro is made for content
sites. It ships static HTML with no JavaScript by default, which keeps the page fast, and the
API can live in the same project.

| Piece       | Choice                            | Why                                                           |
| ----------- | --------------------------------- | ------------------------------------------------------------- |
| Framework   | Astro 7, static output            | Fast prerendered HTML; the current stable version             |
| Interactive | Vue 3, only where needed          | Only the signup and consent components need JavaScript        |
| API         | Astro server endpoints on Node    | One project, one deployable, no separate backend              |
| Database    | SQLite (better-sqlite3)           | Real constraints, such as unique emails, with almost no setup |
| Validation  | zod, shared by browser and API    | Both sides always agree on what is valid                      |
| Language    | TypeScript, strict                | Catches mistakes before they run                              |
| Hosting     | One Docker container behind Caddy | The same image runs locally and in production                 |

The reasoning behind each choice is in [DECISIONS](docs/DECISIONS.md#stack).

## Documentation

| Topic                    | File                                         |
| ------------------------ | -------------------------------------------- |
| Architecture             | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| Analytics plan           | [docs/ANALYTICS.md](docs/ANALYTICS.md)       |
| Experiment proposal      | [docs/EXPERIMENT.md](docs/EXPERIMENT.md)     |
| AI-native workflow       | [docs/AI_WORKFLOW.md](docs/AI_WORKFLOW.md)   |
| Performance review       | [docs/PERFORMANCE.md](docs/PERFORMANCE.md)   |
| Decisions and trade-offs | [docs/DECISIONS.md](docs/DECISIONS.md)       |
| Session log with AI      | [AI_LOG.md](AI_LOG.md)                       |

## Run locally

No configuration is needed: every variable has a default. Pick one of these.

### Option A: Docker (recommended)

You only need Docker. This runs the same production image that is deployed.

```sh
docker compose up -d --build   # first build takes a minute or two
docker compose ps              # wait until the status shows "healthy"
```

Open http://localhost:4321. To stop it:

```sh
docker compose down            # the signups are kept; `down -v` also deletes them
```

The port is bound to `127.0.0.1` only. The database lives in a Docker volume, so it survives
restarts and rebuilds.

### Option B: Node (for development)

You need Node **26** (version in `.nvmrc`) and npm.

```sh
nvm use                        # or: nvm install
npm ci
npm run dev                    # http://localhost:4321, reloads on save
```

The database file is created at `./data/app.db` the first time someone signs up. That folder
is git-ignored.

### Optional settings

| Variable          | Default         | What it does                                                        |
| ----------------- | --------------- | ------------------------------------------------------------------- |
| `ADMIN_API_TOKEN` | unset           | Token for listing signups (`GET /api/users`); unset disables it     |
| `PUBLIC_GA4_ID`   | unset           | GA4 measurement id, set at build time; unset means GA4 never loads  |
| `DATABASE_PATH`   | `./data/app.db` | Where the SQLite file lives (Docker fixes it at `/app/data/app.db`) |
| `TRUST_PROXY`     | unset           | `1` behind a proxy, so the rate limit sees the real IP (production) |

- **With Docker:** `cp .env.example .env` and fill in the values. Compose reads `.env`.
  Rebuild after changing `PUBLIC_GA4_ID`.
- **With Node:** set them in the shell, for example `ADMIN_API_TOKEN=secret npm run dev`.

To list signups once a token is set:

```sh
curl -H "Authorization: Bearer <your token>" http://localhost:4321/api/users
```

## Checks

These need the Node setup (Option B).

```sh
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build && npm start     # production build on http://localhost:4321
```

## Deploy

The same Docker image runs in production, behind the server's shared Caddy. Run **one replica
only**, because SQLite has a single writer.

<details>
<summary>Deploy to the server (run by hand)</summary>

The server already runs a shared Caddy on the external `edge` network. `compose.prod.yaml`
removes the local port and joins `edge` instead. It needs Docker Compose 2.24 or later.

1. Point an `A` record for `fxr-challenge.yhndevside.com` at the host.
2. On the host, in a checkout at `/srv/apps/fxr-challenge`:

   ```sh
   # Replace the GA4 placeholder. It is baked in at build time, so rebuild after changing it.
   printf 'COMPOSE_FILE=compose.yaml:compose.prod.yaml\nPUBLIC_GA4_ID=G-XXXXXXXXXX\nADMIN_API_TOKEN=%s\n' "$(openssl rand -hex 32)" > .env
   chmod 600 .env
   docker compose config | grep -c published   # must print 0
   docker compose up -d --build
   docker compose ps                            # wait for "healthy"
   ```

3. Copy `docker/prod/caddy/fxr-challenge.yhndevside.com.caddy` into the platform's
   `caddy/sites/`, then reload Caddy.

To update: pull the new commit, then run `docker compose up -d --build`.

</details>

<details>
<summary>Back up the database</summary>

```sh
docker compose exec fxr-web node -e "new (require('better-sqlite3'))(process.env.DATABASE_PATH).backup('/app/data/backup.db')"
docker compose cp fxr-web:/app/data/backup.db ./app-$(date +%F).db
docker compose exec fxr-web rm /app/data/backup.db
```

</details>
