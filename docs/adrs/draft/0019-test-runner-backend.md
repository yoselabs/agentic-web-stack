---
title: "ADR 0019 — Test runner — backend (proposed, optional spike)"
status: proposed
date: 2026-04-29
deciders: [denis]
draft_for_promotion_in_phase: 3
spike_status: optional — runs alongside first-slice backend tests
---

# ADR 0019 — Test Runner (Backend)

> **Spike not separately required.** Original plan offered a ≤2h
> spike timing the same suite under both runners. The first slice's
> backend tests (~10 procedures of auth + todo-list services) IS the
> spike, just folded in. Promotion gate enumerates the cutover
> trigger.

## Context

Pre-rewrite, ADR-0003 picked Bun + `bun test` for `@project/api`
(60× faster than Vitest in this stack — see ADR-0003 + the
2026-04-11 spike rationale). Vitest stayed for `apps/web` for
Vite-plugin reuse.

The Effect rewrite introduces `@effect/vitest`, which adds:
- `it.effect(...)` — runs an Effect-returning test, automatically
  provides `TestClock`, `TestRandom`, etc.
- `TestClock` integration — deterministic time without
  `withFakeTimers` boilerplate
- `Layer` provisioning per test scope

The question: keep `bun test` for `@project/api` (when re-introduced
in Phase 3) or migrate to `@effect/vitest`?

## Options considered

### A — Keep `bun test`, write Effect-aware test helpers manually

`bun test` continues. Tests use `Effect.runPromise(...)` to execute
effects; `TestClock` + `TestRandom` are wired via manual
`Layer.provideMerge(TestClock.layer)`. Per-test-file boilerplate.

Pros: keeps the 60× speed win from ADR-0003. Bun's test runner is
mature and fast.

Cons: every test file has helper-import boilerplate. `TestClock`
advancement is more verbose than `it.effect`'s ergonomic helpers.

### B — Migrate `@project/api` to `@effect/vitest`

Drop `bun test` for the api package; use `@effect/vitest` instead.
`it.effect` everywhere; `TestClock` provided by default.

Pros: best ergonomics for testing Effect code. `it.effect` reads
naturally; `TestClock` advancement is one helper call. Eliminates
test-helper boilerplate per file.

Cons: loses Bun's speed advantage. Vitest is slower for the kind of
tight TDD inner-loop the rewrite needs (a 60× speed delta for a 5s
suite is the difference between 0.1s and 5s — perceptible).

### C — Hybrid: `bun test` for the bulk, `@effect/vitest` per-suite
where `TestClock` is needed

Most procedure tests don't need `TestClock` (they hit the test DB,
return tagged errors, that's it). Use `bun test` for those — speed.
The few suites that need `TestClock` (Schedule-driven retries, time-
based expirations) opt into `@effect/vitest`.

Pros: speed where it matters, ergonomics where they matter. No
all-or-nothing decision.

Cons: two test runners in one package = config complexity. Per-suite
opt-in needs a clear convention.

## Decision (proposed, default lean)

**Pick A — keep `bun test`** for the first slice. Re-evaluate as
**C** (hybrid) only if a Phase 3 or Phase 4 capability surfaces a
suite that genuinely needs `TestClock` and the `bun test` helper
ergonomics become painful enough to justify the runner split.

Rationale: ADR-0003's 60× speed win is the inner-loop QoL the rewrite
shouldn't sacrifice for ergonomics that mostly buy convenience, not
correctness. Manual `Effect.runPromise` + `TestClock.layer` is verbose
but bounded — wrap once in a per-package `test-helpers.ts` and the
boilerplate stops at one file.

## Consequences

### Positive
- Inner-loop test speed preserved (the ADR-0003 win survives)
- `bun test`'s native TS execution (no Vitest config to maintain for
  the api package) stays simple

### Negative
- `TestClock` use is more verbose than `it.effect` ergonomics
- Engineers familiar with `@effect/vitest` from open-source examples
  will need to translate to the `bun test`-with-helpers idiom

### Neutral
- `@project/web` continues to use Vitest (unchanged from ADR-0003)
- Test-DB setup via `packages/test-infra` unchanged

## Promotion checklist (Phase 3)

After first slice backend tests land:

- [ ] Confirm `bun test` runs the first slice's tests in <10s warm
- [ ] Confirm the per-package `test-helpers.ts` adapter (Effect.runPromise
      + TestClock provisioning) is bounded to one file
- [ ] Document the testing convention in
      `packages/api/CLAUDE.md` (when reintroduced)
- [ ] Move file to `docs/adrs/0019-test-runner-backend.md`
- [ ] Flip `status: proposed` → `status: accepted`
- [ ] Fill `verified_by:` with the test-helpers module path + the
      first slice's test file path
- [ ] Add `// ADR-0019` cite

If during the slice a TestClock-heavy suite surfaces and `bun test`
becomes painful, escalate to decision **C** (hybrid). Document the
trigger in §"Spike findings" before flipping status.

## References

- ADR-0003 — web test runner (the spike that established Bun's 60×
  win for `@project/api`)
- ADR-0009 — full rewrite onto Effect-TS
- `@effect/vitest` docs: https://effect.website/docs/testing/vitest
- Effect `TestClock`: https://effect.website/docs/testing/testclock
- Bun test runner: https://bun.sh/docs/cli/test
