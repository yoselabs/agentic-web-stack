# Repo Organization — Research + Proposals

> Research only. No restructuring lands until a proposal is approved.
> Audience: template maintainer + AI agents that read this repo cold.

## 1. The observation

After WS1–WS5 landed, the root and `scripts/` have accumulated:

- **21 root dotfiles + dotdirs** (`.agent-harness.yml`, `.cspell.json`, `.cspell/`, `.dependency-cruiser.cjs`, `.dockerignore`, `.duplicate-names-allow.json`, `.env`, `.env.example`, `.gitignore`, `.jscpd.json`, `.lychee.toml`, `.markdownlint-cli2.jsonc`, `.perspective-boundary.json`, `.pre-commit-config.yaml`, `.prismalintrc.json`, `.scoped-landmarks-allow.json`, `.secretlintignore`, `.secretlintrc.json`, `.tanstack`, `.test-siblings-allow.json`, `.yamllint.yml`).
- **10 root non-dot configs** that resolve from cwd by tool default: `biome.json`, `knip.json`, `turbo.json`, `tsconfig.base.json`, `tsconfig.json`, `Dockerfile`, `docker-compose.{yml,dev.yml,test.yml,prod.example.yml}`, `Makefile`, `package.json`, `pnpm-workspace.yaml`, `pnpm-workspace.prod.yaml`, `pnpm-lock.yaml`.
- **`scripts/` flat mix of 5 genres**: 16 lint/enforcement scripts + their `__tests__/` + 1 `grit-plugins/` + 3 shell wrappers + 5 dev/ops utilities (`seed.ts`, `seed-admin.ts`, `generate-routes.ts`, `kill-ports.ts`, `healthcheck.ts`, `find-similar.ts`).

The cost isn't bytes — it's **cognitive load on first read**. An agent or contributor dropping into the repo has to filter "which of these 21 dotfiles do I care about *for this task*?" Every sprawl item is a tiny decision the reader pays.

## 2. What gets moved vs what's anchored to root

Some tool configs are **resolver-anchored** — the tool only looks at cwd root (possibly walking up), and moving the file either breaks the integration or requires wiring a `--config` flag everywhere the tool runs.

**Anchored (don't move):**
- `biome.json` — Biome resolves from cwd. Moving breaks Biome LSP in editors.
- `turbo.json` — Turborepo resolves from repo root. Hard requirement.
- `knip.json` — Knip resolves from cwd; supports `--config` but IDE plugins don't.
- `tsconfig.json` + `tsconfig.base.json` — TypeScript project references resolve relative paths. Every `tsconfig.json` in `apps/`, `packages/` references `../../tsconfig.base.json`. Moving = rewiring every reference.
- `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml` — pnpm hard requirement.
- `Makefile` — `make` is cwd-based.
- `Dockerfile` + `docker-compose*.yml` — convention. Docker Compose resolves `./` paths from the compose-file location; moving means updating every `COPY` and volume mount.
- `.gitignore`, `.dockerignore` — git / docker hard requirement at each level.
- `.env`, `.env.example` — `@project/env` currently reads `process.env` directly; also convention.

**Movable (support `--config` flag; minor path fix per call site):**
- `.cspell.json` + `.cspell/` — cspell `--config <path>`.
- `.markdownlint-cli2.jsonc` — markdownlint-cli2 `--config <path>`.
- `.lychee.toml` — `lychee --config <path>`.
- `.jscpd.json` — `jscpd --config <path>` (already passed explicitly).
- `.dependency-cruiser.cjs` — `depcruise --config <path>` (already passed).
- `.prismalintrc.json` — prisma-lint `--config <path>`.
- `.secretlintrc.json` + `.secretlintignore` — secretlint `--secretlintrc <path>` + `--secretlintignore <path>` (ignore already passed).
- `.yamllint.yml` — yamllint `-c <path>` (but invoked via agent-harness which may resolve implicitly — verify).
- `.agent-harness.yml` — check if agent-harness supports custom path.

**Data files, not tool configs (movable without coordinating with a tool):**
- `.duplicate-names-allow.json`, `.test-siblings-allow.json`, `.scoped-landmarks-allow.json`, `.perspective-boundary.json` — read by our own `scripts/check-*.ts`; we control the lookup path.

## 3. Patterns from reference monorepos (2025–2026)

Quick survey of repos with similar scale (Vite/Turbo/pnpm-workspace stacks):

- **Vercel's Turborepo examples, `create-turbo`** — root stays busy; `apps/` + `packages/` is sacred; one-off configs stay at root. No `.config/` dir. Opinion: "the noise is the price of being a monorepo."
- **Cal.com** — root has ~15 dotfiles; moved internal scripts into a `tools/` workspace package (publishable internally). Scripts directory `./packages/config/` holds shared ESLint/Prettier/TS configs. Allowlists remain at root.
- **Midday** — root has ~12 dotfiles; `scripts/` at root holds dev helpers only (~8 files), and quality-enforcement scripts live under `packages/typescript-config` + `packages/lint-config`.
- **Unkey** — uses a `.config/` dir for relocatable configs (markdownlint, cspell, others). Root still has ~10 dotfiles for anchored tools. Scripts split by purpose under `scripts/`.
- **Linear CLI** (smaller, less relevant) — flat.
- **Shopify's Polaris, Vercel's Next.js** — too large to be useful baselines.

**Two canonical patterns emerge:**

1. **`.config/` relocation** (Unkey, some Cal.com code paths) — movable configs under `.config/`. Root shrinks ~8-10 files. Wiring: pass `--config .config/<name>` in each `lint:*` script. Low risk, modest visual win.
2. **`tools/` or `packages/lint` workspace package** (Cal.com, Midday) — enforcement scripts become a proper workspace package with tsconfig, tests colocated, a dedicated CLI (`pnpm --filter @project/lint <check>`). Higher setup cost, bigger payoff if you ship 20+ checks or want to extract them for reuse elsewhere.

## 4. Three concrete proposals (ordered by effort)

Each proposal is independent — you can take one without the others.

### Proposal A — `.config/` relocation (low effort, ~1 hour)

**Move to `.config/`:**
- `.cspell.json` → `.config/cspell.json`
- `.cspell/` → `.config/cspell/`
- `.markdownlint-cli2.jsonc` → `.config/markdownlint.jsonc`
- `.lychee.toml` → `.config/lychee.toml`
- `.jscpd.json` → `.config/jscpd.json`
- `.dependency-cruiser.cjs` → `.config/dependency-cruiser.cjs`
- `.prismalintrc.json` → `.config/prismalint.json`
- `.secretlintrc.json` + `.secretlintignore` → `.config/secretlint.json` + `.config/secretlintignore`
- `.yamllint.yml` → `.config/yamllint.yml` (if agent-harness supports custom path; else leave)
- `.agent-harness.yml` → `.config/agent-harness.yml` (verify)

**Move to `.config/allowlists/`:**
- `.duplicate-names-allow.json`
- `.test-siblings-allow.json`
- `.scoped-landmarks-allow.json`
- `.perspective-boundary.json`

**Change surface:**
- Update each `lint:<name>` script in root `package.json` with `--config .config/<file>`.
- Update corresponding `turbo.json` `inputs` globs (`.config/<file>` replaces the dot-prefixed name).
- Update each `scripts/check-*.ts` that reads an allowlist — one path constant per file.
- Update `CLAUDE.md` + area docs that reference old paths.

**Stays at root (anchored or exempted):**
- `biome.json`, `turbo.json`, `knip.json`, `tsconfig.*`, `Makefile`, `package.json`, `pnpm-workspace*.yaml`, `pnpm-lock.yaml`.
- `Dockerfile`, `docker-compose*.yml`, `.dockerignore`.
- `.env`, `.env.example` (convention + `@project/env` looks at cwd).
- `.gitignore` (hard requirement).
- `.pre-commit-config.yaml` (prek convention; has `--config` flag but every fork contributor would re-learn this).

**Root after:** ~10 dotfiles (down from 21). Clear signal: "these are the tools that genuinely anchor to root; everything else lives in `.config/`."

**Pros:**
- Root `ls` becomes readable.
- Single directory (`.config/`) tells a newcomer "this is where tool configs live."
- Easy rollback — `git mv` is trivial.
- Zero behavior change. Turbo cache, CI, pre-commit hooks all work identically.

**Cons:**
- 9–10 script entries to update. Each `--config` flag is extra chars to type mentally.
- Some editors (depcruise VSCode plugin, others) assume root-level config — may need per-editor settings.
- One extra indirection when reading "which config rules this tool?" (but `grep -r .config/ package.json` answers it).

### Proposal B — Split `scripts/` by purpose (low effort, ~1 hour)

**Current:**
```
scripts/
  check-*.ts (14 files)
  checks-types.ts
  lint-state-machines.ts
  __tests__/ (8 files)
  grit-plugins/ (1 file)
  run-actionlint.sh
  run-lychee.sh
  run-shellcheck.sh
  find-similar.ts
  generate-routes.ts
  kill-ports.ts
  healthcheck.ts
  seed.ts
  seed-admin.ts
```

**Proposed:**
```
scripts/
  checks/                       # 16 enforcement scripts + grit + tests
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
      check-*.test.ts (8)
  wrappers/                     # shell wrappers for optional binaries
    run-actionlint.sh
    run-lychee.sh
    run-shellcheck.sh
  dev/                          # developer utilities
    find-similar.ts
    generate-routes.ts
    kill-ports.ts
    healthcheck.ts
  seed/                         # ops / seeding
    seed.ts
    seed-admin.ts
```

**Change surface:**
- Update each `lint:check:<name>` script in `package.json` with new path.
- Update each `turbo.json` task's `inputs` path.
- Update any internal cross-imports (checks-types is imported by all checks; path becomes relative and stays one level up from `checks/`, no import-source change if we keep checks-types in `checks/`).
- `make` targets referencing `scripts/seed.ts`, `scripts/kill-ports.ts`, etc. update.
- `Makefile` one-line updates for `db-seed`, `kill-ports` invocations.
- Update root `CLAUDE.md` "Adding a new custom check" recipe with the new path.

**Pros:**
- `ls scripts/` shows 4 clearly-named buckets, not 25 files.
- "Where does this kind of script live?" has a one-second answer.
- New contributors know exactly where to drop a new check vs a new dev tool.
- `scripts/checks/` becomes a natural candidate for a future `packages/lint` promotion (Proposal C) without another move.

**Cons:**
- ~20 path updates across `package.json`, `turbo.json`, `Makefile`, CLAUDE.md.
- `bun scripts/check-X.ts` muscle memory breaks for anyone used to the old path. Small cost, one-time.
- The `grit-plugins/` reference in `biome.json` `plugins` array updates.

### Proposal C — `scripts/checks/` → `packages/lint` workspace package (higher effort, ~3 hours)

**What changes:**
- Promote check scripts to `packages/lint/`.
- Dedicated `packages/lint/tsconfig.json` (extends base; stricter types across the check codebase).
- Each check remains a bun-executable file but with proper ESM imports (`import { timeCheck } from "./checks-types"` → importing from within the same package).
- Fixture tests move to `packages/lint/src/__tests__/` and run via `bun test` under a `packages/lint/package.json#scripts.test`. They join the `@project/api` / `@project/web` test pass.
- Root `package.json` script becomes `"lint:check:<name>": "bun --filter @project/lint run check:<name>"` (or a single CLI `pnpm --filter @project/lint run check <name>`).
- Optional: publish a single CLI `pnpm --filter @project/lint exec check-all` for local iteration.

**Pros:**
- Proper workspace package treatment (tsconfig, tests, isolated dependencies).
- Extraction ready — if the checks become useful to other projects, they're one `npm publish` away.
- Fixture tests run in the existing `make test-unit` turbo fan-out for free.
- Clearer import graph (`checks-types.ts` becomes a legitimate module export).

**Cons:**
- One more workspace package to think about.
- Per-check `package.json#scripts` or a single-CLI dispatcher to maintain.
- Some tools currently scan `scripts/` directly (knip, dependency-cruiser, maybe others) — config updates needed.
- Minor install overhead (one more package's node_modules resolved).

**When it's worth it:**
- When check count crosses ~20 and/or non-trivial shared logic emerges.
- When you want to extract enforcement for reuse in other templates/projects.
- Not clearly justified today at 16 checks.

## 5. What I'd actually recommend

**Ship A + B together. Skip C for now.**

Rationale:
- A + B are each ~1 hour, together maybe 2 hours. Both pure reorg — no behavior change, rollback-trivial.
- Root ls goes from 30+ entries to ~15. `scripts/` goes from one bucket to four named buckets. Cognitive load drops a noticeable tick for every future contributor (and every agent session).
- C is a real package refactor and adds ceremony without a concrete near-term payoff. Defer until the check count or extraction pressure justifies it.

**Sequencing:**
1. Do A first (configs + allowlists to `.config/`). Commit. Run `make lint` to confirm all 30 tasks still pass.
2. Do B second (`scripts/` split). Commit. Run `make lint` + `make test-unit` + `bun test scripts/__tests__/...` (new paths).
3. Update root `CLAUDE.md` "Adding a linter" + "Adding a check" recipes with the new canonical paths. One commit.

**Risks to watch:**
- Editor integrations (Biome LSP, depcruise extensions, Prettier-style auto-discovery) — verify nothing breaks on a fresh clone.
- Pre-commit hook cache — turbo's input hashes change for every config file's new path; expect one full cold-run after the move.
- Any third-party contributor or agent with a hardcoded `scripts/check-X.ts` path in a fork.

## 6. What's deliberately out of scope

- `biome.json`, `turbo.json`, `knip.json`, `tsconfig.*`, `Makefile`, `package.json`, pnpm files — all anchored.
- Docker files — convention plus COPY-path rewrites. Not a readability problem worth reorganizing.
- `.gitignore`, `.pre-commit-config.yaml`, `.env*` — convention. Moving fights ecosystem defaults.
- Reorganizing `docs/` — already well-structured (adrs/, superpowers/specs/, root docs).
- Reorganizing `apps/`, `packages/`, `e2e/` — already canonical.

## 7. Decision log (to be filled when chosen)

- [ ] Proposal A approved: `___` (date)
- [ ] Proposal B approved: `___` (date)
- [ ] Proposal C approved (or explicitly deferred): `___` (date)

Once chosen, a follow-up spec at `docs/superpowers/specs/YYYY-MM-DD-repo-reorganization.md` will capture the exact move list, dispatchable to a subagent or implemented directly.
