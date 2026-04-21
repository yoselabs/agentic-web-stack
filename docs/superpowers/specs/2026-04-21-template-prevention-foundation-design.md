---
title: "Template Prevention Foundation"
status: Proposed
date: 2026-04-21
source: /Users/iorlas/Workspaces/a2sdlc-demo3/docs/superpowers/specs/2026-04-21-template-prevention-stack-handover.md
scope: template-ambient — ships before any domain exists, inherited by every project forked from the template
---

# Template Prevention Foundation — Design

## 1. Purpose

Turn the prevention-stack handover (18 decisions from `a2sdlc-demo3`) into one installed layer on this template. Filter: **only items that benefit every future project** — domain-specific code (self/others shape, client-derived primitive, signed-URL attachments) is documented as convention, not pre-built.

**Design principle, inherited:** *documented = checked*. Every invariant the template relies on is enforced by types, Grit, `scripts/check-*.ts`, or a test harness — never by human diligence alone.

## 2. Decision log (filter + mechanism)

| # | Handover item | Verdict | Mechanism |
|---|---|---|---|
| 3 | Vitest in `apps/web` | ship | vitest.config.ts + test harness |
| 4 | tRPC mocking via cache-seeding | absorbed into WS2 | `renderWithTRPC(ui, seed)` helper |
| 5 | Fake timers (`vi.useFakeTimers` w/ `toFake`) | absorbed into WS2 | shared harness in `apps/web/test/time.ts` |
| 6 | `@project/test-infra/fixtures` subpath | ship | new subpath export |
| 7 | Storybook 9 + addon-vitest + addon-a11y | ship | @storybook/react-vite |
| 8 | `turbo gen feature` scaffolding | ship | turbo/generators |
| 10a | `check-test-siblings` | ship | `scripts/check-test-siblings.ts` |
| 10b | `check-stories-siblings` | ship | `scripts/check-stories-siblings.ts` |
| 11 | MADR `verified_by` + `@adr` cites | ship | `scripts/check-adrs.ts` |
| 12 | `@state-machine` Gherkin linter | ship | `scripts/lint-state-machines.ts` |
| 13 | Slot-typed `Navbar`/`AppShell`/`Sidebar` | ship | tsc-enforced via required `slots` prop |
| 14 | Pitch `ui_elements:` front-matter check | ship | `scripts/check-pitch-coverage.ts` |
| 15 | Scoped landmark queries in BDD | ship | Grit plugin; fallback `scripts/check-scoped-landmarks.ts` |
| 17 | Vitest browser-mode `*.browser.test.tsx` | ship | vitest.browser.config.ts + `make test-browser` |
| 18 | `absPath()` env helper + `process.cwd()` ban | ship | `packages/env/src/paths.ts` + `scripts/check-no-cwd.ts` |
| 9 | `perspective-boundary` (generic) | ship, opt-in | Grit plugin; fallback `scripts/check-perspective-boundary.ts`, config-driven |
| 1 | `{ self, others }` API perspective shape | document | `docs/conventions.md` new section |
| 2 | `derived.ts` client primitive | stub + document | `packages/realtime/src/derived.ts` with unit tests; no call sites |
| 16 | Signed-URL attachments | document | `DEPLOYMENT.md` + `docs/conventions.md` |

**Biome translation rule (applies to #9, #15):** attempt the rule as a Biome Grit plugin under `scripts/grit-plugins/*.grit`. If Grit cannot express the pattern (e.g., cross-statement context, whole-file absence checks), fall back to a `scripts/check-*.ts` with narrow turbo inputs. Both mechanisms already have CI wiring and fixture-test patterns in this repo.

## 3. Architecture — where things land

```
apps/web/
  vitest.config.ts                      # WS2
  vitest.browser.config.ts              # WS6
  test/
    setup.ts                            # WS2  (testing-library setup)
    render.tsx                          # WS2  (renderWithTRPC helper)
    time.ts                             # WS2  (fake-timers harness)
  .storybook/
    main.ts                             # WS5
    preview.tsx                         # WS5  (withTRPC decorator)
  src/widgets/navbar/navbar.tsx         # WS4  (slots-typed)
  src/widgets/app-shell/app-shell.tsx   # WS4  (slots-typed)
  src/widgets/sidebar/sidebar.tsx       # WS4  (slots-typed)

packages/
  env/src/paths.ts                      # WS1  (absPath() + REPO_ROOT)
  test-infra/src/fixtures/              # WS1  (new subpath export)
    users.ts
    index.ts                            # barrel exempt (test-infra is test-only)
  realtime/src/derived.ts               # WS7  (stubbed primitive)
  realtime/src/__tests__/derived.test.ts

scripts/
  check-test-siblings.ts                # WS1
  check-stories-siblings.ts             # WS1
  check-adrs.ts                         # WS1
  lint-state-machines.ts                # WS1
  check-pitch-coverage.ts               # WS1
  check-no-cwd.ts                       # WS1
  check-scoped-landmarks.ts             # WS1  (only if Grit falls back)
  check-perspective-boundary.ts         # WS1  (only if Grit falls back)
  grit-plugins/
    scoped-landmark-queries.grit        # WS1  (primary)
    perspective-boundary.grit           # WS1  (primary)
  __tests__/
    check-*.test.ts                     # WS1  (fixture test per check)

turbo/
  generators/
    config.ts                           # WS3
    templates/*.hbs                     # WS3

docs/
  conventions.md                        # WS7  (append sections)
  adrs/
    0003-web-test-runner.md             # WS2
    0004-ui-shell-slots.md              # WS4
    0005-env-path-anchoring.md          # WS1
```

Each new `scripts/check-*.ts` follows the existing recipe (CLAUDE.md "Adding a new custom check") — turbo task with narrow inputs, appended to `TURBO_LINT_TASKS` in `Makefile`. Zero per-package changes.

## 4. Workstreams

Seven workstreams. Five run in parallel (phase 1). Two depend on WS2 (phase 2).

### WS1 — Ambient guards (no deps; large fan-out, each item narrow)

One subagent per check, all parallel. Each check follows the same template (see `scripts/check-no-barrel.ts`): exports `runX(root)` taking repo root as arg, `__tests__/check-x.test.ts` uses a temp-dir fixture, root script + turbo task + Makefile token.

**Checks:**

- **`absPath()` + `process.cwd()` ban (#18)** — `packages/env/src/paths.ts` exports `absPath()` Zod helper that resolves relative paths against the nearest `pnpm-workspace.yaml` (discovered once at import time). Existing path-valued env vars in `packages/env/src/server.ts` migrate to `absPath()`. `scripts/check-no-cwd.ts` greps for `process.cwd()` in non-`scripts/` source and fails. Exempt paths: `scripts/**`, `packages/env/src/paths.ts` itself.
- **`check-test-siblings` (#10a)** — every `apps/web/src/**/use-*.ts(x)` (excluding `.test.*`, `.stories.*`) must have a sibling `.test.ts(x)`. Turbo inputs: `apps/web/src/**/use-*.{ts,tsx}`.
- **`check-stories-siblings` (#10b)** — every `apps/web/src/widgets/**/[name].tsx` (excluding index/test/story) must have a sibling `[name].stories.tsx`. Turbo inputs: `apps/web/src/widgets/**/*.{ts,tsx}`. Check is inert until WS5 lands (no widgets break today); ships ready to fire.
- **`check-adrs` (#11)** — MADR front-matter parser. For each `docs/adrs/*.md` with `status: accepted`: require ≥1 `verified_by:` file; each file must exist AND contain `ADR-NNNN` or `@adr NNNN`. Bidirectional: every `@adr NNNN` in source must resolve to an existing ADR. Uses `gray-matter`.
- **`lint-state-machines` (#12)** — Gherkin parser over `e2e/features/**/*.feature`. Feature tagged `@state-machine(a,b,c)` must have a scenario per state tagged `@state:a`, `@state:b`, `@state:c`. Uses `@cucumber/gherkin@^28`.
- **`check-pitch-coverage` (#14)** — pitches under `docs/requirements/pitches/**/pitch.md` with `status: shipped` and `ui_elements:` front-matter must have each element covered by a `@ui:<element>` tag in some `.feature` file. Bidirectional. Inert if no pitches exist.
- **`test-infra/fixtures` subpath (#6)** — add `./fixtures` subpath to `packages/test-infra/package.json` exports. Seed with `users.ts` (one `seedUser(db, email)` helper). Document contract: fixtures take `db` as parameter, never read a module-level client. Not a barrel — subpath exports only.
- **Grit: `perspective-boundary.grit` (#9)** — Grit pattern flagging `$row.$field` accesses where `$field` is configurable per-project. Ships unconfigured in this template (no domain has a "self-varying" field yet); the plugin is wired with an empty ruleset, and the companion doc in `docs/conventions.md` explains how to opt in. If Grit cannot express per-file exemption cleanly, ship `scripts/check-perspective-boundary.ts` instead, reading config from `.perspective-boundary.json`.
- **Grit: `scoped-landmark-queries.grit` (#15)** — Grit pattern flagging `page.getByTestId(...)`, `page.getByText(...)`, `page.getByRole(...)` at the top level of `e2e/steps/**/*.ts`, exempted by a preceding line `// placement-agnostic:`. If Grit cannot match the "preceding comment" exemption or "top-level call" context, fall back to `scripts/check-scoped-landmarks.ts` doing regex extraction with a 3-line-above comment scan.

**Grit probe step (must happen first in WS1):** before writing either plugin, a subagent builds a one-file Grit prototype for each rule and verifies it matches/misses the intended fixture. If the prototype fails, the workstream switches that item to a script. Document the decision in a short note appended to this spec.

### WS2 — Vitest in `apps/web` (gate opener; no deps; blocks WS5, WS6)

`apps/web/vitest.config.ts` `mergeConfig`'s `vite.config.ts` with `environment: "happy-dom"`, `setupFiles: ["./test/setup.ts"]`, `globals: false`. `test/setup.ts` imports `@testing-library/jest-dom/vitest` + installs `afterEach(cleanup)`. `test/render.tsx` exports `renderWithTRPC(ui, seed?)` — creates a per-test `QueryClient` with `retry: false, gcTime: Infinity`, optionally seeds cache via tRPC `queryOptions().queryKey`, wraps in `<QueryClientProvider>`.

`apps/web/package.json` adds `"test": "vitest run"`. `Makefile` `make test-unit` target is extended to `turbo run test --filter=@project/api --filter=@project/web` (runs Bun-test for api, Vitest for web, in parallel).

Also ships `apps/web/test/time.ts` — a fake-timers harness exporting `withFakeTimers({ toFake: [...] })` that defaults to the explicit `["setInterval", "setTimeout", "Date", "performance"]` list (avoids React 19 scheduler breakage from the default `queueMicrotask` fake). Every hook test that exercises time imports from there.

No tests are written this workstream beyond a smoke test asserting the harness loads. Real test coverage comes as features land — enforced by `check-test-siblings` (WS1).

ADR-0003 documents: Vitest (not Bun) for web; Bun retained for `packages/api`. Rationale inherited from handover (React 19 + RTL interop, Vite plugin reuse, fake timers).

### WS3 — `turbo gen feature` scaffolding (no deps)

`turbo/generators/config.ts` registers a `feature` generator prompting for `{ name: kebab }`. It emits 9 files from handlebars templates:

- `apps/web/src/features/{{name}}/use-{{name}}.ts(.test.ts)`
- `apps/web/src/widgets/{{name}}-panel/{{name}}-panel.tsx` + `.stories.tsx`
- `packages/api/src/domains/{{name}}/{{name}}-service.ts` + `{{name}}-router.ts` + `__tests__/{{name}}-service.test.ts`
- `e2e/features/{{name}}/{{name}}.feature`
- `e2e/steps/{{name}}/{{name}}.steps.ts`

Templates include empty `@adr` placeholders, a passing smoke-test each, and import skeletons that satisfy `check-test-siblings` + `check-stories-siblings` from birth. Root script: `"new:feature": "turbo gen feature"`.

### WS4 — Slot-typed shell components (no deps)

Refactor `apps/web/src/widgets/navbar/navbar.tsx`, `app-shell/app-shell.tsx`, `sidebar/sidebar.tsx` from `children`-based composition to a required `slots: { key: ReactNode }` prop. Each slot the shell renders is a typed key; optional slots are `?`-marked. Omitting a required slot is a `tsc -b` error.

Slot keys are chosen by each shell's current composition — this is a refactor, not a redesign. Existing call sites are updated to pass `slots={{...}}` literally listing every current affordance. The verbosity at call sites is the point: dropped UI elements become loud.

ADR-0004 documents the pattern so future shells follow suit.

### WS5 — Storybook 9 (depends on WS2)

`@storybook/react-vite@^9`, `@storybook/addon-vitest`, `@storybook/addon-a11y` installed in `apps/web`. `.storybook/main.ts` enables both addons. `.storybook/preview.tsx` ships a `withTRPC` decorator mirroring WS2's `renderWithTRPC`.

One exemplar: `navbar.stories.tsx` enumerates `Default`, `AdminActions`, `LoggedOut`. Serves as the pattern `check-stories-siblings` (WS1) enforces on future widgets.

Visual regression: `lost-pixel@^3` wired as `make visual-regression` (manual, not in `make lint` — too slow for the edit-loop). Baseline images checked in, gitignored diff dir.

`make test` is extended to run the SB addon-vitest suite alongside BDD.

### WS6 — Vitest browser-mode (depends on WS2)

`apps/web/vitest.browser.config.ts` runs files matching `src/**/*.browser.test.tsx` in real Chromium via `@vitest/browser` + `playwright`. `make test-browser` target runs it. Exemplar: one `.browser.test.tsx` asserting an `<img>` loads (`naturalWidth > 0`) — serves as the reference when a project adds an attachment-like feature.

Scope is narrow: reserved for components touching real browser behavior (images/media, CSS layout, clipboard). jsdom stays the default.

### WS7 — Conventions docs + `derived.ts` stub (no deps)

`docs/conventions.md` gains sections:

- **API perspective shape** — when a domain has "self-varying" data, use `{ self, others }` at the tRPC boundary (reference: `presence` bug in predecessor). Include the example. Opt-in per domain.
- **Client-derived state** — reference the `packages/realtime/src/derived.ts` stub. API sketch + how to configure the `perspective-boundary` opt-in.
- **Cross-origin media** — signed short-TTL URLs only; never `crossOrigin="use-credentials"` on `<img>` in user-facing code. One paragraph + code sketch.
- **BDD placement scoping** — `page.getByRole('navigation').getByTestId(...)` over bare `page.getByTestId(...)`. Reference the Grit/script enforcement.

`packages/realtime/src/derived.ts` ships a real `createDerivedSource<T>({ key, initial, activityEvents, compute, tickMs })` on `useSyncExternalStore` + `BroadcastChannel` + `navigator.locks`, with `MockDerivedSource` for tests. Unit tests in `packages/realtime/src/__tests__/derived.test.ts`. No hook in this repo consumes it yet — it's infrastructure waiting for the first domain that needs it.

`DEPLOYMENT.md` appendix: signed-URL convention, `absPath()` rationale cross-link.

## 5. Acceptance criteria (the "installed" test)

After all seven workstreams land, these are true on `main`:

1. `make lint` fails on any `apps/web/src/**/use-*.ts(x)` without a sibling `.test.ts(x)`.
2. `make lint` fails on any `apps/web/src/widgets/**/[name].tsx` without a sibling `[name].stories.tsx`.
3. `make lint` fails on any `.feature` tagged `@state-machine(...)` that lacks a `@state:X` scenario per listed state.
4. `make lint` fails on any `accepted` ADR without `verified_by:` files that cite it (or on any `@adr NNNN` that doesn't resolve).
5. `make lint` fails on any `process.cwd()` outside `scripts/`.
6. `make lint` fails on any shipped pitch whose `ui_elements:` has uncovered entries (inert absent pitches).
7. `make lint` fails on any `e2e/steps/**` unscoped `page.getBy*` lacking `// placement-agnostic:` exemption.
8. `tsc -b` fails on any `<Navbar/>`, `<AppShell/>`, `<Sidebar/>` call omitting a required slot.
9. `packages/env` boot fails (Zod parse error) if a `absPath()`-typed env var is relative and doesn't resolve under the repo root.
10. `make test-unit` runs both `packages/api` Bun tests and `apps/web` Vitest tests.
11. `make test-browser` exists and runs `*.browser.test.tsx` in Chromium.
12. `make test` invokes the Storybook addon-vitest suite alongside BDD.
13. `pnpm new:feature <name>` generates the 9-file slice; the resulting code passes `make lint` + `make test-unit` on the generated smoke tests.
14. `packages/realtime/src/derived.ts` has unit tests; no consumer wires it yet.
15. `docs/conventions.md` has sections for perspective shape, client-derived state, cross-origin media, BDD placement scoping.
16. Three new ADRs exist: web-test-runner (#3), ui-shell-slots (#13), env-path-anchoring (#18) — each with `verified_by:` populated.

Each acceptance criterion maps to exactly one workstream (or to WS1 as a single unified "guards" workstream).

## 6. Parallelism & handover

Dispatchable in one message as parallel subagents:

- **Phase 1:** WS1 (split further into N parallel check-subagents), WS2, WS3, WS4, WS7.
- **Phase 2 (after WS2 green):** WS5, WS6.

Each workstream is self-contained — no shared files between them except `Makefile`, `package.json`, and `docs/conventions.md`, which are all append-only for these workstreams (no conflicting edits).

WS1 subagent brief template:
> Implement `scripts/check-<name>.ts` per the repo's "Adding a new custom check" recipe in root `CLAUDE.md`. Export `runX(root)`, write `scripts/__tests__/check-<name>.test.ts` with temp-dir fixtures modeled on `check-no-barrel.test.ts`. Add root script `lint:check:<name>`, append turbo task `//#lint:check:<name>` with narrow inputs, add token to `TURBO_LINT_TASKS` in Makefile. Do not add per-package changes. Grep-tool not bash grep. MultiEdit for batched writes to one file.

WS4 subagent brief: confined to `apps/web/src/widgets/{navbar,app-shell,sidebar}/` + their call sites. Other widgets are untouched.

## 7. Out of scope (explicitly)

- Liveblocks / Yjs / XState / Redux Toolkit.
- Nx migration.
- Chromatic (Lost Pixel is the free replacement).
- ESLint introduction — Biome + Grit + scripts only.
- Rewriting existing domains (`todo-list`, `auth`) to use `{ self, others }` — convention applies to future domains.
- Implementing any of the specific bugs' fixes from the handover (those were a2sdlc-demo3 features, not template concerns).

## 8. Open questions

- WS5 / WS6 version compatibility: Storybook 9 + addon-vitest + Vitest 3 + React 19 — confirm the matrix at install time; downgrade one version if a peer-dep break surfaces. Default to the catalog versions in the handover.
- Grit expressiveness for WS1's two Grit items: verified only at implementation time by the probe step. Spec permits fallback without re-review.
- Should `check-stories-siblings` also cover `apps/web/src/features/**/*-panel.tsx`? Current scope: widgets only. Features can opt in later.

## 9. References

- Source handover: `/Users/iorlas/Workspaces/a2sdlc-demo3/docs/superpowers/specs/2026-04-21-template-prevention-stack-handover.md`.
- Existing "adding a check" recipe: root `CLAUDE.md`.
- Existing check pattern: `scripts/check-no-barrel.ts` + `scripts/__tests__/check-no-barrel.test.ts`.
- Existing Grit plugin: `scripts/grit-plugins/import-type-for-app-router.grit`.
- Turbo migration (just merged): `docs/superpowers/specs/2026-04-21-turbo-migration-handover.md`.
