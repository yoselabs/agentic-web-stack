# Plan C Follow-ups — Design

**Date:** 2026-04-19
**Branch:** `feat/template-reference-impl`
**Status:** Design approved; plan to be written next.
**Depends on:** Plan C shipped (commits df99f7c..49b31d1).

## Goal

Close out the three threads deferred during Plan C Tasks 10–16 execution:

1. **Real-time todo sync** — the hero BDD scenario "Bob toggles a todo, Alice sees it within 1s" was dropped because `listTodos` (and the mutation services) filter by `userId`, so collaborators see zero todos and can't modify any. Widen authz: any user with read access to the list can CRUD todos in it ("full parity", decision A).
2. **Multi-tab leader election** — the BDD scenario was dropped as flaky under Playwright (counting `page.on("websocket")` events has timing races). Retry with `navigator.locks.query()` inside both tabs; direct check of the invariant we actually care about.
3. **Durable deferral record** — the deferrals from Plan C live only in commit messages + chat summaries. Write a handover doc so the next session rediscovers the state without replaying the transcript.

Alongside, adopt a subfolder-per-domain layout in `e2e/features/` and `e2e/steps/` so the e2e tree mirrors `apps/web/src/features/<name>/` + `packages/api/src/domains/<name>/`. Document this as a first-class convention in root `CLAUDE.md`.

## Non-goals

- Role-based authz inside a list (`TodoListMembership.role` stays a hint, not a gate). Defer until first role-differentiated behavior is needed.
- Invite-accept error UX (expired token, already accepted). Template suffices with redirect-to-`/todo-lists`.
- Revisiting unrelated owner-only filters in other domains (auth, admin). Scope stays on the todo domain.

## Architecture changes

### Authz widening — `packages/api/src/domains/todo/service.ts`

Every mutation + the `listTodos` read currently filters by `{ userId, todoListId }`. Replace with a `canReadList(db, viewerId, todoListId)` gate at the top of each function; on pass, the DB query operates on `todoListId` only.

**Every occurrence of `userId` as an authz filter drops.** The list below enumerates every site; each site must change together with the function it lives in, or the service silently no-ops on collaborator calls (Prisma's compound `where` throws `P2025` for non-matches; raw SQL `UPDATE` affects 0 rows). Sites to rewrite:

| Function | Filter sites to change (all drop `userId`) |
|---|---|
| `listTodos` | `findMany({ where: { userId, todoListId } })` → `{ todoListId }` |
| `createTodo` | helpers' `userId` param (see knock-on below); `data.userId` stays (creator audit) |
| `completeTodo` | `findUniqueOrThrow({ where: { id, userId } })`, `update({ where: { id, userId } })` ×2 |
| `deleteTodo` | `delete({ where: { id, userId } })` |
| `reorderTodos` | raw SQL `WHERE t.id = d.id AND t."userId" = ${userId}` — drop the `AND` clause entirely |
| `importTodosFromCSV` | `updateMany({ where: { userId, completed: false, todoListId } })` → `{ completed: false, todoListId }`; `createMany.data[i].userId` stays as `creatorId` |
| `exportTodosAsCSV` | `findMany({ where: { userId, todoListId } })` → `{ todoListId }` |
| helper `shiftActivePositions` | drops `userId` param + filter (see knock-on) |
| helper `lockActiveTodos` | drops `userId` param + filter (see knock-on) |

**Shape, applied uniformly (three representative rewrites shown; others follow same pattern):**

```ts
export async function listTodos(db: DbClient, viewerId: string, todoListId: string) {
  const allowed = await canReadList(db, viewerId, todoListId);
  if (!allowed) throw new TRPCError({ code: "FORBIDDEN" });
  return db.todo.findMany({
    where: { todoListId },
    orderBy: [{ completed: "asc" }, { position: "asc" }],
    include: { todoList: true },
  });
}

export async function completeTodo(tx, viewerId: string, id: string, completed: boolean) {
  const todo = await tx.todo.findUniqueOrThrow({ where: { id } });  // no viewer filter
  const allowed = await canReadList(tx, viewerId, todo.todoListId);
  if (!allowed) throw new TRPCError({ code: "FORBIDDEN" });
  if (!completed) {
    await lockActiveTodos(tx, todo.todoListId);
    await shiftActivePositions(tx, todo.todoListId);
    return tx.todo.update({ where: { id }, data: { completed: false, position: 0 } });
  }
  return tx.todo.update({ where: { id }, data: { completed } });
}

export async function reorderTodos(tx, viewerId: string, todoListId: string, ids: string[]) {
  const allowed = await canReadList(tx, viewerId, todoListId);
  if (!allowed) throw new TRPCError({ code: "FORBIDDEN" });
  const pairs = ids.map((id, i) => Prisma.sql`(${id}::text, ${i}::integer)`);
  await tx.$executeRaw`
    UPDATE "Todo" AS t
    SET "position" = d.new_position
    FROM (VALUES ${Prisma.join(pairs, ",")}) AS d(id, new_position)
    WHERE t.id = d.id
  `;
}
```

Note `reorderTodos` signature gains a `todoListId` parameter — currently takes just `ids`. Router call site updates accordingly: the tRPC mutation already receives `{ ids }` but can trivially include `todoListId` (TodoListDetail already knows it). If the router already passes it, no change; otherwise add it to the Zod input.

**CSV scope decision — include.** `importTodosFromCSV` and `exportTodosAsCSV` ARE in scope for full parity. Collaborators can bulk-import CSVs onto a shared list and export the combined list. Leaving them owner-only would make import/export asymmetric with single-row CRUD — surprising and unjustified. Both functions drop the `userId` filter per the table above; gate each with `canReadList(viewerId, todoListId)` at the top. `importTodosFromCSV`'s `createMany.data[i].userId` continues to use `creatorId` (audit), same shift as `createTodo`.

**Knock-on — lock helpers lose their `userId` parameter:**

```ts
async function lockActiveTodos(tx, todoListId: string): Promise<void> {
  await tx.$queryRaw`
    SELECT id FROM "Todo"
    WHERE "todoListId" = ${todoListId} AND "completed" = false
    ORDER BY id
    FOR NO KEY UPDATE
  `;
}

async function shiftActivePositions(tx, todoListId: string): Promise<void> {
  await tx.todo.updateMany({
    where: { completed: false, todoListId },
    data: { position: { increment: 1 } },
  });
}
```

**Lock-scope widening, callsite-by-callsite:** every `lockActiveTodos` + `shiftActivePositions` + `importTodosFromCSV`'s `updateMany` MUST drop `userId` in lockstep. If `lockActiveTodos` widens but `shiftActivePositions` still filters by `userId`, OWNER's unlocked rows get shifted under a COLLAB create, producing `position=0` collisions. Lint check: after rewrite, no occurrence of `userId` appears in any `where:` clause of `service.ts` except inside the `canReadList` helper (which lives in `todo-list/service.ts`).

**Meaning shift:** `Todo.userId` becomes "who created this row" (audit), not "who may access it" (authz). Schema unchanged; no migration. Future consideration (non-goal today, note in handover): if a creator is later removed from the list, their Todo rows stay pointing at a now-outside user. No plan for that today.

### Unit tests — `packages/api/src/domains/todo/__tests__/service.test.ts`

Add a `describe("todo CRUD by collaborators")` block mirroring the setup in `todo-list/__tests__/service.test.ts`'s `"collaborator lifecycle"` block (seed OWNER + COLLAB + OUTSIDER, create list, add COLLAB via `todoListMembership.create`, teardown per case + per describe).

New cases (9 total, one `it` each):

| Case | Actor | Action | Expected |
|---|---|---|---|
| listTodos — collaborator | COLLAB | `listTodos(db, COLLAB, listId)` | Returns all todos in the list (owner's + collaborator's) |
| createTodo — collaborator | COLLAB | `createTodo(tx, COLLAB, "x", listId)` | Row created, `userId === COLLAB` |
| completeTodo — collaborator toggles owner's todo | COLLAB | `completeTodo(tx, COLLAB, ownerTodoId, true)` | Returns updated row with `completed === true` (asserts on row's `id` and `completed`, not just no-throw — catches `{id, userId}` filter leaks that would silently update 0 rows) |
| deleteTodo — collaborator deletes owner's todo | COLLAB | `deleteTodo(tx, COLLAB, ownerTodoId)` | Returns deleted row; subsequent `findUnique({id})` returns `null` (asserts actual deletion, catches stale `{id, userId}` filter) |
| reorderTodos — collaborator | COLLAB | Pre-seed owner's todos at positions `[0, 1]`; `reorderTodos(tx, COLLAB, listId, [secondId, firstId])` | After call: `findMany` shows `firstId.position === 1`, `secondId.position === 0` (asserts actual position values, catches stale `userId` filter in raw SQL) |
| CSV export — collaborator | COLLAB | `exportTodosAsCSV(db, COLLAB, listId)` | Includes owner's titles in the CSV output |
| CSV import — collaborator | COLLAB | `importTodosFromCSV(tx, COLLAB, buf, listId)` | New rows have `userId === COLLAB`, list contains them |
| listTodos — outsider | OUTSIDER | `listTodos(db, OUTSIDER, listId)` | Throws `TRPCError` with `code === "FORBIDDEN"` |
| createTodo — outsider | OUTSIDER | `createTodo(tx, OUTSIDER, "x", listId)` | Throws `TRPCError` with `code === "FORBIDDEN"` |

Existing owner-only tests stay unchanged (owner IS allowed).

**Coverage rationale.** `canReadList` is list-level-tested, so two FORBIDDEN cases (one query, one mutation) cover the gate. The other 7 tests target a different failure mode: the risk that one of the 9 `userId` filter sites listed in the Authz table wasn't dropped, producing silent no-ops rather than FORBIDDEN throws. Each positive-path test asserts the *effect* of the mutation (row's new state, actual positions, CSV content) — not just "no exception" — so a lingering filter surfaces as a test failure, not a false positive.

**Updated test count projection:** 61 → 70 (was 68 in an earlier revision of this spec; increased after adding row-effect assertions + CSV positive-paths).

### E2E subfolder migration + scenario restoration

**Migration (one commit, pure rename):**

```
e2e/features/todo-lists.feature      → e2e/features/todo-list/lists.feature
e2e/features/todos.feature           → e2e/features/todo-list/todos.feature
e2e/features/collaborators.feature   → e2e/features/todo-list/collaborators.feature
e2e/features/queue-retry.feature     → e2e/features/email/queue-retry.feature
e2e/features/admin-gate.feature      → e2e/features/admin/gate.feature
e2e/features/auth.feature            → e2e/features/auth/auth.feature
e2e/features/mobile-nav.feature      → e2e/features/mobile-nav/mobile-nav.feature
```

Step files migrate in parallel (`e2e/steps/<domain>/<file>.ts`). `git mv` preserves history. Playwright-bdd config already uses `features/**/*.feature` + `steps/**/*.ts` — no config change.

**Import-path rewrites land in the SAME commit as the move.** Every current step file imports from one directory up (`../auth-client.ts`, `../waits.ts`, `../test-env.ts`, `../fixtures/credentials.ts`, `../helpers/mailpit.ts`). After moving into a subfolder, these must become `../../` — otherwise `..` resolves to `e2e/steps/` (nonexistent targets). Files needing rewrite: `e2e/steps/auth.ts`, `admin-gate.ts`, `mobile-nav.ts`, `todo-lists.ts`, `todos.ts`, `collaborators.ts`, `queue-retry.ts` — all of them. Commit 3's description becomes: *"rename + import-path update — no behavioral change."* Verification: `make lint` + `make test ARGS="--list"` after the rename both succeed.

**Restored scenarios** (added to `e2e/features/todo-list/collaborators.feature`, alongside the two Task 15 scenarios that are already green):

```gherkin
Scenario: Real-time sync between owner and collaborator
  Given "alice" is signed up and signed in as "alice-sync" with email "alice-sync@example.com"
  And "bob" is signed up with username "bob-sync" and email "bob-sync@example.com"
  And "alice" has a list named "Shared sync"
  And "bob" is a collaborator on "Shared sync"
  And "alice"'s list "Shared sync" has a todo "Milk"
  And "alice" has "Shared sync" open in a browser
  And "bob" has "Shared sync" open in a browser
  When "bob" toggles the todo "Milk" to done
  Then "alice" sees the todo "Milk" marked done within 3 seconds

Scenario: Multi-tab leader election holds exactly one Web Lock
  Given "alice" is signed up and signed in as "alice-multitab" with email "alice-multitab@example.com"
  And "bob" is signed up with username "bob-multitab" and email "bob-multitab@example.com"
  And "alice" has a list named "Shared multitab"
  And "bob" is a collaborator on "Shared multitab"
  When "bob" opens "Shared multitab" in two browser tabs
  Then exactly one of "bob"'s tabs holds the "leader-tab" Web Lock
```

**New step implementations:**

- Toggle step drives `page.getByRole("listitem", { hasText: "Milk" }).getByRole("checkbox")`. Await `expect(todoLocator).toHaveAttribute("data-completed", "true")` (or whatever the real attribute is on `SortableTodoItem` / `CompletedTodoItem`) with `{ timeout: 3000 }` — 1s is unachievable against react-query's default backoff + network round-trip; 3s is the realistic minimum with the live-updates hook invalidation path. **Plan C's `within 1 second` promise is thereby a user-facing claim, not a BDD assertion floor**; note this distinction in the handover doc so nobody tightens the test to 1s and paints it flaky.
- Multi-tab-spawn step extends the `Actor` type with an **optional** second tab: `tabB?: Page` (keeps single-tab actors unchanged — only multi-tab scenarios populate `tabB`). Both tabs navigate to the list URL, wait for hydration, register independently.
- Web Lock assertion:

  ```ts
  async function heldLeaderLocksOn(page: Page, userId: string): Promise<number> {
    return page.evaluate(async (uid) => {
      const snap = await navigator.locks.query();
      const name = `leader-tab:${uid}`;
      return (snap.held ?? []).filter((l) => l.name === name).length;
    }, userId);
  }
  ```

  The `Then` step polls both tabs via `expect.poll(async () => ...)` with `{ timeout: 2000, intervals: [100, 250, 500] }`, summing held locks — assert `=== 1`.

**Multi-tab fallback clause:** the scenario ships OR is deleted — no `@skip`, no `@flaky`. Ship criterion: **5 consecutive local runs all pass, and first-successful-poll lands in the same `expect.poll` interval bucket (100 / 250 / 500 ms) on every run**. Delete criterion: one focused debugging pass, time-boxed to **90 minutes**, didn't reach the ship criterion. If deleted, document in the handover that multi-tab correctness is browser-guaranteed by the Web Locks spec + existing `useLeaderTab` logic and unit-tested via `useLeaderTab` — no BDD coverage is a deliberate choice.

Remove any `// DEFERRED` comments + unused stub steps left by Task 15.

### Cross-layer naming convention — root `CLAUDE.md`

Add a new section documenting that a domain's name is reused across layers:

| Layer | Path template |
|---|---|
| Web | `apps/web/src/features/<name>/` |
| API | `packages/api/src/domains/<name>/` |
| E2E | `e2e/features/<name>/` + `e2e/steps/<name>/` |

Rule: a new capability lands under the same `<name>` in every layer it touches. The layer terminology differs by convention (web = "features" per FSD; API = "domains" per DDD), but the name does not. One-line cross-references from `apps/web/CLAUDE.md`, `packages/api/CLAUDE.md`, `e2e/CLAUDE.md` point at the root rule.

**Enforcement — `scripts/check-domain-names.ts` wired into `make lint`.** A convention that isn't checked will drift the first time two agents work in parallel. Add a small script (similar shape to `scripts/check-trpc-patterns.ts`) that:

1. Lists the directory names under `apps/web/src/features/`, `packages/api/src/domains/`, `e2e/features/`, and `e2e/steps/`.
2. For each name in *any* set, require it to appear in every set whose layer is relevant (e.g., a backend-only domain like `admin` doesn't need an `apps/web/src/features/admin/` entry — the check is "any frontend feature must have a matching backend domain and vice versa, unless on an allowlist").
3. Allowlist: a hardcoded list of known exceptions (`auth`, `mobile-nav` — backend lives in `packages/auth/`, not `@project/api`; mobile-nav is frontend-only).
4. Fails `make lint` with a clear message: `"feature/domain name mismatch: <name> present in <layer> but missing in <other-layer>"`.

Hook via `agent-harness.config.ts` (or wherever the existing `scripts/check-trpc-patterns.ts` is wired — mirror that pattern exactly). Script lives at `scripts/check-domain-names.ts`, implementation under ~80 lines.

### Handover doc

Write `docs/superpowers/specs/2026-04-19-plan-c-followups-handover.md`. Contents:

- **Commit range(s)** shipped in each session (Plan C execution + this follow-ups session)
- **Decisions with one-line rationale** (authz = full parity → option A)
- **Starting points for common next-session tasks** — concrete file:line pointers:
  - Touching authz: `packages/api/src/domains/todo-list/service.ts:57` (`canReadList`)
  - Adding a realtime event: `packages/api/src/domains/todo-list/events.ts` + `use-todo-list-live-updates.ts:applyEvent`
  - Multi-actor BDD: `e2e/steps/todo-list/collaborators.ts` — `spawnActor`, `actors` map, `After` hook
  - CSV import/export: `packages/api/src/domains/todo/service.ts` (both in `importTodosFromCSV`/`exportTodosAsCSV`)
- **Test data convention:** every BDD email is scenario-scoped (e.g., `alice-sync@example.com` vs `alice-multitab@example.com`). No shared fixture exists; each scenario picks fresh user emails. The `e2e/scripts/check-feature-emails.ts` guard enforces uniqueness.
- **Explicit remaining deferrals:**
  - `TodoListMembership.role` not enforced — becomes relevant when write-tiers (viewer/editor/admin) are wanted. Extend `canReadList` → split into `canReadList` + `canWriteList` and branch on role.
  - `/invites/:token` error UX is redirect-only (expired/consumed tokens → `/todo-lists`). Production would add explicit error pages.
  - Multi-tab BDD if fallback triggered (see Multi-tab fallback clause).
  - `Todo.userId` creator vs authorization drift: when a creator loses collaborator access, their rows stay pointing at an outside user. Non-goal today; worth a post-MVP audit.
- **Pre-existing deferrals carried forward from Plan C:** Redis subscriber leak (`packages/realtime/src/redis-channel.ts:46`), nodemailer-in-tx latency (invite flow awaits `sendEmail` post-commit but still blocks the request), Better-Auth username typing cast at authz boundary.
- **Quick-start checklist:** checkout branch, `make setup`, `make lint` (15 + tsc pass, including new `check-domain-names` check), `make test-unit` (expected count: 70, up from 61), `make test ARGS="--project desktop --grep 'Todo list collaborators'"` (4/4 pass), `make dev` to smoke-test two-browser invite + remove.

The doc is self-sufficient — next-session-starts-here, does not assume access to this session's transcript.

## Commit plan

| # | Commit | Content | Depends on |
|---|---|---|---|
| 1 | `feat(api): widen todo authz to collaborators (canReadList gate)` | Every site in the Authz table above rewritten; helper signatures change; CSV funcs included; router signatures unchanged except `reorderTodos` gaining `todoListId` input if not already present | — |
| 2 | `test(api): todo CRUD by collaborators + outsider FORBIDDEN` | 9 new bun-test cases (owner-path tests unchanged) | 1 |
| 3 | `refactor(e2e): subfolder-per-domain layout` | `git mv` of 7 feature files + 7 step files; rewrite `..` imports to `../../` in every moved step file; verification via `make lint` + `make test --list` | — (independent of 1/2) |
| 4 | `test(e2e): restore real-time sync + multi-tab scenarios` | Added to `todo-list/collaborators.feature` on new path; new steps + `Actor.tabB?` | 1, 2, 3 |
| 5 | `docs: cross-layer naming convention + Plan C follow-ups handover + check-domain-names` | Root CLAUDE.md section, subfile cross-refs, handover doc, `scripts/check-domain-names.ts` wired into harness config | 3 (needs the new subfolder layout) |

Five commits on `feat/template-reference-impl`. Must land in the order listed (2 depends on 1, 4 depends on 1+2+3, 5 depends on 3). No new branches. Commits 1+2 and commit 3 are independent — can be reordered if convenient, but the table order is the recommended one.

## Verification checklist

- `make lint` — 15 existing + `check-domain-names` + tsc PASS
- `make test-unit` — 70 tests pass (was 61)
- `make test ARGS="--project desktop --grep 'Todo list collaborators'"` — 4/4 scenarios pass (or 3/4 if multi-tab fallback triggered; handover must record which)
- `make test` — full suite green on desktop (mobile unchanged)
- `grep -n "userId" packages/api/src/domains/todo/service.ts` returns zero hits in `where:` clauses (only in `data:` for creator audit) — the "no leaked authz filter" lint check
- Root `CLAUDE.md` renders with the new convention section; sub-CLAUDE.mds cross-link
- Handover doc is self-sufficient — a fresh session can rediscover state from it alone
