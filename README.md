# Try FX Replay Free

A marketing landing page and signup flow for FX Replay, built for the Growth Engineer
technical challenge. Goal: increase conversion from marketing traffic to account creation.

> Status: repository and Claude Code system set up; features not built yet.

## Local setup

Requirements: Node **26 LTS** (pinned in `.nvmrc`) and npm.

```sh
nvm use            # or: nvm install
npm ci
npm run dev        # http://localhost:4321
```

Production build:

```sh
npm run build
npm start          # runs the standalone Node server from dist/
```

## Run with Docker

One image (`Dockerfile`, Node 26 slim, non-root) and one Compose service. On its own,
`compose.yaml` is the local run: it publishes `127.0.0.1:4321`. Production adds
`compose.prod.yaml` (see below).

```sh
docker compose build
docker compose up -d               # healthy in ~10s: docker compose ps
docker compose logs -f fxr-web
docker compose down                # the data volume is kept; `down -v` deletes it
```

Then open http://localhost:4321.

**Data.** SQLite lives at `/app/data/app.db` inside the container (`DATABASE_PATH`), on the
named volume `fxr-challenge_data`. It survives `down`/`up` and image rebuilds. Back it up online,
with no downtime, using SQLite's backup API, then copy the result out:

```sh
docker compose exec fxr-web node -e "new (require('better-sqlite3'))(process.env.DATABASE_PATH).backup('/app/data/backup.db')"
docker compose cp fxr-web:/app/data/backup.db ./app-$(date +%F).db
docker compose exec fxr-web rm /app/data/backup.db
```

**Admin token.** `ADMIN_API_TOKEN` is optional. Put `ADMIN_API_TOKEN=<long random string>`
in a git-ignored `.env` next to `compose.yaml` (`chmod 600 .env`). Leave it unset or empty and
`GET /api/users` answers 401, so listing is disabled.

**One replica only.** SQLite has a single writer, and the file lives on one volume. Do not scale
the service.

### Deploy to the server (run by hand)

The target is a host with the shared Caddy on the external `edge` network. `compose.prod.yaml`
removes the published port and joins `edge` instead. It uses `!reset`, which needs Docker Compose
2.24 or later. The commands are for you to run:

1. DNS: an `A` record for `fxr-challenge.yhndevside.com` pointing at the host. Do this first,
   so Caddy's first certificate request succeeds.
2. On the host, in a checkout of this repository at `/srv/apps/fxr-challenge`:

   ```sh
   # COMPOSE_FILE makes every plain `docker compose …` below use the production overlay
   printf 'COMPOSE_FILE=compose.yaml:compose.prod.yaml\nADMIN_API_TOKEN=%s\n' "$(openssl rand -hex 32)" > .env
   chmod 600 .env
   docker compose config | grep -c published   # must print 0: no port published
   docker compose build
   docker compose up -d
   docker compose ps                     # wait for "healthy"
   ```

3. Copy `docker/prod/caddy/fxr-challenge.yhndevside.com.caddy` into the platform's
   `caddy/sites/`, then reload Caddy.

To update, bring the checkout to the new commit, then run `docker compose build && docker compose up -d`.

### Scripts

| Script                 | What it does                               |
| ---------------------- | ------------------------------------------ |
| `npm run dev`          | Astro dev server                           |
| `npm run build`        | Production build (static pages + Node API) |
| `npm start`            | Serve the production build                 |
| `npm run typecheck`    | `astro check` + `vue-tsc`                  |
| `npm run lint`         | ESLint (TypeScript, Astro, Vue, a11y)      |
| `npm run format:check` | Prettier check                             |
| `npm test`             | Vitest                                     |

## Documentation

| Deliverable                     | File                                                      |
| ------------------------------- | --------------------------------------------------------- |
| Architecture overview           | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)              |
| Analytics plan                  | [docs/ANALYTICS.md](docs/ANALYTICS.md)                    |
| Experiment proposal             | [docs/EXPERIMENT.md](docs/EXPERIMENT.md)                  |
| AI-native workflow              | [docs/AI_WORKFLOW.md](docs/AI_WORKFLOW.md)                |
| Performance review              | [docs/PERFORMANCE.md](docs/PERFORMANCE.md)                |
| Assumptions and trade-offs      | [docs/DECISIONS.md](docs/DECISIONS.md)                    |
| Session log of AI collaboration | [AI_LOG.md](AI_LOG.md)                                    |
| Claude Code project rules       | [CLAUDE.md](CLAUDE.md), [.claude/](.claude/), `.mcp.json` |
