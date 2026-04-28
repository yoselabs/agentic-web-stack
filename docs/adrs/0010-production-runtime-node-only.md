---
title: "ADR-0010 — Production runtime: Node 24 only"
status: accepted
date: 2026-04-28
deciders: [denis]
supersedes:
  - implicit-bun-runtime-for-apps-server
verified_by:
  - Dockerfile
  - apps/worker/Dockerfile
---

# ADR-0010 — Production Runtime: Node 24 Only

## Context

Pre-rewrite (tag `stable-pre-effect`), production runtime was split:

| Process | Prod runtime | Source |
|---|---|---|
| `apps/server` | **Bun 1** (`oven/bun:1-slim`) | `Dockerfile` |
| `apps/worker` | **Node 22** (bundled `dist/index.js`) | `apps/worker/Dockerfile` |

Two production runtimes for one monorepo is the actual smell — bigger
than the original Bun-vs-Node question, and only visible once the
Dockerfiles were read together. The split arose organically: `apps/server`
moved to Bun during the 2026-04-11 test-runner spike (commit `03ed284`)
because the Vitest+Bun Zod/Vite-SSR interop bug forced the test runner
swap, and consistency-by-sliding-scope kept Bun for prod too.
`apps/worker` stayed on Node because BullMQ + Node has better library
compatibility.

The Effect-TS rewrite (ADR-0009) makes uniform Node prod the obvious
choice:

- Effect's documentation, examples, and `@effect/platform-node` all
  assume Node.
- The rewrite is a clean slate; no migration cost to picking the
  better answer.
- One production runtime simplifies CI, Docker layer caching, and
  "does this library work here" library-vetting.

## Decision

**Production runtime is Node 24 for every long-running process in the
monorepo.** Both `apps/server` and `apps/worker` ship as bundled
`dist/index.js` running under `node:24-slim`.

Bun is **retained** for:

- `bun test` — unit/integration runner for `@project/api` and other
  Bun-native suites (60× faster than Vitest in this stack — see
  ADR-0003 and the 2026-04-11 spike).
- `bun --watch src/index.ts` — local-dev hot reload for `apps/server`.
  Replaced `tsx watch` after E2E flakes (commit `03ed284` rationale).
- `packages/lint/src/check-*.ts` and other repo-glue scripts — fast
  startup matters for the inner loop.

Bun is **not** used for:

- Production server / worker runtime — both run on Node 24.
- Anything in CI's deployed-artifact path beyond the build step.

## Consequences

### Positive

- One production runtime. CI Docker layer caching simplifies; library
  vetting answers "does it work" once, not twice.
- Aligns with Effect-TS ecosystem assumptions.
- Removes the ADR-0003 footnote about server-prod-vs-test runtime
  divergence.

### Negative

- `apps/server` builds now require a bundle step before container
  build. (Worker already does this.) Adds ~15s to the prod build
  pipeline; mitigated by Docker layer caching.
- Lose Bun's startup speed advantage in production cold-starts.
  Acceptable: server is long-running, not Lambda-like.

### Neutral

- Dev experience is unchanged: `make dev` still uses `bun --watch`
  for `apps/server` (no rebuild loop).
- Test experience is unchanged: `make test-unit` still routes the
  Bun-native suites through `bun test`.
- `tsx` does not return — its cold-compile stampede problem under
  parallel Playwright workers (rationale in commit `03ed284`) is
  unchanged.

## Implementation

Lands in **Phase 1** of the rewrite (per ADR-0009):

1. `apps/server/package.json`: add a `build` script that produces
   `apps/server/dist/index.js`. Bundler choice: `bun build` is fine
   here — Bun-as-bundler is independent of Bun-as-runtime, and `bun
   build`'s output runs cleanly under Node.
2. `Dockerfile` (root, for `apps/server`): change runtime stage from
   `FROM oven/bun:1-slim AS runtime` to `FROM node:24-slim AS runtime`.
   Update healthcheck command from `bun /app/scripts/...` to
   `node /app/scripts/...`.
3. CI: no changes to the Bun setup step (`oven-sh/setup-bun@v2`),
   but the deployed-artifact path no longer references Bun.
4. Verify `make test` and `make smoke` green against the rebuilt
   image.

## References

- ADR-0003 — Web test runner (Vitest for web, Bun for api).
- ADR-0009 — Full rewrite onto Effect-TS.
- Commit `03ed284` — original Bun-test spike rationale.
- Commit `3722d63` — `tsx watch` → `bun --watch` consistency cleanup.
