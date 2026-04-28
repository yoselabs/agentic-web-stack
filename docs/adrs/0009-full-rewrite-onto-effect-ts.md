---
title: "ADR-0009 — Full rewrite onto Effect-TS"
status: accepted
date: 2026-04-28
deciders: [denis]
supersedes:
  - implicit-stack-decisions-pre-effect
verified_by:
  - docs/tech-stack.md
  - docs/capabilities.md
---

# ADR-0009 — Full Rewrite onto Effect-TS

## Context

The template (snapshot tagged `stable-pre-effect`, commit `80f0684`)
runs on a conventional async/await TypeScript stack: tRPC + Hono +
Prisma + BullMQ + Better-Auth + Zod + React Query + TanStack Start.
Errors are thrown, services are plain async functions, dependencies
are passed as arguments. This works, but lacks:

- Typed error channels (every thrown `TRPCError` is invisible to the
  type system; whether a service can fail with `NotFound` vs `Forbidden`
  vs `RateLimit` is implicit and easy to lose during refactors).
- Structured concurrency (the activity-feed gap-fill stream uses
  manual `AbortController` + Promise capture; the realtime channel
  init has a hand-rolled race guard; BullMQ retries are config, not
  composition).
- Composable retries / scheduling / time as values
  (`Effect.Schedule`, `TestClock`, fibers).

After a research and audit pass (see commits between
`80f0684` and this ADR; full report archived in conversation
memory), the recommended *partial* path was "Effect at the leaves" —
keep the stack, adopt Effect inside the service layer only.

This ADR rejects that path in favor of a **full greenfield rewrite**,
on the grounds that:

1. The template's purpose is to be the **dream stack for AI-driven
   development**. A partial Effect adoption ships an inconsistent
   model where some services use tagged errors and others throw —
   exactly the kind of split that makes AI-assisted code generation
   harder, not easier.
2. The freeze tag `stable-pre-effect` (branch `stable/pre-effect`,
   pushed to origin) gives a fully reversible exit if the rewrite
   doesn't pan out.
3. Several rewrite-only wins are unavailable to incremental adoption:
   uniform `Layer` graph, `@effect/cluster` for worker primitives once
   `ClusterQueue` lands, `Effect.fnUntraced` spans threading through
   every operation, no `runEffect` adapter boilerplate at procedure
   boundaries (because procedures themselves return `Effect`).

## Decision

**Rewrite the codebase end-to-end with Effect-TS as the runtime
substrate.** Scope: `apps/server`, `apps/worker`, `packages/api`,
`packages/auth`, `packages/realtime`, `packages/jobs`,
`packages/email`, `packages/rate-limit`, `packages/db`. Frontend
(`apps/web`) scope is **deferred to ADR-0016**.

The rewrite preserves:

- The **capability contract** documented in
  [`docs/capabilities.md`](../capabilities.md) — what the system does
  must not regress.
- The **Gherkin specs** in `e2e/features/` — these are the behavioral
  contract; every scenario must still pass.
- The **dev tooling layer** documented in
  [`docs/dev-tooling.md`](../dev-tooling.md) — Make, turbo, pnpm,
  prek, custom lint checks, Playwright BDD all stay.
- The **package taxonomy** in
  [`docs/package-taxonomy.md`](../package-taxonomy.md) — slot
  definitions remain; only their *implementations* are rewritten.

The rewrite replaces:

- The runtime substrate of every backend package (services return
  `Effect<A, E, R>` instead of `Promise<A>`).
- The error model (tagged errors via `Schema.TaggedError` or
  `Data.TaggedError`, no thrown `TRPCError` from services).
- The DI mechanism (`Layer` + `Context.Tag` for `Db`, `Auth`,
  `Logger`, `Channel`, `Queue`, `Mailer`, `RateLimiter`).
- The concurrency model (Fibers + Streams replace ad-hoc Promise
  orchestration in the activity-feed stream and realtime channel).

The rewrite **defers** the following decisions to follow-up ADRs (each
to be written when its phase lands; don't pre-decide):

| ADR | Question | Default lean (revisit when writing) |
|---|---|---|
| ADR-0011 | HTTP: keep Hono with Effect inside, or `@effect/platform` HttpApi? | Hono + Effect — preserve Better-Auth + Bull Board mounts |
| ADR-0012 | RPC: keep tRPC v11 with `runEffect` adapter, or `@effect/rpc`? | Keep tRPC — `@effect/rpc` is pre-1.0 and ecosystem-thin |
| ADR-0013 | DB: keep Prisma wrapped, or `@effect/sql`? | Keep Prisma — migration cost without ergonomic win |
| ADR-0014 | Schema: keep Zod 4, or Effect Schema? | Keep Zod — bundle cost on the client + Zod 4 is fast |
| ADR-0015 | Queue: keep BullMQ wrapped, or wait for `ClusterQueue`? | Keep BullMQ — Effect maintainers explicitly recommend it |
| ADR-0016 | Frontend Effect adoption: full, partial, or none? | None — Effect server-only, TanStack Query stays |

## Consequences

### Positive

- Typed error channels everywhere. A service signature documents what
  *can* go wrong, the way Prisma types document what *can* be queried.
- Structured concurrency replaces three current ad-hoc patterns: the
  activity-feed gap-fill + live + dedup stream
  ([`capabilities.md` composition #5](../capabilities.md#activity-feed-gap-fill--live--dedup)),
  the realtime channel init race
  ([`capabilities.md` composition #3](../capabilities.md#realtime-stack-composition)),
  and BullMQ retry policy
  ([`capabilities.md` composition #4](../capabilities.md#email-enqueue-discipline)).
- `TestClock` makes time-dependent tests deterministic without
  `withFakeTimers` boilerplate.
- One DI graph (`Layer`) replaces the current mixed pattern (passed
  arguments, factories, module singletons).
- Aligns with the template's stated purpose: "best practices working
  with Effect."

### Negative

- **Hiring / learning-curve cost.** Effect's generators, tagged
  errors, `Layer`/`Context`, and fibers have a 2–4 week ramp per
  engineer. Acceptable for a single-author template; would be a real
  cost for a team adoption.
- **Adapter boilerplate at every Promise boundary.** Prisma,
  Better-Auth, BullMQ, nodemailer all return Promises; every call
  site needs `Effect.tryPromise({ try: ..., catch: tagError })`.
  Mitigated by writing one wrapper per external library (e.g.,
  `DbLive` Layer wraps Prisma), not per call.
- **Stack traces are still worse than plain async/await** for
  unfamiliar engineers, even with `Effect.fnUntraced` improvements.
- **Frontend bundle risk if ADR-0016 chooses any client-side Effect.**
  Tree-shaking of Schema is incomplete (Effect issues #5967, #5317);
  baseline cost ~30–80kb gzipped.
- **No drop-in `ClusterQueue`** — workers still depend on BullMQ.
  ADR-0015 will track when/if this becomes an Effect-native primitive.

### Neutral / preserved

- Frontend (`apps/web`) is unchanged unless ADR-0016 says otherwise.
  React 19 + TanStack Start + TanStack Query + TanStack Router
  + TanStack Form remain.
- Test runner choice from ADR-0003 (Bun for `@project/api`, Vitest
  for `apps/web`) survives. `bun test` doesn't care that services
  return `Effect`.
- All structural lint checks
  ([`dev-tooling.md` §3](../dev-tooling.md#3-lint--format)) survive
  except `check-trpc-patterns` and possibly `check-perspective-boundary`,
  which become Effect-aware.

## Rollback path

The rewrite branches off `stable/pre-effect` (tag `stable-pre-effect`,
commit `80f0684`). If the rewrite is abandoned, `git reset --hard
stable-pre-effect` on the working branch returns the codebase to a
known-good state with zero churn. The freeze was the precondition for
this ADR; do not rebase or rewrite history past that tag.

## Implementation phases

Suggested ordering. Each phase ends with a green `make lint` +
`make test`. The follow-up ADRs are written *as their phase lands*,
not before.

1. **Phase 1 — Runtime baseline.** Land ADR-0010 (Node 24 prod),
   set up Effect at the package level (`effect`, `@effect/platform`,
   `@effect/platform-node` in catalog), one Layer for `Db` wrapping
   Prisma. Smoke: one service rewritten, one tRPC procedure adapted,
   tests green.
2. **Phase 2 — Service layer rewrite.** All `packages/api/src/domains/*/`
   services return `Effect`. Tagged error hierarchy lands. ADR-0011
   (HTTP) and ADR-0012 (RPC) decided here.
3. **Phase 3 — Worker rewrite.** `apps/worker` handlers return
   `Effect`. Retries via `Schedule`. ADR-0015 (queue) decided here.
4. **Phase 4 — Realtime rewrite.** `Channel` interface re-expressed
   with `Effect.Stream`. Activity-feed stream rebuilt with structured
   concurrency. Composition contracts in `capabilities.md` updated.
5. **Phase 5 — DB error model.** ADR-0013 decided. Either tagged
   errors over Prisma, or migration to `@effect/sql`.
6. **Phase 6 — Schema decision.** ADR-0014 decided. Default: Zod
   stays. If migrating, plan client bundle impact.
7. **Phase 7 — Frontend.** ADR-0016 decided. Most likely a no-op.

Each phase updates [`docs/capabilities.md`](../capabilities.md) and
[`docs/tech-stack.md`](../tech-stack.md) so the contract docs never
fall out of sync with reality.

## References

- [`docs/capabilities.md`](../capabilities.md) — the contract this rewrite must preserve.
- [`docs/tech-stack.md`](../tech-stack.md) — the implementation register being replaced.
- Tag `stable-pre-effect` (commit `80f0684`) — the freeze point.
- Effect-TS — https://effect.website
- Prior research summaries in conversation history (Effect tRPC
  patterns, @effect/sql tradeoffs, BullMQ vs ClusterQueue, Zod 4 vs
  Effect Schema, bundle-size issues #5967 / #5317).
