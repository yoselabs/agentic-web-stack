# Configuration Single-Source-of-Truth — Audit & Design Spec

## Summary

Consolidate duplicated configuration across the monorepo so that every value — ports, URLs, credentials, limits, mount paths, dependency versions — lives in exactly one place. When a consumer needs it, they import it. When it changes, it changes once and every consumer follows automatically.

The audit found violations across six buckets: infrastructure config, env-parsing boundary, client-side fetch duplication, domain limits, test fixtures, and package-version drift. Architecture-level concerns (type duplication, Prisma/tRPC singletons, cookie keys) are already clean and need no work.

## Principle

> One change, one place. If a value must stay consistent across consumers, it must be declared exactly once. Every other consumer imports it.

A violation is any value whose change requires the engineer to remember a second edit. The failure mode is always the same: the app runs until the drift matters, then breaks silently (wrong port, wrong URL, mismatched validation), and the engineer pays in debugging time.

## Scope

**In scope — 6 buckets:**

| # | Bucket | Findings |
|---|--------|----------|
| A | Infra config | Dev DB port `5432`; DB creds; dev app ports `3000/3001`; test app ports `3100/3101`; test DB name; tRPC/auth mount paths |
| B | Env-parsing boundary | `process.env.X` reads bypassing `@project/env` in `packages/auth`, `packages/db`, `apps/server`, `apps/server/logger.ts` |
| C | Client fetch duplication | `VITE_API_URL` fallback triplicated in `router.tsx`, `auth-client.ts`, `use-todos.ts` |
| D | Domain limits | File upload size enforced server-only; password minLength enforced client-only |
| E | Test fixtures | Test credentials split across `seed.ts`, `e2e/steps/auth.ts`, `e2e/steps/todos.ts`; CI test env vars duplicated between `.github/workflows/ci.yml` and `e2e/playwright.config.ts` |
| F | Package versions | `@prisma/client` drift (`6.5.0` vs `6.19.3`); `zod` drift (`3.24.0` vs `3.25.76`) |

**Non-goals:**

- **Dev ports stay hardcoded.** Only test-DB ports are hash-randomized (worktree isolation). Dev web/server/DB ports remain stable so bookmarks, OAuth callbacks, and browser storage scopes don't break. SSOT applies to *where* the value lives, not *how* it's chosen.
- **TanStack Router route paths are untouched.** `<Link to="/dashboard">` and `navigate({ to: "..." })` are already type-checked against `routeTree.gen.ts`; the router *is* the SSOT. Extracting them as constants would add indirection without safety.
- **Error-message strings shared between server throws and BDD `.feature` files are NOT unified in this pass.** Strings like `"File too large (max 10 MB)"` appear verbatim in `apps/server/src/index.ts` and in `e2e/features/*.feature` / `e2e/steps/todos.ts`. Fixing them requires either exporting messages from server code (and importing in step defs) or making `.feature` files use regexes. Out of scope here — flag for a follow-up pass. Call out explicitly so a planner doesn't try to absorb it.
- **No renames beyond scope.** Package scope stays `@project/*` (template placeholder). Project id `agentic-web-stack` stays. This is an SSOT pass, not a rebrand.
- **No new runtime infra.** No config service, no env-var fetch, no secrets manager. Everything resolves statically at build / boot time.
- **No lockstep dev/CI port unification.** Dev on `3000/3001`, test on `3100/3101` is intentional (run both simultaneously). The SSOT requirement is per-environment, not across environments.

## Architecture

```
packages/
├── env/                          ← runtime env vars (validated at startup)
│   ├── src/
│   │   ├── server.ts             ← server vars (DATABASE_URL, secrets, PORT, LOG_LEVEL, ...)
│   │   └── client.ts             ← NEW: client vars (VITE_API_URL), VITE_ prefix
│   └── package.json              ← exports: "./server" and "./client" ONLY — no barrel
│
├── config/                       ← NEW: static build-time constants (no runtime, no I/O)
│   └── src/
│       ├── ports.ts              ← DEV_DB_PORT, DEV_WEB_PORT, DEV_API_PORT, TEST_WEB_PORT, TEST_API_PORT
│       ├── db.ts                 ← DEV_DB_NAME, TEST_DB_NAME, DEV_DB_USER, DEV_DB_PASSWORD (dev-only)
│       ├── limits.ts             ← MAX_UPLOAD_BYTES, MIN_PASSWORD_LENGTH
│       └── api-paths.ts          ← TRPC_MOUNT = "/trpc", AUTH_MOUNT = "/api/auth"
│
apps/web/src/shared/
└── api-client.ts                 ← NEW: wraps fetch, reads env.VITE_API_URL from @project/env/client ONLY

e2e/fixtures/
└── credentials.ts                ← NEW: TEST_USER = { email, password }

scripts/
├── export-config.ts              ← NEW: prints @project/config values as shell exports (for Makefile + CI)
└── generate-env-example.ts       ← NEW: rebuilds .env.example files from config + env schema

pnpm-workspace.yaml               ← extended with catalog: section
```

**Critical: no barrel export from `@project/env`.** The package exposes `./server` and `./client` as distinct entry points; there is no top-level `"."` export. Web code imports `from "@project/env/client"`; server code imports `from "@project/env/server"`. This prevents the failure mode where a web file writes `import { env } from "@project/env"`, the barrel transitively pulls `server.ts`, and bundlers either throw on missing server env vars during build or (worse) inline server-only vars into the client bundle. Same class of bug as the existing `import { appRouter }` trap documented in root `CLAUDE.md`.

### Why a new `@project/config` package (and not merging into `@project/env`)

`@project/env` validates **runtime** env (has secrets, runs schema validation, throws on missing vars). `@project/config` holds **static compile-time** constants (plain `export const`, no runtime, no I/O). Merging them would couple boot-time validation failure modes with pure constants and force every consumer of `MAX_UPLOAD_BYTES` to boot the env validator. Keeping them separate keeps each package's job single.

### Why `@project/env` gets a client half

Three web files read `VITE_API_URL` with identical fallbacks (see finding C below). `@t3-oss/env-core` supports `client` + `server` split with a `clientPrefix`. Client bundle only gets client vars; accessing `env.DATABASE_URL` from the browser throws. This removes the triplication and adds type-safe access without changing the validation pattern already in place.

### How `docker-compose.yml` consumes the config

TypeScript constants can't be read by docker-compose directly. Two options were considered:

1. **Compose reads env vars, `Makefile` exports them from a script that imports `@project/config`.**
2. **Hardcode in compose, add a startup assertion in `packages/env` that validates compose-configured port matches `@project/config`.**

We pick **(1)**. A thin script `scripts/export-config.ts` prints `DEV_DB_PORT=5432 DEV_DB_NAME=agentic_web_stack ...` as shell exports; the `Makefile` sources it before `docker compose` invocations. Compose references `${DEV_DB_PORT}` etc. This is the same pattern already used for test-DB (`scripts/test-db.ts` → `docker-compose.test.yml`), just extended to dev.

## Findings and fixes

### A. Infrastructure config (6 findings)

| # | What | Current state | Fix |
|---|------|---------------|-----|
| A1 | Dev DB port `5432` | Hardcoded in `docker-compose.yml:12`, `.env.example:1`, `packages/db/.env.example:1` | Define `DEV_DB_PORT = 5432` in `@project/config`. `.env.example` DATABASE_URL built from `scripts/generate-env-example.ts`. Compose uses `"${DEV_DB_PORT}:5432"` — host side parametrized, container side is always Postgres's internal `5432`. |
| A2 | DB creds split | `docker-compose.yml:7-9` declares `POSTGRES_DB/USER/PASSWORD`; `.env.example:1` encodes them in the URL | `DEV_DB_NAME/USER/PASSWORD` committed to `@project/config/db.ts` with a header comment: `// DEV-ONLY defaults. Production creds come from env (DATABASE_URL). Do not put prod secrets here.` Compose reads them via `scripts/export-config.ts`. `.env.example` DATABASE_URL assembled from them by the generator script. |
| A3 | Dev app ports `3000/3001` | `apps/server/src/index.ts:161` (fallback), `packages/auth/src/index.ts:12` (fallback), `packages/env/src/server.ts:7,9` (defaults), `Makefile:25` (kill-ports), README/CLAUDE.md (prose) | `DEV_WEB_PORT = 3000`, `DEV_API_PORT = 3001` in `@project/config`. Server reads from `env.PORT` (required, no fallback). Auth `trustedOrigins` reads `env.CORS_ORIGIN` (no fallback). `Makefile` kill-ports sourced from `scripts/export-config.ts`. |
| A4 | Test app ports `3100/3101` | `Makefile:60,63` (kill-ports), `.github/workflows/ci.yml:33-34`, `e2e/playwright.config.ts:68` | `TEST_WEB_PORT = 3100`, `TEST_API_PORT = 3101` in `@project/config`. `playwright.config.ts` imports them. CI workflow reads them via `pnpm exec tsx scripts/export-config.ts >> $GITHUB_ENV`. |
| A5 | Test DB name | `docker-compose.test.yml:13` literal `agentic_web_stack_test`; `scripts/test-db.ts:23` literal in URL | Add `TEST_DB_NAME` to `@project/config`. `testDbEnv()` imports it. Compose reads `${TEST_DB_NAME}` (same parametrization pattern already used for `TEST_PORT`, `TEST_CONTAINER`). |
| A6 | tRPC and Better-Auth mount paths | `"/trpc/*"` in `apps/server/src/index.ts:149` (Hono mount) and `/trpc` implicit in `apps/web/src/router.tsx:33` (client base URL construction); `"/api/auth/**"` in `apps/server/src/index.ts:85` and in client auth config. Any rename breaks both sides silently. | Define `TRPC_MOUNT = "/trpc"` and `AUTH_MOUNT = "/api/auth"` in `@project/config/api-paths.ts`. Server imports them for Hono route registration. Web imports them to build base URLs (via `apiClient`). No other consumers. |

### B. Env-parsing boundary (4 findings)

`@project/env` is supposed to be the only place that touches `process.env`. Four bypasses exist (the CORS_ORIGIN double-default goes away as a side effect of B1):

| # | Location | Current | Fix |
|---|----------|---------|-----|
| B1 | `packages/auth/src/index.ts:12` | `process.env.CORS_ORIGIN ?? "http://localhost:3000"` | `import { env } from "@project/env/server"`, use `env.CORS_ORIGIN`. Delete fallback — `env` validates it. Eliminates the duplicate `CORS_ORIGIN` default at `packages/env/src/server.ts:7` by construction. |
| B2 | `packages/db/src/index.ts:9` | `process.env.NODE_ENV` dev-hot-reload guard | `NODE_ENV` is already in `env/server.ts:10-12`. Import and use `env.NODE_ENV`. |
| B3 | `apps/server/src/index.ts:161` | `Number(process.env.PORT ?? 3001)` | Add `PORT: z.coerce.number().default(DEV_API_PORT)` to `env/server.ts` (default imported from `@project/config`). Use `env.PORT`. |
| B4 | `apps/server/src/logger.ts:3,6` | `process.env.NODE_ENV`, `process.env.LOG_LEVEL` | Add `LOG_LEVEL` to `env/server.ts`. Replace both reads with `env.*`. |

**Enforcement:** add an agent-harness / Biome rule that forbids `process.env.X` **reads** outside `packages/env/src/**`, `scripts/**`, `**/vite.config.ts`, and `**/vitest.config.ts`. **Writes** (`process.env.X = ...`) are allowed in vitest configs and test setup files, which legitimately bridge the env package to child processes (precedent: `packages/api/vitest.config.ts:14`). If agent-harness does not support a custom rule, add a `make lint`-invoked grep script with the same whitelist. Research during planning whether agent-harness's rule API supports this; either way the behavioral contract is the same.

Pre-commit hooks already run `agent-harness lint` + `tsc -b`, so no new hook wiring is needed — the enforcement ships through the existing gate.

### C. Client fetch duplication (1 finding)

| # | Location | Fix |
|---|----------|-----|
| C1 | `apps/web/src/router.tsx:33`, `apps/web/src/features/auth/auth-client.ts:4`, `apps/web/src/features/todo/use-todos.ts:17` — all three read `import.meta.env.VITE_API_URL ?? "http://localhost:3001"` and each independently constructs fetches | Create `apps/web/src/shared/api-client.ts`. Imports `env.VITE_API_URL` from **`@project/env/client`** only (never the barrel — the barrel does not exist). Exposes `apiClient.fetch(path, init)` that prepends the base URL and sets `credentials: "include"`. Uses `TRPC_MOUNT` and `AUTH_MOUNT` from `@project/config` to construct tRPC / auth URLs. All three call sites import and use it. Add a line to `apps/web/CLAUDE.md`: **"All HTTP calls from the web app MUST go through `apiClient`. Direct `fetch()` with a hardcoded URL is a lint error. The `apiClient` module imports from `@project/env/client` exclusively — never use `@project/env/server` in any file under `apps/web/`."** |

### D. Domain limits (2 findings)

| # | Location | Fix |
|---|----------|-----|
| D1 | `apps/server/src/index.ts:99` — `MAX_FILE_SIZE = 10 * 1024 * 1024`, server-only | Move to `@project/config/limits.ts` as `MAX_UPLOAD_BYTES`. Server upload handler imports it. `apps/web/src/features/todo/use-todos.ts` imports it and rejects oversized files *before* upload (user gets immediate feedback instead of a 413 after 30s). |
| D2 | `apps/web/src/routes/login.tsx:109` — `minLength={8}`, client-only | Move to `@project/config/limits.ts` as `MIN_PASSWORD_LENGTH`. `login.tsx` reads it for the `<input minLength>`. Better-Auth configured with matching password policy in `packages/auth/src/index.ts`. |

### E. Test fixtures (2 findings)

| # | Location | Fix |
|---|----------|-----|
| E1 | `scripts/seed.ts:21,67` uses `"password123"` with a demo email; `e2e/steps/auth.ts:61,87` and `e2e/steps/todos.ts:50` use `"testpassword123"` with a test email | Create `e2e/fixtures/credentials.ts` exporting `TEST_USER = { email: "test@example.com", password: "testpassword123" }` and `SEED_USER = { email: "demo@example.com", password: "testpassword123" }` (same password, distinct accounts for seeded demo data vs. test-created users). All four occurrences import from this fixture. |
| E2 | CI test env vars (`CORS_ORIGIN`, `BETTER_AUTH_URL`) hardcoded in both `.github/workflows/ci.yml:33-34` and `e2e/playwright.config.ts:68` | Derived from `TEST_WEB_PORT` / `TEST_API_PORT` in `@project/config`. `playwright.config.ts` builds them inline. CI sources them from `scripts/export-config.ts` (same mechanism as A4). |

### F. Package versions (1 finding, 3 deps)

Add a `catalog:` block to `pnpm-workspace.yaml`:

```yaml
packages:
  - "apps/*"
  - "packages/*"
  - "e2e"

catalog:
  "@prisma/client": ^6.19.3
  prisma: ^6.19.3
  zod: ^3.25.76
  "@t3-oss/env-core": ^0.12.0
  "@types/node": ^25.6.0
  typescript: ^5.7.2
```

Rewrite every `package.json` that currently pins these versions to use `"catalog:"`. Run `pnpm install` — lockfile resolves to the catalog version.

**Scope decision:** catalog the currently-drifting deps (`@prisma/client`, `zod`) and the obvious shared ones (`typescript`, `@types/node`, `@t3-oss/env-core`). Don't catalog every single dep — only the ones where drift risk is real.

## Verification

Each fix must be independently verifiable. A reviewer runs the following and expects the listed output. Each regex below has been tightened to avoid false positives on generic magic numbers (e.g., `3000` as a millisecond timeout) — verify on the current tree before shipping.

1. **Ports appear only in port contexts, and only in `@project/config` or consumers that import from it.** Use a port-context regex (URL colon, env-var assignment, or compose binding), not a raw number match:
   ```
   rg '(:3000|:3001|:3100|:3101|:5432|"3000"|"3001"|"3100"|"3101"|"5432"|localhost:3000|localhost:3001|localhost:3100|localhost:3101|localhost:5432|PORT:\s*3|POSTGRES.*5432|"5432:5432")' \
     --type ts --type tsx --type json --type yaml --type md \
     -g '!node_modules' -g '!dist' -g '!.output' -g '!*.gen.*' -g '!pnpm-lock.yaml' -g '!docs/superpowers/plans/**' -g '!docs/superpowers/specs/**'
   ```
   Every match must be either (a) inside `packages/config/src/`, or (b) a file that imports from `@project/config` on another line. Zero literals elsewhere. The tightened pattern excludes generic `3000` as a timeout/retry value.
2. **No `process.env` reads outside the boundary.** `rg 'process\.env\.\w+(?!\s*=)' --type ts --type tsx -g '!packages/env/**' -g '!scripts/**' -g '!**/vite.config.ts' -g '!**/vitest.config.ts' -g '!**/test-setup.ts' -g '!node_modules'` returns zero matches. Negative lookahead excludes writes, which are legitimate in test bootstrapping.
3. **No raw `fetch(` with an http URL in web.** `rg $'fetch\\([\\\'"]http' apps/web/src` (ANSI-C quoted to avoid backtick-in-character-class shell-escape bugs) returns zero matches. Also run `rg 'fetch\(' apps/web/src` and confirm every surviving `fetch(` is a call on `apiClient` (reviewed by eye).
4. **`make lint` and `make test` pass** after every bucket lands. `make test-unit` too.
5. **E2E still green** after the credentials fixture swap. Run `make test` end-to-end.
6. **Single version tree for catalogued deps.** `pnpm why zod` and `pnpm why @prisma/client` each show one resolved version, not a fan-out.
7. **Dev port change smoke test.** Change `DEV_API_PORT` from `3001` to `3005` in `@project/config/ports.ts`. Run `make dev`. Web app connects, auth works, tRPC works, file upload works, no other file edited. Revert.
8. **CI port change smoke test.** Change `TEST_API_PORT` from `3101` to `3105`. Run `act` (or push to a throwaway branch) to execute the workflow. CI passes. No edit to `.github/workflows/ci.yml` required. Revert. Proves `scripts/export-config.ts` → `$GITHUB_ENV` plumbing actually wires through.
9. **Env barrel does not exist.** `cat packages/env/package.json | jq .exports` shows `"./server"` and `"./client"` only — no `"."` entry. `rg 'from "@project/env"(?!/)' --type ts` returns zero matches: every import specifies `/server` or `/client`.

## Rollout order

Suggested order (lowest risk first). Dependencies are explicit:

1. **F (pnpm catalog)** — pure refactor, no runtime change, catches version drift immediately. **Independent.**
2. **E (test fixtures)** — test-only, no production surface. **Independent.**
3. **D (domain limits)** — introduces `@project/config` with only `limits.ts` (other files added by later buckets as needed). Grow the package per-bucket to keep PR surface small. **Creates the `@project/config` package; nothing else depends on it yet.**
4. **A (infra config) + B (env boundary)** — land together. A's compose parametrization requires B's `env` consumers (server/auth/logger) to read from the validated env; B's fallback deletions require A's `@project/config` to supply defaults. Also adds `env/client.ts` as part of B (new client-side env subpath). Adds `ports.ts`, `db.ts`, `api-paths.ts` to `@project/config`.
5. **C (api-client)** — **depends on B**, because `apiClient` imports `env.VITE_API_URL` from `@project/env/client`, which is introduced in B. Do NOT land C before A+B. It's the last bucket because it touches the most web files and is the most reviewable in isolation.

Each bucket produces its own PR. Finding-level references in this spec make reviews grep-able against the diff.

## Open questions

None blocking. Prior open questions resolved:

- Dev DB user/password location → committed to `@project/config/db.ts` with dev-only comment (see A2).
- Lint enforcement mechanism → either agent-harness custom rule or `make lint` grep, both behaviorally equivalent. Research which is available during planning (see B "Enforcement" note). Not blocking the design.
