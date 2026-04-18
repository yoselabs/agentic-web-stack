# Template Reference Implementation — Design

**Status:** Design complete, pending user review.
**Appetite:** ~2 days focused (spike, not a 2w / 6w pitch).
**Supersedes:** `2026-04-18-realtime-chat-reference-design.md` — chat is no longer the vehicle; the Todo domain is.

## Summary

The Agentic Web Stack template ships mature CRUD + SSR + auth primitives but is missing the realtime, authorization, optimistic-update, multi-tab, email, and background-job layers every non-trivial feature needs. This spike establishes those primitives on the existing `Todo` domain by adding a real user-visible feature — collaborator sharing with email invites and live updates — so future work copies working patterns instead of reinventing them.

Once this lands, every downstream feature's acceptance criteria can reference specific files here as "reuse this pattern — do not reinvent." After the hackathon, these become template capabilities: the next `a2sdlc` project gets realtime + authz + email + background jobs for free.

## Reference vs. Feature

The feature is real (Alice invites Bob, Bob gets an email, edits sync live, access revocation cuts mid-session). But the intent is pattern demonstration. Every sub-system must be isolated enough that an agent skill can cite it in ~50 lines:

- CASL ability composer + per-domain rule files
- `@project/realtime` channel abstraction (Redis in prod, `MemoryChannel` for tests + reference reading)
- tRPC subscription transport over WebSocket
- `useOptimisticMutation` with rollback + toast conventions
- `useLeaderTab` via `BroadcastChannel`
- `@project/email` — enqueue-only send API
- `@project/jobs` — BullMQ queue factories
- `apps/worker` — separate crash-isolated process
- Bull Board under admin-gated route
- Admin role via Better-Auth `additionalFields` (deliberately not the Better-Auth `admin` plugin)

## Architecture Overview

```
Browser
 ├─ HTTP : queries, mutations, file upload/download
 └─ WS   : subscriptions (tRPC over ws://host/trpc-ws)
                                │
                                ▼
apps/server (Hono + @hono/node-server + @hono/node-ws)
 ├─ /api/auth/**           (Better-Auth)
 ├─ /trpc/*                (tRPC HTTP)
 ├─ /trpc-ws               (tRPC WS adapter)
 ├─ /admin/*               (requireAdmin middleware → Bull Board)
 └─ tRPC middleware        (resolves the SAME CASL ability as /admin/*)
                                │
                                ▼
packages/api
 ├─ authz/                 (CASL ability composer + per-domain rules)
 ├─ domains/todo/          (enriched — collaborators, subscriptions)
 └─ realtime/ → NOT here — extracted as @project/realtime

packages/realtime (NEW)
 ├─ RedisChannel           (production; ioredis pub/sub)
 └─ MemoryChannel          (test fixture + reference code)

packages/jobs (NEW)         BullMQ queue factories
packages/email (NEW)        nodemailer wrapper; send() enqueues, never sends inline

apps/worker (NEW)           separate Node process; handlers for email + maintenance
                                │
                                ▼
Infrastructure
 ├─ Postgres                (dev + dynamic-port per test suite)
 ├─ Redis                   (dev + dynamic-port per test suite) — BullMQ + realtime
 └─ Mailpit                 (dev + dynamic-port per test suite)
```

## Design Decisions

### 1. Realtime transport: Redis in production, MemoryChannel for tests

`@project/realtime` exposes a `Channel` interface:

```ts
interface Channel<T> {
  publish(event: T): Promise<void>;
  subscribe(handler: (event: T) => void): Unsubscribe;
}
```

Two implementations ship:

- **`RedisChannel`** — production. Uses `ioredis` pub/sub. Same connection pool as BullMQ. Single runtime path in app code.
- **`MemoryChannel`** — test fixture and reference code. A shared `EventEmitter` map keyed by channel name. Used by service-layer unit tests (no Docker needed) and readable as the canonical minimal implementation of the contract.

**Not runtime-selectable.** App code imports `channel(key)` which always resolves to `RedisChannel`. Tests inject `MemoryChannel` directly via a service-layer DI seam. This avoids the "which backend am I running" footgun while still giving agents a simple implementation to read.

### 2. Authorization: CASL with per-domain rule files

`packages/api/src/authz/` composes a single ability per request from per-domain rule files:

```
authz/
  index.ts         — abilityFor(session) — composes all rule files
  rules/
    admin.ts       — role === "admin" → can("access", "AdminDashboard")
    todo.ts        — owner/collaborator/stranger rules over TodoList
```

The same ability resolves both Hono middleware (for `/admin/*`) and tRPC middleware. Prisma queries filter via `accessibleBy(ability)`. React hides actions via `<Can>`. One source of truth for "can this session do X."

Guard against CASL's `subject()` wrapping footgun: a shared `asSubject()` helper in `authz/subject.ts`, plus a unit test that fails when a rule receives an unwrapped plain object (silent class-level fallback leads to over-granting).

### 3. Admin role and username via Better-Auth `additionalFields`

Better-Auth's user gets two new fields via `additionalFields`:

- `role: string` (default `"user"`) — authz classification. The pitch's rejected alternative — Better-Auth's `admin` plugin — introduces ban / impersonation / permission statements we don't need, and creates a second RBAC paradigm alongside CASL.
- `username: string` (unique, required at signup) — used for collaborator invites. Lookup-only — no login-by-username flow in this spike. Using `additionalFields` rather than the Better-Auth `username` plugin keeps a consistent pattern (one mechanism for custom user fields). If login-by-username becomes a need later, swap to the plugin as a follow-up.

Seed script: `scripts/seed-admin.ts` sets `role = "admin"` for a given email. Used by test setup and manual provisioning.

### 4. Worker as a separate process

`apps/worker/` is a Node process running BullMQ workers. Crashes stay isolated from the HTTP server. Compose: `restart: unless-stopped`; HTTP server does not depend on worker health.

Two queues:

- `email` — retryable with exponential backoff, dead-letter on final failure
- `maintenance` — repeatable cron jobs

### 5. Jobs inventory (final, post-triage)

| Queue | Job | Trigger | Demonstrates |
|---|---|---|---|
| `email` | `invite-collaborator` | `todoListService.inviteCollaborator(listId, username)` | Plain enqueue, retry policy, dead-letter (acceptance test #7) |
| `email` | `password-reset` | Better-Auth `sendResetPassword` hook | Reinforces enqueue pattern in a second domain |
| `maintenance` | `expire-invites` | Nightly cron | Repeatable jobs (`{ repeat: { pattern } }`) + cleanup pattern |

**Cut from pitch:** `welcome` email (pattern proven twice already), `list-reminder` (contrived demo feature), invented `expire-invite` delayed job (would be redundant with read-time `expiresAt` check), `prune-sessions` (one repeatable cron is enough). Delayed jobs are not demoed by any job; `packages/jobs/README.md` carries a 3-line note pointing at the BullMQ `{ delay: ms }` option with a link to upstream docs.

**Invite lifecycle pattern (clean):** `TodoListInvite` rows carry `invitedUserId` (FK to existing User, resolved from the username entered in the share dialog), `token`, `expiresAt`, `listId`. Every pending-invite query filters `where: { expiresAt: { gt: now() } }` for correctness. The invite email contains an accept link carrying the token; clicking accept creates the `TodoListMembership` row. The nightly `expire-invites` cron deletes rows ≥30 days past `expiresAt` for hygiene. No delayed-job redundancy.

Username lookup failure (no user exists with that username) fails the mutation with a clear error before any job is enqueued — no "invite sent to nobody" edge case.

### 6. Todo domain: no rename

The pitch proposed renaming `Todo` → `ExampleTodo` to signal "reference pattern." Rename blast radius touches the Prisma schema (+ migration), services, routers, tests, UI routes, and the generated route tree — cost 2-3 hours of churn for signaling value. Instead: add `packages/api/src/domains/todo/REFERENCE.md` pointing at the subsystems established here, and let the implementation itself signal the pattern.

Reversible decision — if the signaling value proves insufficient in review, rename is a one-commit follow-up.

### 7. Dev email: Mailpit, not MailHog

Mailpit (`axllent/mailpit`) is a drop-in replacement for MailHog. Same ports (1025 SMTP, 8025 HTTP UI), actively maintained, better UI. MailHog's repo has been maintenance-only for years.

### 8. Test isolation: per-suite ports for Redis + Mailpit

Follows the existing pattern in `packages/test-infra/src/index.ts` (see `PROFILES` + `CONTAINER_SERVICES`). Tests that inspect queue state or mailbox contents cannot share infrastructure with dev.

| Service | Dev port | e2e base | unit base |
|---|---|---|---|
| Postgres | 5432 | 5400 | 5500 |
| Redis | 6379 | 6300 | 6400 |
| Mailpit SMTP | 1025 | 2500 | 2600 |
| Mailpit HTTP | 8025 | 8100 | 8200 |

Per-worktree hash offset (mod 100) is shared across all services — all ports for a given worktree share the same offset. This is the existing convention; no change required. Collision probability stays at the current level (10 concurrent worktrees ≈ 37% any collision; Docker fails loudly on bind if it happens).

Extend `CONTAINER_SERVICES` in `packages/test-infra/src/index.ts`:

```ts
redis: {
  envVar: "REDIS_URL",
  url: (port: number) => `redis://localhost:${port}`,
},
mailpitSmtp: {
  envVar: "SMTP_URL",
  url: (port: number) => `smtp://localhost:${port}`,
},
mailpitHttp: {
  envVar: "MAILPIT_API_URL",
  url: (port: number) => `http://localhost:${port}`,
},
```

Extend `scripts/check-test-infra-integrity.ts` to cover the new services (compose + Zod schema cross-check).

### 9. Worker in tests: e2e only, not unit

Unit tests verify "mutation enqueues a job with correct payload" by inspecting the in-memory queue — cheaper and more honest than spinning up a worker. Only e2e tests exercise live job execution. The e2e setup spawns a worker subprocess via `envForSubprocess()` pointing at the suite's Redis + Postgres + Mailpit.

## File Layout Delta

```
apps/server/src/
  admin/                           NEW
    bull-board.ts                  — createBullBoard + HonoAdapter setup
    middleware.ts                  — requireAdmin() via ability.can("access","AdminDashboard")
  index.ts                         + mount /admin/* behind requireAdmin
                                   + mount tRPC WS adapter on same http.Server

apps/worker/                       NEW
  src/
    index.ts                       — boots email + maintenance workers; graceful shutdown
    handlers/
      email.ts                     — processes email.* via @project/email handler registry
      maintenance.ts               — processes maintenance.expire-invites
  package.json                     — tsx watch in dev, tsc + node in prod
  Dockerfile

apps/web/src/
  hooks/
    useOptimisticMutation.ts       NEW — tRPC mutation wrapper + rollback + toast
    useLeaderTab.ts                NEW — BroadcastChannel leader election
  routes/
    todo/$listId/share.tsx         NEW — sharing dialog
  components/
    collaborator-list.tsx          NEW

packages/api/src/
  authz/                           NEW
    index.ts                       — abilityFor(session) composer
    subject.ts                     — asSubject() helper + unit test
    rules/
      admin.ts                     — admin dashboard rule
      todo.ts                      — owner/collaborator/stranger rules
  domains/todo/
    REFERENCE.md                   NEW — "this is the pattern to copy" pointer doc
    authz.ts                       NEW — re-exports domain rule
    service.ts                     + addCollaborator, removeCollaborator
                                   + publishes to realtime channel
                                   + enqueues invite-collaborator email
    router.ts                      + subscribe(listId) — tRPC subscription
    constants.ts                   + invite-expiry retention window
    __tests__/                     + service tests using MemoryChannel

packages/realtime/                 NEW
  src/
    types.ts                       — Channel<T> interface
    channel.ts                     — channel(key) factory → RedisChannel in prod
    redis-channel.ts               — production impl
    memory-channel.ts              — test fixture + reference
    index.ts                       — subpath exports: /channel, /memory
  __tests__/
    contract.test.ts               — same suite runs against both impls

packages/jobs/                     NEW
  src/
    redis.ts                       — shared ioredis config
    queues.ts                      — createEmailQueue, createMaintenanceQueue
    index.ts
  README.md                        — usage + note on {delay: ms} primitive

packages/email/                    NEW
  src/
    service.ts                     — send(template, vars) → emailQueue.add()
    templates/
      invite-collaborator.ts
      password-reset.ts
    handler.ts                     — rendered-template → nodemailer transport
    index.ts

packages/auth/src/
  index.ts                         + additionalFields: { role }
                                   + sendResetPassword → emailService.send("password-reset", ...)

packages/test-infra/src/
  index.ts                         + PROFILES additions (redis, mailpitSmtp, mailpitHttp)
                                   + CONTAINER_SERVICES entries

packages/env/src/server.ts         + REDIS_URL, SMTP_URL, MAILPIT_API_URL Zod schema

prisma/schema.prisma               + TodoListMembership (userId, listId, role)
                                   + TodoListInvite (token, invitedUserId, listId, expiresAt)
                                   + User.role: String @default("user")
                                   + User.username: String @unique

scripts/
  seed-admin.ts                    NEW — set user.role = "admin" by email
  check-test-infra-integrity.ts    + cover redis, mailpitSmtp, mailpitHttp

docker-compose.dev.yml             + redis (6379), mailpit (1025/8025), worker service
docker-compose.test.yml            + redis, mailpit (parameterized ports)
docker-compose.yml                 + redis, mailpit, worker — prod template

Makefile                           + make dev gains worker target
pnpm-workspace.yaml                + catalog entries for new dependencies
```

## Acceptance Tests

Every test has a corresponding Playwright e2e scenario or Vitest integration test. No "verified manually" shortcuts. All run against per-suite Postgres + Redis + Mailpit with dynamic ports.

1. **Email invite notification.** Alice opens the share dialog, enters Bob's username, and submits. Mailpit (via API at `MAILPIT_API_URL`) receives the invite-collaborator template addressed to Bob's registered email. Bob (already signed in) clicks the accept link; list appears in his sidebar. Submitting an unknown username returns a validation error and enqueues no job.
2. **Real-time sync.** Bob toggles a todo. Alice's browser (list open in another tab) reflects the change within 500 ms with no reload.
3. **Multi-tab leader election.** Bob opens the list in two tabs. Exactly one tab has an open WS in DevTools → Network → WS. Both tabs reflect updates. Closing the leader tab promotes the peer within 2 s.
4. **Authorization cascade.** Alice removes Bob. Bob's tab shows "You no longer have access to this list" within 500 ms; the subscription closes. Bob refreshes: list is no longer in sidebar, direct URL is 403.
5. **Password reset.** User clicks "Forgot password", enters email, receives message in Mailpit, clicks the reset link, sets a new password, signs in.
6. **Retry + dead-letter + manual retry via Bull Board.** Mailpit stopped mid-test. An invite triggers the `email` job; worker retries per exponential-backoff policy (3 attempts). Failed job visible at `/admin/queues/email/failed` with `failedReason` containing the SMTP error. Mailpit restarted; clicking **Retry** in Bull Board succeeds and the email is delivered.
7. **Admin gate.** Unauthenticated GET `/admin/queues` → 403. Authenticated non-admin user → 403. Authenticated admin (seeded via `scripts/seed-admin.ts`) → 200, Bull Board renders with queue list.
8. **Invite expiry at query time.** An invite with `expiresAt` in the past is not returned by the pending-invites query. (Unit test — no cron required.)
9. **Expire-invites cron hygiene.** Manually advance time (or call the job handler directly in tests); invites ≥30 days past `expiresAt` are deleted; invites within the window survive. (Unit test.)

## Rabbit Holes

- **CASL `subject()` footgun.** Plain objects silently fall back to class-level checks. Mitigation: `asSubject()` helper + unit test that fails on unwrapped input.
- **WebSocket reconnect semantics.** Server restarts trigger client resubscription via tRPC's built-in retry with exponential backoff. Cap max interval to avoid thundering herd on deploys.
- **Leader-tab election.** Use the Web Locks API (`navigator.locks.request`) for election — the browser guarantees exactly one holder per lock name and handles unload automatically. No hand-rolled heartbeat protocol. `BroadcastChannel` is used only for leader→peer event relay, not for election. Graceful degradation: if Web Locks is unavailable, every tab acts as leader (wasteful but correct).
- **RedisChannel first-subscriber race.** Two concurrent `subscribe()` callers must not both initialize a Redis subscriber — doing so leaks one of the connections (SUBSCRIBEd but unreferenced). Mitigation: `subscriberReady: Promise<Redis>` captured synchronously in the first call; later callers await the same promise.
- **tRPC API drift.** The repo uses `@trpc/tanstack-react-query`'s `createTRPCOptionsProxy` pattern (via `Route.useRouteContext()`), not `createTRPCReact`. Drift is caught by `scripts/check-trpc-patterns.ts` (grep-guard in `make lint`) — same mechanism as the existing `process.env` outside `@project/env` check.
- **Mailpit is dev-only.** No auth, plaintext HTTP UI. Production uses real SMTP via env (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`). No hardcoding — Zod schema enforces.
- **Bull Board leaks job payloads.** Password-reset URLs contain single-use secrets that land in job `data`. `/admin/*` guard must execute before the Bull Board mount (middleware order in Hono is load-bearing). Acceptance test #7 locks this in.
- **Job idempotency.** Retries re-run the handler. Handlers must be idempotent or use a dedup key in job data. Documented in `packages/jobs/README.md`. Email handlers are naturally idempotent modulo SMTP server behavior.
- **Worker crash isolation.** `restart: unless-stopped` on worker; HTTP server does not `depends_on` worker health (only worker depends on `redis`).
- **`seq` / watermark not included.** Gap-fill on reconnect is deferred. Acceptable for this spike; real-time events may be missed if WS drops mid-change. Documented in `packages/realtime/README.md` as a known limitation with a pointer to the BullMQ+seq pattern for when it matters.

## New Dependencies

**Server + `@project/*` packages:**
- `ioredis`
- `nodemailer`
- `bullmq`, `@bull-board/api`, `@bull-board/hono`
- `@casl/ability`, `@casl/prisma`
- `@trpc/server/adapters/ws`, `ws`, `@hono/node-ws`

**`apps/worker`:**
- `bullmq`, `ioredis`, `nodemailer` + shared `@project/*` packages

**`apps/web`:**
- `@casl/ability`, `@casl/react`

**Compose:**
- `redis:7-alpine`, `axllent/mailpit`, worker built from `apps/worker/Dockerfile`

All pinned via `catalog:` in `pnpm-workspace.yaml`.

## Out of Scope

Explicitly deferred to future work — do not build here:

- Watermark / sequence IDs / `changesSince(seq)`
- Attachments with access cascade
- Virtualized 100K-item scroll
- Presence / typing indicators / cursor-move signals
- TTL offline message buffer
- Better-Auth `admin` plugin
- Platform admin tRPC procedures (list users, suspend, audit log)
- Admin SPA (`apps/admin-ui`) — Bull Board is enough
- `user.delete-cascade` long-running progress jobs
- Delayed-job demo (note in README is sufficient)
- Worker-exercising unit tests (in-memory queue inspection is cheaper and honest)

## Scope Triage (pre-committed cut order)

If the 2-day appetite runs tight, drop in this order:

1. Acceptance test #9 (expire-invites cron hygiene) — keep the handler, drop the test.
2. `useLeaderTab` — revert to "every tab opens its own WS." Acceptance test #3 goes with it.
3. Bull Board + admin role — cut last; carries the only cross-surface CASL demo (Hono + tRPC). Dropping this invalidates the pitch's "single ability across both surfaces" claim.

**Never-cut:** CASL ability composer, `@project/realtime` with both impls, tRPC WS, `useOptimisticMutation`, `@project/email`, `@project/jobs`, `apps/worker`, password-reset flow, invite-collaborator flow.

## Hand-off Note

Once this lands, downstream work cites specific files here as "reuse this pattern — do not reinvent." Each subsequent pitch names which primitives it *establishes* (few) vs *reuses* (most).

After the hackathon, these primitives graduate from "built this weekend" to **template capabilities** — the next `a2sdlc` project that needs realtime + authz + email + background jobs gets them for free.

## Glossary

- **Ability** (CASL) — immutable per-request description of what the current session may do, composed from per-domain rule files.
- **Channel** — a named pub/sub topic. `@project/realtime` abstracts the transport (Redis in prod, in-memory for tests).
- **Leader tab** — the single browser tab for a given user that currently owns the WebSocket subscription; peers receive events via `BroadcastChannel`.
- **Admin** — a user with `role = "admin"`. Grants access to `/admin/*` via the same CASL ability as every other authz check. No parallel RBAC system.
- **Queue / Worker** — BullMQ concepts. Queue holds jobs; worker is a separate process that pulls and executes. Workers live in `apps/worker`, not in the HTTP server.
