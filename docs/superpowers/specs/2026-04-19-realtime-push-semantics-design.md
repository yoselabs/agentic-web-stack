# Realtime Push Semantics — Design

**Status:** Approved for implementation planning
**Scope:** Payload-shaped realtime events for collaborative todo lists
**Branch target:** `feat/template-reference-impl`
**Supersedes:** follow-up items §43–47 and §58 of `docs/superpowers/specs/2026-04-19-plan-c-followups-handover.md`

## Context

Plan C shipped a realtime collaboration pipeline (tRPC subscription → leader-tab WS → BroadcastChannel relay → `applyEvent`). The current implementation is **notification-shaped**: events carry IDs only, and the client responds by invalidating React Query filters and triggering a full refetch. For a collaborative list where Alice creates a todo and Bob should see it appear, this means every mutation on Alice's side costs Bob an extra HTTP round-trip — wasteful when the server already knows the new row's full state at publish time.

Two issues combine to make this the right moment to fix it:

1. **Publish asymmetry** (handover §43). Only `completeTodo` publishes a realtime event today. `createTodo`, `deleteTodo`, `reorderTodos`, and `importTodosFromCSV` are silent, so collaborator fan-out is half-shipped — Bob only sees Alice's toggles in real time, not her creates or deletes.
2. **Kinds duplication** (handover §58). `TODO_LIST_EVENT_KINDS` is hand-duplicated in `apps/web/src/features/todo-list/use-todo-list-live-updates.ts`, drifting from the event union type with no compile-time enforcement.

The fix is to make every todo mutation publish, and to make each event carry the full post-commit entity so Bob's client can patch its cache directly via `setQueryData` — no refetch on the hot path. Cache stays consistent; network cost stays bounded.

## Goals

1. **Push-style events.** Every todo mutation fans out a payload-shaped event that the client can apply without refetching.
2. **Single source of truth for event kinds.** Adding a new kind must error at compile time if the KINDS tuple is not updated.
3. **Domain-merge hygiene.** Fold `todo` into `todo-list` so the realtime boundary (the aggregate root) matches the code boundary.

## Non-goals

- **Missed-event recovery / reconnect gap-fill.** Browsers hibernate backgrounded tabs; a WS hiccup can drop events. Today's mitigations (`useQuery` on mount + React Query's `refetchOnWindowFocus`) cover the todo use case. A durable event log with `seq`-based replay is a meaningfully larger design (log retention, backpressure, pagination) and is NOT in scope.
- **Authoritative state via events.** Events are not the source of truth; the database is. Events carry the post-commit payload for fast client render; the regular `useQuery` on mount is still the authoritative read.
- **Cross-domain event routing.** Each domain owns its event vocabulary, channel, and handler map. No global event bus.
- **Post-commit publishing.** Publishes happen inside the `$transaction` callback today; this spec keeps that pattern. Moving publishes post-commit is a codebase-wide refactor (affects every existing publisher) and is tracked separately.

## Architecture overview

```
Client (browser tab)
  ├─ leader tab: ONE WebSocket connection to /trpc
  │    ├─ subscription: todoList.onListEvent({listId: X})  → Redis channel "todo-list:X"
  │    └─ subscription: todoList.onListEvent({listId: Y})  → Redis channel "todo-list:Y"
  │         (future domains plug in via additional subscriptions on the same WS)
  └─ peer tabs: BroadcastChannel relay from leader

Server
  service function (mutation)
    ├─ DB commit (inside $transaction)
    └─ channel.publish(event)   ← payload-shaped
         → Redis pub/sub (or MemoryChannel in unit tests)
         → subscription procedure yields to all WS subscribers on that channel
```

The transport is unchanged from Plan C. What changes is the **shape** of events on the wire and the **handler** that applies them to the cache.

## Phase 0 — Domain merge (`todo` → `todo-list`)

Pure refactor, no behavior change. Rationale: TodoList is the aggregate root. Todo, Membership, and Invite exist only inside a list; authz flows through `canReadList`; the realtime channel is keyed at the list level. The current split manufactures a boundary that has no semantic meaning — the same domain-name appears in two different places with no corresponding user-visible distinction.

### What moves

| From | To |
|---|---|
| `packages/api/src/domains/todo/service.ts` | `packages/api/src/domains/todo-list/todo-service.ts` |
| `packages/api/src/domains/todo/router.ts` | `packages/api/src/domains/todo-list/todo-router.ts` |
| `packages/api/src/domains/todo/constants.ts` | `packages/api/src/domains/todo-list/todo-constants.ts` |
| `packages/api/src/domains/todo/http.ts` | `packages/api/src/domains/todo-list/todo-http.ts` |
| `packages/api/src/domains/todo/__tests__/*` | `packages/api/src/domains/todo-list/__tests__/` (coexist with existing tests) |
| `apps/web/src/features/todo/` | merged into `apps/web/src/features/todo-list/` |
| `e2e/features/todo/*.feature` | moved into `e2e/features/todo-list/` (one file per capability — `todos.feature`, `csv.feature`, etc.) |
| `e2e/steps/todo/*.ts` | moved into `e2e/steps/todo-list/` (step-def file names match their feature file) |

Service files keep their old names prefixed (`todo-service.ts`, `list-service.ts`) to avoid one giant `service.ts`. Existing `events.ts` stays put at `packages/api/src/domains/todo-list/events.ts` — already in the right folder. Tests stay per-service in `__tests__/`.

### Package export surface (non-trivial — do NOT skip)

`packages/api/package.json` currently exports six `domains/*` subpaths. Four are under `domains/todo/`; they must move in lock-step with the folder:

```diff
 "exports": {
   "./authz": { ... },
   "./context": { ... },
-  "./domains/todo/service":   { "default": "./src/domains/todo/service.ts" },
-  "./domains/todo/constants": { "default": "./src/domains/todo/constants.ts" },
-  "./domains/todo/http":      { "default": "./src/domains/todo/http.ts" },
+  "./domains/todo-list/todo-service":   { "default": "./src/domains/todo-list/todo-service.ts" },
+  "./domains/todo-list/todo-constants": { "default": "./src/domains/todo-list/todo-constants.ts" },
+  "./domains/todo-list/todo-http":      { "default": "./src/domains/todo-list/todo-http.ts" },
   "./domains/todo-list/service":   { "default": "./src/domains/todo-list/service.ts" },
   "./domains/todo-list/events":    { "default": "./src/domains/todo-list/events.ts" },
   "./domains/todo-list/constants": { "default": "./src/domains/todo-list/constants.ts" },
   "./router": { ... }
 }
```

Note: `packages/api/src/domains/todo/service.ts` is NOT in the current exports map — only `./domains/todo/service` (etc.) is. Internal imports inside `packages/api/` use relative paths, so they're covered by rename detection. The package-export edit only matters for cross-package consumers.

**Cross-package consumer sites (verified via grep on `@project/api/domains/todo/`):**

| File | Line | Import | Required edit |
|---|---|---|---|
| `apps/server/src/index.ts` | 5 | `import { todoHttpRouter } from "@project/api/domains/todo/http";` | path → `@project/api/domains/todo-list/todo-http` |
| `apps/web/src/shared/todo-http-client.ts` | 1 | `import type { TodoHttpRouter } from "@project/api/domains/todo/http";` | path → same as above |
| `apps/web/src/features/todo/use-todos.ts` | — | no current `@project/api/domains/todo/*` imports (file uses `@project/api/router` + `todoHttpClient`). Only affected by Phase 0 via the web `features/todo/` → `features/todo-list/` folder move, which is caught by the grep sweep on completion. | folder move only |
| `packages/api/src/domains/todo/__tests__/service.test.ts` | 13 | `@project/api/domains/todo-list/events` (unchanged) | none — imports todo-list subpath, already correct |
| `apps/worker/src/handlers/maintenance.ts` | 1 | `@project/api/domains/todo-list/service` (unchanged) | none |

Grep sweep during Phase 0: `rg "@project/api/domains/todo/" --glob '!docs/**'` must return zero matches on completion. `apps/` + `packages/` only; `docs/` mentions are illustrative and stay.

**Aliasing vs full migration.** Chosen: **full migration** (rename the subpaths as above). Aliasing would leave stale `@project/api/domains/todo/*` export paths pointing at files in `domains/todo-list/` — the folder layout and the public subpath would diverge. That's the same class of confusion as the no-barrel rule in root CLAUDE.md: if the subpath doesn't match the filesystem, future readers misnavigate. Short-term diff cost is small (4 consumer files); long-term surface clarity is worth it.

### `scripts/check-domain-names.ts`

Delete the `todo` ALLOWLIST entry at `scripts/check-domain-names.ts:71` (`todo: new Set(["e2e-feat", "e2e-steps"])`). After the merge, `todo` vanishes from both the web `features/` layer and the API `domains/` layer, so the symmetry check naturally passes without the allowlist. No deeper logic changes — the script enumerates layers and checks per-name parallelism; removing a name removes it from the check.

**Feature-file granularity preserved.** Gherkin feature files stay one-per-capability within the merged folder — not merged into a single mega-file. Rationale: (a) running subsets via `--grep` or file-path is faster and more precise at fine granularity, important for tight agent loops; (b) diffs stay local when one capability changes; (c) matches Cucumber's "one feature per user capability" convention. Concretely under `e2e/features/todo-list/`: `todo-lists.feature`, `todos.feature`, `collaborators.feature`, `csv.feature`, and the new `collaborator-realtime-todos.feature`. Step-def files in `e2e/steps/todo-list/` mirror this split.

**tRPC router namespaces stay split.** The merge is about folder organization and aggregate semantics, not API surface. The root router continues to mount two namespaces, both sourced from `domains/todo-list/`:

```ts
export const appRouter = router({
  // ...
  todo: todoRouter,        // from domains/todo-list/todo-router.ts
  todoList: todoListRouter, // from domains/todo-list/list-router.ts
});
```

Rationale: frontend code already uses both namespaces (`trpc.todo.list`, `trpc.todoList.get`); breaking the API surface alongside a folder move would inflate the diff without behavioral benefit. If we later want to flatten to a single `todoList` namespace with nested `.todos.create` etc., it's a separate commit.

### Commit hygiene

Phase 0 is one commit. Three categories of change ride in it: file renames (covered by `git mv` + rename detection), `packages/api/package.json` exports edit, and 4 cross-package consumer imports. Reviewable via `git diff --stat` + spot-checks on the four consumer files. No behavior diff, test count unchanged. `make lint` + `make test-unit` + `make test` must pass on the Phase 0 commit before Phase 1 starts.

## Phase 1 — Event redesign

### Event taxonomy

Every kind is prefixed by its **emitting domain**. The channel-key namespace (`todo-list:{listId}`) already disambiguates at the transport level, but the prefix keeps log lines, DevTools subscriptions, and grep output self-describing. This is a code convention, not a wire-level requirement.

| Kind | Payload | Shape | Emitted by |
|---|---|---|---|
| `todo-list-updated` | `{listId}` | notification | todoList.update |
| `todo-list-collaborator-added` | `{listId, userId}` | notification | invite.accept |
| `todo-list-collaborator-removed` | `{listId, userId}` | notification (+ authz cascade) | collaborators.remove |
| `todo-created` | `{listId, todo: TodoWithList}` | payload | todo.create |
| `todo-updated` | `{listId, todo: TodoWithList}` | payload | todo.complete (renamed from today's single kind) |
| `todo-deleted` | `{listId, todoId}` | payload (id is the delta) | todo.delete |
| `todos-reordered` | `{listId, positions: Array<{id, position}>}` | payload | todo.reorder |
| `todos-imported` | `{listId, todos: TodoWithList[]}` | payload | todo.importFromCSV |

Where `TodoWithList = Awaited<ReturnType<typeof listTodos>>[number]` (i.e., `Todo & { todoList: TodoList }`). The `todo.list` query includes the `todoList` relation via `include: { todoList: true }` at `packages/api/src/domains/todo/service.ts:63` — the cache stores rows with that relation, so payloads MUST match. Shipping plain `Todo` rows would corrupt the cache: downstream consumers that read `t.todoList.name` would crash on a patched row.

**Why three list-level events stay notification-shaped.** List metadata (title, visibility) changes rarely, collaborator adds/removes require an authz re-check anyway (payload isn't trustable for access-cascade logic), and the membership-removed event's primary role is closing the revoked user's subscription — the payload's job is just "this event is about you." An invalidate-and-refetch fallback is the right shape here.

**Why five todo-level events go payload-shaped.** These are high-frequency, cache-patchable, and the cost of refetch-per-mutation scales linearly with collaborator count. A two-person list with one user actively toggling costs one extra refetch per mutation on the other user's side; that's wasteful when the payload is already known server-side at publish time.

### Event union + kinds SSOT

In `packages/api/src/domains/todo-list/events.ts`:

```ts
import type { Todo, TodoList } from "@project/db";

// Matches the `todo.list` query shape (service.ts: include: { todoList: true }).
// Payloads MUST match this shape exactly — the client cache stores rows of this
// shape, and patching with a narrower shape would corrupt downstream consumers
// that read `t.todoList.name` etc.
export type TodoWithList = Todo & { todoList: TodoList };

export const TODO_LIST_EVENT_KINDS = [
  "todo-list-updated",
  "todo-list-collaborator-added",
  "todo-list-collaborator-removed",
  "todo-created",
  "todo-updated",
  "todo-deleted",
  "todos-reordered",
  "todos-imported",
] as const;

export type TodoListEventKind = (typeof TODO_LIST_EVENT_KINDS)[number];

export type TodoListEvent =
  | { kind: "todo-list-updated"; listId: string }
  | { kind: "todo-list-collaborator-added"; listId: string; userId: string }
  | { kind: "todo-list-collaborator-removed"; listId: string; userId: string }
  | { kind: "todo-created"; listId: string; todo: TodoWithList }
  | { kind: "todo-updated"; listId: string; todo: TodoWithList }
  | { kind: "todo-deleted"; listId: string; todoId: string }
  | { kind: "todos-reordered"; listId: string; positions: Array<{ id: string; position: number }> }
  | { kind: "todos-imported"; listId: string; todos: TodoWithList[] };
```

Publishers on the server side must `include: { todoList: true }` on every `create`/`update`/`createMany`-then-refetch path so the event payload matches `TodoWithList`. For `createMany` (the import path), this means re-reading the inserted rows with the relation before publishing, OR constructing the payload by joining the inserted IDs with the known parent list — the latter is cheaper (one query saved) and deterministic because the parent list is already loaded for the authz check.

`TodoListEventKind` is the derived union of string literals. The `TodoListEvent` union's `kind` fields are checked by TypeScript against `TodoListEventKind` via the satisfies-pattern in tests — adding a case to the union without extending the tuple produces a compile error.

### Server-side publish

Every todo mutation receives the same `options: { channel?: ChannelProvider }` pattern that `completeTodo` uses today. Production code path hits the default Redis provider; tests inject `MemoryChannelFactory`.

Publish happens after the last DB write but **still inside the `$transaction` callback** — matches the existing codebase pattern (`completeTodo`, `todo-list/service.ts` publishers). Handover §55 flags moving publishes post-commit as a separate codebase-wide refactor; out of scope here.

### Phantom-event visibility window — explicit stance

With notification-shaped events today, a rollback-published event produces a spurious refetch — user-invisible (refetch returns authoritative state). With payload-shaped events, a rollback-published `todo-created` calls `setQueryData` with a row that does NOT exist in the database. Peer tabs render a **phantom row** that persists until:

1. The tab's `useQuery` refetches on next mount (navigate away + back), OR
2. A subsequent `invalidateQueries` call hits that key, OR
3. Tab focus triggers React Query's default `refetchOnWindowFocus`.

The visibility window is bounded by tab focus cycles — typically seconds to minutes, not hours. Rollback is rare in practice (one failure mode: `canReadList` passes then the DB insert fails under concurrent row-lock contention; extremely narrow window).

**Compound case.** If a phantom row P sits in cache at `position=0` and a real `todo-created` event R arrives at `position=0`, the handler prepends + sorts; `sortTodos` has no tiebreaker for equal `(completed, position)` pairs. Result: transient duplicate-position render (two rows visibly at the top), self-corrects on next refetch. JavaScript's stable sort means order depends on insertion, so behavior is deterministic but not semantically correct. Bounded by the same `refetchOnWindowFocus` mitigation — not a hang, not a crash, a few seconds of visual oddity at worst.

**Decision: accept the phantom-row risk.** Rationale: rollback is rare (narrow window between `canReadList` passing and the DB write failing under lock contention), and `refetchOnWindowFocus` self-corrects within seconds of user attention. The post-commit-publish refactor is tracked as a follow-up — its cost is the reason we don't batch it in, not the reason we accept the risk.

### BroadcastChannel trust boundary

The relay type-guard at `use-todo-list-live-updates.ts:54-63` only validates `kind ∈ TODO_LIST_EVENT_KINDS` — it does NOT validate payload shape. With payload-shaped events, a malformed peer-relayed event (wrong field names, missing `todo`) would dispatch to a handler that reads `ev.todo.id` → runtime `TypeError`.

**Decision: BroadcastChannel is trusted as same-origin.** The messages come from other tabs of the same web app; the leader tab publishes the exact shape it received from the server (which is type-narrowed). A malformed relay would imply a logic bug in the leader tab or a malicious same-origin script, not hostile external input. The minimal kind-check is sufficient; full Zod parsing at the relay boundary is over-engineering for the same-origin case.

Documented in the handler file as a one-line comment at the type-guard site.

### Client handler map

New file `apps/web/src/features/todo-list/event-handlers.ts`:

```ts
import type {
  TodoListEvent,
  TodoListEventKind,
  TodoWithList,
} from "@project/api/domains/todo-list/events";
import type { AppRouter } from "@project/api/router";
import type { QueryClient } from "@tanstack/react-query";
import type { TRPCOptionsProxy } from "@trpc/tanstack-react-query";

type Handler<K extends TodoListEventKind> = (
  trpc: TRPCOptionsProxy<AppRouter>,
  qc: QueryClient,
  event: Extract<TodoListEvent, { kind: K }>,
) => void;

// Re-sort to match the server's `orderBy: [{ completed: "asc" }, { position: "asc" }]`.
// The cache stores a pre-sorted array; `apps/web/src/features/todo/use-todos.ts`
// derives `activeTodos`/`completedTodos` by `.filter()` alone, relying on array
// order for display. Any patch that changes `completed` or `position` MUST re-sort,
// or the UI stays in the pre-patch order until the next refetch.
function sortTodos(arr: TodoWithList[]): TodoWithList[] {
  return [...arr].sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    return a.position - b.position;
  });
}

export const eventHandlers: { [K in TodoListEventKind]: Handler<K> } = {
  "todo-created": (trpc, qc, ev) => {
    qc.setQueryData<TodoWithList[]>(
      trpc.todo.list.queryFilter({ todoListId: ev.listId }).queryKey,
      (old) => (old ? sortTodos([...old, ev.todo]) : old),
    );
  },
  "todo-updated": (trpc, qc, ev) => {
    qc.setQueryData<TodoWithList[]>(
      trpc.todo.list.queryFilter({ todoListId: ev.listId }).queryKey,
      (old) =>
        old ? sortTodos(old.map((t) => (t.id === ev.todo.id ? ev.todo : t))) : old,
    );
  },
  "todo-deleted": (trpc, qc, ev) => {
    qc.setQueryData<TodoWithList[]>(
      trpc.todo.list.queryFilter({ todoListId: ev.listId }).queryKey,
      (old) => old?.filter((t) => t.id !== ev.todoId),
    );
  },
  "todos-reordered": (trpc, qc, ev) => {
    const byId = new Map(ev.positions.map((p) => [p.id, p.position]));
    qc.setQueryData<TodoWithList[]>(
      trpc.todo.list.queryFilter({ todoListId: ev.listId }).queryKey,
      (old) => {
        if (!old) return old;
        const patched = old.map((t) =>
          byId.has(t.id) ? { ...t, position: byId.get(t.id)! } : t,
        );
        return sortTodos(patched);
      },
    );
  },
  "todos-imported": (trpc, qc, ev) => {
    // Server semantics (importTodosFromCSV): existing active rows are
    // `position += N`, imported rows occupy positions [0..N). Mirror that in
    // the cache: prepend imported rows, shift existing active rows' positions,
    // then resort. Without this, a refetch would show imports at the TOP and
    // the cache-patched view shows them at the BOTTOM — visible UX drift.
    const n = ev.todos.length;
    qc.setQueryData<TodoWithList[]>(
      trpc.todo.list.queryFilter({ todoListId: ev.listId }).queryKey,
      (old) => {
        if (!old) return old;
        const shifted = old.map((t) =>
          t.completed ? t : { ...t, position: t.position + n },
        );
        return sortTodos([...ev.todos, ...shifted]);
      },
    );
  },
  "todo-list-updated": (trpc, qc, ev) => {
    qc.invalidateQueries(trpc.todoList.get.queryFilter({ id: ev.listId }));
    qc.invalidateQueries(trpc.todoList.listAccessible.queryFilter());
  },
  "todo-list-collaborator-added": (trpc, qc, ev) => {
    qc.invalidateQueries(trpc.todoList.collaborators.queryFilter({ listId: ev.listId }));
  },
  "todo-list-collaborator-removed": (trpc, qc, ev) => {
    qc.invalidateQueries(trpc.todoList.collaborators.queryFilter({ listId: ev.listId }));
    qc.invalidateQueries(trpc.todoList.listAccessible.queryFilter());
  },
};
```

**Dispatch-site cast.** At the dispatch call site (below), TS cannot narrow `event` across the index access `eventHandlers[event.kind]` — the `event as never` cast is necessary because each handler expects its narrow `Extract<...>` type, not the full union. Do not "fix" this by changing `as never` to `as TodoListEvent` — that widens the argument and breaks the narrow handler signatures.

**Cold-cache safety.** If a peer tab has never opened a given list (the `todo.list` query isn't cached for that `listId`), `setQueryData` is a no-op. The tab's next navigation runs `useQuery` normally, fetching fresh state. No special-casing needed.

**Ordering.** Events are effectively independent — `todo-created` and `todo-updated` for different ids don't interfere; `todos-reordered` overwrites position for all affected ids atomically. The only theoretical race is two reorders within <50ms on the same list; acceptable at this scale, corrected by next refetch.

### Hook wiring

`use-todo-list-live-updates.ts` shrinks to:

```ts
useSubscription(
  trpc.todoList.onListEvent.subscriptionOptions(
    { listId: listId ?? "" },
    {
      enabled: isLeader && listId !== null,
      onData: (event) => {
        broadcast({ __relay: true, event });
        eventHandlers[event.kind](trpc, queryClient, event as never);
      },
    },
  ),
);
```

The relay type-guard (`isTodoListRelay`) imports `TODO_LIST_EVENT_KINDS` from `@project/api/domains/todo-list/events` instead of hand-duplicating.

## Testing

### Backend — service-level publish tests (`__tests__/todo-service.test.ts`)

Add publish-assertion tests mirroring the existing `completeTodo` test — `MemoryChannelFactory` injection, assert published event kind + payload shape (including `todoList` relation on every `TodoWithList` payload):

- `createTodo publishes todo-created with the full created row including todoList`
- `deleteTodo publishes todo-deleted with the deleted id`
- `reorderTodos publishes todos-reordered with the full positions map`
- `importTodosFromCSV publishes todos-imported with each imported row including todoList`
- Existing `completeTodo publishes todo-updated` — update payload expectation to include the full todo (not just id) with the `todoList` relation.

5 net new / updated tests.

### Backend — events.ts generator test update (`__tests__/events.test.ts`)

The existing `subscribeToListEvents` test at `packages/api/src/domains/todo-list/__tests__/events.test.ts` uses three event kinds inline — `list-updated`, `todo-updated`, `collaborator-removed`. Two of those rename under this spec:

- `list-updated` → `todo-list-updated`
- `collaborator-removed` → `todo-list-collaborator-removed`

Update the three test cases' event literals to the renamed kinds. The generator logic is unchanged; only the event-kind strings in test fixtures move. `todo-updated` also needs its payload shape updated (adds `todo: TodoWithList`, drops `todoId`), but the generator test doesn't read payload fields — a minimal fixture update suffices.

### Frontend unit (new file, `apps/web/src/features/todo-list/__tests__/event-handlers.test.ts`)

Each handler is a pure function over `(trpc, QueryClient, event)`. Test strategy: construct a real `QueryClient`, seed it with known data via `setQueryData`, invoke the handler, assert the cache matches expectation. No React rendering needed.

- 8 tests (one per handler) covering cache patching and the uncached-key no-op case for the payload-shaped kinds.

### BDD (Playwright + Cucumber)

Four new scenarios, covering the three highest-value realtime paths plus the cold-cache correctness claim.

New feature file `e2e/features/todo-list/collaborator-realtime-todos.feature`:

```gherkin
Scenario: Alice creates a todo, Bob sees it in real time
  Given Alice owns a list "Groceries" with Bob as collaborator
  And Alice and Bob both have the list open
  When Alice creates a todo "Milk"
  Then Bob sees "Milk" in the list within 3 seconds

Scenario: Alice deletes a todo, Bob sees it disappear in real time
  Given Alice owns a list "Groceries" with Bob as collaborator
  And the list has one todo "Milk"
  And Alice and Bob both have the list open
  When Alice deletes "Milk"
  Then Bob no longer sees "Milk" within 3 seconds

Scenario: Alice imports todos from CSV, Bob sees them at the top in real time
  Given Alice owns a list "Groceries" with Bob as collaborator
  And the list has one todo "Existing item"
  And Alice and Bob both have the list open
  When Alice imports a CSV with todos "Bread,Cheese,Eggs"
  Then Bob sees "Bread", "Cheese", "Eggs" above "Existing item" within 3 seconds

Scenario: Bob on index page sees Alice's new todo on first navigation to the list
  Given Alice owns a list "Groceries" with Bob as collaborator
  And Bob is on the todo-lists index page (has never opened "Groceries" this session)
  When Alice creates a todo "Milk"
  And Bob navigates to "Groceries"
  Then Bob sees "Milk" in the list
```

**Scope rationale.**

| Scenario | Included? | Why |
|---|---|---|
| `todo-created` realtime | ✅ | Hottest path, canonical example of the push pattern. |
| `todo-deleted` realtime | ✅ | Simple handler, validates the filter-out path. |
| `todos-imported` realtime | ✅ | Handler has the most complex logic (prepend + shift + resort). End-to-end test catches off-by-one / ordering bugs that unit tests might miss if the fixture doesn't exactly match real server output. |
| Cold-cache peer | ✅ | Validates that cold-navigation to a list with pending realtime mutations shows up-to-date state. The hook at `use-todo-list-live-updates.ts` subscribes to one `listId` at a time, so a peer on the index page isn't subscribed to Alice's list — the scenario effectively proves `useQuery` on navigation returns fresh state rather than a stale cache hit. Compositional check for the subscribe-or-refetch dichotomy. |
| `todo-updated` (complete) realtime | ❌ | Already covered by existing "Real-time sync between owner and collaborator" scenario (restored in Plan C follow-ups); the UI binding is unchanged by the payload-shape refactor. |
| `todos-reordered` realtime | ❌ | DnD across two browser contexts is notoriously flaky in Playwright (`@dnd-kit` + two context pointers). Cost > value given: (a) unit test asserts sort order post-patch, (b) existing single-user reorder scenario covers DOM rendering, (c) the handler logic is simpler than import. If it breaks, unit tests catch it. |

Tolerance stays at 3 seconds (handover §24 — this is the realistic floor given React Query retry backoff + subscription round-trip).

Reuses the `spawnActor` / multi-context pattern from `e2e/steps/todo-list/collaborators.ts`. Handover §56 flagged that file at 498/500 lines — **Phase 1 extracts helpers to `e2e/helpers/collaborator-actors.ts` as a prerequisite** before landing the new scenarios. Non-optional; the file will hit the cap otherwise.

## Documentation changes

### New file: `docs/conventions.md`

Create a canonical conventions document. First entry is the realtime event naming rule below; future conventions (envelope shapes, error codes, pagination, etc.) accumulate here rather than growing inline in CLAUDE.md files.

Structure: one `## <convention name>` per rule, with anchored links so CLAUDE.md and cross-cutting docs can reference specific sections.

First entry:

```markdown
## Realtime event naming

Every realtime event kind MUST start with its owning domain — the domain whose
service emits it. Examples:

- `todo-created`, `todo-updated`, `todo-deleted` (todo domain, single-item)
- `todos-reordered`, `todos-imported` (todo domain, bulk)
- `todo-list-updated`, `todo-list-collaborator-added` (todo-list domain)

**Pluralization rule.** Single-item mutations use singular (`todo-created`);
bulk mutations that span multiple items atomically use plural
(`todos-reordered`, `todos-imported`). This mirrors the server's payload
shape — singular events carry one entity, plural events carry an array.

Events may ride on a channel owned by a *different* domain (e.g., `todo-created`
publishes on `todo-list:{listId}`); the prefix refers to the emitter, not the
transport. This keeps log lines, subscription inspection, and grep output
self-describing when multiple domains multiplex over one WebSocket.

The channel-key namespace already disambiguates at the wire level (each tRPC
subscription has a typed return union). The prefix is a code-readability
convention — nice-to-have, not architecturally load-bearing.

### Event shape — payload vs notification

**Payload-shaped events** carry the full post-commit entity (or the delta
needed to patch client cache). Client handlers use `setQueryData`, no refetch
on the hot path. Use for high-frequency, cache-patchable mutations.

**Notification-shaped events** carry only identifiers; client handlers
`invalidateQueries` and refetch. Use when payload isn't trustworthy for the
consumer's decision (authz-cascading events like `collaborator-removed`) or
when the mutation is rare (metadata updates).

Each event kind picks one shape at design time and commits to it. Mixing
shapes within one kind (sometimes payload, sometimes id-only) breaks the
handler contract.

### Event kinds SSOT

For each domain's event union, the list of kinds lives as a `const` tuple with
the event type derived from it:

```ts
export const DOMAIN_EVENT_KINDS = ["kind-a", "kind-b", ...] as const;
export type DomainEventKind = (typeof DOMAIN_EVENT_KINDS)[number];
export type DomainEvent = { kind: "kind-a"; ... } | { kind: "kind-b"; ... };
```

Reasoning: a runtime array is needed for relay type-guards and dispatch maps;
deriving the type from the array (not the other way around) means adding a
kind without updating the tuple produces a compile error at every exhaustive
consumer.
```

### Root `CLAUDE.md` — new top-level "Conventions" section

Add a section that names `docs/conventions.md` as canonical and summarizes each
convention with a one-line hook plus anchored link:

```markdown
## Conventions

Canonical cross-cutting conventions live in `docs/conventions.md`. Read the
relevant section before writing code that touches the area.

- **Realtime event naming** — domain-prefixed event kinds. See [docs/conventions.md#realtime-event-naming](docs/conventions.md#realtime-event-naming).
- **Event shape — payload vs notification** — pick one shape per kind; don't mix. See [docs/conventions.md#event-shape--payload-vs-notification](docs/conventions.md#event-shape--payload-vs-notification).
- **Event kinds SSOT** — const tuple → derived type, never the reverse. See [docs/conventions.md#event-kinds-ssot](docs/conventions.md#event-kinds-ssot).
```

**Not in scope:** migrating the existing inline conventions (SSOT rules,
Cross-Layer Naming, FSD layer rules, transaction rules, router/service split,
e2e conventions, etc.) from the root `CLAUDE.md` and subfolder CLAUDE.md files
into `docs/conventions.md`. That's a larger consolidation follow-up — see
**Follow-up work** below. This spec seeds the new file with realtime-event
conventions only and establishes the pattern (canonical `docs/conventions.md` +
CLAUDE.md pointer section).

### `packages/api/CLAUDE.md` — update the "Adding a New Feature" section

Add note: for any mutation that should fan out to collaborators in real time,
follow the payload-event pattern in `todo-list/service.ts`. Link to
`docs/conventions.md#realtime-event-naming`. Backend unit tests inject
`MemoryChannelFactory` and assert publish.

## Implementation order

### Phase 0 — domain merge (separate commit)

0a. `git mv` file renames per "What moves" table.
0b. Update `packages/api/package.json` exports per diff above.
0c. Rewrite 3 cross-package consumer imports (`apps/server/src/index.ts`, `apps/web/src/shared/todo-http-client.ts`, `apps/web/src/features/todo/use-todos.ts`).
0d. Delete `todo` ALLOWLIST entry in `scripts/check-domain-names.ts`.
0e. Grep sweep: `rg "@project/api/domains/todo/" --glob '!docs/**'` returns zero matches.
0f. `make lint` + `make test-unit` + `make test` all green.

### Phase 1 — event redesign (commits in order)

1. Extract `e2e/helpers/collaborator-actors.ts` from the existing `collaborators.ts` step file (prerequisite — file is at 498/500 lines).
2. **Atomic commit** — land steps 2a + 2b + 2c together. Intermediate states are type-broken: renaming the union without updating the existing `completeTodo` publisher fails `make lint`, and vice versa. Bundle the rename + publisher update + existing-test fixture update into one commit:
   - **2a.** Update `TodoListEvent` union in `events.ts` (rename `list-updated` → `todo-list-updated`, `collaborator-*` → `todo-list-collaborator-*`, add the 4 new kinds, add `TodoWithList` type) + add `TODO_LIST_EVENT_KINDS` const tuple.
   - **2b.** Update `completeTodo` publisher payload from `{kind, listId, todoId}` to `{kind, listId, todo: TodoWithList}` (fetch with `include: {todoList: true}` — or pass the existing `updated` through after re-querying the relation).
   - **2c.** Update `__tests__/events.test.ts` fixtures: 3 event-kind renames across ~8 string-literal sites (`list-updated` → `todo-list-updated`, `collaborator-removed` → `todo-list-collaborator-removed`, plus `todo-updated` payload shape change from `todoId` to `todo: TodoWithList`).
3. Wire the four new payload publishers in the merged todo service (`createTodo`, `deleteTodo`, `reorderTodos`, `importTodosFromCSV`). For each: add the `options: { channel?: ChannelProvider }` parameter (mirror `completeTodo`), publish after the last DB write but inside the `$transaction` callback, ensure the payload includes `todoList` where applicable. Publisher sketches:
   - `createTodo` — the `tx.todo.create({ ..., include: { todoList: true }})` return value is the payload's `todo`.
   - `deleteTodo` — publish `{kind: "todo-deleted", listId: todo.todoListId, todoId: id}` after the delete (`todo` fetched pre-delete for authz already includes `todoListId`).
   - `reorderTodos` — publish `{kind: "todos-reordered", listId: todoListId, positions: ids.map((id, i) => ({id, position: i}))}`. Assumes dense `[0..N)` positions starting at 0, matching today's server behavior where the client sends the full ordered id list.
   - `importTodosFromCSV` — re-query the inserted rows with `include: {todoList: true}` (or construct by joining inserted ids with the already-loaded parent list — cheaper, one query saved), publish `{kind: "todos-imported", listId: todoListId, todos: [...]}`.
4. Backend tests — 4 new publish assertions. Existing `completeTodo` assertion already updated in step 2b.
5. Create `event-handlers.ts` map + unit tests (8 tests: one per kind, plus cold-cache no-op assertion for the 5 payload kinds).
6. Refactor `use-todo-list-live-updates.ts` to use the handler map; remove the old broad-invalidate `applyEvent`.
7. Update relay type-guard to import `TODO_LIST_EVENT_KINDS` from events.ts; add same-origin-trust comment at the guard site.
8. BDD: 4 new scenarios (create realtime, delete realtime, CSV-import realtime, cold-cache peer first-navigation). Existing realtime-sync scenario (complete toggle) unchanged.
9. Documentation: create `docs/conventions.md` seeded with the three realtime-event conventions (naming + shape + SSOT, including pluralization rule); add "Conventions" section to root `CLAUDE.md` with pointers; update `packages/api/CLAUDE.md` mutation-fan-out note.
10. `make lint` + full test run.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Publish-inside-transaction: rollback → phantom ROW visible for seconds-to-minutes | Accepted — rollback is rare, `refetchOnWindowFocus` self-corrects within user attention. Stance documented in § "Phantom-event visibility window". Post-commit publish is tracked as a follow-up. |
| Payload type-drift: plain `Todo` vs cached `Todo & {todoList}` | Event payloads typed `TodoWithList` in `events.ts`; publishers include `todoList` relation. TypeScript enforces assignment compatibility at every publish site. Handler unit tests assert the relation is present after patch. |
| Reorder/import cache array stays in old order | Handlers re-sort after patch (`sortTodos` helper mirroring server's `orderBy`). Unit tests assert sort order post-patch. |
| Missed events during tab hibernate / WS hiccup | `useQuery` on mount refetches; `refetchOnWindowFocus` also triggers. Acceptable for the todo use case. Gap-fill / reconnect replay is a separate larger design, out of scope. |
| `setQueryData` patch shape bug drifts cache silently | Covered by frontend unit tests per handler. Typed event union + `Extract<...>` handler signature gives compile-time shape check at publisher and consumer. |
| Malformed peer-relayed event → runtime TypeError | BroadcastChannel is same-origin trusted; minimal kind-check at the guard is sufficient. Documented in § "BroadcastChannel trust boundary". |
| Wire-incompatible payload rename (`todo-updated` shape changes) | Single-deploy monorepo — frontend and backend ship together. Non-issue for this repo; revisit if deploy topology changes (tracked as follow-up). |
| E2E `collaborators.ts` hits 500-line cap mid-phase | Helper extraction is step 1 of Phase 1, non-optional. |
| Domain merge touches many files, rename-heavy diff | Separate commit (Phase 0) with `git mv` rename detection + 4 consumer edits. Review via `git diff --stat` plus spot-checks on the package.json diff and 4 consumer files. |

## Follow-up work

**Tracking mechanism:** at end-of-session, the post-implementation handover doc for this spec (`docs/superpowers/specs/YYYY-MM-DD-realtime-push-semantics-handover.md`) copies these items forward verbatim in a "Deferred follow-ups" section, same pattern as `2026-04-19-plan-c-followups-handover.md` §43–58. Each item here gets a §-anchor in the handover for next-session discoverability. No separate issue tracker — `docs/superpowers/specs/*` IS the tracker for this project.

- **Consolidate project conventions into `docs/conventions.md`.** This spec seeds the file with three realtime-event conventions. A separate spec should migrate the remaining inline conventions from the root `CLAUDE.md` and all subfolder CLAUDE.md files — structure, domain/feature cross-layer naming, SSOT rules, backend router/service split, transaction rules, FSD layer rules, e2e file conventions, etc. CLAUDE.md files become thin pointer layers: "how to work here" commands + critical rules + anchored links into `docs/conventions.md`. Pure documentation movement, zero behavior change, easy diff review. Priority: low, worth doing before more inline conventions accumulate.
- **Publish-after-commit refactor.** Codebase-wide: every existing publisher in `todo-list/service.ts` and the merged `todo-service.ts` publishes inside the `$transaction` callback today. Moving publishes post-commit eliminates the phantom-row window. Scope: routers hold the transaction, await the service, then publish post-commit via a helper. Not urgent at current scale; worth tackling if phantom rows ever become user-visible (e.g., if publish volume or tab lifetimes grow).
- **Reconnect gap-fill.** If missed events ever become a real UX problem (users report "I missed a todo update"), this is where to start: durable per-channel event log, client-side last-seen tracking, bootstrap-on-reconnect replay. Out of scope today because `useQuery` + `refetchOnWindowFocus` cover the current use case.
- **`TodoListMembership.role` write-tier enforcement** (separate UX work).
- **Envelope versioning.** The event envelope is `{kind, ...payload}` with no version field today, relying on single-build-single-container deploy. Revisit if the deploy topology changes (blue/green, canary, mobile clients with delayed updates) — options include adding a `version: number` field or enforcing always-deployed-together via build-hash matching.

## Open questions

None blocking.
