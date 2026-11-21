# syntax=docker/dockerfile:1
#
# Try FX Replay Free: one image for the Astro static pages + the Node API.
#
#   deps      → every dependency, needed to build
#   build     → `astro build` into dist/
#   prod-deps → production dependencies only (better-sqlite3 bundles prebuilt
#               binaries, so no compiler is needed)
#   runtime   → node:slim, non-root, dist/ + prod node_modules
#
# No secret is passed as ARG or ENV here: runtime secrets (ADMIN_API_TOKEN)
# come from compose.yaml at `up` time and never enter an image layer.

ARG NODE_VERSION=26.13.1

FROM node:${NODE_VERSION}-slim AS deps
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
# --ignore-scripts: better-sqlite3 has a binding.gyp, so npm would run an implicit
# `node-gyp rebuild` (needs Python + a compiler, absent from slim). It loads its
# bundled prebuilds/<platform>-<arch>.node instead, and no other Linux dependency
# has an install script (package-lock.json). The runtime stage proves it loads.
RUN npm ci --ignore-scripts

FROM deps AS build
COPY . .
RUN npm run build

FROM node:${NODE_VERSION}-slim AS prod-deps
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

FROM node:${NODE_VERSION}-slim AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4321 \
    DATABASE_PATH=/app/data/app.db
WORKDIR /app

# The `node` user (uid 1000) ships with the official image. /app/data is created
# here and owned by it, so a fresh named volume mounted there inherits that owner.
RUN mkdir -p /app/data && chown node:node /app/data

COPY --chown=node:node package.json ./
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist

USER node

# Fail the build if the native SQLite binding cannot load on this base image.
RUN node -e "new (require('better-sqlite3'))(':memory:').prepare('select 1').get()"

EXPOSE 4321
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+process.env.PORT+'/').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]

CMD ["node", "./dist/server/entry.mjs"]
