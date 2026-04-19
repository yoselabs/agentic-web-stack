# Plan C Follow-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close three deferrals from Plan C Tasks 10–16: widen todo authz to collaborators, restore the real-time sync + multi-tab BDD scenarios, and record all of it in a durable handover — alongside a subfolder-per-domain e2e layout + a cross-layer naming convention enforced by a lint script.

**Architecture:** Spec at `docs/superpowers/specs/2026-04-19-plan-c-followups-design.md` (commit `bc8f58a`). Backend authz gate uses the existing `canReadList(db, viewerId, todoListId)` helper from `packages/api/src/domains/todo-list/service.ts:52`; `Todo.userId` shifts meaning from "authorization key" to "creator audit". No schema migration. E2E restructures to `e2e/features/<domain>/*.feature` + `e2e/steps/<domain>/*.ts` mirroring `apps/web/src/features/<name>/` + `packages/api/src/domains/<name>/`, with the invariant enforced by a new `scripts/check-domain-names.ts` grep-guard.

**Tech Stack:** Prisma 6.x, tRPC v11 (`@trpc/server`), `bun test`, Playwright-bdd, `navigator.locks` (Web Locks API).

**Branch:** `feat/template-reference-impl`. Do NOT create a new branch.

**Depends on:** Plan C shipped (commits `df99f7c..49b31d1`) + follow-up spec commit `bc8f58a`.

**Task dependency graph:**
- Task 1 (backend authz) → Task 2 (bun-tests) → Task 4 (e2e restored scenarios)
- Task 3 (e2e subfolder migration) → Task 4 (e2e restored scenarios on new paths) → Task 5 (docs + check-domain-names)
- Tasks 1–2 and Task 3 are independent and can be reordered. The table order is recommended.

---

## Load-bearing project conventions

Implementers coming in fresh: these are non-obvious and break the build if ignored.

- **Services = pure functions** accepting `Prisma.TransactionClient` (mutations) or `DbClient` union (reads). Routers own `$transaction`. See `packages/api/CLAUDE.md`.
- **User-reachable errors are `TRPCError`** with real codes. The template already uses this in `todo-list/service.ts` — mirror its style.
- **`bun:test`** is the test runner (not Vitest). Imports look like `import { beforeAll, afterEach, describe, it, expect } from "bun:test"`. Surface mirrors Vitest.
- **Services cannot `import` from tRPC context.** `canReadList` lives in `packages/api/src/domains/todo-list/service.ts` — import it into `todo/service.ts` directly; do NOT import `ctx`.
- **`make lint`** runs `agent-harness lint` + `tsc -b` + the three bespoke grep-guards in `Makefile:52-54`. The new `check-domain-names.ts` is wired there in Task 5.
- **`make test-unit`** boots an isolated Postgres via `scripts/test-db.ts`, push-resets the schema, and runs `bun test` in `packages/api`. Tests share the DB within a run; use unique IDs per test block to avoid cross-pollution.
- **No `waitForTimeout` in e2e.** Use `expect(…).toBeVisible({timeout})`, `expect.poll`, `page.waitForURL`, or the existing `e2e/waits.ts` helpers.

---

## Task 1: Backend authz widening — `packages/api/src/domains/todo/service.ts`

**Files:**
- Modify: `packages/api/src/domains/todo/service.ts` (all public functions + both lock helpers)
- Modify: `packages/api/src/domains/todo/router.ts` (`reorder` input gains `todoListId`)
- Read-only reference: `packages/api/src/domains/todo-list/service.ts:52-64` (`canReadList` definition)

**Scope:** drop every `userId` filter from `where:` clauses in `todo/service.ts`. Gate each function with `canReadList(db_or_tx, viewerId, todoListId)`; on `false`, throw `TRPCError({ code: "FORBIDDEN" })`. `Todo.userId` on `data:` stays (creator audit).

**Invariant check after task is done:** `grep -n "userId" packages/api/src/domains/todo/service.ts` should show `userId` only in function parameters, `data.userId` / creator assignments, and JSDoc comments — NEVER inside a `where:` clause. The Task 2 tests rely on this; do not ship Task 1 until grep is clean.

- [ ] **Step 1: Import `canReadList` and `TRPCError`**

Add to the top of `packages/api/src/domains/todo/service.ts`:

```ts
import { TRPCError } from "@trpc/server";
import { canReadList } from "../todo-list/service.js";
```

Keep the existing `import { Prisma, type PrismaClient } from "@project/db"` + `import Papa from "papaparse"`.

- [ ] **Step 2: Rewrite `lockActiveTodos` — drop `userId` param + filter**

Replace lines 12–27 of `service.ts` with:

```ts
async function lockActiveTodos(
  tx: Prisma.TransactionClient,
  todoListId: string,
): Promise<void> {
  // ORDER BY id: deterministic lock order across concurrent callers — avoids
  //   deadlocks if the planner ever picks different scan orders.
  // FOR NO KEY UPDATE: we only mutate `position` (non-key, non-FK), so the weaker
  //   lock is sufficient and allows concurrent FK references to these rows.
  // Widened from {userId, todoListId} to {todoListId} so collaborators contend on
  //   the same position-space as the owner — correct: they ARE racing.
  await tx.$queryRaw`
    SELECT id FROM "Todo"
    WHERE "todoListId" = ${todoListId} AND "completed" = false
    ORDER BY id
    FOR NO KEY UPDATE
  `;
}
```

- [ ] **Step 3: Rewrite `shiftActivePositions` — drop `userId` param + filter**

Replace lines 29–38 of `service.ts` with:

```ts
async function shiftActivePositions(
  tx: Prisma.TransactionClient,
  todoListId: string,
): Promise<void> {
  await tx.todo.updateMany({
    where: { completed: false, todoListId },
    data: { position: { increment: 1 } },
  });
}
```

- [ ] **Step 4: Rewrite `listTodos` — add authz gate, drop viewer filter**

Replace lines 40–50 with:

```ts
export async function listTodos(
  db: DbClient,
  viewerId: string,
  todoListId: string,
) {
  const allowed = await canReadList(db, viewerId, todoListId);
  if (!allowed) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You do not have access to this list.",
    });
  }
  return db.todo.findMany({
    where: { todoListId },
    orderBy: [{ completed: "asc" }, { position: "asc" }],
    include: { todoList: true },
  });
}
```

Parameter name stays `viewerId` semantically; if renaming from `userId` causes diff noise, leave the parameter name as `userId` and just rewrite the `where:` clause. The NAME doesn't change behavior; the filter drop does.

- [ ] **Step 5: Rewrite `createTodo` — add gate, update helper calls**

Replace lines 54–65 with:

```ts
export async function createTodo(
  tx: Prisma.TransactionClient,
  creatorId: string,
  title: string,
  todoListId: string,
) {
  const allowed = await canReadList(tx, creatorId, todoListId);
  if (!allowed) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You do not have access to this list.",
    });
  }
  await lockActiveTodos(tx, todoListId);
  await shiftActivePositions(tx, todoListId);
  return tx.todo.create({
    data: { title, userId: creatorId, todoListId, position: 0 },
  });
}
```

Note `data.userId: creatorId` stays — this is the creator audit field.

- [ ] **Step 6: Rewrite `completeTodo` — fetch without viewer filter, gate, drop `userId` from updates**

Replace lines 67–86 with:

```ts
export async function completeTodo(
  tx: Prisma.TransactionClient,
  viewerId: string,
  id: string,
  completed: boolean,
) {
  const todo = await tx.todo.findUniqueOrThrow({ where: { id } });
  const allowed = await canReadList(tx, viewerId, todo.todoListId);
  if (!allowed) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You do not have access to this list.",
    });
  }
  if (!completed) {
    await lockActiveTodos(tx, todo.todoListId);
    await shiftActivePositions(tx, todo.todoListId);
    return tx.todo.update({
      where: { id },
      data: { completed: false, position: 0 },
    });
  }
  return tx.todo.update({
    where: { id },
    data: { completed },
  });
}
```

Three filter-sites dropped `userId`: the `findUniqueOrThrow`, and both `update` calls.

- [ ] **Step 7: Rewrite `reorderTodos` — add `todoListId` param + authz gate + drop SQL filter**

Replace lines 88–100 with:

```ts
export async function reorderTodos(
  tx: Prisma.TransactionClient,
  viewerId: string,
  todoListId: string,
  ids: string[],
) {
  const allowed = await canReadList(tx, viewerId, todoListId);
  if (!allowed) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You do not have access to this list.",
    });
  }
  const pairs = ids.map((id, i) => Prisma.sql`(${id}::text, ${i}::integer)`);
  await tx.$executeRaw`
    UPDATE "Todo" AS t
    SET "position" = d.new_position
    FROM (VALUES ${Prisma.join(pairs, ",")}) AS d(id, new_position)
    WHERE t.id = d.id
  `;
}
```

Signature gained `todoListId` as the 3rd parameter. The raw SQL `WHERE` clause loses `AND t."userId" = ${userId}`.

- [ ] **Step 8: Rewrite `deleteTodo` — fetch for authz, drop `userId` from delete**

Replace lines 102–110 with:

```ts
export async function deleteTodo(
  tx: Prisma.TransactionClient,
  viewerId: string,
  id: string,
) {
  const todo = await tx.todo.findUniqueOrThrow({ where: { id } });
  const allowed = await canReadList(tx, viewerId, todo.todoListId);
  if (!allowed) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You do not have access to this list.",
    });
  }
  return tx.todo.delete({ where: { id } });
}
```

- [ ] **Step 9: Rewrite `importTodosFromCSV` — add gate, drop `userId` from `updateMany`**

Replace lines 113–149 with:

```ts
// Narrowed to Prisma.TransactionClient: calls lockActiveTodos.
export async function importTodosFromCSV(
  tx: Prisma.TransactionClient,
  creatorId: string,
  csvData: Buffer,
  todoListId: string,
): Promise<{ count: number }> {
  const allowed = await canReadList(tx, creatorId, todoListId);
  if (!allowed) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You do not have access to this list.",
    });
  }
  const text = csvData.toString("utf-8");
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
  });

  if (!parsed.meta.fields?.includes("title")) {
    throw new Error("CSV must have a 'title' column");
  }

  const titles = parsed.data.map((row) => row.title).filter(Boolean);
  if (titles.length === 0) {
    throw new Error("CSV must have a 'title' column with at least one value");
  }

  await lockActiveTodos(tx, todoListId);
  await tx.todo.updateMany({
    where: { completed: false, todoListId },
    data: { position: { increment: titles.length } },
  });
  await tx.todo.createMany({
    data: titles.map((title, i) => ({
      title,
      userId: creatorId,
      todoListId,
      position: i,
    })),
  });

  return { count: titles.length };
}
```

`createMany.data[i].userId: creatorId` stays (creator audit).

- [ ] **Step 10: Rewrite `exportTodosAsCSV` — add gate, drop `userId`**

Replace lines 151–166 with:

```ts
export async function exportTodosAsCSV(
  db: DbClient,
  viewerId: string,
  todoListId: string,
): Promise<string> {
  const allowed = await canReadList(db, viewerId, todoListId);
  if (!allowed) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You do not have access to this list.",
    });
  }
  const todos = await db.todo.findMany({
    where: { todoListId },
    orderBy: [{ completed: "asc" }, { position: "asc" }],
  });
  if (todos.length === 0) {
    return "title,completed";
  }
  return Papa.unparse(
    todos.map((t) => ({ title: t.title, completed: t.completed })),
  );
}
```

- [ ] **Step 11: Update router — `reorder` input Zod schema gains `todoListId`**

In `packages/api/src/domains/todo/router.ts`, replace lines 31–37 with:

```ts
  reorder: protectedProcedure
    .input(
      z.object({
        todoListId: z.string().min(1),
        ids: z.array(z.string()).min(1),
      }),
    )
    .mutation(({ ctx, input }) => {
      return ctx.db.$transaction((tx) =>
        reorderTodos(tx, ctx.session.user.id, input.todoListId, input.ids),
      );
    }),
```

The other router mutations (`list`, `create`, `complete`, `delete`) already pass `ctx.session.user.id` as the viewer arg — no change needed beyond reading them to confirm semantics.

- [ ] **Step 11a: Update the existing `reorderTodos` owner-path test to pass `todoListId`**

`packages/api/src/domains/todo/__tests__/service.test.ts:127` calls `reorderTodos(tx, TEST_USER_ID, [a.id, c.id, b.id])` — 3 args. The signature-change in Step 7 makes this a `tsc` failure. Fix the call site to:

```ts
reorderTodos(tx, TEST_USER_ID, TEST_LIST_ID, [a.id, c.id, b.id]),
```

Verify:

```bash
grep -n "reorderTodos" packages/api/src/domains/todo/__tests__/service.test.ts
```

Expected: every call now has 4 arguments.

- [ ] **Step 12: Update client call site for `reorder`**

In `apps/web/src/features/todo/use-todos.ts`, find the `reorderTodos.mutate({ ids: ... })` call and change it to `reorderTodos.mutate({ todoListId, ids: ... })` — `todoListId` is already in scope in that hook.

Verify by reading the file:

```bash
grep -n "reorder" apps/web/src/features/todo/use-todos.ts
```

Expected: one `useMutation(trpc.todo.reorder.mutationOptions(...))` setup and one `reorderTodos.mutate(...)` call site. Update the `.mutate(...)` payload.

- [ ] **Step 13: Verify no `userId` leaked into `where:` clauses**

```bash
grep -nE "where:\s*\{[^}]*userId" packages/api/src/domains/todo/service.ts
```

Expected: no output. (If it matches, a filter was missed — go back.)

Also check raw SQL:

```bash
grep -n "userId" packages/api/src/domains/todo/service.ts
```

Expected: `userId` appears ONLY in function parameters, `data:` object literals, and comments — zero appearances inside `WHERE` or `where:` clauses.

- [ ] **Step 14: Run `make lint`**

```bash
make lint
```

Expected: 15 checks PASS + `tsc -b` PASS. If `tsc` flags the `reorder` router input (e.g., because `use-todos.ts` still sends `{ ids: ... }` without `todoListId`), fix it per Step 12.

- [ ] **Step 15: Run existing tests to confirm no regressions**

```bash
make test-unit
```

Expected: 61 tests pass (the existing set). Owner-path tests continue to work because owner IS allowed by `canReadList`. Step 11a already updated the one existing call site that breaks on the signature change; any remaining failure is a different issue — read the error and fix at root cause.

- [ ] **Step 16: Commit**

```bash
git add packages/api/src/domains/todo/service.ts \
        packages/api/src/domains/todo/router.ts \
        apps/web/src/features/todo/use-todos.ts
git commit -m "feat(api): widen todo authz to collaborators (canReadList gate)"
```

---

## Task 2: Bun tests for collaborator + outsider paths

**Files:**
- Modify: `packages/api/src/domains/todo/__tests__/service.test.ts`

**Scope:** add a `describe("todo CRUD by collaborators", ...)` block with 9 `it` cases as defined in the spec's test table. Existing owner-path tests stay untouched.

Reference for test style: `packages/api/src/domains/todo-list/__tests__/service.test.ts:108-156` (the `"collaborator lifecycle"` block — has OWNER/INVITEE setup, per-scenario list creation, teardown). Mirror that pattern.

- [ ] **Step 1: Add the new describe block**

At the END of `packages/api/src/domains/todo/__tests__/service.test.ts`, append:

```ts
describe("todo CRUD by collaborators", () => {
  const OWNER_ID = "test-owner-todo-collab";
  const COLLAB_ID = "test-collab-todo-collab";
  const OUTSIDER_ID = "test-outsider-todo-collab";
  let sharedListId: string;

  beforeAll(async () => {
    await db.user.deleteMany({
      where: { id: { in: [OWNER_ID, COLLAB_ID, OUTSIDER_ID] } },
    });
    await db.user.createMany({
      data: [
        {
          id: OWNER_ID,
          name: "Owner",
          email: "owner-todo-collab@example.com",
          username: "owner-todo-collab",
          emailVerified: false,
        },
        {
          id: COLLAB_ID,
          name: "Collab",
          email: "collab-todo-collab@example.com",
          username: "collab-todo-collab",
          emailVerified: false,
        },
        {
          id: OUTSIDER_ID,
          name: "Outsider",
          email: "outsider-todo-collab@example.com",
          username: "outsider-todo-collab",
          emailVerified: false,
        },
      ],
    });
  });

  beforeEach(async () => {
    const list = await db.todoList.create({
      data: { name: "Shared Todo List", userId: OWNER_ID },
    });
    sharedListId = list.id;
    await db.todoListMembership.create({
      data: { userId: COLLAB_ID, todoListId: sharedListId, role: "collaborator" },
    });
  });

  afterEach(async () => {
    await db.todo.deleteMany({ where: { todoListId: sharedListId } });
    await db.todoListMembership.deleteMany({
      where: { todoListId: sharedListId },
    });
    await db.todoList.deleteMany({ where: { id: sharedListId } });
  });

  afterAll(async () => {
    await db.user.deleteMany({
      where: { id: { in: [OWNER_ID, COLLAB_ID, OUTSIDER_ID] } },
    });
  });

  // Tests added in subsequent steps.
});
```

Note: the `beforeEach` creates the list + membership fresh per test. The `afterEach` cascades cleanup. The `beforeEach`/`afterEach` run OUTSIDE the outer `describe` block's lifecycle — they apply only to the inner describe.

You also need to import `beforeEach` from `bun:test` (check the existing import on line 1; add if missing).

- [ ] **Step 2: Run the test file to verify setup works (no tests yet)**

```bash
pnpm --filter @project/api test todo/service
```

Expected: existing tests still pass, new describe block has no tests yet so no new assertions run. `61 pass` still.

- [ ] **Step 3: Add test — `listTodos` collaborator**

Inside the new describe block, add:

```ts
it("collaborator can listTodos and sees owner's rows", async () => {
  await db.todo.create({
    data: { title: "Owner's milk", userId: OWNER_ID, todoListId: sharedListId, position: 0 },
  });
  const todos = await listTodos(db, COLLAB_ID, sharedListId);
  expect(todos.map((t) => t.title)).toContain("Owner's milk");
  expect(todos.length).toBe(1);
});
```

- [ ] **Step 4: Add test — `createTodo` collaborator**

```ts
it("collaborator can createTodo; userId records the creator", async () => {
  const created = await db.$transaction((tx) =>
    createTodo(tx, COLLAB_ID, "Bob's bread", sharedListId),
  );
  expect(created.userId).toBe(COLLAB_ID);
  expect(created.todoListId).toBe(sharedListId);
  expect(created.title).toBe("Bob's bread");
});
```

- [ ] **Step 5: Add test — `completeTodo` collaborator toggles owner's todo**

```ts
it("collaborator can completeTodo on owner's row; update actually applies", async () => {
  const ownerTodo = await db.todo.create({
    data: {
      title: "Owner's todo",
      userId: OWNER_ID,
      todoListId: sharedListId,
      position: 0,
      completed: false,
    },
  });
  const updated = await db.$transaction((tx) =>
    completeTodo(tx, COLLAB_ID, ownerTodo.id, true),
  );
  expect(updated.id).toBe(ownerTodo.id);
  expect(updated.completed).toBe(true);

  // Verify row actually changed (catches stale {id, userId} filter leaking)
  const fresh = await db.todo.findUnique({ where: { id: ownerTodo.id } });
  expect(fresh?.completed).toBe(true);
});
```

- [ ] **Step 6: Add test — `deleteTodo` collaborator**

```ts
it("collaborator can deleteTodo on owner's row; row actually gone", async () => {
  const ownerTodo = await db.todo.create({
    data: {
      title: "Owner's doomed todo",
      userId: OWNER_ID,
      todoListId: sharedListId,
      position: 0,
    },
  });
  const deleted = await db.$transaction((tx) =>
    deleteTodo(tx, COLLAB_ID, ownerTodo.id),
  );
  expect(deleted.id).toBe(ownerTodo.id);

  // Verify row really gone (catches stale {id, userId} filter)
  const fresh = await db.todo.findUnique({ where: { id: ownerTodo.id } });
  expect(fresh).toBeNull();
});
```

- [ ] **Step 7: Add test — `reorderTodos` collaborator, assert positions**

```ts
it("collaborator can reorderTodos; positions actually update", async () => {
  const first = await db.todo.create({
    data: {
      title: "First",
      userId: OWNER_ID,
      todoListId: sharedListId,
      position: 0,
      completed: false,
    },
  });
  const second = await db.todo.create({
    data: {
      title: "Second",
      userId: OWNER_ID,
      todoListId: sharedListId,
      position: 1,
      completed: false,
    },
  });

  await db.$transaction((tx) =>
    reorderTodos(tx, COLLAB_ID, sharedListId, [second.id, first.id]),
  );

  const freshFirst = await db.todo.findUnique({ where: { id: first.id } });
  const freshSecond = await db.todo.findUnique({ where: { id: second.id } });
  expect(freshSecond?.position).toBe(0);
  expect(freshFirst?.position).toBe(1);
});
```

- [ ] **Step 8: Add test — `exportTodosAsCSV` collaborator includes owner's rows**

```ts
it("collaborator can exportTodosAsCSV and CSV includes owner's rows", async () => {
  await db.todo.create({
    data: { title: "Owner's export row", userId: OWNER_ID, todoListId: sharedListId, position: 0 },
  });
  const csv = await exportTodosAsCSV(db, COLLAB_ID, sharedListId);
  expect(csv).toContain("Owner's export row");
});
```

- [ ] **Step 9: Add test — `importTodosFromCSV` collaborator**

```ts
it("collaborator can importTodosFromCSV; new rows have userId=collaborator", async () => {
  const csv = Buffer.from("title\nCollab row A\nCollab row B\n", "utf-8");
  const res = await db.$transaction((tx) =>
    importTodosFromCSV(tx, COLLAB_ID, csv, sharedListId),
  );
  expect(res.count).toBe(2);

  const todos = await db.todo.findMany({
    where: { todoListId: sharedListId },
    orderBy: { position: "asc" },
  });
  const imported = todos.filter((t) => t.title.startsWith("Collab row"));
  expect(imported.length).toBe(2);
  expect(imported.every((t) => t.userId === COLLAB_ID)).toBe(true);
});
```

- [ ] **Step 10: Add test — `listTodos` outsider gets FORBIDDEN**

```ts
it("outsider listTodos throws FORBIDDEN", async () => {
  await expect(listTodos(db, OUTSIDER_ID, sharedListId)).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
});
```

`TRPCError` instances have a `code` property — `toMatchObject({ code: "FORBIDDEN" })` is the idiomatic bun-test assertion.

- [ ] **Step 11: Add test — `createTodo` outsider gets FORBIDDEN**

```ts
it("outsider createTodo throws FORBIDDEN", async () => {
  await expect(
    db.$transaction((tx) => createTodo(tx, OUTSIDER_ID, "x", sharedListId)),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
});
```

- [ ] **Step 12: Run tests to confirm all 9 pass**

```bash
pnpm --filter @project/api test todo/service
```

Expected: `70 pass` (was 61). If any of the 9 fail, most likely causes:
- A `userId` filter was missed in Task 1 (e.g., a `reorderTodos` or `exportTodosAsCSV` call returns zero rows because of a stale filter). Re-check the grep from Task 1 Step 13.
- Test isolation — another test polluted the DB. Each new test should use the `sharedListId` created in the block's `beforeEach`, not a hardcoded ID.

- [ ] **Step 13: Run full lint to confirm no regressions**

```bash
make lint
```

Expected: PASS.

- [ ] **Step 14: Commit**

```bash
git add packages/api/src/domains/todo/__tests__/service.test.ts
git commit -m "test(api): todo CRUD by collaborators + outsider FORBIDDEN"
```

---

## Task 3: E2E subfolder-per-domain migration

**Files moved:**
- `e2e/features/todo-lists.feature` → `e2e/features/todo-list/lists.feature`
- `e2e/features/todos.feature` → `e2e/features/todo-list/todos.feature`
- `e2e/features/collaborators.feature` → `e2e/features/todo-list/collaborators.feature`
- `e2e/features/queue-retry.feature` → `e2e/features/email/queue-retry.feature`
- `e2e/features/admin-gate.feature` → `e2e/features/admin/gate.feature`
- `e2e/features/auth.feature` → `e2e/features/auth/auth.feature`
- `e2e/features/mobile-nav.feature` → `e2e/features/mobile-nav/mobile-nav.feature`

**Step files mirror:** `e2e/steps/<domain>/<file>.ts` — same 7 renames.

**Scope:** pure rename + import-path rewrite in step files. No behavioral change. Playwright-bdd config already uses `features/**/*.feature` + `steps/**/*.ts` — no config change.

- [ ] **Step 1: Create the new subdirectories**

```bash
mkdir -p e2e/features/todo-list e2e/features/email e2e/features/admin e2e/features/auth e2e/features/mobile-nav
mkdir -p e2e/steps/todo-list e2e/steps/email e2e/steps/admin e2e/steps/auth e2e/steps/mobile-nav
```

- [ ] **Step 2: `git mv` the feature files**

```bash
git mv e2e/features/todo-lists.feature e2e/features/todo-list/lists.feature
git mv e2e/features/todos.feature e2e/features/todo-list/todos.feature
git mv e2e/features/collaborators.feature e2e/features/todo-list/collaborators.feature
git mv e2e/features/queue-retry.feature e2e/features/email/queue-retry.feature
git mv e2e/features/admin-gate.feature e2e/features/admin/gate.feature
git mv e2e/features/auth.feature e2e/features/auth/auth.feature
git mv e2e/features/mobile-nav.feature e2e/features/mobile-nav/mobile-nav.feature
```

- [ ] **Step 3: `git mv` the step files**

```bash
git mv e2e/steps/todo-lists.ts e2e/steps/todo-list/lists.ts
git mv e2e/steps/todos.ts e2e/steps/todo-list/todos.ts
git mv e2e/steps/collaborators.ts e2e/steps/todo-list/collaborators.ts
git mv e2e/steps/queue-retry.ts e2e/steps/email/queue-retry.ts
git mv e2e/steps/admin-gate.ts e2e/steps/admin/gate.ts
git mv e2e/steps/auth.ts e2e/steps/auth/auth.ts
git mv e2e/steps/mobile-nav.ts e2e/steps/mobile-nav/mobile-nav.ts
```

- [ ] **Step 4: Rewrite `..` imports to `../..` in every moved step file**

After the move, each step file sits one directory deeper. Imports like `../auth-client.ts` must become `../../auth-client.ts` — otherwise `..` resolves to `e2e/steps/` (nonexistent target).

Run this to find every import that needs updating:

```bash
grep -rn 'from "\.\./' e2e/steps/
```

For each hit, rewrite `from "../` to `from "../../`. Verify nothing broke:

```bash
grep -rn 'from "\.\./[^/]' e2e/steps/
```

Expected: no output (every `..` now has a sibling `..` = `../..`).

The files + common import targets you'll rewrite:
- `e2e/steps/admin/gate.ts` — `../test-env.ts`
- `e2e/steps/auth/auth.ts` — `../auth-client.ts`, `../fixtures/credentials.ts`, `../waits.ts`
- `e2e/steps/mobile-nav/mobile-nav.ts` — likely `../waits.ts` (verify by grep)
- `e2e/steps/todo-list/lists.ts` — (no `..` imports currently — verify)
- `e2e/steps/todo-list/todos.ts` — `../fixtures/credentials.ts`, `../waits.ts`
- `e2e/steps/todo-list/collaborators.ts` — `../fixtures/credentials.ts`, `../helpers/mailpit.ts`, `../test-env.ts`, `../waits.ts`
- `e2e/steps/email/queue-retry.ts` — `../test-env.ts` or similar — verify

Use sed carefully — the rewrite must ONLY touch the single-level `../` prefix at the start of the import path. Safe approach for each file:

```bash
# For each step file, open it and manually rewrite `from "../` to `from "../../`
```

Or if you trust sed with a tight pattern — the `[^./]` character class excludes both `.` and `/`, so an already-doubled `../../X` won't be rewritten into `../../../X`:

```bash
# macOS sed: sed -i '' -E
find e2e/steps -name "*.ts" -type f -exec sed -i '' -E 's|from "\.\./([^./])|from "../../\1|g' {} +
```

Verify:

```bash
# Should return ZERO single-`..` imports
grep -rnE 'from "\.\./[^./]' e2e/steps/
```

Expected: no output. Sanity-check by opening 2–3 files and eyeballing the imports.

- [ ] **Step 5: Verify TS still resolves**

```bash
pnpm -w run typecheck
```

Expected: PASS. If it fails with "cannot find module '../auth-client.ts'" or similar, a file was missed in Step 4 — run the grep and fix.

- [ ] **Step 6: Verify playwright-bdd still finds tests**

```bash
cd e2e && pnpm exec bddgen
```

Expected: generates `.features-gen/desktop` and `.features-gen/mobile` without errors. The `features/**/*.feature` globstar already walks subdirs.

Then:

```bash
cd /Users/iorlas/Workspaces/agentic-web-stack
make test ARGS="--list"
```

Expected: all existing scenarios listed (no reduction in count). If count dropped, bddgen missed files — re-check Step 2.

- [ ] **Step 7: Run a single scenario to verify end-to-end**

```bash
make test ARGS="--project desktop --grep 'Create a todo list'"
```

Expected: 1 pass. A wider smoke: `make test ARGS="--project desktop --grep 'Todo list collaborators'"` → 2 pass (the existing invite + revocation scenarios from Task 15).

- [ ] **Step 8: Run `make lint`**

```bash
make lint
```

Expected: PASS. `check-feature-emails.ts` reads `e2e/features/**/*.feature` — the glob still covers the new paths.

- [ ] **Step 9: Commit**

```bash
git add e2e/features e2e/steps
git commit -m "refactor(e2e): subfolder-per-domain layout + ../ → ../../ imports"
```

---

## Task 4: Restore real-time sync + multi-tab BDD scenarios

**Files:**
- Modify: `e2e/features/todo-list/collaborators.feature` (two new Scenario blocks)
- Modify: `e2e/steps/todo-list/collaborators.ts` (new Given/When/Then step defs; add `tabB?: Page` to `Actor`; add `heldLeaderLocksOn` helper)
- Clean up: remove `// DEFERRED` comments or unused stubs from the Task 15 step file
- Read-only reference: `apps/web/src/features/todo/sortable-todo-item.tsx` + `apps/web/src/features/todo/completed-todo-item.tsx` to find the exact checkbox selector for the toggle step

**Depends on:** Task 1 (collaborators can now `listTodos` + `completeTodo`), Task 2 (unit tests pass), Task 3 (the file lives at the new path).

- [ ] **Step 1: Append the real-time sync scenario to collaborators.feature**

Append to `e2e/features/todo-list/collaborators.feature`:

```gherkin
  Scenario: Real-time sync between owner and collaborator
    Given "alice" is signed up and signed in as "alice-sync" with email "alice-sync@example.com"
    And "bob" is signed up with username "bob-sync" and email "bob-sync@example.com"
    And "alice" has a list named "Shared sync"
    And "bob" is a collaborator on "Shared sync"
    And "Shared sync" has a todo "Milk"
    And "alice" has "Shared sync" open in a browser
    And "bob" has "Shared sync" open in a browser
    When "bob" toggles the todo "Milk" to done
    Then "alice" sees the todo "Milk" marked done within 3 seconds
```

The `"Shared sync" has a todo "Milk"` Given matches the EXISTING 2-arg step at `e2e/steps/todo-list/collaborators.ts` (post-Task 3 move; pre-move: `e2e/steps/collaborators.ts:223-242`). Do not invent a new `"<actor>"'s list "<listName>" has a todo ...` step — the existing one seeds as alice (the list owner) and is the right match. Using the existing step also avoids C2's tRPC body-shape gotcha (the existing impl uses the flat `{ todoListId, title }` body).

- [ ] **Step 2: Append the multi-tab scenario**

```gherkin
  Scenario: Multi-tab leader election holds exactly one Web Lock
    Given "alice" is signed up and signed in as "alice-multitab" with email "alice-multitab@example.com"
    And "bob" is signed up with username "bob-multitab" and email "bob-multitab@example.com"
    And "alice" has a list named "Shared multitab"
    And "bob" is a collaborator on "Shared multitab"
    When "bob" opens "Shared multitab" in two browser tabs
    Then exactly one of "bob"'s tabs holds the "leader-tab" Web Lock
```

- [ ] **Step 3: Identify the real completion selector on the todo items**

```bash
grep -n "completed\|data-completed\|checkbox\|toggle" apps/web/src/features/todo/sortable-todo-item.tsx apps/web/src/features/todo/completed-todo-item.tsx
```

Find the accessible name on the checkbox (likely `<Checkbox>` with a label, or a button-role element). You'll use `page.getByRole("listitem", { hasText: "Milk" })` scoped, then drill into it for the checkbox. If the items render as `<li>` with the todo title visible and a Radix/shadcn Checkbox inside, the selector is `li.hasText("Milk").getByRole("checkbox")` (or `getByLabel("Mark done")` / similar — whatever the component uses).

Record the real assertion: after a toggle, the row either migrates from the active list to the completed list (two separate `<ul>`s in the route), or flips a `data-completed` attribute, or the checkbox's `checked` state changes. Pick the assertion that's cheapest + most stable. Most likely candidate: `expect(row).toBeChecked()` if the checkbox is the accessible `<input type="checkbox">`, OR `expect(page.getByText("Milk")).toBeVisible()` inside a scoped completed-items locator.

- [ ] **Step 4: Extend `Actor` with `tabB?: Page` AND `userId: string`**

In `e2e/steps/todo-list/collaborators.ts`, the current `Actor` type (~line 24) is:

```ts
type Actor = {
  context: BrowserContext;
  page: Page;
  email: string;
  username: string;
};
```

Change it to:

```ts
type Actor = {
  context: BrowserContext;
  page: Page;
  tabB?: Page;       // populated only by multi-tab scenarios
  email: string;
  username: string;
  userId: string;    // Better-Auth user id; needed for Web Locks name matching
};
```

Then update `spawnActor` (~line 115) to fetch the user id after sign-in. Because `spawnActor` itself runs BEFORE sign-in (it only creates the browser context + page), the `userId` population happens in the sign-up Given that calls `spawnActor`:

```ts
// Fetches the Better-Auth user id from the actor's cookie-jar'd page.
// Returns the id string; throws if the session endpoint doesn't return one.
async function fetchUserId(page: Page): Promise<string> {
  const res = await page.request.get(`${TEST_API_URL}/api/auth/get-session`);
  if (!res.ok()) {
    throw new Error(
      `get-session failed: ${res.status()} ${await res.text()}`,
    );
  }
  const body = (await res.json()) as { user?: { id?: string } } | null;
  const id = body?.user?.id;
  if (!id) {
    throw new Error(
      `get-session returned no user.id. Body: ${JSON.stringify(body)}`,
    );
  }
  return id;
}
```

And update `spawnActor` to accept a post-signin hook, OR (simpler) populate `userId` inline in the Given at line 130 after `signInOnPage`:

```ts
Given(
  "{string} is signed up and signed in as {string} with email {string}",
  async ({ browser }, name: string, username: string, email: string) => {
    const actor = await spawnActor(browser, name, email, username);
    await signUpWithUsername(actor.page, email, username);
    await signInOnPage(actor.page, email, SHARED_PASSWORD);
    actor.userId = await fetchUserId(actor.page);
  },
);

Given(
  "{string} is signed up with username {string} and email {string}",
  async ({ browser }, name: string, username: string, email: string) => {
    const actor = await spawnActor(browser, name, email, username);
    await signUpWithUsername(actor.page, email, username);
    // Fetch userId BEFORE clearing cookies — the signup auto-logs in.
    actor.userId = await fetchUserId(actor.page);
    await actor.page.context().clearCookies();
  },
);
```

Initial construction in `spawnActor` line 123 needs to satisfy TS:

```ts
const actor: Actor = {
  context,
  page,
  email,
  username,
  userId: "",  // populated by the Given after sign-up via fetchUserId
};
```

Document this invariant with a comment so future callers know to populate `userId` immediately after sign-up.

- [ ] **Step 5: (Skipped — the existing `"{listName} has a todo {title}"` step from Task 15 already covers the scenario's seed need. No new step to write. C2 + C3 fixed by reusing the existing step.)**

- [ ] **Step 6: Add the `When "bob" toggles the todo "T" to done` step**

```ts
When(
  /^"([^"]+)" toggles the todo "([^"]+)" to done$/,
  async (_fixture, actorName: string, todoTitle: string) => {
    const actor = actors.get(actorName);
    if (!actor) throw new Error(`Unknown actor: ${actorName}`);
    const row = actor.page.getByRole("listitem", { hasText: todoTitle });
    // Selector adjusted per Step 3 discovery:
    const checkbox = row.getByRole("checkbox");
    await checkbox.click();
  },
);
```

Replace the checkbox selector with whatever Step 3 discovered. If the checkbox has an accessible name, prefer `row.getByRole("button", { name: /done|complete/i })` or `row.getByLabel(...)`.

- [ ] **Step 7: Add the `Then "alice" sees the todo "T" marked done within N seconds` step**

```ts
Then(
  /^"([^"]+)" sees the todo "([^"]+)" marked done within (\d+) seconds?$/,
  async (
    _fixture,
    actorName: string,
    todoTitle: string,
    withinSecs: string,
  ) => {
    const actor = actors.get(actorName);
    if (!actor) throw new Error(`Unknown actor: ${actorName}`);
    const timeout = parseInt(withinSecs, 10) * 1000;
    // Adjust assertion per Step 3 discovery: the completed state may render
    // as a visible row in a separate "completed" section, or as a
    // checked checkbox attribute, or a strike-through class.
    // Most likely: row moves to a completed section, reachable via text.
    const row = actor.page.getByRole("listitem", { hasText: todoTitle });
    await expect(row.getByRole("checkbox")).toBeChecked({ timeout });
  },
);
```

If the completed state renders in a different list (no longer `role=listitem` in the active `<ul>`), invert the assertion:

```ts
await expect(
  actor.page.locator("ul:has(> li:has-text('Milk'))")
    .filter({ hasText: /completed/i }),
).toBeVisible({ timeout });
```

Prefer the checkbox assertion if the items stay as `<li>` throughout. Step 3's reading of the UI code determines the right shape.

- [ ] **Step 8: Add the `When "bob" opens "X" in two browser tabs` step**

```ts
When(
  /^"([^"]+)" opens "([^"]+)" in two browser tabs$/,
  async (_fixture, actorName: string, listName: string) => {
    const actor = actors.get(actorName);
    if (!actor) throw new Error(`Unknown actor: ${actorName}`);
    const listId = await resolveListIdFor(actor, listName);
    const url = `/todo-lists/${listId}`;

    // Primary tab: navigate actor.page
    await actor.page.goto(url);
    await waitForHydration(actor.page);

    // Second tab: spawn a new page in the same context (shares cookies)
    const tabB = await actor.context.newPage();
    await tabB.goto(url);
    await waitForHydration(tabB);

    actor.tabB = tabB;
  },
);
```

`waitForHydration` is imported from `../../waits.js` (already in scope post-Task 3).

- [ ] **Step 9: Add the `heldLeaderLocksOn` helper**

Near the top of the step file (alongside other helpers):

```ts
async function heldLeaderLocksOn(page: Page, userId: string): Promise<number> {
  return page.evaluate(async (uid) => {
    const snap = await navigator.locks.query();
    const name = `leader-tab:${uid}`;
    return (snap.held ?? []).filter((l) => l.name === name).length;
  }, userId);
}
```

- [ ] **Step 10: Add the `Then exactly one of "bob"'s tabs holds the "leader-tab" Web Lock` step**

```ts
Then(
  /^exactly one of "([^"]+)"'s tabs holds the "leader-tab" Web Lock$/,
  async (_fixture, actorName: string) => {
    const actor = actors.get(actorName);
    if (!actor) throw new Error(`Unknown actor: ${actorName}`);
    if (!actor.tabB) {
      throw new Error(
        `Actor "${actorName}" has no second tab. Call "opens X in two browser tabs" first.`,
      );
    }
    await expect
      .poll(
        async () => {
          const counts = await Promise.all([
            heldLeaderLocksOn(actor.page, actor.userId),
            heldLeaderLocksOn(actor.tabB as Page, actor.userId),
          ]);
          return counts[0] + counts[1];
        },
        { timeout: 2000, intervals: [100, 250, 500] },
      )
      .toBe(1);
  },
);
```

- [ ] **Step 11: Remove stale DEFERRED comments / stub steps**

```bash
grep -n "DEFERRED\|TODO(task-15)" e2e/steps/todo-list/collaborators.ts
```

For each hit, the stub step it references is now implemented by Steps 5–10. Remove the comment and, if the step was a no-op stub, delete it. Leave the file clean — no orphaned comments.

- [ ] **Step 12: Run the new real-time sync scenario**

```bash
make test ARGS="--project desktop --grep 'Real-time sync between owner and collaborator'"
```

Expected: 1 pass. If it fails:
- "Timed out waiting for checkbox to be checked" — Step 3's selector was wrong. Re-read the UI components and adjust.
- "seed todo failed: 401" — `resolveListIdFor`'s session cookie isn't flowing to `/trpc/todo.create`. Verify the actor is signed in via `signInViaApi`.
- "Element not found: Milk" — Alice's page hasn't received the realtime update yet. Confirm the subscription is open (`useTodoListLiveUpdates` hook wired in `$listId.tsx`), and that `todoList.onListEvent` publishes the right event shape.

- [ ] **Step 13: Run the multi-tab scenario 5 times — ship criterion check**

```bash
for i in 1 2 3 4 5; do
  make test ARGS="--project desktop --grep 'Multi-tab leader election'" || exit 1
done
```

Expected: 5/5 pass. Also note the first-successful-poll interval bucket — if it varies across runs (e.g., sometimes 100ms, sometimes 500ms), that's instability. If all 5 land in the same bucket → ship. If not → fall into the fallback clause.

- [ ] **Step 14: Multi-tab fallback (ONLY if Step 13 fails the ship criterion)**

Time-box: 90 minutes of debugging.

Common fixes to try:
- `await waitForHydration(tabB)` might be racing the Web Lock acquisition. Add an explicit `await expect.poll(() => heldLeaderLocksOn(...), { timeout: 5000 }).toBeGreaterThan(0)` after both tabs are open but before the final assertion — lets the election settle.
- Increase poll timeout from 2000 → 5000ms if the timing is borderline.

If after 90 min the scenario still fails the ship criterion: DELETE the scenario (+ the multi-tab steps + `tabB?` on Actor if truly unused) and record in Task 5's handover doc that multi-tab BDD was deliberately skipped. Do NOT leave `@skip` or `@flaky`.

- [ ] **Step 15: Run the full collaborators suite**

```bash
make test ARGS="--project desktop --grep 'Todo list collaborators'"
```

Expected: 4/4 pass (the 2 existing from Task 15 + the 2 new) — or 3/3 if multi-tab fallback triggered.

- [ ] **Step 16: Run the full desktop suite to confirm no regressions**

```bash
make test ARGS="--project desktop"
```

Expected: all pre-existing scenarios still pass.

- [ ] **Step 17: Run `make lint`**

```bash
make lint
```

Expected: PASS. `check-feature-emails.ts` will verify the new scenarios' emails are unique — each Scenario introduces fresh `alice-sync@` + `bob-sync@` / `alice-multitab@` + `bob-multitab@` emails.

- [ ] **Step 18: Commit**

```bash
git add e2e/features/todo-list/collaborators.feature e2e/steps/todo-list/collaborators.ts
git commit -m "test(e2e): restore real-time sync + multi-tab leader-election scenarios"
```

---

## Task 5: Cross-layer naming convention + `check-domain-names.ts` + handover doc

**Files:**
- Create: `scripts/check-domain-names.ts`
- Modify: `Makefile` (`lint:` target — add the new check)
- Modify: `CLAUDE.md` (root — new "Cross-Layer Naming" section)
- Modify: `apps/web/CLAUDE.md` (one-line cross-ref)
- Modify: `packages/api/CLAUDE.md` (one-line cross-ref)
- Modify: `e2e/CLAUDE.md` (one-line cross-ref; also update "Feature File Organization" to show subfolder-per-domain)
- Create: `docs/superpowers/specs/2026-04-19-plan-c-followups-handover.md`

**Scope:** documented + enforced convention. Record shipped state + deferrals in a self-sufficient handover.

- [ ] **Step 1: Create `scripts/check-domain-names.ts`**

Mirror the shape of `scripts/check-trpc-patterns.ts`. Write:

```ts
// Enforces the cross-layer naming convention: a domain name that appears in one
// layer must appear in every OTHER layer relevant to it, except when on the
// allowlist.
//
// Layers:
//   - frontend:  apps/web/src/features/<name>/
//   - backend:   packages/api/src/domains/<name>/
//   - e2e-feat:  e2e/features/<name>/
//   - e2e-steps: e2e/steps/<name>/
//
// Allowlist: names intentionally present in only some layers. The VALUE is
// the set of layers where the name is ALLOWED to be missing. These reflect
// the repo's current asymmetries — re-audit whenever a new domain lands.
//
//   - auth       backend lives in packages/auth/ (not @project/api);
//                frontend + e2e present
//                → allowed-missing: backend
//   - admin      admin UI is Hono-mounted Bull Board (apps/server), not
//                apps/web; admin auth lives in apps/server/src/admin/
//                middleware, not @project/api
//                → allowed-missing: frontend, backend
//   - mobile-nav purely frontend navigation concern; no backend domain,
//                no admin e2e beyond what the feature tests cover
//                → allowed-missing: backend
//                (frontend + e2e-feat + e2e-steps all present)
//   - email      email delivery lives in packages/email (a standalone
//                package), not in apps/web or @project/api; no frontend
//                surface for the email infra itself
//                → allowed-missing: frontend, backend
//   - todo       after Task 3's migration, todos merged into the
//                todo-list e2e subfolder (single domain from the BDD
//                perspective); frontend + backend still have their own
//                todo subfolder
//                → allowed-missing: e2e-feat, e2e-steps
//
// Rule:
//   For each name present in backend OR frontend, it must also appear in e2e-feat
//   and e2e-steps whenever it has any BDD coverage. We check by taking the union
//   of (backend ∪ frontend) minus the allowlist, and for each name verifying it
//   exists in e2e-feat and e2e-steps OR is in the "no-bdd" allowlist.
//
// Exits 1 on mismatch with a clear file-path message.

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

function listSubdirs(rel: string): string[] {
  const full = join(ROOT, rel);
  try {
    return readdirSync(full)
      .filter((name) => statSync(join(full, name)).isDirectory())
      .sort();
  } catch {
    return [];
  }
}

const frontend = new Set(listSubdirs("apps/web/src/features"));
const backend = new Set(listSubdirs("packages/api/src/domains"));
const e2eFeat = new Set(listSubdirs("e2e/features"));
const e2eSteps = new Set(listSubdirs("e2e/steps"));

// Names that ARE deliberately missing from one or more layers.
// Extend this list when a new cross-layer-asymmetric domain lands.
const ALLOWLIST: Record<string, Set<"frontend" | "backend" | "e2e-feat" | "e2e-steps">> = {
  auth: new Set(["backend"]),
  admin: new Set(["frontend", "backend"]),
  "mobile-nav": new Set(["backend"]),
  email: new Set(["frontend", "backend"]),
  todo: new Set(["e2e-feat", "e2e-steps"]),
};

type Layer = "frontend" | "backend" | "e2e-feat" | "e2e-steps";
const layerPath: Record<Layer, string> = {
  frontend: "apps/web/src/features",
  backend: "packages/api/src/domains",
  "e2e-feat": "e2e/features",
  "e2e-steps": "e2e/steps",
};
const layerSets: Record<Layer, Set<string>> = {
  frontend,
  backend,
  "e2e-feat": e2eFeat,
  "e2e-steps": e2eSteps,
};

const allNames = new Set<string>([
  ...frontend,
  ...backend,
  ...e2eFeat,
  ...e2eSteps,
]);

let failed = false;
for (const name of [...allNames].sort()) {
  const allowedMissing = ALLOWLIST[name] ?? new Set<Layer>();
  const layers: Layer[] = ["frontend", "backend", "e2e-feat", "e2e-steps"];
  for (const layer of layers) {
    if (!layerSets[layer].has(name) && !allowedMissing.has(layer)) {
      console.error(
        `[check-domain-names] "${name}" missing from ${layer} (expected at ${layerPath[layer]}/${name}/).`,
      );
      console.error(
        `  If this asymmetry is intentional, add "${name}" to the ALLOWLIST in scripts/check-domain-names.ts.`,
      );
      console.error("");
      failed = true;
    }
  }
}

if (failed) process.exit(1);
console.log("[check-domain-names] OK");
```

- [ ] **Step 2: Wire into `Makefile`**

In `Makefile`, the `lint:` target currently ends at line 54 with `@bun scripts/check-trpc-patterns.ts`. Add a new line AFTER that:

```makefile
	@bun scripts/check-domain-names.ts
```

- [ ] **Step 3: Run the new check — expect PASS**

```bash
bun scripts/check-domain-names.ts
```

Expected post-Task-3 layer contents (verify before running):
- `apps/web/src/features/` = `{auth, todo, todo-list}`
- `packages/api/src/domains/` = `{todo, todo-list}`
- `e2e/features/` = `{admin, auth, email, mobile-nav, todo-list}`
- `e2e/steps/` = `{admin, auth, email, mobile-nav, todo-list}`

The allowlist values in Step 1 reflect these asymmetries:
- `auth`: no backend (lives in `packages/auth/`)
- `admin`: no frontend (Bull Board UI), no backend domain (Hono middleware in `apps/server`)
- `mobile-nav`: no backend
- `email`: no frontend, no backend domain (uses `packages/email/`)
- `todo`: no e2e subfolder (merged into `todo-list/` post-migration)

Expected output: `[check-domain-names] OK`.

If the script fails, DO NOT just add names to the allowlist to silence it. First check whether the discrepancy is:
- **Real asymmetry** (like the five above) → add to allowlist with a comment explaining WHY.
- **Accidental drift** (e.g., `apps/web/src/features/invoice/` with no backend counterpart) → that's a real bug surfaced by the check; raise it, don't paper over.

- [ ] **Step 4: Run `make lint` — expect PASS**

```bash
make lint
```

Expected: 16 checks PASS (was 15). If the new check fires, see Step 3.

- [ ] **Step 5: Add the "Cross-Layer Naming" section to root `CLAUDE.md`**

Root `CLAUDE.md` currently documents `Structure`, `Commands`, `Development Workflow`, `Package Naming`, `Critical Rules`, etc. Insert a new section AFTER `## Package Naming` (search for that heading; it's ~line 50 depending on prior edits). Content:

```markdown
## Cross-Layer Naming

A domain's name is reused across every layer it touches. The layer terminology differs — web calls them *features* (FSD), API calls them *domains* (DDD) — but the name is the same.

| Layer | Path template |
|---|---|
| Web | `apps/web/src/features/<name>/` |
| API | `packages/api/src/domains/<name>/` |
| E2E features | `e2e/features/<name>/` |
| E2E step defs | `e2e/steps/<name>/` |

A new capability lands under the same `<name>` in every layer it touches.

**Enforced by** `scripts/check-domain-names.ts` (runs via `make lint`). Asymmetric-by-design domains (backend-only `auth`, frontend-only `mobile-nav`) are hard-coded in the script's allowlist. If you add a new asymmetric domain, extend the allowlist rather than silencing the check.
```

- [ ] **Step 6: Cross-link from `apps/web/CLAUDE.md`**

At the TOP of `apps/web/CLAUDE.md` (after the `# apps/web — …` heading), add a one-liner:

```markdown
> **Cross-layer naming:** each feature's folder name mirrors `packages/api/src/domains/<same-name>/` and `e2e/features/<same-name>/`. See root `CLAUDE.md` § "Cross-Layer Naming".
```

- [ ] **Step 7: Cross-link from `packages/api/CLAUDE.md`**

Same treatment at the top:

```markdown
> **Cross-layer naming:** each domain's folder name mirrors `apps/web/src/features/<same-name>/` and `e2e/features/<same-name>/`. See root `CLAUDE.md` § "Cross-Layer Naming".
```

- [ ] **Step 8: Cross-link from `e2e/CLAUDE.md` + update the "Feature File Organization" section**

At the top, add:

```markdown
> **Cross-layer naming:** each domain subfolder mirrors `apps/web/src/features/<same-name>/` and `packages/api/src/domains/<same-name>/`. See root `CLAUDE.md` § "Cross-Layer Naming".
```

Then find the existing "Feature File Organization" section and update it. Current text (approximately):

> Feature files map to **domain areas**, not individual capabilities:
> - `auth.feature` — all authentication scenarios
> - `todos.feature` — all todo scenarios (CRUD, reorder, completion)
> - `mobile-nav.feature` — navigation-specific scenarios

Replace with:

```markdown
## Feature File Organization

Feature files live in subfolders named after the domain. The subfolder name matches `apps/web/src/features/<name>/` and `packages/api/src/domains/<name>/`.

```
e2e/
  features/
    auth/
      auth.feature         # sign up / sign in / sign out / protected route
    todo-list/
      lists.feature        # list CRUD + privacy
      todos.feature        # todo CRUD + reorder + completion + CSV
      collaborators.feature # invite, real-time sync, multi-tab, revocation
    email/
      queue-retry.feature  # BullMQ retry + dead-letter via Bull Board
    admin/
      gate.feature         # /admin/queues authz
    mobile-nav/
      mobile-nav.feature   # mobile-specific navigation
  steps/
    auth/auth.ts
    todo-list/lists.ts
    todo-list/todos.ts
    todo-list/collaborators.ts
    email/queue-retry.ts
    admin/gate.ts
    mobile-nav/mobile-nav.ts
```

Split into multiple files within a domain when a single feature file exceeds ~15-20 scenarios. Step-file names mirror feature-file names.
```

- [ ] **Step 9: Create the handover doc**

Create `docs/superpowers/specs/2026-04-19-plan-c-followups-handover.md`:

```markdown
# Plan C Follow-ups — Handover

**Branch:** `feat/template-reference-impl`
**Status:** Plan C (Tasks 10–16) + Plan C follow-ups shipped.
**Supersedes:** `docs/superpowers/specs/2026-04-19-template-reference-impl-handover.md` for everything after Task 9.

## What shipped

### Plan C execution session (commits `df99f7c..49b31d1`)
Tasks 10–16 of `docs/superpowers/plans/2026-04-19-template-ref-c-realtime-collaborators.md`. Frontend realtime wiring + invite UX + e2e. Two BDD scenarios deferred at the time (real-time sync, multi-tab) — closed in this session.

### Plan C follow-ups session (commits following `49b31d1` on this branch — 5 commits per this plan's commit plan)
Implements `docs/superpowers/plans/2026-04-19-plan-c-followups.md`:
- **Task 1** — widened todo authz in `packages/api/src/domains/todo/service.ts`. Every `userId` filter in `where:` clauses replaced with a `canReadList(db, viewerId, todoListId)` gate. `Todo.userId` is now a creator audit field, not an authorization key. Lock helpers (`lockActiveTodos`, `shiftActivePositions`) lose their `userId` parameter — collaborators now contend on the same position-space as the owner (correct: they ARE racing). CSV import/export included in the widening.
- **Task 2** — 9 new bun-test cases in `packages/api/src/domains/todo/__tests__/service.test.ts` covering 7 collaborator happy-paths + 2 outsider-gets-FORBIDDEN. Test count 61 → 70.
- **Task 3** — e2e subfolder-per-domain migration: 7 feature files + 7 step files moved to `e2e/features/<domain>/` + `e2e/steps/<domain>/`. Import paths rewritten `..` → `../..`.
- **Task 4** — restored two BDD scenarios: "Real-time sync between owner and collaborator" (3s assertion — see notes below) and "Multi-tab leader election holds exactly one Web Lock" (via `navigator.locks.query()` direct invariant check). [IF MULTI-TAB FALLBACK TRIGGERED: the multi-tab scenario was deliberately NOT shipped — see "Remaining deferrals" below.]
- **Task 5** — cross-layer naming convention documented in root `CLAUDE.md` + enforced by `scripts/check-domain-names.ts` (wired into `make lint`). Sub-CLAUDE.mds cross-link to the root rule.

## Decisions made (with rationale)

- **Authz = full parity (option A).** Collaborators are indistinguishable from owners for todo CRUD + CSV. Rationale: Plan C reads as symmetrical collaboration; tightening later is easier than rescinding permissions. `TodoListMembership.role` is stored but not enforced.
- **Real-time sync assertion tolerance = 3 seconds, not 1 second.** React-query's default retry backoff + network round-trip + subscription invalidation hook = realistic floor is ~1.5s. Plan C's "within 1 second" framing is a user-facing claim, NOT a BDD assertion floor. Do not tighten this or the test will flake.
- **Multi-tab correctness check via `navigator.locks.query()` not `page.on("websocket")`.** Direct invariant (one lock holder per user-scoped lock name) is deterministic; counting WS events has timing races.

## Starting points for common next-session tasks

- **Touching authz on todos or lists:** `packages/api/src/domains/todo-list/service.ts:52` (`canReadList`). All authz decisions inside the todo domain funnel through this helper.
- **Adding a new realtime event:** extend `TodoListEvent` in `packages/api/src/domains/todo-list/events.ts`, then decide whether to invalidate a new query filter in `apps/web/src/features/todo-list/use-todo-list-live-updates.ts` → `applyEvent`.
- **Multi-actor BDD (two browser contexts):** see `e2e/steps/todo-list/collaborators.ts` — `spawnActor`, the module-level `actors` map, and the `After` hook. Pattern is reusable for any scenario needing 2+ distinct sessions.
- **CSV import/export:** `packages/api/src/domains/todo/service.ts` — `importTodosFromCSV` + `exportTodosAsCSV`. Both gated via `canReadList`; creator audit via `userId` on `data:`.

## Test data convention

Every BDD email is scenario-scoped (e.g., `alice-sync@example.com` vs `alice-multitab@example.com`). No shared fixture exists; each scenario picks fresh user emails. The `e2e/scripts/check-feature-emails.ts` guard (runs in `make lint`) enforces uniqueness.

## Explicit remaining deferrals

- **`TodoListMembership.role` not enforced.** Becomes relevant when write-tiers (viewer/editor/admin) are wanted. Extend `canReadList` → split into `canReadList` + `canWriteList` and branch on role.
- **`/invites/:token` error UX is redirect-only.** Expired/consumed tokens → redirect to `/todo-lists`. Production would add explicit error pages (invite not found, already accepted, expired).
- **`Todo.userId` creator vs authorization drift.** When a creator loses collaborator access (owner removes them), their `Todo` rows stay pointing at an outside user. Non-goal today; worth a post-MVP audit if display/filtering needs to handle orphaned creators.
- **[IF MULTI-TAB FALLBACK TRIGGERED: Multi-tab BDD scenario.** The multi-tab-leader-election BDD scenario was deliberately not shipped after one 90-minute debugging pass failed the ship criterion (5 consecutive passes, first-poll in the same interval bucket). Multi-tab correctness is browser-guaranteed by the Web Locks spec + existing `useLeaderTab` logic. No BDD coverage is a deliberate choice. **]**

## Pre-existing deferrals carried forward from Plan C

- **Redis subscriber leak** — `RedisChannelImpl` keeps a subscriber connection alive after the last handler unsubs. See `packages/realtime/src/redis-channel.ts:46`. Fine for the template; production would add a reaper.
- **Nodemailer inside transaction latency.** `sendEmail` for invite flow is awaited post-commit (router), but the `await` still blocks the request. A fire-and-forget pattern (or a dedicated "enqueue-after-commit" helper) would improve production latency.
- **Better-Auth username typing.** `session.user.role` + `session.user.username` are cast at the authz boundary. If Better-Auth typegen ever lands in the repo, drop the cast.

## Next session quick-start

1. `git checkout feat/template-reference-impl`
2. `make setup`
3. `make lint` — 16 checks + tsc PASS (15 original + `check-domain-names`)
4. `make test-unit` — 70 tests pass
5. `make test ARGS="--project desktop --grep 'Todo list collaborators'"` — 4/4 pass (or 3/3 if multi-tab fallback was taken; see deferrals)
6. `make dev` to exercise manually: open two private windows, invite from one to the other, toggle a todo, remove the collaborator, verify access-lost screen.
```

Fill in `<BASE>..<HEAD>` after Task 5 is committed (run `git rev-parse` on the first commit of this session and HEAD).

- [ ] **Step 10: Run `make lint` — expect PASS**

```bash
make lint
```

Expected: 16 checks PASS + tsc PASS.

- [ ] **Step 11: Verify the handover doc is self-sufficient**

Read your newly-written handover doc as if you were a fresh session with no prior context. Can you answer:
- What shipped?
- Which branch is this?
- What's the state of `listTodos` authz?
- Which tests pass and how many?
- What's explicitly NOT done?

If any answer requires reading the plan file or commit messages beyond the SHAs cited, add the missing detail to the handover.

- [ ] **Step 12: Commit**

```bash
git add scripts/check-domain-names.ts Makefile CLAUDE.md \
        apps/web/CLAUDE.md packages/api/CLAUDE.md e2e/CLAUDE.md \
        docs/superpowers/specs/2026-04-19-plan-c-followups-handover.md
git commit -m "docs: cross-layer naming convention + Plan C follow-ups handover + check-domain-names"
```

(No Step 13 — the handover doc now cites "commits following `49b31d1` on this branch" rather than a precise range, so no post-commit amend is needed. `git log 49b31d1..HEAD` from any future session will enumerate the exact commits.)

---

## Verification Checklist

After all 5 tasks land, run:

- [ ] `make lint` — 16 checks + tsc PASS (was 15 before Task 5)
- [ ] `make test-unit` — 70 tests pass (was 61 before Task 2)
- [ ] `grep -nE "where:\s*\{[^}]*userId" packages/api/src/domains/todo/service.ts` — zero hits (Task 1 invariant)
- [ ] `make test ARGS="--project desktop --grep 'Todo list collaborators'"` — 4/4 pass (or 3/3 if multi-tab fallback triggered)
- [ ] `make test` — full suite green on desktop (mobile unchanged)
- [ ] `bun scripts/check-domain-names.ts` — `OK`
- [ ] Root `CLAUDE.md` has a "Cross-Layer Naming" section; `apps/web/CLAUDE.md` + `packages/api/CLAUDE.md` + `e2e/CLAUDE.md` cross-link to it
- [ ] `docs/superpowers/specs/2026-04-19-plan-c-followups-handover.md` exists and is self-sufficient
- [ ] Commit range 49b31d1..HEAD contains exactly 5 commits matching the Commit Plan in the spec
