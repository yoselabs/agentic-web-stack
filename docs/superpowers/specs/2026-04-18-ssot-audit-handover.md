# SSOT Audit — Handover

**Date:** 2026-04-18.
**Branch:** `main`.
**Scope:** 13 commits from `1bca424` (SSOT principle + audit spec) through `c8b1f24` (scoped test runs), covering the SSOT audit itself plus a follow-up perf pass on `make test`.

## What this session did

1. **Stated SSOT as a top-level architectural rule** in root `CLAUDE.md` — applies to config, types, validation, dep versions, and domain enums, not just config. No-barrel rule added alongside.
2. **Audited the monorepo** for SSOT violations — two-pass audit across six categories. Results captured in `docs/superpowers/specs/2026-04-18-config-ssot-audit-design.md`.
3. **Wrote and executed an implementation plan** — `docs/superpowers/plans/2026-04-18-config-ssot-audit.md`, 5 tasks each producing one PR-equivalent commit, with spec + code-quality review between each.
4. **Profiled and sped up `make test`** — 41s → 31s warm (~25% faster), plus added a scoped-test mechanism for tighter dev loops.

All work committed to `main` directly (template repo; no feature branch). No PR opened.

## The principle (root `CLAUDE.md`, Critical Rules)

> **Single source of truth (SSOT).** Any value, type, validation rule, or structural definition referenced in 2+ places lives in exactly one declaration; every other consumer imports it. Duplication is the failure mode, not a style preference — if you change one copy and forget the other, the app silently drifts.

Concrete mechanisms:

- **Runtime env vars** → `@project/env/server` or `@project/env/client`. Only these modules touch `process.env`. Enforced by a grep in `make lint`.
- **Static constants** (ports, limits, DB creds, mount paths) → `@project/config/{ports,db,limits,api-paths}`. No barrel.
- **Type definitions** → infer from Prisma or tRPC; never redeclare.
- **Validation rules** → one Zod schema used by server routers + client forms.
- **Dependency versions** → `catalog:` in `pnpm-workspace.yaml`.
- **Domain enums / status strings** → a single exported const; never repeat string literals across files.
- **No barrel files.** `@project/env`, `@project/config`, `@project/api` expose subpaths only.

## What shipped (13 commits)

### Phase 1 — SSOT audit (9 commits, `b23d6a2` → `f317e2a`)

| Commit | Bucket | Change |
|---|---|---|
| `b23d6a2` | plan | Implementation plan committed to `docs/superpowers/plans/`. |
| `bb3c089` | F | `pnpm-workspace.yaml` catalog: `@prisma/client`, `prisma`, `zod`, `@t3-oss/env-core`, `@types/node`, `typescript`. 8 `package.json`s rewritten to `"catalog:"`. Eliminated `@prisma/client` 6.5→6.19 and `zod` 3.24→3.25 drift. |
| `9b696b1` | E1 | `e2e/fixtures/credentials.ts` — `SHARED_PASSWORD`, `SEED_USER`, `TEST_USER`. `scripts/seed.ts` + `e2e/steps/{auth,todos}.ts` consume from fixture. |
| `54d7be0` | D | Created `@project/config` with `limits.ts` (`MAX_UPLOAD_BYTES`, `MIN_PASSWORD_LENGTH`). Web now pre-flights file size before upload; Better-Auth now enforces password min length (was client-only). |
| `c7e94a8` | A+B+E2 | The big one. `@project/config` gains `ports.ts`, `db.ts`, `api-paths.ts`. `@project/env` splits into `/server` + `/client` subpaths. All `process.env.X` reads outside `packages/env/` deleted. `scripts/export-config.ts` bridges config to Makefile + CI. `docker-compose*.yml`, `Makefile`, `playwright.config.ts`, `.github/workflows/ci.yml` all derive from config. Env-boundary grep check added to `make lint`. |
| `6f13c77` | fix | Barrel removal (`@project/config` + `@project/api`). Fixes three bugs from code review: `VITE_API_URL` missing from `.env.example`, Makefile `pg_isready -U postgres` drift, `vitest.config.ts` hardcoded ports. |
| `a17c4ca` | docs | `packages/api/CLAUDE.md` Frontend Type Contracts example updated for subpath imports. |
| `ff724f4` | C | `apps/web/src/shared/api-client.ts` — single `env.VITE_API_URL` read, one `fetch` wrapper. `router.tsx`, `auth-client.ts`, `use-todos.ts` all route through `apiClient`. |
| `9a9ca65` | polish | `apiClient` public surface narrowed to one export (was three). |
| `f317e2a` | final | `CORS_ORIGIN` / `BETTER_AUTH_URL` defaults in `packages/env/src/server.ts` now derive from `DEV_WEB_PORT` / `DEV_API_PORT` (was hardcoded). Two entries added to root `CLAUDE.md` Common Mistakes. |

### Phase 2 — test-speed pass (2 commits, `ba9c291` → `c8b1f24`)

| Commit | Change |
|---|---|
| `ba9c291` | `e2e/playwright.config.ts`: mobile project now filters `tags: "@mobile"` instead of re-running all features on the narrow viewport. Dropped `mobile-setup` DB-reset project. Desktop + mobile run fully parallel. 39 tests → 20 tests; `make test` warm: 41s → 31s. |
| `c8b1f24` | `make test ARGS="..."` forwards filters to `playwright test`. Examples in root + `e2e/CLAUDE.md`. |

## New/changed packages and modules

### `@project/config` (new — `packages/config/`)

Pure compile-time constants. No runtime, no I/O. Subpaths:

```typescript
import { DEV_DB_PORT, DEV_WEB_PORT, DEV_API_PORT, TEST_WEB_PORT, TEST_API_PORT } from "@project/config/ports";
import { DEV_DB_NAME, DEV_DB_USER, DEV_DB_PASSWORD, TEST_DB_NAME } from "@project/config/db";
import { MAX_UPLOAD_BYTES, MIN_PASSWORD_LENGTH } from "@project/config/limits";
import { TRPC_MOUNT, AUTH_MOUNT } from "@project/config/api-paths";
```

**Extending:** add a new constant to the appropriate subpath file; consumers import it. Never add a barrel at `packages/config/src/index.ts` — the no-barrel rule is enforced by convention and the `CLAUDE.md` common-mistakes table.

### `@project/env` (restructured)

Split-brain runtime env validation (`@t3-oss/env-core` + Zod). Two entry points, no barrel:

```typescript
// Server / node code:
import { env } from "@project/env/server";
// server vars: DATABASE_URL, CORS_ORIGIN, BETTER_AUTH_SECRET, BETTER_AUTH_URL, NODE_ENV, PORT, LOG_LEVEL

// Web code:
import { env } from "@project/env/client";
// client vars: VITE_API_URL
```

Attempting to access server vars from the client bundle throws at runtime. Attempting to import from `@project/env` without a subpath fails module resolution.

**Extending:** add the new var to the appropriate `src/server.ts` or `src/client.ts`; update `.env.example` by running `pnpm exec tsx scripts/generate-env-example.ts`.

### `apps/web/src/shared/api-client.ts` (new)

Single export `apiClient = { baseUrl, fetch }`. Every HTTP call from the web app routes through it:

```typescript
import { apiClient } from "#/shared/api-client";

// Non-tRPC calls:
const res = await apiClient.fetch("/api/todos/import", { method: "POST", body: formData });
const res = await apiClient.fetch(`/api/todos/export?todoListId=${id}`);

// tRPC client reads apiClient.baseUrl + TRPC_MOUNT.
// Better-Auth client reads apiClient.baseUrl.
```

`credentials: "include"` is set inside the wrapper — callers never duplicate it. Direct `fetch(...)` calls with URL literals are forbidden by `apps/web/CLAUDE.md`.

### `scripts/export-config.ts` + `scripts/generate-env-example.ts` (new)

`export-config.ts` prints every relevant value from `@project/config` as `KEY=VALUE` shell lines. Consumed by:

- `Makefile` — `CONFIG_SH := $$(pnpm exec tsx scripts/export-config.ts)`, sourced in `setup`, `dev`, `db`, `test`, `test-ui` targets.
- `.github/workflows/ci.yml` — `pnpm exec tsx scripts/export-config.ts >> "$GITHUB_ENV"` populates workflow env.

`generate-env-example.ts` rewrites `.env.example` and `packages/db/.env.example` from config. Run manually after changing dev creds/ports in config; the output is committed.

### `pnpm-workspace.yaml`

Added a `catalog:` block. Catalogued: `@prisma/client`, `prisma`, `zod`, `@t3-oss/env-core`, `@types/node`, `typescript`. Consumers reference `"catalog:"`. A new shared dep with drift risk should be added here rather than pinned per package.

## How to change something (cookbook)

| Change | Where | How |
|---|---|---|
| Dev app port (3001 → 3005) | `packages/config/src/ports.ts` | Edit `DEV_API_PORT`. Run `pnpm exec tsx scripts/generate-env-example.ts` to refresh `.env.example`. `make dev` picks it up via CONFIG_SH. |
| Test DB name | `packages/config/src/db.ts` | Edit `TEST_DB_NAME`. Compose reads `${TEST_DB_NAME}` via `scripts/test-db.ts`. |
| Max upload size | `packages/config/src/limits.ts` | Edit `MAX_UPLOAD_BYTES`. Server and client both import. |
| New env var | `packages/env/src/server.ts` or `client.ts` | Add to Zod schema. Consumers import `env.X`. Add default value or mark required. Update `.env.example` if required. |
| Upgrade `@prisma/client` | `pnpm-workspace.yaml` | Edit catalog version, run `pnpm install`. |
| New tRPC mount path | `packages/config/src/api-paths.ts` + `apps/server/src/index.ts` | Server registers `app.use(\`${NEW_MOUNT}/*\`, ...)`. Client references via `apiClient`. |
| Run a single test | — | `make test ARGS="--grep 'Create a todo'"` |

## Verification (run this to prove SSOT still holds)

All checks are in the spec's "Verification" section and most run automatically via `make lint`. Manual versions:

```bash
# No process.env outside the boundary (enforced in make lint)
rg 'process\.env\.' --type ts \
  -g '!packages/env/**' -g '!scripts/**' \
  -g '!**/vite.config.ts' -g '!**/vitest.config.ts' -g '!**/test-setup.ts' \
  -g '!**/playwright.config.ts' \
  -g '!node_modules' -g '!**/*.gen.*'
# Expected: zero matches

# No barrel imports
rg 'from "@project/(env|config|api)"[^/]' --type ts --type tsx
# Expected: zero matches (all imports specify a subpath)

# No raw fetch(http...) in web
rg 'fetch\(["`]http' apps/web/src
# Expected: zero matches

# .env.example is generator-consistent
pnpm exec tsx scripts/generate-env-example.ts && git diff .env.example packages/db/.env.example
# Expected: empty diff

# Dev port smoke test
# Edit packages/config/src/ports.ts: DEV_API_PORT = 3005
# make lint → PASS with no other file edited
# Revert

# Single-version tree
pnpm why zod           # one workspace version (4.x shows as better-auth transitive — external, expected)
pnpm why @prisma/client # one workspace version
```

`make lint` will fail if any `process.env` read appears outside the whitelist.

## Known follow-ups (not addressed in this session)

1. **Error-message SSOT.** Strings like `"File too large (max 10 MB)"` appear verbatim in `apps/server/src/index.ts` and in `e2e/features/*.feature` / `e2e/steps/todos.ts`. Fixing requires either server-side message export (imported by steps) or regex-matching in Gherkin. Scoped out of this pass; separate spec recommended.
2. **Better-Auth `/api/auth` is hardcoded inside Better-Auth itself.** `AUTH_MOUNT = "/api/auth"` lives in `@project/config/api-paths.ts` and the Hono mount uses it, but Better-Auth's internal client assumes `/api/auth` regardless. Changing the mount means a Better-Auth `basePath` override — out of scope here.
3. **API-level test sign-up helper (`/api/auth/sign-up/email`).** Would drop the ~1.5s-per-test UI sign-up ritual and reduce the critical path for the "private to each user" scenarios (currently ~3.5s). Expected further gain: ~5-8s on `make test`. Lowest-hanging remaining perf win.
4. **bddgen regenerates from scratch.** No `--incremental` flag; ~1-2s overhead per run. Could be cached on feature-file hash. Marginal.
5. **Zero-conf `docker compose up` demo.** Currently `make setup && make dev` is the two-step onboarding. The raised vision: clone repo, run `docker compose up`, app is live. Requires containerizing web + server (multi-stage Dockerfiles) and wiring them into `docker-compose.yml`. Separate bucket; worth its own spec.
6. **Seed password silently changed.** `scripts/seed.ts` used `"password123"` before this session, now uses `SEED_USER.password = "testpassword123"`. Existing dev databases still have the old hash. Developers with seeded data need to drop + re-seed. Low priority; affects only those who seeded before 2026-04-18.
7. **Cataloged dep set is partial on purpose.** `better-auth`, `@trpc/*`, `@tanstack/*` not catalogued. Current values are consistent, so no drift risk today; add to catalog if/when a second consumer appears with a different version.
8. **`zod@4.x` transitive.** better-auth internally uses `zod@4.3.6`. External to the workspace, not a drift problem, but worth noting when reading `pnpm why zod` output.
9. **Agent-harness custom lint rule (vs. the current Makefile grep).** The env-boundary check is a bash `rg | exit 1` idiom in `Makefile`. An agent-harness rule would integrate better with the rest of the harness. Research task if agent-harness supports custom rules.

## Test speed baseline for reference

- **Baseline (pre-session):** `make test` = 41s warm, 39 scenarios (18 desktop + 20 mobile + 1 db-reset setup).
- **After mobile-filter fix (`ba9c291`):** `make test` = 31s warm, 20 scenarios.
- **Critical path** is now the slowest single scenario (~3.5s, "Todos are private to each user" — two sequential UI sign-ups). An API-level sign-up helper would drop this.
- **Scoped run** (`make test ARGS="--project desktop --grep 'Create a todo'"`): 20s warm, 2 scenarios. Useful for tight dev loops.

## Files a successor should read first

In order of priority:

1. **Root `CLAUDE.md`** — the Critical Rules section, especially the SSOT + no-barrel bullets. The "Common Mistakes" table has entries for `process.env` and bare `@project/env` imports.
2. **`docs/superpowers/specs/2026-04-18-config-ssot-audit-design.md`** — the design spec. Explains the "why" for every mechanism introduced.
3. **`docs/superpowers/plans/2026-04-18-config-ssot-audit.md`** — the implementation plan. Step-by-step for anyone reproducing or extending the work.
4. **`packages/config/src/*.ts`** — the actual constants. Small files, read all four.
5. **`packages/env/src/server.ts` + `packages/env/src/client.ts`** — the env boundary.
6. **`apps/web/src/shared/api-client.ts`** — the web HTTP boundary.
7. **`scripts/export-config.ts` + `scripts/generate-env-example.ts`** — the bridge from TypeScript constants to shell/YAML consumers.
8. **`e2e/CLAUDE.md`** — scoped-test-runs section for the dev loop.
9. **`Makefile`** — `CONFIG_SH` pattern + env-boundary grep check in the `lint:` target.

## What didn't land

Error-message SSOT, Better-Auth `basePath` override, API-level test sign-up, `bddgen` caching, zero-conf `docker compose up` demo, agent-harness custom rule. Each is noted in "Known follow-ups" above with enough context to scope a future session.
