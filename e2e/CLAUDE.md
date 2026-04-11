# e2e — BDD Testing with playwright-bdd

## BDD-First Workflow

1. **Write the Gherkin spec** in `features/<name>.feature` (Phase 0 — before any code)
2. **Add Prisma schema** if needed — `make db-push` (Phase 1)
3. **Implement backend** — services + routers + Vitest (Phase 2)
4. **Implement frontend** — hooks + components + routes (Phase 3)
5. **Write step definitions** in `steps/<name>.ts` against real HTML (Phase 3)
6. **Generate tests:** `pnpm exec bddgen` (generates `.features-gen/`)
7. **Run:** `make test`
8. **Verify:** `make check && make test`

Step definitions are written AFTER the UI exists so selectors reference real elements. The Gherkin spec (written first) is the behavior contract; step defs are the implementation detail.

## Running Scoped Subsets

`make test` runs the full suite (desktop + mobile). For the inner dev loop, filter with `ARGS`:

```bash
# A single scenario by title regex (matches the Gherkin scenario name)
make test ARGS="--grep 'Create a todo'"

# All scenarios in one feature (feature name is part of the test title)
make test ARGS="--grep Authentication"
make test ARGS="--grep 'Todo Lists'"

# Skip the mobile viewport project (desktop only — faster)
make test ARGS="--project desktop"

# Combine filters
make test ARGS="--project desktop --grep 'Sign in'"

# Watch the browser drive the test (debugging UI)
make test ARGS="--headed"

# Open Playwright's interactive UI, filtered
make test-ui ARGS="--grep Authentication"

# List matching tests without running them (dry run)
make test ARGS="--list --grep auth"
```

`ARGS` is forwarded to `playwright test` verbatim. See `pnpm exec playwright test --help` from `e2e/` for the full flag list. Common picks: `--grep`, `--grep-invert`, `--project`, `--headed`, `--debug`, `--list`, `--repeat-each`, `--retries`.

The full `make test` is authoritative — never claim work is done on a scoped run alone.

## Scenario Strategy

### What BDD Covers (and What It Doesn't)

BDD E2E tests are expensive and slow. They prove the **system works end-to-end for real users**. Edge cases and exhaustive validation belong in unit/integration tests (Vitest).

```
         /\
        /  \    BDD E2E — few, critical user paths (this package)
       /    \   Integration — router auth guards, round-trip CRUD (packages/api/__tests__)
      /      \  Unit — service functions, parsing, edge cases (packages/api/services/__tests__)
     /________\
```

### Positive vs Negative Ratio

**Heavy positive, light negative, always auth + empty state.**

| Category | BDD? | Vitest? | Example |
|----------|------|---------|---------|
| Happy path (CRUD, state transitions) | Yes — every operation | Also, for service logic | Create todo, import todos from CSV |
| Empty state | Yes — always | No | "No todos yet" |
| One negative per validation boundary | Yes — prove boundary exists | Yes — enumerate all cases | Reject invalid import CSV (BDD), reject empty/malformed rows (Vitest) |
| Authorization / privacy | Yes — always per domain | Yes — auth guard test | Todos private to each user |
| Error recovery (retry, fallback) | Rarely | Yes | Network failure during upload |
| Data edge cases (empty string, max length) | No | Yes | 0-byte CSV, 10MB limit |
| Performance / load | No | No (separate tooling) | — |

**Rule of thumb:** If adding a scenario tests the same code path as an existing one but with different data, it belongs in a Vitest `describe` block with parameterized cases, not a new Gherkin scenario.

### Orthogonal Scenario Design

Think in **behavioral axes** per domain. Each axis gets 1-2 scenarios max:

| Axis | What to test |
|------|-------------|
| Happy path | Core operation succeeds |
| Empty state | First-visit experience |
| Validation | One representative rejection |
| Authorization | Unauthenticated blocked, data private per user |
| State transitions | pending → processed, active → completed |
| Destructive | Delete removes item, returns to empty state |

If two scenarios share the same axis, ask: do they test genuinely different behaviors?

## Writing Feature Files

### Declarative Style (Required)

Describe **what** the system does, not **how** the user clicks through it. Scenarios should survive a UI redesign.

```gherkin
# BAD — imperative (breaks when UI changes)
When I fill in "Email" with "bob@test.com"
And I fill in "Password" with "password123"
And I click the "Sign In" button

# GOOD — declarative (survives UI redesign)
When I sign in with email "bob@test.com" and password "password123"
```

```gherkin
# BAD — implementation detail (URL in Gherkin)
And I navigate to "/todos"

# GOOD — declarative (page name)
And I am on the todos page
```

### Scenario Structure

```gherkin
Feature: Feature Name

  Scenario: Descriptive behavior-focused name
    Given I am signed in as "unique-email@example.com"
    And I am on the todos page
    When I do something
    Then I should see "expected result"
```

Rules:
- **One behavior per scenario** — if you have multiple When-Then pairs, split into separate scenarios
- **3-7 steps per scenario** — under 10 max. Long scenarios signal imperative style
- **Each scenario is independent** — no shared state, runnable in any order
- **Unique emails per scenario** — DB is shared across parallel workers
- Only one When-Then pair per scenario
- Given = preconditions (state), When = action (trigger), Then = assertion (outcome)

### Background Usage

Use `Background` for steps shared by ALL scenarios in a feature. Keep it to 2-3 Given steps max.

```gherkin
Background:
  Given I am signed in as "todos-user@example.com"
  And I am on the todos page
```

Don't use Background if only some scenarios need the setup. Background should only contain Given steps.

### Scenario Outlines

Use when the **behavior is the same** but data varies. Every row must represent a genuinely different behavioral case.

```gherkin
Scenario Outline: Reject invalid import file types
  When I upload a "<filetype>" file
  Then I should see "Only CSV files are accepted"

  Examples:
    | filetype |
    | .pdf     |
    | .exe     |
```

Don't use Scenario Outlines when all rows exercise the same code path — one scenario is enough. Put data exhaustiveness in Vitest.

## Feature File Organization

Feature files map to **domain areas**, not individual capabilities:
- `auth.feature` — all authentication scenarios
- `todos.feature` — all todo scenarios (CRUD, reorder, completion)
- `mobile-nav.feature` — navigation-specific scenarios

Split into sub-files only when a feature exceeds ~15-20 scenarios. Step definition files mirror feature files.

## Writing Step Definitions

### Organization

Steps are organized by domain. Shared steps (auth, navigation, assertions) live in `auth.ts`. Domain steps live in their own file.

```
steps/
  auth.ts        # sign in/out, navigation, generic assertions (I should see, I click)
  todo-lists.ts  # todo-list-specific steps (create, navigate into, delete list)
  todos.ts       # todo-specific steps
  mobile-nav.ts  # mobile-specific steps
```

### Reuse Rules

- **Check existing steps before creating new ones.** Run `grep -r "given\|when\|then" e2e/steps/` to see what's available.
- Steps are shared across all feature files — write reusable, parameterized steps.
- Extract helper functions for repeated logic, don't duplicate step definitions.
- Never call steps from steps — use shared helpers instead.

### Locator Priority (in order of preference)

1. `getByRole("button", { name: "Submit" })` — most resilient, accessible
2. `getByLabel("Email")` — for labeled form fields
3. `getByPlaceholder("Add a todo...")` — for inputs without labels
4. `getByText("Welcome", { exact: true })` — for visible text
5. `page.locator("li", { hasText: "item" })` — scoped by content
6. `page.locator('[data-testid="x"]')` — last resort

Avoid CSS class selectors and XPath — they break on UI changes.

### Locator Scoping

When multiple identical elements exist, scope to the nearest **semantic** container:

```typescript
// BAD: div matches too broadly
const column = page.locator("div", { has: page.getByRole("heading", { name: "To Do" }) });

// GOOD: scope to semantic element
const form = page.locator("form", { has: page.getByPlaceholder("Add a card") });
form.getByRole("button", { name: "Add" });
```

If no semantic container exists, add `data-testid` to the section wrapper.

### Waiting Strategy

- Prefer `toBeVisible()`, `waitForURL()`, `toHaveCount()` over `waitForTimeout()`
- Use `waitForLoadState("networkidle")` after mutations that trigger API calls
- Set reasonable timeouts: `{ timeout: 10000 }` for network operations, `{ timeout: 5000 }` for UI assertions

## AI Agent Guidance

When an AI agent writes Gherkin or step definitions:

- **Review every AI-generated scenario for domain accuracy.** AI generates happy paths well but misses validation and edge cases. Explicitly prompt for: empty states, auth failures, validation errors.
- **Provide existing step definitions as context.** Without them, AI invents new phrasings for concepts that already have steps.
- **Use declarative style.** AI defaults to imperative (click-by-click) without explicit instruction.
- **Don't accept tautological assertions.** "Then the correct results are returned" is not a real assertion. Require concrete expected values.
- **Few-shot examples matter.** Provide 2-3 existing scenarios from this project as context, not generic BDD tutorials.

## Auth in Tests

**Precondition auth goes through the HTTP API, not the UI.** `Given I am signed in as "X"` and `Given a user exists with email "X" and password "Y"` call Better-Auth directly (see `createUserViaApi` / `signInViaApi` in `e2e/auth-client.ts`), landing the session cookie on `page.context()`. Skipping the sign-up form is ~20× faster and immune to form-field changes (adding a username, password policy, etc.).

**Subject-under-test auth uses the real UI.** The scenarios in `auth.feature` — Sign Up, Sign In, Wrong Password, Protected Route, Sign Out — exercise the actual login form via When/Then steps. Don't move those to the API path; they're the tests that would catch a broken form.

If you're writing a new feature file and need a signed-in user as scaffolding, always use `Given I am signed in as "unique-email@example.com"`.

## Test Infrastructure

- `docker-compose.test.yml` — Postgres on dynamic port (derived from directory hash), tmpfs (in-memory). Parametric — `TEST_PORT` + `TEST_CONTAINER` supplied by `scripts/test-db.ts`.
- `../scripts/test-db.ts` — **shared with the unit suite**: `testDbEnv(suite)` (pure hash→port/container derivation) + `setupTestDatabase(suite)` (docker boot + prisma push). Single source of truth for how test DBs are provisioned. Same module drives unit-suite isolation in `packages/api/test-runner.ts`.
- `test-env.ts` — thin facade: `testDbEnv("e2e")` + named re-exports (`TEST_PORT`, `TEST_CONTAINER`, `TEST_DATABASE_URL`, `PROJECT_ROOT`).
- `global-setup.ts` — thin wrapper calling `setupTestDatabase("e2e")`.
- `playwright.config.ts` — starts web (`3100 + offset`) and server (`3200 + offset`) with test env vars, where `offset = hash16(PROJECT_ROOT) % 100`. See the container-naming bullet below for the formula.
- E2e container is `agentic-postgres-e2e-<hash8>` on port `5400 + (hash16 % 100)` — fully isolated from the unit suite (port `5500+`), so `make test` and `make test-unit` can run in parallel.
- Test ports are dynamic per worktree — no conflict with dev ports (3000/3001), and two `make test` runs in different worktrees on the same host don't collide. Port bases across suites are spaced by ≥100 so ranges never overlap under the modulo-100 offset.
- Fully parallel execution (7 workers), desktop then mobile with DB reset between.

## Known Test Failure Patterns

| Symptom | Cause | Fix |
|---------|-------|-----|
| `getByRole("button")` click doesn't navigate | `<Link>` wrapping `<Button>` creates nested `<a><button>` | Use `<Button asChild><Link>` instead (single element) |

## Do Not

- Edit files in `.features-gen/` — they are auto-generated
- Share mutable state between scenarios
- Use `waitForTimeout` as the primary waiting strategy
- Hardcode `http://localhost:3000` in step definitions — use `page.goto("/path")`
- Write imperative scenarios (click-by-click UI instructions)
- Put URLs or CSS selectors in Gherkin — those are implementation details
- Test the same code path with different data in separate scenarios — use Vitest
- Create duplicate step definitions — check existing steps first
