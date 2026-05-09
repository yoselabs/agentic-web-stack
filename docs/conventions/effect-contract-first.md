# Effect Contract-First Conventions

> Status: enforced from `rewrite/contract-first` Day 1 (commit `56bd11d`).
> Source spec: `docs/superpowers/specs/2026-05-07-effect-contract-first-design.md`.

## ALWAYS

- ALWAYS declare `Effect.Effect<A, E, R>` return types on every export
  in `packages/api/src/domains/**/*-{contract,service}.ts`. Inferred
  returns are an error (`make lint` → `check-explicit-return-types`).
- ALWAYS define errors with `Data.TaggedError("X")<{...}>` where the tag
  literal equals the class name (`check-tagged-errors`).
- ALWAYS write the `<name>-{contract,schema,errors}.ts` commit BEFORE
  the `<name>-service.ts` commit. The frozen-contract AI handoff
  depends on this order.
- ALWAYS use `class X extends Effect.Service<X>()(...)` for new services.
  `Context.Tag` and `Context.GenericTag` are banned in src
  (`check-effect-service-form`).
- ALWAYS compose layers with `X.Default` (provided by `Effect.Service`),
  not hand-rolled `Layer.effect(Tag, ...)`.
- ALWAYS use Effect Schema (`Schema.Struct(...)`) on the server. Zod
  is permitted only in `apps/web` form code.
- ALWAYS use `Effect.Schedule` for in-process retry composition. BullMQ
  retry stays as the outer envelope.

## NEVER

- NEVER modify `<name>-{contract,schema,errors}.ts` while implementing
  `<name>-service.ts`. Contract changes are separate human-authored
  commits on top of the contract commit.
- NEVER introduce errors not declared in `<name>-errors.ts` from inside
  `<name>-service.ts`. Surface the gap as a question.
- NEVER add services to the `R` channel that are not declared in the
  contract.
- NEVER use Zod on the server. Zod's exception (form input adapters in
  `apps/web/src/lib/forms.ts`) is the only exception.
- NEVER use `Context.Tag` or `Context.GenericTag` for new services.
- NEVER hand-roll BullMQ retry logic inside an Effect — use
  `Effect.Schedule` composed via `Effect.retry`.

## When the AI hits a wall

- If the contract feels wrong, **STOP and ask**. The contract is frozen
  during impl; changing it is a separate human commit on top of the
  contract commit.
- If a new error is needed that is not in `<name>-errors.ts`, the
  contract is wrong (or the service is over-reaching). Same rule: stop
  and ask.
- If the `R` channel needs a new dependency that the contract didn't
  declare, the contract is wrong. Stop and ask.

## @totality opt-in

A method that processes a stream / batch / page of records can opt in
to R023 record-level accountability:

```ts
/** @totality */
purge(): Effect.Effect<PurgeReport, TodoError | TodoSkippedError, Db | Logger> { ... }
```

`check-totality` enforces that the E channel includes at least one
`*SkippedError` variant. Skipping must carry a reason
(`Data.TaggedError("TodoSkippedError")<{ readonly reason: ... }>`).

## Cross-references

- ADR-0009 (full rewrite onto Effect)
- ADR-0014 (schema validation — closed by this rewrite, see D4)
- ADR-0015 (queue — amended, see D5)
- ADR-0017 (logger — unchanged; Effect's built-in `Logger` is already
  idiomatic)
- R023 — Black-Box Module Contracts & Completeness Invariants
- R073 — GRACE / LDD / AI code markup (hardness engineering)
