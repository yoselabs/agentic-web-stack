---
title: "ADR 0015 — Background job queue"
status: accepted
date: 2026-04-30
deciders: [denis]
verified_by:
  - packages/jobs/src/queue-layer.ts
  - packages/jobs/src/process-job.ts
  - apps/worker/src/index.ts
---

# ADR 0015 — Background Job Queue

> **Accepted (Phase 4 capability #1).** BullMQ wrapped behind a `Queue`
> Effect Layer (`Layer.scoped` — opens BullMQ Queue instances at boot,
> closes on scope release). Worker handlers are
> `Effect<unknown, unknown, R>` connected to BullMQ via `processJob`.
> Retry composition deferred to handler-level `Effect.Schedule` per
> §Decision A. Bull Board mount moved to capability #7 (CASL + admin
> role) — see §Spike findings below and the Phase 4 plan's "Mid-walk
> revisions" §.

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

## Promotion checklist (closed)

- [x] Move file to `docs/adrs/0015-queue.md`
- [x] Flip `status: proposed` → `status: accepted`
- [x] Fill `verified_by:` with `packages/jobs/src/queue-layer.ts`,
      `packages/jobs/src/process-job.ts`, `apps/worker/src/index.ts`
- [x] Add `// ADR-0015` cites in those files

## Spike findings (Phase 4 capability #1)

**`Queue` Layer shape.** `QueueTag` is a single Context.Tag exposing
`enqueue`, `schedule`, `cancel`, and a `raw()` escape hatch. `QueueLive`
is `Layer.scoped` — `buildQueues()` opens one BullMQ Queue per name in
`QUEUE_NAMES` (the SSOT) at scope-acquire and closes them all on
scope-release. Test isolation is straightforward: provide an in-memory
implementation as a different Layer that satisfies the same tag.

**Retry composition lives at the handler.** `Effect.Schedule` inside
the handler Effect is the ergonomic win the wrapper enables — handlers
compose their own policies (`Schedule.exponential` +
`Schedule.jittered` + `Schedule.upTo`) instead of declaring
`{ attempts, backoff }` on the queue. BullMQ's job-level retry is
intentionally untouched (default `attempts: 1`); BullMQ only sees a
job as failed when the Effect's outermost retry surface gives up,
which then surfaces in Bull Board's Failed tab and the dead-letter
queue.

**`processJob` adapter.** `processJob({ queue, handlers, runtimeLayer })`
builds a BullMQ Worker that dispatches `job.name` to a registry of
`Effect<unknown, unknown, R>` handlers, providing the runtimeLayer
(typically `AppLayer` — Db + Auth + Logger) per call. Failures are
formatted via `Cause.pretty` and rethrown so BullMQ's retry/dead-letter
machinery still fires. Tagged failures, defects, and interrupts surface
uniformly in worker logs.

**One concrete cron shipped.** `purge-stale-todos` runs at 03:00 daily,
deleting completed todos with `updatedAt` older than 30 days.
Idempotent registration via BullMQ's `repeat` + stable `jobId`. Smoke
test: worker boot logs the registration + start; the repeatable job
lands in `bull:maintenance:repeat:*` in Redis.

**Bull Board: deferred to capability #7.** Original plan placed the
mount in capability #1, but the mount is dev-tooling only useful
behind an admin-role gate, and capability #7 (CASL + admin role) is
the natural home. The `QueueTag.raw()` method exposes the underlying
BullMQ Queue map for the future mount to consume — no rework needed
on the queue side. ADR-0011 §Spike findings outcome 2 closes when
capability #7 lands. See Phase 4 plan §"Mid-walk revisions".

**Email queue: declared, no consumer.** `EMAIL_QUEUE` is in
`QUEUE_NAMES` so `QueueLive` opens it at boot, but no worker consumes
from it yet. `@project/email` lands in capability #2 with its handler.
Enqueueing without a consumer is fine (jobs queue up; nobody enqueues
yet either).

## References

- ADR-0009 — full rewrite onto Effect-TS (parent ADR)
- BullMQ docs: https://docs.bullmq.io
- Effect `Schedule` reference: https://effect.website/docs/scheduling/introduction
- `@effect/cluster` (early-stage): https://github.com/Effect-TS/effect/tree/main/packages/cluster
- `docs/capabilities.md` §"Background jobs" — the contract this ADR preserves
