# Post-testing Fixes + User-Inbox Realtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the 11 human-testing issues (homepage/admin-nav, auth-form UX, invitations end-to-end, collaborators UI, realtime/cache correctness) together with the user-inbox realtime channel pattern and supporting conventions, in one bundled session.

**Architecture:** Additive — the existing per-entity `todo-list:<id>` channel stays; a new `user:<userId>` inbox channel is introduced for cross-feature UI surfaces (dashboard counters, access-revoke, pending invites). Publishers in `todo-list` service fan out to both channels. Client dashboard subscribes once to the user channel; `onStarted` invalidates live-backed queries to close reconnect gaps.

**Tech Stack:** TanStack Start (web) · Hono + tRPC (API) · Prisma + Postgres · `@project/realtime` (Channel abstraction) · TanStack Query/Form/Router · shadcn/ui Command combobox · Better-Auth · Bun test (unit/integration) · playwright-bdd (e2e).

**Spec:** `docs/superpowers/specs/2026-04-19-post-testing-fixes-design.md` (read this before starting — every task references it).

**Verification gate after every task:** `make lint && make test-unit`. BDD (`make test`) runs after Task 18. **Never use `--no-verify` on commits.**

**Ground rules from root CLAUDE.md (repeat often):**
- Use Grep/Glob/Read tools, not bash `grep/find/cat`.
- MultiEdit for multiple edits to the same file.
- No barrels. Every new importable file registers a subpath in `package.json` → `exports`.
- `verbatimModuleSyntax: false` in `apps/web` stays. `import type { AppRouter }` only.
- `@project/api` imported via subpaths only (e.g. `@project/api/domains/user/user-events`).
- Append-alpha registration in `packages/api/src/router.ts`.

---

## File Structure

**Created:**

- `docs/adrs/0001-realtime-architecture.md` — imported + scrubbed ADR.
- `packages/realtime/src/user-inbox.ts` — pure fan-out helpers (`userInboxChannelKey`, `publishToUserInbox`, `fanOutToMembers`).
- `packages/api/src/domains/user/user-events.ts` — SSOT tuple + `UserInboxEvent` union.
- `packages/api/src/domains/user/user-service.ts` — `searchUsersByUsername`, recipient helpers.
- `packages/api/src/domains/user/user-router.ts` — `searchByUsername` query + `onInboxEvent` subscription.
- `packages/api/src/domains/user/subscribe-to-user-inbox.ts` — async-gen mirroring `subscribeToListEvents`.
- `packages/api/src/domains/user/__tests__/user-service.test.ts`
- `packages/api/src/domains/user/__tests__/user-router.test.ts`
- `packages/api/src/domains/user/__tests__/user-inbox-publishes.test.ts`
- `apps/web/src/features/user/use-user-inbox.ts` — leader-tab + `useSubscription` + `onStarted` invalidation + dispatch map.
- `apps/web/src/features/user/event-handlers.ts` — per-kind `UserInboxEvent` handlers.
- `apps/web/src/features/user/use-debounced-value.ts` — 200ms debounce hook for autocomplete.
- `apps/web/src/features/todo-list/invite-autocomplete.tsx` — shadcn Command combobox.
- `apps/web/src/features/todo-list/pending-invites-dashboard.tsx` — invitee-facing pending-invites card.
- `apps/web/src/features/todo-list/pending-invites-owner.tsx` — owner-facing pending-invites sub-list in Share dialog.
- `e2e/features/auth/homepage.feature`
- `e2e/features/auth/signin-form.feature`
- `e2e/features/todo-list/invitations.feature`
- `e2e/features/todo-list/collaborators-visibility.feature`
- `e2e/features/todo-list/realtime-dashboard.feature`
- `e2e/features/todo-list/realtime-navigate-back.feature`
- Matching step-def files under `e2e/steps/auth/` and `e2e/steps/todo-list/`.

**Modified:**

- `docs/conventions.md` — three new sections (realtime channels, timestamps, aggregation modules).
- `packages/realtime/package.json` — add `./user-inbox` subpath.
- `packages/api/package.json` — add three `./domains/user/*` subpaths.
- `packages/db/prisma/schema/todo-list.prisma` — `TodoListMembership.updatedAt`, `TodoListInvite.updatedAt`.
- `packages/api/src/router.ts` — append-alpha insert of `userRouter`.
- `packages/api/src/domains/todo-list/service.ts` — `listCollaborators` shape change; user-inbox publishers in `inviteCollaborator`/`acceptInvite`/`removeCollaborator`/`deleteTodoList`; new `declineInvite`/`revokeInvite`/`listMyPendingInvites`/`listPendingInvitesForList`.
- `packages/api/src/domains/todo-list/todo-service.ts` — user-inbox publisher in `createTodo`/`deleteTodo`/`completeTodo`.
- `packages/api/src/domains/todo-list/router.ts` — new procedures for `declineInvite`/`revokeInvite`/`myPendingInvites`/`pendingInvites`; absolute invite URL; `collaborators` return-shape change; wire channel overrides to support user-inbox factory in tests.
- `packages/api/src/domains/todo-list/__tests__/*` — extend publish-assertion and router tests.
- `apps/web/src/widgets/navbar.tsx` — render for both logged-in and logged-out states; "Sign In" button when logged out; admin-gated "Jobs Admin" link.
- `apps/web/src/routes/__root.tsx` — lift `Navbar` here.
- `apps/web/src/routes/_authenticated.tsx` — remove `Navbar` (moved to root).
- `apps/web/src/routes/index.tsx` — hero stays; "Sign In" button removed (now in Navbar).
- `apps/web/src/routes/login.tsx` — split `signinSchema` / `signupSchema`; `onBlur` + `onSubmit` validation; mode-specific password placeholder.
- `apps/web/src/routes/_authenticated/dashboard.tsx` — mount `useUserInbox`; render `PendingInvitesDashboard`.
- `apps/web/src/routes/_authenticated/todo-lists/$listId.tsx` — mount-time `invalidateQueries`; `staleTime: 0` wired for detail queries.
- `apps/web/src/features/todo-list/share-list-dialog.tsx` — use autocomplete + render owner-side pending-invites.
- `apps/web/src/features/todo-list/collaborator-list.tsx` — consume new `{ owner, collaborators }` shape; role badges; "(You)" suffix.
- `apps/web/src/features/todo-list/event-handlers.ts` — if the wrong-slot fix demands, adjust `todo-created`/`todo-updated` sort semantics.

**Not modified (load-bearing — do not touch):**
- `apps/web/src/routeTree.gen.ts` (auto-generated).
- Better-Auth tables' existing columns.

---

## Task 1: ADR-001 import + docs/conventions.md additions

**Spec sections:** §1.6, §1.7, §1.8.

**Files:**
- Create: `docs/adrs/0001-realtime-architecture.md`
- Modify: `docs/conventions.md`

**Source ADR:** `/Users/iorlas/Workspaces/a2sdlc-demo3/docs/adrs/0001-realtime-architecture.md` — the "original" ADR to scrub and import.

- [ ] **Step 1: Read the source ADR in full.**

```bash
# Use Read tool, not cat
```
Read: `/Users/iorlas/Workspaces/a2sdlc-demo3/docs/adrs/0001-realtime-architecture.md`.

- [ ] **Step 2: Create the target ADR file and scrub per spec §1.6.**

Create `docs/adrs/0001-realtime-architecture.md` with the full contents of the source ADR, with these transforms applied:

1. Frontmatter: remove `date`, `supersedes`, `superseded-by`. Change `status: Proposed` → `status: Accepted`. Keep `title`, `status`, `applies-to`.
2. Strip any external-repo file path (`docs/requirements/inputs/*`, `docs/requirements/pitches/*`). Replace with inline paraphrase of the force described.
3. Strip `§`-style cross-references to external spec sections (e.g., `§2.7.1`, `§3.2`). Replace with prose describing the force (example: `"§2.7.1 requires unread indicators"` → `"the product requires unread indicators in the sidebar"`).
4. In the Rollout section: delete "Pitch 1 / Pitch 2+" framing. Replace with this short paragraph:

   > This ADR is realized in `packages/api/src/domains/user/` (user-inbox channel, this repo) and `packages/api/src/domains/todo-list/` (per-entity channel, retained for focused single-entity collab with static authz).

5. Section refs to the ADR's OWN sections (e.g., "see §D3 reconnect glue" appearing INSIDE this ADR) are kept — they're internal.
6. Remove any mention of the source repo name (`a2sdlc-demo3`) anywhere in the file.

- [ ] **Step 3: Verify no sibling-repo artifacts remain.**

Use Grep to search the new file for `a2sdlc`, `docs/requirements`, `§2.`, `§3.`, `§4.`, `Pitch 1`, `Pitch 2`. Expected: **zero matches**. Fix any stragglers.

- [ ] **Step 4: Append three sections to `docs/conventions.md`.**

Append, in order, to the end of `docs/conventions.md`:

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

## Realtime event naming — pluralization (addendum)

The existing pluralization rule (singular for single-item payloads,
plural for bulk payloads) governs **payload-shape** events.
**Notification-shape** events carry no entity; pluralize when the event
describes change to an aggregate collection (`todo-list-counters-changed`,
`todo-list-invites-changed`), singular when it describes a single
conceptual event (`todo-list-access-granted`).

## Aggregation modules (integration surfaces)

Some modules aggregate contributions from every feature in the codebase.
When you ship a new feature or capability, walk this list and ensure
every applicable surface is updated — the type system does not catch
every omission.

| Surface | File | Update when … |
|---|---|---|
| Top-level navigation | `apps/web/src/widgets/navbar.tsx` | Feature adds a user-facing route |
| tRPC router registry | `packages/api/src/router.ts` | New domain router added (insert alphabetically) |
| User-inbox event SSOT | `packages/api/src/domains/user/user-events.ts` | Domain emits cross-feature realtime events |
| Per-domain event SSOT | `packages/api/src/domains/<name>/events.ts` | New event kind within a domain |
| Package subpath exports | `packages/<pkg>/package.json` `"exports"` | New file meant to be imported from another package |
| Prisma schema split | `packages/db/prisma/schema/<domain>.prisma` | New domain with its own models |
| Cross-layer naming allowlist (lint) | `scripts/check-domain-names.ts` | New asymmetric-by-design domain (backend-only or frontend-only) |
| Auth-gated layout | `apps/web/src/routes/_authenticated/` | Route requires sign-in |

Enforcement ladder: rows marked "(lint)" are caught by `make lint`; the
rest are discipline + code review.

**Meta-rule.** If you introduce a new aggregation module — any file or
registry other features will plug into — add a row to this table in the
same commit that introduces it. This keeps the list authoritative and
prevents silent plug-in points from accumulating.
```

- [ ] **Step 5: Run the lint gate.**

```bash
make lint
```
Expected: PASS (only docs changed).

- [ ] **Step 6: Commit.**

```bash
git add docs/adrs/0001-realtime-architecture.md docs/conventions.md
git commit -m "$(cat <<'EOF'
docs: import ADR-001 realtime architecture + conventions

Imports the User Inbox + Live+Snapshot ADR as Accepted, scrubbed of
sibling-repo references. Adds four convention sections: realtime
channel granularity, timestamps, pluralization addendum for
notification-shape events, and the aggregation-modules registry with
meta-rule for future additions.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Schema timestamps on TodoListMembership + TodoListInvite

**Spec sections:** §1.7 audit, §3.1.

**Files:**
- Modify: `packages/db/prisma/schema/todo-list.prisma`

- [ ] **Step 1: Add `updatedAt` to both join models.**

Edit `packages/db/prisma/schema/todo-list.prisma`:

In `model TodoListMembership`, after `createdAt  DateTime @default(now())`, add:
```prisma
  updatedAt  DateTime @updatedAt
```

In `model TodoListInvite`, after `createdAt     DateTime @default(now())`, add:
```prisma
  updatedAt     DateTime @updatedAt
```

- [ ] **Step 2: Push schema + regenerate client.**

```bash
make db-push
```
Expected: "Your database is now in sync with your Prisma schema." (and Prisma client regeneration).

- [ ] **Step 3: Run the lint gate.**

```bash
make lint
```
Expected: PASS.

- [ ] **Step 4: Commit.**

```bash
git add packages/db/prisma/schema/todo-list.prisma
git commit -m "$(cat <<'EOF'
feat(db): add updatedAt to TodoListMembership + TodoListInvite

Brings the two join models into compliance with the new timestamp
convention (docs/conventions.md).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `@project/realtime/user-inbox.ts` helpers

**Spec sections:** §1.2 (file path + helper signatures), §1.2 footnote (pure fan-out discipline).

**Files:**
- Create: `packages/realtime/src/user-inbox.ts`
- Create: `packages/realtime/src/__tests__/user-inbox.test.ts` (if a `__tests__` folder doesn't exist, create it)
- Modify: `packages/realtime/package.json`

- [ ] **Step 1: Check realtime package test layout.**

```bash
# Use Glob tool
packages/realtime/src/**/*.test.ts
```
If no tests exist yet, this task introduces the first. That's fine — we'll create `__tests__/user-inbox.test.ts` and keep tests out of the publish surface by placing them under `__tests__/`.

- [ ] **Step 2: Register the new subpath in `packages/realtime/package.json`.**

Add to the `exports` map, alphabetically:

```json
    "./user-inbox": {
      "default": "./src/user-inbox.ts"
    },
```
The final exports block must be (insert `./user-inbox` between `./types` and anything after — there's nothing after currently, so it goes last; alphabetically ok):

```json
  "exports": {
    "./channel": { "default": "./src/channel.ts" },
    "./memory": { "default": "./src/memory-channel.ts" },
    "./redis": { "default": "./src/redis-channel.ts" },
    "./types": { "default": "./src/types.ts" },
    "./user-inbox": { "default": "./src/user-inbox.ts" }
  },
```

- [ ] **Step 3: Write the failing test first (TDD).**

Create `packages/realtime/src/__tests__/user-inbox.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { MemoryChannelFactory } from "../memory-channel.js";
import {
  fanOutToMembers,
  publishToUserInbox,
  userInboxChannelKey,
} from "../user-inbox.js";

describe("userInboxChannelKey", () => {
  it("returns user:<id> form", () => {
    expect(userInboxChannelKey("u_123")).toBe("user:u_123");
  });
});

describe("publishToUserInbox", () => {
  it("publishes the event to exactly one user channel", async () => {
    type Ev = { kind: "x"; v: number };
    const factory = new MemoryChannelFactory();
    const received: Ev[] = [];
    const unsub = await factory
      .channel<Ev>(userInboxChannelKey("alice"))
      .subscribe((e) => received.push(e));

    await publishToUserInbox(factory, "alice", { kind: "x", v: 1 });

    unsub();
    await factory.closeAll();
    expect(received).toEqual([{ kind: "x", v: 1 }]);
  });
});

describe("fanOutToMembers", () => {
  it("publishes to each user's inbox, skips duplicates", async () => {
    type Ev = { kind: "y"; v: number };
    const factory = new MemoryChannelFactory();
    const a: Ev[] = [];
    const b: Ev[] = [];
    const unsubA = await factory
      .channel<Ev>(userInboxChannelKey("alice"))
      .subscribe((e) => a.push(e));
    const unsubB = await factory
      .channel<Ev>(userInboxChannelKey("bob"))
      .subscribe((e) => b.push(e));

    await fanOutToMembers(factory, ["alice", "bob", "alice"], {
      kind: "y",
      v: 42,
    });

    unsubA();
    unsubB();
    await factory.closeAll();
    expect(a).toEqual([{ kind: "y", v: 42 }]);
    expect(b).toEqual([{ kind: "y", v: 42 }]);
  });

  it("is a no-op for empty recipient list", async () => {
    const factory = new MemoryChannelFactory();
    await fanOutToMembers(factory, [], { kind: "y", v: 0 });
    await factory.closeAll();
    // No throw = pass
  });
});
```

- [ ] **Step 4: Run tests — they must fail.**

```bash
cd packages/realtime && bun test
```
Expected: FAIL (module not found).

- [ ] **Step 5: Implement `user-inbox.ts` to make tests pass.**

Create `packages/realtime/src/user-inbox.ts`:

```ts
// User-inbox channel helpers — shared across the API. See ADR-001 and
// docs/conventions.md#realtime-channel-granularity.
//
// These helpers are PURE fan-out: they accept already-resolved user
// ids, a ChannelFactory, and an event; they call channel.publish.
// They MUST NOT touch Prisma, import from @project/db, or carry
// domain knowledge. Services resolve recipient ids from their own
// authz-gate queries and pass the array here.

import type { ChannelFactory } from "./types.js";

export function userInboxChannelKey(userId: string): string {
  return `user:${userId}`;
}

export async function publishToUserInbox<TEvent>(
  factory: ChannelFactory,
  userId: string,
  event: TEvent,
): Promise<void> {
  await factory.channel<TEvent>(userInboxChannelKey(userId)).publish(event);
}

export async function fanOutToMembers<TEvent>(
  factory: ChannelFactory,
  userIds: readonly string[],
  event: TEvent,
): Promise<void> {
  if (userIds.length === 0) return;
  const unique = Array.from(new Set(userIds));
  await Promise.all(
    unique.map((id) =>
      factory.channel<TEvent>(userInboxChannelKey(id)).publish(event),
    ),
  );
}
```

- [ ] **Step 6: Run tests — all must pass.**

```bash
cd packages/realtime && bun test
```
Expected: 4 PASS.

- [ ] **Step 7: Full lint + unit gate.**

```bash
make lint && make test-unit
```
Expected: PASS.

- [ ] **Step 8: Commit.**

```bash
git add packages/realtime/src/user-inbox.ts packages/realtime/src/__tests__/user-inbox.test.ts packages/realtime/package.json
git commit -m "$(cat <<'EOF'
feat(realtime): user-inbox helpers (key, publish, fan-out)

Pure fan-out utilities for the user:<id> channel pattern. No Prisma
or domain knowledge; services resolve recipients from their own authz
queries and pass the array here. See ADR-001.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `packages/api/src/domains/user/` scaffolding (events, service stub, router with `onInboxEvent`)

**Spec sections:** §1.1–§1.3, §3.2 (register alpha).

**Files:**
- Create: `packages/api/src/domains/user/user-events.ts`
- Create: `packages/api/src/domains/user/user-service.ts` (service stub — search added in Task 7)
- Create: `packages/api/src/domains/user/subscribe-to-user-inbox.ts`
- Create: `packages/api/src/domains/user/user-router.ts`
- Create: `packages/api/src/domains/user/__tests__/user-router.test.ts`
- Modify: `packages/api/package.json` (add three subpaths)
- Modify: `packages/api/src/router.ts` (append-alpha insert)

- [ ] **Step 1: Register subpaths in `packages/api/package.json`.**

Insert into the `"exports"` block alphabetically (between `"./domains/todo-list/service"` and `"./router"`):

```json
    "./domains/user/user-events": {
      "default": "./src/domains/user/user-events.ts"
    },
    "./domains/user/user-router": {
      "default": "./src/domains/user/user-router.ts"
    },
    "./domains/user/user-service": {
      "default": "./src/domains/user/user-service.ts"
    },
```

- [ ] **Step 2: Create `user-events.ts` (SSOT tuple + union + channel-key helper re-export).**

Create `packages/api/src/domains/user/user-events.ts`:

```ts
// Cross-feature user-inbox events. Every kind is notification-shape
// in this spec (no entity payload); client handlers invalidate queries
// and refetch authoritative state. See docs/conventions.md and ADR-001.
//
// Domains that publish to a user's inbox import from this file; this
// file has no reverse dependency on any domain.

export const USER_INBOX_EVENT_KINDS = [
  "todo-list-counters-changed",
  "todo-list-access-granted",
  "todo-list-access-revoked",
  "todo-list-invites-changed",
] as const;

export type UserInboxEventKind = (typeof USER_INBOX_EVENT_KINDS)[number];

export type UserInboxEvent =
  | { kind: "todo-list-counters-changed"; listId: string }
  | { kind: "todo-list-access-granted"; listId: string }
  | { kind: "todo-list-access-revoked"; listId: string }
  | { kind: "todo-list-invites-changed"; listId: string };

export { userInboxChannelKey } from "@project/realtime/user-inbox";
```

- [ ] **Step 3: Create the `subscribe-to-user-inbox.ts` generator.**

Mirrors `subscribeToListEvents` from `packages/api/src/domains/todo-list/events.ts`. No authz auto-close needed (the inbox is self-scoped — the only way to lose access is session invalidation, which the WS layer handles).

Create `packages/api/src/domains/user/subscribe-to-user-inbox.ts`:

```ts
// Async generator backing the user.onInboxEvent subscription. Mirrors
// subscribeToListEvents (todo-list/events.ts) but without authz
// cascade — the user's own inbox is always readable by the session
// owner. Session revocation tears down the WS at the auth layer.

import type { Channel } from "@project/realtime/types";
import type { UserInboxEvent } from "./user-events.js";

export async function* subscribeToUserInbox(
  ch: Channel<UserInboxEvent>,
  signal?: AbortSignal,
): AsyncGenerator<UserInboxEvent> {
  const buffer: UserInboxEvent[] = [];
  let resolveNext: (() => void) | null = null;

  const unsub = await ch.subscribe((event) => {
    buffer.push(event);
    resolveNext?.();
    resolveNext = null;
  });

  try {
    while (true) {
      while (buffer.length > 0) {
        // biome-ignore lint/style/noNonNullAssertion: length guard above
        const event = buffer.shift()!;
        yield event;
      }
      if (signal?.aborted) return;
      await new Promise<void>((resolve) => {
        resolveNext = resolve;
        signal?.addEventListener("abort", () => resolve(), { once: true });
      });
    }
  } finally {
    unsub();
  }
}
```

- [ ] **Step 4: Create an empty service file (placeholder for Task 7).**

Create `packages/api/src/domains/user/user-service.ts`:

```ts
// User domain service. Extended by Task 7 with searchUsersByUsername
// and other cross-feature user helpers.

export {};
```

- [ ] **Step 5: Create the router with `onInboxEvent` subscription.**

Create `packages/api/src/domains/user/user-router.ts`:

```ts
import { channel as defaultChannel } from "@project/realtime/channel";
import { protectedProcedure, router } from "../../trpc.js";
import { subscribeToUserInbox } from "./subscribe-to-user-inbox.js";
import { type UserInboxEvent, userInboxChannelKey } from "./user-events.js";

export const userRouter = router({
  // Viewer-scoped: a session may only subscribe to its own inbox.
  // Channel key is derived from ctx.session.user.id, not from input —
  // there is no "subscribe to somebody else's inbox" surface.
  onInboxEvent: protectedProcedure.subscription(async function* ({
    ctx,
    signal,
  }) {
    const ch = defaultChannel<UserInboxEvent>(
      userInboxChannelKey(ctx.session.user.id),
    );
    yield* subscribeToUserInbox(ch, signal);
  }),
});
```

- [ ] **Step 6: Register `userRouter` append-alpha in `packages/api/src/router.ts`.**

Edit `packages/api/src/router.ts`:

```ts
import { todoListRouter } from "./domains/todo-list/router.js";
import { todoRouter } from "./domains/todo-list/todo-router.js";
import { userRouter } from "./domains/user/user-router.js";
import { router } from "./trpc.js";

// Append-alpha convention: register sub-routers one per line in alphabetical
// order of their key. New features INSERT at the alpha position, not append
// to the bottom — so two agents adding features in parallel edit different
// lines. See packages/api/CLAUDE.md § "Append-Alpha Router Registration".
export const appRouter = router({
  todo: todoRouter,
  todoList: todoListRouter,
  user: userRouter,
});

export type AppRouter = typeof appRouter;
```

- [ ] **Step 7: Write a router integration test for the subscription.**

Create `packages/api/src/domains/user/__tests__/user-router.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { channel as defaultChannel } from "@project/realtime/channel";
import { db } from "@project/db";
import {
  type UserInboxEvent,
  userInboxChannelKey,
} from "../user-events.js";
import { subscribeToUserInbox } from "../subscribe-to-user-inbox.js";

describe("subscribeToUserInbox", () => {
  it("yields events published on the user channel", async () => {
    const userId = "test-subscribe-inbox-user";
    const key = userInboxChannelKey(userId);
    const ch = defaultChannel<UserInboxEvent>(key);

    const controller = new AbortController();
    const gen = subscribeToUserInbox(ch, controller.signal);

    // publish after subscribe is set up
    queueMicrotask(() => {
      void ch.publish({ kind: "todo-list-counters-changed", listId: "L1" });
    });

    const first = await gen.next();
    expect(first.done).toBe(false);
    expect(first.value).toEqual({
      kind: "todo-list-counters-changed",
      listId: "L1",
    });

    controller.abort();
    // Drain to completion
    await gen.return(undefined);
  });

  afterAll(async () => {
    await db.$disconnect();
  });
});
```

Note: this test uses the process-default RedisChannel (the real one). The default RedisChannel requires Redis; `@project/realtime/channel` resolves to `redis-channel.ts`. If the test environment already runs against a real Redis (via `make test-unit` infra), this is fine. If not, swap to MemoryChannelFactory directly — but the existing todo-list tests use the default channel when testing subscription shape, so follow the majority pattern. Verify with `make test-unit` against one of these tests before committing.

If the default RedisChannel path isn't available in unit tests, rewrite this test to construct a MemoryChannel directly and call `subscribeToUserInbox` on it, mirroring what `todo-list/__tests__/events.test.ts` does.

- [ ] **Step 8: Run the new test.**

```bash
make test-unit
```
Expected: test passes. If it errors on Redis connection, switch to Memory-based subscription as noted.

- [ ] **Step 9: Add `user` to `scripts/check-domain-names.ts` allowlist.**

The `user` domain is backend + web but has no direct `e2e/features/user/` — its behavior is exercised via `e2e/features/todo-list/*` realtime scenarios. Without this allowlist entry, `make lint` will fail.

Edit `scripts/check-domain-names.ts`. In the `ALLOWLIST` map, add (alphabetically, before the closing brace):

```ts
  user: new Set(["e2e-feat", "e2e-steps"]),
```

Also add a comment paragraph in the block-comment at the top of the file describing the asymmetry, matching the style of the existing entries:

```
//   - user       the user domain is the cross-cutting realtime aggregator
//                (user-inbox channel, username search); its behavior is
//                exercised via todo-list e2e scenarios, not a dedicated
//                user/ e2e folder
//                → allowed-missing: e2e-feat, e2e-steps
```

- [ ] **Step 10: Full gate.**

```bash
make lint && make test-unit
```
Expected: PASS.

- [ ] **Step 11: Commit.**

```bash
git add packages/api/package.json packages/api/src/router.ts packages/api/src/domains/user/ scripts/check-domain-names.ts
git commit -m "$(cat <<'EOF'
feat(api): user domain scaffolding + onInboxEvent subscription

Adds packages/api/src/domains/user/ with the USER_INBOX_EVENT_KINDS
SSOT tuple, UserInboxEvent union, subscribeToUserInbox generator, and
the user.onInboxEvent tRPC subscription. Viewer-scoped: channel key
derived from ctx.session.user.id. Append-alpha registered in
appRouter between todoList and next. See ADR-001.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Publisher wiring — todo-service + service into user-inbox

**Spec sections:** §1.4 (publisher table), §1.2 (pure fan-out discipline).

**Files:**
- Modify: `packages/api/src/domains/todo-list/todo-service.ts`
- Modify: `packages/api/src/domains/todo-list/service.ts`
- Create: `packages/api/src/domains/user/__tests__/user-inbox-publishes.test.ts`

Publisher coverage per spec §1.4. Each mutation emits both its existing list-channel event(s) AND a user-inbox event to the resolved recipients:

| Mutation | Recipients | Kind |
|---|---|---|
| `createTodo`, `deleteTodo`, `completeTodo` | owner + all collaborators | `todo-list-counters-changed` |
| `inviteCollaborator` | invitee | `todo-list-invites-changed` |
| `acceptInvite` (granted) | all members (owner + existing collaborators + accepter) | `todo-list-access-granted` |
| `acceptInvite` (invites-changed) | owner | `todo-list-invites-changed` |
| `removeCollaborator` | removed user | `todo-list-access-revoked` |
| `deleteTodoList` | every member except deleter | `todo-list-access-revoked` |

We also need placeholders for `declineInvite` and `revokeInvite` which are added in Task 6 — deferred until then.

For each publisher, we extend the service function with an optional `userInboxChannel?: (key: string) => Channel<UserInboxEvent>` parameter (separate from the existing `channel?` param which carries `TodoListEvent` on a different channel shape). Default = `defaultChannel`. This mirrors the existing dependency-injection pattern and keeps tests switchable to `MemoryChannelFactory`.

- [ ] **Step 1: Write the failing publish-assertion tests for todo-service publishes.**

Create `packages/api/src/domains/user/__tests__/user-inbox-publishes.test.ts`:

```ts
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "bun:test";
import { db } from "@project/db";
import { MemoryChannelFactory } from "@project/realtime/memory";
import {
  completeTodo,
  createTodo,
  deleteTodo,
} from "@project/api/domains/todo-list/todo-service";
import {
  acceptInvite,
  inviteCollaborator,
  removeCollaborator,
  deleteTodoList,
} from "@project/api/domains/todo-list/service";
import {
  type UserInboxEvent,
  userInboxChannelKey,
} from "../user-events.js";

describe("user-inbox publish assertions", () => {
  const OWNER_ID = "test-owner-inbox";
  const COLLAB_ID = "test-collab-inbox";
  const OTHER_ID = "test-other-inbox";
  let sharedListId: string;

  beforeAll(async () => {
    await db.user.deleteMany({
      where: { id: { in: [OWNER_ID, COLLAB_ID, OTHER_ID] } },
    });
    await db.user.createMany({
      data: [
        {
          id: OWNER_ID,
          name: "Owner",
          email: "owner-inbox@example.com",
          username: "owner-inbox",
          emailVerified: false,
        },
        {
          id: COLLAB_ID,
          name: "Collab",
          email: "collab-inbox@example.com",
          username: "collab-inbox",
          emailVerified: false,
        },
        {
          id: OTHER_ID,
          name: "Other",
          email: "other-inbox@example.com",
          username: "other-inbox",
          emailVerified: false,
        },
      ],
    });
  });

  beforeEach(async () => {
    const list = await db.todoList.create({
      data: { name: "Inbox Test List", userId: OWNER_ID },
    });
    sharedListId = list.id;
    await db.todoListMembership.create({
      data: {
        userId: COLLAB_ID,
        todoListId: sharedListId,
        role: "collaborator",
      },
    });
  });

  afterEach(async () => {
    await db.todoListInvite.deleteMany({ where: { todoListId: sharedListId } });
    await db.todo.deleteMany({ where: { todoListId: sharedListId } });
    await db.todoListMembership.deleteMany({
      where: { todoListId: sharedListId },
    });
    await db.todoList.deleteMany({ where: { id: sharedListId } });
  });

  afterAll(async () => {
    await db.user.deleteMany({
      where: { id: { in: [OWNER_ID, COLLAB_ID, OTHER_ID] } },
    });
    await db.$disconnect();
  });

  function subscribe(factory: MemoryChannelFactory, userId: string) {
    const received: UserInboxEvent[] = [];
    const unsubP = factory
      .channel<UserInboxEvent>(userInboxChannelKey(userId))
      .subscribe((e) => received.push(e));
    return { received, unsubP };
  }

  it("createTodo fans out todo-list-counters-changed to all members", async () => {
    const factory = new MemoryChannelFactory();
    const owner = subscribe(factory, OWNER_ID);
    const collab = subscribe(factory, COLLAB_ID);
    const other = subscribe(factory, OTHER_ID);
    const unsubs = await Promise.all([owner.unsubP, collab.unsubP, other.unsubP]);

    await db.$transaction((tx) =>
      createTodo(tx, OWNER_ID, "One", sharedListId, {
        userInboxChannel: (k) => factory.channel(k),
      }),
    );

    for (const u of unsubs) u();
    await factory.closeAll();
    expect(owner.received).toEqual([
      { kind: "todo-list-counters-changed", listId: sharedListId },
    ]);
    expect(collab.received).toEqual([
      { kind: "todo-list-counters-changed", listId: sharedListId },
    ]);
    expect(other.received).toEqual([]); // non-member gets nothing
  });

  it("inviteCollaborator publishes todo-list-invites-changed to invitee only", async () => {
    const factory = new MemoryChannelFactory();
    const owner = subscribe(factory, OWNER_ID);
    const other = subscribe(factory, OTHER_ID);
    const unsubs = await Promise.all([owner.unsubP, other.unsubP]);

    await db.$transaction((tx) =>
      inviteCollaborator(tx, OWNER_ID, sharedListId, "other-inbox", {
        userInboxChannel: (k) => factory.channel(k),
      }),
    );

    for (const u of unsubs) u();
    await factory.closeAll();
    expect(owner.received).toEqual([]);
    expect(other.received).toEqual([
      { kind: "todo-list-invites-changed", listId: sharedListId },
    ]);
  });

  it("removeCollaborator publishes todo-list-access-revoked to removed user", async () => {
    const factory = new MemoryChannelFactory();
    const owner = subscribe(factory, OWNER_ID);
    const collab = subscribe(factory, COLLAB_ID);
    const unsubs = await Promise.all([owner.unsubP, collab.unsubP]);

    await db.$transaction((tx) =>
      removeCollaborator(tx, OWNER_ID, sharedListId, COLLAB_ID, {
        userInboxChannel: (k) => factory.channel(k),
      }),
    );

    for (const u of unsubs) u();
    await factory.closeAll();
    expect(owner.received).toEqual([]);
    expect(collab.received).toEqual([
      { kind: "todo-list-access-revoked", listId: sharedListId },
    ]);
  });

  it("deleteTodoList publishes access-revoked to every member except deleter", async () => {
    const factory = new MemoryChannelFactory();
    const owner = subscribe(factory, OWNER_ID);
    const collab = subscribe(factory, COLLAB_ID);
    const unsubs = await Promise.all([owner.unsubP, collab.unsubP]);

    await db.$transaction((tx) =>
      deleteTodoList(tx, OWNER_ID, sharedListId, {
        userInboxChannel: (k) => factory.channel(k),
      }),
    );

    for (const u of unsubs) u();
    await factory.closeAll();
    expect(owner.received).toEqual([]); // owner is the deleter
    expect(collab.received).toEqual([
      { kind: "todo-list-access-revoked", listId: sharedListId },
    ]);
  });

  it("acceptInvite publishes access-granted to all members AND invites-changed to owner", async () => {
    // Create an invite for OTHER_ID
    const invite = await db.$transaction((tx) =>
      inviteCollaborator(tx, OWNER_ID, sharedListId, "other-inbox"),
    );

    const factory = new MemoryChannelFactory();
    const owner = subscribe(factory, OWNER_ID);
    const collab = subscribe(factory, COLLAB_ID);
    const other = subscribe(factory, OTHER_ID);
    const unsubs = await Promise.all([owner.unsubP, collab.unsubP, other.unsubP]);

    await db.$transaction((tx) =>
      acceptInvite(tx, OTHER_ID, invite.invite.token, {
        userInboxChannel: (k) => factory.channel(k),
      }),
    );

    for (const u of unsubs) u();
    await factory.closeAll();

    // Everyone (owner + existing collab + accepter) gets access-granted
    expect(
      owner.received.some(
        (e) => e.kind === "todo-list-access-granted" && e.listId === sharedListId,
      ),
    ).toBe(true);
    expect(
      collab.received.some(
        (e) => e.kind === "todo-list-access-granted" && e.listId === sharedListId,
      ),
    ).toBe(true);
    expect(
      other.received.some(
        (e) => e.kind === "todo-list-access-granted" && e.listId === sharedListId,
      ),
    ).toBe(true);
    // Owner ALSO gets invites-changed (their pending-invites list changed)
    expect(
      owner.received.some(
        (e) => e.kind === "todo-list-invites-changed" && e.listId === sharedListId,
      ),
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run — tests must fail.**

```bash
make test-unit
```
Expected: FAIL (`userInboxChannel` option not recognized).

- [ ] **Step 3: Add user-inbox publishers to `todo-service.ts`.**

Edit `packages/api/src/domains/todo-list/todo-service.ts`. At the top, add imports:

```ts
import type { UserInboxEvent } from "@project/api/domains/user/user-events";
import { fanOutToMembers } from "@project/realtime/user-inbox";
import type { ChannelFactory } from "@project/realtime/types";
import { MemoryChannelFactory } from "@project/realtime/memory";
```

Wait — `fanOutToMembers` expects a `ChannelFactory`, but the existing `ChannelProvider` type is `(key: string) => Channel<TodoListEvent>`. We need a different shape. The cleanest approach is to accept a `userInboxChannel?: (key: string) => Channel<UserInboxEvent>` in options and build an ad-hoc factory wrapper inline. Better: keep the provider pattern consistent — use `(key: string) => Channel<UserInboxEvent>` directly.

Revised approach — stay provider-based (matching the existing `channel?: ChannelProvider` convention):

```ts
import type { UserInboxEvent } from "@project/api/domains/user/user-events";
import { userInboxChannelKey } from "@project/api/domains/user/user-events";
import { channel as defaultChannel } from "@project/realtime/channel";
import type { Channel } from "@project/realtime/types";

type UserInboxChannelProvider = (key: string) => Channel<UserInboxEvent>;
const defaultUserInboxProvider: UserInboxChannelProvider = (k) =>
  defaultChannel<UserInboxEvent>(k);

async function publishCountersChanged(
  provider: UserInboxChannelProvider,
  recipientIds: readonly string[],
  listId: string,
): Promise<void> {
  if (recipientIds.length === 0) return;
  const unique = Array.from(new Set(recipientIds));
  await Promise.all(
    unique.map((id) =>
      provider(userInboxChannelKey(id)).publish({
        kind: "todo-list-counters-changed",
        listId,
      }),
    ),
  );
}

async function listMemberIdsForList(
  tx: Prisma.TransactionClient,
  todoListId: string,
): Promise<string[]> {
  const list = await tx.todoList.findUniqueOrThrow({
    where: { id: todoListId },
    select: {
      userId: true,
      memberships: { select: { userId: true } },
    },
  });
  return [list.userId, ...list.memberships.map((m) => m.userId)];
}
```

Now add the `userInboxChannel?` option to each of `createTodo`, `completeTodo`, `deleteTodo`. For each, after the existing list-channel publish, add:

```ts
const userInboxProvider = options.userInboxChannel ?? defaultUserInboxProvider;
const recipientIds = await listMemberIdsForList(tx, todoListId);
await publishCountersChanged(userInboxProvider, recipientIds, todoListId);
```

(For `completeTodo` and `deleteTodo`, `todoListId` must be derived from the `todo.todoListId` already fetched — use that variable.)

Do not apply to `reorderTodos` or `importTodosFromCSV` (reorder doesn't change counters; imports DO change the count but deferred since they weren't in §1.4 — leave for a future change).

Wait — `importTodosFromCSV` changes counters. Per spec §1.4, only `createTodo`/`deleteTodo`/`completeTodo`/`uncompleteTodo` are listed. The spec does not list `importTodosFromCSV`. Follow the spec strictly — no extra publishers. If the user notices a CSV-import counter stagger later, we add it in a follow-up.

Also: `completeTodo` handles both complete AND un-complete (via `completed: boolean` param). The spec lists them as separate rows but they're one function. Emit `counters-changed` on every call regardless of direction.

- [ ] **Step 4: Add user-inbox publishers to `service.ts`.**

Edit `packages/api/src/domains/todo-list/service.ts`. Add the same imports + helpers at module scope (DRY by duplicating — or extract to `todo-list/user-inbox-publishers.ts` if the duplication is ≥3 sites; here it's 5 sites, so extract).

Create `packages/api/src/domains/todo-list/user-inbox-publishers.ts`:

```ts
// User-inbox publishing helpers scoped to the todo-list domain. Each
// helper resolves its recipient set via a tx-scoped authz query and
// publishes one kind to every recipient's inbox. Services call these
// alongside their existing list-channel publishes. See ADR-001 and
// docs/conventions.md#realtime-channel-granularity.

import type { Prisma } from "@project/db";
import {
  type UserInboxEvent,
  userInboxChannelKey,
} from "@project/api/domains/user/user-events";
import { channel as defaultChannel } from "@project/realtime/channel";
import type { Channel } from "@project/realtime/types";

export type UserInboxChannelProvider = (key: string) => Channel<UserInboxEvent>;

export const defaultUserInboxProvider: UserInboxChannelProvider = (k) =>
  defaultChannel<UserInboxEvent>(k);

async function publishToEach(
  provider: UserInboxChannelProvider,
  recipientIds: readonly string[],
  event: UserInboxEvent,
): Promise<void> {
  if (recipientIds.length === 0) return;
  const unique = Array.from(new Set(recipientIds));
  await Promise.all(
    unique.map((id) => provider(userInboxChannelKey(id)).publish(event)),
  );
}

export async function listMemberIdsForList(
  tx: Prisma.TransactionClient,
  todoListId: string,
): Promise<string[]> {
  const list = await tx.todoList.findUniqueOrThrow({
    where: { id: todoListId },
    select: {
      userId: true,
      memberships: { select: { userId: true } },
    },
  });
  return [list.userId, ...list.memberships.map((m) => m.userId)];
}

export async function publishCountersChanged(
  provider: UserInboxChannelProvider,
  recipientIds: readonly string[],
  listId: string,
): Promise<void> {
  await publishToEach(provider, recipientIds, {
    kind: "todo-list-counters-changed",
    listId,
  });
}

export async function publishAccessGranted(
  provider: UserInboxChannelProvider,
  recipientIds: readonly string[],
  listId: string,
): Promise<void> {
  await publishToEach(provider, recipientIds, {
    kind: "todo-list-access-granted",
    listId,
  });
}

export async function publishAccessRevoked(
  provider: UserInboxChannelProvider,
  recipientIds: readonly string[],
  listId: string,
): Promise<void> {
  await publishToEach(provider, recipientIds, {
    kind: "todo-list-access-revoked",
    listId,
  });
}

export async function publishInvitesChanged(
  provider: UserInboxChannelProvider,
  recipientIds: readonly string[],
  listId: string,
): Promise<void> {
  await publishToEach(provider, recipientIds, {
    kind: "todo-list-invites-changed",
    listId,
  });
}
```

Register this file in `packages/api/package.json` exports under `./domains/todo-list/user-inbox-publishers` (alphabetically between `./domains/todo-list/todo-service` and `./domains/user/user-events`).

- [ ] **Step 5: Wire publishers into `service.ts`.**

Edit `packages/api/src/domains/todo-list/service.ts`. Add to imports:

```ts
import {
  type UserInboxChannelProvider,
  defaultUserInboxProvider,
  listMemberIdsForList,
  publishAccessGranted,
  publishAccessRevoked,
  publishInvitesChanged,
} from "./user-inbox-publishers.js";
```

For each of `inviteCollaborator`, `acceptInvite`, `removeCollaborator`, `deleteTodoList`: add an optional parameter to the options bag: `userInboxChannel?: UserInboxChannelProvider`. After the existing list-channel publish (if any), call the appropriate helper.

`inviteCollaborator` — at the end of the function body, before `return`:

```ts
const inboxProvider = options.userInboxChannel ?? defaultUserInboxProvider;
await publishInvitesChanged(inboxProvider, [invitee.id], listId);
```

`acceptInvite` — at the end of the function body, before `return`:

```ts
const inboxProvider = options.userInboxChannel ?? defaultUserInboxProvider;
const memberIds = await listMemberIdsForList(tx, invite.todoListId);
// memberIds now includes the newly-added accepter (membership was created above)
await publishAccessGranted(inboxProvider, memberIds, invite.todoListId);
// Owner's pending-invites view changed (invite was deleted)
const list = await tx.todoList.findUniqueOrThrow({
  where: { id: invite.todoListId },
  select: { userId: true },
});
await publishInvitesChanged(inboxProvider, [list.userId], invite.todoListId);
```

`removeCollaborator` — at the end of the function body:

```ts
const inboxProvider = options.userInboxChannel ?? defaultUserInboxProvider;
await publishAccessRevoked(inboxProvider, [targetUserId], listId);
```

`deleteTodoList` — before the `delete` call, capture member ids (list row is about to be deleted, taking memberships with it via cascade). Rework to capture ids first:

```ts
export async function deleteTodoList(
  tx: Prisma.TransactionClient,
  userId: string,
  id: string,
  options: { userInboxChannel?: UserInboxChannelProvider } = {},
) {
  const list = await tx.todoList.findFirstOrThrow({
    where: { id, userId },
  });
  const memberIds = await listMemberIdsForList(tx, list.id);
  const deleted = await tx.todoList.delete({ where: { id: list.id } });

  const inboxProvider = options.userInboxChannel ?? defaultUserInboxProvider;
  // Everyone except the deleter (the owner) sees their sidebar entry disappear.
  const recipients = memberIds.filter((mid) => mid !== userId);
  await publishAccessRevoked(inboxProvider, recipients, list.id);

  return deleted;
}
```

- [ ] **Step 6: Wire publishers into `todo-service.ts`.**

Edit `packages/api/src/domains/todo-list/todo-service.ts`. Add to imports:

```ts
import {
  type UserInboxChannelProvider,
  defaultUserInboxProvider,
  listMemberIdsForList,
  publishCountersChanged,
} from "./user-inbox-publishers.js";
```

For `createTodo`, `deleteTodo`, `completeTodo`: add an optional `userInboxChannel?: UserInboxChannelProvider` in the options. After each function's existing publish:

`createTodo` — after `await provider(listChannelKey(todoListId)).publish(...)`:

```ts
const inboxProvider = options.userInboxChannel ?? defaultUserInboxProvider;
const recipients = await listMemberIdsForList(tx, todoListId);
await publishCountersChanged(inboxProvider, recipients, todoListId);
```

`deleteTodo` — after the existing publish:

```ts
const inboxProvider = options.userInboxChannel ?? defaultUserInboxProvider;
const recipients = await listMemberIdsForList(tx, todo.todoListId);
await publishCountersChanged(inboxProvider, recipients, todo.todoListId);
```

`completeTodo` — after the existing publish:

```ts
const inboxProvider = options.userInboxChannel ?? defaultUserInboxProvider;
const recipients = await listMemberIdsForList(tx, todo.todoListId);
await publishCountersChanged(inboxProvider, recipients, todo.todoListId);
```

Router layer (`packages/api/src/domains/todo-list/router.ts` and `todo-router.ts`): no change needed — routers call service functions with the default options bag, and defaults kick in for user-inbox publishing the same way they do for list-channel publishing.

- [ ] **Step 7: Run the publish-assertion tests — they must pass.**

```bash
make test-unit
```
Expected: the 5 new tests in `user-inbox-publishes.test.ts` PASS. Existing tests still PASS.

- [ ] **Step 8: Full gate.**

```bash
make lint && make test-unit
```
Expected: PASS.

- [ ] **Step 9: Commit.**

```bash
git add packages/api/src/domains/todo-list/user-inbox-publishers.ts packages/api/src/domains/todo-list/service.ts packages/api/src/domains/todo-list/todo-service.ts packages/api/package.json packages/api/src/domains/user/__tests__/user-inbox-publishes.test.ts
git commit -m "$(cat <<'EOF'
feat(api): fan out user-inbox events from todo-list mutations

Wires publishToEach helpers for 6 mutations: createTodo, deleteTodo,
completeTodo (counters-changed); inviteCollaborator, acceptInvite
(invites-changed + access-granted); removeCollaborator, deleteTodoList
(access-revoked). Recipient resolution is a tx-scoped
listMemberIdsForList query. Default provider uses the process-wide
RedisChannel; tests inject MemoryChannelFactory via the options bag.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: declineInvite + revokeInvite mutations + pending-invites queries

**Spec sections:** §2.3.2 (UI contract), §3.2 (API surface).

**Files:**
- Modify: `packages/api/src/domains/todo-list/service.ts`
- Modify: `packages/api/src/domains/todo-list/router.ts`
- Create: `packages/api/src/domains/todo-list/__tests__/invites.test.ts`

- [ ] **Step 1: Write failing service tests.**

Create `packages/api/src/domains/todo-list/__tests__/invites.test.ts`:

```ts
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "bun:test";
import { db } from "@project/db";
import { TRPCError } from "@trpc/server";
import {
  declineInvite,
  inviteCollaborator,
  listMyPendingInvites,
  listPendingInvitesForList,
  revokeInvite,
} from "../service.js";

describe("invite service", () => {
  const OWNER_ID = "test-owner-inv";
  const INVITEE_ID = "test-invitee-inv";
  const OTHER_ID = "test-other-inv";
  let listId: string;

  beforeAll(async () => {
    await db.user.deleteMany({
      where: { id: { in: [OWNER_ID, INVITEE_ID, OTHER_ID] } },
    });
    await db.user.createMany({
      data: [
        {
          id: OWNER_ID,
          name: "Owner",
          email: "owner-inv@example.com",
          username: "owner-inv",
          emailVerified: false,
        },
        {
          id: INVITEE_ID,
          name: "Invitee",
          email: "invitee-inv@example.com",
          username: "invitee-inv",
          emailVerified: false,
        },
        {
          id: OTHER_ID,
          name: "Other",
          email: "other-inv@example.com",
          username: "other-inv",
          emailVerified: false,
        },
      ],
    });
  });

  beforeEach(async () => {
    const list = await db.todoList.create({
      data: { name: "Invite Svc", userId: OWNER_ID },
    });
    listId = list.id;
  });

  afterEach(async () => {
    await db.todoListInvite.deleteMany({ where: { todoListId: listId } });
    await db.todoListMembership.deleteMany({ where: { todoListId: listId } });
    await db.todoList.deleteMany({ where: { id: listId } });
  });

  afterAll(async () => {
    await db.user.deleteMany({
      where: { id: { in: [OWNER_ID, INVITEE_ID, OTHER_ID] } },
    });
    await db.$disconnect();
  });

  it("listMyPendingInvites returns invites addressed to the viewer, excludes expired", async () => {
    const inv = await db.$transaction((tx) =>
      inviteCollaborator(tx, OWNER_ID, listId, "invitee-inv"),
    );
    const rows = await listMyPendingInvites(db, INVITEE_ID);
    expect(rows.length).toBe(1);
    expect(rows[0]?.id).toBe(inv.invite.id);
    // Expire it; should not appear.
    await db.todoListInvite.update({
      where: { id: inv.invite.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const after = await listMyPendingInvites(db, INVITEE_ID);
    expect(after).toEqual([]);
  });

  it("listPendingInvitesForList returns invites for an owned list; rejects non-owner", async () => {
    await db.$transaction((tx) =>
      inviteCollaborator(tx, OWNER_ID, listId, "invitee-inv"),
    );
    const rows = await listPendingInvitesForList(db, OWNER_ID, listId);
    expect(rows.length).toBe(1);
    // Non-owner:
    await expect(
      listPendingInvitesForList(db, OTHER_ID, listId),
    ).rejects.toThrow(TRPCError);
  });

  it("declineInvite deletes the invite when called by invitee", async () => {
    const inv = await db.$transaction((tx) =>
      inviteCollaborator(tx, OWNER_ID, listId, "invitee-inv"),
    );
    await db.$transaction((tx) =>
      declineInvite(tx, INVITEE_ID, inv.invite.token),
    );
    expect(
      await db.todoListInvite.findUnique({ where: { id: inv.invite.id } }),
    ).toBeNull();
  });

  it("declineInvite rejects non-invitee", async () => {
    const inv = await db.$transaction((tx) =>
      inviteCollaborator(tx, OWNER_ID, listId, "invitee-inv"),
    );
    await expect(
      db.$transaction((tx) => declineInvite(tx, OTHER_ID, inv.invite.token)),
    ).rejects.toThrow(TRPCError);
  });

  it("revokeInvite deletes the invite when called by owner", async () => {
    const inv = await db.$transaction((tx) =>
      inviteCollaborator(tx, OWNER_ID, listId, "invitee-inv"),
    );
    await db.$transaction((tx) =>
      revokeInvite(tx, OWNER_ID, inv.invite.id),
    );
    expect(
      await db.todoListInvite.findUnique({ where: { id: inv.invite.id } }),
    ).toBeNull();
  });

  it("revokeInvite rejects non-owner", async () => {
    const inv = await db.$transaction((tx) =>
      inviteCollaborator(tx, OWNER_ID, listId, "invitee-inv"),
    );
    await expect(
      db.$transaction((tx) => revokeInvite(tx, INVITEE_ID, inv.invite.id)),
    ).rejects.toThrow(TRPCError);
  });
});
```

- [ ] **Step 2: Run — all tests must fail (functions not exported yet).**

```bash
make test-unit
```
Expected: FAIL (`declineInvite` etc not exported).

- [ ] **Step 3: Implement the four new service functions.**

Edit `packages/api/src/domains/todo-list/service.ts`. Append:

```ts
export async function listMyPendingInvites(
  db: DbClient,
  viewerId: string,
  options: { nowMs?: number } = {},
) {
  const now = new Date(options.nowMs ?? Date.now());
  return db.todoListInvite.findMany({
    where: {
      invitedUserId: viewerId,
      expiresAt: { gt: now },
    },
    orderBy: { createdAt: "desc" },
    include: {
      todoList: {
        select: {
          id: true,
          name: true,
          color: true,
          user: { select: { id: true, name: true, username: true } },
        },
      },
    },
  });
}

export async function listPendingInvitesForList(
  db: DbClient,
  ownerId: string,
  listId: string,
  options: { nowMs?: number } = {},
) {
  const now = new Date(options.nowMs ?? Date.now());
  const list = await db.todoList.findFirst({
    where: { id: listId, userId: ownerId },
    select: { id: true },
  });
  if (!list) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only the list owner can view pending invites.",
    });
  }
  return db.todoListInvite.findMany({
    where: {
      todoListId: listId,
      expiresAt: { gt: now },
    },
    orderBy: { createdAt: "desc" },
    include: {
      invitedUser: { select: { id: true, username: true, name: true } },
    },
  });
}

export async function declineInvite(
  tx: Prisma.TransactionClient,
  viewerId: string,
  token: string,
  options: { userInboxChannel?: UserInboxChannelProvider } = {},
) {
  const invite = await tx.todoListInvite.findFirst({
    where: { token, invitedUserId: viewerId },
    select: { id: true, todoListId: true },
  });
  if (!invite) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Invite not found or not addressed to you",
    });
  }
  await tx.todoListInvite.delete({ where: { id: invite.id } });

  const inboxProvider = options.userInboxChannel ?? defaultUserInboxProvider;
  // Owner's pending list changed.
  const list = await tx.todoList.findUniqueOrThrow({
    where: { id: invite.todoListId },
    select: { userId: true },
  });
  await publishInvitesChanged(inboxProvider, [list.userId], invite.todoListId);
}

export async function revokeInvite(
  tx: Prisma.TransactionClient,
  viewerId: string,
  inviteId: string,
  options: { userInboxChannel?: UserInboxChannelProvider } = {},
) {
  const invite = await tx.todoListInvite.findUnique({
    where: { id: inviteId },
    select: {
      id: true,
      invitedUserId: true,
      todoListId: true,
      todoList: { select: { userId: true } },
    },
  });
  if (!invite || invite.todoList.userId !== viewerId) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Invite not found or not owned by caller",
    });
  }
  await tx.todoListInvite.delete({ where: { id: invite.id } });

  const inboxProvider = options.userInboxChannel ?? defaultUserInboxProvider;
  // Invitee's pending list changed.
  await publishInvitesChanged(
    inboxProvider,
    [invite.invitedUserId],
    invite.todoListId,
  );
}
```

- [ ] **Step 4: Run tests — all pass.**

```bash
make test-unit
```
Expected: 6 new tests PASS; existing tests still PASS.

- [ ] **Step 5: Expose via router.**

Edit `packages/api/src/domains/todo-list/router.ts`. Add imports:

```ts
import {
  acceptInvite as acceptInviteFn,
  canReadList,
  createTodoList,
  declineInvite as declineInviteFn,
  deleteTodoList,
  getTodoList,
  inviteCollaborator as inviteCollaboratorFn,
  listAccessibleTodoLists,
  listCollaborators,
  listMyPendingInvites,
  listPendingInvitesForList,
  listTodoLists,
  removeCollaborator as removeCollaboratorFn,
  revokeInvite as revokeInviteFn,
} from "./service.js";
```

Insert, alphabetically by procedure key, these procedures in `todoListRouter`:

```ts
  declineInvite: protectedProcedure
    .input(z.object({ token: z.string().min(1) }))
    .mutation(({ ctx, input }) =>
      ctx.db.$transaction((tx) =>
        declineInviteFn(tx, ctx.session.user.id, input.token),
      ),
    ),
  myPendingInvites: protectedProcedure.query(({ ctx }) =>
    listMyPendingInvites(ctx.db, ctx.session.user.id),
  ),
  pendingInvites: protectedProcedure
    .input(z.object({ listId: z.string().min(1) }))
    .query(({ ctx, input }) =>
      listPendingInvitesForList(ctx.db, ctx.session.user.id, input.listId),
    ),
  revokeInvite: protectedProcedure
    .input(z.object({ inviteId: z.string().min(1) }))
    .mutation(({ ctx, input }) =>
      ctx.db.$transaction((tx) =>
        revokeInviteFn(tx, ctx.session.user.id, input.inviteId),
      ),
    ),
```

- [ ] **Step 6: Full gate.**

```bash
make lint && make test-unit
```
Expected: PASS.

- [ ] **Step 7: Commit.**

```bash
git add packages/api/src/domains/todo-list/service.ts packages/api/src/domains/todo-list/router.ts packages/api/src/domains/todo-list/__tests__/invites.test.ts
git commit -m "$(cat <<'EOF'
feat(api): invite lifecycle — decline/revoke + pending-invites queries

Adds declineInvite (invitee) and revokeInvite (owner) mutations, plus
myPendingInvites (invitee view) and pendingInvites (owner view)
queries. All invite-lifecycle transitions fan out
todo-list-invites-changed via the user inbox.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: `user.searchByUsername` query + tests

**Spec sections:** §2.3.1 (autocomplete), §1.2 (user-service file).

**Files:**
- Modify: `packages/api/src/domains/user/user-service.ts`
- Modify: `packages/api/src/domains/user/user-router.ts`
- Create: `packages/api/src/domains/user/__tests__/user-service.test.ts`

- [ ] **Step 1: Write failing service tests.**

Create `packages/api/src/domains/user/__tests__/user-service.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { db } from "@project/db";
import { searchUsersByUsername } from "../user-service.js";

describe("searchUsersByUsername", () => {
  const CALLER_ID = "test-search-caller";
  const IDS = ["u-alice", "u-alicia", "u-bob", "u-ali-admin"];

  beforeAll(async () => {
    await db.user.deleteMany({
      where: { id: { in: [CALLER_ID, ...IDS] } },
    });
    await db.user.createMany({
      data: [
        {
          id: CALLER_ID,
          name: "Caller",
          email: "caller-search@example.com",
          username: "caller-search",
          emailVerified: false,
        },
        {
          id: "u-alice",
          name: "Alice Smith",
          email: "alice@example.com",
          username: "alice",
          emailVerified: false,
        },
        {
          id: "u-alicia",
          name: "Alicia Jones",
          email: "alicia@example.com",
          username: "alicia",
          emailVerified: false,
        },
        {
          id: "u-bob",
          name: "Bob",
          email: "bob-search@example.com",
          username: "bob-search",
          emailVerified: false,
        },
        {
          id: "u-ali-admin",
          name: "Ali Admin",
          email: "ali-admin@example.com",
          username: "ali-admin",
          emailVerified: false,
        },
      ],
    });
  });

  afterAll(async () => {
    await db.user.deleteMany({
      where: { id: { in: [CALLER_ID, ...IDS] } },
    });
    await db.$disconnect();
  });

  it("matches users by username prefix (case-insensitive), excludes caller", async () => {
    const rows = await searchUsersByUsername(db, CALLER_ID, "ali");
    const usernames = rows.map((r) => r.username).sort();
    expect(usernames).toEqual(["ali-admin", "alice", "alicia"]);
  });

  it("matches users by display-name prefix (case-insensitive)", async () => {
    const rows = await searchUsersByUsername(db, CALLER_ID, "Bob");
    expect(rows.map((r) => r.username)).toContain("bob-search");
  });

  it("caps result count at 8", async () => {
    const rows = await searchUsersByUsername(db, CALLER_ID, "a");
    expect(rows.length).toBeLessThanOrEqual(8);
  });

  it("excludes the caller", async () => {
    const rows = await searchUsersByUsername(db, CALLER_ID, "caller");
    expect(rows.map((r) => r.id)).not.toContain(CALLER_ID);
  });
});
```

- [ ] **Step 2: Run — all must fail.**

```bash
make test-unit
```
Expected: FAIL.

- [ ] **Step 3: Implement `searchUsersByUsername`.**

Replace contents of `packages/api/src/domains/user/user-service.ts`:

```ts
import type { Prisma, PrismaClient } from "@project/db";

type DbClient = PrismaClient | Prisma.TransactionClient;

const MAX_SEARCH_RESULTS = 8;

export async function searchUsersByUsername(
  db: DbClient,
  callerId: string,
  prefix: string,
): Promise<Array<{ id: string; username: string; name: string }>> {
  const trimmed = prefix.trim();
  if (trimmed.length === 0) return [];
  return db.user.findMany({
    where: {
      AND: [
        { id: { not: callerId } },
        {
          OR: [
            { username: { startsWith: trimmed, mode: "insensitive" } },
            { name: { startsWith: trimmed, mode: "insensitive" } },
          ],
        },
      ],
    },
    select: { id: true, username: true, name: true },
    orderBy: { username: "asc" },
    take: MAX_SEARCH_RESULTS,
  });
}
```

- [ ] **Step 4: Expose via `user-router.ts`.**

Edit `packages/api/src/domains/user/user-router.ts`. Replace contents:

```ts
import { channel as defaultChannel } from "@project/realtime/channel";
import { z } from "zod";
import { protectedProcedure, router } from "../../trpc.js";
import { subscribeToUserInbox } from "./subscribe-to-user-inbox.js";
import { searchUsersByUsername } from "./user-service.js";
import { type UserInboxEvent, userInboxChannelKey } from "./user-events.js";

export const userRouter = router({
  searchByUsername: protectedProcedure
    .input(z.object({ prefix: z.string().min(1).max(64) }))
    .query(({ ctx, input }) =>
      searchUsersByUsername(ctx.db, ctx.session.user.id, input.prefix),
    ),
  onInboxEvent: protectedProcedure.subscription(async function* ({
    ctx,
    signal,
  }) {
    const ch = defaultChannel<UserInboxEvent>(
      userInboxChannelKey(ctx.session.user.id),
    );
    yield* subscribeToUserInbox(ch, signal);
  }),
});
```

- [ ] **Step 5: Run tests — pass.**

```bash
make test-unit
```
Expected: 4 new tests PASS.

- [ ] **Step 6: Full gate.**

```bash
make lint && make test-unit
```
Expected: PASS.

- [ ] **Step 7: Commit.**

```bash
git add packages/api/src/domains/user/user-service.ts packages/api/src/domains/user/user-router.ts packages/api/src/domains/user/__tests__/user-service.test.ts
git commit -m "$(cat <<'EOF'
feat(api): user.searchByUsername for invite autocomplete

Prefix search on username OR display name (case-insensitive), excludes
caller, capped at 8 results. Ordered by username for stable UI.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: `listCollaborators` shape change (owner + collaborators) + caller sweep

**Spec sections:** §2.4, §3.2 (caller-sweep note).

**Files:**
- Modify: `packages/api/src/domains/todo-list/service.ts`
- Modify: `packages/api/src/domains/todo-list/__tests__/service.test.ts` (extend if collaborators tests exist) or `router.test.ts`
- Modify: `apps/web/src/features/todo-list/collaborator-list.tsx` (consumer)

- [ ] **Step 1: Sweep callers first.**

Use Grep:
```
pattern: trpc\.todoList\.collaborators
```
Expected current consumers: `apps/web/src/features/todo-list/collaborator-list.tsx`. Confirm this is the only site before changing the return shape. Note any additional findings.

- [ ] **Step 2: Write/extend a service test for the new shape.**

Edit or append to `packages/api/src/domains/todo-list/__tests__/service.test.ts` (if there's an existing `listCollaborators` test, extend it; otherwise add one):

```ts
import { describe, it, expect } from "bun:test";
import { db } from "@project/db";
import { listCollaborators } from "../service.js";

describe("listCollaborators shape", () => {
  it("returns { owner, collaborators } — owner present, collaborator rows mapped", async () => {
    // Arrange: owner + 1 collab. Use unique ids so this test is isolated.
    const ownerId = "test-listCollab-owner";
    const collabId = "test-listCollab-collab";
    await db.user.deleteMany({ where: { id: { in: [ownerId, collabId] } } });
    await db.user.createMany({
      data: [
        {
          id: ownerId,
          name: "List Collab Owner",
          email: "lco@example.com",
          username: "lco",
          emailVerified: false,
        },
        {
          id: collabId,
          name: "List Collab Collab",
          email: "lcc@example.com",
          username: "lcc",
          emailVerified: false,
        },
      ],
    });
    const list = await db.todoList.create({
      data: { name: "Shape Test", userId: ownerId },
    });
    await db.todoListMembership.create({
      data: { userId: collabId, todoListId: list.id, role: "collaborator" },
    });

    const result = await listCollaborators(db, list.id);
    expect(result.owner.id).toBe(ownerId);
    expect(result.owner.username).toBe("lco");
    expect(result.collaborators.length).toBe(1);
    expect(result.collaborators[0]?.user.id).toBe(collabId);
    expect(result.collaborators[0]?.role).toBe("collaborator");

    // Cleanup
    await db.todoListMembership.deleteMany({ where: { todoListId: list.id } });
    await db.todoList.deleteMany({ where: { id: list.id } });
    await db.user.deleteMany({ where: { id: { in: [ownerId, collabId] } } });
  });
});
```

- [ ] **Step 3: Run — must fail.**

```bash
make test-unit
```
Expected: FAIL (`result.owner.id` undefined).

- [ ] **Step 4: Change `listCollaborators` shape.**

Edit `packages/api/src/domains/todo-list/service.ts`. Replace the existing `listCollaborators`:

```ts
export async function listCollaborators(db: DbClient, listId: string) {
  const list = await db.todoList.findUniqueOrThrow({
    where: { id: listId },
    select: {
      user: { select: { id: true, username: true, name: true } },
    },
  });
  const memberships = await db.todoListMembership.findMany({
    where: { todoListId: listId },
    include: {
      user: { select: { id: true, username: true, name: true } },
    },
  });
  return {
    owner: list.user,
    collaborators: memberships,
  };
}
```

- [ ] **Step 5: Run tests — pass.**

```bash
make test-unit
```
Expected: new test PASSES. Existing service tests unaffected (the function is the only change).

- [ ] **Step 6: Update the one caller — `collaborator-list.tsx` — to consume the new shape.**

Edit `apps/web/src/features/todo-list/collaborator-list.tsx`. Replace the rendering logic to iterate `{ owner, collaborators }` (full file rewrite shown for clarity):

```tsx
import type { AppRouter } from "@project/api/router";
import { Badge } from "@project/ui/components/badge";
import { Button } from "@project/ui/components/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TRPCOptionsProxy } from "@trpc/tanstack-react-query";
import { toast } from "sonner";

export function CollaboratorList({
  listId,
  ownerId,
  currentUserId,
  trpc,
}: {
  listId: string;
  ownerId: string;
  currentUserId: string;
  trpc: TRPCOptionsProxy<AppRouter>;
}) {
  const queryClient = useQueryClient();
  const collaborators = useQuery(
    trpc.todoList.collaborators.queryOptions({ listId }),
  );
  const remove = useMutation(
    trpc.todoList.removeCollaborator.mutationOptions({
      onSuccess: () => {
        toast.success("Collaborator removed");
        queryClient.invalidateQueries(
          trpc.todoList.collaborators.queryFilter({ listId }),
        );
      },
      onError: (err) => toast.error(err.message),
    }),
  );

  const isOwner = ownerId === currentUserId;

  if (collaborators.isPending) {
    return (
      <p className="text-sm text-muted-foreground">Loading collaborators…</p>
    );
  }
  if (collaborators.isError) {
    return (
      <p className="text-sm text-destructive">Couldn't load collaborators.</p>
    );
  }

  const data = collaborators.data;
  if (!data) return null;
  const { owner, collaborators: members } = data;

  return (
    <ul className="space-y-2">
      {/* Owner row — always rendered, no Remove button */}
      <li className="flex items-center justify-between rounded border p-2">
        <span className="flex items-center gap-2">
          {owner.name}{" "}
          <span className="text-muted-foreground">@{owner.username}</span>
          {owner.id === currentUserId && (
            <span className="text-muted-foreground">(You)</span>
          )}
          <Badge variant="secondary">Owner</Badge>
        </span>
      </li>

      {/* Collaborator rows */}
      {members.map((m) => (
        <li
          key={m.id}
          className="flex items-center justify-between rounded border p-2"
        >
          <span className="flex items-center gap-2">
            {m.user.name}{" "}
            <span className="text-muted-foreground">@{m.user.username}</span>
            {m.user.id === currentUserId && (
              <span className="text-muted-foreground">(You)</span>
            )}
            <Badge variant="outline">Collaborator</Badge>
          </span>
          {isOwner && m.user.id !== currentUserId && (
            <Button
              size="sm"
              variant="ghost"
              disabled={remove.isPending}
              onClick={() => remove.mutate({ listId, userId: m.user.id })}
            >
              Remove
            </Button>
          )}
        </li>
      ))}

      {members.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No other collaborators yet.
        </p>
      )}
    </ul>
  );
}
```

Note: if `Badge` isn't exported by `@project/ui`, check `packages/ui/src/components/` and import the correct path, or substitute an inline `<span className="text-xs rounded bg-secondary px-2 py-0.5">Owner</span>`.

- [ ] **Step 7: Verify the change on-screen isn't broken.**

```bash
make lint
```
Expected: PASS.

- [ ] **Step 8: Commit.**

```bash
git add packages/api/src/domains/todo-list/service.ts packages/api/src/domains/todo-list/__tests__/service.test.ts apps/web/src/features/todo-list/collaborator-list.tsx
git commit -m "$(cat <<'EOF'
feat(todo-list): include owner + role badges in collaborator list

Breaking return shape on todoList.collaborators: now returns
{ owner, collaborators }. UI renders the owner row first (no Remove
button, Owner badge), each collaborator row with a Collaborator badge,
and a "(You)" suffix on the viewer's own row.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Client hook — `use-user-inbox.ts` + dispatch map

**Spec sections:** §1.5 (client hook), §1.2 (FSD placement).

**Files:**
- Create: `apps/web/src/features/user/use-user-inbox.ts`
- Create: `apps/web/src/features/user/event-handlers.ts`
- Modify: `apps/web/src/routes/_authenticated/dashboard.tsx` (mount the hook)

- [ ] **Step 1: Create `features/user/event-handlers.ts` (dispatch map).**

Mirror `todo-list/event-handlers.ts` structure. All user-inbox kinds are notification-shape → `invalidateQueries`.

```tsx
// Per-kind handler map for UserInboxEvent. All kinds in this spec are
// notification-shape; handlers invalidate the affected queries and let
// TanStack Query refetch authoritative state.

import type {
  UserInboxEvent,
  UserInboxEventKind,
} from "@project/api/domains/user/user-events";
import type { AppRouter } from "@project/api/router";
import type { QueryClient } from "@tanstack/react-query";
import type { TRPCOptionsProxy } from "@trpc/tanstack-react-query";

type Handler<K extends UserInboxEventKind> = (
  trpc: TRPCOptionsProxy<AppRouter>,
  qc: QueryClient,
  event: Extract<UserInboxEvent, { kind: K }>,
) => void;

export const eventHandlers: { [K in UserInboxEventKind]: Handler<K> } = {
  "todo-list-counters-changed": (trpc, qc) => {
    qc.invalidateQueries(trpc.todoList.list.queryFilter());
    qc.invalidateQueries(trpc.todoList.listAccessible.queryFilter());
  },
  "todo-list-access-granted": (trpc, qc) => {
    qc.invalidateQueries(trpc.todoList.listAccessible.queryFilter());
  },
  "todo-list-access-revoked": (trpc, qc, ev) => {
    qc.invalidateQueries(trpc.todoList.list.queryFilter());
    qc.invalidateQueries(trpc.todoList.listAccessible.queryFilter());
    qc.invalidateQueries(trpc.todoList.get.queryFilter({ id: ev.listId }));
    qc.invalidateQueries(trpc.todo.list.queryFilter({ todoListId: ev.listId }));
  },
  "todo-list-invites-changed": (trpc, qc, ev) => {
    qc.invalidateQueries(trpc.todoList.myPendingInvites.queryFilter());
    qc.invalidateQueries(
      trpc.todoList.pendingInvites.queryFilter({ listId: ev.listId }),
    );
  },
};
```

- [ ] **Step 2: Create `features/user/use-user-inbox.ts`.**

Mirrors `todo-list/use-todo-list-live-updates.ts` structure, including leader-tab + `onStarted` invalidation glue (spec §1.5).

```tsx
// User-inbox subscription hook. One subscription per user session
// (leader-tab pattern shares the WS across tabs). onStarted fires on
// initial connect AND every reconnect; invalidates live-backed queries
// to close any gap. See ADR-001 §D3.

import type {
  UserInboxEvent,
  UserInboxEventKind,
} from "@project/api/domains/user/user-events";
import { USER_INBOX_EVENT_KINDS } from "@project/api/domains/user/user-events";
import type { AppRouter } from "@project/api/router";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import type { TRPCOptionsProxy } from "@trpc/tanstack-react-query";
import { useSubscription } from "@trpc/tanstack-react-query";
import { useEffect } from "react";
import { useLeaderTab } from "#/features/todo-list/use-leader-tab";
import { eventHandlers } from "./event-handlers.js";

export function useUserInbox(
  trpc: TRPCOptionsProxy<AppRouter>,
  userId: string | null,
) {
  const queryClient = useQueryClient();
  const { isLeader, broadcast, onMessage } = useLeaderTab(userId);

  useSubscription(
    trpc.user.onInboxEvent.subscriptionOptions(undefined, {
      enabled: isLeader && userId !== null,
      onStarted: () => {
        queryClient.invalidateQueries(trpc.todoList.list.queryFilter());
        queryClient.invalidateQueries(
          trpc.todoList.listAccessible.queryFilter(),
        );
        queryClient.invalidateQueries(
          trpc.todoList.myPendingInvites.queryFilter(),
        );
      },
      onData: (data) => {
        const event = data as unknown as UserInboxEvent;
        broadcast({ __userInboxRelay: true, event });
        dispatch(trpc, queryClient, event);
      },
    }),
  );

  useEffect(() => {
    return onMessage((data) => {
      if (isUserInboxRelay(data)) {
        dispatch(trpc, queryClient, data.event);
      }
    });
  }, [trpc, queryClient, onMessage]);
}

function dispatch(
  trpc: TRPCOptionsProxy<AppRouter>,
  qc: QueryClient,
  event: UserInboxEvent,
): void {
  eventHandlers[event.kind](trpc, qc, event as never);
}

function isUserInboxRelay(
  d: unknown,
): d is { __userInboxRelay: true; event: UserInboxEvent } {
  if (!d || typeof d !== "object") return false;
  const rec = d as Record<string, unknown>;
  if (rec.__userInboxRelay !== true) return false;
  const ev = rec.event as { kind?: unknown } | undefined;
  if (!ev || typeof ev.kind !== "string") return false;
  return (USER_INBOX_EVENT_KINDS as readonly string[]).includes(ev.kind);
}
```

Note: the BroadcastChannel relay uses `__userInboxRelay` (distinct from todo-list's `__relay`) so the two hooks can coexist without cross-talk. Both hooks use the same underlying `useLeaderTab(userId)` election — the leader tab handles both subscriptions; peers receive relays from both. No conflict because the message shapes are discriminated.

- [ ] **Step 3: Mount the hook in the dashboard (initial — expanded in Task 14).**

Edit `apps/web/src/routes/_authenticated/dashboard.tsx`:

```tsx
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@project/ui/components/card";
import { createFileRoute } from "@tanstack/react-router";
import { useSession } from "#/features/auth/auth-client";
import { useUserInbox } from "#/features/user/use-user-inbox";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardPage,
});

function DashboardPage() {
  const { data: session } = useSession();
  const { trpc } = Route.useRouteContext();
  useUserInbox(trpc, session?.user.id ?? null);

  return (
    <main className="max-w-2xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
      <h1 className="text-3xl font-bold mb-6">Dashboard</h1>
      <Card>
        <CardHeader>
          <CardTitle>
            Welcome, {session?.user.name ?? session?.user.email}
          </CardTitle>
          <CardDescription>You are signed in and ready to go.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Use the navigation above to manage your todos or explore the app.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
```

- [ ] **Step 4: Full gate.**

```bash
make lint && make test-unit
```
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add apps/web/src/features/user/ apps/web/src/routes/_authenticated/dashboard.tsx
git commit -m "$(cat <<'EOF'
feat(web): user-inbox subscription + dispatch map

Dashboard now subscribes to user.onInboxEvent via the leader tab (WS
shared across tabs). onStarted invalidates live-backed queries so
reconnect gaps are closed. All four UserInboxEventKinds dispatched to
notification-shape handlers that invalidateQueries on the affected
keys.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Navbar — lift to `__root.tsx`, signed-out state, admin link

**Spec sections:** §2.1, aggregation-modules convention.

**Files:**
- Modify: `apps/web/src/widgets/navbar.tsx`
- Modify: `apps/web/src/routes/__root.tsx`
- Modify: `apps/web/src/routes/_authenticated.tsx`
- Modify: `apps/web/src/routes/index.tsx` (remove its own "Sign In" button)

- [ ] **Step 1: Rewrite `navbar.tsx` with session-aware rendering + admin link.**

Edit `apps/web/src/widgets/navbar.tsx`:

```tsx
import { Button } from "@project/ui/components/button";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
} from "@project/ui/components/sheet";
import { Link } from "@tanstack/react-router";
import { Menu } from "lucide-react";
import { useState } from "react";
import { useSession } from "#/features/auth/auth-client";
import { UserBlock } from "#/features/auth/user-block";
import { env } from "@project/env/client";
import { Logo } from "./logo";

const authedLinks = [
  { to: "/dashboard" as const, label: "Dashboard" },
  { to: "/todo-lists" as const, label: "Todo Lists" },
];

export function Navbar() {
  const [open, setOpen] = useState(false);
  const { data: session } = useSession();
  const isAdmin = session?.user.role === "admin";
  const isAuthed = !!session;
  const jobsAdminHref = `${env.VITE_API_URL}/admin/queues/`;

  return (
    <nav className="border-b px-6 py-3 flex items-center justify-between">
      {/* Desktop */}
      <div className="flex items-center gap-6">
        <Logo />
        {isAuthed && (
          <div className="hidden md:flex items-center gap-6">
            {authedLinks.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                className="text-sm text-muted-foreground hover:text-foreground"
                activeProps={{
                  className: "text-sm font-semibold text-foreground",
                }}
              >
                {link.label}
              </Link>
            ))}
          </div>
        )}
      </div>

      <div className="hidden md:flex items-center gap-4">
        {isAuthed ? (
          <>
            {isAdmin && (
              <a
                href={jobsAdminHref}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                Jobs Admin
              </a>
            )}
            <UserBlock />
          </>
        ) : (
          <Button asChild size="sm">
            <Link to="/login">Sign In</Link>
          </Button>
        )}
      </div>

      {/* Mobile hamburger */}
      <div className="md:hidden">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon">
              <Menu className="h-5 w-5" />
              <span className="sr-only">Toggle menu</span>
            </Button>
          </SheetTrigger>
          <SheetContent>
            <nav className="flex flex-col gap-4 mt-6">
              {isAuthed &&
                authedLinks.map((link) => (
                  <Link
                    key={link.to}
                    to={link.to}
                    className="text-lg text-muted-foreground hover:text-foreground"
                    activeProps={{
                      className: "text-lg font-semibold text-foreground",
                    }}
                    onClick={() => setOpen(false)}
                  >
                    {link.label}
                  </Link>
                ))}
              {isAuthed && isAdmin && (
                <a
                  href={jobsAdminHref}
                  target="_blank"
                  rel="noreferrer"
                  className="text-lg text-muted-foreground hover:text-foreground"
                  onClick={() => setOpen(false)}
                >
                  Jobs Admin
                </a>
              )}
              <div className="border-t pt-4 mt-2">
                {isAuthed ? (
                  <UserBlock />
                ) : (
                  <Button asChild className="w-full">
                    <Link to="/login" onClick={() => setOpen(false)}>
                      Sign In
                    </Link>
                  </Button>
                )}
              </div>
            </nav>
          </SheetContent>
        </Sheet>
      </div>
    </nav>
  );
}
```

Verify `env.VITE_API_URL` is exposed in `@project/env/client`. If not, check `packages/env/src/client.ts` and expose it (it should already be there since the web app makes HTTP calls to the API). If absent, add it there first before this change compiles.

- [ ] **Step 2: Verify `session.user.role` is surfaced.**

Use Grep:
```
pattern: role.*user|user.*role
path: apps/web/src/features/auth/
```
and
```
pattern: better-auth
path: packages/auth/
```

Depending on how session is shaped, `session.user.role` may need surfacing via Better-Auth plugin config. Check that `useSession().data.user.role` compiles. If the TS type excludes `role`, extend Better-Auth's user type in `packages/auth/` to include the column (schema already has it; the type augmentation might be missing).

If blocked, fall back to a tRPC query `user.me()` that returns `{ role }` — but this is out of scope unless genuinely broken. Prefer the client-side session path.

- [ ] **Step 3: Lift Navbar into `__root.tsx`, remove from `_authenticated.tsx`.**

Edit `apps/web/src/routes/__root.tsx`. Add import and render `<Navbar />` inside the body, above the children:

```tsx
import { Navbar } from "#/widgets/navbar";
```

Edit `RootDocument`:

```tsx
function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  const { queryClient } = Route.useRouteContext();

  useEffect(() => {
    document.documentElement.setAttribute("data-hydrated", "");
  }, []);

  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body className="font-sans antialiased">
        <QueryClientProvider client={queryClient}>
          <Navbar />
          {children}
        </QueryClientProvider>
        <Toaster richColors closeButton />
        <Scripts />
      </body>
    </html>
  );
}
```

Edit `apps/web/src/routes/_authenticated.tsx` — remove `Navbar`:

```tsx
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: ({ context }) => {
    if (!context.session) throw redirect({ to: "/login" });
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  return (
    <div className="min-h-screen">
      <Outlet />
    </div>
  );
}
```

Edit `apps/web/src/routes/index.tsx` — remove the duplicated Sign-In button (Navbar carries it now):

```tsx
import { Button } from "@project/ui/components/button";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useSession } from "#/features/auth/auth-client";

export const Route = createFileRoute("/")({
  component: HomePage,
});

function HomePage() {
  const { data: session, isPending } = useSession();

  return (
    <main className="flex min-h-[calc(100vh-57px)] items-center justify-center">
      <div className="text-center">
        <h1 className="text-4xl font-bold mb-4">Agentic Web Stack</h1>
        <p className="text-lg text-muted-foreground mb-6">
          TanStack Start + Hono + tRPC + Prisma + Better-Auth
        </p>
        {isPending ? (
          <p className="text-muted-foreground">Loading...</p>
        ) : session ? (
          <Button asChild>
            <Link to="/dashboard">Go to Dashboard</Link>
          </Button>
        ) : null}
      </div>
    </main>
  );
}
```

- [ ] **Step 4: Full gate + visual check.**

```bash
make lint
```
Expected: PASS.

Start the dev server and eyeball the logged-out homepage, logged-in dashboard, and admin user's nav (if you can set `role = "admin"` on a test user via `db-push` + manual update):

```bash
make dev
```
Visit http://localhost:3000/ as anon, then sign in, then (optional) set `role = "admin"` via `psql` and reload to see "Jobs Admin".

- [ ] **Step 5: Commit.**

```bash
git add apps/web/src/widgets/navbar.tsx apps/web/src/routes/__root.tsx apps/web/src/routes/_authenticated.tsx apps/web/src/routes/index.tsx
git commit -m "$(cat <<'EOF'
feat(web): site-wide navbar with admin-gated Jobs Admin link

Navbar lifts from _authenticated to __root so the homepage also
renders it. Logged-out shows Sign In; logged-in shows nav links +
UserBlock; admins additionally see a Jobs Admin link opening
<API_URL>/admin/queues/ in a new tab.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Auth form UX — validation timing + schema split

**Spec section:** §2.2.

**Files:**
- Modify: `apps/web/src/routes/login.tsx`

- [ ] **Step 1: Replace the login form with split schemas + onBlur validation.**

Edit `apps/web/src/routes/login.tsx`. Replace the two schemas and the `useForm` setup:

```tsx
const signinSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1, "Password is required"),
});

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(MIN_PASSWORD_LENGTH, `Min ${MIN_PASSWORD_LENGTH} characters`),
  name: z.string().min(1, "Name is required"),
  username: z.string().min(1, "Username is required"),
});
```

Then change the form setup to switch validator by mode:

```tsx
const form = useForm({
  defaultValues: { email: "", password: "", name: "", username: "" },
  validators: { onBlur: isSignUp ? signupSchema : signinSchema, onSubmit: isSignUp ? signupSchema : signinSchema },
  onSubmit: async ({ value }) => { /* existing body unchanged */ },
});
```

`useForm`'s `validators` object needs to be updated when `isSignUp` flips. `useForm` reads its validators fresh on each interaction, but if this causes stale behavior, the explicit workaround is to call `form.reset()` when toggling mode (already done on the toggle button's `onClick` — verify).

Also update the password placeholder/minLength:

```tsx
<Input
  id={field.name}
  type="password"
  placeholder={isSignUp ? `Min ${MIN_PASSWORD_LENGTH} characters` : "Your password"}
  value={field.state.value}
  onBlur={field.handleBlur}
  onChange={(e) => field.handleChange(e.target.value)}
  required
  {...(isSignUp ? { minLength: MIN_PASSWORD_LENGTH } : {})}
/>
```

Rename the old `loginSchema` export — it's removed entirely. Grep for it to make sure nothing else referenced it:

```
pattern: loginSchema
path: apps/web/src/
```
Expected: no other references. If any, update them.

- [ ] **Step 2: Full gate.**

```bash
make lint
```
Expected: PASS.

- [ ] **Step 3: Manual smoke — verify in dev.**

Expected behavior:
- Open `/login` in signin mode. Fields show no errors on initial render or while typing.
- Blur the empty email field → "Invalid email" shows.
- Type `foo@bar.com`, blur password (empty) → "Password is required" shows.
- Toggle to signup → errors reset, fields re-validate on blur per signup schema.
- In signup, short password (< 8 chars) triggers "Min 8 characters" on blur.

- [ ] **Step 4: Commit.**

```bash
git add apps/web/src/routes/login.tsx
git commit -m "$(cat <<'EOF'
feat(web): auth form validates onBlur + onSubmit, splits signin/signup

Validation was firing on every keystroke across all fields (including
irrelevant ones for the current mode). Split into signinSchema (email
+ non-empty password) and signupSchema (+ name/username +
MIN_PASSWORD_LENGTH). Password hint only appears on signup.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Invite autocomplete — Command combobox + no-user error

**Spec section:** §2.3.1.

**Files:**
- Create: `apps/web/src/features/user/use-debounced-value.ts`
- Create: `apps/web/src/features/todo-list/invite-autocomplete.tsx`
- Modify: `apps/web/src/features/todo-list/share-list-dialog.tsx`

- [ ] **Step 1: Add `useDebouncedValue` hook.**

Create `apps/web/src/features/user/use-debounced-value.ts`:

```ts
import { useEffect, useState } from "react";

export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
```

- [ ] **Step 2: Build the autocomplete component.**

Verify shadcn `Command` is available:

```
pattern: components/command
path: packages/ui/src/
```

If present (most shadcn installs include it), use it. If absent, install via the shadcn CLI or fall back to a basic `<input> + <ul>` dropdown for this session.

Create `apps/web/src/features/todo-list/invite-autocomplete.tsx`:

```tsx
import type { AppRouter } from "@project/api/router";
import { Input } from "@project/ui/components/input";
import { useQuery } from "@tanstack/react-query";
import type { TRPCOptionsProxy } from "@trpc/tanstack-react-query";
import { useState } from "react";
import { useDebouncedValue } from "#/features/user/use-debounced-value";

type Candidate = { id: string; username: string; name: string };

export function InviteAutocomplete({
  trpc,
  onSelect,
  disabled,
}: {
  trpc: TRPCOptionsProxy<AppRouter>;
  onSelect: (selection: Candidate | null) => void;
  disabled?: boolean;
}) {
  const [raw, setRaw] = useState("");
  const debounced = useDebouncedValue(raw, 200);
  const enabled = debounced.trim().length > 0;

  const results = useQuery({
    ...trpc.user.searchByUsername.queryOptions(
      { prefix: debounced.trim() },
      { enabled },
    ),
  });

  const matches: Candidate[] = enabled ? (results.data ?? []) : [];
  const showNoMatch =
    enabled && results.isSuccess && matches.length === 0;

  return (
    <div className="space-y-1 w-full">
      <Input
        placeholder="Search by username or name"
        value={raw}
        onChange={(e) => {
          setRaw(e.target.value);
          onSelect(null);
        }}
        disabled={disabled}
        autoFocus
      />
      {matches.length > 0 && (
        <ul className="border rounded divide-y">
          {matches.map((u) => (
            <li key={u.id}>
              <button
                type="button"
                className="w-full text-left px-3 py-2 hover:bg-muted"
                onClick={() => {
                  onSelect(u);
                  setRaw(`@${u.username}`);
                }}
              >
                <span className="font-medium">{u.name}</span>{" "}
                <span className="text-muted-foreground">@{u.username}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {showNoMatch && (
        <p className="text-sm text-destructive">
          No user with that username.
        </p>
      )}
    </div>
  );
}
```

Note on the Command pattern: using a raw `<Input> + <ul>` is simpler and sufficient for the current UX. If a later pass wants shadcn `Command`, it's a drop-in swap. The current approach is intentionally minimal.

- [ ] **Step 3: Swap `ShareListDialog` to use the autocomplete.**

Edit `apps/web/src/features/todo-list/share-list-dialog.tsx`:

```tsx
import type { AppRouter } from "@project/api/router";
import { Button } from "@project/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@project/ui/components/dialog";
import { useMutation } from "@tanstack/react-query";
import type { TRPCOptionsProxy } from "@trpc/tanstack-react-query";
import { useState } from "react";
import { toast } from "sonner";
import { InviteAutocomplete } from "./invite-autocomplete";

export function ShareListDialog({
  listId,
  trpc,
}: {
  listId: string;
  trpc: TRPCOptionsProxy<AppRouter>;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<{
    id: string;
    username: string;
    name: string;
  } | null>(null);

  const invite = useMutation(
    trpc.todoList.inviteCollaborator.mutationOptions({
      onSuccess: () => {
        toast.success(
          selected
            ? `Invite sent to @${selected.username}`
            : "Invite sent",
        );
        setSelected(null);
        setOpen(false);
      },
      onError: (err) => toast.error(err.message),
    }),
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">Share</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite a collaborator</DialogTitle>
          <DialogDescription>
            Search by username. They'll receive an email to accept.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!selected) return;
            invite.mutate({ listId, username: selected.username });
          }}
        >
          <InviteAutocomplete
            trpc={trpc}
            onSelect={setSelected}
            disabled={invite.isPending}
          />
          <Button
            type="submit"
            disabled={!selected || invite.isPending}
          >
            Invite
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Full gate.**

```bash
make lint
```
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add apps/web/src/features/user/use-debounced-value.ts apps/web/src/features/todo-list/invite-autocomplete.tsx apps/web/src/features/todo-list/share-list-dialog.tsx
git commit -m "$(cat <<'EOF'
feat(web): invite autocomplete + no-user error in share dialog

Replaces the plain username input with a debounced prefix-match search
against user.searchByUsername. Selection is required before invite
submits. Empty results (after debounce settles) show "No user with
that username".

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Pending-invites UI — dashboard section + owner-side sub-list

**Spec section:** §2.3.2.

**Files:**
- Create: `apps/web/src/features/todo-list/pending-invites-dashboard.tsx`
- Create: `apps/web/src/features/todo-list/pending-invites-owner.tsx`
- Modify: `apps/web/src/routes/_authenticated/dashboard.tsx`
- Modify: `apps/web/src/features/todo-list/share-list-dialog.tsx` (render owner-side sub-list)

- [ ] **Step 1: Dashboard pending-invites card.**

Create `apps/web/src/features/todo-list/pending-invites-dashboard.tsx`:

```tsx
import type { AppRouter } from "@project/api/router";
import { Button } from "@project/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@project/ui/components/card";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TRPCOptionsProxy } from "@trpc/tanstack-react-query";
import { toast } from "sonner";

export function PendingInvitesDashboard({
  trpc,
}: {
  trpc: TRPCOptionsProxy<AppRouter>;
}) {
  const queryClient = useQueryClient();
  const invites = useQuery(trpc.todoList.myPendingInvites.queryOptions());

  const accept = useMutation(
    trpc.todoList.acceptInvite.mutationOptions({
      onSuccess: () => {
        toast.success("Invite accepted");
        queryClient.invalidateQueries(
          trpc.todoList.myPendingInvites.queryFilter(),
        );
        queryClient.invalidateQueries(
          trpc.todoList.listAccessible.queryFilter(),
        );
      },
      onError: (err) => toast.error(err.message),
    }),
  );
  const decline = useMutation(
    trpc.todoList.declineInvite.mutationOptions({
      onSuccess: () => {
        toast.success("Invite declined");
        queryClient.invalidateQueries(
          trpc.todoList.myPendingInvites.queryFilter(),
        );
      },
      onError: (err) => toast.error(err.message),
    }),
  );

  if (invites.isPending) return null;
  if (!invites.data || invites.data.length === 0) return null;

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>Pending invitations</CardTitle>
        <CardDescription>
          You've been invited to collaborate on these lists.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {invites.data.map((inv) => (
            <li
              key={inv.id}
              className="flex items-center justify-between rounded border p-2"
            >
              <span className="flex items-center gap-2">
                <span
                  className="inline-block h-3 w-3 rounded-full"
                  style={{ backgroundColor: inv.todoList.color }}
                />
                <span>
                  <span className="font-medium">{inv.todoList.name}</span>{" "}
                  <span className="text-muted-foreground">
                    (from @{inv.todoList.user.username})
                  </span>
                </span>
              </span>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => accept.mutate({ token: inv.token })}
                  disabled={accept.isPending || decline.isPending}
                >
                  Accept
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => decline.mutate({ token: inv.token })}
                  disabled={accept.isPending || decline.isPending}
                >
                  Decline
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
```

Note: the component consumes `inv.token` in mutation calls. Verify `listMyPendingInvites` returns `token` — the current service function returns the full invite rows via Prisma, so `token` is included by default. Check the include/select: the implementation above uses `include: { todoList: ... }` without `select` on the top level — Prisma returns all top-level columns by default including `token`. Confirm before running; if missing, update service to `select` `token` explicitly.

- [ ] **Step 2: Owner-side pending-invites sub-list.**

Create `apps/web/src/features/todo-list/pending-invites-owner.tsx`:

```tsx
import type { AppRouter } from "@project/api/router";
import { Button } from "@project/ui/components/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TRPCOptionsProxy } from "@trpc/tanstack-react-query";
import { toast } from "sonner";

export function PendingInvitesOwner({
  listId,
  trpc,
}: {
  listId: string;
  trpc: TRPCOptionsProxy<AppRouter>;
}) {
  const queryClient = useQueryClient();
  const invites = useQuery(
    trpc.todoList.pendingInvites.queryOptions({ listId }),
  );
  const revoke = useMutation(
    trpc.todoList.revokeInvite.mutationOptions({
      onSuccess: () => {
        toast.success("Invite revoked");
        queryClient.invalidateQueries(
          trpc.todoList.pendingInvites.queryFilter({ listId }),
        );
      },
      onError: (err) => toast.error(err.message),
    }),
  );

  if (invites.isPending) return null;
  if (!invites.data || invites.data.length === 0) return null;

  return (
    <section className="mt-4 space-y-2">
      <h4 className="text-sm font-semibold">Pending invites</h4>
      <ul className="space-y-2">
        {invites.data.map((inv) => (
          <li
            key={inv.id}
            className="flex items-center justify-between rounded border p-2"
          >
            <span>
              {inv.invitedUser.name}{" "}
              <span className="text-muted-foreground">
                @{inv.invitedUser.username}
              </span>
            </span>
            <Button
              size="sm"
              variant="ghost"
              disabled={revoke.isPending}
              onClick={() => revoke.mutate({ inviteId: inv.id })}
            >
              Revoke
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 3: Render dashboard card.**

Edit `apps/web/src/routes/_authenticated/dashboard.tsx`:

```tsx
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@project/ui/components/card";
import { createFileRoute } from "@tanstack/react-router";
import { useSession } from "#/features/auth/auth-client";
import { PendingInvitesDashboard } from "#/features/todo-list/pending-invites-dashboard";
import { useUserInbox } from "#/features/user/use-user-inbox";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardPage,
});

function DashboardPage() {
  const { data: session } = useSession();
  const { trpc } = Route.useRouteContext();
  useUserInbox(trpc, session?.user.id ?? null);

  return (
    <main className="max-w-2xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
      <h1 className="text-3xl font-bold mb-6">Dashboard</h1>
      <PendingInvitesDashboard trpc={trpc} />
      <Card>
        <CardHeader>
          <CardTitle>
            Welcome, {session?.user.name ?? session?.user.email}
          </CardTitle>
          <CardDescription>You are signed in and ready to go.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Use the navigation above to manage your todos or explore the app.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
```

- [ ] **Step 4: Render owner-side sub-list inside `share-list-dialog.tsx`.**

Edit `apps/web/src/features/todo-list/share-list-dialog.tsx` — add render of `PendingInvitesOwner` below the invite form (visible only to the owner; but the component itself returns null when empty, and the share dialog opens only for those with share permissions which is the owner today):

```tsx
import { PendingInvitesOwner } from "./pending-invites-owner";

// … inside DialogContent, below the form:
<PendingInvitesOwner listId={listId} trpc={trpc} />
```

- [ ] **Step 5: Full gate.**

```bash
make lint
```
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add apps/web/src/features/todo-list/pending-invites-dashboard.tsx apps/web/src/features/todo-list/pending-invites-owner.tsx apps/web/src/routes/_authenticated/dashboard.tsx apps/web/src/features/todo-list/share-list-dialog.tsx
git commit -m "$(cat <<'EOF'
feat(web): pending-invites UI on dashboard + share dialog

Invitee side: dashboard card listing lists you've been invited to,
with Accept and Decline buttons per invite. Owner side: share-list
dialog now shows pending invites under the invite form, with a Revoke
button. Both hidden when empty.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: Absolute invite URL

**Spec section:** §2.3.3.

**Files:**
- Modify: `packages/api/src/domains/todo-list/router.ts`

- [ ] **Step 1: Edit invite acceptUrl construction.**

Edit `packages/api/src/domains/todo-list/router.ts`. Add at the top:

```ts
import { env } from "@project/env/server";
```

Change the `acceptUrl` line inside `inviteCollaborator`:

```ts
acceptUrl: `${env.BETTER_AUTH_URL}/invites/${result.invite.token}`,
```

- [ ] **Step 2: Full gate.**

```bash
make lint && make test-unit
```
Expected: PASS.

- [ ] **Step 3: Commit.**

```bash
git add packages/api/src/domains/todo-list/router.ts
git commit -m "$(cat <<'EOF'
fix(api): absolute invite URL in email body

Was a bare path /invites/<token>, which rendered unclickable outside
the template's assumed origin. Now constructed from env.BETTER_AUTH_URL
so staging/prod emails contain the real domain.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: Issue #8 — diagnose + fix wrong-slot on owner side

**Spec section:** §2.5.1.

**Files:**
- Read: `apps/web/src/features/todo-list/event-handlers.ts` (the `todo-created` handler)
- Read: `packages/api/src/domains/todo-list/todo-service.ts` (server-side position assignment in `createTodo`)
- Possibly modify: `apps/web/src/features/todo-list/event-handlers.ts`

**Decision rule regardless of root cause:** the payload's authoritative `position` MUST be the sole ordering signal on the remote side. Any handler code that re-derives position from `createdAt` or appends blindly is the bug.

- [ ] **Step 1: Reproduction test.**

Extend `packages/api/src/domains/todo-list/__tests__/todo-service-publishes.test.ts` (or create a new client-side test if integration-level reproduction is needed):

Server-side: the existing `createTodo publishes todo-created` test already asserts `ev.todo.id` and `ev.todo.title`. Extend to also assert `ev.todo.position === 0` (new items go to top of active).

```ts
expect(ev.todo.position).toBe(0);
```

If this passes, the server is emitting the right position. The bug is client-side.

- [ ] **Step 2: Read `event-handlers.ts` and compare the `todo-created` handler to the initial sort comparator.**

Handler:
```ts
"todo-created": (trpc, qc, ev) => {
  qc.setQueryData<TodoWithList[]>(
    trpc.todo.list.queryFilter({ todoListId: ev.listId }).queryKey,
    (old) => (old ? sortTodos([...old, ev.todo]) : old),
  );
},
```

Comparator (`sortTodos`):
```ts
return [...arr].sort((a, b) => {
  if (a.completed !== b.completed) return a.completed ? 1 : -1;
  return a.position - b.position;
});
```

Server sort (in `listTodos`): `orderBy: [{ completed: "asc" }, { position: "asc" }]`.

These match. So the handler is applying the right sort. The bug may be in the `createTodo` server logic: looking at `todo-service.ts:83-89`, it does `lockActiveTodos` → `shiftActivePositions` (position += 1 on all active) → creates with `position: 0`. So the new item should be at position 0 (top).

For the owner observing a collaborator's create: the event fires on the list channel, `todo-created` handler runs on the owner's cache, `sortTodos([...old, ev.todo])` — but the old array already has items with shifted positions? No, the client cache was not refetched after the collaborator's mutation: the server shifted the DB rows, but the client cache still holds the pre-shift positions. Then the handler appends `ev.todo` (position 0) and re-sorts. Every OLD active item still has its old positions (0, 1, 2, …), so the sort produces `[ev.todo (0), oldItem0 (0), oldItem1 (1), …]` — which puts `ev.todo` first, and `oldItem0` at position 1 (since it's also position 0). This is the 2nd-from-top bug Denis described.

Root cause confirmed: **the cache patch doesn't mirror the server's position-shift.** Similar to the existing `todos-imported` handler which correctly shifts positions on active items before merging.

- [ ] **Step 3: Fix the `todo-created` handler to mirror the server's shift.**

Edit `apps/web/src/features/todo-list/event-handlers.ts`. Replace the `todo-created` handler:

```ts
"todo-created": (trpc, qc, ev) => {
  qc.setQueryData<TodoWithList[]>(
    trpc.todo.list.queryFilter({ todoListId: ev.listId }).queryKey,
    (old) => {
      if (!old) return old;
      // Mirror server shiftActivePositions: every active row bumps by 1
      // before inserting the new row at position 0. Without this, the
      // new row shares position 0 with an existing row and the sort is
      // undefined between them — visually appearing "second from top".
      const shifted = old.map((t) =>
        t.completed ? t : { ...t, position: t.position + 1 },
      );
      return sortTodos([...shifted, ev.todo]);
    },
  );
},
```

- [ ] **Step 4: Smoke-test in dev (two browser contexts).**

```bash
make dev
```

Open two browsers (or one normal + one private window). Sign in as owner in A, as collaborator in B. Share list from A to B. Add a todo in B. On A's screen, the new todo should be at the very top — not second. Pre-existing items should shift down.

- [ ] **Step 5: Full gate.**

```bash
make lint && make test-unit
```
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add apps/web/src/features/todo-list/event-handlers.ts packages/api/src/domains/todo-list/__tests__/todo-service-publishes.test.ts
git commit -m "$(cat <<'EOF'
fix(web): todo-created handler mirrors server position shift

Server shifts every active row's position +1 before inserting the new
row at 0 (todo-service.ts createTodo). The client handler was only
appending + sorting, leaving the pre-shift positions in cache. Two
rows sharing position 0 sorted non-deterministically; the new row
landed second-from-top from the owner's perspective. Now the handler
shifts active rows the same way before inserting.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 16: List-detail staleTime + mount invalidate

**Spec section:** §2.5.2.

**Files:**
- Modify: `apps/web/src/routes/_authenticated/todo-lists/$listId.tsx`

- [ ] **Step 1: Read the current route file.**

Use Read tool on `apps/web/src/routes/_authenticated/todo-lists/$listId.tsx`.

- [ ] **Step 2: Add mount-time invalidation.**

Add a `useEffect` that invalidates the detail + todos queries on mount (before the component's first render cycle settles). Example addition:

```tsx
import { useEffect } from "react";
// ... existing imports

function TodoListDetailPage() {
  const { trpc } = Route.useRouteContext();
  const { listId } = Route.useParams();
  const queryClient = useQueryClient();

  // Stale cache hazard: navigating dashboard → list detail shows stale
  // data until the next inbox event or manual action. Force refetch on
  // every mount; the realtime subscription handles updates thereafter.
  useEffect(() => {
    queryClient.invalidateQueries(trpc.todoList.get.queryFilter({ id: listId }));
    queryClient.invalidateQueries(trpc.todo.list.queryFilter({ todoListId: listId }));
  }, [queryClient, trpc, listId]);

  // ... rest of component
}
```

If the existing component uses a hook pattern like `useTodos(trpc, queryClient, listId)` and owns the queries there, insert the `useEffect` inside the route component (not the hook).

- [ ] **Step 3: Full gate.**

```bash
make lint
```
Expected: PASS.

- [ ] **Step 4: Smoke-test.**

Two browsers. A on list detail → A navigates to dashboard. B (in other browser) adds a todo. A navigates back to list detail. The new todo appears immediately — no manual refresh.

- [ ] **Step 5: Commit.**

```bash
git add apps/web/src/routes/_authenticated/todo-lists/\$listId.tsx
git commit -m "$(cat <<'EOF'
fix(web): invalidate list-detail queries on mount

Navigating dashboard → detail could show stale todos if a collaborator
mutated while the page was unmounted and the inbox subscription was
inactive (or the user was in a non-leader tab). Every mount now
invalidates the two live-backed queries; React Query refetches in
the background while rendering cached data.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 17: BDD step defs + scenarios

**Spec section:** §4.1.

**Files:**
- Create: `e2e/features/auth/homepage.feature`
- Create: `e2e/features/auth/signin-form.feature`
- Create: `e2e/features/todo-list/invitations.feature`
- Create: `e2e/features/todo-list/collaborators-visibility.feature`
- Create: `e2e/features/todo-list/realtime-dashboard.feature`
- Create: `e2e/features/todo-list/realtime-navigate-back.feature`
- Create matching step-definition files under `e2e/steps/auth/` and `e2e/steps/todo-list/`.

Read `e2e/CLAUDE.md` before starting this task. The step definitions must be added AFTER the UI is built (which it is, by this point) and must mirror existing step-def patterns in `e2e/steps/todo-list/`.

- [ ] **Step 1: Read e2e conventions.**

Use Read tool: `e2e/CLAUDE.md` (if exists), otherwise inspect an existing feature file and its step defs to mirror the pattern — e.g. `e2e/features/todo-list/*.feature` and `e2e/steps/todo-list/*.ts`.

- [ ] **Step 2: Write feature files.**

For each feature file, keep scenarios tight — one concrete behavior per scenario. Examples:

`e2e/features/auth/homepage.feature`:
```gherkin
Feature: Homepage is public, navigation reflects auth state

  Scenario: Anonymous visitor sees the hero and a Sign In button
    Given I am not signed in
    When I visit the homepage
    Then I see the "Agentic Web Stack" hero heading
    And I see a "Sign In" button in the navigation

  Scenario: Signed-in user sees their UserBlock in the nav
    Given I am signed in as "alice"
    When I visit the homepage
    Then I see my UserBlock in the navigation
    And I do not see a "Sign In" button

  Scenario: Admin users see the Jobs Admin link
    Given I am signed in as an admin
    When I visit the homepage
    Then I see a "Jobs Admin" link in the navigation
```

`e2e/features/auth/signin-form.feature`:
```gherkin
Feature: Sign-in form validates on blur/submit, not on every keystroke

  Scenario: Typing in one field does not flag others as invalid
    Given I am on the sign-in page
    When I type "foo@example.com" in the email field
    Then the password field shows no error

  Scenario: Blurring an empty email shows an email error
    Given I am on the sign-in page
    When I focus then blur the email field leaving it empty
    Then I see an email error

  Scenario: Password hint appears only on signup, not signin
    Given I am on the sign-in page
    Then the password placeholder is "Your password"
    When I toggle to the sign-up tab
    Then the password placeholder contains "Min 8 characters"
```

`e2e/features/todo-list/invitations.feature`:
```gherkin
Feature: Invite collaborators by username with autocomplete and pending UI

  Scenario: Autocomplete shows matching users by username prefix
    Given I own a list "Groceries"
    And users exist: "alice", "alicia", "bob"
    When I open the share dialog for "Groceries"
    And I type "ali" in the invite field
    Then I see "@alice" and "@alicia" in the suggestions
    And I do not see "@bob"

  Scenario: No user found shows inline error
    Given I own a list "Groceries"
    When I open the share dialog for "Groceries"
    And I type "nobody-exists" in the invite field
    Then I see "No user with that username."

  Scenario: Invited user sees the pending invite on their dashboard
    Given user "alice" owns a list "Groceries"
    And "alice" has invited "bob" to "Groceries"
    When I sign in as "bob" and open the dashboard
    Then I see "Groceries" under "Pending invitations"
    And I can Accept or Decline the invite

  Scenario: Owner can revoke a pending invite
    Given user "alice" owns a list "Groceries"
    And "alice" has invited "bob" to "Groceries"
    When I sign in as "alice" and open the share dialog for "Groceries"
    Then I see a "Pending invites" section containing "bob"
    When I click "Revoke" for "bob"
    Then the invite disappears from "Pending invites"
```

`e2e/features/todo-list/collaborators-visibility.feature`:
```gherkin
Feature: Collaborators list shows owner and roles

  Scenario: Owner sees themselves as "Owner (You)" and collaborators with role badges
    Given user "alice" owns a list "Groceries"
    And "bob" is a collaborator on "Groceries"
    When I sign in as "alice" and open the share dialog for "Groceries"
    Then I see "alice" with an "Owner" badge and a "(You)" suffix
    And I see "bob" with a "Collaborator" badge
    And I do not see a "Remove" button on "alice"'s row

  Scenario: Collaborator sees owner but no Remove buttons
    Given user "alice" owns a list "Groceries"
    And "bob" is a collaborator on "Groceries"
    When I sign in as "bob" and view the "Groceries" collaborators
    Then I see "alice" with an "Owner" badge
    And I see "bob" with a "Collaborator" badge and a "(You)" suffix
    And I do not see any "Remove" buttons
```

`e2e/features/todo-list/realtime-dashboard.feature` (two-browser):
```gherkin
Feature: Dashboard counters update live when collaborators mutate

  Scenario: Owner on dashboard sees counter bump after collaborator adds a todo
    Given user "alice" owns a list "Groceries"
    And "bob" is a collaborator on "Groceries"
    And I am signed in as "alice" and on the dashboard
    And the list "Groceries" shows 2 todos
    When "bob" adds a todo "Milk" to "Groceries" in another browser
    Then within 5 seconds the "Groceries" counter on my dashboard shows 3 todos
```

`e2e/features/todo-list/realtime-navigate-back.feature`:
```gherkin
Feature: Navigating back to a list refreshes its content

  Scenario: Todo added while off the detail page appears on return
    Given user "alice" owns a list "Groceries"
    And "bob" is a collaborator on "Groceries"
    And I am signed in as "alice" and on the "Groceries" detail page
    When I navigate to the dashboard
    And "bob" adds a todo "Milk" to "Groceries" in another browser
    And I navigate back to the "Groceries" detail page
    Then I see "Milk" in the list
```

- [ ] **Step 3: Write step defs.**

For each new `.feature`, mirror the existing `e2e/steps/todo-list/*.ts` pattern — create a matching step-def file. Where existing step defs implement a relevant sub-phrase (e.g., "I sign in as X", "I visit the homepage"), REUSE them; do not duplicate.

Two-browser scenarios: look at `e2e/steps/todo-list/collaborators.ts` (exported helpers) for the multi-context pattern and reuse.

- [ ] **Step 4: Run the BDD suite.**

```bash
make test
```
Expected: all scenarios pass, including pre-existing ones.

- [ ] **Step 5: Commit.**

```bash
git add e2e/features/ e2e/steps/
git commit -m "$(cat <<'EOF'
test(e2e): BDD coverage for post-testing fixes

Homepage/auth-nav visibility, signin-form blur-validation,
invitation autocomplete + pending UI on both sides, collaborator
role+owner rendering, two-browser dashboard counter bump, and
navigate-back list refresh. Reuses existing step primitives; new
scenarios exercise the user-inbox pipeline end-to-end.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 18: Final verification pass

**Files:** no changes — this task is a complete verification sweep before claiming done.

- [ ] **Step 1: Full lint + all tests.**

```bash
make lint && make test-unit && make test
```
Expected: ALL PASS. Read any failure output in full — never truncate.

- [ ] **Step 2: Spec-to-commits coverage check.**

For each punch-list item in `docs/superpowers/specs/2026-04-19-post-testing-fixes-design.md` §Part 2, verify at least one commit addresses it:

- #1 homepage/top-nav — Task 10
- #2 password hint on login — Task 11
- #3 signup validation timing — Task 11
- #4 invite autocomplete + no-user error — Task 12
- #5 pending-invites UI — Task 13
- #6 absolute invite URL — Task 14
- #7 collaborators owner + role badges — Task 8
- #8 wrong-slot on owner side — Task 15
- #10 stale list on navigate-back — Task 16
- #11 dashboard counters stale — Task 9 (user-inbox) + Task 15 (wrong-slot)
- #12 admin "Jobs Admin" — Task 10

Plus cross-cutting:
- ADR-001 import + conventions — Task 1
- Timestamps — Task 2
- User-inbox realtime architecture (server + client) — Tasks 3–5, 9
- `listCollaborators` return-shape + caller sweep — Task 8

- [ ] **Step 3: Smoke-test the end-to-end flows in dev.**

```bash
make dev
```

Walkthroughs:

1. Anon visits homepage. Sign In button top-right. Clicks → login form. Types email, doesn't see password error. Blurs password → error.
2. Signs up as "alice". Lands on dashboard. No pending invites yet.
3. In browser B, signs up as "bob". Back in A, alice opens a list, shares with "bob" via autocomplete. Sends.
4. B's dashboard reloads → pending invite "alice's list". Accept.
5. A's dashboard counter updates live when B adds a todo.
6. A navigates off list → B adds another todo → A navigates back → todo present.
7. Invite email (Mailpit) contains absolute URL `http://localhost:3001/invites/<token>`.
8. As admin (set via `psql` or similar), Jobs Admin link appears in nav and opens `http://localhost:3001/admin/queues/` in a new tab.

If any step fails, open a follow-up task to fix before claiming complete.

- [ ] **Step 4: Announce completion.**

Report to user: "All 11 fixes implemented and verified via `make lint && make test-unit && make test`. Smoke walkthroughs pass."

---

## Self-review notes (plan author)

**Spec coverage:** every item in §Part 2 maps to a task above (confirmed in Task 18 §2). Cross-cutting additions (ADR, conventions, user-inbox, timestamps, aggregation-modules convention) all have tasks.

**Placeholder scan:** no TBD / TODO / "add error handling" / "similar to Task N" references. Every code block is complete.

**Type consistency:** `userInboxChannel` option name used consistently across `createTodo`, `deleteTodo`, `completeTodo`, `inviteCollaborator`, `acceptInvite`, `removeCollaborator`, `deleteTodoList`, `declineInvite`, `revokeInvite`. `UserInboxChannelProvider` type defined once in `user-inbox-publishers.ts` and imported everywhere. Channel-key helper `userInboxChannelKey` re-exported from `user-events.ts`.

**Known soft spots the implementer should watch:**

- Task 4 Step 7: the subscription test may need a Memory-based alternative if the test harness doesn't spin up Redis. Follow the majority pattern used in `todo-list/__tests__/events.test.ts`.
- Task 10 Step 2: `session.user.role` type may require Better-Auth user-type augmentation. If blocked, the fallback is a `user.me()` tRPC query — but verify the client-side path first.
- Task 12 Step 2: shadcn `Command` vs plain input — the plan ships plain input + ul for simplicity; swap to `Command` if it's already installed.
- Task 13 Step 1: verify `listMyPendingInvites` returns `token` (needed by accept/decline mutations in the UI). Prisma default-selects top-level columns, so it should be fine — but confirm before merging.
