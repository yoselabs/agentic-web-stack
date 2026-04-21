# Project Conventions

Canonical cross-cutting conventions. Read the relevant section before
writing code that touches the area. CLAUDE.md files link back to specific
sections here.

## Realtime event naming

Every realtime event kind MUST start with its owning domain — the domain
whose service emits it. Examples:

- `todo-created`, `todo-updated`, `todo-deleted` (todo domain, single-item)
- `todos-reordered`, `todos-imported` (todo domain, bulk)
- `todo-list-updated`, `todo-list-collaborator-added` (todo-list domain)

**Pluralization rule.** Single-item mutations use singular
(`todo-created`); bulk mutations that span multiple items atomically use
plural (`todos-reordered`, `todos-imported`). This mirrors the server's
payload shape — singular events carry one entity, plural events carry an
array.

Events may ride on a channel owned by a *different* domain (e.g.,
`todo-created` publishes on `todo-list:{listId}`); the prefix refers to
the emitter, not the transport. This keeps log lines, subscription
inspection, and grep output self-describing when multiple domains
multiplex over one WebSocket.

The channel-key namespace already disambiguates at the wire level (each
tRPC subscription has a typed return union). The prefix is a
code-readability convention — nice-to-have, not architecturally
load-bearing.

## Event shape — payload vs notification

**Payload-shaped events** carry the full post-commit entity (or the delta
needed to patch client cache). Client handlers use `setQueryData`, no
refetch on the hot path. Use for high-frequency, cache-patchable
mutations.

**Notification-shaped events** carry only identifiers; client handlers
`invalidateQueries` and refetch. Use when payload isn't trustworthy for
the consumer's decision (authz-cascading events like
`collaborator-removed`) or when the mutation is rare (metadata updates).

Each event kind picks one shape at design time and commits to it. Mixing
shapes within one kind (sometimes payload, sometimes id-only) breaks the
handler contract.

## Event kinds SSOT

For each domain's event union, the list of kinds lives as a `const` tuple
with the event type derived from it:

```ts
export const DOMAIN_EVENT_KINDS = ["kind-a", "kind-b"] as const;
export type DomainEventKind = (typeof DOMAIN_EVENT_KINDS)[number];
export type DomainEvent =
  | { kind: "kind-a"; listId: string }
  | { kind: "kind-b"; listId: string; itemId: string };
```

Reasoning: a runtime array is needed for relay type-guards and dispatch
maps; deriving the type from the array (not the other way around) means
adding a kind without updating the tuple produces a compile error at
every exhaustive consumer.

Reference implementation: `packages/api/src/domains/todo-list/events.ts`.

## Realtime channel granularity

Two channel patterns in this codebase:

- **Per-entity channel** (`<entity>:<id>`) — focused single-entity
  collab with low event rates and static authz. Subscribers open/close
  on mount/unmount of the entity view. Reference:
  `packages/api/src/domains/todo-list/` (channel `todo-list:<listId>`).

- **User-inbox channel** (`user:<userId>`) — persistent cross-feature
  UI surfaces (dashboard counters, sidebar unread, access revocations,
  presence). One subscription per user; server fans out on publish;
  authz enforced at publish time. Reference:
  `packages/api/src/domains/user/`.

Default to per-entity. Add user-inbox alongside it when a domain needs
a cross-feature UI surface that outlives any single entity view.

Rationale, Live+Snapshot reconciliation, watermark-based gap detection
for ordered payload events — see [ADR-001](adrs/0001-realtime-architecture.md).

## Timestamps on models

Every application-owned model has:

- `createdAt DateTime @default(now())`
- `updatedAt DateTime @updatedAt`

Join/link tables included (they represent edges that can be updated).
Better-Auth-owned tables follow Better-Auth's schema.

## Realtime event naming — pluralization (addendum)

The existing pluralization rule (singular for single-item payloads,
plural for bulk payloads) governs **payload-shape** events.
**Notification-shape** events carry no entity; pluralize when the event
describes change to an aggregate collection (`todo-list-counters-changed`,
`todo-list-invites-changed`), singular when it describes a single
conceptual event (`todo-list-access-granted`).

## Aggregation modules (integration surfaces)

Some modules aggregate contributions from every feature in the codebase.
When you ship a new feature or capability, walk this list and ensure
every applicable surface is updated — the type system does not catch
every omission.

| Surface | File | Update when … |
|---|---|---|
| Top-level navigation | `apps/web/src/widgets/navbar.tsx` | Feature adds a user-facing route |
| tRPC router registry | `packages/api/src/router.ts` | New domain router added (insert alphabetically) |
| User-inbox event SSOT | `packages/api/src/domains/user/user-events.ts` | Domain emits cross-feature realtime events |
| Per-domain event SSOT | `packages/api/src/domains/<name>/events.ts` | New event kind within a domain |
| Package subpath exports | `packages/<pkg>/package.json` `"exports"` | New file meant to be imported from another package |
| Prisma schema split | `packages/db/prisma/schema/<domain>.prisma` | New domain with its own models |
| Cross-layer naming allowlist (lint) | `scripts/check-domain-names.ts` | New asymmetric-by-design domain (backend-only or frontend-only) |
| Auth-gated layout | `apps/web/src/routes/_authenticated/` | Route requires sign-in |

Enforcement ladder: rows marked "(lint)" are caught by `make lint`; the
rest are discipline + code review.

**Meta-rule.** If you introduce a new aggregation module — any file or
registry other features will plug into — add a row to this table in the
same commit that introduces it. This keeps the list authoritative and
prevents silent plug-in points from accumulating.

## Test-mode detection

Runtime code that needs to branch on "am I running under the test
harness?" reads `env.IS_TEST` from `@project/env/server`. Never read
`process.env.NODE_ENV`, `process.env.VITEST`, or `process.env.TEST_MODE`
directly — `@project/env` is the only module allowed to touch
`process.env` (enforced by `make lint`).

`env.IS_TEST` is a derived boolean. It's true when either of:

1. `process.env.VITEST === "true"` — set natively by Vitest / `bun test`.
   Primary signal for unit/integration runs. The runner sets this; the
   test harness does not.
2. `process.env.TEST_MODE === "1"` — set ONLY by the Playwright harness
   when spawning the web + API servers under test. Wired through
   `envForSubprocess(suite, role?)` in `@project/test-infra`, which
   Playwright's `webServer` env blocks and any test-side subprocess
   launcher spread into the child process env.

**Why not overload `NODE_ENV=test`?** Vite's SSR build flips `jsxDEV`
imports on `NODE_ENV`. Setting it to `"test"` breaks the built web
bundle that the e2e suite serves via Nitro. The split — `VITEST` for
Vitest, `TEST_MODE` for e2e, `NODE_ENV` only for dev/prod — keeps the
build graph consistent while still giving runtime code a single boolean
to branch on.

**`NODE_ENV=test` is a hard error.** The Zod schema in
`packages/env/src/server.ts` accepts only `"development" | "production"`.
Anyone setting `NODE_ENV=test` gets a loud boot-time failure instead of
a silent test-mode flip. Client-side / Vite SSR code should never reach
`env.IS_TEST` either; test-mode branching is a server-only concern.
