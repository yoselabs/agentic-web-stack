# Template Reference Implementation — Handover

**Branch:** `feat/template-reference-impl` (off `main`)
**Status:** Plan A ✅ + Plan B ✅ + Plan C backend (Tasks 1-9) ✅. Frontend + e2e (Tasks 10-16) not started.
**Commit count:** 37 on branch
**Lint + unit tests:** green (59 unit tests passing)

## Spec + Plans

Design spec:
`docs/superpowers/specs/2026-04-19-template-reference-implementation-design.md`

Three sequential plans:
- `docs/superpowers/plans/2026-04-19-template-ref-a-jobs-email-worker.md` — **done**
- `docs/superpowers/plans/2026-04-19-template-ref-b-authz-admin-bullboard.md` — **done**
- `docs/superpowers/plans/2026-04-19-template-ref-c-realtime-collaborators.md` — **Tasks 1-9 done, Tasks 10-16 remaining**

## What's shipped

### Plan A — Background-job + email infrastructure (13 commits)
- `@project/jobs` — BullMQ queue factories (`emailQueue`, `maintenanceQueue`) with role-branched `createRedis()` (worker connections get `maxRetriesPerRequest: null`)
- `@project/email` — `sendEmail()` enqueues to the email queue, `handleEmailJob()` renders + delivers via nodemailer, `closeTransport()` for graceful shutdown
- `apps/worker` — separate Node process booting email + maintenance workers, `node:22-slim` Dockerfile (not alpine — conftest rule)
- Redis + Mailpit in `docker-compose.dev.yml` + `docker-compose.test.yml` with dynamic per-suite ports via `@project/test-infra` (Redis 6300/6400 bases, Mailpit SMTP 2500/2600, Mailpit HTTP 8100/8200)
- Better-Auth `sendResetPassword` hook wired through the email queue + minimal forgot/reset UI
- Integration test `password-reset.test.ts` — end-to-end through Mailpit API

### Plan B — CASL authz + admin role + Bull Board (11 commits)
- `User.role` + `User.username` as Better-Auth `additionalFields` (NOT the `admin` plugin). Atomic commit: schema + config + signup UI + all existing tests + e2e helpers updated in one shot. `username required: true`.
- `packages/api/src/authz/` — CASL ability composer, per-domain rules (`admin.ts`, `todo.ts`), `asSubject()` helper. Uses `createPrismaAbility` as the factory (not `PureAbility` directly — necessary for `accessibleBy()` to produce correct WHERE clauses)
- Ability threaded through tRPC `ctx` AND Hono `/admin/*` middleware — single source of truth
- `scripts/seed-admin.ts` — promote user to admin by email
- `scripts/check-trpc-patterns.ts` — grep-guard preventing drift back to `createTRPCReact` (matches existing `process.env` outside `@project/env` guard style)
- Bull Board mounted at `/admin/queues` behind `requireAdmin`
- E2e admin gate (3 scenarios, all pass)

### Plan C backend — Realtime + collaborators (13 commits)
- `@project/realtime` package — `Channel<T>` interface, `MemoryChannelFactory` (test fixture), `RedisChannelFactory` (production, race-safe via `subscriberReady: Promise<Redis>` promise-guard)
- Contract tests (6 tests × 2 impls = 12 assertions)
- Prisma schema: `TodoListMembership (userId, todoListId, role)` + `TodoListInvite (token, invitedUserId, expiresAt)` + User reverse relations
- todo-list service: `canReadList`, `listAccessibleTodoLists`, `inviteCollaborator` (returns `InviteCollaboratorResult` — email sent by router post-commit), `acceptInvite`, `removeCollaborator`, `listCollaborators`, `deleteExpiredInvites`. All user-reachable errors use `TRPCError` with real codes (`NOT_FOUND`, `BAD_REQUEST`, `CONFLICT`, `FORBIDDEN`).
- Service unit tests: 10 tests covering invite/accept/remove/expiry/cron, all via `MemoryChannelFactory` injection
- tRPC router: 3 mutations + 2 queries + `onListEvent` subscription via native async generator (extracted to `events.ts:subscribeToListEvents`) — auto-closes when viewer's membership is revoked (authz cascade). Unit tested via `events.test.ts` (3 tests).
- tRPC WS adapter mounted at `/trpc-ws` on the Hono http.Server — adapted `createContext` to accept WS `IncomingMessage` headers, smoke-test confirms 101 Switching Protocols
- `expire-invites` repeatable cron (`0 3 * * *`) registered on worker boot via `apps/worker/src/schedule.ts`

## Plan C remaining (Tasks 10-16)

All frontend + e2e. Backend API is stable; these tasks only wire the UI and drive e2e scenarios.

| Task | What | Files (from plan) |
|---|---|---|
| 10 | `useOptimisticMutation` helper | `apps/web/src/shared/use-optimistic-mutation.ts` |
| 11 | `useLeaderTab` hook (Web Locks API) | `apps/web/src/features/todo-list/use-leader-tab.ts` |
| 12 | tRPC WS link + `useTodoListLiveUpdates` | `apps/web/src/router.tsx` + `apps/web/src/features/todo-list/use-todo-list-live-updates.ts` |
| 13 | Sharing dialog + collaborator list UI | `apps/web/src/features/todo-list/share-list-dialog.tsx` + `collaborator-list.tsx` + list-detail route wiring |
| 14 | Access-lost empty state | `apps/web/src/features/todo-list/access-lost-empty-state.tsx` |
| 15 | E2e — invite + real-time sync + multi-tab + revocation (4 scenarios) | `e2e/features/collaborators.feature` + `e2e/steps/collaborators.steps.ts` |
| 16 | E2e — retry + dead-letter + Bull Board manual retry (1 scenario) | `e2e/features/queue-retry.feature` + `e2e/steps/queue-retry.steps.ts` |

## Load-bearing project conventions (learned in-flight)

- **FSD layers** (`apps/web/CLAUDE.md`): routes thin, features/ for capability logic. No top-level `components/` — all new UI lands under `features/todo-list/`.
- **tRPC client API**: `createTRPCOptionsProxy` + `Route.useRouteContext()`. Call sites look like `useMutation(trpc.x.mutationOptions({...}))`, `useQuery(trpc.x.queryOptions(...))`, `useSubscription(trpc.x.subscriptionOptions(...))`. **`createTRPCReact` is banned** — `scripts/check-trpc-patterns.ts` fails the build if it creeps in.
- **Better-Auth 1.6.x**: server-side reset-password API is `auth.api.requestPasswordReset`, NOT `forgetPassword`. Client-side `authClient.forgetPassword` is not typed on the `BaseAuthClient` cast — `use-forgot-password.ts` calls `authClient.$fetch("/request-password-reset", ...)` instead.
- **Prisma transaction rule** (`packages/api/CLAUDE.md`): mutation services accept `Prisma.TransactionClient`; reads accept `DbClient` union; router wraps mutations in `ctx.db.$transaction((tx) => service(tx, ...))`. Side effects that can't roll back (email enqueue, realtime publish) MUST happen outside the transaction — see `inviteCollaborator` service returning `InviteCollaboratorResult` so the router sends the email post-commit.
- **Append-alpha router registration** (`packages/api/CLAUDE.md`): when adding a new router to `src/router.ts`, insert in alphabetical order so parallel branches merge cleanly.
- **Hono wildcard router collision**: `app.on(["POST","GET"], "/api/auth/**")` combined with Bull Board's nested routes breaks Hono's TrieRouter fallback. Fix (applied in Plan B Task 9): use `app.use("/api/auth/*", (c) => auth.handler(c.req.raw))` — `use()` registers under `ALL` method and avoids the wildcard collision.
- **Dev port literals in infra files**: per root `CLAUDE.md`, dev ports (3000/3001/5432/6379/1025/8025) are hardcoded literals in the ~4 infra files that need them (Makefile, compose, CI, `@project/env` Zod defaults). They are NOT in a shared package. Test-suite ports are derived dynamically via `@project/test-infra`.
- **`setupTestDatabase` warm path** must health-check ALL suite containers (postgres + redis + mailpit), not just postgres — partial-health wakes tests to a broken state. Applied in `b588ff7`.

## Known follow-ups (out of scope, deferred)

- **I-1 (Redis subscriber leak)**: `RedisChannelImpl` keeps a subscriber connection alive after the last handler unsubs. Fine for the template; for production, add a reaper that closes idle subscribers after N seconds of no handlers. See `packages/realtime/src/redis-channel.ts:46`.
- **Nodemailer inside transaction**: `sendEmail` in Plan C's invite flow is now awaited in the router post-commit. Works, but the `await` blocks the request — a fire-and-forget pattern (or a dedicated "enqueue-after-commit" helper) would be better for production latency.
- **Better-Auth username typing**: `session.user.role` + `session.user.username` are cast at the authz boundary. If Better-Auth typegen ever lands in this repo, drop the cast in one commit.

## Quick-start checklist for the next session

1. `git checkout feat/template-reference-impl`
2. `make setup` (idempotent — brings Docker up, pushes schema, installs hooks)
3. `make lint` — must pass (15 checks + tsc)
4. `make test-unit` — 59 tests should pass
5. `make dev` to sanity-check web/server/worker/redis/mailpit all boot

## Primitives available for the frontend tasks

- `Route.useRouteContext()` — yields `{ trpc, session, ... }` (see `apps/web/src/features/todo/use-todos.ts`)
- `trpc.todoList.inviteCollaborator.mutationOptions(...)` — returns the invite row (email is enqueued server-side, no client handling needed)
- `trpc.todoList.collaborators.queryOptions({ listId })` — returns `[{ user: { id, username, name } }, ...]`, throws `FORBIDDEN` if viewer loses access
- `trpc.todoList.onListEvent.subscriptionOptions({ listId })` — streams `TodoListEvent` union; **auto-closes server-side** when viewer is removed (no client action needed)
- `trpc.todoList.listAccessible.queryOptions()` — returns lists owned OR collaborated
- `trpc.todoList.collaborators.queryFilter({ listId })` / `trpc.todoList.list.queryFilter()` — use for precise `queryClient.invalidateQueries(...)` calls
- `TodoListEvent` type is exported from `@project/api/domains/todo-list/events`
- `@casl/react` is installed — use `<Can>` for conditional rendering if needed

## Execution mode

Continue with `superpowers:subagent-driven-development`. The plan is precise enough that the remaining 7 tasks should run cleanly. Review after each task via `superpowers:requesting-code-review` (consistent with the cadence in Plan A/B).
