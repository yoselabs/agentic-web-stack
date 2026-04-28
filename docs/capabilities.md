# Capabilities — Agent Menu

A catalog of **reusable primitives already shipped** in this template.
Read this before writing new code: most "I need to handle X" questions
have an existing answer here.

This document is the cross-stack contract preserved by the Effect-TS
rewrite (see ADR-0009). Each entry's *behavior* must survive a substrate
swap; the *implementation* may change.

Companion docs:
- [`package-taxonomy.md`](./package-taxonomy.md) — *where does new code go?*
- [`tech-stack.md`](./tech-stack.md) — *which runtime libraries implement these capabilities* (cross-linked from each entry's See line where relevant).
- [`dev-tooling.md`](./dev-tooling.md) — build/test/lint tooling (stack-agnostic).

This file answers *"what can I already use?"*.

Each entry follows the same shape:

- **What** — one sentence on what the primitive does.
- **Import** — exact subpath to copy/paste.
- **When** — signals it's the right tool.
- **When not** — common misuses.
- **See** — files, ADRs, skills, or deeper docs.

---

## Backend primitives

### Auth session + guarded procedures

- **What** — Better-Auth instance + `protectedProcedure` that narrows
  `ctx.session` to non-null. Session shape includes `user.id`, `email`,
  `name`, `role`, `username`.
- **Import** — `protectedProcedure` / `publicProcedure` from
  `packages/api/src/trpc.ts`; `auth` from `@project/auth`;
  `MIN_PASSWORD_LENGTH` from `@project/auth/constants`.
- **When** — any tRPC procedure that requires a logged-in user.
- **When not** — public procedures (landing, sign-up helpers) use
  `publicProcedure`. Don't access `ctx.session.user` in public
  procedures — it's nullable.
- **See** — `packages/api/CLAUDE.md`, `packages/auth/src/index.ts`.

### Sign-in flows (password, magic-link, password reset)

- **What** — Three Better-Auth-backed entry points: (1) email/password
  (default form on `/sign-in`), (2) magic-link as Pattern 2 secondary
  option below the password form (5-min single-use link), (3) forgot/reset
  password via `/forgot-password` → emailed token → `/reset-password`.
  All three share Better-Auth's session model and the same
  `protectedProcedure` guard.
- **Import** — Plugin config in `packages/auth/src/index.ts`
  (`magicLink(...)` plugin). Frontend hooks: `useMagicLink`,
  `useForgotPassword`, `useResetPassword` from
  `apps/web/src/features/auth/`. Email templates: `magic-link.ts`,
  `password-reset.ts` under `packages/email/src/templates/`.
- **When** — adding a new auth surface or a passwordless entry point;
  reuse the existing flows rather than invent a parallel one.
- **When not** — OAuth / SSO / WebAuthn — those are separate Better-Auth
  plugins not yet enabled here. Don't bypass Better-Auth and roll a
  custom token flow.
- **See** — `apps/web/src/routes/sign-in/`, `apps/web/src/routes/forgot-password.tsx`,
  `apps/web/src/routes/reset-password.tsx`, `packages/auth/src/index.ts`.

### CASL-style authorization

- **What** — Per-domain rule files + a composed ability factory. Checks
  live in the service layer, not routers, so they fire regardless of
  entry point (tRPC, HTTP, cron).
- **Import** — `abilityFor`, `asSubject` from
  `@project/api/authz`. Per-domain rules under
  `packages/api/src/domains/<name>/authz.ts`.
- **When** — a service needs "can this user do X to this entity?" —
  invites, ownership checks, admin gates.
- **When not** — schema-level enforcement (use Prisma relations + query
  scopes). Don't re-implement role comparisons inline — register a rule.
- **See** — `packages/api/src/authz/index.ts`, the
  `todo-list/authz.ts` reference.

### Transactions + race-safe locking

- **What** — service signatures narrow to `Prisma.TransactionClient` for
  writes; routers wrap in `$transaction`. Lock rows via
  `FOR NO KEY UPDATE` with deterministic ORDER BY.
- **Import** — `Prisma` from `@project/db`; pattern lives in
  `packages/api/src/domains/todo-list/todo-service.ts`.
- **When** — any read-then-write or multi-row mutation. Row-level locks
  when concurrent writers can race on the same set.
- **When not** — pure reads — use `DbClient` union (`PrismaClient |
  Prisma.TransactionClient`). Don't start a transaction inside a
  service; router owns the boundary.
- **See** — `packages/api/CLAUDE.md#transaction-rules`.

### Input validation (strict)

- **What** — `z.strictObject` for every tRPC / HTTP input schema.
  Rejects unknown keys with 400 instead of silently stripping.
- **Import** — `z` from `zod`.
- **When** — every `.input(...)`, every `zValidator("form", ...)`.
- **When not** — multipart forms where extra keys (`file`) are read
  manually via `parseBody()`. Use plain `z.object` and document why
  (see `todo-http.ts` for the one exception).
- **See** — `packages/api/src/domains/todo-list/router.ts`.

### Realtime fan-out (per-entity + user-inbox)

- **What** — `Channel` abstraction (MemoryChannel dev, RedisChannel
  prod) with payload-event vs notification-event discipline. Two
  topologies shipped: per-entity (e.g. `todoList:<id>`) and
  per-user (`userInbox:<userId>`).
- **Import** — `@project/realtime/channel`, `@project/realtime/types`,
  `@project/realtime/user-inbox`. Event SSOT tuples live under
  `packages/api/src/domains/<name>/events.ts`.
- **When** — a mutation should push a cache patch or invalidation to
  collaborators in real time. Cross-feature notifications
  (counters, invite state changes) → user-inbox.
- **When not** — one-user state that never needs fan-out — skip the
  channel, return the mutation result.
- **See** — ADR-0001 (`docs/adrs/0001-realtime-architecture.md`),
  `packages/api/src/domains/todo-list/todo-service.ts`,
  `conventions.md#realtime-event-naming`.

### Activity feed — resumable append-only event stream

- **What** — Domain `activity-feed` renders an ordered log of what
  happened in a scope (currently per todo-list). Reconnecting clients
  replay missed events via tRPC `tracked()` — no full refetch. Gap-fill
  uses the `activity_event` table as the replay buffer; overflow yields
  a `resync` sentinel.
- **Import** —
  - Server service: `recordActivityEvent`, `listActivityEvents`,
    `streamActivityEvents` from
    `@project/api/domains/activity-feed/service`.
  - Event types: `ActivityEventKind`, `ActivityEventPayload`,
    `ActivityEventRecord`, `ActivityEventEnvelope`,
    `activityChannelKey` from
    `@project/api/domains/activity-feed/events`.
  - Constants: `ACTIVITY_REPLAY_GAP_MAX`, `ACTIVITY_REPLAY_MAX_AGE_MS`,
    `ACTIVITY_LIST_PAGE_SIZE` from
    `@project/api/domains/activity-feed/constants`.
  - Web hook: `useActivityFeed(trpc, todoListId)` from
    `apps/web/src/features/activity-feed/use-activity-feed`.
  - Web panel: `<ActivityFeedPanel trpc={trpc} todoListId={listId} />`
    from `apps/web/src/features/activity-feed/activity-feed-panel`.
- **When** — you need an ordered, append-only view of user actions
  within a domain (activity log, audit feed, chat, notifications with
  history) where missed events during disconnect must replay in order.
- **When not** — ephemeral state (presence, typing) — don't log it.
  "Something changed in this query, refetch" — use a regular realtime
  invalidate event (see the todo-list event channel) and let React
  Query refetch; don't reach for `tracked()`.
- **Emission pattern** — to add a new domain that emits activity events,
  import `recordActivityEvent` into the domain's service and call it
  inside the mutation's `$transaction` callback, then publish the
  returned record via `channel(activityChannelKey(todoListId)).publish(event)`
  after tx commit. See
  `packages/api/src/domains/todo-list/activity-publishers.ts` for the
  canonical example.
- **See** —
  `docs/conventions.md#when-to-use-tracked-resumable-subscriptions`,
  `docs/superpowers/plans/2026-04-22-tracked-activity-feed.md`,
  `e2e/features/activity-feed/activity-feed.feature`.

### Rate limiting

- **What** — `rate-limiter-flexible` wrappers (in-memory for dev,
  Redis for prod) plus a tRPC middleware that consumes a point per
  call.
- **Import** — `createRateLimiter` from `@project/rate-limit/factory`.
  Middleware example: `packages/api/src/rate-limit-middleware.ts`.
- **When** — sensitive mutations (create-list, invite, password reset),
  webhook handlers, any user-supplied endpoint with abuse potential.
- **When not** — read-only queries — they're cache-friendly and cheap.
  Don't pick thresholds by guess; borrow from the reference consumer
  (`todoList.create` in `packages/api/src/domains/todo-list/router.ts`).
- **See** — `packages/api/src/rate-limit-middleware.ts`,
  `packages/api/src/domains/todo-list/router.ts` (consumer).

### Background jobs + crons

- **What** — BullMQ queues + a dedicated `apps/worker` process. Queue
  definitions are typed per-queue; cron handlers live in
  `apps/worker/src/handlers/`.
- **Import** — Queue factories from `@project/jobs/queues`. Redis
  connection from `@project/jobs/redis`.
- **When** — work that must survive a request boundary (email delivery,
  todo-purge, any scheduled maintenance). Also: work expensive enough
  that blocking the request would harm UX.
- **When not** — idempotent, fast, sync work — just do it in the
  request. Don't enqueue outside a `$transaction` boundary if the job
  depends on a row the request just created (it may not be visible yet
  — enqueue inside, or after commit).
- **See** — `apps/worker/CLAUDE.md`, `packages/email/service.ts` for the
  enqueue pattern.

### Email

- **What** — Typed template contracts + a `sendEmail` adapter that
  enqueues a BullMQ job. Transport swaps at the handler boundary
  (Mailpit dev, SES/Postmark prod).
- **Import** — `sendEmail` from `@project/email/service`. Templates
  under `packages/email/src/templates/<name>.ts`.
- **When** — any outbound email. Always async (never block the request).
- **When not** — transactional confirmations the UI already shows —
  don't double-notify.
- **See** — `packages/email/`, `password-reset.ts` reference.

### Bull Board admin dashboard

- **What** — Bull Board UI for inspecting, retrying, and deleting BullMQ
  jobs. Mounted at `/admin/queues`, gated by an admin session check. Both
  email and maintenance queues are visible.
- **Import** — `createBullBoardAdapter`, `BULL_BOARD_PATH` from
  `apps/server/src/admin/bull-board.ts`. Mounted in
  `apps/server/src/index.ts`.
- **When** — debugging stuck jobs, retrying failed deliveries, monitoring
  queue depth in production. Admin-only surface.
- **When not** — public observability — this is for operators, not users.
  Don't expose to non-admin sessions.
- **See** — `apps/server/src/admin/bull-board.ts`, `apps/server/CLAUDE.md`.

### Structured logging

- **What** — Pino logger singleton + Hono request-logging middleware that
  records method/path/status/duration. Log level driven by env; pretty
  transport in dev, JSON in prod.
- **Import** — `logger` from `apps/server/src/logger.ts`. Request middleware
  is wired automatically in `apps/server/src/index.ts`.
- **When** — anywhere on the server you'd otherwise reach for `console.log`.
  Worker handlers and BullMQ failure listeners should log via the same
  Pino instance.
- **When not** — frontend code (browser console is fine). Don't log PII or
  tokens. No correlation/request-id propagation yet — if a job triggers
  a downstream call, pass identifiers explicitly.
- **See** — `apps/server/src/logger.ts`,
  `apps/server/src/index.ts` (request middleware).

### Graceful shutdown

- **What** — SIGTERM/SIGINT handlers in each long-running process drain
  open connections before exit: HTTP server stops accepting new
  connections + closes WebSockets; worker calls `worker.close()` to let
  in-flight jobs finish; SMTP transport closes its pool.
- **Import** — Pattern lives in `apps/server/src/index.ts` and
  `apps/worker/src/index.ts`. Reuse the shape when adding a new
  long-running process.
- **When** — every process that owns external resources (DB pool, Redis
  connection, queue worker, WebSocket pool).
- **When not** — short-lived scripts (seeds, migrations) — they exit
  naturally.
- **See** — `apps/server/src/index.ts`, `apps/worker/src/index.ts`,
  `packages/email/src/handler.ts` (transport pool close).

### Direct HTTP (non-tRPC) routes

- **What** — Hono router for file upload / download / webhooks. Typed
  request/response via `hc<TodoHttpRouter>` on the client side.
- **Import** — mount under `apps/server/src/index.ts`; web-side client
  via `@project/http/client` + `hc()`.
- **When** — multipart / streaming bodies, third-party webhooks, any
  route that can't fit tRPC's request/response shape.
- **When not** — standard CRUD — use tRPC.
- **See** — `packages/api/src/domains/todo-list/todo-http.ts` (import
  CSV), `apps/server/src/admin/bull-board.ts`.

---

## Frontend primitives

### Auth session accessor

- **What** — `useAppSession()` reads an injected session (stories/tests)
  or falls through to Better-Auth (production via `RealSessionBridge`).
  Throws if neither provider is mounted.
- **Import** —
  `useAppSession` / `RealSessionBridge` / `SessionProvider` from
  `#/features/auth/session-context`.
- **When** — any component needing the signed-in user in the render
  tree.
- **When not** — server-side guards in `beforeLoad` — use the
  `ctx.session` threaded into router context from `getSession` in
  `#/features/auth/session`.
- **See** — `apps/web/src/routes/__root.tsx`,
  `.storybook/preview.tsx`.

### Route-loader data prefetch

- **What** — TanStack Router `loader` hits tRPC via `ctx.trpcClient`,
  seeds the React Query cache, route component reads with `useQuery`
  and gets the data already hydrated.
- **Import** — `Route.useLoaderData` inside the component; `loader`
  property on `createFileRoute`.
- **When** — page-level data that blocks meaningful content. Avoids
  the mount-effect waterfall.
- **When not** — data that varies with user interaction (search,
  pagination) — keep those in hooks.
- **See** — `apps/web/src/routes/_authenticated/todo-lists/` for the
  reference conversion.

### Optimistic mutations

- **What** — `useOptimisticMutation` wraps a tRPC mutation with
  snapshot + rollback. Handles the "type inference breaks on
  `setQueryData` callback" gotcha via explicit generics.
- **Import** — `useOptimisticMutation` from `@project/query`.
- **When** — instant UI feedback for creates/deletes/toggles where the
  happy path dominates.
- **When not** — operations with server-computed fields the client
  can't predict (generated IDs, server-derived timestamps that the UI
  renders).
- **See** — `apps/web/CLAUDE.md#optimistic-updates`,
  `use-todo-lists.ts` + `use-todos.ts`.

### Live-update hooks (leader tab + relay)

- **What** — `useLeaderTab` elects one tab per user via Web Locks and
  relays messages to peers via BroadcastChannel. `useTodoListLiveUpdates`
  and `useUserInbox` layer tRPC subscriptions on top.
- **Import** — `useLeaderTab` from
  `#/features/todo-list/use-leader-tab`.
  Domain hooks from each feature folder.
- **When** — real-time UI updates on a page open in multiple tabs.
  Single WebSocket per user instead of N.
- **When not** — single-tab flows (dialogs, dashboards that don't stay
  open). Don't start a subscription outside a protected route.
- **See** — ADR-0001 §D1–D3.

### HTTP fetch wrapper

- **What** — `apiClient.fetch()` prepends the base URL and sets
  `credentials: "include"`. Single seam for the web app's non-tRPC
  calls.
- **Import** — `apiClient` from `@project/http/client`.
- **When** — file upload/download, calling a Hono route, anything
  outside the tRPC surface.
- **When not** — raw `fetch("http://localhost:3001/...")` — duplicates
  base URL and bypasses the env boundary. Enforced by lint.
- **See** — `apps/web/CLAUDE.md#non-trpc-http-calls`.

### Authed media

- **What** — `<AuthedImage>` component that fetches through
  `apiClient.fetch` so cookie auth + base-URL rules apply. Future home
  for upload/crop primitives.
- **Import** — `AuthedImage` from `@project/media/authed-image`.
- **When** — rendering images served from an endpoint that requires the
  session cookie.
- **When not** — public assets — use a bare `<img>` with a CDN URL.
- **See** — `packages/media/`.

### Storybook session mocking

- **What** — `parameters.session` on a story → `SessionProvider`
  injection. No Better-Auth runtime, no network probe.
- **Import** — none — just pass `parameters.session` to a story.
- **When** — stories for any session-aware component.
- **When not** — stories for dumb shell widgets (e.g. `Navbar`) that
  take slot props directly. Those don't need the provider.
- **See** — `.storybook/preview.tsx`, `app-navbar.stories.tsx`.

### tRPC cache seeding in stories / tests

- **What** — `parameters.trpc.queries` (Storybook) or `seed` (Vitest
  `renderWithTRPC`) pre-populate the React Query cache so components
  read instead of fetching.
- **Import** — `renderWithTRPC` from `apps/web/test/render.tsx`.
- **When** — any component that calls `useQuery` and needs deterministic
  data to render.
- **When not** — components whose behavior depends on loading/error
  transitions — exercise those explicitly, don't shortcut them.
- **See** — `apps/web/test/harness.smoke.test.tsx`.

---

## Composition patterns

These aren't libraries — they're **how the primitives bind together**.
A reimplementation in another stack must reproduce these chains, not just
the parts.

### Admin role wiring (end-to-end)

- **What** — A single `user.role === "admin"` flag (Better-Auth user model)
  threads through every layer that needs admin gating. The chain:

  ```
  Better-Auth signup           → defaults role="user" (Prisma model default)
  Manual promotion             → scripts/seed/seed-admin.ts <email> sets role="admin"
  Hono session extraction      → auth.api.getSession() in apps/server/src/index.ts
  tRPC context injection       → ctx.session.user.role flows in via createContext
  CASL ability rules           → packages/api/src/authz/rules/admin.ts grants
                                 manage("AdminDashboard", ...) when role==="admin"
  Hono admin middleware        → apps/server/src/admin/middleware.ts calls
                                 abilityFor(user) and rejects if cannot("access", …)
  Bull Board mount             → /admin/queues mounted AFTER the requireAdmin
                                 middleware in apps/server/src/index.ts
  ```

- **Import** — `requireAdmin` middleware from
  `apps/server/src/admin/middleware.ts`. Admin CASL rules in
  `packages/api/src/authz/rules/admin.ts`. Promotion script:
  `scripts/seed/seed-admin.ts`.
- **When** — adding any admin-only surface (a new admin route, an admin
  tRPC procedure, an admin-only mutation). Reuse the chain — don't
  bypass CASL with an inline `if (user.role !== "admin")`.
- **When not** — feature-level permissions (per-resource ownership) —
  use a domain CASL rule, not the admin role. Don't conflate "admin
  bypass" with normal authz.
- **See** — `packages/api/src/authz/rules/admin.ts`,
  `apps/server/src/admin/middleware.ts`,
  `apps/server/src/index.ts` (mount order matters), ADR on authz.

### Mutation flow (transaction → activity → realtime)

- **What** — The canonical write path. Every mutation that other clients
  should see follows this chain in order:

  ```
  tRPC procedure
   └─ .input(zodSchema)              ← validation
   └─ protectedProcedure              ← auth gate
   └─ ctx.db.$transaction(async tx => {
        await service.mutate(tx, …)   ← writes + recordActivityEvent(tx, …)
        return event                  ← service returns the event object
      })
   └─ AFTER commit: channel.publish(event)
                              └─ subscribers receive via tRPC subscription
                              └─ frontend handler patches React Query cache
  ```

  Two non-obvious rules: (a) `recordActivityEvent` is called *inside* the
  transaction so the activity row commits atomically with the change;
  (b) `channel.publish` is called *after* commit so subscribers never see
  events for rolled-back writes.

- **Import** — Pattern lives across
  `packages/api/src/domains/<name>/router.ts` (transaction boundary) and
  `service.ts` (writes + event emit). Activity helper:
  `recordActivityEvent` from `@project/api/domains/activity-feed`.
  Channel publish: `provider(...).publish(event)` after commit.
- **When** — every mutation that (a) other tabs/users should see live, or
  (b) needs an audit trail.
- **When not** — pure reads, idempotent local UI state, single-user
  computed values.
- **See** — `packages/api/src/domains/todo-list/todo-service.ts` (canonical),
  `packages/api/src/domains/activity-feed/`, `packages/api/CLAUDE.md`
  (transaction rules).

### Realtime stack composition

- **What** — Multi-tab live updates are five layers deep, and the binding
  is what makes it work without N WebSocket connections per user:

  ```
  Frontend tab N            useTodoListLiveUpdates(listId)
                              ↓
  Leader election           useLeaderTab() via navigator.locks
                              ↓ (only the leader subscribes)
  tRPC subscription         WebSocket /trpc-ws (path-prefix discipline, ADR-0008)
                              ↓
  Server resolver           channel(channelKey).subscribe()
                              ↓
  Channel implementation    MemoryChannel (dev/test) | RedisChannel (prod)
                              ↓
  Pub/sub fan-out           Redis pub/sub multiplexes across server replicas
                              ↓
  Leader receives           onData → BroadcastChannel.postMessage to peers
                              ↓
  All tabs update           event handler patches React Query cache
  ```

- **Import** — `useLeaderTab` from `apps/web/src/features/<feature>/`,
  Channel factory from `@project/realtime`, subscription procedures
  defined in domain routers.
- **When** — any feature that benefits from live updates across tabs +
  users (todo edits, activity feed, presence). Reuse leader-tab to keep
  N tabs to one WS.
- **When not** — UI that only matters to the actor (a draft form). Don't
  multiplex events you don't need to share.
- **See** — `packages/realtime/`, ADR-0001 (realtime architecture),
  ADR-0008 (WebSocket path discipline),
  `apps/web/src/features/todo-list/use-todo-list-live-updates.ts`.

### Email enqueue discipline

- **What** — Email is a 4-hop chain with strict seam rules:

  ```
  Service code              calls sendEmail({ template, to, vars })
                              ↓ (services NEVER call nodemailer directly)
  Email service             enqueues a typed job onto the email BullMQ queue
                              ↓ (services NEVER enqueue to other queues by hand)
  Worker                    dequeues, looks up template by name, renders
                              ↓
  Nodemailer transport      Mailpit (dev, smtp://localhost:1025)
                            SES / Postmark (prod, via SMTP_URL)
  ```

  Seam rules: services use only `sendEmail`; templates are internal to
  `packages/email`; transport is swapped at the worker boundary, not at
  the service. Enqueue is *always* fire-and-forget — never block the
  request on email delivery.

- **Import** — `sendEmail` from `@project/email/service`. Templates under
  `packages/email/src/templates/<name>.ts`.
- **When** — adding a new outbound email (verification, notification,
  digest). Add a template + a typed `sendEmail({ template: "newOne",
  ... })` call.
- **When not** — synchronous receipts the UI already shows (don't
  double-notify). Don't reach into `packages/email/src/handler.ts` from
  domain code.
- **See** — `packages/email/`, password-reset and magic-link as
  references.

### Activity-feed gap-fill + live + dedup

- **What** — Resumable activity streams have to bridge "history before
  reconnect" with "live events from now on" *without* losing or
  double-yielding events. The stream subscribes to the live channel
  **before** querying historical rows, so anything published during
  gap-fill is buffered, then the two phases are merged with id-based
  dedup at the seam. Authz cascade closes the stream if the viewer is
  removed mid-stream.

  ```
  Client reconnects with lastEventId
                ↓
  Phase 0: subscribe to Channel (buffer live events arriving from now)
                ↓
  Phase 1: gap-fill from DB
    ├─ if gap > ACTIVITY_REPLAY_GAP_MAX → yield "resync" sentinel + stop
    ├─ if oldest event older than ACTIVITY_REPLAY_MAX_AGE_MS → resync
    └─ else fetch missing rows ordered by id, yield each, track lastYieldedId
                ↓
  Phase 2: drain buffered + go live
    ├─ for each buffered/incoming event: skip if id ≤ lastYieldedId (dedup)
    ├─ yield event, advance lastYieldedId
    └─ on member-removed event naming this viewer → close stream (authz cascade)
  ```

  The order matters: subscribe-first prevents the gap. The dedup boundary
  prevents double-yields when an event lands in DB *and* in the live
  buffer during the handoff.

- **Import** — `streamActivityEvents` from
  `@project/api/domains/activity-feed`. Constants:
  `ACTIVITY_REPLAY_GAP_MAX`, `ACTIVITY_REPLAY_MAX_AGE_MS` from the same
  domain.
- **When** — any resumable subscription where clients reconnect with a
  cursor (activity feeds, audit logs, chat history). Same pattern any
  time you bridge "DB historical" with "live pub/sub."
- **When not** — pure live streams without resume semantics — just
  subscribe. Don't add gap-fill if the client isn't sending a cursor.
- **See** — `packages/api/src/domains/activity-feed/service.ts`
  (`streamActivityEvents`),
  `packages/api/src/domains/activity-feed/router.ts`,
  `docs/conventions.md#when-to-use-tracked-resumable-subscriptions`.

### Test-DB bootstrap (per-worktree isolated Postgres)

- **What** — Tests run against a real Postgres, not mocks, and the
  harness derives a unique container + port per **worktree** so multiple
  branches can run tests in parallel without colliding. The composition:

  ```
  Project root path
                ↓
  testDbEnv(suite: "unit" | "e2e")
    ├─ MD5(PROJECT_ROOT) → hash8 (container name suffix)
    ├─ MD5(PROJECT_ROOT) → hash16 % 100 (port offset from base 5400)
    └─ TEST_DATABASE_URL = postgres://localhost:<base+offset>/<dbname>
                ↓
  setupTestDatabase(suite)
    ├─ docker compose up agentic-postgres-<hash8>
    ├─ wait for healthy
    └─ prisma db push --force-reset (schema reset on every run)
                ↓
  Runner spawns bun test / playwright with env inherited
                ↓
  Child sees TEST_DATABASE_URL → @project/env Zod parses → typed env
  ```

  Critical bindings: subscribing to the channel (in tests, `MemoryChannel`)
  before the harness boots the DB would race; env injection has to
  happen before Zod validation runs in the child; the same hash function
  has to be reused across `make test` and `make test-unit` so they pick
  collision-free ports when run together.

- **Import** — `testDbEnv`, `setupTestDatabase` from `@project/test-infra`.
  Used by `packages/api/scripts/test-runner.ts` (unit) and
  `e2e/global-setup.ts` (e2e).
- **When** — any new test suite that needs an isolated DB. Always go
  through `setupTestDatabase("<suite-name>")`; never hardcode a port.
- **When not** — pure unit tests with no DB — they don't need the
  harness. Don't add a test suite that talks to the *dev* DB.
- **See** — `packages/test-infra/`, `e2e/global-setup.ts`,
  `packages/api/scripts/test-runner.ts`, `e2e/CLAUDE.md`.

### Dev-mode swappable transports

- **What** — Three primitives ship a code-level interface with two
  implementations: a dev/test version with no infra, and a prod version
  backed by external services. Switching is a factory choice, not a
  conditional.

  | Capability | Interface | Dev/test | Prod |
  |---|---|---|---|
  | Realtime fan-out | `Channel` | `MemoryChannel` | `RedisChannel` |
  | Email transport | nodemailer createTransport | Mailpit (`SMTP_URL`) | SES/Postmark (`SMTP_URL`) |
  | Auth session | `SessionProvider` | injected via Storybook/Vitest | `RealSessionBridge` (Better-Auth) |

  When introducing a new external dependency, follow the same pattern:
  define an interface, ship a dev-loop implementation that needs zero
  infra, swap via factory at process boot.

- **When** — adding a new external integration (S3, search, push, …).
  Don't make `make dev` require a cloud account.
- **When not** — for things where a dev fake would diverge dangerously
  from prod semantics (don't fake your own DB).
- **See** — `packages/realtime/src/channel.ts`,
  `packages/email/src/handler.ts`,
  `apps/web/src/features/auth/session-context.tsx`.

---

## Cross-cutting patterns

### Vertical slice (domain group)

- **What** — Features ship as a Gherkin spec → schema → backend (batched
  for the whole domain group) → frontend (per-feature) progression.
  Domain folders mirror `features/` ↔ `domains/` ↔ `e2e/features/` at
  the same `<name>`.
- **See** — root `CLAUDE.md#development-workflow-bdd-first-vertical-slices`,
  `docs/superpowers/specs/2026-04-12-development-cycle-handover.md`.

### Event shape discipline

- **What** — Each realtime event kind is either a **payload event**
  (includes the entity; client patches cache) or a **notification
  event** (bare signal; client invalidates). Never mix within one kind.
- **See** — `docs/conventions.md#event-shape--payload-vs-notification`.

### Env access

- **What** — `process.env` reads live in `@project/env/server` only.
  Downstream code imports a validated `env` constant. Zod defaults
  cover every var so zero-conf boot works without a `.env` file.
- **See** — `packages/env/`, enforced by
  `packages/lint/src/check-env-example.ts`.

### Hook / stories / test siblings

- **What** — Every `use-*.ts` hook in `apps/web` has a sibling
  `.test.ts(x)`. Every component has a sibling `.stories.tsx`. Both
  enforced by `packages/lint/src/check-test-siblings.ts` /
  `check-stories-siblings.ts`; the test allowlist is empty — new hooks
  ship with tests.
- **See** — `.config/allowlists/test-siblings.json` (empty).

### Domain naming symmetry

- **What** — A domain's folder name is identical across web
  (`features/<name>`), API (`domains/<name>`), Gherkin
  (`e2e/features/<name>`), and step defs (`e2e/steps/<name>`).
  Asymmetric-by-design domains (backend-only `auth`, frontend-only
  `mobile-nav`) go in the allowlist inside
  `check-domain-names.ts`.
- **See** — root `CLAUDE.md#cross-layer-naming`.

### Adding a custom lint check

- **What** — Check lives in `packages/lint/src/check-<name>.ts`,
  registers a root script + turbo task with narrow `inputs`, appends
  to `TURBO_LINT_TASKS` in the Makefile. Per-check granularity means
  only your check reruns when its scope changes.
- **Existing checks** — domain-names, no-barrel, server-bind,
  trpc-patterns, test-infra-integrity, feature-emails, duplicate-names,
  no-cwd, test-siblings, stories-siblings, env-example, adrs,
  state-machines, pitch-coverage, scoped-landmarks,
  perspective-boundary. See [`dev-tooling.md#custom-checks`](./dev-tooling.md#custom-checks-packageslintsrccheck-ts)
  for one-line purposes.
- **See** — root `CLAUDE.md#adding-a-linter--adding-a-package-—-the-zero-drift-rules`,
  [`dev-tooling.md`](./dev-tooling.md) for the full lint/format inventory.

---

## Navigation tips for the agent

- **Looking for "how do I wire X?"** — start here, click through to the
  `@project/...` package and its README.
- **Looking for "where does X go?"** — [`package-taxonomy.md`](./package-taxonomy.md).
- **Looking for the design decision behind X?** — [`adrs/`](./adrs/).
- **Looking for the convention on X?** — [`conventions.md`](./conventions.md).
- **Looking for the right test shape?** —
  [`testing-guidelines.md`](./testing-guidelines.md) +
  [`qa-strategy.md`](./qa-strategy.md).
