# Post-testing fixes + User-Inbox realtime pattern

## Context

Human testing surfaced 12 issues in the todo-list template spanning
homepage, auth-form UX, invitations, collaborators, realtime/cache
correctness, and admin navigation. One issue (todo item editing) is
deferred; the rest are bundled into a single spec because they must
ship together today and most benefit from landing in a single review.

Three cross-cutting additions sit alongside the per-issue fixes:

1. **User-inbox realtime channel** — a new channel pattern (`user:<userId>`)
   for cross-feature UI surfaces (dashboard counters, access-revocation
   notices, pending-invite notifications). Addresses three of the
   correctness issues at once and establishes the pattern the future chat
   domain will reuse.
2. **ADR-001 imported to this repo** — the authoritative rationale for the
   user-inbox pattern + Live+Snapshot reconciliation + watermark gap
   detection. Imported verbatim minus external-repo references; status set
   to **Accepted** in the same commit that implements it.
3. **Model-timestamp convention** — strict rule that every
   application-owned model carries `createdAt` + `updatedAt`. Two existing
   join tables (`TodoListMembership`, `TodoListInvite`) gain `updatedAt`;
   convention documented in `docs/conventions.md`.

## Non-goals

- Todo item editing (deferred — tracked separately).
- Invite by email to a non-existing user (schema requires `invitedUserId`
  FK; enabling invite-by-email needs a nullable FK + signup-time accept
  flow — out of scope).
- Retrofitting watermark gap detection onto the existing `todo-list:<id>`
  channel's ordered payload events. The ADR's gap-detection machinery is
  documented and wired in for notification-shape events on the new user
  channel (minimal form — `onStarted` invalidation only); retrofitting
  the list channel waits until an ordered-payload event on the user
  channel demands it.
- Per-list client subscriptions for dashboard live updates (rejected in
  favor of user-inbox pattern).
- Replacing the `todo-list:<id>` per-entity channel. It stays; user-inbox
  is additive, not a replacement.

---

## Part 1 — Cross-cutting architecture additions

### 1.1 User-Inbox channel

Every logged-in user has exactly one inbox channel keyed `user:<userId>`.
The server fans out on publish: when a mutation in any domain should
notify user U (a list gained/lost a todo that affects U's dashboard
counters; U was invited/added/removed from a list), the mutation emits
a `UserInboxEvent` to U's inbox channel.

**Client side.** The dashboard and any top-level UI surface subscribe
once to the inbox stream (on login/app-mount). The subscription
dispatches by `event.kind` via a per-kind handler map, matching the
`event-handlers.ts` pattern already established for the list channel.

**Authz.** The subscription is viewer-scoped — a user can only subscribe
to their own inbox; the channel key is derived from `ctx.session.user.id`,
not from user input. Authz at publish time: the server decides who
receives each event based on current membership/authz state, so a user
who just lost access stops receiving events for that list from the next
publish onward.

**Reconnect glue.** The subscription's `onStarted` callback fires on
initial connect AND every reconnect. It invalidates a hand-enumerated
list of live-backed query keys (dashboard list, accessible-lists,
pending-invites). TanStack Query refetches each, closing any gap
accumulated during a disconnect. This is the minimal form of the
Live+Snapshot reconciliation defined in ADR-001; watermark gap detection
is not needed because all user-inbox events in this spec are
notification-shape.

### 1.2 Package layout

**Shared realtime primitives** live in `@project/realtime`. Domain-specific
event unions live in their owning domain.

```
packages/realtime/src/
  channel.ts             # existing
  memory-channel.ts      # existing
  redis-channel.ts       # existing
  types.ts               # existing
  user-inbox.ts          # NEW — shared helpers:
                         #   userInboxChannelKey(userId)
                         #   publishToUserInbox(factory, userId, event)
                         #   fanOutToMembers(factory, userIds, event)

packages/api/src/domains/user/
  user-events.ts         # SSOT tuple USER_INBOX_EVENT_KINDS, type UserInboxEvent
  user-router.ts         # onInboxEvent subscription (viewer-scoped)
  subscribe-to-user-inbox.ts  # async-gen matching subscribeToListEvents shape
```

**Dependency direction.** Domains that publish to user channels
(`todo-list` today; `chat` tomorrow) import the event-kind type from
`@project/api/domains/user/user-events`. The `user` domain does NOT import
from other domains. The SSOT tuple lists every inbox kind explicitly,
following the same convention as `TODO_LIST_EVENT_KINDS`.

### 1.3 Event kinds introduced by this spec

All notification-shape. Kebab-case with domain prefix, matching the
existing convention.

```ts
export const USER_INBOX_EVENT_KINDS = [
  "todo-list-counters-changed",    // list counts changed (add/delete/complete)
  "todo-list-access-granted",      // user added to / accepted into a list
  "todo-list-access-revoked",      // user removed from a list
  "todo-list-invites-changed",     // the recipient's pending-invites view may have changed
] as const;

export type UserInboxEventKind = (typeof USER_INBOX_EVENT_KINDS)[number];

export type UserInboxEvent =
  | { kind: "todo-list-counters-changed"; listId: string }
  | { kind: "todo-list-access-granted"; listId: string }
  | { kind: "todo-list-access-revoked"; listId: string }
  | { kind: "todo-list-invites-changed"; listId: string };
```

`todo-list-invites-changed` is the single kind for every invite-lifecycle
transition — created, accepted, declined, revoked. The handler
invalidates the recipient's relevant queries; details of "what changed"
come from the refetch, not the event payload (notification-shape).

### 1.4 Publisher wiring (server side)

Publishers are added to the following todo-list-service mutations, in
addition to the existing `todo-list:<id>` channel publishes they already do:

| Mutation                  | Emit to user-inbox (recipients)                                       | Kind                            |
|---------------------------|-----------------------------------------------------------------------|---------------------------------|
| `createTodo`              | all members (owner + collaborators) of the list                       | `todo-list-counters-changed`    |
| `deleteTodo`              | all members                                                           | `todo-list-counters-changed`    |
| `completeTodo`            | all members                                                           | `todo-list-counters-changed`    |
| `uncompleteTodo`          | all members                                                           | `todo-list-counters-changed`    |
| `inviteCollaborator`      | invitee only                                                          | `todo-list-invites-changed`     |
| `acceptInvite`            | owner + existing collaborators + the accepter (access-granted); owner (invites-changed)              | `todo-list-access-granted` + `todo-list-invites-changed` |
| `declineInvite` (new)     | owner only                                                            | `todo-list-invites-changed`     |
| `revokeInvite` (new)      | invitee only                                                          | `todo-list-invites-changed`     |
| `removeCollaborator`      | the removed user                                                      | `todo-list-access-revoked`      |
| `deleteTodoList`          | every member except the deleter                                       | `todo-list-access-revoked`      |

Publishers are fire-and-forget after the transaction commits, mirroring
the existing `publishToChannel` pattern in `todo-service.ts`. A
membership lookup is required per mutation to enumerate recipients;
authz gate queries already fetch this data for permission checks, so the
marginal cost is one reuse.

### 1.5 Client-side dashboard hook

New hook in `apps/web/src/features/user/use-user-inbox.ts` (new feature
folder, mirrors `packages/api/src/domains/user/`). Responsibilities:

- Open the tRPC subscription on `user.onInboxEvent` when the user is
  logged in.
- In `onStarted`, invalidate `todoList.list` and `todoList.listAccessible`
  and `todoList.myPendingInvites`.
- In `onData`, dispatch by `event.kind` via a handler map. Handlers
  invalidate the affected queries (all notification-shape here):
  - `todo-list-counters-changed` → invalidate `todoList.list` + `todoList.listAccessible`.
  - `todo-list-access-granted` → invalidate `todoList.listAccessible`.
  - `todo-list-access-revoked` → invalidate `todoList.list` + `todoList.listAccessible` + `todoList.get({ id: listId })` (matches existing revoke-invalidation pattern in `todo-list/event-handlers.ts`).
  - `todo-list-invites-changed` → invalidate `todoList.myPendingInvites` + `todoList.pendingInvites({ listId })`.

Leader-tab multiplexing (BroadcastChannel relay pattern from
`use-todo-list-live-updates.ts`) is included from the start — without it,
a user with 3 tabs opens 3 inbox subscriptions.

### 1.6 ADR-001 import

Copy `ADR-001 — User Inbox Channel + Live+Snapshot Reconciliation` to
`docs/adrs/0001-realtime-architecture.md` with these edits only:

- Status: `Accepted`.
- Remove any external-repo file path references (`docs/requirements/inputs/*`,
  `docs/requirements/pitches/*`) — replace with generic language ("the
  app's requirements", "the product's scale target").
- Remove `§`-style references to external spec sections — replace with
  inline descriptions of the force they represent.
- Remove the Rollout section's "Pitch 1 / Pitch 2+" framing — replace
  with a short note: "This ADR is realized in `packages/api/src/domains/user/`
  (user-inbox channel) and `packages/api/src/domains/todo-list/` (per-entity
  channel, retained for focused single-entity collab)."
- Remove frontmatter `date`, `supersedes`, `superseded-by`.
- Otherwise keep content verbatim — the chat-example code snippets stay
  because they're the clearest illustration of the pattern.

The imported ADR is linked from `docs/conventions.md` (see 1.8).

### 1.7 Timestamp convention

`createdAt DateTime @default(now())` + `updatedAt DateTime @updatedAt` on
every application-owned model, including join/link tables. Better-Auth
tables follow Better-Auth's schema (no change).

Schema changes this spec:

- `TodoListMembership` — add `updatedAt DateTime @updatedAt`.
- `TodoListInvite` — add `updatedAt DateTime @updatedAt`.

Documented in `docs/conventions.md` (see 1.8). Not lint-enforced today;
code review catches it.

### 1.8 `docs/conventions.md` additions

Two new sections appended. Content is strict and short; detail deferred
to the ADR.

```markdown
## Realtime channel granularity

Two channel patterns in this codebase:

- **Per-entity channel** (`<entity>:<id>`) — focused single-entity
  collab with low event rates and static authz. Subscribers open/close
  on mount/unmount of the entity view. Reference:
  `packages/api/src/domains/todo-list/` (channel `todo-list:<listId>`).

- **User-inbox channel** (`user:<userId>`) — persistent cross-feature
  UI surfaces (dashboard counters, sidebar unread, access revocations,
  presence). One subscription per user; server fans out on publish;
  authz enforced at publish time. Reference:
  `packages/api/src/domains/user/`.

Default to per-entity. Add user-inbox alongside it when a domain needs
a cross-feature UI surface that outlives any single entity view.

Rationale, Live+Snapshot reconciliation, watermark-based gap detection
for ordered payload events — see [ADR-001](adrs/0001-realtime-architecture.md).

## Timestamps on models

Every application-owned model has:

- `createdAt DateTime @default(now())`
- `updatedAt DateTime @updatedAt`

Join/link tables included (they represent edges that can be updated).
Better-Auth-owned tables follow Better-Auth's schema.
```

---

## Part 2 — Per-issue design

### 2.1 Homepage + optional auth + top nav (issues #1, #12)

**Routing.**
- `/` stays public. Current hero-style homepage kept; copy tweaked only
  if needed for coherence.
- `_authenticated` guard stays on `/dashboard`, `/todo-lists/*`.
- Public routes: `/`, `/login`, `/forgot-password`, `/reset-password`,
  `/invites/$token`.
- No new route needed for "Jobs Admin" — it points to the external
  BullMQ board at `VITE_API_URL + "/admin/queues/"`.

**Site-wide navbar.** Currently `Navbar` only renders inside
`_authenticated`. Move it to `__root.tsx` so it appears on the homepage
too. Behavior:

- Logged out: logo on left; "Sign In" button on right (links to `/login`).
- Logged in: logo on left; on the right → "Jobs Admin" (if
  `session.user.role === "admin"`), then `UserBlock` (existing).
- "Jobs Admin" opens `VITE_API_URL + "/admin/queues/"` in a new tab
  (`target="_blank"` + `rel="noreferrer"`).

**Role source.** The `User.role` column already exists (`@default("user")`).
Session carries it through Better-Auth's standard user-object plumbing.
Client reads `session.user.role === "admin"`.

### 2.2 Auth form UX (issues #2, #3)

**Validation timing.** Switch `useForm` validators from `onChange` to
`onBlur` + `onSubmit`. First render shows no errors; errors appear only
after a user has interacted with a field (blurred it) or has attempted to
submit.

**Signin vs signup validation split.** The current
`loginSchema` requires email + password + (optional name/username)
regardless of mode. Split into two schemas:

- `signinSchema`: `{ email: z.string().email(), password: z.string().min(1) }`.
- `signupSchema`: existing shape with `password: z.string().min(MIN_PASSWORD_LENGTH)`.

The form switches which schema is active by `isSignUp`. Password
placeholder: `"Your password"` for signin, `"Min 8 characters"` for
signup.

Server enforces the real password rule on signup regardless; the client
schema matches the server.

### 2.3 Invitations end-to-end (issues #4, #5, #6)

#### 2.3.1 Username autocomplete (issue #4)

New tRPC query `user.searchByUsername`:

```ts
searchByUsername: protectedProcedure
  .input(z.object({ prefix: z.string().min(1).max(64) }))
  .query(({ ctx, input }) =>
    searchUsersByUsername(ctx.db, ctx.session.user.id, input.prefix),
  );
```

`searchUsersByUsername` in a new `packages/api/src/domains/user/user-service.ts`:

- Matches users by `username ILIKE ${prefix}%` OR
  `LOWER(name) LIKE ${lowerPrefix}%` (cover both handle and display
  name as "autocomplete").
- Excludes the caller.
- Limit 8 results.
- Returns `[{ id, username, name }]`.

`ShareListDialog` replaces the `<Input>` with a shadcn `Command`
combobox. Typing queries in real time (debounced ~200ms via `useQuery`
with input as the key). No match → inline "No user with that username"
error text below the input; invite button disabled until a match is
selected.

On explicit `onSubmit` of a still-unresolved string (user hit Enter
before picking): show the same "No user with that username" error.

#### 2.3.2 Pending-invitations UI (issue #5)

**Invitee-facing surface** (`/dashboard`):
- New section "Pending invitations" below or beside the lists overview.
- Renders from a new query `todoList.myPendingInvites`:
  - Returns `[{ id, list: { id, name, color }, inviter: { username, name }, createdAt, expiresAt }]`.
  - Excludes expired invites.
- Each row: list name + color swatch, "Invited by @inviter", and two
  buttons: **Accept** (calls existing `acceptInvite`) and **Decline**
  (new `declineInvite` mutation — deletes the `TodoListInvite` row).
- Hidden entirely when there are no invites.

**Owner-facing surface** (inside `ShareListDialog`, above `CollaboratorList`):
- New section "Pending invites" (visible only when owner).
- Renders from a new query `todoList.pendingInvites({ listId })`:
  - Returns `[{ id, invitedUser: { id, username, name }, expiresAt, createdAt }]`.
- Each row: invitee handle + "Revoke" button (new `revokeInvite`
  mutation — owner-only authz; deletes the `TodoListInvite` row).
- Hidden when no pending invites.

**New mutations:**

- `declineInvite({ token })` — invitee only. Deletes the invite row.
  Emits `todo-list-invite-pending` to owner's inbox so owner's pending
  list refreshes.
- `revokeInvite({ inviteId })` — owner only. Deletes the invite row.
  Emits `todo-list-invite-pending` to the invitee's inbox so their
  dashboard removes it.

All invite mutations (`inviteCollaborator`, `acceptInvite`,
`declineInvite`, `revokeInvite`) emit realtime events on the user-inbox
channel as listed in §1.4.

#### 2.3.3 Absolute invite URL (issue #6)

`inviteCollaborator` router currently builds
`acceptUrl: \`/invites/${token}\``. Change to absolute using
`env.BETTER_AUTH_URL` (server-side env, already available via
`@project/env/server`):

```ts
acceptUrl: `${env.BETTER_AUTH_URL}/invites/${result.invite.token}`;
```

`BETTER_AUTH_URL` is the public origin of the web app in each
environment (localhost in dev, the real domain in prod). This is the
correct source for email link origins.

### 2.4 Collaborators list (issue #7)

`listCollaborators` currently returns only `TodoListMembership` rows
(collaborators). Extend the service function to also return the owner as
a synthetic row so the client displays the full picture.

Service change: shape the return as

```ts
{
  owner: { id, username, name },
  collaborators: Array<{ id, userId, user: { id, username, name }, role }>
}
```

Client (`CollaboratorList`) renders:

- Owner row first, always. Badge: "Owner". Never show a Remove button.
  Suffix "(You)" if owner is the viewer.
- Each collaborator row below. Badge: "Collaborator". Suffix "(You)"
  for the viewer. Remove button rendered only when `isOwner` AND the row
  is not the viewer themselves.
- Empty state ("No collaborators yet.") still shown when
  `collaborators.length === 0`, but only for the viewer-is-owner case —
  for non-owner viewers with no peers, show nothing special (they still
  see the owner row).

### 2.5 Realtime/cache correctness trio (issues #8, #10, #11)

#### 2.5.1 New-item wrong-slot on owner side (issue #8)

Diagnose first, fix second. Likely root cause: the creator's optimistic
insert uses `max-position + 1` (appends to bottom) while the remote-side
event handler's list-merge logic (in
`todo-list/event-handlers.ts` — `todo-created` handler) inserts at a
different position (top, or by `createdAt` with tie-breaker differences).

Concrete fix: server authoritatively assigns `position` on create
(already does, per `todo-service.ts` existing pattern). The
`todo-created` payload carries the authoritative `position`. The remote
handler should place the new item by `position` ordering, same
comparator used for the initial query result. If the handler currently
inserts at index 0 or 1, that's the bug.

The plan will start with a reproduction test, then trace through
`event-handlers.ts` and the todo-list sort comparator in parallel.

#### 2.5.2 Stale list on navigate-back (issue #10)

Two-part fix:

1. **Explicit invalidate on list-detail mount.** In the list-detail
   route's loader or component mount, call
   `queryClient.invalidateQueries(trpc.todo.list.queryFilter({ todoListId: listId }))`.
   Forces a fresh fetch on every mount; background refetch is fast and
   the previous data still renders during it.
2. **`staleTime: 0` on `trpc.todo.list`.** Belt-and-suspenders: even
   without the mount invalidation, TanStack Query will refetch on any
   query mount when `staleTime` is 0.

This issue is partly also solved by the user-inbox `todo-list-counters-changed`
handler, which invalidates `todoList.list` and `todoList.listAccessible`
on any counter change while the user is on the dashboard. The mount
invalidation is the backstop for the case where the user is away from
the dashboard entirely (no inbox subscription active because multi-tab
leader was in a different tab, network blip, etc.).

#### 2.5.3 Dashboard counters stale while outside list (issue #11)

Solved by the user-inbox channel (§1.1–1.5): the dashboard subscribes to
its inbox events on mount; `todo-list-counters-changed` invalidates the
list query; React Query refetches the counts. End-to-end latency is one
round-trip to the server after the mutation on any other user's client.

### 2.6 Admin menu entry (issue #12) — see 2.1

Covered by §2.1's navbar changes.

---

## Part 3 — Schema & API surface summary

### 3.1 Schema changes

```prisma
// todo-list.prisma

model TodoListMembership {
  // ... existing fields
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt   // ADDED
  // ...
}

model TodoListInvite {
  // ... existing fields
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt   // ADDED
  // ...
}
```

No model additions. Schema remains single-source — no new domain tables.

### 3.2 New tRPC procedures

Grouped by router.

**`userRouter` (new):**
- `searchByUsername({ prefix })` — query.
- `onInboxEvent()` — subscription.

**`todoListRouter` (additions):**
- `myPendingInvites()` — query (invitee side).
- `pendingInvites({ listId })` — query (owner side, authz: owner-only).
- `declineInvite({ token })` — mutation (invitee only).
- `revokeInvite({ inviteId })` — mutation (owner only).

**`todoListRouter.collaborators` (changed shape):**
- Returns `{ owner, collaborators }` instead of a flat array.

### 3.3 Router registration

Append-alpha in `src/router.ts`:

```ts
export const appRouter = router({
  auth: authRouter,
  todoList: todoListRouter,
  user: userRouter,   // NEW
});
```

---

## Part 4 — Testing approach

### 4.1 Gherkin scenarios (BDD)

New `.feature` files / scenarios:

- `e2e/features/auth/homepage.feature` — visit `/` as anon sees hero +
  Sign In; visit as authed sees hero + UserBlock; visit as admin sees
  Jobs Admin link.
- `e2e/features/auth/signin-form.feature` — validation errors appear on
  blur or on submit, not on change; signin requires non-empty password
  only; signup requires MIN_PASSWORD_LENGTH.
- `e2e/features/todo-list/invitations.feature` — autocomplete shows
  matches; no match shows error; pending invites appear on both
  dashboards; accept/decline/revoke flows; absolute invite URL contains
  `BETTER_AUTH_URL`.
- `e2e/features/todo-list/collaborators.feature` — owner appears in
  list; self row shows "(You)"; roles shown via badges.
- `e2e/features/todo-list/realtime-dashboard.feature` — two-browser
  scenario: user B adds a todo in a list shared with user A; A is on
  dashboard; A's counter updates within 3s without navigation.
- `e2e/features/todo-list/realtime-navigate-back.feature` — A on list
  detail, navigates to dashboard, B adds todo meanwhile, A navigates
  back — sees the new todo without manual refresh.
- Existing realtime scenarios continue to pass (no regression).

### 4.2 Unit / integration tests

Per `packages/api/CLAUDE.md`'s standard:

- `packages/api/src/domains/user/__tests__/user-service.test.ts` —
  `searchByUsername` behavior: prefix match on username + display name,
  excludes self, limit 8.
- `packages/api/src/domains/user/__tests__/user-router.test.ts` — auth
  guard on `onInboxEvent`; subscription yields events published to the
  viewer's channel.
- `packages/api/src/domains/todo-list/__tests__/todo-service-publishes.test.ts`
  — extend existing publish-assertion tests to cover the user-inbox
  events emitted from each of the 9 publisher-wired mutations (§1.4).
  Uses `MemoryChannelFactory` injection.
- `packages/api/src/domains/todo-list/__tests__/invites.test.ts` —
  new mutations `declineInvite`, `revokeInvite` authz + state changes.

### 4.3 Test isolation

Uses the existing per-worktree dynamic-port test DB from
`scripts/test-db.ts`. No new infra.

---

## Part 5 — Commit & rollout plan (not the implementation plan — just phasing)

The implementation plan (written next via `writing-plans`) will split
into batched commits roughly along these lines:

1. ADR-001 import + `docs/conventions.md` additions. No code.
2. Schema: add `updatedAt` to `TodoListMembership`, `TodoListInvite`;
   `make db-push`.
3. `@project/realtime/user-inbox.ts` + `packages/api/src/domains/user/`
   scaffolding (events SSOT, service stub, router with `onInboxEvent`).
4. Publisher wiring in `todo-list` service (9 call sites) + unit tests.
5. `declineInvite` / `revokeInvite` mutations + `myPendingInvites` /
   `pendingInvites` queries + unit tests.
6. `user.searchByUsername` query + unit tests.
7. `listCollaborators` shape change + client updates.
8. Client hook `use-user-inbox.ts` + dispatch map + leader-tab wiring.
9. Navbar lift to `__root.tsx`; admin link; homepage remains.
10. Auth form validation timing + schema split.
11. `ShareListDialog` Command combobox; "No user" error.
12. Pending-invites UI — dashboard section + owner-side sub-list in
    share dialog.
13. Absolute invite URL (`BETTER_AUTH_URL`).
14. Realtime bug diagnosis + fix (issue #8) with reproduction test
    first.
15. List-detail mount invalidation + `staleTime: 0`.
16. BDD step defs + scenarios per §4.1.

Each step ends with `make lint` + `make test-unit` green; BDD (`make test`)
runs after step 16.
