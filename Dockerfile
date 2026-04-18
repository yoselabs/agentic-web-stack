# syntax=docker/dockerfile:1-labs
#
# Single Dockerfile, five stages, reused across 3 services (migrate, server,
# web) via YAML anchors in docker-compose.yml.
#
# Runtime is bun-only; node is used at build time for vite and pnpm.
# See docs/superpowers/specs/2026-04-18-demo-mode-design.md for the full
# design rationale.

# --- Base: node + pnpm + bun (build-time toolchain) ---
# bun is needed here because packages/db/package.json's postinstall runs
# `bun run scripts/generate.ts` (hash-gated prisma generate). Without bun on
# PATH, `pnpm install` fails during the deps stages.
FROM node:24-slim AS base

# openssl: required by prisma (auto-detects libssl)
# hadolint ignore=DL3008
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable \
    && corepack prepare pnpm@10.32.1 --activate

# Copy bun binary from the official image — avoids curl-install churn.
COPY --from=oven/bun:1-slim /usr/local/bin/bun /usr/local/bin/bun

WORKDIR /app

# --- Dependencies (full, incl. dev) — used by the build stage ---
FROM base AS deps
COPY pnpm-lock.yaml package.json pnpm-workspace.yaml ./
# COPY --parents preserves directory structure with glob patterns, so new
# packages don't require Dockerfile edits.
COPY --parents apps/*/package.json packages/*/package.json e2e/package.json ./
# Prisma schema + config + hash-gated generate script are read by packages/db
# postinstall. Copy them in before install so postinstall can run.
COPY --parents packages/db/prisma packages/db/prisma.config.ts packages/db/scripts ./
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# --- Production dependencies (parallel to deps) ---
# Installed against pnpm-workspace.prod.yaml so e2e/ is excluded. This is the
# node_modules tree that ships to runtime.
FROM base AS prod-deps
COPY pnpm-lock.yaml package.json ./
COPY pnpm-workspace.prod.yaml pnpm-workspace.yaml
COPY --parents apps/*/package.json packages/*/package.json ./
COPY --parents packages/db/prisma packages/db/prisma.config.ts packages/db/scripts ./
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --prod

# --- Build: prisma generate + vite build ---
FROM deps AS build
COPY . .
# `COPY . .` brought in the full workspace file (with e2e); restore the prod
# one so build-time workspace resolution matches what will ship.
COPY pnpm-workspace.prod.yaml pnpm-workspace.yaml
# VITE_API_URL must be set at build time — vite bakes import.meta.env.VITE_*
# into the JS bundle at build. This is the BROWSER's URL, not a container DNS
# name. @project/env/client validates it's a URL, so build fails fast if
# missing.
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
# Narrow build: only @project/web produces an artifact we ship
# (apps/web/.output). Skip apps/server's tsc (bun runs TS directly).
# packages/db generate was already triggered by postinstall during deps.
# The hash gate in scripts/generate.ts makes this a no-op; kept as a safety
# net in case a future edit drops the postinstall hook.
RUN pnpm --filter @project/db generate \
    && pnpm --filter @project/web build

# --- Runtime: bun-only ---
FROM oven/bun:1-slim AS runtime
WORKDIR /app

# Universal healthcheck: every service in this image exposes /health.
# - apps/server: Hono route (apps/server/src/index.ts)
# - apps/web:    TanStack Start server-only route (apps/web/src/routes/health.ts)
# - migrate (one-shot sidecar): overrides via `healthcheck: { disable: true }`
#
# Compose services set PORT only; shell-form CMD expands it at container runtime.
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
            --start-period=30s --start-interval=1s \
            CMD bun /app/scripts/healthcheck.ts "http://127.0.0.1:${PORT}/health"

# Start from the prod-only workspace (correct symlink tree, minimal deps).
COPY --from=prod-deps /app ./

# Overlay build outputs + source that the runtime needs.
COPY --from=build /app/apps/web/.output ./apps/web/.output
COPY --from=build /app/apps/server/src ./apps/server/src
# Shared packages ship their TypeScript source (exports point to src/*.ts).
# The `./` marker tells --parents where path preservation starts.
COPY --from=build --parents /app/./packages/*/src ./
COPY --from=build /app/packages/db/prisma ./packages/db/prisma
# scripts/ holds seed.ts + seed-credentials.ts (invoked by the migrate
# sidecar). Whole directory ships for simplicity; the handful of dev-only
# scripts (generate-routes.ts, test-db.ts, etc.) is trivially small.
COPY --from=build /app/scripts ./scripts

# Non-root user (Debian base — useradd/groupadd, not BusyBox addgroup/adduser)
RUN groupadd --system app && useradd --system --gid app app
USER app
