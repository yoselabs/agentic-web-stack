# Zero-Conf Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Simplify `@project/config` + `@project/env` into a zero-conf architecture, restructure `packages/api/` to domain-split, and tighten transaction types — course-correcting the 2026-04-18 SSOT audit where it over-engineered.

**Architecture:** Zod defaults in `@project/env` absorb `@project/config`'s role. Domain constants move into their domain folders. Dev infra values (ports, DB creds) become literals in Makefile/compose/CI. Test ports become dynamic per worktree. `packages/api/src/` mirrors `apps/web/`'s FSD shape. Mutation service signatures use `Prisma.TransactionClient` to document the transaction requirement (structural subtyping means it's not compile-enforced; discipline + review still catch missed wraps).

**Tech Stack:** TanStack Start + Hono + tRPC + Prisma + Better-Auth + Zod + `@t3-oss/env-core`, pnpm workspaces.

**Design spec:** `docs/superpowers/specs/2026-04-18-zero-conf-architecture-design.md` — read first.

**Ground rules:**
- Commit after every task. Each task produces a green `make lint` + `make test-unit` + `make test` (unless explicitly noted).
- Never skip hooks (`--no-verify`).
- Never truncate lint/test output.
- Small, focused edits — if you see incidental cleanup, leave it for a follow-up commit.

---

## Task 1: Bootstrap zero-conf env defaults

**Purpose.** Make `@project/env` self-sufficient (no import from `@project/config`). Literal Zod defaults replace computed-from-config defaults. After this task, `@project/env` still imports from `@project/config` in zero files — but `@project/config` still exists and is still used elsewhere (removal happens in Task 4).

**Files:**
- Modify: `packages/env/src/server.ts`
- Modify: `packages/env/src/client.ts`
- Modify: `packages/api/vitest.config.ts` (drops `@project/config/ports` import too — literal URLs)

**Steps:**

- [ ] **Step 1: Rewrite `packages/env/src/server.ts` with literal defaults**

```ts
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

// Runtime env vars for server / node code. Defaults are for zero-conf dev only.
// Prod deployments set every value externally; defaults never fire in prod.
//
// NEVER add client-safe vars here. Those belong in client.ts.
// NEVER read process.env outside this module (enforced by `make lint` grep).

export const env = createEnv({
  server: {
    DATABASE_URL: z
      .string()
      .url()
      .default("postgresql://postgres:postgres@localhost:5432/app"),
    CORS_ORIGIN: z.string().url().default("http://localhost:3000"),
    BETTER_AUTH_SECRET: z
      .string()
      .min(32)
      .default("change-me-to-a-random-32-char-secret-key"),
    BETTER_AUTH_URL: z.string().url().default("http://localhost:3001"),
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),
    PORT: z.coerce.number().default(3001),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace"])
      .optional(),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
```

- [ ] **Step 2: Rewrite `packages/env/src/client.ts` with literal default**

```ts
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

// Client-side env vars. Only VITE_ prefixed vars are safe to ship.
// Default is for zero-conf dev. Prod build always injects VITE_API_URL
// at build time (set by the CI / deployment pipeline).

const viteEnv = (
  import.meta as unknown as { env?: Record<string, string | undefined> }
).env;

export const env = createEnv({
  clientPrefix: "VITE_",
  client: {
    VITE_API_URL: z.string().url().default("http://localhost:3001"),
  },
  runtimeEnv: {
    VITE_API_URL: viteEnv?.VITE_API_URL ?? process.env.VITE_API_URL,
  },
  emptyStringAsUndefined: true,
});
```

- [ ] **Step 3: Update `packages/api/vitest.config.ts` to use literal URLs**

Replace the `@project/config/ports` import and the computed URLs with literals. The file currently has:

```ts
import path from "node:path";
import { DEV_API_PORT, DEV_WEB_PORT } from "@project/config/ports";
import { defineConfig } from "vitest/config";
import { testDbEnv } from "../../scripts/test-db.ts";

const env = testDbEnv("unit");
process.env.DATABASE_URL = env.TEST_DATABASE_URL;
process.env.BETTER_AUTH_SECRET =
  process.env.BETTER_AUTH_SECRET ??
  "test-secret-key-for-unit-tests-only-32chars";
process.env.CORS_ORIGIN =
  process.env.CORS_ORIGIN ?? `http://localhost:${DEV_WEB_PORT}`;
process.env.BETTER_AUTH_URL =
  process.env.BETTER_AUTH_URL ?? `http://localhost:${DEV_API_PORT}`;
```

Replace with:

```ts
import path from "node:path";
import { defineConfig } from "vitest/config";
import { testDbEnv } from "../../scripts/test-db.ts";

const env = testDbEnv("unit");
process.env.DATABASE_URL = env.TEST_DATABASE_URL;
process.env.BETTER_AUTH_SECRET =
  process.env.BETTER_AUTH_SECRET ??
  "test-secret-key-for-unit-tests-only-32chars";
process.env.CORS_ORIGIN = process.env.CORS_ORIGIN ?? "http://localhost:3000";
process.env.BETTER_AUTH_URL =
  process.env.BETTER_AUTH_URL ?? "http://localhost:3001";
```

Also update the `test.env` block further down in the same file — replace the template literals with the same literal URLs:

```ts
    env: {
      DATABASE_URL: env.TEST_DATABASE_URL,
      BETTER_AUTH_SECRET: "test-secret-key-for-unit-tests-only-32chars",
      CORS_ORIGIN: "http://localhost:3000",
      BETTER_AUTH_URL: "http://localhost:3001",
    },
```

Preserve every load-bearing comment in the file — they explain why `pool: "forks"` and the module-scope env writes exist.

- [ ] **Step 4: Run lint + unit tests to confirm no regression**

Run:
```bash
make lint
make test-unit
```
Expected: both pass. `@project/env` + vitest.config.ts no longer import from `@project/config`. The config package still compiles (other consumers remain until Task 4).

- [ ] **Step 5: Commit**

```bash
git add packages/env/src/server.ts packages/env/src/client.ts packages/api/vitest.config.ts
git commit -m "$(cat <<'EOF'
refactor(env): inline dev defaults in @project/env, drop @project/config dep

First of an 8-step zero-conf refactor. Zod schemas now own dev defaults directly
as literals; the env package and vitest.config no longer reach into @project/config
for port numbers. Subsequent tasks delete the config package entirely.
EOF
)"
```

---

## Task 2: Relocate domain constants (and inline mount paths)

**Purpose.** Move `MAX_UPLOAD_BYTES`, `MIN_PASSWORD_LENGTH`, `TRPC_MOUNT`, and `AUTH_MOUNT` out of `@project/config` into domain-owning files (or inline them where ≤2 call sites exist). After this task, `@project/config` is unused everywhere except the generator scripts and test-db.ts (still importing `TEST_DB_NAME`) — Task 4 finishes the removal.

Note: `MAX_UPLOAD_BYTES` goes to a temporary location `packages/api/src/constants/todo.ts`. Task 6 moves it into the final domain folder (`packages/api/src/domains/todo/constants.ts`). Splitting the move across two tasks keeps each commit clean.

**Files:**
- Create: `packages/auth/src/constants.ts`
- Create: `packages/api/src/constants/todo.ts` (temporary — moved in Task 6)
- Modify: `packages/auth/package.json` (add `./constants` export)
- Modify: `packages/auth/src/index.ts` (import from own `./constants.js`)
- Modify: `packages/api/package.json` (add `./constants/todo` export)
- Modify: `apps/server/src/index.ts` (inline mounts; import `MAX_UPLOAD_BYTES` from new location)
- Modify: `apps/web/src/router.tsx` (inline `TRPC_MOUNT`)
- Modify: `apps/web/src/features/todo/use-todos.ts` (new import path)
- Modify: `apps/web/src/routes/login.tsx` (new import path)

**Steps:**

- [ ] **Step 1: Create `packages/auth/src/constants.ts`**

```ts
// Auth domain constants. Client-safe (no runtime imports, just primitives).
// Consumed by:
// - packages/auth/src/index.ts (Better-Auth minPasswordLength)
// - apps/web/src/routes/login.tsx (HTML <input minLength>)

export const MIN_PASSWORD_LENGTH = 8;
```

- [ ] **Step 2: Add `./constants` subpath export to `packages/auth/package.json`**

Current `packages/auth/package.json` exports block (check current shape first with `Read`). Add a `./constants` entry:

```json
{
  "name": "@project/auth",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": { "default": "./src/index.ts" },
    "./constants": { "default": "./src/constants.ts" }
  },
  "dependencies": { /* unchanged */ },
  "devDependencies": { /* unchanged */ }
}
```

(If the current exports block uses a different shape — e.g., a plain string — follow its existing pattern. The goal is a `./constants` subpath that resolves to `src/constants.ts`.)

- [ ] **Step 3: Update `packages/auth/src/index.ts` to import from its own `./constants.js`**

Replace the line:
```ts
import { MIN_PASSWORD_LENGTH } from "@project/config/limits";
```
with:
```ts
import { MIN_PASSWORD_LENGTH } from "./constants.js";
```

- [ ] **Step 4: Create `packages/api/src/constants/todo.ts` (temporary location)**

```ts
// Todo domain constants. Client-safe primitives only — never import
// server modules (services, Prisma) from this file; if you do, the
// web bundle will silently pull in server code.
//
// Consumed by:
// - apps/server/src/index.ts (upload size enforcement)
// - apps/web/src/features/todo/use-todos.ts (client-side pre-flight)
//
// NOTE: this file moves to packages/api/src/domains/todo/constants.ts
// in the API domain-split refactor (see superpowers/plans/...-zero-conf...).

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB
```

- [ ] **Step 5: Update `packages/api/package.json` — add `./constants/todo` subpath, keep existing exports**

Add a new entry to the `exports` block (preserve the existing `./router`, `./context`, `./services/todo` entries; Task 6 revises them):

```json
{
  "name": "@project/api",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    "./router": { "default": "./src/router.ts" },
    "./context": { "default": "./src/context.ts" },
    "./services/todo": { "default": "./src/services/todo.ts" },
    "./constants/todo": { "default": "./src/constants/todo.ts" }
  },
  "scripts": { /* unchanged */ },
  "dependencies": { /* unchanged */ },
  "devDependencies": { /* unchanged */ }
}
```

- [ ] **Step 6: Update `apps/server/src/index.ts` — inline mounts + new constants path**

Replace the two `@project/config` imports:
```ts
import { AUTH_MOUNT, TRPC_MOUNT } from "@project/config/api-paths";
import { MAX_UPLOAD_BYTES } from "@project/config/limits";
```
with:
```ts
import { MAX_UPLOAD_BYTES } from "@project/api/constants/todo";
```

Then find the two usages of `AUTH_MOUNT` and `TRPC_MOUNT` in this file and inline them:

```ts
// Better-Auth handler
app.on(["POST", "GET"], "/api/auth/**", (c) => {
  return auth.handler(c.req.raw);
});
```

```ts
// tRPC handler — pass session into context
app.use(
  "/trpc/*",
  trpcServer({
    router: appRouter,
    createContext: async (_opts, c) => {
      const session = await auth.api.getSession({
        headers: c.req.raw.headers,
      });
      return createContext({ session });
    },
  }),
);
```

Leave all other code in the file unchanged.

- [ ] **Step 7: Update `apps/web/src/router.tsx` — inline `TRPC_MOUNT`**

Read the current file. Remove:
```ts
import { TRPC_MOUNT } from "@project/config/api-paths";
```

Then inline any use of `TRPC_MOUNT` as the literal string `"/trpc"` — typically a base URL concat:

```ts
// Before:
url: `${apiClient.baseUrl}${TRPC_MOUNT}`,
// After:
url: `${apiClient.baseUrl}/trpc`,
```

(The exact usage site may differ slightly; search for `TRPC_MOUNT` in that file and replace every occurrence with the literal `"/trpc"`. The leading slash is part of the literal.)

- [ ] **Step 8: Update `apps/web/src/features/todo/use-todos.ts`**

Replace:
```ts
import { MAX_UPLOAD_BYTES } from "@project/config/limits";
```
with:
```ts
import { MAX_UPLOAD_BYTES } from "@project/api/constants/todo";
```

Leave the rest of the file unchanged.

- [ ] **Step 9: Update `apps/web/src/routes/login.tsx`**

Replace:
```ts
import { MIN_PASSWORD_LENGTH } from "@project/config/limits";
```
with:
```ts
import { MIN_PASSWORD_LENGTH } from "@project/auth/constants";
```

Leave the rest of the file unchanged.

- [ ] **Step 10: Run lint + both test suites to confirm**

Run:
```bash
make lint
make test-unit
make test
```

Expected: all three pass. `MAX_UPLOAD_BYTES` still enforces 10 MB on upload; `MIN_PASSWORD_LENGTH` still enforces 8 chars in the login form and Better-Auth; `/api/auth/**` and `/trpc/*` routes still function.

- [ ] **Step 11: Commit**

```bash
git add packages/auth/src/constants.ts packages/auth/package.json packages/auth/src/index.ts \
  packages/api/src/constants/todo.ts packages/api/package.json \
  apps/server/src/index.ts apps/web/src/router.tsx \
  apps/web/src/features/todo/use-todos.ts apps/web/src/routes/login.tsx
git commit -m "$(cat <<'EOF'
refactor(constants): relocate domain rules to owning packages, inline mounts

MIN_PASSWORD_LENGTH → @project/auth/constants (auth owns it).
MAX_UPLOAD_BYTES → @project/api/constants/todo (temporary; Task 6 moves to
domains/todo/). TRPC_MOUNT / AUTH_MOUNT inlined at their ≤2 call sites.

@project/config still exists after this commit — removed in Task 4 once every
consumer is migrated.
EOF
)"
```

---

## Task 3: Hardcode dev infra values in Make / Docker / CI / .env.example

**Purpose.** Dev ports, DB name (`app`), user (`postgres`), password (`postgres`) become literals in infra files. No more `${DEV_DB_PORT}` substitutions, no more `CONFIG_SH` sourcing. `.env.example` becomes hand-maintained.

After this task, `Makefile` and `docker-compose.yml` stop depending on `scripts/export-config.ts`. The script still exists (Task 4 deletes it) but is unused.

**Files:**
- Modify: `docker-compose.yml`
- Modify: `Makefile`
- Modify: `.github/workflows/ci.yml`
- Modify: `.env.example`
- Modify: `packages/db/.env.example`

**Steps:**

- [ ] **Step 1: Rewrite `docker-compose.yml` with literal values**

```yaml
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

- [ ] **Step 2: Rewrite `Makefile` without `CONFIG_SH` dance**

Replace the full `Makefile` with the following. Every target that previously sourced `$(CONFIG_SH)` now uses literal values. Test ports stay handled by `scripts/test-db.ts` + `scripts/kill-ports.ts` — but after Task 5, kill-ports for tests will be passed dynamic values. For now, the old static 3100/3101 still work because the test-db.ts extension hasn't landed yet.

```makefile
.PHONY: setup dev db db-push db-generate db-studio db-seed check lint fix test test-ui test-unit clean routes

# Zero-conf setup: clone → make setup → make dev
# .env file is NOT required — @project/env has Zod defaults for every dev var.
# .env.example is only a reference for prod deployments.
setup:
	pnpm install
	docker compose up -d
	@echo "Waiting for Postgres..."
	@until docker compose exec -T postgres pg_isready -U postgres > /dev/null 2>&1; do sleep 1; done
	pnpm -w run db:push
	$(MAKE) routes
	prek install
	@echo "✓ Ready. Run 'make dev' to start."

# Regenerate route tree (no dev server needed)
routes:
	@echo "Generating route tree..."
	@pnpm exec tsx scripts/generate-routes.ts

# Start both web and server
dev: db-generate
	@pnpm exec tsx scripts/kill-ports.ts 3000 3001
	pnpm -w run dev

# Database
db:
	docker compose up -d
db-push:
	pnpm -w run db:push
db-generate:
	pnpm -w run db:generate
db-studio:
	pnpm -w run db:studio
db-seed:
	pnpm -w run db:seed

# Quality gates
check: lint
lint: db-generate
	@agent-harness lint
	pnpm -w run typecheck
	@! rg 'process\.env\.' --type ts \
	    -g '!packages/env/**' -g '!scripts/**' \
	    -g '!**/vite.config.ts' -g '!**/vitest.config.ts' -g '!**/test-setup.ts' \
	    -g '!**/playwright.config.ts' \
	    -g '!node_modules' -g '!**/*.gen.*' \
	  || (echo "FAIL: process.env.X read outside @project/env — use env from @project/env/server or /client" && exit 1)
fix: db-generate
	@agent-harness fix
	pnpm -w run typecheck

# Unit / integration tests (vitest, isolated unit-suite Postgres via scripts/test-db.ts)
test-unit: db-generate
	pnpm --filter @project/api test

# BDD Tests (separate test database, dynamic port per suite via scripts/test-db.ts)
#
# Full suite:     make test
# Filtered run:   make test ARGS="--grep 'Create a todo'"
#                 make test ARGS="--project desktop"
#                 make test ARGS="--headed"
# ARGS forwarded to `playwright test` verbatim. See `playwright test --help`.
test: db-generate
	@pnpm exec tsx scripts/kill-ports.ts 3100 3101
	cd e2e && pnpm exec bddgen && pnpm exec playwright test $(ARGS)
test-ui: db-generate
	@pnpm exec tsx scripts/kill-ports.ts 3100 3101
	cd e2e && pnpm exec bddgen && pnpm exec playwright test --ui $(ARGS)

# Cleanup
clean:
	docker compose down -v
	@ids=$$(docker ps -aq --filter "name=agentic-postgres-test-" --filter "name=agentic-postgres-e2e-" --filter "name=agentic-postgres-unit-"); \
	  [ -n "$$ids" ] && docker rm -f $$ids || true
	rm -rf node_modules apps/*/node_modules packages/*/node_modules
	rm -rf apps/web/.output apps/web/dist apps/server/dist
```

Note: Task 5 updates the `test` / `test-ui` kill-ports invocations to use dynamic ports. For now, 3100/3101 still match the static ports used in `e2e/playwright.config.ts`.

Also note: `make setup` no longer copies `.env.example` to `.env`. Zero-conf boot doesn't need a `.env` file.

- [ ] **Step 3: Simplify `.github/workflows/ci.yml` — no export-config, literal env**

Rewrite `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  check:
    name: Lint & Typecheck
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm -w run lint
      - run: pnpm -w run typecheck

  test:
    name: Integration & BDD Tests
    runs-on: ubuntu-latest
    needs: check
    # No Postgres service container: both test suites provision their own
    # per-suite containers via scripts/test-db.ts. ubuntu-latest has Docker + Compose.
    env:
      BETTER_AUTH_SECRET: test-secret-key-for-ci-tests-only-32chars
      # Static test ports used by playwright.config.ts and vitest until Task 5
      # makes them dynamic per-worktree via scripts/test-db.ts.
      CORS_ORIGIN: http://localhost:3100
      BETTER_AUTH_URL: http://localhost:3101
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @project/api test
      - run: pnpm exec playwright install chromium --with-deps
      - run: cd e2e && pnpm exec bddgen && pnpm exec playwright test
```

Task 5 revises the `CORS_ORIGIN` / `BETTER_AUTH_URL` env block to use dynamic ports. For now, matching static 3100/3101.

- [ ] **Step 4: Rewrite `.env.example` as a hand-maintained prod-deploy doc**

```bash
# .env.example — prod deployment reference
#
# This file is NOT required for local dev. The @project/env package has Zod
# defaults for every variable — missing values fall back to dev-safe defaults.
# Create a local .env ONLY to override a default (e.g., a different dev port).
#
# For production deploys, set every variable below in your deployment platform
# (Dokploy, Docker secrets, GitHub Actions secrets, etc.). Defaults listed in
# this file are DEV-ONLY and MUST NOT be used in production.

# Database connection. Prod: use the managed-Postgres connection string.
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/app"

# Better-Auth signing secret. 32+ chars. Prod: generate a random value, never
# reuse across environments. Dev default is literally "change-me-...-key".
BETTER_AUTH_SECRET="change-me-to-a-random-32-char-secret-key"

# Canonical URL the Better-Auth client uses for requests. Must match the
# server's public origin.
BETTER_AUTH_URL="http://localhost:3001"

# Allowed origin for CORS + CSP. Must match the web app's public origin.
CORS_ORIGIN="http://localhost:3000"

# Client-side: base URL for tRPC + auth calls from the browser.
# For prod, set VITE_API_URL at BUILD time (not runtime) — Vite inlines it.
VITE_API_URL="http://localhost:3001"
```

- [ ] **Step 5: Rewrite `packages/db/.env.example`**

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/app"
```

- [ ] **Step 6: Verify** — dev stack still boots

Run:
```bash
docker compose down
docker compose up -d
# Wait for healthy
docker compose exec postgres pg_isready -U postgres
# Expected: accepting connections
make lint
make test-unit
make test
```

Expected: all pass. The Postgres container now uses literal `app` / `postgres` / `postgres`. If any test or service still expects `agentic_web_stack` as the DB name, it'll fail loudly — chase it down.

Known touch points where the old DB name might linger:
- `packages/config/src/db.ts` (`DEV_DB_NAME = "agentic_web_stack"`) — still exists, removed in Task 4. No runtime effect after this task because no consumer uses it.
- `scripts/generate-env-example.ts` — still exists, not executed, removed in Task 4.

If the dev Postgres volume was previously seeded under the old `agentic_web_stack` database, `docker compose up` on the renamed DB will see an empty database (the volume persists but the DB inside it is a different name). Run `make db-push` if needed. This is a one-time dev-machine cost, not a production concern.

- [ ] **Step 7: Commit**

```bash
git add docker-compose.yml Makefile .github/workflows/ci.yml .env.example packages/db/.env.example
git commit -m "$(cat <<'EOF'
refactor(infra): hardcode dev ports / DB creds, standardize on 'app' DB

docker-compose.yml, Makefile, and CI workflow now use literal 3000/3001/5432
and 'app'/'postgres'/'postgres'. CONFIG_SH sourcing dance removed. .env.example
is now a hand-maintained prod-deploy reference; make setup no longer copies it.

Dev ports have not changed in this codebase's lifetime and won't — literal is
the honest representation of a constants-forever value.
EOF
)"
```

---

## Task 4: Delete `@project/config` and generator scripts

**Purpose.** Remove the now-unused package and its two generator scripts. Migrate the last consumer — `scripts/test-db.ts` — which still imports `TEST_DB_NAME`.

**Files:**
- Modify: `scripts/test-db.ts` (inline `TEST_DB_NAME = "app"`)
- Delete: `scripts/export-config.ts`
- Delete: `scripts/generate-env-example.ts`
- Delete: `packages/config/` (entire directory)
- Modify: every `package.json` that lists `@project/config` as a dependency (remove the entry)
- Modify: root `package.json` if it lists `@project/config` (remove)
- Regenerate: `pnpm-lock.yaml` (via `pnpm install`)

**Steps:**

- [ ] **Step 1: Inline `TEST_DB_NAME = "app"` in `scripts/test-db.ts`**

Replace the line:
```ts
import { TEST_DB_NAME } from "@project/config/db";
```
with:
```ts
// Standardized DB name for dev + test (different containers, different ports).
// See docs/superpowers/specs/2026-04-18-zero-conf-architecture-design.md §D2.
const TEST_DB_NAME = "app";
```

Leave the rest of the file unchanged — `TEST_DB_NAME` continues to be referenced by the returned `TEST_DATABASE_URL` template and by the compose env injection. No callers change.

- [ ] **Step 2: Delete `scripts/export-config.ts`**

```bash
rm scripts/export-config.ts
```

- [ ] **Step 3: Delete `scripts/generate-env-example.ts`**

```bash
rm scripts/generate-env-example.ts
```

- [ ] **Step 4: Delete `packages/config/` directory**

```bash
rm -rf packages/config
```

- [ ] **Step 5: Remove `@project/config` dependency from every `package.json`**

Consumers (from an earlier grep): `apps/server/package.json`, `apps/web/package.json`, `packages/api/package.json`, `packages/auth/package.json`, `packages/env/package.json`, `e2e/package.json`, root `package.json`.

For each file, delete the line:
```json
"@project/config": "workspace:*",
```

Exact example for `packages/env/package.json` — before:
```json
{
  "name": "@project/env",
  ...
  "dependencies": {
    "@project/config": "workspace:*",
    "@t3-oss/env-core": "catalog:",
    "zod": "catalog:"
  },
  ...
}
```
After:
```json
{
  "name": "@project/env",
  ...
  "dependencies": {
    "@t3-oss/env-core": "catalog:",
    "zod": "catalog:"
  },
  ...
}
```

Repeat for each listed `package.json`.

- [ ] **Step 6: Update lockfile**

```bash
pnpm install
```

Expected: `pnpm-lock.yaml` regenerates without any `@project/config` entries. Install succeeds.

- [ ] **Step 7: Verify nothing references the deleted package**

```bash
rg "@project/config" --type ts --type tsx --type json --type yaml -g '!pnpm-lock.yaml' -g '!node_modules'
```
Expected: zero matches (lockfile already regenerated; if a TOML/MD doc mentions it in history that's fine — only code references matter).

- [ ] **Step 8: Run full quality gate**

```bash
make lint
make test-unit
make test
```

Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
refactor(config): delete @project/config + generator scripts

The package and its two shell-bridge scripts (export-config.ts, generate-env-
example.ts) exist to propagate TS constants to Make/Docker/CI. With Tasks 1-3
there are no TS constants left to propagate: runtime env is Zod-defaulted in
@project/env, domain rules live in their domains, infra ports are literal.

TEST_DB_NAME inlined as "app" in scripts/test-db.ts — last consumer.
EOF
)"
```

---

## Task 5: Dynamic test ports in `scripts/test-db.ts`

**Purpose.** `testDbEnv()` grows two new return values — `TEST_WEB_PORT`, `TEST_API_PORT` — computed per worktree. Consumers (`e2e/test-env.ts`, `e2e/playwright.config.ts`, Makefile, CI) read them. Fixes the parallel-worktree collision on static 3100/3101.

**Files:**
- Modify: `scripts/test-db.ts` (add dynamic port outputs)
- Modify: `e2e/test-env.ts` (re-export new fields)
- Modify: `e2e/playwright.config.ts` (import from `test-env.ts`)
- Modify: `docker-compose.test.yml` (hardcode `POSTGRES_DB: app`; TEST_PORT/TEST_CONTAINER stay dynamic)
- Modify: `Makefile` (compute test ports via tsx one-liner for kill-ports)
- Modify: `.github/workflows/ci.yml` (compute test ports via tsx one-liner)
- Create: `scripts/print-test-env.ts` (tiny wrapper — prints `TEST_WEB_PORT=... TEST_API_PORT=...`)

**Steps:**

- [ ] **Step 1: Extend `scripts/test-db.ts` with port-offset computation and new return fields**

Current file has the port offset and DB port computed. Add the web/API port bases and return them.

In `testDbEnv()`, replace the port computation block:
```ts
const hash = createHash("md5").update(PROJECT_ROOT).digest("hex");
const hash8 = hash.slice(0, 8);
const portOffset = Number.parseInt(hash.slice(0, 4), 16) % 100;
const portBase = suite === "e2e" ? 5400 : 5500;
const port = portBase + portOffset;
const container = `agentic-postgres-${suite}-${hash8}`;
return {
  TEST_PORT: port,
  TEST_CONTAINER: container,
  TEST_DB_NAME,
  TEST_DATABASE_URL: `postgresql://postgres:postgres@localhost:${port}/${TEST_DB_NAME}`,
  PROJECT_ROOT,
};
```

With:
```ts
const hash = createHash("md5").update(PROJECT_ROOT).digest("hex");
const hash8 = hash.slice(0, 8);
const portOffset = Number.parseInt(hash.slice(0, 4), 16) % 100;
const dbPortBase = suite === "e2e" ? 5400 : 5500;
const webPortBase = suite === "e2e" ? 3100 : 3300;
const apiPortBase = suite === "e2e" ? 3200 : 3400;
const port = dbPortBase + portOffset;
const webPort = webPortBase + portOffset;
const apiPort = apiPortBase + portOffset;
const container = `agentic-postgres-${suite}-${hash8}`;
return {
  TEST_PORT: port,
  TEST_WEB_PORT: webPort,
  TEST_API_PORT: apiPort,
  TEST_CONTAINER: container,
  TEST_DB_NAME,
  TEST_DATABASE_URL: `postgresql://postgres:postgres@localhost:${port}/${TEST_DB_NAME}`,
  PROJECT_ROOT,
};
```

Keep the existing comment about birthday-paradox collisions on the port-offset modulo.

- [ ] **Step 2: Re-export new fields in `e2e/test-env.ts`**

Rewrite `e2e/test-env.ts`:

```ts
import { testDbEnv } from "../scripts/test-db.ts";

const env = testDbEnv("e2e");
export const TEST_PORT = env.TEST_PORT;
export const TEST_WEB_PORT = env.TEST_WEB_PORT;
export const TEST_API_PORT = env.TEST_API_PORT;
export const TEST_CONTAINER = env.TEST_CONTAINER;
export const TEST_DB_NAME = env.TEST_DB_NAME;
export const TEST_DATABASE_URL = env.TEST_DATABASE_URL;
export const PROJECT_ROOT = env.PROJECT_ROOT;
```

- [ ] **Step 3: Update `e2e/playwright.config.ts` — import ports from `test-env.ts`, not `@project/config`**

The current file has:
```ts
import { defineConfig } from "@playwright/test";
import { TEST_API_PORT, TEST_WEB_PORT } from "@project/config/ports";
import { defineBddConfig } from "playwright-bdd";

import { TEST_DATABASE_URL } from "./test-env.js";
```

Replace with:
```ts
import { defineConfig } from "@playwright/test";
import { defineBddConfig } from "playwright-bdd";

import { TEST_API_PORT, TEST_DATABASE_URL, TEST_WEB_PORT } from "./test-env.js";
```

(The `@project/config/ports` import would already be broken after Task 4 if not fixed here — this step resolves it. The reason it isn't caught earlier: Task 4's verification step in its own lint run catches it. If it does surface before this task, a temporary fix is acceptable.)

Wait — this is a real ordering issue. After Task 4 deletes `@project/config`, `e2e/playwright.config.ts` still imports from it and fails. Task 4's verification step (`make test`) would fail.

Fix: include the playwright.config.ts update as part of Task 4's migration, using literal `3100` / `3101` for now, then Task 5 replaces with dynamic values. Apply this as a corrective addendum:

**Corrective addendum for Task 4:** As part of Task 4 Step 5 (removing `@project/config` deps), also update `e2e/playwright.config.ts`:
- Remove: `import { TEST_API_PORT, TEST_WEB_PORT } from "@project/config/ports";`
- Add inline:
  ```ts
  // Static 3100/3101 until Task 5 makes test ports dynamic per worktree.
  const TEST_WEB_PORT = 3100;
  const TEST_API_PORT = 3101;
  ```

Then Task 5 Step 3 replaces that block with the import from `./test-env.js` as shown above.

Apply the corrective now (retroactively add to Task 4's file list: `e2e/playwright.config.ts`). Verify `make test` passed for Task 4 by making sure this addendum was applied before committing Task 4.

Resuming Task 5 Step 3: replace the literal `const TEST_WEB_PORT = 3100;` block with the import from `./test-env.js`.

- [ ] **Step 4: `docker-compose.test.yml` — hardcode `POSTGRES_DB: app`**

Current file interpolates `TEST_DB_NAME` — since Task 4 inlined it as `"app"` in test-db.ts, the compose env injection passes `TEST_DB_NAME=app`. Simplify by hardcoding:

```yaml
name: agentic-web-stack-test

services:
  postgres:
    image: postgres:17
    # TEST_CONTAINER, TEST_PORT are supplied by scripts/test-db.ts per
    # worktree — not optional. Compose fails loudly if either is unset.
    container_name: ${TEST_CONTAINER}
    environment:
      POSTGRES_DB: app
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    ports:
      - "${TEST_PORT}:5432"
    tmpfs:
      - /var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 1s
      timeout: 1s
      retries: 15
```

Also update `scripts/test-db.ts` `composeEnv` block to drop `TEST_DB_NAME` (no longer consumed by compose after the hardcode):

Current:
```ts
const composeEnv = {
  ...process.env,
  TEST_PORT: String(TEST_PORT),
  TEST_CONTAINER,
  TEST_DB_NAME: dbName,
};
```
New:
```ts
const composeEnv = {
  ...process.env,
  TEST_PORT: String(TEST_PORT),
  TEST_CONTAINER,
};
```

- [ ] **Step 5: Add `scripts/print-test-env.ts` — a tiny wrapper for Makefile / CI**

```ts
// Prints TEST_WEB_PORT=... TEST_API_PORT=... as shell-sourceable lines,
// one per arg. Consumers:
// - Makefile `test` / `test-ui` targets — sourced to pass to kill-ports.
// - .github/workflows/ci.yml — piped into $GITHUB_ENV.
//
// Pass suite as first arg: `tsx scripts/print-test-env.ts e2e`

import { testDbEnv, type TestSuite } from "./test-db.ts";

const suite = (process.argv[2] ?? "e2e") as TestSuite;
if (suite !== "e2e" && suite !== "unit") {
  console.error(`Invalid suite: ${suite}. Expected "e2e" or "unit".`);
  process.exit(1);
}

const env = testDbEnv(suite);
console.log(`TEST_WEB_PORT=${env.TEST_WEB_PORT}`);
console.log(`TEST_API_PORT=${env.TEST_API_PORT}`);
```

- [ ] **Step 6: Update `Makefile` to use dynamic test ports**

Replace the `test` and `test-ui` targets:

```makefile
# BDD Tests
test: db-generate
	@eval "$$(pnpm exec tsx scripts/print-test-env.ts e2e)" && \
	  pnpm exec tsx scripts/kill-ports.ts $$TEST_WEB_PORT $$TEST_API_PORT
	cd e2e && pnpm exec bddgen && pnpm exec playwright test $(ARGS)
test-ui: db-generate
	@eval "$$(pnpm exec tsx scripts/print-test-env.ts e2e)" && \
	  pnpm exec tsx scripts/kill-ports.ts $$TEST_WEB_PORT $$TEST_API_PORT
	cd e2e && pnpm exec bddgen && pnpm exec playwright test --ui $(ARGS)
```

The `make dev` target keeps its literal `3000 3001` — dev is not dynamic.

- [ ] **Step 7: Update `.github/workflows/ci.yml` to source test env**

Replace the `test` job's `env:` block + add a step that promotes the computed ports to `$GITHUB_ENV`:

```yaml
  test:
    name: Integration & BDD Tests
    runs-on: ubuntu-latest
    needs: check
    env:
      BETTER_AUTH_SECRET: test-secret-key-for-ci-tests-only-32chars
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - name: Compute dynamic test ports
        run: |
          pnpm exec tsx scripts/print-test-env.ts e2e >> "$GITHUB_ENV"
      - name: Promote CORS / auth URLs to workflow env
        run: |
          echo "CORS_ORIGIN=http://localhost:${TEST_WEB_PORT}" >> "$GITHUB_ENV"
          echo "BETTER_AUTH_URL=http://localhost:${TEST_API_PORT}" >> "$GITHUB_ENV"
      - run: pnpm --filter @project/api test
      - run: pnpm exec playwright install chromium --with-deps
      - run: cd e2e && pnpm exec bddgen && pnpm exec playwright test
```

- [ ] **Step 8: Verify — run both test suites; check parallel isolation in principle**

```bash
make test-unit
make test
```

Expected: both pass. Container name is `agentic-postgres-e2e-<hash8>`, DB port is `5400+offset`, web/API ports are `3100+offset` / `3200+offset` — check via `docker ps` and playwright output. Dev server still runs on 3000/3001.

Optional manual parallel check (if you have a second worktree):
```bash
# In worktree A
make test &
# In worktree B (different directory → different hash)
make test &
wait
```
Expected: both pass, no port collision.

- [ ] **Step 9: Commit**

```bash
git add scripts/test-db.ts scripts/print-test-env.ts e2e/test-env.ts e2e/playwright.config.ts \
  docker-compose.test.yml Makefile .github/workflows/ci.yml
git commit -m "$(cat <<'EOF'
perf(test): dynamic test web/API ports per worktree — no parallel-run collision

testDbEnv() gains TEST_WEB_PORT / TEST_API_PORT alongside the already-dynamic
TEST_PORT. scripts/print-test-env.ts surfaces them to Makefile + CI via a
shell-sourceable wrapper. docker-compose.test.yml hardcodes 'app' DB name.

Two `make test` runs in two worktrees on the same host no longer race on
kill-ports for 3100/3101 — each worktree gets its own port triple.
EOF
)"
```

---

## Task 6: Restructure `packages/api/src/` to domain-split

**Purpose.** Co-locate each domain's constants, service, router, and tests in `domains/<name>/`. Matches web's FSD pattern, isolates per-agent scope, kills the `routers/` + `services/` + `__tests__/` layer spread.

**Files:**
- Create: `packages/api/src/domains/todo/constants.ts`
- Create: `packages/api/src/domains/todo/service.ts` (from old `services/todo.ts`)
- Create: `packages/api/src/domains/todo/router.ts` (from old `routers/todo.ts`)
- Create: `packages/api/src/domains/todo/__tests__/service.test.ts` (from old `services/__tests__/todo.test.ts`)
- Create: `packages/api/src/domains/todo/__tests__/router.test.ts` (from old `__tests__/todo.test.ts`)
- Create: `packages/api/src/domains/todo-list/service.ts`
- Create: `packages/api/src/domains/todo-list/router.ts`
- Create: `packages/api/src/domains/todo-list/__tests__/service.test.ts`
- Create: `packages/api/src/domains/todo-list/__tests__/router.test.ts`
- Delete: `packages/api/src/constants/todo.ts` (moved)
- Delete: `packages/api/src/constants/` (empty)
- Delete: `packages/api/src/services/` (empty after moves)
- Delete: `packages/api/src/routers/` (empty after moves)
- Delete: `packages/api/src/__tests__/` (empty after moves)
- Modify: `packages/api/src/router.ts` (new import paths)
- Modify: `packages/api/package.json` (exports block)
- Modify: `apps/server/src/index.ts` (import path for `importTodosFromCSV` / `exportTodosAsCSV`)
- Modify: `apps/web/src/features/todo/use-todos.ts` (import path for `MAX_UPLOAD_BYTES`)

**Steps:**

- [ ] **Step 1: Create `packages/api/src/domains/todo/constants.ts`**

Move the content from `packages/api/src/constants/todo.ts` (created in Task 2). Final:

```ts
// Todo domain constants. Client-safe primitives only — never import
// server modules (services, Prisma) from this file; if you do, the
// web bundle will silently pull in server code.
//
// Consumed by:
// - apps/server/src/index.ts (upload size enforcement)
// - apps/web/src/features/todo/use-todos.ts (client-side pre-flight)

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB
```

- [ ] **Step 2: Move the todo service**

```bash
mkdir -p packages/api/src/domains/todo/__tests__
git mv packages/api/src/services/todo.ts packages/api/src/domains/todo/service.ts
```

The file's contents are unchanged by the move — imports from `@project/db` are fine. Only router callers need new paths (next step).

- [ ] **Step 3: Move the todo router and update its import to `./service.js`**

```bash
git mv packages/api/src/routers/todo.ts packages/api/src/domains/todo/router.ts
```

Then edit `packages/api/src/domains/todo/router.ts`:
```ts
// Before:
import {
  completeTodo,
  createTodo,
  deleteTodo,
  listTodos,
  reorderTodos,
} from "../services/todo.js";
import { protectedProcedure, router } from "../trpc.js";

// After:
import {
  completeTodo,
  createTodo,
  deleteTodo,
  listTodos,
  reorderTodos,
} from "./service.js";
import { protectedProcedure, router } from "../../trpc.js";
```

- [ ] **Step 4: Move the service unit test**

```bash
git mv packages/api/src/services/__tests__/todo.test.ts \
  packages/api/src/domains/todo/__tests__/service.test.ts
```

Then update any relative imports inside the file from `../todo.js` → `../service.js` (and `../../trpc.js` where depth changes — the test file goes from `services/__tests__/` to `domains/todo/__tests__/`, both 2 levels below `src/`, so cross-file relative imports have the same prefix `../../`). Open the file, search for imports, adjust paths.

Expected edits inside the moved file:
```ts
// Before:
import { createTodo, /* ... */ } from "../todo.js";
// After:
import { createTodo, /* ... */ } from "../service.js";
```

Imports from `@project/db` and other workspaces are unchanged.

- [ ] **Step 5: Move the router integration test**

```bash
git mv packages/api/src/__tests__/todo.test.ts \
  packages/api/src/domains/todo/__tests__/router.test.ts
```

Update imports. This file lives in `src/__tests__/` going to `src/domains/todo/__tests__/`. Any import of `../router.js` becomes `../../../router.js`. Any import of `../routers/todo.js` becomes `../router.js`. Any import of `../trpc.js` becomes `../../../trpc.js`. Check with a focused read + edit after the move.

- [ ] **Step 6: Repeat moves for todo-list**

```bash
mkdir -p packages/api/src/domains/todo-list/__tests__
git mv packages/api/src/services/todo-list.ts packages/api/src/domains/todo-list/service.ts
git mv packages/api/src/routers/todo-list.ts packages/api/src/domains/todo-list/router.ts
git mv packages/api/src/services/__tests__/todo-list.test.ts \
  packages/api/src/domains/todo-list/__tests__/service.test.ts
git mv packages/api/src/__tests__/todo-list.test.ts \
  packages/api/src/domains/todo-list/__tests__/router.test.ts
```

Update import paths in the moved router (`../services/todo-list.js` → `./service.js`, `../trpc.js` → `../../trpc.js`) and in the tests (same depth-adjustment rule as todo).

- [ ] **Step 7: Delete the temporary constants file and empty dirs**

```bash
rm packages/api/src/constants/todo.ts
rmdir packages/api/src/constants
rmdir packages/api/src/services/__tests__
rmdir packages/api/src/services
rmdir packages/api/src/routers
rmdir packages/api/src/__tests__
```

If any of these `rmdir`s fail, the dir isn't empty — chase down the remaining files (likely a hidden `index.ts` or stray file).

- [ ] **Step 8: Update `packages/api/src/router.ts` with new import paths**

```ts
import { todoListRouter } from "./domains/todo-list/router.js";
import { todoRouter } from "./domains/todo/router.js";
import { router } from "./trpc.js";

// Append-alpha convention: register sub-routers one per line in alphabetical
// order of their key. New features INSERT at the alpha position, not append
// to the bottom — so two agents adding features in parallel edit different
// lines. See packages/api/CLAUDE.md § "Adding a New Domain".
export const appRouter = router({
  todo: todoRouter,
  todoList: todoListRouter,
});

export type AppRouter = typeof appRouter;
```

Note: `todo` now comes before `todoList` alphabetically — this reorders the registrations but preserves the runtime keys.

- [ ] **Step 9: Update `packages/api/package.json` exports block**

Current:
```json
"exports": {
  "./router": { "default": "./src/router.ts" },
  "./context": { "default": "./src/context.ts" },
  "./services/todo": { "default": "./src/services/todo.ts" },
  "./constants/todo": { "default": "./src/constants/todo.ts" }
}
```

Replace with:
```json
"exports": {
  "./router": { "default": "./src/router.ts" },
  "./context": { "default": "./src/context.ts" },
  "./domains/todo/service": { "default": "./src/domains/todo/service.ts" },
  "./domains/todo/constants": { "default": "./src/domains/todo/constants.ts" },
  "./domains/todo-list/service": { "default": "./src/domains/todo-list/service.ts" }
}
```

The `todo-list` service subpath is added for symmetry — apps/server doesn't currently import todo-list service directly, but the export signals that domain-level imports are the shape.

- [ ] **Step 10: Update `apps/server/src/index.ts` service imports**

Replace:
```ts
import {
  exportTodosAsCSV,
  importTodosFromCSV,
} from "@project/api/services/todo";
```
with:
```ts
import {
  exportTodosAsCSV,
  importTodosFromCSV,
} from "@project/api/domains/todo/service";
```

- [ ] **Step 11: Update `apps/web/src/features/todo/use-todos.ts` constants import**

Replace:
```ts
import { MAX_UPLOAD_BYTES } from "@project/api/constants/todo";
```
with:
```ts
import { MAX_UPLOAD_BYTES } from "@project/api/domains/todo/constants";
```

- [ ] **Step 12: Verify**

```bash
make lint
make test-unit
make test
```

Expected: all pass. Services/routers live in their new homes; tests still reach them. tRPC routes still respond at `/trpc/todo.list`, `/trpc/todoList.list`, etc. (the router keys `todo` and `todoList` did not change — only the file locations did).

- [ ] **Step 13: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
refactor(api): domain-split packages/api/src/, mirror web FSD shape

packages/api/src/
  domains/todo/{constants,service,router,__tests__}
  domains/todo-list/{service,router,__tests__}

Replaces the layer-split routers/ + services/ + __tests__/ spread. Agents
working on a domain touch one directory. Mirrors apps/web/src/features/.

@project/api exports updated with domains/<name>/{service,constants} subpaths.
Prisma schema stays in packages/db/prisma/schema/ (tooling constraint).
EOF
)"
```

---

## Task 7: Tighten transaction types + append-alpha router docs

**Purpose.** Narrow mutation service signatures to `Prisma.TransactionClient`. The tx type documents the transaction requirement, surfaces it in hover tooltips, and matches Prisma's idiom for lock-participating functions. It is NOT compile-enforced (TS structural subtyping: PrismaClient assignable to TransactionClient) — discipline + code review still catch missed `$transaction` wraps. Also document both the invariant and the append-alpha router convention in `packages/api/CLAUDE.md`.

**Files:**
- Modify: `packages/api/src/domains/todo/service.ts` (narrow `reorderTodos`, `deleteTodo`)
- Modify: `packages/api/src/domains/todo-list/service.ts` (narrow `createTodoList`, `deleteTodoList`)
- Modify: `packages/api/CLAUDE.md` (document conventions)

**Steps:**

- [ ] **Step 1: Narrow `reorderTodos` in `packages/api/src/domains/todo/service.ts`**

```ts
// Before:
export async function reorderTodos(
  db: DbClient,
  userId: string,
  ids: string[],
) {
  const pairs = ids.map((id, i) => Prisma.sql`(${id}::text, ${i}::integer)`);
  await db.$executeRaw`...`;
}

// After:
export async function reorderTodos(
  tx: Prisma.TransactionClient,
  userId: string,
  ids: string[],
) {
  const pairs = ids.map((id, i) => Prisma.sql`(${id}::text, ${i}::integer)`);
  await tx.$executeRaw`...`;
}
```

(Replace `db` with `tx` in the parameter name and the `$executeRaw` call for consistency with other mutation helpers.)

- [ ] **Step 2: Narrow `deleteTodo` in the same file**

```ts
// Before:
export async function deleteTodo(db: DbClient, userId: string, id: string) {
  return db.todo.delete({
    where: { id, userId },
  });
}

// After:
export async function deleteTodo(
  tx: Prisma.TransactionClient,
  userId: string,
  id: string,
) {
  return tx.todo.delete({
    where: { id, userId },
  });
}
```

- [ ] **Step 3: Narrow `createTodoList` + `deleteTodoList` in `packages/api/src/domains/todo-list/service.ts`**

```ts
// Before:
export async function createTodoList(
  db: DbClient,
  userId: string,
  name: string,
  color?: string,
) {
  return db.todoList.create({
    data: { name, userId, ...(color ? { color } : {}) },
  });
}

export async function deleteTodoList(db: DbClient, userId: string, id: string) {
  const list = await db.todoList.findFirstOrThrow({
    where: { id, userId },
  });
  return db.todoList.delete({ where: { id: list.id } });
}

// After:
export async function createTodoList(
  tx: Prisma.TransactionClient,
  userId: string,
  name: string,
  color?: string,
) {
  return tx.todoList.create({
    data: { name, userId, ...(color ? { color } : {}) },
  });
}

export async function deleteTodoList(
  tx: Prisma.TransactionClient,
  userId: string,
  id: string,
) {
  const list = await tx.todoList.findFirstOrThrow({
    where: { id, userId },
  });
  return tx.todoList.delete({ where: { id: list.id } });
}
```

Note: the module needs access to the `Prisma` namespace value (for `Prisma.TransactionClient` type). Current `todo-list/service.ts` imports only types:
```ts
import type { Prisma, PrismaClient } from "@project/db";
```
Since `Prisma.TransactionClient` is used as a type annotation only (not a runtime value), `import type` remains correct — no change needed. If the rewrite breaks type inference anywhere, switch to `import { Prisma, type PrismaClient }` as `todo/service.ts` does.

- [ ] **Step 4: Verify routers still compile**

The routers in `domains/todo/router.ts` and `domains/todo-list/router.ts` already wrap every mutation in `ctx.db.$transaction((tx) => ...)` per `packages/api/CLAUDE.md`. No router edits needed — the narrow just makes the existing pattern type-enforced.

Run:
```bash
pnpm -w run typecheck
```
Expected: PASS. If any router call passes `ctx.db` directly to a now-narrowed function, the compile fails — add the `$transaction` wrap.

- [ ] **Step 5: Update `packages/api/CLAUDE.md` — tighten transaction rules + document append-alpha**

Edit the `## Transaction Rules` section. Replace:
```
- **All mutations:** router wraps in `db.$transaction((tx) => ...)` — even single-write ops, so you never forget when the service grows
- **All reads:** router calls service with `db` directly (no transaction)
- **Cross-service:** router wraps multiple service calls in one `$transaction`
- **Race conditions:** service uses `SELECT ... FOR NO KEY UPDATE` inside the tx it receives
- **Lock helpers must be typed `Prisma.TransactionClient`, never the `DbClient` union.** [...]
- Any service function that calls a lock helper must also be typed `Prisma.TransactionClient` so the invariant propagates to the caller.
```

With:
```
## Transaction Rules

- **All mutations (including read-then-write):** service function is typed `Prisma.TransactionClient`. Router wraps in `db.$transaction((tx) => ...)`. The tx type documents the requirement and surfaces it in hover tooltips + code review, but **it is NOT a compile-time guarantee** — TypeScript's structural subtyping makes `PrismaClient` assignable to `Prisma.TransactionClient` (since `TransactionClient = Omit<PrismaClient, ...>`, PrismaClient has a superset of its methods). So `createTodo(ctx.db, ...)` without a `$transaction` wrap compiles. Enforcement is by convention + code review, same as before the narrow.
- **All reads (no writes):** service is typed `DbClient` (`PrismaClient | Prisma.TransactionClient`). Router calls service with `ctx.db` directly.
- **Cross-service:** router wraps multiple service calls in one `$transaction`.
- **Race conditions:** service uses `SELECT ... FOR NO KEY UPDATE` inside the `tx` it receives.
- **Why narrow mutations anyway?** Prisma has no native `FOR UPDATE`: if the root `PrismaClient` runs a `$queryRaw` for a lock outside a transaction, the lock releases immediately — silently, with no error. The `Prisma.TransactionClient` parameter type is the idiomatic Prisma signature for lock-participating code. A narrow signature makes the intent explicit at every call site; it is not self-enforcing.
```

Then edit the `### Example: Add a posts feature` block's service snippet to reflect the new pattern (show reads with `DbClient`, writes with `Prisma.TransactionClient`):

```typescript
import { Prisma, type PrismaClient } from "@project/db";

type DbClient = PrismaClient | Prisma.TransactionClient;

// Reads — accept either.
export async function listPosts(db: DbClient, userId: string) {
  return db.post.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
}

// Writes — Prisma.TransactionClient only. Router MUST wrap in $transaction.
export async function createPost(
  tx: Prisma.TransactionClient,
  userId: string,
  title: string,
) {
  return tx.post.create({
    data: { title, userId },
  });
}
```

Also update the file layout snippet at the top of the file to reflect domain-split:
```
packages/api/src/
  domains/
    todo/
      constants.ts       # Primitives (client-safe)
      service.ts         # Business logic + Prisma queries
      router.ts          # Thin: Zod validation + $transaction → service
      __tests__/
        service.test.ts  # Service unit tests (direct function calls)
        router.test.ts   # Router integration tests (createCaller, auth guards)
  context.ts
  trpc.ts
  router.ts              # Root router — append-alpha order
```

And update the `## Adding a New Feature` section to match:
```
1. Create `src/domains/<name>/constants.ts` if the feature has client-safe primitives
2. Create `src/domains/<name>/service.ts` — business logic, mutations typed `Prisma.TransactionClient`, reads typed `DbClient`
3. Create `src/domains/<name>/__tests__/service.test.ts` — service unit tests (TDD)
4. Create `src/domains/<name>/router.ts` — thin router wiring, wrap all mutations in `ctx.db.$transaction((tx) => ...)`
5. Register in `src/router.ts` at the alphabetical position (not append-to-bottom — see Append-Alpha below)
6. Create `src/domains/<name>/__tests__/router.test.ts` for router-level tests
7. If the web app needs the constants, add the subpath to `@project/api` exports and import via `@project/api/domains/<name>/constants`
8. Run `make check` — types propagate to apps/web automatically
```

Add a new section at the end of the CLAUDE.md, before `## Do Not`:
```
## Append-Alpha Router Registration

The root `src/router.ts` lists every domain router alphabetically by key, one
per line, trailing comma always. New domains INSERT at the alpha position —
never append to the bottom.

Rationale: two agents adding features in parallel (e.g., "blog" and "comment")
edit different lines under alpha order — "blog" goes between `auth` and `todo`,
"comment" between `blog` and `todo`. Git's 3-way merge resolves these cleanly.
With append-to-bottom, both agents would edit the last line = merge conflict.

```ts
export const appRouter = router({
  blog: blogRouter,
  comment: commentRouter,
  todo: todoRouter,
  todoList: todoListRouter,
});
```
```

- [ ] **Step 6: Verify**

```bash
make lint
make test-unit
make test
```
Expected: all pass. The type-narrow doesn't change runtime behavior — every mutation was already transaction-wrapped by the router. The narrow only makes the rule compiler-enforced.

- [ ] **Step 7: Commit**

```bash
git add packages/api/src/domains/todo/service.ts \
  packages/api/src/domains/todo-list/service.ts \
  packages/api/CLAUDE.md
git commit -m "$(cat <<'EOF'
refactor(api): narrow mutation services to Prisma.TransactionClient

reorderTodos, deleteTodo, createTodoList, deleteTodoList: DbClient → Prisma.
TransactionClient. Routers already wrap each in $transaction — no runtime
change. The tx type documents the requirement and signals it in tooling;
it's not a compile-time guard (TS structural subtyping — PrismaClient
assignable to Prisma.TransactionClient). Discipline + review still catch
missed wraps.

Also documents the append-alpha router registration rule.
EOF
)"
```

---

## Task 8: Root `CLAUDE.md` + final verification + handover

**Purpose.** Update the root `CLAUDE.md` Critical Rules to reflect the new architecture. Remove obsolete Common Mistakes entries. Add new entries about zero-conf boot and domain constants. Run the full verification suite from the design spec. Write a short handover.

**Files:**
- Modify: `CLAUDE.md` (root)
- Create: `docs/superpowers/specs/2026-04-18-zero-conf-architecture-handover.md`

**Steps:**

- [ ] **Step 1: Edit root `CLAUDE.md` — Critical Rules section**

Open `CLAUDE.md` and find the SSOT bullet. Update the mechanism list to drop `@project/config` and add domain-colocation:

Current (approximate):
```
- **Single source of truth (SSOT)** ...
  - **No barrel files** — `@project/env`, `@project/config`, and `@project/api` expose named subpaths only (e.g., `@project/env/server`, `@project/config/ports`, `@project/api/router`). [...]
  - **Runtime env vars** → `@project/env` (the only module allowed to read `process.env`; `/server` and `/client` subpaths)
  - **Static constants** (ports, limits, mount paths, dev creds) → `@project/config` (`/ports`, `/db`, `/limits`, `/api-paths` subpaths)
  - **Type definitions** → infer from Prisma (`@project/db`) or tRPC (`inferRouterOutputs<AppRouter>`); never redeclare a shape that already exists
  - **Validation rules** → one Zod schema, used by both server routers and client forms
  - **Dependency versions** → `catalog:` in `pnpm-workspace.yaml`
  - **Domain constants / enums** → a single exported const; never repeat string literals like `"pending"` or `"google"` across files
```

Replace with:
```
- **Single source of truth (SSOT) — where it matters.** Values that genuinely change (domain rules, Zod schemas, Prisma types) live in exactly one place and are imported everywhere. Values that are constants-forever (dev ports, local DB creds) are literals duplicated across the 3-4 infra files that need them — SSOT prevents drift, which requires change, and these values don't change.
  - **No barrel files** — `@project/env`, `@project/api`, `@project/auth` expose named subpaths only (e.g., `@project/env/server`, `@project/api/domains/todo/service`, `@project/auth/constants`). Barrels break native Node ESM resolution, hurt tree-shaking, and can pull server code into client bundles.
  - **Runtime env vars** → `@project/env` (the only module that reads `process.env`; `/server` and `/client` subpaths). Zod defaults provide dev values so zero-conf boot works without a `.env` file.
  - **Domain constants** (upload limits, password rules, status enums) → a `constants.ts` inside the owning domain (e.g., `packages/api/src/domains/todo/constants.ts`, `packages/auth/src/constants.ts`). Client imports via the domain's subpath export.
  - **Infra constants** (dev ports `3000`/`3001`/`5432`, DB name `"app"`, user `"postgres"`) → literal in `docker-compose.yml`, `Makefile`, `.github/workflows/ci.yml`, and Zod defaults. Not in a shared package.
  - **Test infrastructure** (dynamic test DB/web/API ports per worktree) → `scripts/test-db.ts`. Consumers import `testDbEnv()`. Not in `@project/env`.
  - **Type definitions** → infer from Prisma (`@project/db`) or tRPC (`inferRouterOutputs<AppRouter>`); never redeclare a shape that already exists.
  - **Validation rules** → one Zod schema, used by both server routers and client forms.
  - **Dependency versions** → `catalog:` in `pnpm-workspace.yaml`.

  When writing new code, ask: "is this value or shape also used elsewhere?" If yes, find the owning domain/boundary and import from there. If the value genuinely never changes (a literal port number), it's OK to duplicate across 3-4 infra files.
```

- [ ] **Step 2: Edit root `CLAUDE.md` — Common Mistakes table**

Remove two rows:
- The row about `Import from @project/env, @project/config, or @project/api without a subpath` — rewrite to drop `@project/config`, keep the rule for `@project/env` / `@project/api` / `@project/auth`.
- The row about `Read process.env.X outside packages/env/` — keep as-is.

Revised row for the subpath rule:
```
| Import from `@project/env`, `@project/api`, or `@project/auth` without a subpath | There is no barrel export; the top-level path doesn't resolve. Same class of bug as `import { appRouter }` | Use subpath: `@project/env/server`, `@project/api/domains/todo/service`, `@project/auth/constants`, etc. |
```

Add two new rows:
```
| Create `.env` for dev before running `make dev` | Zero-conf: @project/env has Zod defaults for every var. A `.env` is for *overriding* defaults, not required to boot | Just run `make setup && make dev` — no `.env` needed |
| Add a shared `@project/config`-like package for dev ports | SSOT drift prevention only pays off when values change. Dev ports don't | Hardcode literals in Makefile / compose / CI + Zod default in env |
```

- [ ] **Step 3: Run the full verification suite from the design spec**

```bash
# 1. Nothing still imports from @project/config
rg "@project/config" --type ts --type tsx --type json -g '!node_modules' -g '!pnpm-lock.yaml'
# Expected: zero matches (docs referencing historical state are fine)

# 2. process.env boundary check (should already be in make lint, run standalone for clarity)
rg 'process\.env\.' --type ts \
  -g '!packages/env/**' -g '!scripts/**' \
  -g '!**/vite.config.ts' -g '!**/vitest.config.ts' -g '!**/test-setup.ts' \
  -g '!**/playwright.config.ts' \
  -g '!node_modules' -g '!**/*.gen.*'
# Expected: zero matches

# 3. No barrel imports
rg 'from "@project/(env|api|auth)"[^/]' --type ts --type tsx
# Expected: zero matches

# 4. Full quality gate
make lint
make test-unit
make test
# Expected: all pass
```

- [ ] **Step 4: Zero-conf boot smoke test**

```bash
# Stash the current .env state
mv .env .env.backup 2>/dev/null || true
mv packages/db/.env packages/db/.env.backup 2>/dev/null || true

# Simulate a fresh clone's node_modules state
rm -rf node_modules apps/*/node_modules packages/*/node_modules

# Re-install and boot
pnpm install
make setup
# Expected: make setup succeeds without creating any .env file
make dev &
DEV_PID=$!
sleep 8
# Check both servers respond
curl -sf http://localhost:3001/health | head -c 100
curl -sf http://localhost:3000/ -o /dev/null -w "%{http_code}\n"
# Expected: health returns JSON with "status":"ok"; web returns 200

# Cleanup
kill $DEV_PID 2>/dev/null
wait $DEV_PID 2>/dev/null
mv .env.backup .env 2>/dev/null || true
mv packages/db/.env.backup packages/db/.env 2>/dev/null || true
```

Document in the handover whether the smoke test passed (it should).

- [ ] **Step 5: Write the handover**

Create `docs/superpowers/specs/2026-04-18-zero-conf-architecture-handover.md`:

```markdown
# Zero-Conf Architecture — Handover

**Date:** 2026-04-18
**Branch:** `main`
**Scope:** Course-correction of the 2026-04-18 SSOT audit. 8 commits.

## What shipped

| # | Commit | Bucket | Change |
|---|---|---|---|
| 1 | `<sha1>` | env | `@project/env` Zod defaults absorb dev values; no more `@project/config` import in env |
| 2 | `<sha2>` | constants | Domain constants relocated (MIN_PASSWORD_LENGTH, MAX_UPLOAD_BYTES), mounts inlined |
| 3 | `<sha3>` | infra | Makefile / docker-compose.yml / CI hardcoded; `.env.example` hand-maintained |
| 4 | `<sha4>` | cleanup | `@project/config` + both generator scripts deleted |
| 5 | `<sha5>` | test perf | Dynamic TEST_WEB_PORT / TEST_API_PORT per worktree |
| 6 | `<sha6>` | restructure | `packages/api/src/` → `domains/{todo,todo-list}/` |
| 7 | `<sha7>` | types | Mutation services narrowed to `Prisma.TransactionClient`; append-alpha router doc |
| 8 | `<sha8>` | docs | Root CLAUDE.md updated; handover written |

(Fill in actual shas after committing.)

## Why

The 2026-04-18 SSOT audit introduced `@project/config` + shell bridge to solve a drift problem. The drift problem doesn't exist at the claimed frequency — dev ports never change. The audit paid ceremony cost without ever collecting the drift-prevention reward. This refactor retracts the over-engineered parts while keeping what earned its weight (`@project/env`, no-barrel rule, env-boundary grep).

See the design spec for the full rationale per decision: `docs/superpowers/specs/2026-04-18-zero-conf-architecture-design.md`.

## What remained from the SSOT audit

- `@project/env` (split-brain server/client, enforced via subpaths)
- Env-boundary grep in `make lint`
- No-barrel rule
- Prisma multi-file schema at `packages/db/prisma/schema/`
- Dynamic test DB port per worktree (extended to web/API ports here)

## Zero-conf contract

Clone this repo → `pnpm install && make setup && make dev` → app runs at
`http://localhost:3000` + API at `http://localhost:3001`. No `.env` file
required. Dev defaults live in `@project/env`'s Zod schemas; Docker / Make
/ CI have literal values for the dev-infra side.

Prod deploy: set every variable listed in `.env.example` in your deployment
platform. Defaults will never fire because env vars are always set.

## Known follow-ups (not addressed in this refactor)

Same list as the SSOT audit handover §6 still applies:
1. Error-message SSOT (Gherkin / server strings).
2. Better-Auth `basePath` override (AUTH_MOUNT is hardcoded upstream anyway).
3. API-level test sign-up helper (biggest remaining test-speed win).
4. `bddgen --incremental` caching.
5. Full containerized `docker compose up` demo (web + server Dockerfiles).
6. Error-rewriting `zod@4.x` transitive warning.
```

Fill in the SHAs at the end after committing.

- [ ] **Step 6: Commit final docs**

```bash
git add CLAUDE.md docs/superpowers/specs/2026-04-18-zero-conf-architecture-handover.md
git commit -m "$(cat <<'EOF'
docs: zero-conf architecture handover + updated Critical Rules

Closes the 8-commit refactor. Root CLAUDE.md now documents zero-conf boot,
domain-colocated constants, and infra-literal duplication policy. Handover
at docs/superpowers/specs/2026-04-18-zero-conf-architecture-handover.md.
EOF
)"
```

- [ ] **Step 7: Final verification — read the diff of all 8 commits and sanity-check**

```bash
git log --oneline main~8..HEAD
git diff main~8..HEAD -- packages/env packages/api packages/auth apps/server apps/web Makefile docker-compose.yml .github/workflows
```

Expected: the diff tells the story described in the handover. No dead imports, no orphan files, no references to `@project/config`.

---

## Self-Review Checklist

Run this after the plan is written (and after execution, to confirm coverage).

- [ ] **Spec coverage:** every decision D1–D9 in the design spec maps to a task step. Walk D1 → D9: D1 (Task 1), D2 (Tasks 3, 4, 5), D3 (Task 2), D4 (Task 5), D5 (Task 4), D6 (Task 3), D7 (Task 6), D8 (Task 7), D9 (Task 7). Covered.
- [ ] **Placeholder scan:** search for "TBD", "later", "figure out", "similar". Fix any found.
- [ ] **Type consistency:** `DbClient` vs `Prisma.TransactionClient` used consistently across moved files. `@project/api/domains/<name>/` subpath naming matches between `package.json` exports and consumer imports.
- [ ] **Test-gate after every task:** every task's verify step runs `make lint` + `make test-unit` + `make test`. Tasks that could leave a transient broken state (4, 6) are internally ordered so lint stays green between commits.
- [ ] **Ordering dependency:** Task 4 deletes `@project/config`. Task 4's corrective addendum updates `e2e/playwright.config.ts` before the delete so `make test` remains green. Task 5 then replaces the literal constants with imports from `test-env.ts`.
- [ ] **Zero-conf smoke:** Task 8 Step 4 explicitly tests boot with no `.env` file.
- [ ] **Every code step shows real code, not just descriptions.** Spot-check Tasks 1, 5, 6, 7 — each shows before/after where needed.

If any checkbox fails, fix inline and re-review only the affected section.
