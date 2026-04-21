---
title: "Repo Reorganization — .config/ + scripts/ split + packages/lint"
status: Approved
date: 2026-04-21
source: /Users/iorlas/Workspaces/agentic-web-stack/docs/repo-organization-research.md
scope: pure file-move + path-string refactor; no behavior change; rollback via `git revert`
---

# Repo Reorganization — Design

## 1. Purpose

Address root-dotfile sprawl (21 dotfiles) and `scripts/` genre-mix (16 enforcement scripts + 3 shell wrappers + 1 grit-plugins subdir + 5 dev/ops utilities, all flat).

Three-phase refactor, **all behavior preserving**. Each phase is independently committable and green at `make lint` / `make test-unit` end.

## 2. Phases (execute in order)

### Phase A — Relocatable configs → `.config/`

**Move these files** (tools all accept `--config` or equivalent; wiring updates per-tool):

| From | To | Script update |
|---|---|---|
| `.cspell.json` | `.config/cspell.json` | `lint:spell` adds `--config .config/cspell.json` |
| `.cspell/` | `.config/cspell/` | update `cSpell.customDictionaries` path in `.vscode/settings.json` |
| `.markdownlint-cli2.jsonc` | `.config/markdownlint.jsonc` | `lint:markdown` adds `--config .config/markdownlint.jsonc` |
| `.lychee.toml` | `.config/lychee.toml` | `scripts/run-lychee.sh` points to new path |
| `.jscpd.json` | `.config/jscpd.json` | `lint:jscpd` updates `--config` |
| `.dependency-cruiser.cjs` | `.config/dependency-cruiser.cjs` | `lint:depcruise` updates `--config` |
| `.prismalintrc.json` | `.config/prismalint.json` | `lint:prisma` — verify prisma-lint supports `--config`; if not, symlink |
| `.secretlintrc.json` | `.config/secretlint.json` | `lint:secretlint` adds `--secretlintrc` |
| `.secretlintignore` | `.config/secretlintignore` | `lint:secretlint` updates `--secretlintignore` |
| `.yamllint.yml` | `.config/yamllint.yml` | verify agent-harness supports; else leave |
| `.agent-harness.yml` | `.config/agent-harness.yml` | verify agent-harness supports; else leave |

**Move allowlists to `.config/allowlists/`:**
- `.duplicate-names-allow.json` → `.config/allowlists/duplicate-names.json`
- `.test-siblings-allow.json` → `.config/allowlists/test-siblings.json`
- `.scoped-landmarks-allow.json` → `.config/allowlists/scoped-landmarks.json`
- `.perspective-boundary.json` → `.config/allowlists/perspective-boundary.json`

Each corresponding `scripts/check-*.ts` updates its `ALLOWLIST` / config-path constant.

**Stay at root (anchored or exempt):**
`biome.json`, `turbo.json`, `knip.json`, `tsconfig.*`, `Makefile`, `package.json`, `pnpm-workspace*.yaml`, `pnpm-lock.yaml`, `.gitignore`, `.dockerignore`, `.env`, `.env.example`, `.pre-commit-config.yaml`, `Dockerfile`, `docker-compose*.yml`.

**Turbo cache note.** Every moved file changes the `inputs` hashes in `turbo.json`. Expect one full cold run after Phase A.

**Phase A acceptance:**
1. `make lint-force` — 30/30 green.
2. `ls` at root shows ~10 dotfiles (down from 21).
3. Each tool reads its new config (verify by breaking and restoring one config value per tool).
4. `.vscode/settings.json` updated: `cSpell.customDictionaries.project-words.path` points at the new location.

### Phase B — Split `scripts/` by purpose

**New layout:**
```
scripts/
  checks/
    check-adrs.ts
    check-domain-names.ts
    check-duplicate-names.ts
    check-env-example.ts
    check-no-barrel.ts
    check-no-cwd.ts
    check-perspective-boundary.ts
    check-pitch-coverage.ts
    check-scoped-landmarks.ts
    check-server-bind.ts
    check-stories-siblings.ts
    check-test-infra-integrity.ts
    check-test-siblings.ts
    check-trpc-patterns.ts
    checks-types.ts
    lint-state-machines.ts
    grit-plugins/
      import-type-for-app-router.grit
    __tests__/
      check-adrs.test.ts
      check-duplicate-names.test.ts
      check-no-barrel.test.ts
      check-perspective-boundary.test.ts
      check-pitch-coverage.test.ts
      check-scoped-landmarks.test.ts
      check-server-bind.test.ts
      lint-state-machines.test.ts
  wrappers/
    run-actionlint.sh
    run-lychee.sh
    run-shellcheck.sh
  dev/
    find-similar.ts
    generate-routes.ts
    kill-ports.ts
    healthcheck.ts
  seed/
    seed.ts
    seed-admin.ts
```

**Update surface:**
- Root `package.json` scripts: every `"lint:check:<name>": "bun scripts/check-<name>.ts"` → `"bun scripts/checks/check-<name>.ts"`. Similarly for `lint-state-machines`, `db:seed`, `run-*.sh`, etc.
- `turbo.json`: every `inputs` glob updates (e.g., `scripts/check-no-cwd.ts` → `scripts/checks/check-no-cwd.ts`, `scripts/checks-types.ts` → `scripts/checks/checks-types.ts`).
- `Makefile`: `db-seed` → `bun scripts/seed/seed.ts`; `kill-ports` calls → `scripts/dev/kill-ports.ts`; `similar` → `scripts/dev/find-similar.ts`; `healthcheck` references update.
- `biome.json`: `plugins` array path updates — `./scripts/grit-plugins/*.grit` → `./scripts/checks/grit-plugins/*.grit`.
- Internal imports: `checks-types` is imported by every check — stays next to them, so relative imports (`./checks-types.ts`) don't change.
- Test imports: `__tests__/check-*.test.ts` imports `../check-*.ts` — stays valid with the new layout.
- Root `CLAUDE.md` "Adding a new custom check" recipe: update to `scripts/checks/check-<name>.ts`.
- `docs/qa-strategy.md` references: update paths.

**Phase B acceptance:**
1. `make lint` 30/30 green.
2. `make test-unit` + `bun test scripts/checks/__tests__/` green.
3. `bun scripts/checks/check-<name>.ts` runs standalone for each check.
4. `Makefile` targets (`make db-seed`, `make similar`, etc.) all resolve.

### Phase C — Promote `scripts/checks/` to `packages/lint` workspace package

**Rationale:** 16 checks + `checks-types.ts` + tests + grit-plugins is package-shaped. Proper package gives: (a) dedicated `tsconfig.json` with stricter settings, (b) tests join the `@project/api` / `@project/web` test fan-out, (c) future extraction is `npm publish` away, (d) clearer dependency surface (`ts-morph`, `gray-matter`, `@cucumber/gherkin` move out of root).

**New layout:**
```
packages/lint/
  package.json                    # @project/lint, private, workspace:*
  tsconfig.json                   # extends tsconfig.base.json
  src/
    index.ts                      # re-exports each check + types (bare-entry barrel — justified; lint-only)
    checks-types.ts
    check-adrs.ts
    check-domain-names.ts
    check-duplicate-names.ts
    check-env-example.ts
    check-no-barrel.ts
    check-no-cwd.ts
    check-perspective-boundary.ts
    check-pitch-coverage.ts
    check-scoped-landmarks.ts
    check-server-bind.ts
    check-stories-siblings.ts
    check-test-infra-integrity.ts
    check-test-siblings.ts
    check-trpc-patterns.ts
    lint-state-machines.ts
    grit-plugins/
      import-type-for-app-router.grit
    __tests__/
      check-*.test.ts (8)
  bin/
    lint.ts                       # single CLI dispatcher: `lint-check <name>`
```

**`packages/lint/package.json`:**
```jsonc
{
  "name": "@project/lint",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    "./checks/adrs": { "default": "./src/check-adrs.ts" },
    "./checks/domain-names": { "default": "./src/check-domain-names.ts" },
    // ... one entry per check
    "./checks-types": { "default": "./src/checks-types.ts" }
  },
  "bin": {
    "lint-check": "./bin/lint.ts"
  },
  "scripts": {
    "test": "bun test src/__tests__/"
  },
  "dependencies": {
    "@cucumber/gherkin": "catalog:",
    "@cucumber/messages": "catalog:",
    "gray-matter": "catalog:",
    "ts-morph": "catalog:"
  },
  "devDependencies": {
    "@types/node": "catalog:"
  }
}
```

**Catalog migration:** move `@cucumber/gherkin`, `@cucumber/messages`, `gray-matter`, `ts-morph` out of root `devDependencies` into `pnpm-workspace.yaml` `catalog:` (if not already) + into `@project/lint` as real deps.

**CLI (`bin/lint.ts`):** thin dispatcher.
```ts
#!/usr/bin/env bun
import { checkNoBarrel } from "../src/check-no-barrel.ts";
// ... one import per check
const REGISTRY = { "no-barrel": checkNoBarrel, /* ... */ };
const name = process.argv[2];
const fn = REGISTRY[name as keyof typeof REGISTRY];
if (!fn) { console.error(`unknown check: ${name}`); process.exit(1); }
const res = await fn();
if (!res.ok) { for (const e of res.errors) console.error(e); process.exit(1); }
console.log(`[${name}] OK`);
```

**Root `package.json` scripts** (per-check still present, simpler form):
```jsonc
"lint:check:no-barrel": "pnpm --filter @project/lint exec lint-check no-barrel",
// ... one per check
```
Or single-CLI variant:
```jsonc
"lint:check": "pnpm --filter @project/lint exec lint-check"
```
And `turbo.json` tasks become `@project/lint#check:<name>` invocations. **Prefer the first form** — keeps per-check turbo input granularity.

**Turbo task updates:** each `//#lint:check:<name>` turbo task in `turbo.json` changes to reference the package's files:
```jsonc
"//#lint:check:no-barrel": {
  "inputs": [
    "packages/lint/src/check-no-barrel.ts",
    "packages/lint/src/checks-types.ts",
    "packages/*/package.json",
    "apps/*/src/**/*.{ts,tsx}",
    // ... same as before
  ]
}
```

**Makefile:** `TURBO_LINT_TASKS` unchanged in content (still `lint:check:no-barrel` tokens). Turbo resolves the underlying script.

**Fixture tests:** stay colocated at `packages/lint/src/__tests__/`. Invoked via `pnpm --filter @project/lint test` (Bun test). `make test-all` picks this up via existing turbo fan-out.

**`knip.json`:** update any entry points that referenced `scripts/check-*.ts`.
**`dependency-cruiser` config:** update any forbidden paths.
**`@project/lint` grit plugin** at `packages/lint/src/grit-plugins/import-type-for-app-router.grit`; update `biome.json` `plugins` array.

**Phase C acceptance:**
1. `make lint` 30/30 green.
2. `pnpm --filter @project/lint test` runs all 8 fixture tests.
3. `make test-unit` includes `@project/lint` fixture tests in turbo fan-out.
4. `bun packages/lint/bin/lint.ts no-barrel` works standalone.
5. Knip: no unused files under `packages/lint/`.

## 3. Out of scope

- Moving `apps/` / `packages/` / `e2e/` — already canonical.
- Moving docs — already organized under `docs/`.
- Changing any test logic — pure moves.
- Adding new checks — separate spec.
- Changing `.env*` or env handling — ADR-002 owns that.
- Restructuring Docker files — convention + COPY-path rewrites; not worth it.

## 4. Dispatch strategy

One subagent, sequentially Phase A → B → C, committing per phase. Each phase commit keeps `make lint` green. If any phase fails, halt and report.

Brief the subagent with:
- Branch `repo-reorganization` off current main.
- "Do NOT use `git worktree` — create a branch on the shared tree."
- "Verify `make lint` green after EACH phase commit, not just the end."
- "Commit with structured messages: `refactor(config): Phase A — relocate configs to .config/`, etc."

## 5. Rollback

Each phase is a single commit (or small sequence). `git revert <sha>` undoes one. The refactor is pure file moves + path-string updates — no semantic changes.

## 6. Post-merge verification

After Phase C merges:
1. `make lint-force` (no cache) — 30/30 green.
2. `make test-all` — every suite green.
3. Root `ls` shows ≤10 dotfiles.
4. `ls scripts/` shows 4 buckets, no files directly in `scripts/`.
5. `pnpm ls --filter @project/lint` shows the new package.
6. Fresh clone: `make setup && make lint` green without manual steps.

## 7. References

- `docs/repo-organization-research.md` — the 3-option survey that led here.
- `CLAUDE.md` — "Adding a new custom check" recipe (updates in Phase B + C).
- `docs/qa-strategy.md` — references check paths (updates in Phase B).
- `docs/adrs/0002-configuration-patterns.md` — complements; doesn't conflict.
