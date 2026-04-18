# Zero-Conf Architecture — Design Spec

**Date:** 2026-04-18
**Status:** Ready to implement
**Supersedes (partially):** `docs/superpowers/specs/2026-04-18-config-ssot-audit-design.md` — that spec introduced `@project/config` + shell bridge. This spec retracts most of it.

## Context

Three days ago the SSOT audit introduced `@project/config`, `scripts/export-config.ts`, `scripts/generate-env-example.ts`, and a `CONFIG_SH := $$(...)` sourcing dance in the Makefile. The principle — single source of truth for values used in multiple places — was correct. The implementation over-engineered it.

This refactor is a course-correction driven by a simple observation: **the drift problem it solved doesn't exist at the frequency claimed.** Dev ports don't change. Dev DB credentials don't change. "5432" has been Postgres since 1996. Abstracting a constant that never changes pays ceremony cost without ever collecting the drift-prevention reward.

The refactor also tightens two orthogonal issues the audit left in place:
- `packages/api/src/` is layer-split (`routers/`, `services/`) while `apps/web/src/` is FSD domain-split (`features/`, `widgets/`). The asymmetry increases cognitive load and weakens per-domain agent isolation.
- Mutation services accept the `DbClient` union, so forgetting a `$transaction` wrap is doc-enforced, not type-enforced. The lock-holders already show how to tighten this — extending to all mutations makes the convention compile-time-checked.

## Principles

1. **Zero-conf dev.** Fresh clone → `make setup && make dev` → app runs with no `.env` file. TS, Docker, and Make work without configuration.
2. **SSOT where it matters, literal where it doesn't.** SSOT is a load-bearing rule for values that genuinely change (domain rules, Zod schemas, Prisma types). For values that are constants-forever (ports, local DB creds), literal duplication across 3-4 infra files is honest and cheaper than a bridge.
3. **Domain colocation over layer colocation.** Things that change together live together. A feature owns its constants, schema, service, router, and tests. The API mirrors the web's FSD shape.
4. **Type-enforced conventions over documented conventions.** If the type system can make a rule a compile error, do that instead of writing it in CLAUDE.md.
5. **Infra constraints are infra constraints.** Prisma requires schema files in one folder. We accept that. We don't shadow the constraint with our own abstraction.

## Decisions

### D1 — Absorb `@project/config`'s role into `@project/env` with Zod defaults

**What.** `@project/env/server` and `@project/env/client` Zod schemas get `.default(...)` on every variable dev needs. Missing `.env` file is fine — defaults fire. Prod always sets env externally, so defaults never fire in prod.

**Final shape:**
```ts
// packages/env/src/server.ts
server: {
  DATABASE_URL: z.string().url().default("postgresql://postgres:postgres@localhost:5432/app"),
  CORS_ORIGIN: z.string().url().default("http://localhost:3000"),
  BETTER_AUTH_SECRET: z.string().min(32).default("change-me-to-a-random-32-char-secret-key"),
  BETTER_AUTH_URL: z.string().url().default("http://localhost:3001"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(3001),
  LOG_LEVEL: z.enum(["fatal","error","warn","info","debug","trace"]).optional(),
}

// packages/env/src/client.ts
client: {
  VITE_API_URL: z.string().url().default("http://localhost:3001"),
}
```

**Why.** Zod already validates. `.default()` is one native mechanism. No separate "defaults file," no shell bridge to TS. Prod deploys (DO, Dokploy, anywhere) always set env vars — the defaults are a dev ergonomic, not a production concern.

**Rejected alternatives:**
- `.env.defaults` file + dotenv layering — still a bridge; devs have to remember which file overrides which.
- Keep `@project/config/ports` + derive env defaults from it — the whole point is to delete the config package.

### D2 — Standardize DB naming: `app` / `postgres` / `postgres`

**What.** The local Postgres database is called `app`. The user is `postgres`. The password is `postgres`. Same names in dev and test (different containers, different ports, no confusion).

**Why.** Any yose-labs project a year from now should open with the same muscle memory: `psql -d app`. "agentic_web_stack" was project-specific by accident, not design. Prod DATABASE_URL always overrides, so the local name is truly local.

**Rejected alternatives:**
- Keep project-specific name — requires the template user to rename everywhere when they fork, or accept a leaked identifier.
- Parameterize via env var — same problem as `@project/config/db`, just relocated.

### D3 — Domain constants live with the domain

**What.**
- `MAX_UPLOAD_BYTES` → `packages/api/src/domains/todo/constants.ts`
- `MIN_PASSWORD_LENGTH` → `packages/auth/src/constants.ts`
- `TRPC_MOUNT` (`"/trpc"`) → inline at 2 sites (`apps/server/src/index.ts`, `apps/web/src/router.tsx`)
- `AUTH_MOUNT` (`"/api/auth"`) → inline at 1 site (`apps/server/src/index.ts`). Better-Auth's internal client hardcodes `/api/auth` anyway — the constant was never truly configurable.

**Why.** A 10 MB upload limit is a todo-import decision, not an infra setting. Password length is an auth decision. Stuffing domain rules into a generic `@project/config/limits` conflates "shared across layers" with "globally configurable" — which it isn't. Two constants (`TRPC_MOUNT`, `AUTH_MOUNT`) have ≤2 call sites and near-zero likelihood of change; inline them and save one module.

**Cross-package import from web:** `apps/web/src/features/todo/use-todos.ts` imports `MAX_UPLOAD_BYTES` via `@project/api/domains/todo/constants`. Same channel as `AppRouter` type imports — the `constants.ts` file must remain primitive-only (no server-code imports) so the web bundle stays clean.

### D4 — Dynamic test ports (extend existing dynamic DB port)

**What.** `scripts/test-db.ts` already computes a per-worktree DB port (`5400 + hash16 % 100` for e2e, `5500+` for unit). Extend `testDbEnv()` to also compute:
- `TEST_WEB_PORT`: `3100 + offset` (e2e), `3300 + offset` (unit — not currently used but reserved)
- `TEST_API_PORT`: `3200 + offset` (e2e), `3400 + offset` (unit — reserved)

Bases are spaced by ≥100 so ranges never overlap under the modulo-100 offset — web/api/DB ports can't collide across worktrees or between the e2e and unit suites.

Consumers update:
- `e2e/test-env.ts` re-exports them.
- `e2e/playwright.config.ts` imports from `test-env.ts` (no more `@project/config/ports`).
- `Makefile` `test` / `test-ui` targets compute via tsx call rather than sourcing shell exports.
- `.github/workflows/ci.yml` computes the same way.

**Why.** Fixes a latent parallel-worktree collision: two `make test` runs on the same host currently race on static ports 3100/3101, with `kill-ports.ts` as the loser's tombstone. The DB port was already dynamic; the test web/API ports should have been too. This decision finishes a consistency the audit started.

**Why in `scripts/test-db.ts` (not `@project/env`):** test ports are infrastructure for the test runner, not runtime env. They're computed by a hash algorithm, not configured. They have no reason to be in the env package — conflating them was the original sin.

### D5 — Delete both generator scripts

**What.**
- `scripts/export-config.ts` → deleted. Makefile `CONFIG_SH` idiom removed.
- `scripts/generate-env-example.ts` → deleted. `.env.example` becomes a hand-maintained prod-docs file (lists `DATABASE_URL`, `BETTER_AUTH_SECRET`, etc., with comments for deployment).

**Why.** Both exist to propagate TS values to shell consumers. With D1+D2+D3, there are no TS values left to propagate — everything shell needs is either a literal (ports, DB name) or dynamic per-worktree (test ports, from `test-db.ts`). The bridges have nothing to bridge.

### D6 — Hardcode dev infra values

**What.** Literal `3000`, `3001`, `5432`, `app`, `postgres` in:
- `docker-compose.yml`
- `Makefile` (where kill-ports needs dev port numbers)
- `.github/workflows/ci.yml`
- `docker-compose.test.yml` (DB name; port/container still dynamic via test-db.ts)
- `packages/env/src/server.ts` Zod defaults (the one TS place)
- `packages/db/.env.example` (hand-maintained)

**Why.** Four places. On the theoretical day someone changes `3000` to `3005`, they edit four files. The last time anyone changed a Node dev port in this codebase was … never. SSOT prevents *drift*, which requires *change*. For stable infra constants, literal is the honest representation.

**Acceptable duplication:** yes. Rule: duplication is the failure mode when values change. When they don't, duplication is just the natural way data lives in different formats (YAML, Makefile, TS Zod).

### D7 — Restructure `packages/api/src/` to domain-split

**What.**
```
packages/api/src/
  domains/
    todo/
      constants.ts          # MAX_UPLOAD_BYTES, etc.
      service.ts            # ← former services/todo.ts
      router.ts             # ← former routers/todo.ts
      __tests__/
        service.test.ts     # ← former services/__tests__/todo.test.ts
        router.test.ts      # ← former __tests__/todo.test.ts
    todo-list/
      service.ts
      router.ts
      __tests__/
  context.ts
  trpc.ts
  router.ts                  # root router (append-alpha order)
```

`queries.ts` is **not** introduced now. Add only when a domain grows complex/reusable queries. Service + inline Prisma calls is the default.

**Prisma schema stays at `packages/db/prisma/schema/*.prisma`** — tooling constraint (multi-file schema requires contiguous folder).

**`@project/api` exports update:**
- Add: `./domains/todo/constants`, `./domains/todo/service`, `./domains/todo-list/service`
- Remove: `./services/todo`

**Why.** Mirrors web's FSD pattern. Agent working on `todo` scopes to one directory. Co-located tests. Predictable discovery (constants? `constants.ts`. Service? `service.ts`.). The old layer split served no project-specific purpose — it was tRPC tutorial shape.

### D8 — Tighten transaction types

**What.** Mutation services (including read-then-write flows) accept `Prisma.TransactionClient` only, not the `DbClient` union. Read-only services accept `DbClient`.

| Function | Current | New |
|---|---|---|
| `listTodos` | `DbClient` | `DbClient` (unchanged) |
| `exportTodosAsCSV` | `DbClient` | `DbClient` (unchanged) |
| `listTodoLists` | `DbClient` | `DbClient` (unchanged) |
| `getTodoList` | `DbClient` | `DbClient` (unchanged) |
| `createTodo` | `Prisma.TransactionClient` | `Prisma.TransactionClient` (already) |
| `completeTodo` | `Prisma.TransactionClient` | `Prisma.TransactionClient` (already) |
| `importTodosFromCSV` | `Prisma.TransactionClient` | `Prisma.TransactionClient` (already) |
| `reorderTodos` | `DbClient` | **`Prisma.TransactionClient`** |
| `deleteTodo` | `DbClient` | **`Prisma.TransactionClient`** |
| `createTodoList` | `DbClient` | **`Prisma.TransactionClient`** |
| `deleteTodoList` | `DbClient` (reads then writes) | **`Prisma.TransactionClient`** |

**Why.** Routers already wrap every mutation in `$transaction((tx) => ...)` per `packages/api/CLAUDE.md`. The narrow signals the invariant in the service's signature and hover tooltip, matching Prisma's idiom for lock-participating functions. **It is NOT compile-enforced.** TypeScript's structural subtyping means `PrismaClient` is assignable to `Prisma.TransactionClient` (the latter is `Omit<PrismaClient, …>`), so `service(ctx.db, …)` without `$transaction` still compiles. The benefit is documentation + code review signal, not a tsc guard. A true compile-time guard would require nominal branding that Prisma doesn't ship.

### D9 — Root `router.ts` append-alpha convention

**What.** Routers in `packages/api/src/router.ts` are registered one-per-line, alphabetical by key, trailing comma always. New feature = new line inserted at the alpha position. Documented in `packages/api/CLAUDE.md`.

**Why.** Two agents adding features in parallel (say "blog" and "comment"): with append-to-bottom, both edit the last line = merge conflict. With alpha order, "blog" inserts between `auth` and `todo`, "comment" between `blog` and `todo` — different lines, git 3-way merges cleanly. Small operational win for the parallel-agent goal.

**Rejected alternative:** glob-auto-discover routers at startup. Adds runtime import machinery; the savings (no manual register line) are tiny and the convention is dead simple.

## Impact

### Deleted

- `packages/config/` (entire package, 4 files)
- `scripts/export-config.ts`
- `scripts/generate-env-example.ts`
- `packages/api/src/routers/` (after content moves to `domains/*/router.ts`)
- `packages/api/src/services/` (after content moves to `domains/*/service.ts`)
- `packages/api/src/__tests__/` (after content moves to `domains/*/__tests__/router.test.ts`)
- `CONFIG_SH := $$(pnpm exec tsx scripts/export-config.ts)` from `Makefile`
- `Export config to GITHUB_ENV` step from `.github/workflows/ci.yml`
- `@project/config` dep from every `package.json` that had it (7 of them)

### Added

- `packages/auth/src/constants.ts` (`MIN_PASSWORD_LENGTH`)
- `packages/api/src/domains/{todo,todo-list}/` with `constants.ts` (where applicable), `service.ts`, `router.ts`, `__tests__/`
- New subpath exports on `@project/api` and `@project/auth`

### Changed

- `packages/env/src/server.ts` — Zod defaults for all variables
- `packages/env/src/client.ts` — Zod default for `VITE_API_URL`
- `scripts/test-db.ts` — `testDbEnv()` returns `TEST_WEB_PORT`, `TEST_API_PORT` (dynamic)
- `docker-compose.yml` — literal values, no `${VAR}` interpolation
- `docker-compose.test.yml` — literal `POSTGRES_DB: app` (port/container still dynamic)
- `Makefile` — no CONFIG_SH, literal ports, test ports via tsx call
- `.github/workflows/ci.yml` — no export-config step, test env via tsx call
- `.env.example` — rewritten as prod-deploy docs
- `packages/db/.env.example` — literal `postgresql://postgres:postgres@localhost:5432/app`
- `apps/server/src/index.ts` — inline `TRPC_MOUNT`, `AUTH_MOUNT`; import `MAX_UPLOAD_BYTES` from new location
- `apps/web/src/router.tsx` — inline `TRPC_MOUNT`
- `apps/web/src/features/todo/use-todos.ts` — import `MAX_UPLOAD_BYTES` from `@project/api/domains/todo/constants`
- `apps/web/src/routes/login.tsx` — import `MIN_PASSWORD_LENGTH` from `@project/auth/constants`
- `packages/auth/src/index.ts` — import from own `./constants.ts`
- `packages/api/vitest.config.ts` — literal `http://localhost:3000` / `3001` URLs
- `e2e/playwright.config.ts` — ports from `test-env.ts` (not `@project/config/ports`)
- `e2e/test-env.ts` — re-exports `TEST_WEB_PORT`, `TEST_API_PORT`
- `packages/api/src/router.ts` — alpha-ordered router registrations
- Root `CLAUDE.md` — updated SSOT rule, removed `@project/config`-subpath Common Mistakes, added zero-conf notes
- `packages/api/CLAUDE.md` — mutation-signature invariant documented, append-alpha rule documented

### Kept

- `@project/env` package (still reads `process.env`, still the only module that does, still split `/server` + `/client`)
- Env-boundary grep enforcement in `make lint`
- Prisma multi-file schema at `packages/db/prisma/schema/`
- No-barrel rule across `@project/env`, `@project/api`, `@project/auth`
- `apps/web/` FSD (unchanged)
- Dynamic test DB port / container per worktree
- Transaction wrap convention at the router level (now also type-enforced)

## Verification

All must pass after the refactor:

```bash
# 1. Nothing still imports from @project/config
rg "@project/config" --type ts --type tsx --type json
# Expected: zero matches (except within git history / docs)

# 2. No process.env reads outside the env boundary (preserves SSOT audit check)
rg 'process\.env\.' --type ts \
  -g '!packages/env/**' -g '!scripts/**' \
  -g '!**/vite.config.ts' -g '!**/vitest.config.ts' -g '!**/test-setup.ts' \
  -g '!**/playwright.config.ts' \
  -g '!node_modules' -g '!**/*.gen.*'
# Expected: zero matches

# 3. No barrel imports of @project/env, @project/api, @project/auth
rg 'from "@project/(env|api|auth)"[^/]' --type ts --type tsx
# Expected: zero matches

# 4. make lint passes
make lint

# 5. make test-unit passes
make test-unit

# 6. make test passes (full BDD suite, desktop + mobile)
make test

# 7. Zero-conf boot: fresh clone simulation
git stash
rm -rf node_modules packages/*/node_modules apps/*/node_modules
rm -f .env packages/db/.env
pnpm install
make setup    # creates no .env (make setup no longer copies .env.example by default)
make dev      # should start web + server, reachable at localhost:3000 and 3001
# Expected: both servers boot, no errors about missing env
# Cleanup: kill dev, git stash pop

# 8. Parallel worktree test isolation (manual)
# In worktree A: make test
# In worktree B (different directory, different hash): make test simultaneously
# Expected: both pass, no port conflicts, no kill-ports.ts race
```

## Non-goals

- Error-message SSOT (still open from SSOT audit handover #1)
- Better-Auth `basePath` override (handover #2)
- API-level test sign-up helper (handover #3)
- Zero-conf `docker compose up` full-app demo (handover #5 — this refactor helps but doesn't complete)
- Changing Prisma's schema-folder layout (tooling constraint)

## References

- Prior SSOT audit spec: `docs/superpowers/specs/2026-04-18-config-ssot-audit-design.md`
- Prior SSOT audit handover: `docs/superpowers/specs/2026-04-18-ssot-audit-handover.md`
- Implementation plan: `docs/superpowers/plans/2026-04-18-zero-conf-architecture.md`
