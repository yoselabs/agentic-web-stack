# Post-testing Fixes + User-Inbox Realtime — Handover

## Status

Branch `feat/post-testing-fixes` is feature-complete — 19 commits
covering every item in the plan. **Not merged yet.** Awaiting your
decision on three open items (below) and then a PR → main.

## What landed

Spec: `docs/superpowers/specs/2026-04-19-post-testing-fixes-design.md`
Plan: `docs/superpowers/plans/2026-04-19-post-testing-fixes-plan.md`
ADR-001: `docs/adrs/0001-realtime-architecture.md` (Accepted)

All 11 human-testing items shipped:
1. Public homepage + site-wide Navbar (was auth-gated) — Task 10.
2. Password hint only on signup, not signin — Task 11.
3. Signup form validates onBlur + onSubmit, not onChange — Task 11.
4. Invite username autocomplete + inline "No user" error — Task 12.
5. Pending-invitations UI on both invitee (dashboard) and owner (share
   dialog) sides — Task 13.
6. Absolute invite URL in emails — Task 14 (initial) + Task 17 follow-up
   (introduced `env.WEB_URL`, see Critical Correction below).
7. Collaborators list shows owner + `(You)` + role badges — Task 8.
8. Wrong-slot bug on collaborator-added todos fixed — Task 15 (client
   handler now mirrors server `shiftActivePositions`).
9. _(Todo item editing — explicitly deferred, not in scope.)_
10. List detail refetches on mount when navigating back — Task 16.
11. Dashboard list counters update live via new user-inbox channel —
    Tasks 3–5, 9.
12. Admin-only `Jobs Admin` menu entry — Task 10 (gated by
    `session.user.role === "admin"`, points at
    `${VITE_API_URL}/admin/queues/`).

Cross-cutting additions:
- User-inbox realtime channel (`user:<userId>`) — primitive helpers in
  `packages/realtime/src/user-inbox.ts`, domain router + SSOT tuple in
  `packages/api/src/domains/user/`, client dispatch in
  `apps/web/src/features/user/use-user-inbox.ts`.
- Timestamp convention: `updatedAt` added to `TodoListMembership` and
  `TodoListInvite`.
- Aggregation-modules convention section in `docs/conventions.md`.
- `env.WEB_URL` added (public web UI origin, distinct from
  `BETTER_AUTH_URL` which is the API).
- `user` domain added to `scripts/check-domain-names.ts` allowlist
  (backend + web only; e2e coverage is via `todo-list/` scenarios).

## Critical correction applied mid-flight

The spec originally specified `${env.BETTER_AUTH_URL}/invites/<token>`
for invite email links. Denis caught that `BETTER_AUTH_URL` is the API
origin (port 3001), not the UI (port 3000) — broken link in prod. Fixed
by introducing `env.WEB_URL` in `packages/env/src/server.ts` with dev
default `http://localhost:3000`, and updating `test-infra` to inject it
from the per-suite web port. Commit: `fedbd6a`.

This is a lesson worth carrying: when the spec references an env var
for constructing user-facing URLs, verify which origin it names.
`BETTER_AUTH_URL` ≠ "public web URL" — it's "where Better-Auth handlers
are mounted".

## SSR regression encountered and worked around (Task 17)

Lifting the Navbar to `__root.tsx` in Task 10 transitively pulled
`@radix-ui/react-dialog` (via shadcn `Sheet`) into the SSR entry chunk.
The bundler's CJS interop for `tslib` produces a broken
`__toESM(...).default`, crashing every SSR route at module-load with
`Cannot destructure property '__extends'`.

Workaround shipped: `MobileNav` split into its own module and
lazy-loaded via `React.lazy` (`apps/web/src/widgets/mobile-nav.tsx`).
That removes Radix from the SSR entry graph. All routes SSR cleanly;
BDD tests pass.

The underlying tslib interop issue is NOT fixed — it's merely pushed to
the lazy chunk. Visible symptom: during BDD the SSR error still logs
when Bull Board iframes render (the queue-retry scenario), but React
Suspense swallows the failure and the client hydrates normally. Worth
revisiting if we find another component hitting the same interop.

## Test suite state at HEAD (`fedbd6a`)

| Check | Result |
|---|---|
| `make lint` | ✅ PASS (15/15) |
| `make test-unit` | ✅ PASS (92/92, 171 expects) |
| `make test` (BDD, full parallel) | 45 pass, 1 flake |
| `make test` for the flake in isolation | ✅ PASS |

**The one flake:** `email/queue-retry.feature > Failed invite surfaces
in Bull Board and manual retry delivers`. Times out at 30s in the full
parallel suite only. Passes cleanly in isolation (7.8s).

Root cause of flake (confirmed pre-existing, not a regression from this
branch): the scenario globally stops + starts the Mailpit container to
simulate SMTP down-time. That's visible to every sibling scenario in
parallel workers, and Mailpit restart (~2–5s) drifts the affected test
past its timeout under load.

## Three open items (need your decision)

### 1. Queue-retry BDD scenario is in the wrong layer

The flake is a symptom of a design issue: this scenario tests BullMQ
retry semantics and Bull Board visibility — infrastructure and a 3rd-
party UI, not user-facing behavior. The project's own `e2e/CLAUDE.md`
table explicitly says "Error recovery (retry, fallback) | Rarely BDD |
Yes Vitest".

**Recommendation:** move it to
`packages/jobs/__tests__/email-retry.test.ts` (or similar) using a
controllable SMTP test transport instead of killing the Mailpit
container. Delete the BDD scenario. Runs in ~100ms instead of 30s, no
parallelism issue, same contract coverage.

**Not in scope for this branch** — logged here for follow-up.

### 2. tslib SSR interop issue

The Radix `Sheet` via the Navbar mobile hamburger pulls a `tslib`
pattern that rolldown/vite can't resolve cleanly for SSR. Lazy-loading
MobileNav works around it. A permanent fix would be:
- Swap `Sheet` for a simpler non-Radix mobile drawer, OR
- Add a rolldown/vite config to force `tslib` as ESM.

**Not in scope** — flag for a future tidying pass.

### 3. Merge strategy

Branch is 19 commits ahead of `main`. Options:
- **Squash into main** — cleanest git log, single history entry.
- **Rebase + merge** — keeps per-task commits visible (matches the
  plan phasing 1:1, useful for future archaeology).
- **Open a PR** — trigger CI, allow review.

## Commit log (newest first)

```
fedbd6a fix(api): use WEB_URL (not BETTER_AUTH_URL) for invite email link
a8e2eea test(e2e): BDD coverage for post-testing fixes
f94884d fix(web): invalidate list-detail queries on mount
b5c8e92 fix(web): todo-created handler mirrors server position shift
01860c3 fix(api): absolute invite URL in email body
667f120 feat(web): pending-invites UI on dashboard + share dialog
d0bb489 feat(web): invite autocomplete + no-user error in share dialog
79c39d5 feat(web): auth form validates onBlur + onSubmit, splits signin/signup
1d5570f feat(web): site-wide navbar with admin-gated Jobs Admin link
3e3c0e3 feat(web): user-inbox subscription + dispatch map
e230588 feat(todo-list): include owner + role badges in collaborator list
15ed975 feat(api): user.searchByUsername for invite autocomplete
9abed06 feat(api): invite lifecycle — decline/revoke + pending-invites queries
0a22a44 feat(api): fan out user-inbox events from todo-list mutations
fdb6269 feat(api): user domain scaffolding + onInboxEvent subscription
8f50b85 feat(realtime): user-inbox helpers (key, publish, fan-out)
2518fca feat(db): add updatedAt to TodoListMembership + TodoListInvite
f78f876 docs(adr): tighten applies-to scope; fix illustrative import path
88c1e07 docs: import ADR-001 realtime architecture + conventions
```

## What the next session should do

1. Smoke the happy paths in dev one more time (two browsers: owner
   adds todo; collaborator adds todo; dashboard counters update).
2. Pick a merge strategy (above) and execute.
3. Decide on item 1 (move queue-retry to integration) — either fix now
   or log as a separate ticket.
4. Item 2 (tslib SSR) can stay as-is; lazy-load is a stable workaround.
