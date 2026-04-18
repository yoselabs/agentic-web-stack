# a2sdlc-demo3 Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a deployable fork of the agentic-web-stack template at `iorlas/a2sdlc-demo3` with Docker, CI/CD, and Dokploy deployment to shen.

**Architecture:** Single Docker image (multi-stage pnpm monorepo build), two runtime containers (web + server) behind Traefik on Tailscale. CI pushes to GHCR, then dokploy-ctl deploys to Dokploy.

**Tech Stack:** Docker, GitHub Actions, GHCR, dokploy-ctl, Traefik, Tailscale, Prisma Migrate

## Working Directory

**This plan is executed in a new repo checkout, NOT in the `agentic-web-stack` template.**

- **Template repo (read-only for this work):** `/Users/iorlas/Workspaces/agentic-web-stack/` — holds the spec/plan, untouched during execution
- **Target repo (all work happens here):** `/Users/iorlas/Workspaces/a2sdlc-demo3/` — cloned in Task 1, all commits go here on the `baseline` branch

Tasks 2–9 assume `pwd` is `/Users/iorlas/Workspaces/a2sdlc-demo3/`. Task 1 creates this directory by cloning.

---

## File Map

All file paths below are relative to `/Users/iorlas/Workspaces/a2sdlc-demo3/`.

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `Dockerfile` | Multi-stage build: deps → build → runtime |
| Create | `docker-compose.prod.yml` | Production stack: db, migrate, web, server |
| Create | `.github/workflows/deploy.yml` | Build image, push to GHCR, deploy via dokploy-ctl |
| Create | `.dockerignore` | Exclude node_modules, .git, etc. from build context |
| Create | `pnpm-workspace.prod.yaml` | Workspace config without e2e (avoids installing test deps in Docker) |
| Modify | `packages/auth/src/index.ts` | Add cookie domain config for cross-subdomain auth |
| Modify | `packages/env/src/server.ts` | Add optional `AUTH_COOKIE_DOMAIN` env var |
| Modify | `packages/db/package.json` | Move `prisma` CLI to dependencies so it survives `pnpm prune --prod` |

---

### Task 1: Create GitHub Repo, Seed Baseline, Clone Locally

**Files:** None (repo operations only)

- [ ] **Step 1: Create the GitHub repo**

Run from `/Users/iorlas/Workspaces/agentic-web-stack/`:

```bash
gh repo create iorlas/a2sdlc-demo3 --private --description "a2sdlc demo project — agentic-web-stack deployment"
```

- [ ] **Step 2: Push current template state to the new repo's baseline branch**

Still from the template repo:

```bash
git push git@github.com:iorlas/a2sdlc-demo3.git main:baseline
```

No remote is added — this is a one-shot seed. Future syncs from the template are done by re-running this same command.

- [ ] **Step 3: Also create main from the same snapshot**

```bash
git push git@github.com:iorlas/a2sdlc-demo3.git main:main
```

- [ ] **Step 4: Clone the new repo to its own workspace**

```bash
cd /Users/iorlas/Workspaces
git clone git@github.com:iorlas/a2sdlc-demo3.git
cd a2sdlc-demo3
git checkout baseline
```

From this point on, all commands in subsequent tasks run from `/Users/iorlas/Workspaces/a2sdlc-demo3/` on the `baseline` branch.

- [ ] **Step 5: Verify state**

```bash
git branch -a
git log --oneline -3
```

Expected: on `baseline` branch, with recent agentic-web-stack commits visible.

---

### Task 2: Add .dockerignore

**Files:**
- Create: `.dockerignore`

- [ ] **Step 1: Create .dockerignore**

```dockerignore
node_modules
.git
.gitignore
*.md
.env
.env.*
.output
dist
.vinxi
.tanstack
docs
*.tsbuildinfo
.DS_Store
.idea
.vscode
```

- [ ] **Step 2: Create pnpm-workspace.prod.yaml**

This excludes `e2e` so Docker doesn't install playwright and other test dependencies.

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

- [ ] **Step 3: Commit**

```bash
git add .dockerignore pnpm-workspace.prod.yaml
git commit -m "chore: add .dockerignore and prod workspace config"
```

---

### Task 3: Add AUTH_COOKIE_DOMAIN to Env Validation

**Files:**
- Modify: `packages/env/src/server.ts`

- [ ] **Step 1: Add AUTH_COOKIE_DOMAIN to the env schema**

In `packages/env/src/server.ts`, add the new optional env var. Preserve all existing fields (DATABASE_URL, CORS_ORIGIN, BETTER_AUTH_SECRET, BETTER_AUTH_URL, NODE_ENV, PORT, LOG_LEVEL):

```typescript
import { DEV_API_PORT, DEV_WEB_PORT } from "@project/config/ports";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    DATABASE_URL: z.string().url(),
    CORS_ORIGIN: z.string().url().default(`http://localhost:${DEV_WEB_PORT}`),
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z
      .string()
      .url()
      .default(`http://localhost:${DEV_API_PORT}`),
    AUTH_COOKIE_DOMAIN: z.string().optional(),
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),
    PORT: z.coerce.number().default(DEV_API_PORT),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace"])
      .optional(),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
```

- [ ] **Step 2: Run typecheck to verify**

```bash
make lint
```

Expected: PASS (no type errors)

- [ ] **Step 3: Commit**

```bash
git add packages/env/src/server.ts
git commit -m "feat: add optional AUTH_COOKIE_DOMAIN env var"
```

---

### Task 4: Configure Better Auth Cookie Domain

**Files:**
- Modify: `packages/auth/src/index.ts`

- [ ] **Step 1: Update Better Auth config to use cookie domain**

Replace the full contents of `packages/auth/src/index.ts`:

```typescript
import { MIN_PASSWORD_LENGTH } from "@project/config/limits";
import { db } from "@project/db";
import { env } from "@project/env/server";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";

export const auth = betterAuth({
  database: prismaAdapter(db, {
    provider: "postgresql",
  }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: MIN_PASSWORD_LENGTH,
  },
  trustedOrigins: [env.CORS_ORIGIN],
  advanced: env.AUTH_COOKIE_DOMAIN
    ? {
        defaultCookieAttributes: {
          domain: env.AUTH_COOKIE_DOMAIN,
          path: "/",
          sameSite: "lax",
        },
      }
    : undefined,
});

export type Session = typeof auth.$Infer.Session;
```

When `AUTH_COOKIE_DOMAIN` is unset (local dev), Better Auth uses its defaults. In prod, setting it to `.a2sdlc-demo3.ts.shen.iorlas.net` shares cookies across `a2sdlc-demo3.ts.shen.iorlas.net` and `api.a2sdlc-demo3.ts.shen.iorlas.net`.

- [ ] **Step 2: Run typecheck**

```bash
make lint
```

Expected: PASS

- [ ] **Step 3: Verify local dev still works**

```bash
make dev
```

Open `http://localhost:3000`, sign up, sign in. Auth should work as before (no `AUTH_COOKIE_DOMAIN` set locally).

Stop the dev server after verifying.

- [ ] **Step 4: Commit**

```bash
git add packages/auth/src/index.ts
git commit -m "feat: support AUTH_COOKIE_DOMAIN for cross-subdomain auth"
```

---

### Task 5: Move Prisma CLI to Production Dependencies

**Files:**
- Modify: `packages/db/package.json`

The `migrate` container runs `npx prisma db push --skip-generate` at startup. After `pnpm prune --prod` in the Dockerfile, `prisma` would be removed (it's a devDependency), forcing `npx` to download it at runtime — slow and flaky. Moving it to `dependencies` keeps it in the pruned image.

- [ ] **Step 1: Move `prisma` from devDependencies to dependencies**

Keep the `catalog:` reference — `prisma` is already in `pnpm-workspace.yaml` catalog at `^6.19.3`. Just move the line from devDependencies to dependencies.

Edit `packages/db/package.json`:

```json
{
  "name": "@project/db",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "default": "./src/index.ts"
    }
  },
  "scripts": {
    "generate": "prisma generate",
    "push": "prisma db push",
    "studio": "prisma studio",
    "migrate": "prisma migrate dev",
    "postinstall": "prisma generate"
  },
  "dependencies": {
    "@prisma/client": "catalog:",
    "@project/env": "workspace:*",
    "prisma": "catalog:"
  },
  "devDependencies": {
    "@types/node": "catalog:",
    "tsx": "^4.21.0"
  }
}
```

- [ ] **Step 2: Regenerate lockfile and typecheck**

```bash
pnpm install
make lint
```

Expected: PASS (no type errors, lockfile updated)

- [ ] **Step 3: Commit**

```bash
git add packages/db/package.json pnpm-lock.yaml
git commit -m "chore(db): move prisma CLI to dependencies for production runtime"
```

---

### Task 6: Create Dockerfile

**Files:**
- Create: `Dockerfile`

- [ ] **Step 1: Create the multi-stage Dockerfile**

```dockerfile
# --- Base ---
FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate
WORKDIR /app

# --- Dependencies ---
FROM base AS deps
COPY pnpm-lock.yaml package.json ./
# Use prod workspace config — excludes e2e to avoid installing test deps
COPY pnpm-workspace.prod.yaml pnpm-workspace.yaml
COPY apps/web/package.json apps/web/package.json
COPY apps/server/package.json apps/server/package.json
COPY packages/api/package.json packages/api/package.json
COPY packages/auth/package.json packages/auth/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/env/package.json packages/env/package.json
COPY packages/ui/package.json packages/ui/package.json
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# --- Build ---
FROM base AS build
COPY --from=deps /app ./
COPY . .
# Restore the prod workspace (`COPY . .` overwrote it with the full workspace.yaml from the repo)
COPY pnpm-workspace.prod.yaml pnpm-workspace.yaml
# Generate Prisma client
RUN pnpm --filter @project/db generate
# VITE_API_URL must be set at build time — Vite bakes import.meta.env.VITE_* into the JS bundle.
# @project/env/client validates this is a URL; build fails if missing.
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
RUN pnpm -r build
# Remove devDependencies for smaller runtime image
RUN pnpm prune --prod

# --- Runtime ---
FROM node:20-alpine AS runtime
WORKDIR /app

# Copy pruned workspace (prod deps only)
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
# Web app (TanStack Start / Nitro output)
COPY --from=build /app/apps/web/.output ./apps/web/.output
COPY --from=build /app/apps/web/package.json ./apps/web/package.json
# Server app (tsc output)
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/server/package.json ./apps/server/package.json
COPY --from=build /app/apps/server/node_modules ./apps/server/node_modules
# Packages (runtime dependencies)
COPY --from=build /app/packages/api ./packages/api
COPY --from=build /app/packages/auth ./packages/auth
COPY --from=build /app/packages/config ./packages/config
COPY --from=build /app/packages/db ./packages/db
COPY --from=build /app/packages/env ./packages/env
COPY --from=build /app/packages/ui ./packages/ui

# Non-root user
RUN addgroup --system app && adduser --system --ingroup app app
USER app

# No CMD — each compose service specifies its own command
```

- [ ] **Step 2: Test the Docker build locally**

```bash
docker build --build-arg VITE_API_URL=http://api.a2sdlc-demo3.ts.shen.iorlas.net -t a2sdlc-demo3:test .
```

Expected: Build succeeds. This may take a few minutes on first run. If VITE_API_URL is missing, `@project/env/client` validation fails the build — this is intentional.

- [ ] **Step 3: Verify the image contents**

```bash
docker run --rm a2sdlc-demo3:test ls -la /app/apps/web/.output/server/index.mjs
docker run --rm a2sdlc-demo3:test ls -la /app/apps/server/dist/src/index.js
docker run --rm a2sdlc-demo3:test ls -la /app/packages/db/prisma/schema/
```

Expected: All three paths exist.

- [ ] **Step 4: Commit**

```bash
git add Dockerfile
git commit -m "feat: add multi-stage Dockerfile for production builds"
```

---

### Task 7: Create docker-compose.prod.yml

**Files:**
- Create: `docker-compose.prod.yml`

- [ ] **Step 1: Create the production compose file**

```yaml
# a2sdlc-demo3 production stack — managed by Dokploy on shen
# Single app image, two containers (web + server) behind Traefik on Tailscale.

x-app-env: &app-env
  DATABASE_URL: "postgresql://demo:demo3-pg-2026@db:5432/a2sdlc_demo3"
  BETTER_AUTH_SECRET: "${BETTER_AUTH_SECRET}"
  BETTER_AUTH_URL: "http://api.a2sdlc-demo3.ts.shen.iorlas.net"
  AUTH_COOKIE_DOMAIN: ".a2sdlc-demo3.ts.shen.iorlas.net"
  CORS_ORIGIN: "http://a2sdlc-demo3.ts.shen.iorlas.net"
  NODE_ENV: "production"

services:
  db:
    image: postgres:17-alpine
    pull_policy: always
    environment:
      POSTGRES_USER: demo
      POSTGRES_PASSWORD: demo3-pg-2026
      POSTGRES_DB: a2sdlc_demo3
    volumes:
      - postgres-data:/var/lib/postgresql/data
    networks:
      - app-internal
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U demo"]
      interval: 10s
      timeout: 5s
      retries: 5

  migrate:
    image: ghcr.io/iorlas/a2sdlc-demo3:${IMAGE_TAG}
    command: ["npx", "prisma", "db", "push", "--skip-generate"]
    working_dir: /app/packages/db
    environment:
      <<: *app-env
    depends_on:
      db:
        condition: service_healthy
    networks:
      - app-internal

  web:
    image: ghcr.io/iorlas/a2sdlc-demo3:${IMAGE_TAG}
    command: ["node", "/app/apps/web/.output/server/index.mjs"]
    hostname: a2sdlc-demo3-web
    environment:
      <<: *app-env
      PORT: "3000"
    depends_on:
      migrate:
        condition: service_completed_successfully
    labels:
      - tailscale=true
      - traefik.enable=true
      - traefik.docker.network=dokploy-network
      - traefik.http.routers.a2sdlc-demo3-web.rule=Host(`a2sdlc-demo3.ts.shen.iorlas.net`)
      - traefik.http.routers.a2sdlc-demo3-web.entrypoints=web
      - traefik.http.services.a2sdlc-demo3-web.loadbalancer.server.port=3000
    networks:
      - dokploy-network
      - app-internal
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://localhost:3000/ || exit 1"]
      interval: 10s
      timeout: 5s
      retries: 3
      start_period: 30s

  server:
    image: ghcr.io/iorlas/a2sdlc-demo3:${IMAGE_TAG}
    command: ["node", "/app/apps/server/dist/src/index.js"]
    hostname: a2sdlc-demo3-api
    environment:
      <<: *app-env
      PORT: "3001"
    depends_on:
      migrate:
        condition: service_completed_successfully
    labels:
      - tailscale=true
      - traefik.enable=true
      - traefik.docker.network=dokploy-network
      - traefik.http.routers.a2sdlc-demo3-api.rule=Host(`api.a2sdlc-demo3.ts.shen.iorlas.net`)
      - traefik.http.routers.a2sdlc-demo3-api.entrypoints=web
      - traefik.http.services.a2sdlc-demo3-api.loadbalancer.server.port=3001
    networks:
      - dokploy-network
      - app-internal
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://localhost:3001/ || exit 1"]
      interval: 10s
      timeout: 5s
      retries: 3
      start_period: 30s

networks:
  dokploy-network:
    external: true
  app-internal:
    internal: true

volumes:
  postgres-data:
```

- [ ] **Step 2: Validate compose syntax locally**

```bash
export IMAGE_TAG=test BETTER_AUTH_SECRET=test-secret-32-chars-minimum-here
docker compose -f docker-compose.prod.yml config --quiet
```

Expected: No errors (exit code 0).

- [ ] **Step 3: Commit**

```bash
git add docker-compose.prod.yml
git commit -m "feat: add production docker-compose for Dokploy deployment"
```

---

### Task 8: Create CI/CD Deploy Workflow

**Files:**
- Create: `.github/workflows/deploy.yml`

- [ ] **Step 1: Create the deploy workflow**

```yaml
name: Build and Deploy

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  workflow_dispatch:

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository }}

jobs:
  build-and-push:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
      id-token: write
      attestations: write

    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v5

      - name: Validate compose syntax
        run: |
          export IMAGE_TAG=test BETTER_AUTH_SECRET=test-secret-32-chars-minimum-here
          docker compose -f docker-compose.prod.yml config --quiet

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Log in to GHCR
        if: github.event_name != 'pull_request'
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Extract metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
          tags: |
            type=ref,event=branch
            type=ref,event=pr
            type=sha,prefix=main-

      - name: Build and push
        id: build
        uses: docker/build-push-action@v6
        with:
          context: .
          push: ${{ github.event_name != 'pull_request' }}
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          build-args: |
            VITE_API_URL=http://api.a2sdlc-demo3.ts.shen.iorlas.net
          cache-from: type=gha
          cache-to: type=gha,mode=max
          platforms: linux/amd64

      - name: Generate artifact attestation
        if: github.event_name != 'pull_request'
        uses: actions/attest-build-provenance@v1
        with:
          subject-name: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
          subject-digest: ${{ steps.build.outputs.digest }}
          push-to-registry: true

      - name: Deploy to Dokploy
        if: github.event_name != 'pull_request'
        env:
          DOKPLOY_AUTH_TOKEN: ${{ secrets.DOKPLOY_AUTH_TOKEN }}
          DOKPLOY_URL: ${{ secrets.DOKPLOY_URL }}
          DOKPLOY_COMPOSE_ID: ${{ secrets.DOKPLOY_COMPOSE_ID }}
          BETTER_AUTH_SECRET: ${{ secrets.BETTER_AUTH_SECRET }}
          GIT_SHA: ${{ github.sha }}
        run: |
          export IMAGE_TAG="main-${GIT_SHA::7}"
          uvx --from 'dokploy-ctl @ git+https://github.com/iorlas/dokploy-ctl.git' \
            dokploy-ctl login --url "$DOKPLOY_URL" --token "$DOKPLOY_AUTH_TOKEN"
          uvx --from 'dokploy-ctl @ git+https://github.com/iorlas/dokploy-ctl.git' \
            dokploy-ctl deploy "$DOKPLOY_COMPOSE_ID" docker-compose.prod.yml --env
```

- [ ] **Step 2: Commit**

```bash
mkdir -p .github/workflows
git add .github/workflows/deploy.yml
git commit -m "feat: add CI/CD pipeline for Dokploy deployment"
```

---

### Task 9: Push Baseline and Recreate Main

Run from `/Users/iorlas/Workspaces/a2sdlc-demo3/`, on the `baseline` branch with all Tasks 2–8 committed.

- [ ] **Step 1: Push baseline**

```bash
git push origin baseline
```

- [ ] **Step 2: Recreate main from baseline**

```bash
git push origin baseline:main --force
```

- [ ] **Step 3: Set baseline as default branch**

```bash
gh api repos/iorlas/a2sdlc-demo3 -X PATCH -f default_branch=baseline
```

---

### Task 10: Create Dokploy Compose App (Human Gate)

- [ ] **Step 1: Check dokploy-ctl is installed**

```bash
dokploy-ctl --version
```

If missing: `pip install git+https://github.com/iorlas/dokploy-ctl.git`

- [ ] **Step 2: Find or create the Dokploy project**

```bash
dokploy-ctl find
```

Look for an existing project to host the app, or create one:

```bash
dokploy-ctl init <project-id> a2sdlc-demo3
```

Save the returned compose ID.

- [ ] **Step 3: HUMAN GATE — Set GitHub secrets**

Ask the human to set these secrets on `iorlas/a2sdlc-demo3`:

```bash
gh secret set DOKPLOY_AUTH_TOKEN --repo iorlas/a2sdlc-demo3
gh secret set DOKPLOY_URL --repo iorlas/a2sdlc-demo3
gh secret set DOKPLOY_COMPOSE_ID --repo iorlas/a2sdlc-demo3
gh secret set BETTER_AUTH_SECRET --repo iorlas/a2sdlc-demo3
```

Generate `BETTER_AUTH_SECRET` with: `openssl rand -hex 32`

- [ ] **Step 4: Trigger deploy and verify**

```bash
gh workflow run deploy.yml --repo iorlas/a2sdlc-demo3 --ref main
```

Monitor:
```bash
gh run list --repo iorlas/a2sdlc-demo3 --limit 1
```

- [ ] **Step 5: Verify deployment is healthy**

```bash
dokploy-ctl status <compose-id>
```

- [ ] **Step 6: Test the running app**

Open `http://a2sdlc-demo3.ts.shen.iorlas.net/` in a browser (must be on Tailscale). Verify:
- Page loads
- Sign up works
- Sign in works
- Auth cookies are shared (API calls succeed)
