# Plan B: CASL Authz + Admin Role + Bull Board

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish `packages/api/src/authz/` — a single CASL ability composer resolved per request and used by BOTH tRPC middleware and Hono middleware. Add `User.role` + `User.username` via Better-Auth `additionalFields`. Mount Bull Board at `/admin/queues` gated by the CASL admin rule.

**Architecture:** Per-domain rule files under `authz/rules/` contribute `can/cannot` statements; `abilityFor(session)` composes them. Every access question — including admin dashboard access — resolves through the same ability. Better-Auth user gains `role: "user" | "admin"` (default `"user"`) and `username: string` (unique) as `additionalFields` — not via the Better-Auth `admin` plugin, which would introduce a parallel RBAC paradigm.

**Tech Stack:** @casl/ability, @casl/prisma, @casl/react, @bull-board/api, @bull-board/hono, Better-Auth additionalFields.

**Spec:** `docs/superpowers/specs/2026-04-19-template-reference-implementation-design.md`

**Depends on:** Plan A complete (jobs + Redis in place — Bull Board needs queue instances).

---

### Task 1: Add `role` + `username` to Better-Auth via `additionalFields`

**Files:**
- Modify: `packages/db/prisma/schema/auth.prisma`
- Modify: `packages/auth/src/index.ts` (or wherever `betterAuth({...})` lives)

- [ ] **Step 1: Add columns to User model**

In `packages/db/prisma/schema/auth.prisma`, extend the `User` model:

```prisma
model User {
  id            String    @id
  name          String
  email         String    @unique
  username      String    @unique
  role          String    @default("user")
  emailVerified Boolean   @default(false)
  image         String?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  sessions Session[]
  accounts Account[]
  todos     Todo[]
  todoLists TodoList[]
}
```

- [ ] **Step 2: Push schema (destructive — template has no prod data)**

```bash
make db-push
```

Expected: schema applied. Existing users will need `username` — since this is dev data, a reset is fine. If Prisma complains about existing rows, run:

```bash
pnpm --filter @project/db exec prisma db push --force-reset
```

- [ ] **Step 3: Declare additionalFields in Better-Auth config**

In the `betterAuth({...})` call, add (or extend if present):

```ts
user: {
  additionalFields: {
    role: {
      type: "string",
      defaultValue: "user",
      input: false, // not set at signup
      unique: false,
    },
    username: {
      type: "string",
      input: true, // must be supplied at signup
      unique: true,
      required: true,
    },
  },
},
```

- [ ] **Step 4: Lint**

```bash
make lint
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/schema/auth.prisma packages/auth/
git commit -m "feat(auth): add User.role + User.username via additionalFields"
```

---

### Task 2: Seed admin script

**Files:**
- Create: `scripts/seed-admin.ts`

- [ ] **Step 1: Create the script**

```ts
// Promotes an existing user to role="admin" by email.
// Usage: bun run scripts/seed-admin.ts admin@example.com

import { db } from "@project/db";

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error("Usage: bun run scripts/seed-admin.ts <email>");
    process.exit(1);
  }

  const user = await db.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`No user with email "${email}". Sign them up first.`);
    process.exit(1);
  }

  await db.user.update({ where: { id: user.id }, data: { role: "admin" } });
  console.log(`Promoted ${email} to admin.`);
  await db.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Smoke run (optional — requires an existing user)**

```bash
bun run scripts/seed-admin.ts someone@example.com
```

Expected: either `Promoted ...` or clear "No user" error.

- [ ] **Step 3: Commit**

```bash
git add scripts/seed-admin.ts
git commit -m "feat(scripts): add seed-admin.ts to promote user by email"
```

---

### Task 3: Install CASL packages

**Files:**
- Modify: `pnpm-workspace.yaml`
- Modify: `packages/api/package.json`
- Modify: `apps/web/package.json`

- [ ] **Step 1: Add catalog entries**

In `pnpm-workspace.yaml`, extend `catalog:`:

```yaml
  "@casl/ability": ^6.7.3
  "@casl/prisma": ^1.5.1
  "@casl/react": ^5.0.0
```

- [ ] **Step 2: Add to `@project/api` deps**

Edit `packages/api/package.json` `dependencies`:

```json
"@casl/ability": "catalog:",
"@casl/prisma": "catalog:",
```

- [ ] **Step 3: Add to `apps/web` deps**

Edit `apps/web/package.json` `dependencies`:

```json
"@casl/ability": "catalog:",
"@casl/react": "catalog:",
```

- [ ] **Step 4: Install**

```bash
pnpm install
```

- [ ] **Step 5: Commit**

```bash
git add pnpm-workspace.yaml packages/api/package.json apps/web/package.json pnpm-lock.yaml
git commit -m "deps: add @casl/ability, @casl/prisma, @casl/react"
```

---

### Task 4: `packages/api/src/authz/` — ability types, composer, asSubject

**Files:**
- Create: `packages/api/src/authz/types.ts`
- Create: `packages/api/src/authz/subject.ts`
- Create: `packages/api/src/authz/index.ts`
- Create: `packages/api/src/authz/rules/admin.ts`
- Create: `packages/api/src/authz/rules/todo.ts`

- [ ] **Step 1: Create `packages/api/src/authz/types.ts`**

```ts
// Ability types for the whole app. New domains extend Actions/Subjects here.
// The subject strings must match the Prisma model names for @casl/prisma
// accessibleBy() integration.

import type { PureAbility } from "@casl/ability";
import type { Subjects } from "@casl/prisma";
import type { Todo, TodoList, User } from "@project/db";

export type AppActions =
  | "manage" // superuser
  | "access"
  | "create"
  | "read"
  | "update"
  | "delete";

// "AdminDashboard" is a named abstract subject — used by the admin rule
// for gating /admin/*. Real DB subjects come from Prisma types.
export type AppSubjects =
  | "AdminDashboard"
  | Subjects<{
      Todo: Todo;
      TodoList: TodoList;
      User: User;
    }>
  | "all";

export type AppAbility = PureAbility<[AppActions, AppSubjects]>;

export type SessionUser = {
  id: string;
  role: string;
};
```

- [ ] **Step 2: Create `packages/api/src/authz/subject.ts`**

```ts
// Guard against CASL's plain-object fallback. Every rule that receives a
// fetched Prisma row MUST wrap it with asSubject(name, row) — otherwise
// CASL falls back to class-level checks and can over-grant access.

import { subject } from "@casl/ability";

export function asSubject<T extends object>(
  name: string,
  row: T,
): T & { __caslSubjectType__: string } {
  return subject(name, row) as T & { __caslSubjectType__: string };
}
```

- [ ] **Step 3: Create `packages/api/src/authz/rules/admin.ts`**

```ts
// Admin rule: role === "admin" grants access to the AdminDashboard subject.
// AdminDashboard is an abstract string subject — no DB row is wrapped.

import type { AbilityBuilder } from "@casl/ability";
import type { AppAbility, SessionUser } from "../types.js";

export function applyAdminRules(
  { can }: AbilityBuilder<AppAbility>,
  user: SessionUser | null,
): void {
  if (user?.role === "admin") {
    can("access", "AdminDashboard");
  }
}
```

- [ ] **Step 4: Create `packages/api/src/authz/rules/todo.ts`**

```ts
// Todo rules — the baseline. Expanded in Plan C with membership rules
// when TodoListMembership lands. For now: a user can manage their own
// todos/lists (owner-only model).

import type { AbilityBuilder } from "@casl/ability";
import type { AppAbility, SessionUser } from "../types.js";

export function applyTodoRules(
  { can }: AbilityBuilder<AppAbility>,
  user: SessionUser | null,
): void {
  if (!user) return;
  can("manage", "TodoList", { userId: user.id });
  can("manage", "Todo", { userId: user.id });
}
```

- [ ] **Step 5: Create `packages/api/src/authz/index.ts`**

```ts
// Single-call ability composer. Every HTTP request resolves through here.
//
// Usage:
//   const ability = abilityFor(session?.user ?? null);
//   if (ability.cannot("access", "AdminDashboard")) throw ...;
//   db.todoList.findMany({ where: accessibleBy(ability).TodoList });

import { AbilityBuilder, PureAbility } from "@casl/ability";
import { createPrismaAbility } from "@casl/prisma";
import { applyAdminRules } from "./rules/admin.js";
import { applyTodoRules } from "./rules/todo.js";
import type { AppAbility, SessionUser } from "./types.js";

export function abilityFor(user: SessionUser | null): AppAbility {
  const builder = new AbilityBuilder<AppAbility>(PureAbility);
  applyAdminRules(builder, user);
  applyTodoRules(builder, user);
  return builder.build({
    // Route Prisma @casl/prisma types through createPrismaAbility so
    // accessibleBy() produces correct WHERE clauses.
    conditionsMatcher: createPrismaAbility().conditionsMatcher,
  });
}

export { asSubject } from "./subject.js";
export type { AppAbility, AppActions, AppSubjects, SessionUser } from "./types.js";
```

- [ ] **Step 6: Lint**

```bash
make lint
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/api/src/authz/
git commit -m "feat(authz): CASL ability composer + admin/todo rules + asSubject helper"
```

---

### Task 5: Unit tests for the ability composer

**Files:**
- Create: `packages/api/src/authz/__tests__/authz.test.ts`

- [ ] **Step 1: Write the tests**

```ts
import { abilityFor, asSubject } from "../index.js";
import { describe, expect, it } from "bun:test";

describe("abilityFor — admin rule", () => {
  it("grants AdminDashboard access to role=admin", () => {
    const ability = abilityFor({ id: "u1", role: "admin" });
    expect(ability.can("access", "AdminDashboard")).toBe(true);
  });

  it("denies AdminDashboard to role=user", () => {
    const ability = abilityFor({ id: "u1", role: "user" });
    expect(ability.can("access", "AdminDashboard")).toBe(false);
  });

  it("denies AdminDashboard to unauthenticated", () => {
    const ability = abilityFor(null);
    expect(ability.can("access", "AdminDashboard")).toBe(false);
  });
});

describe("abilityFor — todo rule", () => {
  it("allows owner to manage their TodoList (wrapped)", () => {
    const ability = abilityFor({ id: "u1", role: "user" });
    const list = asSubject("TodoList", {
      id: "l1",
      userId: "u1",
      name: "mine",
      color: "#000",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(ability.can("update", list)).toBe(true);
  });

  it("denies non-owner", () => {
    const ability = abilityFor({ id: "u2", role: "user" });
    const list = asSubject("TodoList", {
      id: "l1",
      userId: "u1",
      name: "mine",
      color: "#000",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(ability.can("update", list)).toBe(false);
  });

  it("over-grants when subject wrapping is forgotten (regression guard)", () => {
    // Without asSubject, CASL falls back to class-level checks. This test
    // documents the trap: a plain object is accepted as if class rules pass.
    // If this ever starts returning false, either CASL changed behavior or
    // asSubject became unnecessary — investigate before relaxing the guard.
    const ability = abilityFor({ id: "u2", role: "user" });
    const plainRow = { id: "l1", userId: "u1", name: "x" };
    // biome-ignore lint/suspicious/noExplicitAny: testing over-grant trap
    expect(ability.can("update", plainRow as any)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests**

```bash
make test-unit ARGS="authz"
```

Expected: all PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/api/src/authz/__tests__/
git commit -m "test(authz): composer unit tests + subject-wrapping trap guard"
```

---

### Task 6: Expose ability on tRPC context

**Files:**
- Modify: `packages/api/src/context.ts`
- Modify: `packages/api/src/trpc.ts` (if `protectedProcedure` lives there)

- [ ] **Step 1: Inspect current context shape**

```bash
cat packages/api/src/context.ts
```

Note how `session` and `db` are exposed.

- [ ] **Step 2: Add `ability` to context**

In `packages/api/src/context.ts`, after the session is resolved, build the ability and return it:

```ts
import { abilityFor } from "./authz/index.js";

// ... inside createContext / whichever function builds ctx:
const ability = abilityFor(
  session?.user
    ? { id: session.user.id, role: session.user.role ?? "user" }
    : null,
);

return {
  db,
  session,
  ability,
};
```

Update the `Context` type export to include `ability: ReturnType<typeof abilityFor>`.

- [ ] **Step 3: Lint**

```bash
make lint
```

Expected: PASS. If typecheck complains `session.user.role` doesn't exist, the Better-Auth `additionalFields` typegen hasn't propagated — regenerate:

```bash
pnpm --filter @project/auth exec better-auth generate || true
make lint
```

If still failing, cast via `as { role?: string }` at the boundary.

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/
git commit -m "feat(api): expose CASL ability on tRPC context"
```

---

### Task 7: Hono admin middleware

**Files:**
- Create: `apps/server/src/admin/middleware.ts`

- [ ] **Step 1: Create the middleware**

```ts
// Hono middleware that gates /admin/* routes. Resolves the SAME CASL
// ability the tRPC context uses — single source of truth for authz.
//
// Order-critical: this MUST run BEFORE Bull Board's mount, otherwise job
// payloads (including single-use password-reset URLs) would be readable
// by unauthenticated users. Acceptance test locks this in.

import { abilityFor } from "@project/api/authz";
import type { auth } from "@project/auth";
import type { MiddlewareHandler } from "hono";

type AuthInstance = typeof auth;

export function requireAdmin(authInstance: AuthInstance): MiddlewareHandler {
  return async (c, next) => {
    const session = await authInstance.api.getSession({
      headers: c.req.raw.headers,
    });
    const user = session?.user
      ? { id: session.user.id, role: (session.user as { role?: string }).role ?? "user" }
      : null;
    const ability = abilityFor(user);
    if (ability.cannot("access", "AdminDashboard")) {
      return c.text("Forbidden", 403);
    }
    await next();
  };
}
```

Note: the import path `@project/api/authz` requires the subpath to be exported. Add to `packages/api/package.json` `exports`:

```json
"./authz": {
  "default": "./src/authz/index.ts"
}
```

- [ ] **Step 2: Lint**

```bash
make lint
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/admin/ packages/api/package.json
git commit -m "feat(server): requireAdmin Hono middleware + authz subpath export"
```

---

### Task 8: Install + mount Bull Board

**Files:**
- Modify: `pnpm-workspace.yaml`
- Modify: `apps/server/package.json`
- Create: `apps/server/src/admin/bull-board.ts`
- Modify: `apps/server/src/index.ts`

- [ ] **Step 1: Add catalog entries**

```yaml
  "@bull-board/api": ^6.7.0
  "@bull-board/hono": ^6.7.0
```

- [ ] **Step 2: Add to server deps**

Edit `apps/server/package.json` `dependencies`:

```json
"@bull-board/api": "catalog:",
"@bull-board/hono": "catalog:",
"@project/jobs": "workspace:*",
```

- [ ] **Step 3: Install**

```bash
pnpm install
```

- [ ] **Step 4: Create `apps/server/src/admin/bull-board.ts`**

```ts
// Bull Board mount. Exposes a read/retry UI for BullMQ queues.
// WARNING: job.data is visible to anyone who can reach this surface.
// Password-reset jobs contain single-use secret URLs. Mount this ONLY
// behind requireAdmin().

import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { HonoAdapter } from "@bull-board/hono";
import { emailQueue, maintenanceQueue } from "@project/jobs/queues";
import { serveStatic } from "@hono/node-server/serve-static";

export function createBullBoardAdapter() {
  const serverAdapter = new HonoAdapter(serveStatic);
  createBullBoard({
    queues: [
      new BullMQAdapter(emailQueue()),
      new BullMQAdapter(maintenanceQueue()),
    ],
    serverAdapter,
  });
  serverAdapter.setBasePath("/admin/queues");
  return serverAdapter;
}
```

- [ ] **Step 5: Mount in `apps/server/src/index.ts`**

Locate the Hono app construction. Add, in order, BEFORE any catch-all routes and after the auth mount:

```ts
import { requireAdmin } from "./admin/middleware.js";
import { createBullBoardAdapter } from "./admin/bull-board.js";
import { auth } from "@project/auth";

// ... existing app setup ...

// requireAdmin applies to the whole /admin subtree. Do NOT place any
// other /admin/* route above this line.
app.use("/admin/*", requireAdmin(auth));

const bullBoardAdapter = createBullBoardAdapter();
app.route("/admin/queues", bullBoardAdapter.registerPlugin());
```

The exact Bull Board Hono API is version-dependent. If `registerPlugin()` differs in your installed version, consult `node_modules/@bull-board/hono/README.md`.

- [ ] **Step 6: Boot + smoke-test**

```bash
make dev
```

In another terminal:

```bash
curl -i http://localhost:3001/admin/queues
```

Expected: `HTTP/1.1 403 Forbidden` (no session → not admin).

- [ ] **Step 7: Commit**

```bash
git add pnpm-workspace.yaml apps/server/ pnpm-lock.yaml
git commit -m "feat(admin): mount Bull Board at /admin/queues behind requireAdmin"
```

---

### Task 9: E2E test — admin gate

**Files:**
- Create: `e2e/tests/admin-gate.feature`
- Create: `e2e/steps/admin-gate.steps.ts`

- [ ] **Step 1: Inspect existing e2e feature file structure**

```bash
ls e2e/tests/ 2>/dev/null || ls e2e/features/ 2>/dev/null
cat e2e/playwright.config.ts | head -40
```

Match naming to the existing convention (`tests/` vs `features/`, file extension).

- [ ] **Step 2: Write the feature file**

Create `e2e/features/admin-gate.feature` (adjust path to match existing layout):

```gherkin
Feature: Admin dashboard gate

  Scenario: Unauthenticated user cannot access /admin/queues
    Given I visit "/admin/queues" without a session
    Then the response status is 403

  Scenario: Authenticated non-admin user cannot access /admin/queues
    Given I sign up as "bob@example.com" with username "bob"
    When I visit "/admin/queues"
    Then the response status is 403

  Scenario: Seeded admin can access /admin/queues
    Given I sign up as "alice@example.com" with username "alice"
    And I promote "alice@example.com" to admin
    When I visit "/admin/queues"
    Then the response status is 200
    And the page contains "email"
    And the page contains "maintenance"
```

- [ ] **Step 3: Write the step definitions**

Create `e2e/steps/admin-gate.steps.ts`:

```ts
import { expect, type APIRequestContext } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import { execSync } from "node:child_process";

const { Given, When, Then } = createBdd();

Given("I visit {string} without a session", async ({ request }, url: string) => {
  const res = await request.get(url, { maxRedirects: 0 });
  (request as any)._lastResponse = res;
});

Given(
  "I sign up as {string} with username {string}",
  async ({ page }, email: string, username: string) => {
    // Use Better-Auth sign-up UI or API — adjust to the app's actual
    // signup flow. This skeleton POSTs to Better-Auth's sign-up endpoint.
    await page.request.post("/api/auth/sign-up/email", {
      data: {
        email,
        password: "password-123!",
        name: username,
        username,
      },
    });
  },
);

Given(
  "I promote {string} to admin",
  async (_, email: string) => {
    execSync(`bun run scripts/seed-admin.ts ${email}`, {
      stdio: "inherit",
      cwd: process.cwd(),
    });
  },
);

When("I visit {string}", async ({ page }, url: string) => {
  await page.goto(url);
});

Then(
  "the response status is {int}",
  async ({ page, request }, status: number) => {
    const res =
      (request as any)._lastResponse ?? (await page.goto(page.url()));
    expect(res.status()).toBe(status);
  },
);

Then("the page contains {string}", async ({ page }, text: string) => {
  await expect(page.locator("body")).toContainText(text);
});
```

The above is a skeleton — adapt the exact Better-Auth sign-up path and the "visit without session" assertion style to match the repo's existing step helpers (look for similar auth-related steps already in `e2e/steps/`).

- [ ] **Step 4: Run the test**

```bash
make test ARGS="--grep 'Admin dashboard gate'"
```

Expected: 3 scenarios PASS.

- [ ] **Step 5: Commit**

```bash
git add e2e/
git commit -m "test(e2e): admin gate scenarios — unauthenticated, non-admin, admin"
```

---

## Verification Checklist

- [ ] `make lint` PASS
- [ ] `make test-unit ARGS="authz"` PASS (composer + subject-wrapping trap guard)
- [ ] `make test ARGS="--grep 'Admin dashboard gate'"` PASS (3 scenarios)
- [ ] `make dev` → `curl http://localhost:3001/admin/queues` returns 403 without auth
- [ ] After signing up and running `bun run scripts/seed-admin.ts <email>`, browsing `/admin/queues` in a signed-in session renders Bull Board with both `email` and `maintenance` queues listed
