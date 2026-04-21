# Agentic Web Stack

Monorepo: TanStack Start (frontend) + Hono (API server) + tRPC + Prisma + PostgreSQL + Better-Auth.

## Structure

- `apps/web/` — TanStack Start (Vite SSR) on port 3000
- `apps/server/` — Hono API server on port 3001 (binds `0.0.0.0`)
- `apps/worker/` — BullMQ worker + cron handlers (email, todo-purge, maintenance)
- `packages/api/` — tRPC router + context (shared types)
- `packages/auth/` — Better-Auth config
- `packages/db/` — Prisma schema + client (prisma-client generator → `src/generated/`)
- `packages/email/` — email templates + send adapter
- `packages/env/` — @t3-oss/env-core validated env vars
- `packages/jobs/` — BullMQ queue definitions
- `packages/rate-limit/` — rate-limiter-flexible wrappers (Redis + memory)
- `packages/realtime/` — Channel abstraction (MemoryChannel + RedisChannel)
- `packages/test-infra/` — test-harness env / ports / docker helpers (Node-only)
- `packages/ui/` — shadcn/ui components
- `e2e/` — playwright-bdd (Gherkin specs + step definitions)

Each directory with a CLAUDE.md has area-specific guidance. Read it before working there.

## Conventions

Canonical cross-cutting conventions live in `docs/conventions.md`. Read
the relevant section before writing code that touches the area.

- **Realtime event naming** — domain-prefixed event kinds. See [docs/conventions.md#realtime-event-naming](docs/conventions.md#realtime-event-naming).
- **Event shape — payload vs notification** — pick one shape per kind; don't mix. See [docs/conventions.md#event-shape--payload-vs-notification](docs/conventions.md#event-shape--payload-vs-notification).
- **Event kinds SSOT** — const tuple → derived type, never the reverse. See [docs/conventions.md#event-kinds-ssot](docs/conventions.md#event-kinds-ssot).
- **Web app Vitest project selection** — `*.test.tsx` → unit (happy-dom); `*.stories.tsx` → storybook (chromium); `*.browser.test.tsx` → browser (chromium, opt-in for jsdom-invisible bugs). See [docs/conventions.md#web-app-vitest-project-selection](docs/conventions.md#web-app-vitest-project-selection) and `docs/qa-strategy.md` §3.4.

## Commands

- `make setup` — zero-conf: installs deps, starts Postgres, pushes schema, installs pre-commit hooks
- `make dev` — start both web and server
- `make check` — alias for `make lint`
- `make lint` — full quality gate (MUST pass before claiming done). Orchestrated by turbo (`turbo run lint:*` with input-hash caching). Silent on success, errors only — keeps logs tight. Warm runs hit cache and finish in <1s.
- `make lint-verbose` — same as `make lint` but with full per-task output (debugging).
- `make lint-force` — bypass turbo cache, force a fresh run.
- `make fix` — auto-fix lint issues + typecheck. **Separate from `make lint`.** Lint is read-only (reports what's wrong); fix is the explicit transform step. The `Stop` / `SubagentStop` hooks run `make fix` at turn end automatically.
- `make test` — BDD tests (isolated e2e-suite Postgres, dynamic port per worktree — see `packages/test-infra`). Pass filters via `ARGS`:
  - `make test ARGS="--grep 'Create a todo'"` — scenarios matching a title regex
  - `make test ARGS="--grep Authentication"` — all scenarios in a feature
  - `make test ARGS="--project desktop"` — skip the mobile viewport (faster inner loop)
  - `make test ARGS="--headed"` — watch the browser drive the test
  - ARGS is forwarded to `playwright test` verbatim; see `e2e/CLAUDE.md`.
- `make test-unit` — unit/integration tests (isolated unit-suite Postgres, dynamic port per worktree — see `packages/test-infra`)
- `make test-browser` — real-Chromium component tests (`*.browser.test.tsx`). Opt-in for bugs jsdom can't see — image `naturalWidth`, CSS layout, clipboard. See ADR-0007.
- `make smoke` — `@smoke`-tagged BDD subset against `BASE_URL` (non-hermetic; for deployed-env sanity checks)
- `make routes` — regenerate TanStack Router route tree without starting dev server
- `make db-push` — push Prisma schema to database
- `make db-generate` — regenerate Prisma client
- `make similar` — advisory reuse-finder: reports similarly-named functions / components / hooks / types with signatures + paths. **Before creating a new function/component, run `make similar` (or read `.similar-report.json`) to check for existing reuse opportunities.**

**Pre-commit** (read-only): routes through `make lint` (turbo-cached, same quality gate as CI — no divergence). Most commits hit cache and complete in <1s while still enforcing the full gate. **Pre-push** (belt-and-braces): `make fix` → `make lint`, failing if fix produced a diff.
Never truncate lint or test output — read the full error.

## Adding a linter / adding a package — the zero-drift rules

**Adding a new linter (external tool):**
1. One entry in `turbo.json` under `tasks` (as `//#lint:<name>`) with `inputs` globs scoped to what the tool reads.
2. One root `lint:<name>` script in `package.json`.
3. Append `lint:<name>` to `TURBO_LINT_TASKS` in `Makefile`.

**Shell-wrapper pattern for optional binaries.** When a linter depends on a binary that may not be installed locally or in CI (e.g. `lychee`, `shellcheck`, `actionlint`), wrap it in `scripts/run-<name>.sh` that checks `command -v <tool>` and prints a `[lint:<name>] <tool> not installed — skipping` line + `exit 0` when absent. Root script points at the wrapper (`"lint:<name>": "./scripts/run-<name>.sh"`). This keeps `make lint` green on fresh machines while still enforcing the check where the binary is present (devs with brew, CI job with the tool installed). See `scripts/run-actionlint.sh` / `scripts/run-lychee.sh` / `scripts/run-shellcheck.sh` for the canonical form.

**Adding a new custom check** (in `scripts/check-*.ts`):
1. Create `scripts/check-<name>.ts`:
   - Export `check<Name>(): Promise<CheckResult>` using `timeCheck()` from `scripts/checks-types.ts`.
   - Add `if (import.meta.main) { ... process.exit(result.ok ? 0 : 1) }` for standalone runs.
2. Append `"lint:check:<name>": "bun scripts/check-<name>.ts"` to root `package.json` scripts.
3. Add `//#lint:check:<name>` turbo task in `turbo.json` with **narrow** `inputs` — only the files this check actually scans. Per-check granularity means only that one check reruns when its scope changes.
4. Append `lint:check:<name>` to `TURBO_LINT_TASKS` in `Makefile`.
5. Optional: add fixture test in `scripts/__tests__/check-<name>.test.ts`.

No per-package edits, no per-package script duplication.

**Adding a new workspace package:** zero lint setup required. The root-level linters already scan the whole repo; the new package is covered automatically. The only per-package scripts packages may need are the genuinely divergent ones — `test` (different runners per package), `build` (where it produces output), `db-generate` (only `packages/db`).

**Why this works:** linters in this repo are uniform — `biome check .` / `tsc -b` / `knip` / etc. all operate on the whole tree. Root-only orchestration + input-hash caching gives plug-and-play scaling.

## Development Workflow (BDD-first, Vertical Slices)

Features are built as vertical slices within domain groups. A domain group is a cluster of related Prisma models that serve one user-facing capability (e.g., Board + Column + Card).

For each domain group:

1. **Write Gherkin scenarios** — behavior contract for ALL features in the domain group
2. **Schema** — all Prisma models for the domain group, `make db-push`
3. **Backend (batched)** — all services + routers + Vitest for the domain group → API GREEN
4. **Frontend (per feature)** — hook + components + route + step defs + BDD → GREEN per feature

Step definitions are written AFTER the UI exists (Phase 3), not before. The Gherkin spec is the source of truth, but step defs need real HTML to reference correct selectors.

See `docs/superpowers/specs/2026-04-12-development-cycle-handover.md` for the full process spec.

For testing approach — unit vs BDD, the multi-user browser-context pattern for real-time features, and common gotchas — see `docs/testing-guidelines.md`.

## Package Naming

All workspace packages use `@project/*` prefix (e.g., `@project/api`, `@project/db`).

## Cross-Layer Naming

A domain's name is reused across every layer it touches. The layer terminology differs — web calls them *features* (FSD), API calls them *domains* (DDD) — but the name is the same.

| Layer | Path template |
|---|---|
| Web | `apps/web/src/features/<name>/` |
| API | `packages/api/src/domains/<name>/` |
| E2E features | `e2e/features/<name>/` |
| E2E step defs | `e2e/steps/<name>/` |

A new capability lands under the same `<name>` in every layer it touches.

**Enforced by** `scripts/check-domain-names.ts` (runs via `make lint`). Asymmetric-by-design domains (backend-only `auth`, frontend-only `mobile-nav`) are hard-coded in the script's allowlist. If you add a new asymmetric domain, extend the allowlist rather than silencing the check.

## Critical Rules

- **Single source of truth (SSOT) — where it matters.** Values that genuinely change (domain rules, Zod schemas, Prisma types) live in exactly one place and are imported everywhere. Values that are constants-forever (dev ports, local DB creds) are literals duplicated across the 3-4 infra files that need them — SSOT prevents drift, which requires change, and these values don't change.
  - **No barrel imports for `@project/env` and `@project/api`** — must use explicit subpaths (`@project/env/server`, `@project/api/domains/todo-list/todo-service`). Enforced by `scripts/check-no-barrel.ts`. Barrels would pull server-only env / tRPC server code into client bundles. `@project/auth` and `@project/db` **do** expose a `.` entry (auth re-exports the Better-Auth `auth` instance server-side; db re-exports the generated PrismaClient) and are deliberately excluded from the Grit rule.
  - **Runtime env vars** → `@project/env` (the only module that reads `process.env`; `/server` and `/client` subpaths). Zod defaults provide dev values so zero-conf boot works without a `.env` file.
  - **Domain constants** (upload limits, password rules, status enums) → a `constants.ts` inside the owning domain (e.g., `packages/api/src/domains/todo-list/todo-constants.ts`, `packages/auth/src/constants.ts`). Client imports via the domain's subpath export.
  - **Infra constants** (dev ports `3000`/`3001`/`5432`, DB name `"app"`, user `"postgres"`) → literal in `docker-compose.yml`, `Makefile`, `.github/workflows/ci.yml`, and Zod defaults in `packages/env/src/server.ts`. Not in a shared package. Rationale: [ADR-002](docs/adrs/0002-configuration-patterns.md).
  - **Test infrastructure** (dynamic test DB/web/API ports per worktree) → `packages/test-infra`. Consumers import `testDbEnv()`. Not in `@project/env`.
  - **Type definitions** → infer from Prisma (`@project/db`) or tRPC (`inferRouterOutputs<AppRouter>`); never redeclare a shape that already exists.
  - **Validation rules** → one Zod schema, used by both server routers and client forms.
  - **Dependency versions** → `catalog:` in `pnpm-workspace.yaml`.

  When writing new code, ask: "is this value or shape also used elsewhere?" If yes, find the owning domain/boundary and import from there. If the value genuinely never changes (a literal port number), it's OK to duplicate across 3-4 infra files.
- **Never use `verbatimModuleSyntax` in apps/web** — causes server bundle leaks in TanStack Start
- **Always use `import type` for AppRouter** — value imports bundle the server into the client
- **One `initTRPC.create()` call** — in `packages/api/src/trpc.ts` only
- **QueryClient must be per-request on server** — see `getQueryClient()` in `apps/web/src/router.tsx`
- **TanStack Start is NOT Next.js** — use `createServerFn`, not `getServerSideProps` or `"use server"`
- **Run `make lint` before claiming work is done** — runs both `agent-harness lint` and `tsc -b`
- **Never use `--no-verify` on commits or pushes.** The pre-commit hook is now read-only (lint + tsc, no fix) — if it fails, fix the underlying issue. Bypassing it is blocked by `.claude/settings.json` permissions.deny and will surface as a tool-call rejection.
- **Don't run `make fix` mid-task unless you're recovering from a commit rejection.** The Claude Code `Stop` / `SubagentStop` hooks run `make fix` at turn end automatically. If you do run fix during a turn (e.g., after a commit failed on formatting), re-Read every file you plan to edit next before editing — the fixer may have rewritten content.
- **When dispatching subagents via the Agent tool, include this tool-use discipline in the prompt:**
  - Use the **Grep tool** for pattern search, not `bash grep -rn`. Use **Glob**, not `find`. Use **Read**, not `cat`. They're cached, faster, and don't spawn a process.
  - If making multiple edits to one file, batch them into a **single MultiEdit** call. Don't chain individual Edits with verification calls (`make lint`, tests) between them — saves ~10 tool calls per iteration on heavily-edited files.
  - Run `make fix` / `make lint` / tests **once after all writes to a file are done**, not between individual edits. If `make fix` rewrites anything, re-Read before continuing.

## Generated Files (do not edit)

- `apps/web/src/routeTree.gen.ts` — auto-generated by TanStack Router plugin on `vite dev`
- `e2e/.features-gen/` — auto-generated by `bddgen` from Gherkin feature files
- `node_modules/` — managed by pnpm

## Common Mistakes

| Mistake | Why it breaks | Fix |
|---------|--------------|-----|
| Import `appRouter` value in client | Bundles entire server into browser | Use `import type { AppRouter }` |
| Create multiple `initTRPC.create()` | Type mismatches between routers | Single instance in `packages/api/src/trpc.ts` |
| Add `verbatimModuleSyntax: true` to apps/web | Server code leaks into client bundle | Explicitly set to `false` in apps/web/tsconfig.json |
| Edit `routeTree.gen.ts` | Overwritten on next `vite dev` | Edit route files in `src/routes/` instead |
| Use `navigate()` during React render | React setState-in-render warning | Use `useEffect` for conditional navigation |
| Hardcode localhost URLs | Breaks in non-local environments | Use env vars: `VITE_API_URL`, `CORS_ORIGIN`, `BETTER_AUTH_URL` |
| Create QueryClient as module singleton | Leaks data between SSR requests | Use `getQueryClient()` pattern (per-request on server) |
| Skip `prisma generate` after schema change | Stale types, runtime errors | `make dev`, `make test`, `make test-unit`, `make lint`, `make fix` all auto-regenerate via `db-generate` prereq. Run `make db-push` when you also need to push the new schema to the dev DB |
| `Link to` rejects not-yet-created routes | TanStack Router types from `routeTree.gen.ts` | Use `to={"/path" as string}` temporarily, remove once route exists and `make dev` regenerates |
| `//` in JSX text content | Biome `noCommentText` flags as comment | Wrap in expression: `<p>{"https://example.com"}</p>` |
| `<Link>` wrapping `<Button>` | Nested `<a><button>` breaks accessibility and BDD click handlers | Use `<Button asChild><Link to="...">Text</Link></Button>` — renders single `<a>` element |
| `setQueryData` callback type errors with tRPC | tRPC's `queryKey` type inference breaks on `onMutate` callback parameter | Define explicit types for query data shape (see optimistic updates guide in `apps/web/CLAUDE.md`) |
| Use `PointerSensor` for DnD touch support | `PointerSensor` consumes Chrome DevTools simulated touch events, blocking `TouchSensor` | Use `MouseSensor` + `TouchSensor` instead of `PointerSensor` + `TouchSensor`, add `touch-action: none` to draggable items |
| Run `agent-harness lint` directly instead of `make lint` | `agent-harness lint` alone passes but `tsc -b` catches implicit `any`, missing imports, type mismatches | Use `make lint` (runs both `agent-harness lint` + `tsc -b`). Pre-commit hook also enforces this |
| Read `process.env.X` outside `packages/env/` | Bypasses Zod validation; env schema changes don't propagate; caught by `make lint` grep check | Import `env` from `@project/env/server` (or `/client` for web) and read `env.X` |
| Import from `@project/env` or `@project/api` without a subpath | No barrel export; the top-level path doesn't resolve. Enforced by `scripts/check-no-barrel.ts`. Same class of bug as `import { appRouter }` | Use subpath: `@project/env/server`, `@project/api/domains/todo-list/todo-service`. (`@project/auth` / `@project/db` barrel imports are allowed — they're excluded from the Grit rule.) |
| Create `.env` for dev before running `make dev` | Zero-conf: `@project/env` has Zod defaults for every var. A `.env` is for *overriding* defaults, not required to boot | Just run `make setup && make dev` — no `.env` needed |
| Add a shared `@project/config`-like package for dev ports | SSOT drift prevention only pays off when values change. Dev ports don't | Hardcode literals in Makefile / compose / CI + Zod default in env |

## Library Skills (@tanstack/intent)

Libraries in this project ship AI agent skills — SKILL.md files with setup guides,
code patterns, and **common mistakes** that prevent AI-generated bugs.

**Before modifying any library integration**, discover and read the relevant skill:

```
pnpm exec @tanstack/intent list
```

Find the skill matching your task, then **read its SKILL.md** — especially the
"Common Mistakes" section. Do this after adding new dependencies too.

<!-- intent-skills:start -->
<!-- Dynamic discovery via `pnpm exec @tanstack/intent list` — no static mappings needed -->
<!-- intent-skills:end -->
