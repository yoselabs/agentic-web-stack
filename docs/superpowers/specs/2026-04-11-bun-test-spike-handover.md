# Bun-Test + E2E Hardening Spike — Handover

**Date:** 2026-04-11
**Branch at start:** `spike/bun-test-migration` (10 commits)
**Branch at merge:** squashed into one commit on `main`
**Prior state:** `abe0b1f docs: a2sdlc-demo3 deployment spec + plan`

## What shipped

A test-infrastructure overhaul addressing three independently-motivated problems that turned out to share root causes.

### 1. Unit test runner: vitest → `bun test`
Motivation: another agent session reported vitest-on-Bun was broken (`z.string` undefined via Vite SSR transform). Migration path: `bun test` (native runner, Jest-compatible API) instead of trying to fix `bun --bun vitest`.

- `packages/api/scripts/test-runner.ts` — spawns `bun test` with `DATABASE_URL` + auth env wired via `scripts/test-db.ts`. Forwards argv so `pnpm --filter @project/api test todo/service` path-filters.
- 4 test files: `from "vitest"` → `from "bun:test"`. Zero API change.
- `packages/api/tsconfig.json`: `types: ["node", "bun"]`.

**Result**: `make test-unit` 23s vitest → **356ms warm bun test**. ~60× faster.

### 2. Hash-gated `prisma generate`
Motivation: `prisma generate` unconditionally rewrites 96MB of client code. Bun's transpile cache invalidates → first test run after a regen pays ~22s. Prisma has no `--skip-if-unchanged`; open request at [prisma/prisma#29308](https://github.com/prisma/prisma/issues/29308).

- `packages/db/scripts/generate.ts` — hashes schema files + Prisma CLI version; stores hash in `node_modules/.cache/prisma-generate.hash`. Skips regen if unchanged.
- File-lock via `O_EXCL` openSync on `prisma-generate.lock` so parallel `make test` + `make test-unit` don't race on a half-rewritten client. Stale-lock auto-cleared after 120s.
- `packages/db/package.json`: `generate` and `postinstall` both route through the script.

### 3. E2E test reliability (the biggest user-facing win)
Motivation: `make test` was flaking under parallel worker load — scenarios wedged on `getByRole("Sign Up").click()` for the full 30s timeout. Root causes were two:

1. **Cold-compile stampede**: `vite dev` compiles SSR routes on-demand. 5 Playwright workers hitting `/login` cold-first = serialized compilation, hydration lagged click landing.
2. **Click-before-hydration race**: Playwright's auto-waiting doesn't know about hydration. Buttons exist in SSR HTML but handlers aren't wired yet.

Fixes:
- **Build-for-test** (`e2e/playwright.config.ts`): web webServer now does `rm -rf .output && vite build && bun .output/server/index.mjs` instead of `vite dev`. Nitro production bundle has zero on-demand compile. API server swapped from `tsx watch` to `bun src/index.ts` (faster, consistent).
- **Hydration marker** (`apps/web/src/routes/__root.tsx`): `useEffect` sets `[data-hydrated]` on `<html>`. `e2e/waits.ts::waitForHydration` waits for it after every `page.goto()` in step definitions. Replaces `waitForLoadState("networkidle")` which doesn't actually signal interactivity.
- **API-based auth fixture** (`e2e/auth-client.ts`): `createUserViaApi` + `signInViaApi` hit Better-Auth's HTTP API directly for preconditions ("Given I am signed in as X"). Session cookie lands on `page.context()`. Only `auth.feature`'s Sign Up/Sign In/Wrong Password scenarios still use UI — those are the tests. This cut UI load on `/login` by ~70% under parallel load.
- **Email-uniqueness lint** (`e2e/scripts/check-feature-emails.ts`): wired into `make lint`. Fails if any email literal is used across >1 scenario. Also forbids email literals in `Background:` blocks.
- **Postgres tuning** (`docker-compose.test.yml`): `fsync=off`, `synchronous_commit=off`, `full_page_writes=off`, `wal_level=minimal`, `shared_buffers=256MB`. Safe — tmpfs, ephemeral.
- **Hardened helpers**: `waitForHydration` throws with URL + HTML snippet on timeout; `createUserViaApi` checks status 422 before falling back to text match on Better-Auth's error body.

**Result**: `make test` 20/20 in **13.7s wall** (cold rebuild: 35s). Previously flaky.

### 4. Developer experience
- `make help` (now default target) — self-generated from `## ` annotations on targets.
- `make test-all` — runs unit + BDD sequentially. Previously no single target ran both.
- `make setup` — guards `bun` and `docker` presence with actionable install hints before failing deep in `pnpm install`.
- `scripts/check-env-boundary.ts` — the 7-line ripgrep allowlist from the Makefile extracted to a script with failure-message guidance.
- CI: `oven-sh/setup-bun@v2` added to both jobs (without it, post-merge CI breaks on first PR).
- `README.md`: bun documented in Prerequisites.
- `TODO.md`: dedicated "spike/bun-test-migration — deferred ideas" section.

### 5. Folder layout tidy
- `packages/api/test-runner.ts` → `packages/api/scripts/test-runner.ts` (parity with `packages/db/scripts/generate.ts`).
- `scripts/check-feature-emails.ts` → `e2e/scripts/check-feature-emails.ts` (colocated with data it checks).
- `e2e/helpers.ts` → `e2e/waits.ts` (narrower name).
- `e2e/auth-client.ts` — extracted from `steps/auth.ts` so the API auth helpers are discoverable and reusable across step files.

### 6. tsx → bun for glue scripts
Root dropped `tsx` as a devDep. Makefile + CI use `bun scripts/*.ts` directly. `apps/server`'s local `dev` still uses `tsx watch` (untouched — not test path).

## What's deferred

Two substantial follow-ups that were scoped out of this spike. **Entry points documented in `TODO.md`** under "Demo mode" and "spike/bun-test-migration — deferred ideas".

### A) Demo mode — `docker compose up` runs the whole app
Currently `docker-compose.yml` only runs Postgres (dev infra). To have "clone + `docker compose up` + click around" work for demos:

- **`apps/web/Dockerfile`** — multi-stage. Build stage uses `node` + `pnpm` + `bun` (vite build needs node). Runtime stage is **bun only** — `bun .output/server/index.mjs`. Drops ~300MB from the runtime layer.
- **`apps/server/Dockerfile`** — multi-stage, same pattern. Runtime runs `bun src/index.ts` directly (no tsc build step needed in-image; bun runs TS natively).
- **`docker-compose.yml`** gains `web` and `server` services wired to Postgres. Inter-container env: `DATABASE_URL=postgresql://postgres:postgres@postgres:5432/app`, `VITE_API_URL=http://localhost:3001` (baked at build), `BETTER_AUTH_URL=http://localhost:3001`, `CORS_ORIGIN=http://localhost:3000`.
- **Schema provision** on first boot: either a one-shot `migrate` sidecar or `prisma db push` on server container startup.
- **Optional**: seed script runs automatically so a demo user exists.

**Est effort**: 2–3 hours. New branch, not a cleanup.

**Verified pattern**: `bun .output/server/index.mjs` already works (used in `make test`). No runtime issues with Nitro output under Bun — the `__extends` stderr noise is pre-existing SSR bundle quirk, not a runtime bug.

### B) Node + Bun coexistence — when to pick which
The current stance (after this spike):

| Context | Runtime | Why |
|---|---|---|
| Production web image (future) | bun | Serves `.output/server/index.mjs`. No node needed in runtime. |
| Production server image (future) | bun | `bun src/index.ts` — no build needed. |
| Build stage of Docker images | node + pnpm + bun | `vite build` requires node. Stage is discarded. |
| Local dev (`make dev`) | node (via tsx watch on server; vite dev on web) | Hot reload; bun's `--watch` for `tsx watch --env-file-if-exists` is untested with Better-Auth. Low-risk to defer. |
| Unit tests | bun test | 60× faster than vitest, native runner. |
| BDD test webServers | bun for both web (Nitro bundle) and api (src/index.ts) | Consistency; no perf loss vs node. |
| Glue scripts (Makefile/CI) | bun | Fast startup, native TS, no tsx dep. |
| Postinstall + Prisma generate | bun | Shares bun prereq with the rest. |
| `apps/server` local dev | **tsx (node)** | Left alone. HMR path, not flake-sensitive. |

**Question for the next session**: should `apps/server` local `dev` also migrate from `tsx watch` to `bun --watch`? Likely fine but needs verification with Better-Auth hot-reload. Not a blocker for demo-mode work.

**Sub-question**: when building the Docker images, the build stage's `pnpm install` triggers `packages/db` postinstall which runs `bun scripts/generate.ts`. Make sure bun is installed **before** `pnpm install` in the Dockerfile, or postinstall will fail confusingly. Same gotcha as CI — `oven-sh/setup-bun@v2` before `pnpm install` in the workflow.

## Test results at merge

```
make lint                    ✓ (13 checks pass)
make test-unit               ✓ 27/27 in 356ms warm (18s cold after schema change)
make test --project desktop  ✓ 18/18 in 12.8s
make test (full)             ✓ 20/20 in 13.7s
```

## Key file paths

Infrastructure:
- `packages/api/scripts/test-runner.ts` — bun test invoker
- `packages/db/scripts/generate.ts` — hash-gated prisma generate
- `scripts/check-env-boundary.ts` — env boundary lint
- `e2e/scripts/check-feature-emails.ts` — BDD email uniqueness lint
- `e2e/waits.ts` — `waitForHydration`
- `e2e/auth-client.ts` — `createUserViaApi`, `signInViaApi`
- `e2e/playwright.config.ts` — built-mode webServer commands

Tests:
- `packages/api/src/domains/*/__tests__/*.test.ts` — 4 files, all import from `"bun:test"`

Config:
- `apps/web/src/routes/__root.tsx` — `[data-hydrated]` marker
- `docker-compose.test.yml` — Postgres tuning
- `.github/workflows/ci.yml` — `setup-bun@v2` step

Docs:
- `README.md` — bun in Prerequisites
- `Makefile` — `make help`, `make test-all`, bun guard in `make setup`
- `packages/api/CLAUDE.md`, `e2e/CLAUDE.md` — updated for new paths
- `TODO.md` — demo mode + deferred ideas

## Pre-existing issues noted but not fixed

- **`__extends` stderr noise** (~17/test run): TanStack Router + Nitro SSR bundling issue with `react-remove-scroll-bar` (CJS + tslib). Workaround documented in `TODO.md` (alias tslib to ESM build + ssr.noExternal). Not fixed because we're on `nitro-nightly` + Vite 8 rolldown (both moving targets); upstream churn likely fixes it. Tests pass regardless.
- **`BETTER_AUTH_SECRET` zero-conf default fires in prod**: `packages/env/src/server.ts` has a 32-char default that passes the Zod `.min(32)` check. Spec claims "defaults never fire in prod" but code doesn't enforce it — an unset var in prod boots with a publicly-known secret. Flagged in `TODO.md`. Out of spike scope.
