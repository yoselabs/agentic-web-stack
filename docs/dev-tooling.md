# Dev Tooling

The build, lint, test, and enforcement layer. Largely **stack-agnostic** —
most of this survives a runtime-stack rewrite (an Effect-TS or Java port
would still use Make, turbo, pnpm, prek, and most of the lint/test
philosophy unchanged).

Companion docs:
- [`tech-stack.md`](./tech-stack.md) — *runtime* dependencies (the part that gets replaced when porting).
- [`capabilities.md`](./capabilities.md) — what the system does at the application level.

Versions are exact at tag `stable-pre-effect`.

---

## 1. Package management & monorepo

- **pnpm** `10.32.1` — package manager + workspace. Invoked by: `make setup`, every install/run.
- **pnpm-workspace.yaml** — workspace member list + **catalog** (single source of truth for shared dependency versions; packages reference `catalog:`).
- **turbo** `2.9.6` — task runner with input-hash caching. Invoked by: `make lint` (orchestrates all `lint:*` tasks via `turbo run`), `make test`. Cache makes warm runs <1s.
- **@turbo/gen** `2.9.6` — code-generation scaffold. Invoked by: `pnpm run new:feature`.

## 2. Type system

- **typescript** `6.0.3` — type checker. Invoked by: `make lint` (via `tsc -b` on project references), `make fix` (after Biome). Project-reference layout means each package compiles incrementally.
- **tsconfig.base.json** — strictest settings; per-package `tsconfig.json` extends and adds `references`.

## 3. Lint / format

### Single-tool linters (root scripts → turbo tasks → make)

- **@biomejs/biome** `2.4.12` — formatter + linter (TS/JS/JSON/CSS/MD). Invoked by: `make lint` (`lint:biome`), `make fix` (write mode).
- **prisma-lint** `0.13.1` — Prisma schema linter. Invoked by: `make lint` (`lint:prisma`).
- **knip** `6.6.1` — dead-code finder (unused exports/files). Invoked by: `make lint` (`lint:knip`).
- **jscpd** `4.0.9` — copy-paste detector. Invoked by: `make lint` (`lint:jscpd`).
- **sherif** `1.11.1` — monorepo dep version drift checker. Invoked by: `make lint` (`lint:sherif`).
- **publint** `0.3.18` — `package.json#exports` correctness. Invoked by: `make lint` (per-package `lint:publint`).
- **dependency-cruiser** `17.3.10` — import-boundary rules between packages. Invoked by: `make lint` (`lint:depcruise`).
- **gherkin-lint** `4.2.4` — Gherkin syntax/structure. Invoked by: `make lint` (`lint:gherkin`).
- **secretlint** `12.2.0` — credential/secret scanner. Invoked by: `make lint` (`lint:secretlint`).
- **markdownlint-cli2** `0.22.1` — Markdown style. Invoked by: `make lint` (`lint:markdown`).
- **cspell** `10.0.0` — spell check (code + docs). Invoked by: `make lint` (`lint:spell`).

### On-demand (slow, not in default `make lint`)

- **eslint** `10.2.1` + **typescript-eslint** `8.59.0` — typed lint (deprecated-API detection, etc.). Invoked by: `make lint-deep` (~15s, 8GB heap).

### Optional (wrapped — no-op if binary absent)

- **shellcheck** — shell-script linter. Wrapper: `scripts/wrappers/run-shellcheck.sh`. Invoked by: `make lint` (`lint:shell`).
- **lychee** — Markdown link checker. Wrapper: `scripts/wrappers/run-lychee.sh`. Invoked by: `make lint` (`lint:links`).
- **actionlint** — GitHub Actions workflow linter (with Docker fallback). Wrapper: `scripts/wrappers/run-actionlint.sh`. Invoked by: `make lint` (`lint:actionlint`).

### Custom checks (`packages/lint/src/check-*.ts`)

Project-specific rules that no off-the-shelf linter catches. Each check is a
`bun`-runnable TS file; each gets its own turbo task with narrow `inputs`
(only reruns when scope changes).

| Check | Purpose |
|---|---|
| `check-no-barrel.ts` | Block barrel imports of `@project/env` and `@project/api` (forces explicit subpaths) |
| `check-server-bind.ts` | Hono must bind `0.0.0.0`, not `localhost` (Docker correctness) |
| `check-domain-names.ts` | Cross-layer domain naming symmetry (frontend feature == backend domain == e2e folder) |
| `check-trpc-patterns.ts` | tRPC router/procedure shape rules |
| `check-test-infra-integrity.ts` | Test-infra env / port allocation correctness |
| `check-feature-emails.ts` | Email templates referenced by features actually exist |
| `check-duplicate-names.ts` | Detect accidental duplicate function/component/hook names |
| `check-no-cwd.ts` | Reject `process.cwd()` in source (breaks worktree relocation) |
| `check-test-siblings.ts` | Hooks have co-located `*.test.ts` |
| `check-stories-siblings.ts` | UI widgets have co-located `*.stories.tsx` |
| `check-env-example.ts` | `.env.example` matches `@project/env` schema |
| `check-adrs.ts` | ADR references in code resolve to actual files |
| `lint-state-machines.ts` | Validate state-machine definitions in Gherkin |
| `check-pitch-coverage.ts` | Each pitch requirement maps to a Gherkin scenario |
| `check-scoped-landmarks.ts` | Playwright landmark usage follows scoping rules |
| `check-perspective-boundary.ts` | Client/server perspective separation |

Adding a new custom check is a 4-line change (see root `CLAUDE.md#adding-a-new-custom-check`). Built on **ts-morph** `28.0.0`.

## 4. Testing

- **vitest** `4.1.5` — unit/integration runner with project-based config (unit / storybook / browser). Invoked by: `make test-unit`.
- **@vitest/browser** `4.1.5` — real-Chromium component tests. Invoked by: `make test-browser` (`*.browser.test.tsx`, opt-in for jsdom-blind bugs — see ADR-0007).
- **happy-dom** `20.9.0` — DOM for default unit project (`*.test.tsx`).
- **@testing-library/react** `16.3.2` — component testing utilities.
- **@testing-library/user-event** `14.6.1` — user-interaction simulation.
- **@storybook/addon-vitest** `10.3.5` — runs `*.stories.tsx` as smoke tests in the Vitest pipeline.
- **playwright** *(in `e2e/`)* — browser automation.
- **playwright-bdd** *(in `e2e/`)* — Gherkin → Playwright transpiler. Generates into `e2e/.features-gen/` via `bddgen`.
- **eslint-plugin-playwright** `2.10.2` — Playwright rule pack (e2e-only ESLint scope).
- **bun test** — runner for `packages/api` and a few infrastructure-heavy unit suites (real Postgres + Redis, no mocks). Invoked by: `make test-unit`.
- **@project/test-infra** *(workspace package)* — test harness: dynamic port allocation per worktree, isolated test Postgres per suite (`unit-suite` / `e2e-suite`), Docker lifecycle, env builders.

## 5. Build / dev server

- **vite** *(via TanStack Start)* — dev server + bundler for `apps/web`.
- **@tanstack/router-generator** `1.166.32` — generates `routeTree.gen.ts`. Invoked by: `make routes` (manual), or auto on `vite dev` via `@tanstack/router-plugin` `1.167.22`.
- **prisma** *(client generator)* — runs as a `db-generate` make prereq for `dev`, `test`, `lint`, and `fix`. Output: `packages/db/src/generated/`.

## 6. Git hooks & enforcement

- **prek** — pre-commit/pre-push hook manager (Rust port of pre-commit, fast). Installed by `make setup`. Config: `.pre-commit-config.yaml`.
  - **pre-commit** — read-only gate: `make lint` (turbo-cached, identical to CI). No `--no-verify` (blocked by `.claude/settings.json`).
  - **pre-push** — belt-and-braces: `make fix` → `make lint`, fails if fix produced a diff.
- **agent-harness** — AI quality-gate orchestrator (writes config + ratchet allowlists, wraps Biome/typecheck for the `make fix` flow). Config: `.agent-harness.yml`.
- **Claude Code Stop / SubagentStop hooks** — auto-run `make fix` at turn end so the next turn starts clean. (Configured in `.claude/settings.json`.)

## 7. Developer ergonomics

- **Makefile** — single entry point. Targets: `setup`, `dev`, `lint`, `lint-verbose`, `lint-force`, `fix`, `test`, `test-unit`, `test-browser`, `smoke`, `routes`, `db-push`, `db-generate`, `similar`. Silent on success; errors only.
- **scripts/dev/generate-routes.ts** — TanStack Router tree regenerator (no dev server needed).
- **scripts/dev/kill-ports.ts** — clears 3000/3001 if dev was killed uncleanly.
- **scripts/dev/find-similar.ts** — reuse advisor (writes `.similar-report.json`; surfaces near-duplicate function/component/hook/type names with signatures).
- **scripts/seed/seed.ts** — DB seed runner.
- **scripts/wrappers/** — optional-binary wrappers (see §3 above).

## 8. CI

- **.github/workflows/ci.yml** — two jobs:
  - **check** — `make lint` (full quality gate). Runs on PR + push.
  - **test** — depends on `check`. Runs unit suites + Playwright BDD against an isolated Postgres + Redis (Docker services).

GitHub Actions runners: ubuntu-latest. Node version pinned via `.nvmrc` /
`engines.node` (≥22).

## 9. Quality-gate model (5-line summary)

1. **`make lint`** is the canonical gate — orchestrated by `turbo run`, ~30 cached tasks (Biome, tsc, custom checks, secretlint, etc.). Warm runs hit cache; <1s.
2. **`make fix`** is the explicit transform step — runs Biome write + import sort + tsc. Separate from `lint` so lint is read-only.
3. **pre-commit** runs `make lint` (read-only) — enforces, doesn't mutate.
4. **pre-push** runs `make fix` then `make lint` — fails the push if fix produced a diff (forces an explicit "fix-up" commit, no silent rewrites).
5. **CI** is the same `make lint` + tests — no divergence between local and remote.

---

## What survives a runtime-stack swap

If the runtime tier (TanStack Start / Hono / tRPC / Prisma / BullMQ) is
rewritten — e.g., end-to-end Effect-TS, or a Kotlin/Spring port — most of
this layer stays:

| Tool | Survives? | Notes |
|---|---|---|
| Make + turbo + pnpm workspace | ✓ | Orchestration is language-agnostic |
| prek hooks | ✓ | Hook config swaps the *commands* it runs |
| Custom `packages/lint` checks | partial | Domain-naming, ADR, pitch-coverage, env-example checks survive. tRPC-pattern + perspective-boundary become stack-specific |
| Biome | TS-only | Replaced if porting to non-TS |
| tsc | TS-only | Replaced by target language's type checker |
| Vitest / bun test | TS-only | Replaced by JUnit / pytest / etc. |
| Playwright + playwright-bdd | ✓ | Browser automation is stack-free |
| Gherkin features (`e2e/features/`) | ✓ | The behavioral contract is the BDD specs |
| `@project/test-infra` | partial | Port-allocation + Docker patterns survive; env builders are TS-specific |
| secretlint, markdownlint, cspell, lychee, actionlint, shellcheck | ✓ | Repo-level, language-agnostic |

The **Gherkin specs in `e2e/features/`** plus the [`capabilities.md`](./capabilities.md) document together form the stack-agnostic contract. Everything else can be replaced.
