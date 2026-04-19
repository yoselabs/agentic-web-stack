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
