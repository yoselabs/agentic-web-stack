---
title: "ADR 0014 — Schema validation (proposed, spike pending)"
status: proposed
date: 2026-04-29
deciders: [denis]
draft_for_promotion_in_phase: 3
spike_status: pending — bundle measurement runs as part of first-slice frontend build
---

# ADR 0014 — Schema Validation

> **Spike pending.** The original plan called for a ≤4h spike
> measuring bundle size: representative form schema in both Zod 4
> and Effect Schema, `vite build` on each, compare gzipped output.
> The spike now runs *as part of Phase 3 first-slice frontend
> implementation* — the slice's todo creation form IS the
> representative schema, and `make build` produces the bundle to
> measure. Promotion gate enumerates the bundle threshold below
> which the decision holds.

## Context

The pre-rewrite stack used Zod 4 for input validation on both server
(tRPC procedure inputs) and client (form schemas, TanStack Form
integration). The Effect rewrite needs to decide: keep Zod 4 wrapped
behind helpers, or replace with Effect Schema?

Per Phase 1 design Q4 (100% Effect commitment), the strong-version
answer is "Effect Schema everywhere it operates." But the Phase 1
design doc explicitly flags client-side bundle cost as the load-bearing
constraint — Effect Schema's tree-shaking has known gaps (Effect issues
\#5967, \#5317), with baseline ~30–80kb gzipped overhead on the client.

## Options considered

### A — Keep Zod 4

Validation schemas live in shared modules. Server uses them for tRPC
input validation. Client uses them for form validation via TanStack
Form's `validators.onChange = z.object({...})` integration.

Pros: small bundle (~12kb gzipped), tree-shakes well, TanStack Form
integration is documented, Zod 4 is fast.

Cons: parsing errors are stringly-typed on the boundary (you check
`error.code === "invalid_type"`); Zod doesn't compose with Effect's
parsing pipelines (you'd `Effect.tryPromise(() => schema.parseAsync())`
at every server call site).

### B — Replace with Effect Schema everywhere (server + client)

Schemas defined as Effect Schema. Server uses
`Schema.decodeUnknown(...)` returning `Effect<A, ParseError>`.
Client uses the same schemas; TanStack Form integration via a small
adapter `(schema) => (value) => Schema.decodeUnknownEither(schema)(value)`.

Pros: end-to-end Effect, parse errors are typed and structured
(`ParseError` carries `path`, `expected`, `actual`), schemas
compose with Effect's transformation pipelines, server and client
share *exactly* the same parsing semantics.

Cons (load-bearing): bundle size. Effect Schema's runtime is larger
than Zod's, and tree-shaking gaps mean you ship more than you use.
The 30–80kb estimate from the Phase 1 design doc is the range we
need to pin down with the actual spike.

### C — Effect Schema on server, Zod on client (split)

Server adopts Effect Schema for the parsing benefits; client keeps
Zod for bundle reasons. Schemas are duplicated (or generated from a
single source).

Pros: best of both — server gets Effect ergonomics, client stays
small.

Cons: schema duplication is the kind of split Q4 explicitly rejects;
"two schema systems in one repo" is exactly the inconsistency the
rewrite wants to avoid.

## Decision (proposed, default lean)

**Pick B — Effect Schema everywhere**, conditional on the Phase 3
bundle measurement landing under **70 KB gzipped** for the first
slice's frontend route (the route that includes the todo creation
form + auth-redirect form + dashboard skeleton).

If the measurement exceeds 70 KB, fall back to **C** (Effect Schema
on server, Zod on client) with the explicit acknowledgment that this
violates Q4's "no inconsistency" stance for a measurable bundle win.
The 70 KB threshold is chosen as the boundary where Effect Schema's
ergonomic wins on the server still likely outweigh the client cost.

A < 70 KB → B. A ≥ 70 KB → C. Pick A (keep Zod everywhere) only if
both options exceed 70 KB by enough that even the server win
disappears (unlikely).

## Consequences

### Positive (if B confirmed)
- One schema definition serves both server and client
- Parse errors carry typed path + expected/actual info, useful for
  surfacing field-level validation errors in forms
- Effect transformation pipelines compose naturally with parse
  results

### Negative (if B confirmed)
- Frontend bundle grows compared to Zod baseline
- Engineers new to the stack add Effect Schema to the learning curve

### Neutral / preserved
- TanStack Form integration works through a small adapter either way
- Server-side input validation semantics unchanged behaviorally

## Promotion checklist (Phase 3)

When the first slice's frontend builds:

- [ ] Run `make build` (or equivalent Vite build target) on the
      first slice's complete frontend
- [ ] Measure: `du -sh apps/web/dist/assets/*.js | sort -h | tail`
- [ ] If under 70 KB gzipped delta vs a Zod-baseline build, confirm
      decision B
- [ ] If over 70 KB, switch to decision C (Effect Schema server,
      Zod client) and document the actual measurement in §Spike findings
- [ ] Move file to `docs/adrs/0014-schema-validation.md`
- [ ] Flip `status: proposed` → `status: accepted`
- [ ] Fill `verified_by:` with the schemas module path (e.g.,
      `packages/api/src/domains/todo-list/todo-schema.ts`)
- [ ] Add `// ADR-0014` cite
- [ ] Cross-reference in ADR slot 0016 (frontend Effect adoption)
      since the schema choice influences client-side Effect surface

## Spike findings — Phase 3 step 6 (2026-04-29, partial)

The first-slice frontend shipped with **Zod 4 only** for both server
input validation (tRPC `.input(zodSchema)`) and client form validation.
A head-to-head Effect Schema build was **not** run — pragmatic
deferral.

**Zod-baseline measurement** (`pnpm --filter @project/web exec vite
build`, all client JS gzipped):

```
148 KB total client JS, gzipped
  largest chunks:
    index (app + router + react-query)  114.7 KB gz
    auth-client (Better-Auth)            10.0 KB gz
    useStore                              7.2 KB gz
    preload-helper                        5.2 KB gz
    useMutation, useRouter                7.0 KB gz combined
    per-route chunks (4 routes)           2.8 KB gz combined
```

The schema shapes in the slice are tiny (5 input objects:
`createTodoListInput`, `todoListIdInput`, `createTodoInput`,
`todoIdInput`, `todosOfListInput`). Zod's contribution is bounded by
how many constraints it carries — under ~3 KB gz for these shapes
specifically.

**Decision deferred.** The 70 KB delta threshold can't be evaluated
without an Effect Schema variant. The slice works fine on Zod, so
forcing a head-to-head measurement at this stage burns time the
capability-walk could spend on actual capabilities. When a future
session wants to revisit:

1. Migrate `packages/api/src/domains/todo-list/todo-schema.ts` to
   Effect Schema (replace Zod object literals with `Schema.Struct`).
2. Update tRPC procedures to use a `.input(...)` adapter that calls
   `Schema.decodeUnknownEither`.
3. Update client forms to validate via `Schema.decodeUnknownEither`.
4. Run `make build`, recompute the per-chunk gzipped sizes above, and
   compare totals.
5. Decision B if delta ≤70 KB, C if larger.

The draft frontmatter stays `proposed`; promotion happens when the
comparison is actually run.

## References

- ADR-0009 — full rewrite onto Effect-TS
- Effect Schema docs: https://effect.website/docs/schema/introduction
- Zod 4: https://zod.dev
- Effect bundle issues: https://github.com/Effect-TS/effect/issues/5967,
  https://github.com/Effect-TS/effect/issues/5317
- Phase 1 design doc — Q4 commitment + bundle-risk acknowledgment
