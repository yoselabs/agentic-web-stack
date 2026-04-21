# @project/lint

Enforcement scripts with fixture tests. One check per file; `bin/lint.ts` is the dispatcher.

- `src/check-*.ts` — 14 check scripts (regex + AST-based guards). Each exports a `run*` or `check*` function and has a standalone `import.meta.main` runner for `bun` invocation.
- `src/lint-state-machines.ts` — BDD Gherkin state-machine guard (historical name).
- `src/checks-types.ts` — `CheckResult` type + `timeCheck()` wrapper used by every check.
- `src/grit-plugins/` — Biome grit plugins loaded via `biome.json`.
- `src/__tests__/` — Bun fixture tests (run via `pnpm --filter @project/lint test`).
- `bin/lint.ts` — name → file dispatcher for `pnpm --filter @project/lint exec lint-check <name>`.

## Adding a check

See root `CLAUDE.md` § "Adding a new custom check".

## Invariants enforced

See `docs/qa-strategy.md` for the invariant → tool map.
