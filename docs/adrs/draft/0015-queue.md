---
title: "ADR 0015 — Background job queue (proposed)"
status: proposed
date: 2026-04-29
deciders: [denis]
draft_for_promotion_in_phase: 3
---

# ADR 0015 — Background Job Queue

## Context

The pre-rewrite `apps/worker/` ran a BullMQ worker over Redis with
queue definitions in `packages/jobs/`. Job retries were configured
declaratively per queue (`attempts`, `backoff`). The Effect-TS
rewrite needs a queue Layer for the worker process; the question is
whether to wrap BullMQ behind a `Queue` Layer or wait for an
Effect-native queue.

ADR-0009's default lean for this slot was "keep BullMQ — Effect
maintainers explicitly recommend it." The Phase 1 design doc inverted
the lean's *justification* (no migration cost in a from-scratch
rewrite) but not the conclusion (BullMQ remains the only mature
option in 2026).

## Options considered

### A — Wrap BullMQ behind a `Queue` Layer

A `Queue` `Context.Tag` exposes `enqueue`, `schedule`, `cancel`. The
`Live` implementation wraps a BullMQ `Queue` instance. Worker
handlers are written as `Effect<A, E, R>` and connected to BullMQ
via a thin `processJob(handler)` adapter. Retries flow through
`Effect.Schedule` instead of BullMQ's static `attempts`/`backoff`
config — which gives composable retry policies (exponential +
jitter + max-elapsed) inside the Effect call, not in queue
configuration.

Pros: production-proven (BullMQ + Redis is the de-facto standard for
Node), Effect maintainers explicitly recommend this pattern in 2026
docs, retry composition wins are real (Schedule > config), bull-board
admin UI continues to work via its Express middleware (mountable
under `@effect/platform` HTTP via interop layer).

Cons: another wrapper Layer to maintain; Redis is a separate
infrastructure dependency (already required pre-rewrite); BullMQ
itself ships its own concurrency model that doesn't perfectly align
with Effect's Fiber model (each BullMQ worker is a long-lived
process; Effect Fibers run within).

### B — Wait for `@effect/cluster` `ClusterQueue`

`@effect/cluster` is being developed as an Effect-native distributed
runtime, with `ClusterQueue` as a planned primitive for durable
background work. End-to-end Effect; no BullMQ wrapper.

Pros (eventual): zero-adapter Effect, `Schedule`-based retries
native, cluster-aware (no Redis needed for the work-stealing layer
itself once the cluster is deployed).

Cons (current): not production-ready as of April 2026.
`@effect/cluster` is still in active development (last npm publish
within recent weeks; no `ClusterQueue` documented on
https://effect.website/docs/cluster yet). Migrating from a BullMQ
deployment to `ClusterQueue` later is straightforward (handlers stay
as `Effect`; only the Layer implementation changes) — so picking
BullMQ now doesn't lock anything out.

## Decision (proposed)

**Pick A — wrap BullMQ behind a `Queue` Layer.** Use
`Effect.Schedule` for retry composition inside handlers (not BullMQ's
attempts/backoff config). Expose bull-board through whatever HTTP
boundary ADR slot 0011 picks (Hono-style mount or `@effect/platform`
interop).

Schedule a re-evaluation at Phase 5 (or sooner if `ClusterQueue` ships
with documentation + a 1.0 release) — per ADR-0009 §"Implementation
phases" Phase 3 is when the worker is rewritten and this decision
becomes load-bearing.

## Consequences

### Positive
- Production-proven path: BullMQ + Redis + bull-board is the
  template's current stack, just rewrapped
- Retry composition via `Schedule` is the actual ergonomic win we
  wanted from Effect (no more declarative `{ attempts: 3, backoff:
  { type: 'exponential', delay: 1000 } }` — handlers compose their
  own retry policy with `Schedule.exponential` + `Schedule.jittered`
  + `Schedule.upTo`)
- `@effect/cluster` migration path stays open

### Negative
- BullMQ wrapper is one more Layer-maintenance burden
- Two scheduling layers exist conceptually (BullMQ owns *when* a job
  fires; Effect Schedule owns *when to retry within a job*) — needs
  clear docs to avoid "where do I configure that?" confusion
- bull-board Express middleware needs an interop shim for whatever
  ADR slot 0011 picks for HTTP

### Neutral
- Redis dependency unchanged (already in `docker-compose.yml`)
- Job-handler signatures change shape (return `Effect`, not `Promise`)
  but Phase 4 capability-walk handles this per-handler

## Promotion checklist (Phase 3)

- [ ] Move file to `docs/adrs/0015-queue.md`
- [ ] Flip `status: proposed` → `status: accepted`
- [ ] Fill `verified_by:` with `packages/jobs/src/queue-layer.ts` (or
      whatever the wrapper module is named) and `apps/worker/src/index.ts`
- [ ] Add `// ADR-0015` cites in those files

## References

- ADR-0009 — full rewrite onto Effect-TS (parent ADR)
- BullMQ docs: https://docs.bullmq.io
- Effect `Schedule` reference: https://effect.website/docs/scheduling/introduction
- `@effect/cluster` (early-stage): https://github.com/Effect-TS/effect/tree/main/packages/cluster
- `docs/capabilities.md` §"Background jobs" — the contract this ADR preserves
