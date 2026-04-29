---
title: "ADR 0012 — RPC layer"
status: accepted
date: 2026-04-29
deciders: [denis]
verified_by:
  - packages/api/src/trpc.ts
  - packages/api/src/runtime/run-effect.ts
  - packages/api/src/router.ts
---

# ADR 0012 — RPC Layer

## Context

The Effect-TS rewrite needs a procedure-call abstraction between the
TanStack Start frontend and the backend services. Pre-rewrite this was
tRPC v11 (with Better-Auth contexts and Zod-validated inputs). The
question for Phase 2: keep tRPC v11 with a `runEffect` adapter at each
procedure body, or replace with `@effect/rpc` end-to-end?

Per the Phase 1 design doc (Q4) the rewrite is "100% commitment to Effect
ideology" wherever Effect operates — but Q5b research established that
the floor includes TanStack Start (the meta-framework), and the same
research revealed the actual state of `@effect/rpc`.

## Options considered

### A — Keep tRPC v11 with a `runEffect` adapter at the procedure body

Each procedure stays a tRPC procedure (familiar shape, type inference
already wired into TanStack Start `createServerFn` and React Query).
The procedure body is a one-line adapter that runs an `Effect` and
maps tagged errors to `TRPCError`:

```ts
export const todoRouter = router({
  create: protectedProcedure
    .input(CreateTodoSchema)
    .mutation(({ input, ctx }) =>
      runEffect(createTodo(input).pipe(Effect.provide(ctx.layers))),
    ),
});
```

Pros: zero learning curve for tRPC consumers, integrates cleanly with
React Query on the client (no parallel state primitive needed),
preserves existing tooling (Bull Board mount, Better-Auth handler,
Vite SSR loader bridges).

Cons: one adapter at every procedure boundary; tagged errors must be
re-thrown as `TRPCError` for the client (loses some type information);
two mental models exist (Effect on the server inside the procedure,
Promise outside).

### B — Replace with `@effect/rpc` end-to-end

Procedures themselves return `Effect<A, E, R>`. Client and server share
the schema; tagged errors flow naturally end-to-end. No adapter layer.

Pros: maximally consistent with the "100% Effect" stance, end-to-end
typed errors on the client, removes the `runEffect` boilerplate
entirely.

Cons (per Q5b research, 2026-04-28):
- `@effect/rpc` is still **0.75.x** with continuous API churn (last
  publish ≤3 days before research)
- **No documentation on the official Effect website** (
  https://effect.website lists no `@effect/rpc` page)
- ~51 npm dependents; ecosystem-thin
- Active reproducible bug: `bohdanbirdie/repro-effect-rpc-msgpack-cf-workers`
  (msgpack serialization silently failing on Cloudflare Workers, Apr 2026)
- Tom MacWright's *"Effect notes: tRPC"* (Jan 2026):
  *"@effect/rpc is still on a 0.x release and has no documentation at
  all on the Effect website, so for now, people are going to use tRPC
  instead."*
- The shipping `effect + tanstack/start` repos surveyed in the research
  (kevin-courbet/tanstack-effect-example, lelabo-m/lister) BOTH use
  `@effect/rpc` *behind* a single tRPC-style gateway, not as the
  procedure layer. Even the early adopters wrap it.

## Decision (proposed)

**Pick A — keep tRPC v11 with a `runEffect` adapter at the procedure
body.**

The decision reverses ADR-0009's *original* default lean ("Keep tRPC")
in spirit (the rewrite still keeps tRPC) but for a different reason:
not migration cost, but ecosystem readiness. `@effect/rpc` will be
revisitable in Phase 5+ once it stabilizes (1.0 release, official
docs, removed from the "experimental" framing).

The `runEffect` helper is one file (`packages/api/src/run-effect.ts`,
~30 lines): builds the per-request Layer, runs the Effect, maps the
tagged-error union to `TRPCError`. Used by every procedure body. Loss
of client-side tagged-error visibility is acceptable — the client
mostly cares about *which kind* of error (404, 403, 422), which the
TRPCError code preserves.

## Consequences

### Positive
- Zero risk from `@effect/rpc` API churn during the rewrite
- React Query integration on the client stays unchanged (no parallel
  state primitive)
- Better-Auth + Bull Board mounts continue to work via Hono-style
  HTTP boundaries (decided separately in ADR slot 0011)

### Negative
- One adapter call at every procedure body (mitigated by single helper)
- Client-side `TRPCError` loses the typed-error union shape (the *kind*
  of error is preserved via TRPCError's `code` field, but the *payload*
  is stringified)
- Need to revisit when `@effect/rpc` matures — schedule a check at
  Phase 5 ADR review

### Neutral
- Existing `e2e/features/*.feature` Gherkin scenarios don't change
- TanStack Query cache invalidation patterns from
  `docs/capabilities.md` survive unchanged

## Promotion checklist (Phase 3)

- [ ] Move file to `docs/adrs/0012-rpc-layer.md`
- [ ] Flip `status: proposed` → `status: accepted`
- [ ] Fill `verified_by:` with: `packages/api/src/run-effect.ts`,
      `packages/api/src/router.ts` (or whatever the procedure-mount
      file ends up named)
- [ ] Add `// ADR-0012` cite comment to each `verified_by` file

## References

- [Phase 1 design doc — Q5b research summary](../../superpowers/specs/2026-04-28-effect-rewrite-phase-1-design.md#research-tanstack-start-vs-effect-platform)
- ADR-0009 — full rewrite onto Effect-TS (parent ADR)
- Tom MacWright, *Effect notes: tRPC* (Jan 2026): https://macwright.com/2026/01/06/effect-trpc
- `@effect/rpc` on npm: https://www.npmjs.com/package/@effect/rpc
- Reproducible bug: https://github.com/bohdanbirdie/repro-effect-rpc-msgpack-cf-workers
