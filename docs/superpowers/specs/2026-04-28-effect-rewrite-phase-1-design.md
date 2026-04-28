---
title: "Effect-TS rewrite — Phase 1 design (wipe + reassess + slice + walk)"
date: 2026-04-28
status: approved
predecessor: docs/superpowers/specs/2026-04-28-effect-rewrite-handover.md
supersedes_phase_1_of: docs/adrs/0009-full-rewrite-onto-effect-ts.md
---

# Effect-TS Rewrite — Phase 1 Design

## TL;DR

Phase 1 as written in [ADR-0009](../../adrs/0009-full-rewrite-onto-effect-ts.md)
was an *incremental* port: bolt Effect onto one domain, keep everything else.
This document supersedes that shape with a **clear-the-deck rebuild**:

1. Delete all backend + frontend implementation code.
2. Re-evaluate every replaceable layer against Effect-native alternatives,
   write the deferred ADRs (slots 0011–0016 + new entries) up front.
3. Build one vertical slice end-to-end on the freshly-decided stack.
4. Walk down `docs/capabilities.md` capability-by-capability until the
   contract is restored.

The dev tooling layer, contract docs, and a small, explicit floor of
non-Effect-replaceable infrastructure (React, Vite, TanStack Start,
TanStack Router, Postgres, Better-Auth, Docker, dev tooling) survive.
Everything else is rewritten Effect-native from scratch.

The `stable-pre-effect` tag (commit `80f0684`, branch `stable/pre-effect`)
remains the rollback point. `git reset --hard stable-pre-effect` returns
the repo to a known-good state with zero churn.

## Why a pivot from the handover doc

The handover scoped Phase 1 as: "Node 24 in prod, Effect at the package
level, one Layer for `Db`, one domain rewritten, one tRPC procedure
adapted via `runEffect`, tests green." That's the *minimum-disruption*
adoption shape — keep everything else, prove the pattern works on one
slice, then expand.

Two facts make that shape the wrong fit for this project:

1. **The decision is "100% commitment to Effect ideology"** (per
   brainstorm Q4). The incremental Phase 1 deliberately preserves a
   mixed model: most domains throw `TRPCError`, one domain returns
   `Effect`. ADR-0009 itself rejects mixed models at the service layer
   (§Decision, point 1) but the original Phase 1 still ships one. The
   rebuild eliminates the mixed-model intermediate state entirely.

2. **The deferred ADRs (0011–0016) had "minimize migration cost" as the
   default lean.** That bias only makes sense for an incremental port.
   In a from-scratch rebuild the lean inverts to "pick the
   ergonomically-correct answer for an Effect-native codebase," because
   there is no migration cost to preserve. Several leans likely flip
   (e.g., the lean to keep BullMQ over `ClusterQueue` was about not
   re-doing job-queue plumbing; from scratch, the inverse may hold).

The cost of the pivot is paid in scope: the rewrite is now larger and
slower than the handover's smoke-test Phase 1. The win is a coherent
Effect-native codebase from day one rather than a hybrid that has to be
finished off later.

## Locked decisions (from this brainstorm)

| # | Question | Decision |
|---|---|---|
| Q1 | Wipe scope | **Option C** — delete all backend + frontend implementation code. Keep tooling, contract docs (capabilities.md, Gherkin), Dockerfiles, configs. |
| Q2 | Rebuild trajectory | **A → C** — first vertical slice end-to-end (proves patterns + stack choices), then capability-walk through `docs/capabilities.md`. May switch to C earlier if the slice is patterns-validated sooner. |
| Q3 | Contract discipline | **B (guidance with discipline)** — Gherkin specs + capabilities.md are the spec. Scoped revisions allowed when the new shape genuinely needs them; spec edit + code change land in the same commit, with a one-line note in the spec saying what changed and why. |
| Q4 | Effect ideology depth | **100% commitment** — Effect everywhere it operates. "Thin down things which are unnecessary with Effect." Acknowledged interpretation per Q5b research: Effect operates at the runtime + composition layer, not at the bundler / UI / DB-engine / auth-provider / build-tool layer. |
| Q5 | Floor (non-replaceable infra) | React 19, Vite, TanStack Start, TanStack Router, PostgreSQL, TypeScript, Better-Auth, Docker + Node 24 prod, dev tooling layer (Make, turbo, pnpm, prek, Biome, agent-harness, the 16 lint checks), Storybook, Playwright. |
| Q5b | TanStack Start specifically | **Stays on the floor** — research-driven (see [Phase 1 ecosystem research](#research-tanstack-start-vs-effect-platform)). Community has not converged on `@effect/platform` end-to-end for React SSR; every shipping repo keeps the meta-framework. The adapter boundary lives at `createServerFn` / RPC procedure body and is the smallest possible. |

## Revised phase shape

Replaces ADR-0009's §"Implementation phases" Phase 1 entry. Phases 2–7
of ADR-0009 still apply but flow naturally out of Phase 4 below.

```
0. Commit existing doc work                  (DONE — commit f9f0b83)
1. Clear the deck                            (delete code, retain tooling + contracts)
2. Effect-ecosystem stack assessment         (write ADRs 0011–0016 + new ones)
3. First vertical slice                      (auth bootstrap + todo-list, end-to-end)
4. Capability-walk through capabilities.md   (chip through remaining capabilities)
```

### Phase 1 — Clear the deck

**Delete:**

- `apps/server/`
- `apps/worker/`
- `apps/web/src/` (everything under `src/` — keep `apps/web/` package
  shell + Vite config + tsconfig as the rebuild seed)
- `packages/api/`
- `packages/auth/`
- `packages/db/src/` (keep `prisma/schema.prisma` + package shell;
  the schema is the source of truth for data shape and survives the
  access-layer choice deferred to ADR slot 0013)
- `packages/email/`
- `packages/jobs/`
- `packages/rate-limit/`
- `packages/realtime/`
- `packages/http/` (if present)
- `packages/media/` (if present)
- `packages/query/` (if present)
- `e2e/steps/` (step definitions reference deleted UI selectors;
  Gherkin .feature files in `e2e/features/` are KEPT as the contract)
- `e2e/.features-gen/` (auto-generated)

**Keep:**

- All `docs/`
- `e2e/features/*.feature` (Gherkin contract per Q3)
- `packages/test-infra/` (dev orchestration; orthogonal to runtime —
  retains the dynamic-port-per-worktree harness without which
  `make test` and `make test-unit` cannot boot)
- `packages/env/` (Zod-validated env primitives — slated for
  re-evaluation in Phase 2 against Effect Schema, but the *interface*
  survives)
- `packages/ui/` (shadcn primitives; non-business UI components;
  rebuild may extend, deletes nothing)
- `packages/lint/` (the 16 custom lint checks — orthogonal to runtime)
- All Dockerfiles, docker-compose files, Makefile, turbo.json,
  pnpm-workspace.yaml, .config/, .github/, prek config, .claude/
- `prisma/schema.prisma` (under `packages/db/`)
- The README, CLAUDE.md files at every level (these document
  conventions; they will be updated as Phase 4 lands capabilities)

**Lint-gate handling:** several custom lint checks (`check-trpc-patterns`,
`check-perspective-boundary`, possibly `check-feature-emails`) reference
patterns that disappear with the wipe. These either temporarily exit
0-with-warning or are gated to an empty file-set until Phase 4 restores
the patterns they police. No check is *deleted* in Phase 1 — they're
disabled with a one-line note pointing back to this design doc, and
re-enabled per check as the relevant pattern returns.

**Success criterion:** `make lint` green (against a near-empty source
tree). `make dev` may not boot — that is acceptable for the duration of
Phase 1, since there is no app to serve. `make test` and `make test-unit`
both run zero tests and exit 0.

### Phase 2 — Effect-ecosystem stack assessment

For each replaceable layer, evaluate Effect-native vs current choice and
write the resulting ADR. Decisions are made before code is written for
that layer.

**Layers under review (with default lean given 100% Effect commitment):**

| Slot | Layer | Current | Candidate | Default lean (re-evaluate) |
|---|---|---|---|---|
| ADR 0011 | HTTP framework (server-process) | Hono | `@effect/platform` HttpServer | **Replace** — server-process API (separate from TanStack Start's SSR server) is exactly where `@effect/platform` shines: end-to-end Effect, no adapter |
| ADR 0012 | RPC | tRPC v11 | `@effect/rpc` | **Keep tRPC** with `runEffect` adapter — `@effect/rpc` still 0.75.x, no docs on Effect website, active API churn (per research) |
| ADR 0013 | DB access | Prisma | `@effect/sql` | **Wrap Prisma** — the rewrite preserves the `prisma/schema.prisma` contract; Prisma's typed client wrapped in `Effect.tryPromise` per call inside a `Db` Layer is the smaller, safer change |
| ADR 0014 | Schema validation | Zod 4 | Effect Schema | **Replace with Effect Schema** — server-side this is unambiguous (tagged errors, parse pipelines, Layer integration). Client-side bundle cost is a real concern (Effect issues #5967, #5317) but acceptable given Q4's 100% commitment |
| ADR 0015 | Queue | BullMQ | `@effect/cluster` (`ClusterQueue` when ready) | **Wrap BullMQ** — `ClusterQueue` is not yet production-ready; BullMQ + a `Queue` Layer + `Schedule`-driven retries inside handlers is the pragmatic pick |
| ADR 0016 | Frontend Effect adoption | none | full | **Full** per Q4. Client services return `Effect`. `@effect/rx` for client state in place of TanStack Query where it fits; TanStack Query stays where its query/mutation/cache-invalidation ergonomics genuinely beat what `@effect/rx` provides today (re-evaluate at slice time) |
| ADR 0017 (new) | Logger | pino | Effect's built-in `Logger` | **Replace** — Effect's `Logger` integrates with spans + Layer DI; pino loses its scope-aware advantage in an Effect codebase |
| ADR 0018 (new) | Realtime transport | ws + custom Channel abstraction | `@effect/platform` `Stream` / `Socket` primitives | **Replace** — current `Channel` abstraction (`MemoryChannel` + `RedisChannel`) is hand-rolled structured concurrency over ws. `Effect.Stream` does this natively |
| ADR 0019 (new) | Test runner — backend | Bun + `bun test` | `@effect/vitest` (Vitest + Effect helpers) | **Open** — Bun is 60× faster (per ADR-0003) but lacks `it.effect` + `TestClock` integration. Possible compromise: keep Bun for `@project/api`, use `@effect/vitest` for any package needing `TestClock`. Decide at slice time. |
| ADR 0020 (new) | Email send | nodemailer | nodemailer wrapped in `Mailer` Layer | **Wrap, don't replace** — nodemailer has no Effect-native equivalent; behind a Layer it composes fine |
| ADR 0021 (new) | Rate limiting | rate-limiter-flexible | rate-limiter-flexible wrapped in `RateLimiter` Layer | **Wrap, don't replace** — same rationale as nodemailer |

**Method:** for each ADR, write the decision based on docs + the research
already done. Where docs+intuition is insufficient, run a bounded spike
(≤4h, single-file proof) and *include the spike findings in the ADR*.
Spikes likely needed for: ADR 0011 (`@effect/platform` HttpServer
ergonomics in a real route), ADR 0014 (Effect Schema bundle measurement
on a representative form), ADR 0018 (`@effect/platform` `Socket`
end-to-end with browser ws client).

**Phase 2 success criterion:** ADRs 0011–0021 all written and accepted.
Each has a verified_by entry pointing to where it will be enforced
(future Phase 3 / Phase 4 file paths are acceptable; the
[`check-adrs`](../../../packages/lint/src/check-adrs.ts) check accepts
forward-references as long as the file exists when the ADR is committed
— so verified_by entries point to files that will be created in Phase 3
and the ADR is committed *with* those files in the same commit, or
verified_by points to existing tooling that documents the rule).

### Phase 3 — First vertical slice

**Composition:** auth bootstrap + todo-list, end-to-end.

- **Auth bootstrap** = Better-Auth wrapped in an `Auth` Layer that exposes
  session in Effect context. NOT a full rewrite of auth flows — sign-up,
  sign-in, magic-link, forgot-password are deferred to the
  capability-walk. The slice only needs "user is authenticated" as a
  precondition for todo-list procedures.
- **Todo-list** = the canonical reference domain (per the handover §"Step
  2 — Phase 1 implementation" rationale). Exercises Db Layer, services
  returning `Effect`, RPC procedure adapted via `runEffect`, frontend
  route, optimistic mutations, and at least one Gherkin scenario green.

**Success criteria:**

- `make dev` boots both web (TanStack Start on :3000) and server (`@effect/platform` HttpServer or Hono per ADR 0011, on :3001).
- A signed-in user can create / list / toggle / delete todos via the UI.
- At least one Gherkin scenario from `e2e/features/todo-list/` passes
  via `make test`.
- `make lint && make test && make test-unit` all green.
- Patterns documented inline in the relevant CLAUDE.md files (web
  feature, api domain, db Layer) — these become the source material
  for the rest of the rebuild.

### Phase 4 — Capability-walk

Walk `docs/capabilities.md` capability-by-capability. For each:

1. Restore the capability behind the same import path / public API
   documented in capabilities.md (or update capabilities.md per Q3
   discipline if the new shape diverges).
2. Restore associated Gherkin scenarios in `e2e/steps/` against the new
   UI; run `make test` per capability to confirm green.
3. Re-enable the relevant lint check(s) gated to the now-existing files.
4. Update CLAUDE.md as patterns crystallize.

The walk continues until `capabilities.md` is fully restored. At that
point Phase 4 ends, the Effect rewrite is feature-complete, and any
follow-up work (performance tuning, observability, etc.) is normal
non-rewrite work.

## Open questions (intentionally deferred)

These are real decisions but they're correctly answered later, not now:

- **Test runner final shape (ADR 0019).** Decided at slice time when we
  feel whether `it.effect` / `TestClock` integration is materially
  better than `bun test` + manual `TestClock` plumbing.
- **`@effect/rx` vs TanStack Query split (ADR 0016 detail).** Decided
  per-feature in the capability-walk based on whether the feature's
  data needs are query-cache-shaped (Query) or stream/composition-shaped
  (rx).
- **Worker queue Layer shape (ADR 0015 detail).** Decided when the
  worker is rebuilt in the capability-walk, not in the first slice
  (which doesn't need a queue).
- **Logger sink (ADR 0017 detail).** Console for dev, structured JSON
  for prod is obvious; the open question is whether to ship an OTel
  exporter Layer in this rewrite or defer. Decided at the
  observability capability in the walk.

## Constraints (carry-over from handover)

All constraints from the handover doc remain in force. Restated for
self-containment:

- **No `--no-verify` on commits.** Pre-commit hook is read-only; if it
  fails, fix the cause.
- **`make lint` must stay green** at end of every commit.
- **No PRs.** Solo repo, merge to `main` directly + push.
- **`make` targets**, not manual port juggling.
- **`pnpm` CLI for version bumps**, not hand-edited `package.json`.
- **Gherkin specs in `e2e/features/` are the contract** (revised per Q3
  discipline, not silently deleted).
- **`docs/capabilities.md` must keep holding.** Update in same commit as
  any capability change.
- **Bun stays for inner loop only.** Don't reintroduce Bun in
  Dockerfiles or production paths (per ADR-0010).

## Rollback / abort criteria

Hard rollback: `git reset --hard stable-pre-effect && git push --force-with-lease origin main`.
This requires user authorization at the moment it's invoked (not
pre-authorized by this doc). The tag and `stable/pre-effect` branch
are immutable rollback points.

Triggers that warrant *considering* rollback (not auto-trigger):

- Phase 2 produces ≥3 ADRs that pick "wrap, don't replace" for
  layers we expected to replace. Indicates the Effect ecosystem is
  less ready than assumed; may be cheaper to ship the incremental
  Phase 1 from the handover instead.
- Phase 3 slice takes >2× the time budgeted because of Effect
  ergonomic friction (vs library bugs, which are normal).
- Bundle size on the slice's frontend route exceeds 500 KB gzipped
  with Effect Schema on the client. Indicates ADR 0014 needs revisiting.

## Research: TanStack Start vs effect platform

Summary of the in-session research that locked Q5b. Full transcript in
conversation history.

**Question asked:** When building a React SSR app with full Effect
commitment, do people keep TanStack Start (or Next/Remix) as the
meta-framework with Effect inside loaders / server functions, or drop
the meta-framework and build on `@effect/platform` HttpServer +
`@effect/rpc` end-to-end?

**Finding (clear):** keep the meta-framework.

- Every shipping `effect + react SSR` repo on GitHub (search:
  `effect + tanstack/start`, `effect + next.js`, `effect + remix`)
  keeps the meta-framework and puts Effect inside loaders / server
  functions / RPC routers. Zero notable repos do "@effect/platform
  HTTP + bare React SSR end-to-end."
- Reference repos: `kevin-courbet/tanstack-effect-example` (Mar 2026,
  TanStack Start + Effect + `@effect/rpc` via single gateway route),
  `lelabo-m/lister` (Feb 2026, TanStack Start + Effect + Drizzle +
  Better-Auth — closest analog to this template).
- `@effect/rpc` is still 0.75.x, no docs on the official Effect site,
  ~51 npm dependents, active API churn (last publish ≤3 days before
  research date). Tom MacWright's Jan 2026 read: *"@effect/rpc is
  still on a 0.x release and has no documentation at all on the
  Effect website, so for now, people are going to use tRPC instead."*
- No `@effect/react` package exists. SSR streaming integration with
  `@effect/platform/HttpServer` would be hand-rolled
  (`renderToPipeableStream` → `HttpServerResponse.stream`), losing
  TanStack Router's typed file-based routing + typed loaders + isomorphic
  `createServerFn`. None of the surveyed templates do this.
- No public statement from Effect maintainers (Tim Smart, Michael
  Arnaldi, Patrick Roza) recommending `@effect/platform` end-to-end
  for React SSR.

**Implication for this doc:** Q5b decision (TanStack Start stays on the
floor) is research-validated, not just defaulted. ADR 0011 still applies
to the *separate* server-process API (the `apps/server` HTTP boundary),
where `@effect/platform` HttpServer remains the strong default.

## Next step

After this design doc is committed, hand off to the
[`superpowers:writing-plans`](file:///Users/iorlas/.claude/plugins/cache/claude-plugins-official/superpowers/5.0.7/skills/writing-plans)
skill to draft the concrete file-by-file Phase 1 (clear the deck) and
Phase 2 (stack-assessment ADR drafting) implementation plan. Phases 3
and 4 get their own plans drafted as Phase 2 lands and the slice scope
becomes concrete.
