# e2e — BDD Testing with playwright-bdd

## Add a Feature (BDD-first workflow)

1. **Write the Gherkin spec** in `features/<name>.feature`
2. **Write step definitions** in `steps/<name>.ts`
3. **Generate tests:** `pnpm exec bddgen` (generates `.features-gen/`)
4. **Run:** `make test`
5. **Implement** the feature code (tRPC routes, UI pages) until tests pass
6. **Verify:** `make check && make test`

Write the spec FIRST, then implement. This is the core workflow.

## Writing Feature Files

```gherkin
Feature: Feature Name

  Scenario: Descriptive scenario name
    Given I am signed in as "unique-email@example.com"
    And I navigate to "/page"
    When I do something
    Then I should see "expected result"
```

Rules:
- Each scenario must be independent — no shared state between scenarios
- Use unique emails per scenario (DB is shared across parallel workers)
- Background steps run per-scenario, not per-feature
- Keep scenarios focused — one behavior per scenario

## Feature File Organization

Feature files map to **domain areas**, not individual capabilities:
- `auth.feature` — all authentication scenarios
- `todos.feature` — all todo scenarios (CRUD, reorder, filtering, etc.)
- `mobile-nav.feature` — navigation-specific scenarios

All scenarios for a domain belong in one file. Split into sub-files only when a feature exceeds ~15-20 scenarios. Step definition files mirror feature files: `steps/auth.ts`, `steps/todos.ts`, etc.

## Writing Step Definitions

```typescript
import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";

const { Given: given, When: when, Then: then } = createBdd();

given("step text with {string}", async ({ page }, value: string) => {
  // implementation
});
```

Rules:
- Use `createBdd()` — not decorator syntax
- Steps are shared across all feature files — write reusable steps
- Use Playwright's role-based locators: `getByRole`, `getByPlaceholder`, `getByText`
- Avoid `getByText` for text that appears in multiple places — use `getByRole('heading')` or `.first()`
- Use `page.locator('button[type="submit"]')` for submit buttons (avoids matching toggle buttons)

## Auth in Tests

Use the `signUpOrSignIn` helper pattern:
- Tries sign-up first, falls back to sign-in if user exists
- Handles parallel execution where multiple scenarios may create the same user

## Test Infrastructure

- `docker-compose.test.yml` — Postgres on dynamic port (derived from directory hash), tmpfs (in-memory)
- `test-env.ts` — derives unique DB port and container name from project directory hash (worktree-safe)
- `global-setup.ts` — reuses healthy container or creates fresh; pushes schema
- `playwright.config.ts` — starts web (port 3100) and server (port 3101) with test env vars
- Test ports (3100/3101) are separate from dev ports (3000/3001) — both can run simultaneously
- Fully parallel execution (7 workers), desktop then mobile with DB reset between

## Known Test Failure Patterns

| Symptom | Cause | Fix |
|---------|-------|-----|
| `getByRole("button")` click doesn't navigate | `<Link>` wrapping `<Button>` creates nested `<a><button>` | Use `<Button asChild><Link>` instead (single element) |

## Locator Scoping

When multiple identical elements exist in different sections (e.g., "Add" buttons in
each column), scope to the nearest **semantic** container — not `div`:

```typescript
// BAD: div matches nested containers too broadly
const column = page.locator("div", { has: page.getByRole("heading", { name: "To Do" }) });
column.getByRole("button", { name: "Add" }); // finds buttons in ALL columns

// GOOD: scope to semantic element (form, section, nav, [role="region"])
const form = page.locator("form", { has: page.getByPlaceholder("Add a card") });
form.getByRole("button", { name: "Add" }); // finds only this form's button
```

If no semantic container exists, add `data-testid` to the section wrapper.
Prefer `form`, `section`, `nav`, `article`, `[role="region"]` over generic `div`.

## Do Not

- Edit files in `.features-gen/` — they are auto-generated
- Share mutable state between scenarios
- Use `waitForTimeout` as the primary waiting strategy — prefer `waitForURL`, `toBeVisible`, `toHaveURL`
- Hardcode `http://localhost:3000` in step definitions — use `page.goto("/path")` (baseURL configured)
