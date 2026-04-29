---
title: "ADR 0013 — DB access (proposed, optional spike)"
status: proposed
date: 2026-04-29
deciders: [denis]
draft_for_promotion_in_phase: 3
spike_status: optional — Phase 3 first-slice implementation IS the spike
---

# ADR 0013 — DB Access

> **Spike not separately required.** The original plan offered an
> optional ≤2h spike (2-procedure example with a `Db` Layer). In
> practice the first vertical slice (Phase 3, auth bootstrap +
> todo-list) writes ~5 procedures consuming the `Db` Layer — that's
> the spike, just folded into the slice. Promotion criteria below
> describe the ergonomic signals to confirm before flipping to
> `accepted`.

## Context

The pre-rewrite stack used Prisma 7 with the new prisma-client
generator (output → `packages/db/src/generated/`) and PrismaPg
adapter for connection pooling. Phase 1 reduced
`packages/db/src/index.ts` to a re-export stub; the Effect rewrite
now needs a `Db` Layer wrapping Prisma — or replacement with
`@effect/sql`.

The Phase 1 design doc kept `prisma/schema/*.prisma` as the source
of truth for data shape, which constrains this decision: switching
to `@effect/sql` would mean abandoning the Prisma schema model.

## Options considered

### A — Wrap Prisma behind a `Db` Layer

A `Db` `Context.Tag` exposes a typed `PrismaClient`. The `Live`
Layer constructs `new PrismaClient({ adapter: new PrismaPg(...) })`
once (Layer scope = singleton). Service procedures consume `Db` and
call methods inside `Effect.tryPromise`:

```ts
const findUserByEmail = (email: string) =>
  Effect.gen(function* () {
    const db = yield* Db;
    return yield* Effect.tryPromise({
      try: () => db.user.findUnique({ where: { email } }),
      catch: (e) => new DbError({ cause: e }),
    });
  });
```

Pros: preserves the entire Prisma ecosystem (typed migrations, query
engine, prisma-client-generator), zero change to the data model,
incremental rewrite path (each domain rewritten independently).

Cons: `Effect.tryPromise` boilerplate at every Prisma call site.
Mitigated by per-domain helpers (one helper per common operation
shape) but the boilerplate remains visible.

### B — Replace with `@effect/sql`

`@effect/sql` is Effect's native SQL DSL with typed query results
and Layer-based connection pooling. End-to-end Effect.

Pros: zero `Effect.tryPromise` adapter; SQL queries directly return
`Effect`; richer composition (transactions as scoped effects,
streaming queries as Effect Streams).

Cons:
- Requires re-modeling the schema (Prisma's declarative schema model
  doesn't translate; you'd write SQL migrations + handcrafted query
  builders or use a separate type-generation step like Drizzle's)
- Loses Prisma's interactive `prisma migrate dev` workflow
- Loses Prisma Studio (real losses for the dev inner loop)
- `@effect/sql` is solid but the surrounding tooling (migrations,
  schema introspection) is thinner than Prisma's

## Decision (proposed, default lean)

**Pick A — wrap Prisma behind a `Db` Layer.**

Rationale: ADR-0009 preserved the Prisma schema as the data-shape
source of truth. Switching to `@effect/sql` would require abandoning
that contract — a much larger scope change than this rewrite is
funded for. The boilerplate cost of `Effect.tryPromise` is
manageable behind per-domain helpers.

If a future redesign chooses to migrate the data model to SQL-first
(no more Prisma schema), `@effect/sql` becomes the natural choice
and this ADR is superseded.

## Consequences

### Positive
- Prisma schema, generator, Studio, migrate workflow all preserved
- `Db` Layer is one file (~30 lines) — singleton client + `tryPromise`
  helper
- Interop with Better-Auth (which expects a Prisma-compatible client)
  is unchanged

### Negative
- Visible `Effect.tryPromise` calls at Prisma sites until per-domain
  helpers absorb them
- Transactions need a small wrapper:
  `db.$transaction(...)` returns `Promise<T>` so Effect transaction
  composition needs a thin `withTransaction(eff)` helper

### Neutral
- Prisma client generation still runs via `make db-generate`
- packages/db/src/generated/ remains the only path for the typed
  client (consumers go through `@project/db`)

## Promotion checklist (Phase 3)

After the first slice writes ~5 procedures consuming `Db`:

- [ ] Confirm boilerplate is bounded by per-domain helpers
      (not visible at every call site)
- [ ] Confirm transaction composition works (one mutation that uses
      `withTransaction` to atomically write across 2 tables)
- [ ] Confirm `DbError` tagged hierarchy is useful (e.g., distinguishes
      `PrismaUniqueConstraintError` from generic `DbError`)
- [ ] Move file to `docs/adrs/0013-db-access.md`
- [ ] Flip `status: proposed` → `status: accepted`
- [ ] Fill `verified_by:` with `packages/db/src/db-layer.ts` (or
      `apps/server/src/db.ts`) — wherever the `Db` Tag lives
- [ ] Add `// ADR-0013` cite

## References

- ADR-0009 — full rewrite onto Effect-TS
- Prisma docs: https://www.prisma.io/docs
- `@effect/sql`: https://effect.website/docs/sql-postgres
- `lelabo-m/lister` — uses Drizzle + Effect (alternative middle ground
  not pursued here because we already own the Prisma schema)
