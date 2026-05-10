---
title: "ADR 0021 — Rate limiting"
status: accepted
date: 2026-04-29
deciders: [denis]
verified_by:
  - packages/rate-limit/src/rate-limit-contract.ts
  - packages/rate-limit/src/rate-limit-service.ts
---

# ADR 0021 — Rate Limiting

## Context

The pre-rewrite `packages/rate-limit/` wrapped
[`rate-limiter-flexible`](https://github.com/animir/node-rate-limiter-flexible)
with two backends: in-memory (dev/test) and Redis (prod). The
Effect-TS rewrite needs a `RateLimiter` Layer with the same
backend-swap shape.

This slot was not in ADR-0009's original deferred list — the
rate-limiter library was assumed to survive — but the Phase 1 design
doc surfaced it as worth a brief explicit ADR for completeness, and
to document why we don't roll a custom limiter inside Effect.

## Options considered

### A — Wrap `rate-limiter-flexible` behind a `RateLimiter` Layer

A `RateLimiter` `Context.Tag` exposes `consume(key, points)`. The
`Live` implementation delegates to `RateLimiterMemory` or
`RateLimiterRedis` based on environment. Each `consume` call wraps a
Promise in `Effect.tryPromise` and tags the rejection as
`RateLimitExceededError` (with `msBeforeNext`).

Pros: `rate-limiter-flexible` has battle-tested implementations of
sliding window + token bucket + leaky bucket, distributed
coordination via Redis Lua scripts (exactly-once semantics across a
horizontally-scaled cluster), and built-in support for blocking,
penalty, and reward strategies. Reimplementing any of this inside
Effect is busywork at best, foot-gun at worst.

Cons: standard wrap-a-Promise pattern; the Layer has to either route
internally based on env (one `Live` with two branches) or expose
`MemoryLive` and `RedisLive` and let the consumer pick.

### B — Roll a rate limiter inside Effect using `Schedule` + a
`SubscriptionRef` for state

Build a sliding-window limiter using `Effect.Ref` (or
`SubscriptionRef`) for the bucket state and `Schedule` for the refill
cadence. End-to-end Effect, no external library.

Pros: zero-adapter; one mental model.

Cons: re-implements logic that already exists in
`rate-limiter-flexible`; no distributed-coordination story without
additional infrastructure (Effect doesn't know about Redis Lua
scripts); easy to get the edge cases wrong (token-vs-window
semantics, penalty handling, race conditions under burst load); the
in-memory path would work but the Redis path would need to
re-implement the library's Lua scripts. This is the kind of
"thin down with Effect" instinct that *doesn't* apply — the library
isn't unnecessary; it's load-bearing primitives.

## Decision

**Pick A — wrap `rate-limiter-flexible` behind a `RateLimiter`
Layer.** Expose `RateLimiterMemoryLive` and `RateLimiterRedisLive`
as separate Layers; the prod Layer composition picks Redis, the test
Layer composition picks Memory.

Single `consume` API on the Tag. Tagged error
`RateLimitExceededError` carries `msBeforeNext` so call sites can
return a 429 with a `Retry-After` header.

## Consequences

### Positive
- Distributed-coordination correctness is the library's problem, not
  ours
- Memory backend for tests gives predictable limits without Redis
  dependency
- Layer-swap pattern matches the rest of the rewrite (same shape as
  `Db`, `Mailer`, etc.)

### Negative
- One more wrap-a-Promise Layer (acceptable — third in the
  "wrap rather than replace" tier alongside Mailer + DB)
- `rate-limiter-flexible` is a ~7-year-old library; healthy but worth
  monitoring for dormancy

### Neutral
- Existing rate-limit middleware semantics from `capabilities.md`
  preserved
- Redis dependency unchanged (already required for BullMQ per ADR
  slot 0015)

## Promotion (Phase 4)

- [x] Move file to `docs/adrs/0021-rate-limiting.md`
- [x] Flip `status: proposed` → `status: accepted`
- [x] Fill `verified_by:` with `packages/rate-limit/src/rate-limit-contract.ts`
      and `packages/rate-limit/src/rate-limit-service.ts`
- [x] `// ADR-0021` cite present in those files

## References

- ADR-0009 — full rewrite onto Effect-TS (parent ADR)
- `rate-limiter-flexible`: https://github.com/animir/node-rate-limiter-flexible
- `docs/capabilities.md` §"Rate limiting" — contract preserved
- Redis Lua-script-based atomic operations: https://redis.io/docs/latest/develop/interact/programmability/eval-intro/
