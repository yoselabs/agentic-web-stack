---
title: "ADR-0003 — Web test runner"
status: accepted
date: 2026-04-21
deciders: [denis]
verified_by: [apps/web/src/harness.smoke.test.tsx]
---

# ADR-0003 — Web Test Runner

## Context

`apps/web` is a TanStack Start (Vite SSR) app on React 19. `packages/api`
already runs its unit and integration tests on `bun test`, which is fast
and integrates cleanly with Prisma. The natural question on first setting
up a web-side test harness was: can Bun's runner cover the web app too,
keeping one runner across the monorepo?

Three concrete blockers surfaced while prototyping Bun for web tests:

1. **React 19 + React Testing Library interop is rough on Bun.** RTL's
   act-batching relies on microtask semantics and `MessageChannel`;
   Bun's DOM shim + test runner had edge cases where `findBy*` queries
   either hung or missed state updates inside React 19's concurrent
   scheduler. Vitest + happy-dom runs the same suites cleanly because
   it shares Vite's transform pipeline and happy-dom's scheduler
   matches jsdom's behavior that RTL was authored against.

2. **No Vite plugin reuse.** The web app's `vite.config.ts` wires
   `tanstack-start`, `viteReact`, `tsconfigPaths`, and a hand-rolled
   `tslib` ESM alias (see the comment block in `vite.config.ts` — the
   CJS variant breaks SSR via `__toESM` interop). Bun's runner does not
   execute Vite plugins, so every test file would hit module-resolution
   errors the dev server hides. `vitest.config.ts` uses
   `mergeConfig(viteConfig, …)` and inherits the lot.

3. **Bun's fake timers are incomplete.** `bun:test` supports
   `Bun.setFakeTimers` / `--fake-timers` but does not fake
   `Date.now()` or `performance.now()`. Any hook that derives state
   from "wall-clock" time (activity timeouts, TTL caches, telemetry
   clocks) is untestable without extra monkey-patching. Vitest's
   `vi.useFakeTimers({ toFake })` fakes both and lets us opt out of
   `queueMicrotask` — which is load-bearing, because faking
   `queueMicrotask` breaks React 19's scheduler (microtask-based act
   batching) and causes hangs or dropped updates.

`packages/api` has none of these problems: no React, no Vite plugin
tree, no browser DOM; it exercises Prisma against a real Postgres and
benefits from Bun's raw speed.

## Decision

- **`apps/web`** runs on **Vitest 3** with **happy-dom** as the
  environment. `vitest.config.ts` reuses the app's module-resolution
  surface (`tsconfigPaths` + the `tslib` ESM alias — see `vite.config.ts`
  for the `__toESM` interop rationale) and loads `@vitejs/plugin-react`
  for JSX transform, but **does not** `mergeConfig` the full
  `vite.config.ts`. The `nitro` and `tanstack-start` plugins spawn
  long-lived workers (SSR server, generators) that keep Vitest from
  exiting cleanly ("close timed out after 10000ms"). For unit tests we
  only need React + resolver; the spec originally called for a thin
  `mergeConfig`, and we can revisit if tanstack-start grows a `lazy`
  mode. `test/setup.ts`
  installs `@testing-library/jest-dom/vitest` matchers and an
  `afterEach(cleanup)` hook. `test/render.tsx` exports
  `renderWithTRPC(ui, { seed })` — a per-test `QueryClient` with
  `retry: false, gcTime: Infinity, staleTime: Infinity`, optionally
  pre-seeded via `queryClient.setQueryData`. `test/time.ts` exports
  `withFakeTimers({ toFake })` defaulting to
  `["setInterval", "clearInterval", "setTimeout", "clearTimeout", "Date", "performance"]`
  — explicit list because `vi.useFakeTimers` defaults include
  `queueMicrotask`, which breaks React 19.

- **`packages/api`** stays on **`bun test`**. No change.

- **`make test-unit`** fans both out via `turbo run test
  --filter=@project/api --filter=@project/web`. Turbo caches per-task
  by input hash, so unchanged suites are instant on re-runs.

- **`make test-browser`** (separate target, landing in WS6) will host
  Chromium-backed `*.browser.test.tsx` via `@vitest/browser`.
  `@vitest/browser` is already in the catalog so the WS6 install is
  config-only.

Heterogeneous runners are a conscious trade: Bun wins on the API side
where its speed + native Prisma fit matters; Vitest wins on the web
side where plugin reuse and React-19 fidelity matter more than raw
benchmark numbers.

## Consequences

- **Positive.** Web tests exercise the same module graph the app
  ships — a test that passes here passes in the SSR bundle.
- **Positive.** `vi.useFakeTimers` covers `Date`/`performance`, so
  clock-sensitive hooks (activity timeouts, derived state, debounced
  queries) are testable without wall-clock flake.
- **Positive.** `renderWithTRPC`'s cache-seed pattern replaces per-test
  tRPC mocking: no MSW, no handler files, no divergence between mock
  shape and real shape — the seed *is* a tRPC return value typed by
  the router.
- **Negative.** Two runners to learn. Mitigated by a one-line hint in
  each package's `CLAUDE.md`: api uses Bun, web uses Vitest.
- **Negative.** Catalog carries `vitest`, `@vitest/browser`, three
  `@testing-library/*` packages, and `happy-dom`. All dev-only; no
  runtime cost.

## Alternatives considered

- **Jest.** No Vite plugin interop; slower than Vitest on the same
  transform pipeline; an extra runner to maintain.
- **Bun test everywhere.** Blocked by the three issues above. Could
  revisit when Bun ships React 19 + RTL compatibility and a complete
  fake-timer implementation.
- **`@happy-dom/jest-environment` + Jest.** Same Jest disadvantages;
  happy-dom itself is fine but we gain nothing over Vitest's built-in
  env option.

## References

- `apps/web/vitest.config.ts` — active config (mergeConfig).
- `apps/web/test/setup.ts` — RTL setup + cleanup.
- `apps/web/test/render.tsx` — `renderWithTRPC` helper.
- `apps/web/test/time.ts` — fake-timers harness.
- `apps/web/src/harness.smoke.test.tsx` — verifies the harness loads
  (the `verified_by` pointer above).
- Spec: `docs/superpowers/specs/2026-04-21-template-prevention-foundation-design.md` §4 WS2.
