---
title: "ADR 0016 — Frontend Effect adoption (proposed, optional spike)"
status: proposed
date: 2026-04-29
deciders: [denis]
draft_for_promotion_in_phase: 3
spike_status: optional — first-slice frontend hooks ARE the spike
---

# ADR 0016 — Frontend Effect Adoption

> **Spike not separately required.** Original plan offered a ≤2h
> spike feeling out `@effect/rx` ergonomics. The first slice's
> frontend (auth + todo-list) writes ~3-5 client-side data hooks —
> that's the spike, just folded into the slice. Promotion criteria
> describe the per-feature signal for `@effect/rx` vs TanStack Query.

## Context

Phase 1 design Q4 locked the headline answer: **100% Effect
commitment** on the client, not just the server. But the
*mechanism* was deliberately deferred to this ADR because the
client-side trade-off is more nuanced than the server-side one.

Two state primitives compete on the React client:
- `@effect/rx` — Effect-native reactive state, integrates with
  React via `useRx`/`useRxValue`/`useRxSet` hooks
- TanStack Query — battle-tested cache + mutation primitives, deep
  integration with TanStack Router/Form/Table

ADR slot 0012 picked tRPC + `runEffect` adapter for the RPC layer,
which means client RPC calls return Promises (TanStack Query's
native idiom) — using `@effect/rx` for those would re-wrap each
Promise in an Effect just to use `useRxValue`. Pointless.

But for *non-RPC* client state — local-first composition, multi-step
form flows, AbortController-style cancellation, scheduled retry on
WebSocket disconnect — `@effect/rx` offers genuine wins TanStack
Query doesn't.

## Options considered

### A — `@effect/rx` everywhere on the client

All client state, including RPC results, flows through `@effect/rx`.
TanStack Query is dropped.

Pros: maximally consistent with Q4.

Cons: re-wraps tRPC Promises pointlessly; loses TanStack Query's
cache-invalidation primitives (devs would re-implement them in rx);
no integration with TanStack Router's loader/action patterns.

### B — TanStack Query everywhere on the client

Effect lives on the server only (despite Q4). Client stays Promise-
shaped.

Pros: smallest cognitive load.

Cons: contradicts Q4 directly.

### C — Split per data shape: TanStack Query for RPC + cache,
`@effect/rx` for composed/streamed/realtime state

- **TanStack Query** for: tRPC procedure results + cache
  invalidation + optimistic mutations + TanStack Router loader/action
  integration. The data this primitive was built for.
- **`@effect/rx`** for: realtime channel subscriptions + composed
  multi-step flows + `Stream`-shaped data + anywhere you want
  `Schedule`-driven retry/refresh logic on the client

Each feature picks per state shape. The decision is local to the
feature, not global.

Pros: each primitive used where it's best; honest about what each
tool does well; matches the Q4 "100% Effect *where it operates*"
reading.

Cons: two primitives to learn; per-feature decision needed (mitigated
by clear examples in the slice).

## Decision (proposed, default lean)

**Pick C — split per data shape.**

The Phase 3 first slice establishes the pattern for both:
- TanStack Query example: todo list query + create/delete mutations
- `@effect/rx` example: at least one realtime subscription (for the
  todo-list collaborator presence indicator OR the activity feed)
  written with `@effect/rx`'s `Stream`-backed state

If the slice surfaces that `@effect/rx` is consistently friction-laden
(e.g., the React-bridge causes re-render storms or the API is too
unfamiliar to use without paging through docs every time), fall back
to **B** (TanStack Query everywhere) and accept that "100% Effect
ideology" stops at the RPC boundary on the client.

## Consequences

### Positive (if C confirmed)
- Each tool used where it shines; no wasted wrapper code
- Cache-invalidation patterns from `docs/capabilities.md` survive
  unchanged for the RPC half
- Realtime + composed flows get Effect's structured concurrency
  benefits

### Negative (if C confirmed)
- Two primitives in one frontend; needs a clear convention doc in
  `apps/web/CLAUDE.md`
- Edge cases where data is "kind of both" (e.g., a query whose value
  feeds into a real-time stream) need a per-case judgment

### Neutral
- Bundle impact dominated by ADR slot 0014 (schema lib), not the
  state lib
- React 19, TanStack Router, TanStack Form unchanged

## Promotion checklist (Phase 3)

After the first slice's frontend lands:

- [ ] Confirm at least one TanStack Query usage (an RPC query +
      mutation pair)
- [ ] Confirm at least one `@effect/rx` usage (a realtime
      subscription or composed flow)
- [ ] Document the convention in `apps/web/CLAUDE.md` ("when to use
      which") — concrete examples, not principles
- [ ] If the `@effect/rx` example was genuinely awkward, retroactively
      flip to decision B and record why in §"Spike findings"
- [ ] Move file to `docs/adrs/0016-frontend-effect-adoption.md`
- [ ] Flip `status: proposed` → `status: accepted`
- [ ] Fill `verified_by:` with one TanStack Query usage path + one
      `@effect/rx` usage path
- [ ] Add `// ADR-0016` cite at both

## References

- ADR-0009 — full rewrite onto Effect-TS
- Phase 1 design doc Q4 — 100% commitment
- ADR slot 0012 (RPC) — tRPC + adapter, drives TanStack Query staying
- ADR slot 0014 (Schema) — bundle constraint shared with this ADR
- `@effect/rx` docs: https://github.com/tim-smart/effect-rx
- TanStack Query: https://tanstack.com/query
