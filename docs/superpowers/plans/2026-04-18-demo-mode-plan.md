# Demo Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `docker compose up` boot the whole app (web + API + Postgres, seeded demo user) so an external developer can evaluate the template with one command and no config.

**Architecture:** Two compose files (`docker-compose.yml` = demo stack, `docker-compose.dev.yml` = postgres-only dev infra). One multi-stage `Dockerfile` at repo root — node+pnpm+bun build stages, bun-only runtime — reused by three services (`migrate`, `server`, `web`) via YAML anchors. Migrate sidecar runs `prisma db push` + existing `scripts/seed.ts` (after stripping sample todos).

**Tech Stack:** Docker + Docker Compose, multi-stage Dockerfile, node:24-slim (build), oven/bun:1-slim (runtime), pnpm@10.32.1, Prisma, Better-Auth, TanStack Start (Nitro SSR), Hono.

**Source spec:** `docs/superpowers/specs/2026-04-18-demo-mode-design.md`

---

## File inventory

| File | Action | Owner task |
|---|---|---|
| `apps/server/package.json` | Modify — swap `dev` script runtime | Task 1 |
| `docker-compose.yml` (old, postgres-only) | Rename → `docker-compose.dev.yml` + edit | Task 2 |
| `Makefile` | Modify — setup/db/clean use `-f docker-compose.dev.yml` | Task 2 |
| `scripts/seed-credentials.ts` | Create — canonical credentials | Task 3 |
| `e2e/fixtures/credentials.ts` | Modify — become re-export | Task 3 |
| `scripts/seed.ts` | Modify — import from `./seed-credentials.ts`, drop sample todos | Task 3 |
| `packages/db/package.json` | Modify — move `prisma` to dependencies | Task 4 |
| `pnpm-workspace.prod.yaml` | Create — excludes `e2e/` | Task 5 |
| `Dockerfile` | Create — 5-stage multi-stage build | Task 6 |
| `.dockerignore` | Create | Task 7 |
| `docker-compose.yml` (new, demo stack) | Create | Task 8 |
| `Makefile` | Modify — `clean` target drops the demo stack too | Task 8 |
| `README.md` | Modify — prepend quick-start section | Task 10 |

## Global preconditions

- Branch is `spike/demo-mode` (already created)
- Base is `88105e3` + the spec commits on the branch
- Current working directory: `/Users/iorlas/Workspaces/agentic-web-stack`
- Docker Desktop or OrbStack running with BuildKit enabled (default on modern Docker)
- `.env` file exists but only contains DATABASE_URL, BETTER_AUTH_SECRET, BETTER_AUTH_URL (no DEV_DB_* vars — the zero-conf claim the spec fixes)

---

## Task 1: Swap `apps/server` dev script from `tsx watch` → `bun --watch`

**Why:** `tsx` is the last non-bun runtime in the repo after the bun-test migration. Consistency cleanup + drop a dependency. Verify Better-Auth hot-reload still works.

**Files:**
- Modify: `apps/server/package.json`

- [ ] **Step 1: Inspect current state**

Run: `cat apps/server/package.json`

Expected output includes:
```json
"scripts": {
  "dev": "tsx watch --env-file-if-exists=../../.env src/index.ts",
  "build": "tsc",
  "start": "node dist/index.js"
},
"devDependencies": {
  "@types/node": "catalog:",
  "pino-pretty": "^13.1.3",
  "tsx": "^4.19.0"
}
```

- [ ] **Step 2: Edit `apps/server/package.json`**

Change two things: the `dev` script runtime and drop `tsx` from devDependencies. Use the Edit tool.

Replace:
```json
    "dev": "tsx watch --env-file-if-exists=../../.env src/index.ts",
```
with:
```json
    "dev": "bun --watch --env-file-if-exists=../../.env src/index.ts",
```

Replace:
```json
    "@types/node": "catalog:",
    "pino-pretty": "^13.1.3",
    "tsx": "^4.19.0"
```
with:
```json
    "@types/node": "catalog:",
    "pino-pretty": "^13.1.3"
```

- [ ] **Step 3: Refresh the lockfile**

Run: `pnpm install`

Expected: `tsx` removed from `node_modules`; pnpm summary shows 1 package removed. No errors.

- [ ] **Step 4: Confirm typecheck still passes**

Run: `make lint`

Expected: PASS (agent-harness + tsc both green).

- [ ] **Step 5: Smoke-test `make dev` in a background shell**

Run in a separate terminal (or background with `run_in_background`): `make dev`

Wait ~10 seconds for both servers to boot. Then in another shell:
```bash
curl -s http://localhost:3001/health
```
Expected JSON response: `{"status":"ok","uptime":...,"timestamp":"...","db":"ok"}`

Kill the `make dev` process afterwards: `bun scripts/kill-ports.ts 3000 3001` (this is a legitimate kill mechanism the repo provides).

- [ ] **Step 6: Verify hot-reload still works with bun --watch**

Start `make dev` again in background.

Edit `apps/server/src/logger.ts` (or any file in `apps/server/src/`) — just add and remove a blank line, save. Watch the `make dev` output: bun should log a reload. Then `curl http://localhost:3001/health` again and confirm it still returns 200.

If hot-reload is broken (server doesn't reload on file change, or `/health` returns 500 after reload), revert this task entirely and investigate. The spec flags this as the one risk for Task 1.

Kill the dev processes: `bun scripts/kill-ports.ts 3000 3001`.

- [ ] **Step 7: Commit**

```bash
git add apps/server/package.json pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
chore(apps/server): swap tsx watch to bun --watch

Consistency with the rest of the repo after the bun-test migration.
Drops the last tsx dependency. Verified hot-reload + Better-Auth
endpoints still respond correctly after reload.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Extract `docker-compose.dev.yml` with zero-conf literals

**Why:** Current `docker-compose.yml` uses `${DEV_DB_*}` interpolation that resolves to empty strings without a hand-crafted `.env`, silently breaking zero-conf. Split the dev infra into its own file with literals, freeing the root `docker-compose.yml` name for the demo stack (added in Task 8).

**Files:**
- Rename: `docker-compose.yml` → `docker-compose.dev.yml` (with content edits)
- Modify: `Makefile`

- [ ] **Step 1: Create `docker-compose.dev.yml` with literals**

The source file is `docker-compose.yml` (postgres-only). Use `git mv` so history is preserved, then edit in place.

Run: `git mv docker-compose.yml docker-compose.dev.yml`

Then replace the entire contents of `docker-compose.dev.yml` with:

```yaml
# Dev-mode: postgres only. Used by `make setup`, `make db`, `make clean`.
# The full-stack demo uses docker-compose.yml (see that file + README).
name: agentic-web-stack

services:
  postgres:
    image: postgres:17
    container_name: agentic-postgres
    environment:
      POSTGRES_DB: app
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped

volumes:
  postgres_data:
```

Key changes from the old file: `${DEV_DB_NAME}` → `app`, `${DEV_DB_USER}` → `postgres`, `${DEV_DB_PASSWORD}` → `postgres`, `${DEV_DB_PORT}:5432` → `5432:5432`, and the `pg_isready -U ${DEV_DB_USER}` → `pg_isready -U postgres`.

- [ ] **Step 2: Update Makefile `setup` target**

Use Edit to replace this block:

```makefile
setup: ## Zero-conf: deps + Postgres + schema + hooks (runs prereq checks)
	@command -v bun >/dev/null 2>&1 || { echo "✗ bun is required — install via 'brew install bun' or 'curl -fsSL https://bun.sh/install | bash'"; exit 1; }
	@command -v docker >/dev/null 2>&1 || { echo "✗ docker is required — install Docker Desktop or OrbStack"; exit 1; }
	pnpm install
	docker compose up -d
	@echo "Waiting for Postgres..."
	@until docker compose exec -T postgres pg_isready -U postgres > /dev/null 2>&1; do sleep 1; done
	pnpm -w run db:push
	$(MAKE) routes
	prek install
	@echo "✓ Ready. Run 'make dev' to start."
```

with:

```makefile
setup: ## Zero-conf: deps + Postgres + schema + hooks (runs prereq checks)
	@command -v bun >/dev/null 2>&1 || { echo "✗ bun is required — install via 'brew install bun' or 'curl -fsSL https://bun.sh/install | bash'"; exit 1; }
	@command -v docker >/dev/null 2>&1 || { echo "✗ docker is required — install Docker Desktop or OrbStack"; exit 1; }
	pnpm install
	docker compose -f docker-compose.dev.yml up -d
	@echo "Waiting for Postgres..."
	@until docker compose -f docker-compose.dev.yml exec -T postgres pg_isready -U postgres > /dev/null 2>&1; do sleep 1; done
	pnpm -w run db:push
	$(MAKE) routes
	prek install
	@echo "✓ Ready. Run 'make dev' to start."
```

- [ ] **Step 3: Update Makefile `db` target**

Replace:
```makefile
db:
	docker compose up -d
```

with:
```makefile
db:
	docker compose -f docker-compose.dev.yml up -d
```

- [ ] **Step 4: Update Makefile `clean` target**

Replace:
```makefile
clean:
	docker compose down -v
	@ids=$$(docker ps -aq --filter "name=agentic-postgres-test-" --filter "name=agentic-postgres-e2e-" --filter "name=agentic-postgres-unit-"); \
	  [ -n "$$ids" ] && docker rm -f $$ids || true
	rm -rf node_modules apps/*/node_modules packages/*/node_modules
	rm -rf apps/web/.output apps/web/dist apps/server/dist
```

with (we are adding the dev compose down; the demo stack down is added in Task 8):
```makefile
clean:
	docker compose -f docker-compose.dev.yml down -v
	@ids=$$(docker ps -aq --filter "name=agentic-postgres-test-" --filter "name=agentic-postgres-e2e-" --filter "name=agentic-postgres-unit-"); \
	  [ -n "$$ids" ] && docker rm -f $$ids || true
	rm -rf node_modules apps/*/node_modules packages/*/node_modules
	rm -rf apps/web/.output apps/web/dist apps/server/dist
```

- [ ] **Step 5: Verify — tear down, back up, rerun setup**

Drop any existing volume/container so the test is honest:
```bash
docker compose -f docker-compose.dev.yml down -v || true
docker rm -f agentic-postgres 2>/dev/null || true
docker volume rm agentic-web-stack_postgres_data 2>/dev/null || true
```

Temporarily move `.env` aside to prove zero-conf works:
```bash
mv .env .env.backup
```

Run: `make setup`

Expected: runs without `WARN: variable not set`, postgres starts, `pg_isready` succeeds, `db:push` runs cleanly, `routes` regenerates, `prek install` completes. No red output.

Restore the env file:
```bash
mv .env.backup .env
```

- [ ] **Step 6: Verify `make dev` still works**

Run: `make dev` (background)

Wait ~10s. Curl: `curl -s http://localhost:3001/health` → expect `{"status":"ok",...,"db":"ok"}`.

Kill: `bun scripts/kill-ports.ts 3000 3001`.

- [ ] **Step 7: Verify `make test` still works (one scenario)**

Quick sanity pass — no need for full suite here, Task 3 re-tests.

Run: `make test ARGS="--project desktop --grep 'Sign in'"`

Expected: 1/1 PASS.

- [ ] **Step 8: Commit**

```bash
git add docker-compose.dev.yml Makefile
# The rename shows as deletion + add unless we add both; git mv handled this but confirm:
git status  # should show `renamed: docker-compose.yml -> docker-compose.dev.yml`
git commit -m "$(cat <<'EOF'
fix(compose): bake literals into dev compose (zero-conf)

Rename docker-compose.yml to docker-compose.dev.yml (dev-infra-only
stack) and replace ${DEV_DB_*} var interpolation with literal
app/postgres/postgres/5432. The old interpolated form silently
resolved to empty strings without a hand-crafted .env, violating the
zero-conf promise. Root docker-compose.yml is now free for the demo
stack (added in a later commit).

Makefile setup/db/clean targets gain -f docker-compose.dev.yml.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Invert credentials + drop sample todos from seed

**Why:** The demo runtime image excludes `e2e/` (via `pnpm-workspace.prod.yaml` added in Task 5). `scripts/seed.ts` currently imports `SEED_USER` from `e2e/fixtures/credentials.ts` — that import won't resolve at runtime. Fix by inverting: canonical values move to `scripts/seed-credentials.ts`; `e2e/fixtures/credentials.ts` becomes a pass-through. Also drop the 5 sample todos per spec — demo user lands in empty state.

**Files:**
- Create: `scripts/seed-credentials.ts`
- Modify: `e2e/fixtures/credentials.ts`
- Modify: `scripts/seed.ts`

- [ ] **Step 1: Create `scripts/seed-credentials.ts`**

Write this file:

```typescript
// Canonical demo / test credentials. Used by:
// - scripts/seed.ts (demo-mode migrate sidecar + `make db-seed`)
// - e2e/fixtures/credentials.ts (re-exports for test scenarios)
//
// Moved here from e2e/fixtures so the demo-mode runtime image (which
// excludes e2e/) can still resolve the import.
//
// Complex password future-proofs e2e against Better-Auth adding
// upper/lower/digit/symbol rules.

export const SHARED_PASSWORD = "TestPassword!123";

export const SEED_USER = {
  email: "demo@example.com",
  password: SHARED_PASSWORD,
} as const;

export const TEST_USER = {
  email: "test@example.com",
  password: SHARED_PASSWORD,
} as const;
```

- [ ] **Step 2: Rewrite `e2e/fixtures/credentials.ts` as a re-export**

Replace the entire file contents with:

```typescript
// Shared test credentials. Canonical values live in
// ../../scripts/seed-credentials.ts so the demo-mode runtime image
// (which excludes e2e/) can resolve the same constants.

export {
  SHARED_PASSWORD,
  SEED_USER,
  TEST_USER,
} from "../../scripts/seed-credentials.ts";
```

- [ ] **Step 3: Update `scripts/seed.ts`**

Current top of file (line 1-3):
```typescript
import { auth } from "@project/auth";
import { db } from "@project/db";
import { SEED_USER } from "../e2e/fixtures/credentials.ts";
```

Change line 3 (the relative import) to:
```typescript
import { SEED_USER } from "./seed-credentials.ts";
```

Line 1 (`import { auth } from "@project/auth"`) stays — the spec explicitly preserves this per the zero-conf-architecture carve-out.

- [ ] **Step 4: Drop the sample-todos block from `scripts/seed.ts`**

Current lines 29-65 include:
```typescript
  console.log(`Created user: ${user.email}`);

  // Create sample todos
  await db.todo.createMany({
    data: [
      {
        title: "Set up the project",
        completed: true,
        position: 0,
        userId: user.id,
      },
      // ... (4 more) ...
    ],
  });

  console.log("Created 5 sample todos");
  console.log("\nDemo credentials:");
```

Replace the block from `  // Create sample todos` through `  console.log("Created 5 sample todos");` (inclusive) with a single blank line. The final `console.log("\nDemo credentials:")` block stays. After the edit, the relevant section reads:

```typescript
  console.log(`Created user: ${user.email}`);

  console.log("\nDemo credentials:");
  console.log(`  Email:    ${SEED_USER.email}`);
  console.log(`  Password: ${SEED_USER.password}`);
}
```

Also remove the now-unused `user` destructuring if applicable. Current form is `const { user } = await auth.api.signUpEmail(...)` — `user` is still used for the success log, so leave it.

- [ ] **Step 5: Verify typecheck**

Run: `make lint`

Expected: PASS. If the e2e fixture re-export path is wrong (typo), tsc will catch it.

- [ ] **Step 6: Verify `make db-seed` runs clean and creates only the user**

Tear down postgres data to guarantee a fresh DB:
```bash
docker compose -f docker-compose.dev.yml down -v
docker compose -f docker-compose.dev.yml up -d
@until docker compose -f docker-compose.dev.yml exec -T postgres pg_isready -U postgres > /dev/null 2>&1; do sleep 1; done
make db-push
make db-seed
```

Expected seed output:
```
Seeding database...
Created user: demo@example.com

Demo credentials:
  Email:    demo@example.com
  Password: TestPassword!123
```

No "Created 5 sample todos" line.

- [ ] **Step 7: Verify idempotency — rerun `make db-seed`**

Run: `make db-seed`

Expected output:
```
Seeding database...
Already seeded (demo@example.com exists), skipping.
```

- [ ] **Step 8: Verify `make test` still works (e2e fixture re-export)**

Run: `make test ARGS="--project desktop --grep 'Sign in'"`

Expected: 1/1 PASS. The `SEED_USER` fixture value is unchanged because the re-export preserves it.

- [ ] **Step 9: Verify `make test-unit`**

Run: `make test-unit`

Expected: PASS (no test uses the fixture directly but the import graph still resolves cleanly).

- [ ] **Step 10: Commit**

```bash
git add scripts/seed-credentials.ts scripts/seed.ts e2e/fixtures/credentials.ts
git commit -m "$(cat <<'EOF'
refactor(seed): invert credentials import + drop sample todos

Canonical credentials move from e2e/fixtures/credentials.ts to
scripts/seed-credentials.ts so the demo-mode runtime image (which
excludes e2e/) can resolve them. The e2e fixture file becomes a 1-line
re-export. scripts/seed.ts imports from the new local path.

Also drop the 5 sample todos block — the demo user lands in the empty
state (first-run UX is "create your first todo").

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Move `prisma` CLI to `packages/db` dependencies

**Why:** The demo migrate sidecar needs the `prisma` CLI at runtime (inside an `oven/bun:1-slim` image with no pnpm) to run `prisma db push`. Moving it from devDeps → deps ensures `pnpm install --prod` includes it in the runtime image's `node_modules`.

**Files:**
- Modify: `packages/db/package.json`

- [ ] **Step 1: Edit `packages/db/package.json`**

Current structure:
```json
"dependencies": {
  "@prisma/client": "catalog:",
  "@project/env": "workspace:*"
},
"devDependencies": {
  "@types/node": "catalog:",
  "prisma": "catalog:"
}
```

Replace with:
```json
"dependencies": {
  "@prisma/client": "catalog:",
  "prisma": "catalog:",
  "@project/env": "workspace:*"
},
"devDependencies": {
  "@types/node": "catalog:"
}
```

- [ ] **Step 2: Refresh lockfile**

Run: `pnpm install`

Expected: 0 actual package downloads (prisma is already in the store); pnpm updates `pnpm-lock.yaml` to reflect the dep category change.

- [ ] **Step 3: Verify `make db-push` still works**

Run: `make db-push`

Expected: prisma uses the same binary as before, no errors.

- [ ] **Step 4: Verify `make lint` and `make test-unit`**

Run: `make lint && make test-unit`

Expected: both PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/db/package.json pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
chore(db): move prisma CLI to dependencies

The demo-mode runtime image runs `prisma db push` in a migrate
sidecar (no pnpm, no dev deps). Move prisma from devDependencies ->
dependencies so `pnpm install --prod` includes the CLI binary at
node_modules/.bin/prisma.

Pattern matches a2sdlc-demo3 (which runs prisma directly from its
prod tree in the deployed image).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Create `pnpm-workspace.prod.yaml`

**Why:** Runtime image's `prod-deps` stage installs against this narrower workspace so Playwright and feature files don't land in the runtime.

**Files:**
- Create: `pnpm-workspace.prod.yaml`

- [ ] **Step 1: Create the file**

Contents — same as `pnpm-workspace.yaml` minus `e2e/*`:

```yaml
packages:
  - "apps/*"
  - "packages/*"

catalog:
  "@prisma/client": ^6.19.3
  prisma: ^6.19.3
  zod: ^3.25.76
  "@t3-oss/env-core": ^0.12.0
  "@types/node": ^25.6.0
  typescript: ^5.7.2
```

Keep the `catalog:` section identical to `pnpm-workspace.yaml` so workspace deps resolving to `catalog:` still work in the prod tree. If `pnpm-workspace.yaml` evolves, `.prod.yaml` must track — call this out later in README if it becomes a maintenance pain.

- [ ] **Step 2: Verify it parses — simulate a `--prod` install against a fresh store**

Do NOT run this against the real `node_modules/` — it would nuke dev deps. We only verify the file parses as valid YAML + yields a valid workspace graph. Run:

```bash
node -e 'const yaml=require("js-yaml");console.log(yaml.load(require("fs").readFileSync("pnpm-workspace.prod.yaml","utf8")))'
```

Expected: dumps the parsed JS object — no YAML errors. (`js-yaml` is already in `node_modules` via pnpm's own dependency chain — if missing, use `python3 -c 'import yaml,sys;print(yaml.safe_load(open("pnpm-workspace.prod.yaml")))'` instead.)

Don't do a real `pnpm install --prod` at repo root — we validate the file during the Dockerfile build in Task 6 + 9.

- [ ] **Step 3: Commit**

```bash
git add pnpm-workspace.prod.yaml
git commit -m "$(cat <<'EOF'
build: add pnpm-workspace.prod.yaml for runtime image

Narrower workspace file for the demo-mode runtime image's prod-deps
stage — excludes e2e/ so Playwright + fixtures (~250MB) don't ship.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Create the root `Dockerfile`

**Why:** Single multi-stage Dockerfile, reused by three compose services via YAML anchors. Produces a bun-only runtime with prod deps, web Nitro bundle, server TS source, packages TS source, and seed script.

**Files:**
- Create: `Dockerfile`

- [ ] **Step 1: Write the Dockerfile**

Create `Dockerfile` at repo root:

```dockerfile
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
# packages/db generate was already triggered by postinstall during the deps
# stage; rerun here for safety against the workspace.yaml swap.
RUN pnpm --filter @project/db generate \
    && pnpm --filter @project/web build

# --- Runtime: bun-only ---
FROM oven/bun:1-slim AS runtime
WORKDIR /app

# HEALTHCHECK NONE: this image is shared by multiple compose services; each
# service defines its own healthcheck at the orchestration layer.
HEALTHCHECK NONE

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
COPY --from=build /app/tsconfig.base.json ./tsconfig.base.json

# Non-root user
RUN addgroup --system app && adduser --system --ingroup app app
USER app
```

- [ ] **Step 2: Validate syntax with `docker buildx build --check`**

Run:
```bash
docker buildx build --check --build-arg VITE_API_URL=http://localhost:3001 .
```

Expected: no warnings about Dockerfile syntax, no errors. If it flags anything, fix inline before proceeding.

- [ ] **Step 3: Commit (without building yet — docker-compose.yml in Task 8 drives the build)**

```bash
git add Dockerfile
git commit -m "$(cat <<'EOF'
build: add root Dockerfile for demo-mode runtime

Five-stage multi-stage build: node+pnpm+bun build stages, bun-only
runtime. Reused by three compose services (migrate, server, web) via
YAML anchors in the demo-mode docker-compose.yml (separate commit).

Build deliberately narrows to @project/web (vite build) and
@project/db (prisma generate); apps/server runs TS directly via bun
with no dist step.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Create `.dockerignore`

**Why:** Prevents `node_modules`, build outputs, test results, local config, and secrets from bloating the build context. Critical for `.env*` (contains real BETTER_AUTH_SECRET in dev).

**Files:**
- Create: `.dockerignore`

- [ ] **Step 1: Write the file**

Create `.dockerignore` at repo root:

```
# node_modules — installed fresh in the image
node_modules
**/node_modules

# Build outputs — regenerated in the build stage
**/.output
**/dist
apps/web/.output
apps/web/dist
apps/server/dist

# Test artifacts
**/.features-gen
e2e/test-results
e2e/playwright-report

# Caches
**/.cache
**/.turbo
**/tsconfig.tsbuildinfo

# Dev / editor / CI config that shouldn't be baked
.git
.gitignore
.github
.vscode
.idea
.claude
.cursor
.zed

# Docs — image doesn't need them
docs

# Local env files — never bake secrets into images
.env
.env.*
!.env.example

# Runtime artifacts from host
coverage
*.log

# Misc
TODO.md
README.md
```

Note: `README.md` is excluded because the runtime image doesn't need it. It's still committed to the repo and shown on GitHub.

- [ ] **Step 2: Verify the dockerignore is respected**

Run a dry-run of the build context: `docker buildx build --progress=plain -t dry-run-check . 2>&1 | head -20`

Expected: transfer context line shows small size (a few MB), NOT hundreds of MB (which would indicate `node_modules` is leaking).

Cancel the build once the context transfer finishes:
```bash
# Send SIGINT if it hangs past the context transfer
```

Actually, simpler: just check the build context listing. Do `docker buildx build --progress=plain --target=base . 2>&1 | grep "transferring context"`. The "transferring context: Xkb/MB" line tells us whether `.dockerignore` is working.

Expected: context size < 20 MB (without `.dockerignore`, it'd be 500 MB+).

- [ ] **Step 3: Commit**

```bash
git add .dockerignore
git commit -m "$(cat <<'EOF'
build: add .dockerignore

Exclude node_modules, build outputs, test artifacts, editor/IDE
config, docs, and critically .env* so local secrets never bake into
the image.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Create the demo `docker-compose.yml` + update `make clean`

**Why:** The root compose file is now the demo stack — postgres + migrate sidecar + server + web, all wired via YAML anchors so one build tags one image and all three services share it.

**Files:**
- Create: `docker-compose.yml`
- Modify: `Makefile` (add demo stack to `clean`)

- [ ] **Step 1: Write `docker-compose.yml`**

Create file at repo root:

```yaml
# Demo mode: `docker compose up` boots postgres + migrate + server + web.
# First-impression artifact for evaluators. Clone, run, click around.
#
# For dev (postgres only, with `make setup && make dev`), see
# docker-compose.dev.yml.
#
# Port 3000/3001 will clash with `make dev` — don't run both at once.

name: agentic-web-stack-demo

# Shared env across migrate, server, web. YAML anchor so one edit propagates.
x-app-env: &app-env
  DATABASE_URL: "postgresql://postgres:postgres@db:5432/app"
  BETTER_AUTH_SECRET: "demo-not-for-production-use-32-chars"
  BETTER_AUTH_URL: "http://localhost:3001"
  CORS_ORIGIN: "http://localhost:3000"
  NODE_ENV: "production"

services:
  db:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: app
    volumes:
      - postgres-demo-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d app"]
      interval: 10s
      timeout: 5s
      retries: 5

  # All app containers share one locally-built image. Compose builds once
  # because the image tag is identical across services.
  migrate:
    image: &app-image agentic-web-stack:local
    build: &app-build
      context: .
      args:
        VITE_API_URL: http://localhost:3001
    command:
      - "sh"
      - "-c"
      - "cd /app/packages/db && /app/node_modules/.bin/prisma db push --skip-generate && bun /app/scripts/seed.ts"
    environment:
      <<: *app-env
    depends_on:
      db:
        condition: service_healthy

  server:
    image: *app-image
    build: *app-build
    command: ["bun", "/app/apps/server/src/index.ts"]
    environment:
      <<: *app-env
      PORT: "3001"
    ports:
      - "127.0.0.1:3001:3001"
    depends_on:
      migrate:
        condition: service_completed_successfully
    healthcheck:
      test:
        - "CMD"
        - "bun"
        - "-e"
        - "fetch('http://127.0.0.1:3001/health').then(r => process.exit(r.status < 500 ? 0 : 1)).catch(() => process.exit(1))"
      interval: 10s
      timeout: 5s
      retries: 3
      start_period: 30s

  web:
    image: *app-image
    build: *app-build
    command: ["bun", "/app/apps/web/.output/server/index.mjs"]
    environment:
      <<: *app-env
      PORT: "3000"
    ports:
      - "127.0.0.1:3000:3000"
    depends_on:
      migrate:
        condition: service_completed_successfully
    healthcheck:
      test:
        - "CMD"
        - "bun"
        - "-e"
        - "fetch('http://127.0.0.1:3000/').then(r => process.exit(r.status < 500 ? 0 : 1)).catch(() => process.exit(1))"
      interval: 10s
      timeout: 5s
      retries: 3
      start_period: 30s

volumes:
  postgres-demo-data:
```

- [ ] **Step 2: Update `Makefile` `clean` target to drop demo stack too**

Current (after Task 2):
```makefile
clean:
	docker compose -f docker-compose.dev.yml down -v
	@ids=$$(docker ps -aq --filter "name=agentic-postgres-test-" --filter "name=agentic-postgres-e2e-" --filter "name=agentic-postgres-unit-"); \
	  [ -n "$$ids" ] && docker rm -f $$ids || true
	rm -rf node_modules apps/*/node_modules packages/*/node_modules
	rm -rf apps/web/.output apps/web/dist apps/server/dist
```

Replace with:
```makefile
clean:
	docker compose down -v                                    # demo stack
	docker compose -f docker-compose.dev.yml down -v          # dev postgres
	@ids=$$(docker ps -aq --filter "name=agentic-postgres-test-" --filter "name=agentic-postgres-e2e-" --filter "name=agentic-postgres-unit-"); \
	  [ -n "$$ids" ] && docker rm -f $$ids || true
	rm -rf node_modules apps/*/node_modules packages/*/node_modules
	rm -rf apps/web/.output apps/web/dist apps/server/dist
```

- [ ] **Step 3: Compose config validation**

Run: `docker compose config`

Expected: prints the resolved compose file with YAML anchors expanded, no errors about unresolved references.

Similarly for the dev file:
```bash
docker compose -f docker-compose.dev.yml config
```

Both should print without errors.

- [ ] **Step 4: Commit (build happens in Task 9 — don't build here yet)**

```bash
git add docker-compose.yml Makefile
git commit -m "$(cat <<'EOF'
feat(demo): add docker-compose.yml for one-command demo stack

Postgres + migrate sidecar + server + web. Three app services share
one locally-built image (agentic-web-stack:local) via YAML anchors;
compose builds once.

migrate runs prisma db push + scripts/seed.ts against the fresh DB
and exits; server + web wait for service_completed_successfully on
migrate. All app ports bind to 127.0.0.1 (loopback only).

make clean drops both docker-compose.yml (demo) and
docker-compose.dev.yml (dev postgres).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: End-to-end verification — cold boot, warm rerun, clean rerun

**Why:** Before calling the spike done, prove the actual success criteria from the spec. This is where latent issues (missing COPY lines, env var typos, postinstall failures) surface.

**Files:** (none — verification only)

- [ ] **Step 1: Kill any running dev processes to free ports**

Run:
```bash
bun scripts/kill-ports.ts 3000 3001
docker compose -f docker-compose.dev.yml down -v
```

- [ ] **Step 2: Cold build from scratch**

Run: `docker compose build`

Expected: 5-stage build progresses `base → deps → prod-deps → build → runtime`, ends without errors. First build is ~3-5 minutes depending on network. If it fails, read the error carefully; common failure modes:

| Error | Cause | Fix |
|---|---|---|
| `postinstall: bun: not found` | Bun binary wasn't copied into base | Verify `COPY --from=oven/bun:1-slim` line in Dockerfile |
| `vite build` errors about `VITE_API_URL` | Build-arg not propagated | Check compose `args:` block under `&app-build` |
| `Cannot find module '@project/env/server'` in build | Workspace `.prod.yaml` resolution broken | Verify `.prod.yaml` has `packages/*` + `catalog:` identical to `.yaml` |

- [ ] **Step 3: Cold boot from scratch**

Run: `docker compose up` (foreground, watch the logs)

Watch for the order:
1. `db` starts, healthcheck passes (~5s)
2. `migrate` starts: `prisma db push` runs, then `scripts/seed.ts` runs, logs `Created user: demo@example.com` + credentials block, then exits 0
3. `server` + `web` start; each takes ~5-10s to report healthy
4. All four services in "healthy" or "exited 0" state

If any service stalls or logs errors, read the output. Don't move on until all four are healthy/exited-successfully.

- [ ] **Step 4: Smoke-test the demo in a browser**

In another terminal:
```bash
curl -s http://localhost:3001/health
```
Expected: `{"status":"ok",...,"db":"ok"}`.

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/
```
Expected: `200`.

Open `http://localhost:3000` in a browser (or use Playwright headed mode to verify programmatically, but manual is fine for the one-time verification).

Sign in with `demo@example.com` / `TestPassword!123`. Expect a successful login landing on the todos page. Create a todo; expect it to persist (refresh proves it).

- [ ] **Step 5: Warm rerun (keep volume)**

Stop the stack with Ctrl-C in the `docker compose up` shell, then:
```bash
docker compose down   # keep volume
docker compose up
```

Expected: faster boot (~10s). Migrate logs:
```
Seeding database...
Already seeded (demo@example.com exists), skipping.
```

Sign-in with the same credentials still works.

- [ ] **Step 6: Clean-slate rerun**

```bash
docker compose down -v   # wipe volume
docker compose up
```

Expected: migrate reprovisions schema, re-seeds user (logs `Created user: demo@example.com` again). Login works.

- [ ] **Step 7: Dev workflow regression check**

Stop demo stack: Ctrl-C + `docker compose down -v` (optional).

Run:
```bash
make setup
make dev
```

Expected: only postgres is in dev compose. `make dev` brings up web@3000 and api@3001 via pnpm. `curl http://localhost:3001/health` returns 200.

Kill dev: `bun scripts/kill-ports.ts 3000 3001`.

- [ ] **Step 8: Test workflow regression check**

Run:
```bash
make test-unit
make test
```

Expected: both PASS (27 unit + 20 BDD scenarios, per the spec's expectations).

- [ ] **Step 9: Cleanup — `make clean` tears down both**

Run: `make clean`

Expected: both `docker compose down -v` lines run, test-container sweep runs, `node_modules` + `.output` wiped. Exit 0.

- [ ] **Step 10: If any verification step failed, fix inline + commit the fix**

If Step 2-6 revealed a Dockerfile or compose issue, commit the fix as a "fixup" commit on top of Task 6 or 8:
```bash
git add <files>
git commit -m "fix(demo): <specific issue>"
```

No "large-scale refactor" commits here — targeted fixes only. If something is deeply wrong, return to brainstorming before committing.

---

## Task 10: README quick-start prepend

**Why:** The success criterion is "external dev clones and runs `docker compose up`". They need to know this is the entry point.

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Read current README**

Run: `head -20 README.md`

Note the current opening so we can insert cleanly above it.

- [ ] **Step 2: Prepend the quick-start section**

Add at the very top of `README.md`, before any existing content:

````markdown
# Agentic Web Stack

## Quick start (demo mode)

```bash
git clone https://github.com/YOUR_ORG/agentic-web-stack.git
cd agentic-web-stack
docker compose up
```

Open `http://localhost:3000`. Sign in with:

- **Email:** `demo@example.com`
- **Password:** `TestPassword!123`

First build takes ~3–5 minutes (pnpm install + vite build + prisma generate). Subsequent `docker compose up` runs start in ~10 seconds.

**Port conflict:** demo mode uses `3000`/`3001`/`5432` — the same ports as `make dev`. Don't run both at once.

Want to hack on it? See the Development section below — `make setup` + `make dev` is the dev workflow; `docker compose up` is the demo artifact.

---
````

If the current README already has `# Agentic Web Stack` as the top heading, just insert the `## Quick start (demo mode)` block immediately after that heading and before any other content. Don't duplicate the title.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "$(cat <<'EOF'
docs(readme): prepend demo-mode quick-start

External devs now have a one-command entry point (docker compose up)
with credentials and port-conflict note up top. Dev workflow (make
setup + make dev) stays documented below.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Final review and handover

- [ ] **Step 1: Review the commit log**

Run: `git log --oneline 88105e3..HEAD`

Expected ordering (approximately):
```
<sha> docs(readme): prepend demo-mode quick-start
<sha> feat(demo): add docker-compose.yml for one-command demo stack
<sha> build: add .dockerignore
<sha> build: add root Dockerfile for demo-mode runtime
<sha> build: add pnpm-workspace.prod.yaml for runtime image
<sha> chore(db): move prisma CLI to dependencies
<sha> refactor(seed): invert credentials import + drop sample todos
<sha> fix(compose): bake literals into dev compose (zero-conf)
<sha> chore(apps/server): swap tsx watch to bun --watch
<sha> docs: <spec commits from brainstorming>
```

Plus any fixup commits from Task 9 Step 10.

- [ ] **Step 2: Full suite sanity pass**

Run: `make lint && make test-unit && make test`

Expected: all green.

- [ ] **Step 3: Write a handover doc**

Create `docs/superpowers/specs/YYYY-MM-DD-demo-mode-handover.md` (using today's date) capturing:
- What shipped (list of commits)
- Success-criteria evidence (Task 9 verification results)
- Any deviations from the spec + why
- Known issues / follow-ups (CI smoke test on `docker compose up`, real migrations via `migrate deploy`, BETTER_AUTH_SECRET Zod-default fix)

Template:
```markdown
# Demo Mode — Handover

**Date:** YYYY-MM-DD
**Branch:** spike/demo-mode
**Commits:** <shas>

## What shipped
[list]

## Success criteria
1. `docker compose up` cold boot: [PASS with timing]
2. Warm rerun: [PASS with timing]
3. Clean-slate rerun: [PASS]
4. Dev workflow unchanged: [PASS]
5. make clean tears down both: [PASS]
6. Idempotent seed: [PASS]

## Deviations from spec
[none / list]

## Follow-ups (deferred to TODO.md)
- CI smoke test for docker compose up
- Real migrations via prisma migrate deploy
- BETTER_AUTH_SECRET Zod-default prod-safety fix
```

- [ ] **Step 4: Ready for merge**

Branch `spike/demo-mode` is complete. Merge to main via PR or fast-forward per the repo's convention.

---

## Plan self-review (completed)

- **Spec coverage**: each §Architecture subsection maps to a task (compose-layout → Task 2+8, Dockerfile → Task 6, pnpm-workspace.prod.yaml → Task 5, prisma dep → Task 4, compose services → Task 8, URL split → implicitly covered by Task 8 env vars, seed → Task 3, .dockerignore → Task 7, Makefile → Tasks 2+8, README → Task 10). Commit sequence in spec (commits 1-4 cleanups + demo) maps to Tasks 1-4 then Tasks 5-10. ✓
- **Placeholder scan**: no "TBD" / "TODO" / "add error handling" / "similar to Task N" found. ✓
- **Type consistency**: `SEED_USER` shape (`{email, password}`) consistent in `scripts/seed-credentials.ts` (Task 3 Step 1) and `scripts/seed.ts` (Task 3 Step 4). `app-image` / `app-build` / `app-env` YAML anchors referenced consistently across migrate/server/web (Task 8 Step 1). Dockerfile stage names (`base`, `deps`, `prod-deps`, `build`, `runtime`) consistent with compose `build.target` expectations (compose implicitly uses the last stage, `runtime`, when no `target` is specified). ✓
