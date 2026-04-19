# Realtime Push Semantics — Handover

**Branch:** `feat/template-reference-impl`
**Status:** Shipped.
**Spec:** `docs/superpowers/specs/2026-04-19-realtime-push-semantics-design.md` (commit `bb77e69`)
**Plan:** `docs/superpowers/plans/2026-04-19-realtime-push-semantics.md` (commit `3538a7f`)
**Supersedes:** follow-up items §43–47 and §58 of `docs/superpowers/specs/2026-04-19-plan-c-followups-handover.md`

## What shipped

10 commits since `3538a7f` (plan authored):

| Commit | Scope |
|---|---|
| `e09789f` | Phase 0: domain merge (`todo` → `todo-list`). 19 files renamed/updated. tRPC router namespaces (`appRouter.todo`, `appRouter.todoList`) stay split to keep frontend API surface stable. |
| `1f9bb0e` | Export 7 helpers from `collaborators.ts` (`Actor`, `actors`, `listIdByName`, `spawnActor`, `getActor`, `fetchUserId`, `heldLeaderLocksOn`, `resolveListIdFor`) for sibling-file reuse. Stays at exactly 500 lines. |
| `2f069aa` | **Atomic**: `TodoListEvent` union rename (`list-updated` → `todo-list-updated`, `collaborator-*` → `todo-list-collaborator-*`) + 4 new payload-shaped kinds + `TODO_LIST_EVENT_KINDS` const tuple SSOT + `TodoWithList` type + `completeTodo` publisher emits full `TodoWithList` payload + test fixtures updated. |
| `1d5e4ad` | Wire 4 new publishers in `todo-service.ts`: `createTodo`/`deleteTodo`/`reorderTodos`/`importTodosFromCSV` each accept `options: { channel?: ChannelProvider }` and publish after the DB write (inside `$transaction`). `createManyAndReturn` + `include: { todoList: true }` gives us the relation without a separate query. |
| `39d38b6` | Split publish-assertion tests into `todo-service-publishes.test.ts` (5 tests: completeTodo + 4 new). Original `todo-service.test.ts` dropped from 499 to 467 lines. |
| `1f43dea` | New `apps/web/src/features/todo-list/event-handlers.ts` — per-kind typed handler map. `sortTodos` helper mirrors server's `orderBy`. Payload kinds patch via `setQueryData`; notification kinds `invalidateQueries`. |
| `80f37fe` | Refactor `use-todo-list-live-updates.ts` — `applyEvent` replaced by `dispatch()` helper calling into `eventHandlers[event.kind]`. `TODO_LIST_EVENT_KINDS` imported from events.ts (SSOT). Same-origin trust-boundary comment at the relay guard. |
| `a9ccb88` | 4 new BDD scenarios (create/delete/import/cold-cache realtime). New step-defs file `collaborator-realtime-todos.ts` reuses existing Given phrasings from `collaborators.ts` and adds 7 new multi-actor verbs. Added `data-testid` to todo-row + lists-index. |
| `b0177b6` | Seed `docs/conventions.md` with 3 realtime-event conventions (naming, shape, SSOT). Root `CLAUDE.md` gets a "Conventions" pointer section. `packages/api/CLAUDE.md` gets a realtime-fan-out bullet. |
| `cd6cd5f` | Fix: restore `todoList.get` + `todo.list` invalidation in the `todo-list-collaborator-removed` handler. The old `applyEvent` invalidated all 4 queries; the new handler needs to match for the authz-cascade BDD to pass. Caught by `Authorization cascade on removal (realtime revoke)` scenario. |

Test counts at completion:
- `make test-unit` — **75 tests pass** (was 71; +4 publish-assertion tests, some moved to new file).
- `make test ARGS="--project desktop --grep 'Todo list collaborators|Realtime todo sync'"` — **8 scenarios pass** (4 existing + 4 new).
- `make lint` — all 15 checks pass; tsc clean.

## Decisions made (with rationale)

- **Domain-merge: `todo` → `todo-list`, keep tRPC namespaces split.** TodoList is the aggregate root. Todo, Membership, and Invite exist only inside a list; authz flows through `canReadList`; the realtime channel is list-keyed. Frontend still uses both `trpc.todo.*` and `trpc.todoList.*` namespaces — breaking that API alongside the folder move would inflate the diff without behavioral benefit. If flattening the tRPC surface ever happens, it's a separate commit.
- **Handler unit tests deferred.** `apps/web` has no test runner configured. Setting up vitest (or bun test) is its own task — tracked as follow-up. Coverage in this cycle comes from backend publish-assertion tests + BDD scenarios + TypeScript's `Extract<TodoListEvent, {kind: K}>` compile-time shape safety. The handlers are pure functions with no branching; BDD exercises each payload kind end-to-end.
- **Publish-inside-transaction kept.** Rollback-published events create a phantom-row visibility window (seconds to minutes, bounded by `refetchOnWindowFocus`). Accepted — rollback is rare, and the post-commit refactor affects every existing publisher (codebase-wide). Tracked as follow-up.
- **BDD: no reorder realtime scenario.** DnD across two browser contexts is flaky in Playwright (`@dnd-kit` + two context pointers). Unit-level sort-order assertion + existing single-user reorder scenario compose to cover the case.
- **Same-origin trust for BroadcastChannel relay.** The relay type-guard only validates `kind ∈ TODO_LIST_EVENT_KINDS` — doesn't parse payload. The leader tab publishes the exact shape it received from the server; a malformed relay would imply a same-origin logic bug. Full Zod parsing at the relay boundary would be over-engineering.
- **Wire envelope not versioned.** Single-build-single-container deploy makes old-client-new-server mismatch impossible. Revisit if deploy topology changes.

## Starting points for common next-session tasks

- **Adding a new event kind:** extend `TodoListEvent` in `packages/api/src/domains/todo-list/events.ts` + add the kind to `TODO_LIST_EVENT_KINDS` tuple (TS errors cascade to every consumer — that's the SSOT working) + add a handler in `apps/web/src/features/todo-list/event-handlers.ts` + backend publish-assertion test in `todo-service-publishes.test.ts` + (when handler-unit-test setup lands) frontend handler unit test.
- **Adding a new realtime-event domain (e.g., `notifications`):** follow `todo-list/events.ts` as reference. Every kind string-prefixed by domain name (`notification-received`, etc.) per `docs/conventions.md#realtime-event-naming`. New tRPC subscription procedure; new channel-key helper; new events.ts with its own const tuple.
- **Touching collaborator authz cascade:** the sequence is (a) server's `removeCollaborator` publishes `todo-list-collaborator-removed`, (b) server's `subscribeToListEvents` generator sees the event with `event.userId === viewerId` and closes the revoked user's stream, (c) client's handler invalidates 4 queries so the next refetch hits the server's FORBIDDEN gate and surfaces access-lost UI state. All three must align — see commit `cd6cd5f` for what breaks when (c) is incomplete.
- **Adding a new realtime BDD scenario:** reuse existing declarative phrasings in `collaborators.ts` (actor-scoped auth/list-setup/open). Add new multi-actor verbs to `collaborator-realtime-todos.ts` if needed (follow the `({}, actorName, ...) =>` destructured-first-arg idiom). Email uniqueness enforced by the `check-feature-emails` guard in `make lint`.

## Deferred follow-ups

### Consolidate project conventions into `docs/conventions.md`

This cycle seeded the file with 3 realtime-event conventions. A separate spec should migrate the remaining inline conventions from the root `CLAUDE.md` and all subfolder CLAUDE.md files — structure, domain/feature cross-layer naming, SSOT rules, backend router/service split, transaction rules, FSD layer rules, e2e file conventions, etc. CLAUDE.md files become thin pointer layers: "how to work here" commands + critical rules + anchored links into `docs/conventions.md`. Pure documentation movement, zero behavior change, easy diff review. Priority: low, worth doing before more inline conventions accumulate.

### Handler unit tests + apps/web test runner

The spec at `apps/web/src/features/todo-list/__tests__/event-handlers.test.ts` was NOT created. `apps/web` has no test runner — vitest or bun test needs wiring first. Scope: (a) install vitest + happy-dom (or add `@types/bun` if going the bun-test route), (b) add a `"test"` script in `apps/web/package.json`, (c) update `Makefile`'s `test-unit` target to run web tests too, (d) port the 10 handler unit tests from the design spec at §"Frontend unit". Low priority — existing coverage (backend publish tests + BDD + TS) is sufficient.

### Publish-after-commit refactor

Codebase-wide: every existing publisher in `todo-list/service.ts` and the merged `todo-service.ts` publishes inside the `$transaction` callback today. Moving publishes post-commit eliminates the phantom-row window. Scope: routers hold the transaction, await the service, then publish post-commit via a helper. Not urgent at current scale; worth tackling if phantom rows ever become user-visible (e.g., if publish volume or tab lifetimes grow).

### Reconnect gap-fill

If missed events ever become a real UX problem (users report "I missed a todo update"), this is where to start: durable per-channel event log, client-side last-seen tracking, bootstrap-on-reconnect replay. Out of scope today because `useQuery` on mount + React Query's `refetchOnWindowFocus` cover the current use case.

### `TodoListMembership.role` write-tier enforcement

Separate UX work. The `role` field is stored but not enforced by `canReadList` / `canWriteList` — everyone with a membership row has full CRUD on the todos. Becomes relevant when write-tiers (viewer/editor/admin) are wanted.

### Envelope versioning

The event envelope is `{kind, ...payload}` with no version field today, relying on single-build-single-container deploy. Revisit if the deploy topology changes (blue/green, canary, mobile clients with delayed updates) — options include adding a `version: number` field or enforcing always-deployed-together via build-hash matching.

### Minor known-issue: `as unknown as TodoListEvent` cast

`use-todo-list-live-updates.ts` has a cast on the tRPC subscription's `onData` parameter. Reason: wire serialization converts `Date` fields to strings, making the subscription's static type not assignment-compatible with `TodoListEvent` post-payload-expansion. The kind discriminator is intact; dispatch is safe. If a cleaner SuperJSON-aware typing solution lands in the tRPC tanstack-react-query bindings, drop the cast.

## Carried-forward follow-ups (from Plan C handover)

Still deferred from prior sessions (copied verbatim for next-session discoverability):

- **Redis subscriber leak** — `RedisChannelImpl` keeps a subscriber connection alive after the last handler unsubs. See `packages/realtime/src/redis-channel.ts`. Fine for the template; production would add a reaper.
- **Nodemailer inside transaction latency.** `sendEmail` for invite flow is awaited post-commit (router), but the `await` still blocks the request.
- **Better-Auth username typing.** `session.user.role` + `session.user.username` are cast at the authz boundary. If Better-Auth typegen ever lands in the repo, drop the cast.
- **Pre-existing e2e failures** (handover §68): `Todo Lists › private to each user`, `Todo Management › private to each user`, `Todo Management › Import todos from CSV`, Mailpit ECONNREFUSED on cold runs. These are outside this cycle's scope.

## Next-session quick-start

1. `git checkout feat/template-reference-impl`
2. `make setup`
3. `make lint` — 15 harness checks + tsc + 4 grep-guards PASS
4. `make test-unit` — 75 tests pass
5. `make test ARGS="--project desktop --grep 'Todo list collaborators|Realtime todo sync'"` — 8/8 pass
6. `make dev` to exercise manually: open two private windows, sign up as Alice + Bob, invite Bob from Alice's list, verify that create/delete/toggle/reorder/CSV-import propagate within a few seconds between browsers.
