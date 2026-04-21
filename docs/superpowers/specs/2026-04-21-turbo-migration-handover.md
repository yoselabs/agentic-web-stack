# Handover — Turbo migration + linter expansion

**Session date:** 2026-04-21
**Branch state:** main, everything uncommitted (~30 files modified, ~10 new files).
**Lint status:** 15/17 turbo tasks pass. 2 failures (biome:lint + biome:format) = pre-existing issues in test files, **surfaced by turbo's fresh cache**. Decision pending — see §4.

---

## 1. What this session accomplished

Built on top of a prior session's work (rate-limit package, Prisma modernization, env.IS_TEST, docker-compose.prod.example.yml, 8 external linters wired). This session added:

### 1.1 Turborepo migration (Pattern A — root-only tasks)

- **`turbo.json`** with 17 tasks. All lint tasks are root-only (`//#lint:X` syntax) — no per-package `lint` / `typecheck` scripts anywhere. Packages only have the genuinely divergent scripts (`test`, `db-generate`).
- Decision rationale: user wants "AI as monkey" UX. Adding a new package = zero lint setup. Adding a new linter = one entry in turbo.json + one root script + one Makefile token.
- `.gitignore` updated with `.turbo/`.

### 1.2 Makefile collapsed to thin turbo wrapper

- `make lint` = `turbo run $(TURBO_LINT_TASKS) --output-logs=errors-only --log-order=grouped`. Silent on success (cache hit → ~0.3s wall, full repo re-run → ~6s).
- `make lint-verbose` = full output.
- `make lint-force` = `--force` (bypass cache).
- Removed old per-target phonies (`lint-biome`, `lint-tsc`, etc.) — everything goes through turbo.

### 1.3 Pre-commit routes through `make lint`

- `.pre-commit-config.yaml` simplified: pre-commit = `make lint`. Pre-push = `make fix` → `make lint` + no-drift assertion. Same quality gate as CI — no divergence.

### 1.4 Custom checks → per-check turbo tasks

- **Retired** `scripts/checks.ts` aggregator. Each `scripts/check-*.ts` is now its own turbo task with narrow `inputs`.
- **Kept** `scripts/checks-types.ts` (shared `CheckResult` + `timeCheck()`).
- 7 custom checks:
  - `check-no-barrel` (reads each `package.json`, scans imports)
  - `check-server-bind` (apps/server/src/index.ts)
  - `check-domain-names` (folder parity across 4 dirs)
  - `check-trpc-patterns` (apps/web/src scan)
  - `check-test-infra-integrity` (test-infra + compose + Zod schema cross-ref)
  - `check-feature-emails` (e2e/features uniqueness)
  - `check-duplicate-names` (NEW this session — see §1.6)
- Each has root script `lint:check:<name>` and turbo task `//#lint:check:<name>`.

### 1.5 `find-similar.ts` advisory tool (from prior subagent)

- `make similar` → ts-morph-based extraction + Jaro-Winkler clustering. Writes markdown + `.similar-report.json`. Advisory-only; not wired into lint.
- 23 groups / 51 items on current repo. Useful for AI reuse discovery.

### 1.6 `check-duplicate-names` (NEW — the monkey-guard)

- **Problem**: AI agents re-implement functions/components under slightly different paths. User wanted a HARD commit block so agents notice the collision before committing.
- **File**: `scripts/check-duplicate-names.ts` (~260 lines, pure regex + Jaro-Winkler, no ts-morph dep).
- **Respects `.gitignore`** via `git ls-files -z "*.ts" "*.tsx"`.
- **Policy**:
  - HARD fail: exact-name + same-kind collision across files (e.g., two `createTodo` functions in different packages).
  - HARD fail: similar name (JW ≥0.9), same kind, for `function`/`component`/`hook`.
  - Advisory only: similar names on `type`/`class`. Printed, not blocking.
  - Same-file clusters skipped (legitimate paired patterns like `publishX`/`publishY`).
  - `apps/web/src/routes/**` skipped (TanStack Router's `Route` export is framework-mandated).
- **Allowlist**: `.duplicate-names-allow.json` — forces `reason` ≥10 chars per entry. 9 current entries (parent/child CRUD, CASL rules, tRPC routers, auth UI pairs). AI hitting the block must either rename OR add allowlist entry WITH reason.
- **Why custom, not off-the-shelf**: surveyed ESLint/Biome/knip/ts-prune/jscpd — none do cross-file exported-name clustering. Niche check, custom is right.

### 1.6.1 `turbo prune` evaluated, not adopted

- Pruned `apps/server` target → 9 packages, 20M output, per-app Docker image size drop ~20-40%.
- **Not adopted now** — adds build complexity (per-app Dockerfile or parameterization). Logged as future improvement.

### 1.7 CLAUDE.md updated with new patterns

- "Adding a new linter" — 3-line recipe.
- "Adding a new custom check" — 5-line recipe.
- "Adding a new package" — zero lint setup, just genuinely divergent scripts.

---

## 2. File manifest — what's new vs modified

### New files
- `turbo.json` — full pipeline config.
- `scripts/check-duplicate-names.ts` — the monkey-guard.
- `.duplicate-names-allow.json` — 9 legitimate similarity entries with reasons.
- (prior session, not yet committed) `scripts/find-similar.ts`, `scripts/checks-types.ts`, `scripts/check-no-barrel.ts`, `scripts/check-server-bind.ts`, `scripts/run-actionlint.sh`, `scripts/__tests__/check-*.test.ts`, `packages/rate-limit/**`, `packages/api/src/rate-limit-middleware.ts`, `apps/server/src/webhooks/example.ts`, `apps/worker/src/handlers/todo-purge.ts` (RETIRED — inlined into `maintenance.ts`), `docker-compose.prod.example.yml`, `DEPLOYMENT.md`, `docs/upstream-watch.md`, `docs/adrs/0002-configuration-patterns.md`, `.dependency-cruiser.cjs`, `.jscpd.json`, `.prismalintrc.json`, `.secretlintrc.json`, `.secretlintignore`, `knip.json`, `packages/api/src/__tests__/env-test-mode.test.ts`, `packages/api/src/domains/todo-list/__tests__/todo-purge.test.ts`, `scripts/grit-plugins/import-type-for-app-router.grit`.

### Retired / deleted files
- `scripts/checks.ts` (aggregator — redundant with turbo orchestration)
- `scripts/grit-plugins/no-barrel-imports.grit` (replaced by `check-no-barrel.ts`)
- `scripts/grit-plugins/process-env-boundary.grit` (redundant with Biome's `noProcessEnv`)
- `apps/worker/src/handlers/todo-purge.ts` (inlined into `maintenance.ts` for pattern consistency)

### Modified (key ones)
- `Makefile` — collapsed lint to turbo wrapper.
- `package.json` — added 17 turbo lint scripts + turbo devDep + ts-morph + jscpd.
- `.pre-commit-config.yaml` — routes pre-commit through `make lint`.
- `biome.json` — added grit plugin config, `.claude/worktrees` and `*.grit` excludes, `src/generated` exclude.
- `CLAUDE.md` + area CLAUDE.mds — reflect new patterns, Grit plugin references removed in favor of `check-*.ts` scripts.
- `packages/env/src/server.ts` — `env.IS_TEST` via Proxy (VITEST || TEST_MODE only — no NODE_ENV fallback).
- `packages/test-infra/src/index.ts` — emits `TEST_MODE=1`, not `NODE_ENV=test`.
- `packages/db/prisma/schema/base.prisma` + `packages/db/src/index.ts` — new `prisma-client` generator → `src/generated/`.
- `packages/api/src/domains/todo-list/todo-router.ts` — rate-limiter gated on `!env.IS_TEST`.

### Worktrees
- None left — all cleaned up at session end.

---

## 3. Lint numbers

- `make lint` cold: **~6s** (17 tasks, 0 cached)
- `make lint` warm (all cached): **~0.3s**, "FULL TURBO"
- `make lint` incremental (1 TS file changed): **~3-4s** (9/17 cached typical)
- Pre-commit on trivial commit: **~1s** via cache hit

---

## 4. Decision pending — blocks `make lint` green

Turbo's fresh cache surfaced **pre-existing biome lint violations** in two test files (commit `45cfac0`, before this session):
- `packages/api/src/__tests__/email-retry.test.ts:95,107,115` — `lint/style/noNonNullAssertion` on `job.id!` (BullMQ's return type has `id: string | undefined` but the runtime guarantees presence after `.add()`).
- `packages/api/src/authz/__tests__/authz.test.ts:32,46` — `lint/suspicious/noExplicitAny` on `asSubject` calls.

Also: `scripts/check-duplicate-names.ts` had a `useIterableCallbackReturn` issue (forEach returning push result) — **fixed this session**. That was the only lint error I introduced.

**Three options to unblock:**
1. Add `// biome-ignore lint/style/noNonNullAssertion: ...` / `lint/suspicious/noExplicitAny: ...` comments at each site (~5 surgical fixes).
2. Add a `biome.json` override for `**/__tests__/**` + `**/*.test.ts` disabling `noNonNullAssertion` + `noExplicitAny` (standard convention — tests legitimately use both).
3. Rewrite the tests to avoid the patterns (most work, dubious value).

**Recommendation: option 2.** Test files legitimately use non-null assertion (third-party type edges like BullMQ) and `any` (asSubject generic constraints).

No auto-fix was performed this session per user discipline ("lint reports; fix is separate").

---

## 5. Recommended next steps (after the §4 decision)

1. **Apply §4 decision** (likely option 2). Verify `make lint` green.
2. **Add fixture tests for `check-duplicate-names.ts`** at `scripts/__tests__/check-duplicate-names.test.ts`. Follow the pattern of `scripts/__tests__/check-no-barrel.test.ts`:
   - Good case: no duplicates → ok
   - Hard-fail case: two files exporting `createFoo` → errors
   - Similar-fail case: `useFoo` + `useFooBar` in different files → errors
   - Allowlist case: same as similar-fail but with allowlist entry → ok
3. **Commit everything** — this is a big, cohesive refactor. Single commit or split into: (a) turbo migration, (b) Pattern A consolidation, (c) duplicate-names check, (d) docs reconciliation.
4. **Consider addressing the advisory** `InviteCollaboratorResult` vs `InviteCollaboratorVars` — still prints at every lint run. Either rename `InviteCollaboratorVars` → `InviteEmailTemplateVars` for clarity, or allowlist with a reason.
5. **Eventually**: evaluate `turbo prune` for production Docker image size reduction (see `docs/upstream-watch.md` + `DEPLOYMENT.md`).

---

## 6. Context + conventions the new session needs

### 6.1 User discipline rules
- **Lint reports; fix is separate.** Never auto-fix as part of lint. `make fix` is explicit; `Stop` hook also runs it at turn end.
- **No `--no-verify` on commits/pushes.** Blocked in `.claude/settings.json`.
- **Don't run `make fix` mid-task** unless recovering from a commit rejection. The hook handles it.
- **Never read `process.env` outside `@project/env`.** Enforced by Biome's `noProcessEnv`.
- **Subpath-only imports for `@project/env` + `@project/api`.** Enforced by `check-no-barrel.ts` (reads each package's `exports` field — self-maintaining).
- **Append-alpha router registration** in `packages/api/src/router.ts`.
- **Ports**: web 3000, server 3001. Test ports derived by hash in `packages/test-infra`.

### 6.2 Turbo / make / linter patterns
- `make lint` = `turbo run` with `--output-logs=errors-only`. If something fails, use `make lint-verbose` to see full output.
- Adding a new linter: entry in `turbo.json` + root script in `package.json` + append to `TURBO_LINT_TASKS` in Makefile. **No per-package changes.**
- Adding a new custom check: copy `scripts/check-server-bind.ts` structure (exports `check<Name>()` + `if (import.meta.main)` CLI guard).

### 6.3 The duplicate-names check — how to interact with it
- Run `make lint` locally — fails if the check fires.
- When blocked: **first consider renaming**. The whole point is to force distinguishing names.
- If the similarity is genuinely legitimate (parent/child CRUD, canonical framework pattern, paired UI components), add an entry to `.duplicate-names-allow.json` with a `reason` ≥10 chars. AI MUST articulate WHY.
- Advisory output (types) prints during lint but doesn't fail — AI should still consider whether those clusters indicate refactor opportunity.

### 6.4 Branch state at handover
- Branch: `main`
- Base of comparison: `6bc288d150ba0431348bf45837cc8608c7c390af` (start of session)
- Nothing committed. `git status` shows ~40 files changed.
- `make lint` exits 1 due to §4; everything else green.

---

## 7. Files to read first in the new session

1. This handover doc.
2. `turbo.json` — see the 17 tasks.
3. `Makefile` (top half) — see the thin wrapper.
4. `.duplicate-names-allow.json` — see the allowlist pattern.
5. `scripts/check-duplicate-names.ts` — if adding new similarity logic.
6. Root `CLAUDE.md` "Adding a linter / custom check" section (near bottom) — the recipes.

---

## 8. Anti-patterns to avoid

- **Do NOT** add `"lint"` or `"typecheck"` scripts to individual `packages/*/package.json` or `apps/*/package.json`. That's Pattern B, rejected this session. Root-only (Pattern A).
- **Do NOT** bypass the allowlist by weakening `SIMILARITY_THRESHOLD` in `check-duplicate-names.ts`. The whole point is the forced `reason`.
- **Do NOT** put new infrastructure into `packages/config/`. ADR-002 forbids that package. Four homes: `@project/env` for runtime env, domain `constants.ts` for rules, `packages/test-infra` for tests, literals-duplicated for infra ports.
- **Do NOT** use `bash grep`, `find`, `cat` when Grep/Glob/Read tools are available. Same for AI subagents — propagate the discipline in their prompts.
