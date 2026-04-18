# Zero-Conf Architecture — Handover

**Date:** 2026-04-18
**Branch:** `main`
**Scope:** Course-correction of the 2026-04-18 SSOT audit. 8 commits, starting at `19797de` — this handover is the last of them. `git log --oneline 19797de^..HEAD` shows the full range.

## What shipped

| # | Commit | Bucket | Change |
|---|---|---|---|
| 1 | `19797de` | env | @project/env Zod defaults absorb dev values; no more @project/config import in env |
| 2 | `1c8d792` | constants | MIN_PASSWORD_LENGTH → @project/auth/constants; MAX_UPLOAD_BYTES → @project/api/domains/todo/constants; TRPC_MOUNT / AUTH_MOUNT inlined |
| 3 | `97a1ec5` | infra | Makefile / docker-compose.yml / CI hardcoded with literal 3000/3001/5432 and 'app'/'postgres'/'postgres'; .env.example hand-maintained; packages/db/prisma.config.ts zero-conf fallback |
| 4 | `9ec6972` | cleanup | @project/config + both generator scripts deleted; lockfile regenerated |
| 5 | `9aef870` | test perf | Dynamic TEST_WEB_PORT / TEST_API_PORT per worktree; bases spaced ≥100 apart so ranges never overlap |
| 6 | `068d7b0` | restructure | packages/api/src/ → domains/{todo,todo-list}/ (FSD-style) |
| 7 | `944fad5` | types | Mutation services typed Prisma.TransactionClient for naming/doc; append-alpha router convention documented |
| 8 | `<this>` | docs + zero-conf fixes | Root CLAUDE.md updated; handover written; two zero-conf regressions fixed (see below) |

## Why

The 2026-04-18 SSOT audit introduced `@project/config` + shell bridge to solve a drift problem. The drift problem doesn't exist at the claimed frequency — dev ports never change. The audit paid ceremony cost without collecting the drift-prevention reward. This refactor retracts the over-engineered parts while keeping what earned its weight (`@project/env`, no-barrel rule, env-boundary grep, domain-split co-location).

See design spec `docs/superpowers/specs/2026-04-18-zero-conf-architecture-design.md` for rationale per decision.

## What remained from the SSOT audit

- `@project/env` (split-brain server/client, enforced via subpaths).
- Env-boundary grep in `make lint` (extended to also whitelist `packages/db/prisma.config.ts`).
- No-barrel rule.
- Prisma multi-file schema at `packages/db/prisma/schema/`.
- Dynamic test DB port per worktree — now extended to web/API ports too.

## Zero-conf contract

Clone → `pnpm install && make setup && make dev` → app runs at
`http://localhost:3000` + API at `http://localhost:3001` with no `.env` file.

Dev defaults live in `@project/env`'s Zod schemas. Docker / Make / CI use
literal values for the dev-infra side. `packages/db/prisma.config.ts` carries
its own `DATABASE_URL` literal fallback because Prisma CLI reads `process.env`
directly and can't see the env package.

Prod deploy: set every variable listed in `.env.example` in your deployment
platform. Defaults will never fire because env vars are always set.

### Two zero-conf fixes required during Task 8 verification

The smoke test (Step 4 of Task 8) caught two regressions that the test suite
did not — because test configs override `process.env` directly, short-circuiting
the zero-conf path. Both were fixed in this commit:

1. **`apps/server` dev script required `.env` to exist.**
   `tsx watch --env-file=../../.env` fails hard when the file is missing.
   Changed to `--env-file-if-exists=../../.env` so the script silently proceeds
   when there is no `.env` (zero-conf path) but still picks the file up when
   present (normal dev with overrides).

2. **Prisma datasource bypassed Zod defaults for `DATABASE_URL`.**
   Prisma's schema binding `url = env("DATABASE_URL")` reads `process.env`
   directly at runtime. `@t3-oss/env-core` validates into an object but does
   **not** mutate `process.env`, so a `.default(...)` in
   `packages/env/src/server.ts` would never reach Prisma when no `.env` was
   set. Fixed by passing the URL explicitly in `packages/db/src/index.ts`:

   ```ts
   new PrismaClient({
     datasources: { db: { url: env.DATABASE_URL } },
   })
   ```

   This closes the gap between the zero-conf promise and Prisma's
   process.env-only resolution. Same pattern already lives in
   `packages/db/prisma.config.ts` for the CLI path.

## Important caveats and things a successor should know

### Transaction type narrowing is naming/doc only, NOT compile-enforced

`reorderTodos`, `deleteTodo`, `createTodoList`, `deleteTodoList` have `tx:
Prisma.TransactionClient` parameters. The original intent of Task 7 was
"forgetting `$transaction` becomes a compile error." **It doesn't** —
`Prisma.TransactionClient = Omit<PrismaClient, ...>`, so `PrismaClient` is
structurally assignable to `TransactionClient`, meaning `createTodo(ctx.db,
...)` without `$transaction` compiles cleanly. The narrow's value is: parameter
names self-document intent, hover tooltips show the correct type, and the
signature matches Prisma's idiom for lock-participating code. Enforcement
remains by convention + code review, same as before.

Service unit tests pass `db` (PrismaClient) directly to narrowed writes, and
they compile. This is not a test bug — it's the same structural-subtyping
loophole. Safe in unit tests (single-row ops don't need locks), but agents
should not generalize that to production code.

See `packages/api/CLAUDE.md § Transaction Rules` for the full explanation.

### Prod fallback risk for DATABASE_URL + BETTER_AUTH_SECRET

`packages/env/src/server.ts` has `.default(...)` values for these vars. In
prod, they never fire because infra always sets env externally — but there is
no *code-level guard* that enforces this. If a prod deploy misconfigures and
the default fires:
- `DATABASE_URL` default `postgresql://postgres:postgres@localhost:5432/app`
  → app connects to nothing (cryptic error, not a loud "env var missing" crash).
- `BETTER_AUTH_SECRET` default `change-me-to-a-random-32-char-secret-key` is
  41 chars, passes `.min(32)`, and would silently sign session tokens with a
  publicly-known string.

Defense-in-depth candidates (not implemented in this refactor; future work):
- Zod `.refine()` that rejects the literal dev defaults when `NODE_ENV === "production"`.
- Boot-time warning log if defaults fire in a non-development environment.

### BETTER_AUTH_URL hardcoded inside Better-Auth

Even though `AUTH_MOUNT` was inlined as `"/api/auth"` in `apps/server/src/index.ts`,
Better-Auth's client internally assumes `/api/auth` as its basePath. Changing
the mount still requires a Better-Auth `basePath` override — out of scope for
this refactor.

### .env.example doesn't list PORT and NODE_ENV

A reviewer flagged that prod deployers sometimes need `PORT` (set by the
platform) and `NODE_ENV`. Both have Zod defaults and platforms usually set
them automatically, so omitting them from the prod-reference file is low risk.
Add them if stakeholder feedback requests.

### `@project/auth` has a root export, not a barrel

The no-barrel rule applies to packages whose root exists only to re-export
from subpaths (`@project/env`, `@project/api`). `@project/auth`'s root IS the
primary module — it exports the configured `auth` instance and the `Session`
type, not re-exports from subpaths. So `import { auth } from "@project/auth"`
and `import type { Session } from "@project/auth"` are legitimate. The
verification grep `rg 'from "@project/(env|api|auth)"[^/]'` flags these by
design (it's conservative); the three matches at `apps/server/src/index.ts`,
`scripts/seed.ts`, and `packages/api/src/context.ts` are expected and safe.

## Verification evidence (from Task 8 run)

- `@project/config` imports outside docs: **zero** (only match is a
  Common-Mistakes row in `CLAUDE.md` documenting the anti-pattern).
- `process.env.X` reads outside env boundary (with designed whitelist): **zero**.
- Barrel imports of `@project/env|api|auth`: **three** — all three reference
  `@project/auth`'s legitimate root export (see caveat above). No
  `@project/env` or `@project/api` barrel imports exist.
- `make lint`: **PASS**.
- `make test-unit`: **PASS** (27 tests).
- `make test`: **PASS** (20 BDD scenarios — 18 desktop + 2 mobile).
- Zero-conf boot smoke test (no `.env` file): **PASS (after two fixes applied
  in this commit)**. Health endpoint returned
  `{"status":"ok","uptime":21.23,"timestamp":"2026-04-18T03:41:08.172Z","db":"ok"}`
  at HTTP 200; web root returned HTTP 200.

## Known follow-ups (not addressed in this refactor)

1. **Error-message SSOT.** Strings like `"File too large (max 10 MB)"` still hardcode the 10 MB figure that `MAX_UPLOAD_BYTES` owns. Extract a template.
2. **Better-Auth `basePath` override** (see caveat above).
3. **API-level test sign-up helper** — biggest remaining test-speed win (~5-8s on `make test`).
4. **`bddgen --incremental` caching** — marginal.
5. **Containerized full-app `docker compose up` demo** — separate scope.
6. **Prod-guard checks for DATABASE_URL + BETTER_AUTH_SECRET** (see caveat above).
7. **Add `PORT` and `NODE_ENV` to `.env.example`** — low priority.
8. **Agent-harness custom lint rule** in place of the Makefile grep for `process.env` — research.
9. **Loosen the barrel-check grep to exclude `@project/auth`** — it flags the legit root export; either rewrite the pattern or document as expected (currently documented).

## Files a successor should read first

1. `CLAUDE.md` (root) — updated Critical Rules.
2. `docs/superpowers/specs/2026-04-18-zero-conf-architecture-design.md` — decisions + rejected alternatives.
3. `docs/superpowers/plans/2026-04-18-zero-conf-architecture.md` — the plan that produced this.
4. `packages/env/src/{server,client}.ts` — the env boundary, Zod defaults.
5. `packages/db/src/index.ts` — Prisma client with explicit `datasources.db.url` for zero-conf.
6. `packages/api/src/domains/` — domain-split layout.
7. `packages/api/CLAUDE.md` — Transaction Rules + Append-Alpha convention.
8. `scripts/test-db.ts` + `scripts/print-test-env.ts` — test port derivation.
9. `packages/db/prisma.config.ts` — zero-conf fallback pattern (CLI side).
10. `apps/server/package.json` — `--env-file-if-exists` flag (zero-conf dev).
