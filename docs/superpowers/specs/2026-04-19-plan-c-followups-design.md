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

**Shape, applied uniformly:**

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

export async function createTodo(tx: Prisma.TransactionClient, creatorId: string, title: string, todoListId: string) {
  const allowed = await canReadList(tx, creatorId, todoListId);
  if (!allowed) throw new TRPCError({ code: "FORBIDDEN" });
  await lockActiveTodos(tx, todoListId);
  await shiftActivePositions(tx, todoListId);
  return tx.todo.create({ data: { title, userId: creatorId, todoListId, position: 0 } });
}

// completeTodo, deleteTodo, reorderTodos: same pattern.
// First fetch the target todo by id to learn its todoListId (without viewer filter),
// then canReadList(viewer, todoListId), then mutate.
```

**Knock-on change — lock helpers lose their `userId` parameter:**

```ts
async function lockActiveTodos(tx: Prisma.TransactionClient, todoListId: string): Promise<void> {
  await tx.$queryRaw`
    SELECT id FROM "Todo"
    WHERE "todoListId" = ${todoListId} AND "completed" = false
    ORDER BY id
    FOR NO KEY UPDATE
  `;
}
```

Lock scope widens: two collaborators racing on `createTodo` for the same list now contend on the same position-space. This is correct — they ARE racing, same as two browser tabs of the same owner today.

**Meaning shift:** `Todo.userId` becomes "who created this row" (audit), not "who may access it" (authz). Schema unchanged; no migration.

### Unit tests — `packages/api/src/domains/todo/__tests__/service.test.ts`

Add a `describe("todo CRUD by collaborators")` block mirroring the setup in `todo-list/__tests__/service.test.ts`'s `"collaborator lifecycle"` block (seed OWNER + COLLAB + OUTSIDER, create list, add COLLAB via `todoListMembership.create`, teardown per case + per describe).

New cases (7 total, one `it` each):

| Case | Actor | Action | Expected |
|---|---|---|---|
| listTodos — collaborator | COLLAB | `listTodos(db, COLLAB, listId)` | Returns all todos in the list |
| createTodo — collaborator | COLLAB | `createTodo(tx, COLLAB, "x", listId)` | Row created, `userId === COLLAB` |
| completeTodo — collaborator toggles owner's todo | COLLAB | `completeTodo(tx, COLLAB, ownerTodoId, true)` | `completed=true`, no throw |
| deleteTodo — collaborator deletes owner's todo | COLLAB | `deleteTodo(tx, COLLAB, ownerTodoId)` | Row gone |
| reorderTodos — collaborator | COLLAB | `reorderTodos(tx, COLLAB, listId, [id2, id1])` | positions updated |
| listTodos — outsider | OUTSIDER | `listTodos(db, OUTSIDER, listId)` | Throws `TRPCError` code `FORBIDDEN` |
| createTodo — outsider | OUTSIDER | `createTodo(tx, OUTSIDER, "x", listId)` | Throws `TRPCError` code `FORBIDDEN` |

Existing owner-only tests stay unchanged (owner IS allowed). One FORBIDDEN case per authz-boundary variant is enough; we don't repeat it for every mutation (`canReadList` is exercised six times and is list-level-tested already).

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

Step files migrate in parallel (`e2e/steps/<domain>/<file>.ts`). `git mv` preserves history. Playwright-bdd config already uses `features/**/*.feature` + `steps/**/*.ts` — no config change. Relative imports (`../auth-client.ts`, `../waits.ts`) continue to resolve one level up from the new subfolder — verify during the rename that no `./` relative import within a step file breaks.

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

- Toggle step drives `page.getByRole("listitem", { hasText: "Milk" }).getByRole("checkbox")`. Await `expect(todoLocator).toHaveAttribute("data-completed", "true")` (or whatever the real attribute is on `SortableTodoItem` / `CompletedTodoItem`) with `{ timeout: 3000 }` — 1s is unachievable against react-query's default backoff + network round-trip; 3s is the realistic minimum with the live-updates hook invalidation path.
- Multi-tab-spawn step extends `Actor` with `tabB: Page`. Both tabs navigate to the list URL, wait for hydration, register independently.
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

**Multi-tab fallback clause:** if the scenario flakes after one focused debugging pass (5 consecutive local runs, variance <500ms on timing), delete it and document in the handover that multi-tab correctness is browser-guaranteed by the Web Locks spec + existing `useLeaderTab` logic. Do NOT ship `@skip`-tagged.

Remove any `// DEFERRED` comments + unused stub steps left by Task 15.

### Cross-layer naming convention — root `CLAUDE.md`

Add a new section documenting that a domain's name is reused across layers:

| Layer | Path template |
|---|---|
| Web | `apps/web/src/features/<name>/` |
| API | `packages/api/src/domains/<name>/` |
| E2E | `e2e/features/<name>/` + `e2e/steps/<name>/` |

Rule: a new capability lands under the same `<name>` in every layer it touches. The layer terminology differs by convention (web = "features" per FSD; API = "domains" per DDD), but the name does not. One-line cross-references from `apps/web/CLAUDE.md`, `packages/api/CLAUDE.md`, `e2e/CLAUDE.md` point at the root rule.

### Handover doc

Write `docs/superpowers/specs/2026-04-19-plan-c-followups-handover.md`. Contents:

- Commit range(s) shipped in each session (Plan C execution + this follow-ups session)
- Decisions with one-line rationale (authz = full parity → option A)
- Explicit remaining deferrals:
  - `TodoListMembership.role` not enforced — becomes relevant when write-tiers are wanted
  - `/invites/:token` error UX is redirect-only
  - Multi-tab BDD if fallback triggered
- Pre-existing deferrals carried forward from Plan C (Redis subscriber leak, nodemailer-in-tx latency, Better-Auth username typing)
- Quick-start checklist: branch, `make lint`, `make test-unit` (expected count: 61 + 7 = 68), `make test --grep 'Todo list collaborators'` (4/4 pass)

The doc is self-sufficient — next-session-starts-here, does not assume access to this session's transcript.

## Commit plan

| # | Commit | Content |
|---|---|---|
| 1 | `feat(api): widen todo authz to collaborators (canReadList gate)` | Service rewrites + lock-helper signature change |
| 2 | `test(api): todo CRUD by collaborators + outsider FORBIDDEN` | 7 new Vitest cases |
| 3 | `refactor(e2e): subfolder-per-domain layout` | `git mv` only, no behavior change |
| 4 | `test(e2e): restore real-time sync + multi-tab scenarios` | Added to `todo-list/collaborators.feature` on new path |
| 5 | `docs: cross-layer naming convention + Plan C follow-ups handover` | Root CLAUDE.md section, subfile cross-refs, handover doc |

Five commits on `feat/template-reference-impl`. No new branches.

## Verification checklist

- `make lint` — 15 + tsc PASS
- `make test-unit` — 68 tests pass (was 61)
- `make test ARGS="--project desktop --grep 'Todo list collaborators'"` — 4/4 scenarios pass
- `make test` — full suite green on desktop (mobile unchanged)
- Root `CLAUDE.md` renders with the new convention section; sub-CLAUDE.mds cross-link
- Handover doc is self-sufficient — a fresh session can rediscover state from it alone
