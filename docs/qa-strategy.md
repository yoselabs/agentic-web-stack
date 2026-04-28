# QA Strategy — Testing Pyramid

> This document is ground truth for **what tests run when, why, and who they catch for**. Consult before adding a new test or a new test surface. Conventions that describe *how* to write the tests themselves live in [`testing-guidelines.md`](testing-guidelines.md). The full inventory of tooling that powers each gate (versions, invocation, what survives a stack swap) is in [`dev-tooling.md`](dev-tooling.md).

## 1. Design principle

Every invariant the template relies on is enforced by **types, static checks, or a test surface** — never by human diligence alone (see spec `2026-04-21-template-prevention-foundation-design.md` §1). Each "genre" of bug has a primary gate. The pyramid below is ordered by speed and cost, not by value — slower gates aren't less valuable; they catch things cheaper gates can't.

## 2. The pyramid (edit-loop speed, CI cost)

```
            ┌─────────────────────────────────────┐
          7 │  Smoke (deployed)     non-hermetic  │  seconds against BASE_URL
            ├─────────────────────────────────────┤
          6 │  Visual regression    on-demand     │  minutes; manual/PR gate
            ├─────────────────────────────────────┤
          5 │  E2E / BDD            minutes       │  playwright-bdd, isolated DB
            ├─────────────────────────────────────┤
          4 │  Real-browser component (opt-in)    │  seconds; Chromium + DOM
            ├─────────────────────────────────────┤
          3 │  Story tests + a11y (parallel)      │  seconds; Vitest jsdom
            ├─────────────────────────────────────┤
          2 │  Unit / integration                 │  seconds; Bun + Vitest
            ├─────────────────────────────────────┤
          1 │  Static analysis                    │  sub-second cached
            └─────────────────────────────────────┘
```

## 3. Gate-by-gate: what, when, why, tools

### 1. Static analysis — `make lint`

**What it catches:** type mismatches, style violations, structural invariants (domain-folder parity, barrel imports, duplicate exported names, missing test siblings, `.env.example` drift, cwd-anchored paths, ADR back-references, Gherkin state-machine completeness, pitch UI coverage, scoped-landmark queries, dead code, copy-paste, workspace-dep mismatches, publishable-package hygiene, circular deps, dockerfile mistakes, secretleaks, GH workflow errors, markdown structure, link rot, typos, shell-script bugs).

**When it runs:**
- Every file save (editor `biome lsp` + `tsc --watch`)
- Pre-commit hook (prek-managed; routes through `make lint`; turbo-cached, read-only)
- Pre-push hook (prek-managed; runs `make fix` then `make lint` — fails the push if fix produced a diff)
- CI on every push
- Claude Code Stop / SubagentStop hook auto-runs `make fix` at end of each agent turn

**Why it's first:** ~0.3s warm cache, ~6s cold. Any bug catchable here MUST be caught here — zero justification for pushing to a slower layer.

**Tools** (~34 parallel turbo tasks; see [`dev-tooling.md`](dev-tooling.md) for the live roster):
- `lint:biome` — formatting + lint (Biome 2.4, including `noFloatingPromises` + `useSortedClasses` for Tailwind + nursery expansion)
- `lint:tsc` — incremental build (`tsc -b`)
- `lint:markdown`, `lint:links`, `lint:spell`, `lint:shell` — doc/shell hygiene
- `lint:prisma`, `lint:knip`, `lint:jscpd`, `lint:sherif`, `lint:publint`, `lint:depcruise`, `lint:secretlint`, `lint:actionlint` — external linters
- `lint:check:<name>` — custom `packages/lint/src/check-*.ts` enforcing repo-specific invariants (16 checks at last count — full table in [`dev-tooling.md`](dev-tooling.md#custom-checks-packageslintsrccheck-ts))

**Invariant → tool map** (selected):

| Invariant | Tool |
|---|---|
| Subpath-only imports for `@project/env` / `@project/api` | `check-no-barrel` |
| Domain-folder parity across web / api / e2e | `check-domain-names` |
| tRPC router patterns + server-leak prevention | `check-trpc-patterns`, `check-no-barrel` |
| No `process.cwd()` in runtime code | `check-no-cwd` |
| Every `use-*.ts` has a test sibling | `check-test-siblings` (ratcheted) |
| Every widget has a `.stories.tsx` | `check-stories-siblings` |
| `.env.example` ↔ Zod schema parity | `check-env-example` |
| ADR `verified_by:` bidirectional | `check-adrs` |
| Gherkin `@state-machine(...)` completeness | `lint-state-machines` |
| Pitch `ui_elements:` ↔ `@ui:` tags | `check-pitch-coverage` |
| Step defs scope to a landmark | `check-scoped-landmarks` (ratcheted) |
| No cross-field "self-variance" leaks | `check-perspective-boundary` (opt-in) |
| Duplicate / similar exported names | `check-duplicate-names` (allowlist) |

### 2. Unit / integration — `make test-unit`

**What it catches:** pure logic bugs (domain services, hooks, pure utils), race conditions in database writes (with real Postgres), time-dependent hook behavior (with fake timers), tRPC input validation.

**When:** local dev (`make test-unit`), CI, pre-push hook (belt-and-braces).

**Why:** real Postgres (isolated per worktree) catches the bugs mocks miss. jsdom covers 95% of web-side component behavior.

**Tools (heterogeneous per package):**
- `@project/api` — Bun test. Real Postgres, real Prisma. Router + service tests. One `$transaction` per mutation test.
- `@project/web` — Vitest 4 with happy-dom. `renderWithTRPC(ui, seed)` helper seeds tRPC cache via `queryOptions().queryKey`. `withFakeTimers({ toFake })` harness avoids React 19 scheduler breakage.
- Run in parallel: `turbo run test --filter=@project/api --filter=@project/web`.

**Authoring patterns:**
- Services take `Prisma.TransactionClient` for mutations, `DbClient` union for reads.
- Web hooks get a sibling `use-*.test.ts` (enforced by `check-test-siblings`).
- Time-dependent hooks use the shared `apps/web/test/time.ts` harness (toFake: `["setInterval","setTimeout","Date","performance","clearInterval","clearTimeout"]`).

### 3. Story tests + a11y — same `make test-unit` run, parallel

**What it catches:** component rendering failures across explicit states, a11y regressions (axe-core), broken play() interactions.

**When:** same `pnpm vitest run` invocation as #2 — stories are just extra test files in `@project/web`. No separate lane.

**Why:** forces **state enumeration**. Every widget's stories file lists every meaningful state; mounting each state IS the test. a11y runs per story automatically — zero manual assertions needed. Solves the "did this keep working for the empty / error / loading / authed / unauthed states" question that unit tests don't.

**Historical / longitudinal value:** every commit that touches a widget keeps all its stories green or deliberately updates one. Over the project's life, the stories file becomes a living state registry.

**Tools:**
- Storybook 10 `@storybook/react-vite`
- `@storybook/addon-vitest` — converts stories to Vitest tests (runs under same config, same workers)
- `@storybook/addon-a11y` — axe-core audit per story at `error` severity
- CSF3 format — typed stories, AI-friendly
- Optional `play()` function per story (Testing Library) for interaction coverage

**What belongs as a story vs. a unit test:**

| Concern | Home |
|---|---|
| State enumeration (empty / loading / error / variant) | Story |
| a11y | Story (axe-addon; free) |
| Click/keyboard interactions that depend on rendered DOM | Story `play()` |
| Pure logic branches | Unit test |
| Hook state transitions with fake timers | Unit test (hook.test.tsx) |
| Prop-to-DOM mapping (does X prop produce Y class?) | Story (snapshot or assertion) |

### 4. Real-browser component tests — `make test-browser`

**What it catches:** bugs jsdom can't see — cross-origin `<img>` credential-mode (401 vs 200), real CSS layout (ResizeObserver, IntersectionObserver, flex/grid reflow), clipboard APIs, drag-and-drop with real pointer events, `naturalWidth === 0` image-load failures.

**When:** `make test-browser` locally (opt-in per-component); CI alongside `make test-unit`. Not in `make lint` — too slow for the edit loop.

**Why:** jsdom has no CORS, no cookie jar partitioning, no actual network, no CSS engine. A jsdom test rendering `<img src={apiUrl + "/attachments/..."}>` can't tell whether the image 401'd, 200'd, or didn't load at all. Real Chromium can.

**Scope:** reserved for components that **touch real browser behavior**. ~5–10 `*.browser.test.tsx` files in a typical template, not hundreds.

**Convention:** components that need this opt in with a `*.browser.test.tsx` suffix. Normal `*.test.tsx` stays jsdom.

**Tools:**
- Vitest browser-mode (`@vitest/browser`, stable since 2.0)
- Playwright chromium as the provider
- `vitest-browser-react` for the render API
- Same `renderWithTRPC` + `withFakeTimers` helpers as jsdom tests — only the environment differs

### 5. E2E / BDD — `make test`

**What it catches:** full user journeys across layers (auth flow, realtime fan-out across browser contexts, multi-user collaboration, email delivery round-trips via Mailpit, Better-Auth session handling, cross-feature orchestration).

**When:** `make test` locally; CI; pre-merge. Not in `make lint` (minutes, not seconds).

**Why:** integration bugs between layers slip every other gate. Only E2E can see "login → create todo → invite user → collaborator receives realtime update in different browser context → acceptance email arrives in Mailpit" as one cohesive flow.

**Tools:**
- `playwright-bdd` — Gherkin specs compile to Playwright tests via `bddgen`
- Isolated Postgres per worktree (dynamic port via `packages/test-infra` hash)
- Multi-browser-context pattern for realtime tests (see `testing-guidelines.md`)
- `@state-machine(...)` tags enforce completeness per-feature (lint gate #1)

**When to reach for E2E vs lower layers:**
- Cross-user visibility (realtime, authz): **E2E**
- Email delivery: **E2E** (Mailpit round-trip)
- Error recovery / retry / fallback: **unit (Vitest) — see `testing-guidelines.md`**
- Single-component interaction: **Story `play()` or jsdom unit test**
- Single-page state machine: **Story enumeration, not scenario-per-state in Gherkin**

### 6. Visual regression — `make visual-regression`

**What it catches:** pixel drift, CSS regressions, unintended layout shifts, font-metric changes, unresolved Tailwind class names.

**When:** manual (`make visual-regression`) and/or PR check — **not** in `make lint` or `make test-unit` (minutes; flaky on headless machines without font control).

**Why:** neither stories nor E2E catch "this button is 2px wider than last month." Only pixel diffs do.

**Tools:** **Lost Pixel OSS** (free, local, diffs against static SB build). Baseline PNGs committed to `e2e/visual-baselines/`; first-run on a new component commits its baseline.

**Why not Chromatic:** paid SaaS; not worth the spend for a template forked by many. Upgrade path is one env var if a fork wants it.

### 7. Smoke — `make smoke`

**What it catches:** deployment breakage. Non-hermetic — runs `@smoke`-tagged BDD scenarios against whatever `BASE_URL` points at (local dev by default, staging/prod in CI post-deploy).

**When:** post-deploy canary, staging sanity, prod heartbeat. **Not pre-merge** (non-hermetic, can't be made deterministic enough).

**Why:** BDD covers journey logic; smoke proves the deployed artifact serves those journeys against real infrastructure (DNS, TLS, CDN, database migration state).

## 4. Decision tree — "I'm about to write a test, which kind?"

The pyramid is the reverse view (gate → what it covers). This is the
forward view: walk top-to-bottom, stop at the first **YES**, write the
test there.

```
START: what am I trying to verify?
│
├─ A repo-wide structural rule? (naming, imports, file layout, type
│  contracts, "every X must have Y", schema parity, ADR back-refs)
│   YES → #1 Static analysis
│         - Type-level? rely on tsc (`make lint`)
│         - Style/format? Biome
│         - Repo invariant? add a `packages/lint/src/check-*.ts`
│   NO ↓
│
├─ Pure logic? (function, hook, service — no DOM, no network, no UI)
│   YES → #2 Unit / integration test
│         - Web hook → Vitest sibling `*.test.tsx` (happy-dom)
│         - Web hook with timers → use `apps/web/test/time.ts` harness
│         - Backend service → Bun test, real Postgres, real Prisma
│         - Mutation under test? signature must take `Prisma.TransactionClient`
│         - Error recovery / retry / fallback path? **also #2** (NOT E2E)
│   NO ↓
│
├─ A component that renders differently per state?
│  (empty / loading / error / variant / authed-vs-unauthed)
│   YES → #3 Story (CSF3 + Storybook)
│         - One story per meaningful state — mounting IS the test
│         - a11y is free (axe-addon runs per story)
│         - Stateful interaction? add a `play()` function
│         - Don't multiply Gherkin scenarios for these — stories own state-enum
│   NO ↓
│
├─ Behavior that jsdom can't see?
│  (real CSS layout, ResizeObserver, IntersectionObserver, image
│  `naturalWidth`, cross-origin credentials/cookies, clipboard, real
│  pointer/touch events for drag-and-drop)
│   YES → #4 Real-browser component test
│         - Suffix `*.browser.test.tsx` (opt-in)
│         - Same `renderWithTRPC` / `withFakeTimers` helpers as jsdom
│   NO ↓
│
├─ A user journey that crosses users, tabs, or processes?
│  (multi-user collaboration, realtime fan-out across browser contexts,
│  full auth flow, email round-trip via Mailpit, login → action →
│  another user sees update)
│   YES → #5 E2E / BDD
│         - Write Gherkin first (`e2e/features/<domain>/*.feature`)
│         - Multi-user → multi-browser-context pattern (see `testing-guidelines.md`)
│         - Tag `@state-machine(...)` if it's a state-machine flow
│   NO ↓
│
├─ Pixel-perfect rendering / CSS regression / font drift?
│   YES → #6 Visual regression (`make visual-regression`)
│         - Baseline PNG committed to `e2e/visual-baselines/`
│         - First run on a new component commits its baseline
│   NO ↓
│
└─ Verifying the **deployed artifact** itself?
   (DNS, TLS, migration state, CDN, env-var wiring in production)
    YES → #7 Smoke (`make smoke`, `@smoke`-tagged BDD against `BASE_URL`)
    NO  → you may not need a test. Re-read the question. If the answer
          is "I just want a sanity check that this still works," the
          existing pyramid probably already covers it.
```

### Tie-breakers when two gates seem to fit

| Situation | Rule | Reason |
|---|---|---|
| Catchable by a static check **and** by a unit test | Always #1 | ~0.3s cached vs seconds; structural enforcement scales to every PR |
| Component state branch (empty / loading / error) | #3 story, **not** #5 BDD scenario | Stories enumerate cheaply; Gherkin scenarios are journey contracts, not state matrices |
| "Should retry on transient failure" / "should fall back when X fails" | #2 unit (Vitest), **not** #5 E2E | E2E can't reliably induce transient failures; Vitest can mock them deterministically |
| Cross-user visibility (User A acts → User B sees it) | #5 E2E only | Unit and story environments are single-user by construction |
| Email delivery round-trip | #5 E2E (Mailpit) | The point is verifying the SMTP seam — only E2E touches it |
| "Does this CSS class actually apply?" | #3 story (assertion) **or** #6 visual | jsdom has no CSS engine; pick #3 for prop-to-class mapping, #6 for layout drift |
| Component uses `<img>` from a cross-origin URL | #4 browser | jsdom doesn't enforce CORS or cookie partitioning |
| "Does my hook tear down its subscription on unmount?" | #2 unit with timers | Stories don't unmount; E2E is too slow to assert lifecycle |
| Adding a new domain / vertical slice | #5 BDD spec **first**, then #2 services, then #3 stories | BDD-first discipline (see CLAUDE.md "Development Workflow") |

### "Lower layer first" rule

If a bug is catchable at gate N, **it MUST be caught at gate N** — not
pushed to N+1. Reasons it sometimes drifts upward:

- Lazy ratchet ("we'll add a check later") — add the check now while context is loaded.
- "Easier to write an E2E" — usually means the lower layer needs better fixtures, not a more expensive test.
- "Unit can't see this" — sometimes true (cross-user, real CSS), often a missing helper. Try `renderWithTRPC` / `withFakeTimers` / `setupTestDatabase` before reaching higher.

---

## 5. Ownership — "which gate catches my bug class?"

| Bug class | Primary gate | Secondary |
|---|---|---|
| Type mismatch | #1 tsc | — |
| Dropped UI affordance (`Pitch 5A` class) | slot-typed shell (#1 tsc) | #3 story |
| State branch regression (empty / loading / error) | #3 story | #2 unit |
| a11y regression (missing label, contrast) | #3 story (axe-addon) | — |
| Hook time-dependent logic | #2 unit (fake timers) | — |
| Cross-origin `<img>` 401 | #4 browser | — |
| Race condition in DB write | #2 unit (real Postgres) | #5 E2E |
| Realtime fan-out between users | #5 E2E (multi-context) | — |
| Email delivery | #5 E2E (Mailpit) | — |
| Error recovery (retry, fallback) | #2 unit (Vitest) | — |
| CSS/layout drift | #6 visual | — |
| Domain-folder parity | #1 `check-domain-names` | — |
| Missing hook test sibling | #1 `check-test-siblings` | — |
| ADR without verification | #1 `check-adrs` | — |
| Prose-spec UI element never tested | #1 `check-pitch-coverage` | #3 story |
| Deployment breakage (DNS, TLS, migration) | #7 smoke | — |

## 6. What deliberately isn't here

- **Snapshot-based DOM tests** (`toMatchSnapshot`) — high false-positive rate, low signal. Stories + Lost Pixel replace them.
- **End-to-end browser tests inside Vitest** — that's what `make test-browser` (scoped) and `make test` (full journey) are for; duplicating inside regular unit tests inflates the edit-loop budget.
- **Coverage percentage gates** — Biome `noExplicitAny` + strict tsc + enforced test siblings give the *ratchet*. Demanding 80% coverage invites testing the reader, not the behavior.
- **Commit-message linting** — no release-notes pipeline yet; re-evaluate if one lands.
- **Bundle-size budgets** — meaningful for a deployed app, not a template.

## 7. Adding a new test surface

The pyramid is not closed. New genres of bug may warrant new gates. Before adding one:

1. **What bug class does it catch that existing gates don't?** If every bug it catches is already caught faster upstream, don't add it.
2. **Which existing gate would it obsolete?** If none — you're adding complexity. Justify.
3. **What's its place in the pyramid?** If slower than #5, it belongs at on-demand / post-deploy tier. If faster than #2, it's probably a static check — add a `packages/lint/src/check-*.ts`.
4. **Document here first, wire second.** Bump this table before the first task lands.

## 8. References

- [`docs/testing-guidelines.md`](testing-guidelines.md) — **how** to write the tests (multi-context realtime pattern, fake-timer gotchas, service-vs-router split).
- [`docs/adrs/0003-web-test-runner.md`](adrs/0003-web-test-runner.md) — why Vitest for web, Bun for api.
- [`docs/superpowers/specs/2026-04-21-template-prevention-foundation-design.md`](superpowers/specs/2026-04-21-template-prevention-foundation-design.md) — the prevention-stack spec this pyramid operationalizes.
