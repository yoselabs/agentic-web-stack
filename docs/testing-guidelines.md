# Testing Guidelines

How this template tests. What kind of test goes where, and why.

## Test Types

| Type | Runner | Command | Scope | When to use |
|---|---|---|---|---|
| Unit / integration | `bun test` (vitest-compatible surface) | `make test-unit` | Services, pure logic, tRPC router procedures via `createCaller` | Business logic, validation, authz guards, anything testable without a browser |
| BDD end-to-end | Playwright-BDD | `make test` | Full stack: browser → web app → HTTP/WS → API → DB | User-facing flows, real-time features, anything whose contract is "the user sees X" |
| Smoke (optional) | Playwright-BDD | `make smoke` | `@smoke`-tagged scenarios against `BASE_URL` | Post-deploy sanity on a populated target (non-hermetic) |

Both test types run against isolated Postgres containers with dynamic ports
per worktree (see `packages/test-infra`). Schema is force-reset at the start
of each run; per-test cleanup is the test's responsibility.

## What NOT to Test

- **Node-to-Node WebSocket integration tests.** The setup cost (Hono in-process
  + WS client + cookie injection + async event coordination + socket cleanup)
  routinely eats 1–2 hours per test, produces flaky timing-dependent assertions,
  and duplicates coverage that BDD already provides through a real browser.
  The browser's own WebSocket implementation is the real production client —
  test against that, not a Node mock of it. See the multi-user BDD pattern
  below for the recommended alternative.
- **Mocked Prisma.** Tests use the real `db` client against the isolated test
  Postgres. The infrastructure makes this fast enough that mocking adds
  no value.
- **Visual snapshots for components.** AI agents can't meaningfully review
  visual diffs; tests that encode "pixel X at position Y" become tautological
  and noisy. Rely on behavioral BDD instead.

## Real-Time Features — Multi-User BDD Pattern

Real-time flows are inherently multi-party: "when Alice sends a message, Bob
sees it." A single-page test can't exercise this. Playwright's browser contexts
are the mechanism — each context is an isolated browser session with its own
cookies and storage, so two contexts can be logged in as two different users
in the same test.

### World state for multiple users

Playwright-BDD's `createBdd()` takes no type generic — it accepts an
extended `test` object. To give each named user their own browser context
and page, extend `test` with a `pages` fixture (a `Map<string, Page>`),
pass that to `createBdd`, and destructure `pages` + `browser` in each
step.

```typescript
// e2e/fixtures/multi-user.ts
import { test as base, type Page, type Browser } from "@playwright/test";

type MultiUserFixtures = {
  pages: Map<string, Page>;
};

export const test = base.extend<MultiUserFixtures>({
  pages: async ({ browser }, use) => {
    const pages = new Map<string, Page>();
    await use(pages);
    // Cleanup: close contexts created during the scenario.
    for (const page of pages.values()) {
      await page.context().close();
    }
  },
});

export async function pageFor(
  browser: Browser,
  pages: Map<string, Page>,
  name: string,
): Promise<Page> {
  let page = pages.get(name);
  if (!page) {
    const context = await browser.newContext();
    page = await context.newPage();
    pages.set(name, page);
  }
  return page;
}
```

```typescript
// e2e/steps/chat.ts
import { createBdd } from "playwright-bdd";
import { test, pageFor } from "../fixtures/multi-user.ts";

const { Given: given, When: when, Then: then } = createBdd(test);

given("{word} and {word} are signed in", async ({ browser, pages }, a: string, b: string) => {
  const alice = await pageFor(browser, pages, a);
  const bob = await pageFor(browser, pages, b);
  await signIn(alice, a);
  await signIn(bob, b);
});

when("{word} sends {string}", async ({ browser, pages }, name: string, text: string) => {
  const page = await pageFor(browser, pages, name);
  await page.getByRole("textbox", { name: "Message" }).fill(text);
  await page.getByRole("button", { name: "Send" }).click();
});

then("{word} sees {string} within {int} seconds", async ({ browser, pages }, name: string, text: string, seconds: number) => {
  const page = await pageFor(browser, pages, name);
  await page.getByText(text).waitFor({ state: "visible", timeout: seconds * 1000 });
});
```

Register the extended `test` in `playwright.config.ts` by importing from
the fixtures module instead of `@playwright/test`. Existing single-user
scenarios continue to work because the `pages` fixture is only instantiated
when a step destructures it.

### Feature file

```gherkin
Scenario: Alice and Bob chat live
  Given Alice and Bob are signed in
  And they are both in room "general"
  When Alice sends "hello"
  Then Bob sees "hello" within 2 seconds
  When Bob sends "hi back"
  Then Alice sees "hi back" within 2 seconds
```

This test exercises: two real WebSocket connections, real server fanout, real
DOM updates — the same code path users hit in production.

### Tips

- **One scenario per real-time contract.** Don't write 10 variations; one
  happy path validates the WS pipe. Edge cases go in unit tests of the
  service/hook.
- **`waitFor` with a time budget.** Asserting an element exists immediately
  after a send will race the WS round-trip. Always `waitFor` with a bounded
  timeout (2–5 seconds is plenty for a local single-instance app).
- **Browser context teardown is automatic.** Playwright closes contexts
  between scenarios; you don't need manual cleanup.
- **Reconnect scenarios** (kill server, restart, assert UI caught up) can be
  added incrementally — they're high-value but high-effort, defer until a
  plain-send scenario is stable.

## Authentication in Tests

Tests seed users via Better-Auth's signup API and then call `signIn` in the
browser. The seed runs before each BDD session via the Playwright
global-setup hook. See `e2e/global-setup.ts` for the existing pattern.

Unit tests that need authenticated context use tRPC's `createCaller`:

```typescript
import { appRouter } from "@project/api/router";
import { createContext } from "@project/api/context";

const caller = appRouter.createCaller(await createContext({
  session: { user: { id: userId, ... } },
}));
await caller.chat.rooms.listMine();
```

## DB Isolation

Every test run gets its own Postgres container (dynamic port hashed from
the worktree path, range 5400-5499). Schema is force-reset at the start.
Tests are responsible for:

- Per-test cleanup (use `afterAll` or unique IDs per test)
- Not sharing state across scenarios unless a `Background` stage makes it
  explicit

See `packages/test-infra` for the details.

## Common Gotchas

| Mistake | Consequence | Fix |
|---|---|---|
| `Link to` a route not yet generated | TanStack type error | Use `to={"/path" as string}` temporarily |
| Assert immediately after a WS event | Race — element not rendered yet | `waitFor` with a timeout |
| `page.goto` without waiting for hydration | Element queries fail silently | `await page.waitForLoadState("networkidle")` or `getByRole` with auto-wait |
| Share one browser context between two "users" | Cookies collide — both see same session | One context per named user |
| Forget `make db-push` after schema edit | Stale types, test errors | `make test` / `make test-unit` both `db-generate` via prereq; only `db-push` for schema *push* |

## Related

- `e2e/CLAUDE.md` — BDD specifics: filter flags, viewport projects, step
  definition conventions.
- `packages/api/CLAUDE.md` — unit testing conventions: service vs router
  tests, transaction patterns.
- `docs/superpowers/specs/2026-04-17-test-db-shared-setup-design.md` — full
  test infrastructure design.
