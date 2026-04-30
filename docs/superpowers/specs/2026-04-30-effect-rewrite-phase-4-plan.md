---
title: "Effect-TS rewrite — Phase 4 plan (capability-walk)"
date: 2026-04-30
status: approved
predecessor: docs/superpowers/specs/2026-04-28-effect-rewrite-phase-1-design.md
phase: 4
---

# Effect-TS Rewrite — Phase 4 Plan

## TL;DR

Phase 3 shipped one vertical slice (auth + todo-list) on Node 24 +
`@effect/platform` + Better-Auth + tRPC + Prisma, validated end-to-end:
8/8 in-slice BDD scenarios green, `make lint` 32/32 green, 5/11 ADRs
accepted. 43 BDD scenarios skipped at gen time pending Phase 4
capabilities.

Phase 4 walks `docs/capabilities.md` capability-by-capability,
restoring each behind its documented import path / public API and
re-enabling its BDD scenarios. The walk ends when `capabilities.md` is
fully restored and all 6 remaining draft ADRs are accepted.

## Inputs

- `docs/capabilities.md` — the capability contract (the spec).
- `e2e/features/**/*.feature` — Gherkin scenarios (the runnable spec).
- `docs/adrs/draft/{0014,0015,0016,0018,0020,0021}.md` — six ADRs that
  promote commit-by-commit as their capability lands.
- Phase 3 commit `aea2bda` is the starting point. `stable-pre-effect`
  remains the rollback tag.

## Capability ordering

Ordered by dependency + risk, not capability count. Each capability is
one or more commits; ordering inside a capability follows the
domain-group recipe (Gherkin → schema → backend → frontend → step
defs → BDD).

| # | Capability group | ADRs promoted | Re-enables scenarios |
|---|---|---|---|
| 1 | Background jobs + crons | 0015 | — |
| 2 | Email send + magic-link sign-in + password reset | 0020 | magic-link.feature |
| 3 | Realtime fan-out (per-entity + user-inbox) | 0018, 0016 (partial) | collaborator-realtime-todos, realtime-{dashboard,navigate-back,reorder} |
| 4 | Activity feed (resumable append-only stream) | 0016 (full) | activity-feed.feature |
| 5 | Collaborators + invitations | — (uses 0018, 0020 already accepted) | collaborators.feature, collaborators-visibility, invitations |
| 6 | Rate limiting | 0021 | (no scenarios — backend primitive) |
| 7 | CASL authorization + admin role + Bull Board mount | — (uses 0015 queues, ADR-0011 outcome 2) | admin/gate.feature |
| 8 | Mobile navigation widget | — | mobile-nav.feature |
| 9 | Schema validation reckoning | 0014 (final promotion or rejection) | — |

### Rationale

**Queue first** because it's the lowest-risk Effect-Layer pattern (wrap
a mature library behind a `Queue` `Context.Tag`). Restoring
`apps/worker/` and `@project/jobs/` re-establishes the cron + worker
layout that several later capabilities depend on. The Bull Board mount
(ADR-0011 §Spike findings outcome 2) was originally slated here but
moves to capability #7 — see "Mid-walk revisions" below.

**Email second** because magic-link + password reset are the highest-
visibility user-facing capabilities still pending, and Email rides on
the queue (every send goes through a job for retry semantics). Closes
the auth domain.

**Realtime third** because it unblocks the largest cluster of skipped
BDD scenarios (4 features) and forces ADR-0018 + the realtime half of
ADR-0016 (the `@effect/rx` vs TanStack Query call). Highest-risk
capability — the Phase 3 design doc explicitly flagged the realtime
spike as the load-bearing decision-loop.

**Activity feed fourth** because it sits on top of realtime
(append-only event stream over the same Channel) and forces the
"frontend Effect adoption full" half of ADR-0016 (the gap-fill + live
+ dedup composition is the canonical `Effect.Stream` use case).

**Collaborators fifth** because it composes realtime + email
(invitation send) + DB transactions (membership cascade). No new ADRs
— it exercises the patterns landed in #1–#4. Validates that the
patterns compose.

**Rate limiting sixth.** Pure backend primitive. Deferred this late
because it has no BDD scenarios — the test surface is unit / integration
only, and unblocking it doesn't accelerate any other capability.

**CASL + admin seventh.** Admin gate scenarios depend on Bull Board
being mounted. Authorization itself is small (a single `Authz`
`Context.Tag` checking `subject.canPerform(action, resource)`) but the
role-wiring composition pattern is what the BDD validates. Bull Board
mount lands here too — see #7 acceptance criteria.

**Mobile-nav eighth.** Single-file widget, smallest possible commit.
Slotted last so it doesn't gate anything.

**Schema validation final.** Phase 3 shipped Zod under ADR-0014
spike-pending. Phase 4 measures the cumulative bundle delta after all
client capabilities are in (auth + todo-list + collaborators +
realtime + activity feed + invitations) and decides Zod-stays vs
Effect-Schema-replaces. Doing this last means the bundle measurement
covers the full client surface, not a fraction.

## Mid-walk revisions

Q3 discipline allows the plan to evolve as execution surfaces facts
the planning didn't have. Each revision lands in a commit alongside
the change it justifies.

### Bull Board mount: #1 → #7 (commit-during-#1)

Original placement put the mount in capability #1 (queue + worker)
because both ADR-0011 §Spike findings outcome 2 and the Phase 4
plan's first draft listed Bull Board with the queue layer.

Revised: mount lands in capability #7 (CASL + admin role).

Reason: Bull Board is dev/admin tooling that has no useful behavior
without an admin-role gate in front of it. Mounting it ungated in #1
ships a security smell that has to be torn down and re-mounted in #7
anyway. The interop shim itself (Hono sub-app + `HttpApp.fromWebHandler`)
is also non-trivial — better paid once with the auth check than twice
without. The `QueueTag.raw()` escape hatch landed in #1 for the future
mount; #7 consumes it.

## Per-capability template

Each capability lands as a sequence of commits following this order:

1. **Capability brief** (1 commit, optional). If the capability needs
   any spec revision per Q3 discipline, edit `capabilities.md` +
   relevant Gherkin in this commit. One-line note in the spec saying
   what changed and why.

2. **Schema** (1 commit, only if Prisma changes). All Prisma model
   changes for the capability. `make db-push` to verify.

3. **Backend** (1 commit). Layers + services + routers + Vitest under
   `packages/api/src/domains/<name>/`. Plus any new `@project/<lib>`
   package the capability needs (`@project/jobs`, `@project/email`,
   `@project/realtime`, `@project/rate-limit`).

4. **Frontend** (1 commit). Hooks + components + routes under
   `apps/web/src/features/<name>/`. UI siblings (stories, hooks tests)
   per `apps/web/CLAUDE.md`.

5. **Step defs + BDD** (1 commit). New step definitions under
   `e2e/steps/<name>/`. Run `make test --grep <name>` until green.
   The `missingSteps: "skip-scenario"` policy means the scenarios
   transition from skipped to running automatically as their step
   defs land — no config change needed.

6. **ADR promotion + lint tightening** (1 commit, optional). If the
   capability promotes an ADR draft, move from `docs/adrs/draft/` to
   `docs/adrs/`, set `status: accepted`, fill `verified_by:` with the
   load-bearing implementation file, add the `// ADR-NNNN` cite. If
   any lint check was relaxed for the slice (e.g.,
   `check-domain-names` allowlist entries for empty domains), tighten
   it now.

`make lint` must be green at end of every commit. `make test` must be
green or strictly-skipped (no new failures introduced) at end of every
commit.

## Per-capability acceptance criteria

### #1 — Background jobs + crons

- `apps/worker/` exists and runs `node --experimental-strip-types
  src/index.ts`. One-shot boot (no watcher), matches the apps/server
  shape per ADR-0010.
- `@project/jobs/` exposes the `Queue` `Context.Tag` with `enqueue`,
  `schedule`, `cancel` methods + a `raw()` escape hatch for the future
  Bull Board mount. `QueueLive` is `Layer.scoped` — opens one BullMQ
  Queue per `QUEUE_NAMES` at boot and closes them on scope release.
- `@project/jobs/` retry policies use `Effect.Schedule` (exponential
  backoff + jitter + max-elapsed), not BullMQ's static
  `attempts`/`backoff` config. ADR-0015 §Decision A.
- Worker handlers are `Effect<A, E, R>` connected to BullMQ via a thin
  `processJob(handler)` adapter in `@project/jobs/process-job`.
- One concrete cron handler shipped: `purge-stale-todos` (delete
  completed todos with `updatedAt` older than 30 days). Bun unit test
  exercises the cutoff boundary.
- `e2e/global-setup.ts` spawns the worker (this was removed in Phase
  3 step 7 with a TODO — restored here).
- ADR-0015 promoted to `accepted`, `verified_by:
  apps/worker/src/index.ts` and `packages/jobs/src/queue-layer.ts`.
  `// ADR-0015` cites added.

**Bull Board mount moved to capability #7** (CASL + admin role). The
admin gate is the natural home for the mount: ungated Bull Board
between #1 and #7 is a security smell, the cleanest mount lives
behind the auth check, and the Hono interop shim that the mount
needs is one new dep — better paid once with the gate than twice
without. See "Mid-walk revisions" below.

### #2 — Email send + magic-link sign-in + password reset

- `@project/email/` exposes a `Mailer` `Context.Tag` with `send(message)
  → Effect<void, MailerError, never>`. `Live` implementation wraps
  `nodemailer.createTransport().sendMail()` inside `Effect.tryPromise`.
  ADR-0020 §Decision A.
- Templates (`magic-link.tsx`, `password-reset.tsx`,
  `invite-collaborator.tsx`) are restored, returning `Effect`-typed
  render functions.
- Magic-link sign-in goes through the email queue
  (Better-Auth's magic-link config calls `mailer.send(…)` inside an
  `enqueue` shape so retries flow through `Effect.Schedule`).
- `e2e/features/auth/magic-link.feature` scenarios pass against the
  e2e Mailpit container.
- ADR-0020 promoted to `accepted`, `verified_by:
  packages/email/src/mailer.ts`.

### #3 — Realtime fan-out

- `@project/realtime/` exposes a `Channel` `Context.Tag` with
  `publish`, `subscribe`. Two implementations selected by env:
  `MemoryChannel` (dev/test single-process) and `RedisChannel`
  (prod multi-process via Redis pub/sub).
- ws upgrade lives on `apps/server` under
  `/ws` with path-prefix discipline per ADR-0008. Built on
  `@effect/platform/Socket` if the spike confirms it works under
  load; otherwise fall back to `ws` library wrapped in an Effect
  Layer (ADR-0018 §Option A).
- `apps/web/src/shared/live/` exposes the leader-tab + relay
  primitives documented in `capabilities.md` Frontend #4.
- ADR-0018 spike runs as part of this capability's backend commit.
  Document spike findings in §Spike findings before promoting.
- ADR-0016 partial promotion: if any feature in this capability uses
  `@effect/rx`, document the per-feature signal that triggered the
  pick. Otherwise stay draft until #4.
- Scenarios green: `collaborator-realtime-todos.feature`,
  `realtime-dashboard.feature`, `realtime-navigate-back.feature`,
  `realtime-reorder.feature`.
- ADR-0018 promoted to `accepted`, `verified_by:
  apps/server/src/realtime.ts` (or wherever the ws upgrade lives).

### #4 — Activity feed

- `@project/api/src/domains/activity-feed/` exposes the resumable
  append-only event stream. Composition: gap-fill (DB query for
  events since cursor) + live (subscribe to Channel for new events)
  + dedup (drop events already in the gap-fill batch). This IS the
  canonical `Effect.Stream` composition documented in
  `capabilities.md` Composition #5.
- Frontend hook composes the stream via `Effect.Stream` →
  `useRx` (or whichever primitive ADR-0016 picks). The hook IS the
  ADR-0016 second-half spike.
- Scenarios green: `activity-feed.feature` (3 scenarios incl.
  resume).
- ADR-0016 promoted to `accepted` if `@effect/rx` was used; rejected
  with a one-line note if TanStack Query alone covered the surface.
  `verified_by:` the activity-feed hook file.

### #5 — Collaborators + invitations

- Membership (CRUD), invitation (email + accept/revoke), realtime
  authorization cascade on removal. No new ADRs — composes the
  patterns from #1 (queue), #2 (email), #3 (realtime).
- Multi-tab leader election scenario validates the leader-tab
  primitive from #3 holds exactly one Web Lock under load.
- Scenarios green: `collaborators.feature`,
  `collaborators-visibility.feature`, `invitations.feature`.

### #6 — Rate limiting

- `@project/rate-limit/` exposes a `RateLimiter` `Context.Tag` with
  `consume(key, points) → Effect<void, RateLimitExceededError, never>`.
  Two implementations: `RateLimiterMemory` (dev/test) and
  `RateLimiterRedis` (prod), selected by env. ADR-0021 §Decision A.
- One representative tRPC procedure (e.g., `auth.signIn`) wires up
  rate limiting via Layer composition. The pattern is the contract;
  full coverage is iterative.
- No BDD scenarios — coverage via Vitest in
  `packages/rate-limit/__tests__/`.
- ADR-0021 promoted to `accepted`, `verified_by:
  packages/rate-limit/src/rate-limiter.ts`.

### #7 — CASL authorization + admin role + Bull Board mount

- `@project/api/src/domains/auth/authz.ts` exposes an `Authz`
  `Context.Tag` with `canPerform(subject, action, resource)`. CASL is
  the underlying engine, wrapped behind the Layer.
- Admin role (`role: "admin"` on User) is seeded in test setup.
- Bull Board mount: `apps/server/src/admin.ts` builds a Hono sub-app
  with `@bull-board/hono`, wires it to the queues from
  `QueueTag.raw()`, and mounts via `HttpRouter.mountApp` +
  `HttpApp.fromWebHandler(honoApp.fetch)`. Hono's `.fetch` is a
  native Web fetch handler — no custom Express adapter needed. ADR-0011
  §Spike findings outcome 2 closes here.
- `/admin/queues` route runs the `Authz` check before delegating to
  the Hono mount; non-admins get 403, anonymous get redirect.
- Scenarios green: `admin/gate.feature` (3 scenarios — anon
  redirect, non-admin 403, admin sees queues).

### #8 — Mobile navigation

- `apps/web/src/widgets/navbar.tsx` restored with viewport-aware
  hamburger menu.
- Scenarios green: `mobile-nav.feature` (2 scenarios).
- The `check-domain-names` allowlist entry for `mobile-nav` stays
  (it's a widget, not a feature folder — design decision unchanged
  from pre-rewrite).

### #9 — Schema validation reckoning

- Run `pnpm --filter @project/web exec vite build` after #8 lands.
  Gzipped client bundle is the cumulative number across all
  capabilities.
- Compare against the Zod baseline from Phase 3 (148 KB total
  gzipped client JS, recorded in ADR-0014 §Spike findings).
- If switching to Effect Schema costs < 30 KB cumulative gzipped on
  the client AND simplifies > 5 places where Zod required a workaround
  (`.transform(Effect)`, manual `Schema` re-derivation, etc.), promote
  ADR-0014 §Decision B (Effect Schema). Otherwise reject with
  `status: rejected` and a one-line note saying Zod won the bundle
  measurement.
- If Effect Schema chosen: rewrite all client form schemas + server
  tRPC input schemas in one commit. This is a mechanical translation
  + Vitest revalidation.

## Workflow

- Per-capability branch policy: capabilities go directly to `main`
  (solo repo, no PRs per CLAUDE.md). Each commit is a logical
  checkpoint; `git reset --hard <prev-commit>` reverts cleanly.
- `make lint` and `make test` must be green at end of every commit.
  `make test --grep <capability-name>` is the inner-loop filter.
- `make fix` runs automatically via the Stop / SubagentStop hooks at
  turn end. Don't run it mid-task unless recovering from a commit
  rejection.
- Subagents (Agent tool) for capabilities with > 4 file edits in a
  single commit. Brief them with the per-capability acceptance
  criteria above + the cross-cutting tool-use discipline from
  CLAUDE.md (Grep/Glob/Read over bash, MultiEdit over chained Edits).
- A spike inside a capability (realtime ws under load, Effect Schema
  bundle measurement) lands in the same commit as the implementation
  it informed — no throwaway-spike branches per Phase 1 §"first slice
  IS the spike" workflow.

## Constraints (carry-over)

All Phase 1–3 constraints remain in force:

- No `--no-verify` on commits / pushes. Pre-commit is read-only —
  fix the cause, don't bypass.
- `make lint` green at end of every commit.
- No PRs. Solo repo, merge to `main` directly + push.
- `make` targets, not manual port juggling.
- `pnpm` CLI for version bumps.
- Gherkin specs in `e2e/features/` are the contract per Q3
  discipline. Spec edit + code change in the same commit.
- `docs/capabilities.md` updates land in the same commit as any
  capability change.
- Bun stays for inner loop only (test runner, scripts). Don't
  reintroduce in Dockerfiles or production paths per ADR-0010.

## Rollback / abort criteria

Phase 4 is open-ended; abort triggers per capability, not per phase:

- **Single-capability abort.** If a capability's ADR spike fails the
  promotion gate (e.g., realtime under `@effect/platform/Socket`
  can't sustain load), fall back to the option-A wrap-existing-library
  shape and document why in §Spike findings. Capability lands; ADR
  picks the fallback.
- **Multi-capability abort.** If three consecutive capabilities hit
  unforeseen blockers that force major design revisions, pause the
  walk and write a Phase 4.5 design doc revising the remaining
  ordering. This has not happened to date (Phases 1–3 ran clean).
- **Full Phase 4 abort.** `git reset --hard stable-pre-effect`
  remains the nuclear option. Cost: lose Phase 1–3 work (~3 weeks
  + the slice). Bar for triggering: a foundational pattern (Layers,
  `runEffect`, the catch-all mount) needs to change across the entire
  codebase. Has not happened to date.

## End-state

Phase 4 ends — and the Effect-TS rewrite is feature-complete — when:

1. All 9 capabilities listed above are accepted (commit + lint + BDD
   green per the per-capability acceptance criteria).
2. All 6 remaining draft ADRs are accepted or rejected (no drafts
   left).
3. `make test` runs zero scenarios under `missingSteps: "skip-scenario"`
   (every Gherkin feature has step defs).
4. `docs/capabilities.md` has no "removed in Phase 1, restoration
   pending" notes — every capability is either restored or has a
   one-line note saying "removed permanently per Q3 discipline."

After Phase 4: any further work (performance tuning, observability
expansion, new features) is normal product work, not part of the
rewrite.

## References

- [Phase 1 design doc](2026-04-28-effect-rewrite-phase-1-design.md)
- [Phase 1 + 2 plan](../plans/2026-04-28-effect-rewrite-phase-1-2-plan.md)
- [docs/capabilities.md](../../capabilities.md) — the contract
- [docs/adrs/draft/](../../adrs/draft/) — the 6 pending ADRs
- `stable-pre-effect` git tag (commit `80f0684`) — rollback point
- Phase 3 closing commit: `aea2bda` (post-validation cleanup)
