# Capabilities — Agent Menu

A catalog of **reusable primitives already shipped** in this template.
Read this before writing new code: most "I need to handle X" questions
have an existing answer here.

Complement to [`package-taxonomy.md`](./package-taxonomy.md) — that file
answers *"where does new code go?"*; this one answers *"what can I
already use?"*.

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
  Don't pick thresholds by guess; borrow from the reference consumer.
- **See** — `todoList.create` reference.

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
- **See** — root `CLAUDE.md#adding-a-linter--adding-a-package-—-the-zero-drift-rules`.

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
