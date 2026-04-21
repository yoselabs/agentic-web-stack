# packages/realtime — Channel Abstraction + Derived State

Realtime fan-out primitives. Two independent concerns live here:

1. **Server → client channels** (`channel.ts`, `memory-channel.ts`,
   `redis-channel.ts`, `user-inbox.ts`) — publish/subscribe with a
   memory backend for dev/tests and a Redis backend for prod. Event
   contracts are domain-owned in `packages/api/src/domains/<name>/events.ts`.
2. **Client-derived state** (`derived.ts`) — "client knows first, server
   eventually agrees" primitive for presence, typing, cursors, drafts,
   focus. Built on `useSyncExternalStore` + `BroadcastChannel` +
   `navigator.locks` (leader-tab drives `compute()`, passive tabs
   subscribe).

## Exports

- `@project/realtime/channel` — `Channel` interface + `ChannelFactory`.
- `@project/realtime/memory` — `MemoryChannelFactory` (dev + test default).
- `@project/realtime/redis` — `RedisChannelFactory` (prod).
- `@project/realtime/types` — event shape helpers.
- `@project/realtime/user-inbox` — per-user cross-feature notification
  channel (sidebar counters, access grants, etc.). See ADR-0001.
- `@project/realtime/derived` — `createDerivedSource()` +
  `MockDerivedSource` for tests. **Infrastructure** — no template hook
  consumes it yet; motivating consumer is `useSelfPresence`, lands with
  the chat domain. See `docs/conventions.md` §
  "Client-derived state via @project/realtime/derived".

## Adding a channel — `src/channels/<name>.ts`

Most domain channels don't need their own file — they key off the generic
`Channel` keyed by domain + resource id (e.g. `todo-list:<id>`). Create
a dedicated file only when the channel has custom helpers (the user-inbox
channel is the reference — it encapsulates "per-user notification bus"
so domains don't hand-roll user-keyed publishes).

1. `src/channels/<name>.ts` exports a typed wrapper over the generic
   `Channel`.
2. Add the subpath to `package.json` exports:
   `"./channels/<name>": { "default": "./src/channels/<name>.ts" }`.
3. Event kinds tuple + derived type go in the owning domain
   (`packages/api/src/domains/<name>/events.ts`), not here — the channel
   is transport, the contract is domain.
4. Unit-test by injecting `MemoryChannelFactory` — see
   `packages/api/src/domains/todo-list/__tests__/todo-service-publishes.test.ts`.

## Rules

- Subpath-only exports (enforced by `check-no-barrel`).
- Never import `@project/realtime/redis` directly from request-path code
  — go through the `Channel` abstraction so tests can swap in Memory.
- Event-kind SSOT lives in the domain's `events.ts` — a `const tuple` +
  `type X = (typeof tuple)[number]`. Don't declare the type separately.
  See `docs/conventions.md` § "Event kinds SSOT".
- `derived.ts` is client-only — the primitive's server story is "leader
  tab writes" and that's the consumer's responsibility inside `compute`.
