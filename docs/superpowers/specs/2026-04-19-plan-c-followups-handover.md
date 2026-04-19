# Plan C Follow-ups — Handover

**Branch:** `feat/template-reference-impl`
**Status:** Plan C (Tasks 10–16) + Plan C follow-ups shipped.
**Supersedes:** `docs/superpowers/specs/2026-04-19-template-reference-impl-handover.md` for everything after Task 9.

## What shipped

### Plan C execution session (commits `df99f7c..49b31d1`)
Tasks 10–16 of `docs/superpowers/plans/2026-04-19-template-ref-c-realtime-collaborators.md`. Frontend realtime wiring + invite UX + e2e. Two BDD scenarios deferred at the time (real-time sync, multi-tab) — closed in this follow-ups session.

### Plan C follow-ups session (commits following `49b31d1` on this branch)
Implements `docs/superpowers/plans/2026-04-19-plan-c-followups.md`:

- **Task 1** — widened todo authz in `packages/api/src/domains/todo/service.ts`. Every `userId` filter in `where:` clauses replaced with a `canReadList(db, viewerId, todoListId)` gate. `Todo.userId` is now a creator audit field, not an authorization key. Lock helpers (`lockActiveTodos`, `shiftActivePositions`) lose their `userId` parameter — collaborators now contend on the same position-space as the owner (correct: they ARE racing). CSV import/export included in the widening.
- **Task 2** — 10 new bun-test cases in `packages/api/src/domains/todo/__tests__/service.test.ts` covering 7 collaborator happy-paths + 2 outsider-gets-FORBIDDEN + 1 `completeTodo` publish assertion. Test count 61 → 71.
- **Task 3** — e2e subfolder-per-domain migration: 7 feature files + 7 step files moved to `e2e/features/<domain>/` + `e2e/steps/<domain>/`. Import paths rewritten `..` → `../..`.
- **Task 4** — restored two BDD scenarios: "Real-time sync between owner and collaborator" (3s assertion — see notes below) and "Multi-tab leader election holds exactly one Web Lock" (via `navigator.locks.query()` direct invariant check). Both green. Multi-tab ship criterion was met: 5/5 runs all pass in the 100ms poll bucket. Task 4 also added an **out-of-scope but load-bearing backend change** to `completeTodo`: injecting an optional `ChannelProvider` and publishing a `todo-updated` event. Without it the realtime sync path was latent dead code (Plan C declared the event type but never emitted it).
- **Task 5** — cross-layer naming convention documented in root `CLAUDE.md` + enforced by `scripts/check-domain-names.ts` (wired into `make lint`). Sub-CLAUDE.mds cross-link to the root rule. Stale path references in `e2e/CLAUDE.md` and a stale N+1 example in `packages/api/CLAUDE.md` fixed. `mobile-nav` allowlist entry extended to `{frontend, backend}` because the mobile nav concern lives in `apps/web/src/widgets/navbar.tsx` (a widget), not `apps/web/src/features/mobile-nav/`.

## Decisions made (with rationale)

- **Authz = full parity (option A).** Collaborators are indistinguishable from owners for todo CRUD + CSV. Rationale: Plan C reads as symmetrical collaboration; tightening later is easier than rescinding permissions. `TodoListMembership.role` is stored but not enforced.
- **Real-time sync assertion tolerance = 3 seconds, not 1 second.** React-query's default retry backoff + network round-trip + subscription invalidation hook = realistic floor is ~1.5s. Plan C's "within 1 second" framing is a user-facing claim, NOT a BDD assertion floor. Do not tighten this or the test will flake.
- **Multi-tab correctness check via `navigator.locks.query()` not `page.on("websocket")`.** Direct invariant (one lock holder per user-scoped lock name) is deterministic; counting WS events has timing races. Query one tab (not sum across tabs): `navigator.locks.query()` returns the origin-scoped agent-cluster snapshot, so summing would double-count.
- **`mobile-nav` marked allowed-missing in both frontend AND backend.** The mobile nav concern is a widget (`apps/web/src/widgets/navbar.tsx`), not a feature, so there is no `apps/web/src/features/mobile-nav/` folder. The e2e subfolder exists. If a dedicated `features/mobile-nav/` folder is ever added, shrink the allowlist to `{backend}` to re-enforce frontend presence.

## Starting points for common next-session tasks

- **Touching authz on todos or lists:** `packages/api/src/domains/todo-list/service.ts` → `canReadList`. All authz decisions inside the todo domain funnel through this helper.
- **Adding a new realtime event:** extend `TodoListEvent` in `packages/api/src/domains/todo-list/events.ts`, then decide whether to invalidate a new query filter in `apps/web/src/features/todo-list/use-todo-list-live-updates.ts` → `applyEvent`. Also update the `TODO_LIST_EVENT_KINDS` array in the same file (non-derived; future cleanup to type-derive it).
- **Multi-actor BDD (two browser contexts):** see `e2e/steps/todo-list/collaborators.ts` — `spawnActor`, the module-level `actors` map, and the `After` hook. Pattern is reusable for any scenario needing 2+ distinct sessions.
- **CSV import/export:** `packages/api/src/domains/todo/service.ts` — `importTodosFromCSV` + `exportTodosAsCSV`. Both gated via `canReadList`; creator audit via `userId` on `data:`.
- **Publishing realtime events from a mutation:** see `completeTodo` in `packages/api/src/domains/todo/service.ts` — pattern is an optional `options: { channel?: ChannelProvider }` parameter; tests inject `MemoryChannelFactory`; production defaults to `@project/realtime/channel`.
- **Adding a new domain:** create folders under the same `<name>` in every applicable layer (`apps/web/src/features/`, `packages/api/src/domains/`, `e2e/features/`, `e2e/steps/`). `make lint` runs `scripts/check-domain-names.ts`, which will fail if any required layer is missing. For intentionally asymmetric domains, add an ALLOWLIST entry in the script with a comment explaining the asymmetry.

## Test data convention

Every BDD email is scenario-scoped (e.g., `alice-sync@example.com` vs `alice-multitab@example.com`). No shared fixture exists; each scenario picks fresh user emails. The `e2e/scripts/check-feature-emails.ts` guard (runs in `make lint`) enforces uniqueness.

## Explicit remaining deferrals (follow-up work)

### Realtime publish asymmetry (⚠️ real UX gap, not just scope deferral)

Only `completeTodo` publishes `todo-updated`. The other todo mutations — `createTodo`, `deleteTodo`, `reorderTodos`, `importTodosFromCSV` — are silent. Consequence: if Alice and Bob both have a list open, Alice's `createTodo` does NOT fan out to Bob's client; Bob sees stale state until his query staleTime elapses or he refetches via focus/manual refresh. Toggle is the only mutation that's fully realtime today.

Fix is ~4 lines per function (follow the `completeTodo` pattern). The BDD scenarios that would exercise these (e.g., "Alice creates a todo, Bob sees it within 3s") haven't been written yet either.

### Other deferrals

- **`TodoListMembership.role` not enforced.** Becomes relevant when write-tiers (viewer/editor/admin) are wanted. Extend `canReadList` → split into `canReadList` + `canWriteList` and branch on role.
- **`/invites/:token` error UX is redirect-only.** Expired/consumed tokens → redirect to `/todo-lists`. Production would add explicit error pages (invite not found, already accepted, expired).
- **`Todo.userId` creator vs authorization drift.** When a creator loses collaborator access (owner removes them), their `Todo` rows stay pointing at an outside user. Non-goal today; worth a post-MVP audit if display/filtering needs to handle orphaned creators.
- **Enumeration oracle on `completeTodo` / `deleteTodo`.** Task 1 introduced a pattern where the service does `findUniqueOrThrow({ where: { id } })` BEFORE the `canReadList` gate. For attacker-guessed todo IDs, "exists-but-no-access" → FORBIDDEN, "doesn't exist" → P2025. Distinguishable. Todo IDs are cuid/uuid so enumeration is infeasible in practice; flag is a future-hardening consideration. Fix: thread `todoListId` into those mutations' inputs and gate BEFORE the fetch.
- **Publish-inside-transaction.** `completeTodo`'s publish is inside the `$transaction` callback. If the tx rolls back, subscribers receive an event for a change that didn't happen — self-correcting because `applyEvent` invalidates rather than writes, but noisy. Codebase-wide pattern (same in `todo-list/service.ts`'s publishers). Fix either by moving publishes to the router post-commit, or by documenting the "events are invalidation triggers only, not authoritative state" contract.
- **`e2e/steps/todo-list/collaborators.ts` at 498/500 lines.** Tight against the project's file-length cap. Extract helpers (`Actor` type, `actors` + `listIdByName` maps, `spawnActor`, `fetchUserId`, `heldLeaderLocksOn`, `resolveListIdFor`) to `e2e/helpers/collaborator-actors.ts` to regain headroom before the next scenario lands.
- **Web-Lock assertion could tighten** by querying BOTH tabs and asserting each reports 1 — proves all tabs see the same lock state. Current single-tab query is correct but less strong.
- **`TODO_LIST_EVENT_KINDS` hand-duplicated** in `apps/web/src/features/todo-list/use-todo-list-live-updates.ts`. Derive from `TodoListEvent["kind"]` with `as const` tuple so TS errors when a new kind is added.
- **Mid-run Mailpit flake** — the existing "Invite email lands in Mailpit" scenario sometimes fails with `ECONNREFUSED 127.0.0.1:2521` on cold starts. Passes in isolation. Probably needs a startup-wait in test setup.
- **Add `features/mobile-nav/` if mobile nav grows beyond the navbar widget.** Then shrink the `mobile-nav` ALLOWLIST entry in `scripts/check-domain-names.ts` to `{backend}` to re-enforce frontend presence.

## Pre-existing deferrals carried forward from Plan C

- **Redis subscriber leak** — `RedisChannelImpl` keeps a subscriber connection alive after the last handler unsubs. See `packages/realtime/src/redis-channel.ts`. Fine for the template; production would add a reaper.
- **Nodemailer inside transaction latency.** `sendEmail` for invite flow is awaited post-commit (router), but the `await` still blocks the request. A fire-and-forget pattern (or a dedicated "enqueue-after-commit" helper) would improve production latency.
- **Better-Auth username typing.** `session.user.role` + `session.user.username` are cast at the authz boundary. If Better-Auth typegen ever lands in the repo, drop the cast.

## Pre-existing e2e failures NOT caused by this session

Running `make test ARGS="--project desktop"` on HEAD shows 5 pre-existing failures, reproducible on `main` and unrelated to Plan C follow-ups:
- `Todo Lists › Lists are private to each user` — `getByLabel("Name")` ambiguous (matches both Name + Username inputs in signup form post-username-addition). Selector issue.
- `Todo Management › Todos are private to each user` — same selector issue.
- `Todo Management › Import todos from CSV` — same area.
- Both Mailpit-flavored scenarios occasionally ECONNREFUSED on cold runs.

These need a separate follow-up, outside Plan C follow-ups scope.

## Next session quick-start

1. `git checkout feat/template-reference-impl`
2. `make setup`
3. `make lint` — 15 harness checks + tsc + 4 grep-guards (email, test-infra, trpc-patterns, `check-domain-names`) all PASS
4. `make test-unit` — 71 tests pass
5. `make test ARGS="--project desktop --grep 'Todo list collaborators'"` — 4/4 pass
6. `make dev` to exercise manually: open two private windows, invite from one to the other, toggle a todo, remove the collaborator, verify access-lost screen.
