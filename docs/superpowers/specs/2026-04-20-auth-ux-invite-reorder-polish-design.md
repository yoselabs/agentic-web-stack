---
title: "Auth UX split, invite `@` fix, widget placement, reorder realtime asymmetry"
status: Proposed
applies-to: apps/web/src/routes, apps/web/src/features/auth, apps/web/src/features/todo-list, packages/api/src/domains/user, packages/api/src/domains/todo-list, e2e/features/todo-list
---

# Auth UX + Invite Polish + Reorder Fix

## Goals

Five user-facing polish items bundled into one spec because they share review cycles and are individually small. BDD coverage for the two escaped defects is a cross-cutting concern.

1. Split `/login` into dedicated `/login` and `/signup` routes, keep Better-Auth's existing `forgot-password` / `reset-password` flow untouched.
2. Fix invite autocomplete: typing or re-editing `@alice` must still invite alice. Root cause is that the UI's post-select display value (`@alice`) feeds back into the search, and the server doesn't tolerate the `@` prefix.
3. Surface the pending-invites widget on `/todo-lists` in addition to `/dashboard`.
4. Fix realtime reorder asymmetry: collaborator-initiated reorder must propagate to the owner without a refresh.
5. Add BDD + unit tests that would have caught bugs #2 and #4.

## Non-goals

- Email-first unified auth flow (single input that branches on existence).
- Password-reset redesign. Better-Auth's `sendResetPassword` email flow stays as-is.
- Signup form field changes (name / username / email / password stay).
- Broader BDD audit of invite / reorder / auth flows beyond the two targeted gaps.
- Changes to `packages/auth/src/index.ts` — all auth behavior already present.

---

## Section 1 — Auth route split

### Files created

- `apps/web/src/features/auth/sign-in-form.tsx` — form component. Owns its own Zod schema (`signinSchema`), calls `signIn.email`, uses `auth-client` directly. No props.
- `apps/web/src/features/auth/sign-up-form.tsx` — form component. Owns `signupSchema`, calls `signUp.email`, carries the username-default-from-email fallback (`value.username || value.email.split("@")[0]`). No props.
- `apps/web/src/routes/signup.tsx` — new route mirroring `login.tsx` structure:
  - `beforeLoad`: if `context.session`, redirect to `/dashboard`.
  - Renders `<SignUpForm />`.
  - Cross-links: "Already have an account? Sign in" → `/login`. "Forgot password?" → `/forgot-password`.

### Files modified

- `apps/web/src/routes/login.tsx`:
  - Remove `isSignUp` state and the signup branch (form fields + `signUp.email` call).
  - Render `<SignInForm />` only.
  - Cross-links: "Need an account? Sign up" → `/signup`. "Forgot password?" → `/forgot-password` (already exists).

### Cross-link topology

```
/login    ──► SignInForm
            ├─ "Need an account? Sign up"   → /signup
            └─ "Forgot password?"           → /forgot-password

/signup   ──► SignUpForm
            ├─ "Already have an account? Sign in" → /login
            └─ "Forgot password?"                 → /forgot-password

/forgot-password   (unchanged — Better-Auth sendResetPassword email flow)
/reset-password    (unchanged — Better-Auth token validation flow)
```

"Forgot password?" on `/signup` is unusual but harmless — it's an escape hatch for users who landed on signup by mistake and remember they already have an account.

### Guards (unchanged)

Both `/login` and `/signup` redirect to `/dashboard` if `context.session` exists.

### Auth-client contract (unchanged)

`apps/web/src/features/auth/auth-client.ts` continues to export `signIn`, `signUp`, `signOut`, `useSession`. No method additions, no signature changes.

---

## Section 2 — Invite `@` fix

### Root cause

`apps/web/src/features/todo-list/invite-autocomplete.tsx:54` sets the input's display value to `@${username}` when the user clicks a suggestion. The input is ALSO the source of the search prefix sent to `trpc.user.searchByUsername`, so the next render sends `@alice` to a server that expects `alice`. Similarly, users typing `@alice` by hand hit the same wall. The actual invite-submit path uses `selected.username` (clean) so the happy-path click-through works once; subsequent edits break.

### Fix — server-side normalization (single point of change)

#### `packages/api/src/domains/user/user-service.ts` — `searchUsersByUsername`

Before the existing `startsWith` query:

```ts
const normalized = prefix.trim().replace(/^@+/, "");
// use `normalized` in the startsWith query
```

#### `packages/api/src/domains/todo-list/service.ts` — `inviteCollaborator`

Before the `findUnique({ where: { username } })` lookup:

```ts
const username = rawUsername.trim().replace(/^@+/, "");
```

Error message stays `No user with username "${username}"` and now echoes the cleaned form — which matches what the user sees in the input.

### Edge cases

- `@alice` → `alice`
- `@@alice` → `alice` (greedy strip)
- ` alice ` → `alice` (trim)
- `""` / `"@"` → empty; existing min-length guard in the service handles it.

### Client stays as-is

`invite-autocomplete.tsx:54` continues to display `@${username}` on select. That's correct UI behavior. The input remains the search source; the server now tolerates the prefix.

### Why server, not client

One change covers: typed `@alice`, re-edit after selection, future callers (mobile, direct API). No per-caller discipline required. Same rationale as the "authz at publish time" pattern in ADR-001 — normalize at the boundary, not at each consumer.

---

## Section 3 — Pending invites widget placement

### Change

`apps/web/src/routes/_authenticated/todo-lists/index.tsx`:

- Import `PendingInvitesDashboard` from `#/features/todo-list/pending-invites-dashboard`.
- Render above the "Todo Lists" heading, so invites are seen before browsing owned lists.
- Pass `trpc` from `Route.useRouteContext()`.

### No other changes

- `/dashboard` keeps the widget (unchanged).
- Component is already generic (accepts `trpc`, no route-specific state, renders minimal/nothing when there are no invites).
- No new queries, no backend changes.

---

## Section 4 — Reorder realtime asymmetry

### Symptoms

- Owner reorders → collaborators see the new order live.
- Collaborator reorders → owner does NOT see the new order until a manual refresh.

### What's *not* the cause

The subagent's initial "missing `publishCountersChanged`" hypothesis is wrong:

- `reorderTodos` (`packages/api/src/domains/todo-list/todo-service.ts:160-187`) publishes `todos-reordered` to `listChannelKey(todoListId)` regardless of actor.
- `event-handlers.ts:67` applies `setQueryData` symmetrically for any recipient.
- Both viewers subscribe via `use-todo-list-live-updates.ts` while on the list-detail page.
- Reorder doesn't change counts, so `publishCountersChanged` isn't the relevant channel.

The asymmetry is real but the mechanism is not yet pinned.

### Investigation steps (run first in implementation)

1. **Server-side log** in `reorderTodos` immediately before `.publish(...)`: log `{actorUserId, todoListId, positionsLen}`. Confirms publish fires on a collab-initiated reorder.
2. **Client-side log** in `event-handlers.ts` `todos-reordered` handler: log `{kind, listId, source}` where `source` is `"network"` for direct tRPC delivery and `"broadcast"` for BroadcastChannel relay from a leader tab. Confirms the owner's tab receives the event at all.
3. **Replay timing** — run the repro twice: (a) owner's window focused, (b) owner's window in a background tab. Tab focus state affects BroadcastChannel delivery and WS behavior under Chrome's throttling.

### Leading hypotheses (ordered by prior probability)

1. **Optimistic-update stomping.** `use-todos.ts`'s `handleDragEnd` writes an optimistic order. The mutation's `onSettled`/`onSuccess` likely invalidates `trpc.todo.list`. The actor's tab sees: optimistic → mutation response → event (harmless, same order). The owner's tab sees: event arrives (applies order) → actor's mutation response fan-out hits some query invalidation → refetch returns stale-but-authoritative order → owner sees old order. This is the most likely cause because it explains the directional asymmetry (actor vs non-actor).
2. **Leader-tab relay filtering.** If the owner is a non-leader tab, events arrive via BroadcastChannel from the leader. A filter bug could drop `todos-reordered` while passing `todo-*` kinds.
3. **Event race with concurrent invalidation.** If something else (e.g., counter invalidation via user-inbox) runs at a similar time, it may refetch and overwrite the `setQueryData` from the reorder event.

### Fix constraint

Fix must preserve optimistic-update snappiness for the actor (no visible lag on the dragged item) while applying the correct post-commit order on remote viewers. Expected patch size: ≤20 LOC in one or two files.

### Deferred to implementation

Plan phase runs the investigation steps, identifies the mechanism, applies the minimal fix, verifies with the BDD scenario in Section 6.

---

## Section 5 — Test coverage

### Unit tests (strip-`@` normalization)

#### `packages/api/src/domains/user/__tests__/user-service.test.ts`

Add cases for `searchUsersByUsername`:

- `@alice` matches user `alice`.
- `@@alice` matches user `alice` (greedy strip).
- ` @alice ` (whitespace) matches.
- Empty prefix and bare `@` return empty result without crashing.

#### `packages/api/src/domains/todo-list/__tests__/invites.test.ts`

Add cases for `inviteCollaborator`:

- Invites succeed when `username` arg is `"@bob"`.
- Missing-user error message echoes the normalized username: `No user with username "bob"` (not `"@bob"`).

### BDD (reorder propagation)

#### New file: `e2e/features/todo-list/realtime-reorder.feature`

```gherkin
Feature: Realtime reorder propagation

  Scenario: Collaborator reorder propagates to owner in realtime
    Given "alice" owns "Shared groceries" with todos "Milk, Eggs, Bread"
    And "bob" is a collaborator on "Shared groceries"
    And both users have "Shared groceries" open
    When "bob" drags "Bread" above "Milk"
    Then "alice" sees the new order "Bread, Milk, Eggs" within 3s
```

Reuses existing multi-browser-context pattern from other `realtime-*.feature` files (see `docs/testing-guidelines.md`).

New step definitions needed:

- `When {string} drags {string} above {string}` — drag-and-drop between two todo titles.
- `Then {string} sees the new order {string} within {int}s` — asserts visible text order, polls up to N seconds.

### Why this split

- `@` normalization is a pure server-side transformation. Unit tests hit the boundary directly, run in `make test-unit`, no browser.
- Reorder propagation is realtime delivery across two clients. Only BDD expresses it faithfully; no unit-test substitute makes sense for WS event fan-out timing.

Each test matches exactly one escaped defect.

---

## Rollout

Single PR. Order within the PR (each step green before the next):

1. Server: `@` normalization + unit tests → `make test-unit` green.
2. Auth route split: extract forms, add `/signup`, update `/login`, cross-links → `make lint` + manual click-through.
3. Widget placement: add `PendingInvitesDashboard` render on `/todo-lists` index → visual verify.
4. Reorder investigation + fix + BDD scenario → `make test` green.

No database migrations. No dependency changes. No breaking API changes (server normalization is additive: legacy clean inputs continue to work unchanged).

## Risks

- **Reorder fix uncertainty.** The spec defers the fix mechanism to plan phase after investigation. If all three hypotheses are wrong, the investigation loop widens. Mitigation: logs are cheap to add and remove; BDD scenario confirms the fix regardless of mechanism.
- **BDD drag-and-drop flake.** DnD tests across two browser contexts are historically flaky. Mitigation: use the same TouchSensor + MouseSensor pattern already working elsewhere in this repo (see root CLAUDE.md's DnD note).
- **Cross-link copy.** "Forgot password?" on `/signup` may confuse some users. Defer to team review of copy; link functionality is harmless.

## References

- `packages/auth/src/index.ts` — Better-Auth config (unchanged).
- `docs/adrs/0001-realtime-architecture.md` — user-inbox channel pattern (referenced for authz-at-publish rationale).
- `docs/testing-guidelines.md` — multi-browser-context BDD pattern.
- `apps/web/CLAUDE.md` — FSD layer rules, DnD sensor guidance.
