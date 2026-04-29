---
title: "ADR 0017 — Logger (proposed)"
status: proposed
date: 2026-04-29
deciders: [denis]
draft_for_promotion_in_phase: 3
---

# ADR 0017 — Logger

## Context

The pre-rewrite stack used `pino` for structured JSON logging in the
server + worker, with per-request logger child instances threaded
through Hono middleware and BullMQ job context. The Effect-TS
rewrite needs to decide: keep pino wrapped behind a `Logger` Layer,
or replace with Effect's built-in `Logger`?

This slot was NOT in ADR-0009's original deferred-ADR list — pino was
assumed to survive — but the Phase 1 design doc surfaced it as a real
decision now that the runtime substrate is Effect.

## Options considered

### A — Keep pino, wrap in a `Logger` Layer

A `Logger` `Context.Tag` exposes the standard log methods. The
`Live` implementation delegates to a pino instance.

Pros: pino is fast and mature; structured JSON output is rock-solid;
ecosystem of pino transports (file rotation, datadog, etc.) is large.

Cons: pino's child-logger-per-request pattern doesn't compose
naturally with Effect's `Layer` — you'd be re-creating a child logger
in each request scope, or threading it through `FiberRef`. The result
is a Layer that mostly just shows you how Effect's own primitives
would have done the same thing better. You're paying integration tax
for ergonomics you'd already have natively.

### B — Replace pino with Effect's built-in `Logger`

Effect's `Logger` API integrates with `Effect.log`, span context,
`FiberRef.locally` for scoped log levels, and `Layer`-based
configuration. Output formatters are pluggable (JSON, prettyprint,
custom). The standard idiom:

```ts
program.pipe(
  Effect.annotateLogs("requestId", req.id),
  Effect.withLogSpan("handle-request"),
  Effect.provide(Logger.json),
);
```

Pros: zero-adapter; spans + log annotations + log levels all flow
through the same Effect machinery as the rest of the code;
`@effect/platform`'s HTTP middleware already adds request context
into log lines automatically.

Cons: ecosystem of sinks is smaller (no pino-datadog, no
pino-loki). For external sinks you'd write a custom formatter or
forward to OpenTelemetry (which is the modern path anyway).

## Decision (proposed)

**Pick B — replace pino with Effect's built-in `Logger`.**

This is the strongest case for "Effect everywhere it operates" (Q4):
logging is exactly the kind of cross-cutting concern that benefits
from `Layer`/`FiberRef` composition. The pino integration tax buys
nothing the Effect Logger doesn't already provide more naturally.

Configuration:
- **Dev**: `Logger.prettyLogger` for human-readable lines with colors
- **Prod**: `Logger.json` for structured JSON (downstream-tooling
  compatible, same shape pino was producing)

## Open sub-decision: OTel exporter Layer

Whether to ship an `@effect/opentelemetry` `Logger` exporter Layer
in this rewrite, or defer to Phase 4's observability capability.

Lean: **defer to Phase 4**. The first slice (Phase 3) only needs
console output for dev and JSON for prod. OTel adoption is its own
capability decision (which collector? which backend? sampling
strategy?) and shouldn't be folded into the Logger ADR.

## Consequences

### Positive
- One mental model: `Effect.log` everywhere, span context auto-propagated
- `FiberRef.locally` enables per-route log level overrides without
  a separate middleware
- Test ergonomics — `Logger.test` collects log output for assertion
  without touching console

### Negative
- Lose pino's transport ecosystem; need a custom Layer for any sink
  beyond stdout (acceptable — the OTel exporter Layer covers most
  modern sinks)
- One more Effect API to learn for engineers new to the stack

### Neutral
- Log format on disk doesn't change (still JSON in prod)
- Existing log-aggregation pipelines (if any deployed) keep working

## Promotion checklist (Phase 3)

- [ ] Move file to `docs/adrs/0017-logger.md`
- [ ] Flip `status: proposed` → `status: accepted`
- [ ] Fill `verified_by:` with the Logger Layer module path (likely
      `apps/server/src/logger.ts` or `packages/logger/src/index.ts`)
- [ ] Add `// ADR-0017` cite in that file
- [ ] Drop pino from `pnpm-workspace.yaml` catalog if not already done
      by Phase 1 cleanup

## References

- ADR-0009 — full rewrite onto Effect-TS (parent ADR)
- Effect `Logger` reference: https://effect.website/docs/observability/logging
- Effect `FiberRef` reference: https://effect.website/docs/state-management/fiberref
- `docs/capabilities.md` §"Structured logging" — contract preserved
