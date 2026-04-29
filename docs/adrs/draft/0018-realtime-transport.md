---
title: "ADR 0018 — Realtime transport (proposed, spike pending)"
status: proposed
date: 2026-04-29
deciders: [denis]
draft_for_promotion_in_phase: 4
spike_status: pending — runs when realtime capability returns in Phase 4 walk
---

# ADR 0018 — Realtime Transport

> **Spike pending.** Original plan called for a ≤4h spike — server-side
> `@effect/platform` Socket emitting events on a schedule + browser
> ws client consuming them, end-to-end. Realtime is **not** in the
> Phase 3 first slice (auth + todo-list), so this spike runs when
> Phase 4 reaches the realtime capability in `docs/capabilities.md`.
> Until then this ADR captures the default lean and the spike scope.

## Context

The pre-rewrite `packages/realtime/` exposed a `Channel` abstraction
with two backends:
- `MemoryChannel` (single-process, dev/test)
- `RedisChannel` (production, multi-process via Redis pub/sub)

ws upgrade lived in `apps/server/` (path-prefix-disciplined per
ADR-0008). Activity-feed used a hand-rolled gap-fill+live+dedup
stream (capabilities.md composition #5).

The Effect rewrite has access to:
- `@effect/platform` `Socket` and `Stream` primitives
- `Effect.Stream` for structured concurrency over event sequences

The question: keep ws + custom Channel (wrapped in a Layer), or
rebuild on `@effect/platform/Socket` + `Effect.Stream` end-to-end?

## Options considered

### A — Keep ws + custom Channel, wrap in a `Channel` Layer

`Channel` `Tag` exposes `subscribe(topic)`, `publish(topic, event)`.
`Live` wraps the existing `MemoryChannel` / `RedisChannel`. Server
ws upgrade stays Hono/Bun-style; events serialized to JSON.

Pros: minimal change to a working pattern. Realtime is the *most*
load-bearing capability and the existing implementation has been
shaken out across activity-feed, todo collaboration, user inbox.

Cons: AbortController + manual fan-out + dedup logic stays
hand-rolled inside handlers. The ergonomic wins ADR-0009 promised
(structured concurrency replacing the activity-feed stream) don't
land unless we go further.

### B — Rebuild on `@effect/platform/Socket` + `Effect.Stream`

Server ws is `@effect/platform/Socket`. Subscriptions are
`Effect.Stream<Event, ChannelError, R>`. Activity-feed gap-fill+
live+dedup composed via `Stream.zipLatest` + `Stream.mapAccum` +
`Stream.dedupe`. Reconnection driven by `Effect.Schedule` instead
of manual setTimeout.

Pros: structured concurrency replaces three ad-hoc patterns at once
(activity-feed stream, channel init race, retry policy). Cancellation
is automatic via Effect's interruption model. Multiplexing many
topics on one socket composes naturally with `Stream.merge`.

Cons: bigger rewrite per realtime call site. Browser ws client side
needs to be rebuilt to consume `Stream`-shaped data (likely
`@effect/rx` integration per ADR slot 0016 decision C). Less
battle-tested than ws.

## Decision (proposed, default lean)

**Pick B — `@effect/platform/Socket` + `Effect.Stream`**, conditional
on the Phase 4 spike confirming all of:

1. Server `@effect/platform/Socket` accepts an upgrade from a browser
   ws client cleanly (sanity check; both speak ws protocol)
2. `Effect.Stream` reconstruction of the activity-feed gap-fill+live+
   dedup pattern is at most 50% the LOC of the current ad-hoc
   implementation (genuine ergonomic win, not just shape change)
3. Browser-side `@effect/rx`-based subscription hook works at parity
   with the current React-Query-style subscription hooks (no
   re-render storms, predictable cleanup on unmount)

If any fails, fall back to **A** (wrap existing Channel in a Layer).
Realtime is too load-bearing to break for ergonomics.

## Consequences

### Positive (if B confirmed)
- Three ad-hoc concurrency patterns from `capabilities.md`
  (compositions #3, #5, partially #4) collapse into Effect-native
  primitives
- Structured cancellation eliminates a class of leak bugs
- Activity-feed stream is the headline win — it's the most complex
  realtime composition in the codebase

### Negative (if B confirmed)
- Browser bundle gains `@effect/platform/Socket` runtime (size TBD
  in spike; relevant to ADR slot 0014 bundle envelope)
- Two ws implementations on the client during transition
  (TanStack Query side + Effect Stream side, briefly)

### Neutral / preserved
- `MemoryChannel` / `RedisChannel` semantics survive — they become
  the `Live` backends of the new `Channel` Layer
- Path-prefix discipline from ADR-0008 unchanged

## Promotion checklist (Phase 4 — when realtime returns)

- [ ] Confirm spike outcomes 1, 2, 3 above
- [ ] Activity-feed stream rebuilt with `Effect.Stream`; LOC measured
- [ ] Browser subscription hook tested for re-render correctness
- [ ] Move file to `docs/adrs/0018-realtime-transport.md`
- [ ] Flip `status: proposed` → `status: accepted`
- [ ] Fill `verified_by:` with the realtime Layer module path +
      activity-feed stream module path + browser subscription hook
- [ ] Add `// ADR-0018` cites
- [ ] Cross-reference ADR-0008 (websocket path-prefix discipline)
- [ ] Cross-reference ADR slot 0011 (HTTP framework — ws upgrade
      lives at the server HTTP boundary)

## References

- ADR-0009 — full rewrite onto Effect-TS
- ADR-0008 — websocket path-prefix discipline (preserved)
- `@effect/platform/Socket`: https://effect.website/docs/platform/socket
- `Effect.Stream`: https://effect.website/docs/streams/introduction
- `docs/capabilities.md` §"Realtime stack composition" — contract
- `docs/capabilities.md` §"Activity feed gap-fill + live + dedup" —
  the headline test for whether structured concurrency wins
