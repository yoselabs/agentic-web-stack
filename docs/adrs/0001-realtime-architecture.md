---
title: "ADR-001 — Realtime architecture: user inbox channel + Live+Snapshot reconciliation"
status: Accepted
applies-to: packages/api/src/domains/user, packages/api/src/domains/todo-list, packages/realtime, apps/web/src/features/user, apps/web/src/features/todo-list
---

# ADR-001 — User Inbox Channel + Live+Snapshot Reconciliation

## Status

**Accepted.** This ADR does
not replace the template's existing todo-list example — todo-list remains
the correct reference for *focused single-entity collab* with low event
rates and static authz. This ADR codifies the pattern for domains with:

- a persistent cross-feature UI surface (sidebar, dashboard, notifications),
- dynamic authz (membership/ban churn during sessions),
- unbounded ordered history,
- bursty event rates relative to TanStack Query's default `staleTime`.

Chat is the canonical example; the pattern generalizes to feeds, inboxes,
multi-room collab, and any notifications-bearing app.

---

## Context

### Forces

1. **Persistent sidebar.** The sidebar must always reflect: per-room unread
   counts, per-contact presence, DM notifications. It stays
   live regardless of which page/room the user is viewing. Any per-entity
   subscription pattern collapses into "the sidebar subscribes to
   everything the user cares about anyway" — so we formalize that as the
   primary pattern.
2. **Dynamic authz.** Bans, room removals, friendship revocations, session
   invalidations happen mid-session. Subscriptions must reflect the current
   authz state, not a subscription-time snapshot.
3. **Unbounded history.** Rooms may hold 10K–100K messages. Nothing
   can "refetch everything" on reconnect without collapsing the UI.
4. **Frequent reconnects.** Chrome aggressively sleeps backgrounded tabs,
   network blips, and server restarts all drop WebSockets. The pattern must
   tolerate disconnects of any length without silent data loss.
5. **Multi-tab amplification.** A user may open 3+ tabs; without
   coordination, subscription cost multiplies by tab count.
6. **Spec-bound scale.** 300 concurrent users, rooms ≤ 1000 participants,
   message delivery < 3s, presence < 2s. We are nowhere near regimes that
   require sharding or outbox infrastructure.

### What the template already provides

- `@project/realtime` — `Channel<TEvent>` abstraction with `MemoryChannel`
  (tests) and `RedisChannel` (production).
- `@project/api/domains/todo-list/events.ts` — per-domain event-kind SSOT
  tuple + discriminated union (`TODO_LIST_EVENT_KINDS` → `TodoListEventKind`
  → `TodoListEvent`).
- `@project/jobs` — BullMQ queues for side-effects.
- `apps/web/src/features/todo-list/use-todo-list-live-updates.ts` — tRPC
  `useSubscription` pattern + leader-tab + BroadcastChannel relay.
- `apps/web/src/features/todo-list/event-handlers.ts` — per-kind dispatch
  map with payload-vs-notification discipline.
- `docs/conventions.md` — event naming, shape discipline, SSOT tuple rule.

### Gaps chat exposes

1. **Channel granularity guidance for cross-feature UI surfaces.** The
   todo-list reference uses per-entity channels; this doesn't serve a
   sidebar.
2. **Reconnect-gap reconciliation.** tRPC subscriptions do not replay
   missed events. TanStack Query's default `refetchOnReconnect` is gated
   by `staleTime: 60_000` (the template default) — a 10-second
   disconnect silently loses events because the data is still "fresh".
3. **Cursor/watermark for unbounded history.** todo-list's queries are
   full-snapshot; chat needs delta retrieval.

This ADR fills all three gaps.

---

## Decision

### D1 — Channel granularity

**One `user:{id}` inbox channel per user.** Every event the user is
authorized to receive publishes to that single channel. The server
decides at publish time which users receive each event, based on current
authz (room membership, not banned, friendship intact). Banned users
never receive room events because the server does not publish to them
after the ban commits.

Channel keys follow the template's existing convention:

```ts
export function userInboxChannelKey(userId: string): string {
  return `user:${userId}`;
}
```

Client-side: one subscription per user tab-group (via leader-tab pattern
from the template) receives the heterogeneous stream.

### D2 — Event contract

Follow `docs/conventions.md` verbatim, with one addition: **every ordered
payload-shape event carries a monotonic watermark scoped to its aggregate.**

- Const tuple is the SSOT.
- Discriminated union is derived from the tuple.
- Each kind commits to one shape at design time (payload or notification).
- Naming: `<domain>-<verb>`, singular for single-entity, plural for bulk.

### D3 — Live+Snapshot reconciliation

Three layers that together guarantee eventual-consistency for the UI:

1. **Snapshot layer.** Every live-backed UI surface is fed by a query that
   either returns a full snapshot (small-set data) or accepts a cursor
   (unbounded-history data). The query is the **source of truth for
   reconnect** — whatever the query returns is what the cache holds.

2. **Live layer.** WS events patch the cache for data already loaded via
   `setQueryData` (payload-shape) or trigger a refetch via
   `invalidateQueries` (notification-shape).

3. **Reconnect glue.** The tRPC subscription's `onStarted` callback fires
   on initial connect AND every reconnect. It invalidates a hand-
   enumerated list of live-backed query keys. TanStack Query refetches
   each with its current input args (including cursors), closing any gap
   accumulated during disconnect.

### D4 — Gap detection via watermark

Every ordered payload-shape event carries `{ watermark: number }` scoped
to its aggregate (e.g., messages are scoped per-room). Client holds
`lastSeenWatermark` per scope.

On each incoming event:

- If `event.watermark === lastSeenWatermark + 1` → patch cache, update
  `lastSeenWatermark`.
- Else (gap detected, `event.watermark > lastSeenWatermark + 1`) →
  invalidate the corresponding query. TanStack Query refetches with
  cursor = `lastSeenWatermark`, closing the gap. The event's own payload
  falls into the refetch result and is processed there.

This is cheaper than server-side event replay (no outbox needed) and
handles arbitrarily long gaps (refetch doesn't care about gap size).

---

## Rationale

| Choice | Why | Why-not-the-alternative |
|---|---|---|
| User inbox, not per-entity | Sidebar + DMs + presence + membership changes span all entities; user is the only scope that encompasses them | Per-entity forces a "subscribe to everything" backdoor for the sidebar; and authz cascade needs subscription-close dance |
| User inbox, not per-domain | Single-domain app; splitting produces N-way reconnect amplification without cost savings | Per-domain earns its place only when domains have distinct volumes/authz/reconnect semantics |
| Publish-time authz | Banned user never receives the event; no race | Subscribe-time authz needs active subscription cancellation — template has the pattern (`subscribeToListEvents` auto-close) but it's extra complexity |
| Monotonic watermark, not timestamp | Gap detection needs strict ordering within scope; timestamps collide at millisecond resolution and skew across clock sources | Timestamps "work" 99% of the time until they don't |
| State refresh on reconnect, not event replay | Queries already have the "give me state since X" endpoint; no event log to build or prune | Event replay reinvents queries with worse retention and more infra |
| Explicit `onStarted` invalidation | `staleTime` defaults are tuned per-app; relying on default `refetchOnReconnect` hides reconnect behavior behind a config knob | Stale-time gating means sub-minute disconnects silently lose data at chat's event rate |
| Cursor-aware queries reused for reconnect | Same endpoint serves initial mount, scrollback, and gap-recovery — cursor arg differentiates | Dedicated "catchup" API doubles surface area with no semantic gain |
| Leader-tab already in template | Amortizes WS cost across tabs; BroadcastChannel relay is same-origin trusted | Per-tab subscription multiplies server load and reconnect cost by tab count |

---

## Alternatives Considered

### A. Per-entity channels (template's todo-list pattern, extended to rooms)

`channel("room:{id}")` per room. Subscribe when viewing that room.

- **Pros:** matches existing template reference; subscription size scales with active view count.
- **Cons:** sidebar needs data from ALL rooms the user is a member of, forcing multi-subscribe; authz cascade on ban requires subscription-close (already in template via `subscribeToListEvents` auto-close, but more code to maintain); N-way reconnect amplification; presence and DMs don't fit the room scope cleanly.
- **Verdict:** keep for todo-list; do not extend to chat.

### B. Per-domain user channels (`user:{id}:chat`, `user:{id}:presence`, ...)

- **Pros:** enables per-domain volume isolation, differential authz models.
- **Cons:** our app has exactly one domain (chat); splitting is division without quotient. N subscriptions, N onStarted hooks, N reconnect races.
- **Verdict:** document as the pattern for multi-product suites; not used here.

### C. Server-side event replay (outbox + cursor-subscribe)

Persist an event log; client's `subscribe({ since: lastEventId })` gets replayed events; dispatch is identical for live and replayed.

- **Pros:** unified processing; exactly-once delivery.
- **Cons:** requires event-log storage + retention policy; can't replay long gaps; reinvents what cursor-aware queries already do.
- **Verdict:** chat doesn't have exactly-once requirements; don't build.

### D. Socket.io rooms

Off-the-shelf library-managed rooms + presence.

- **Pros:** batteries-included.
- **Cons:** fights the template (tRPC subscriptions are the ordained transport); adds a second realtime ecosystem to the codebase.
- **Verdict:** no.

---

## Future optimization — `tracked()` event replay

tRPC v11's `tracked(id, data)` helper tags each yielded event with a monotonic ID. When paired with `httpSubscriptionLink` (SSE), the client's `EventSource` auto-sends `Last-Event-ID` on reconnect, and your server generator can replay events published during the disconnect window.

### Default: avoid

**For the first version of any domain, do NOT adopt `tracked()` replay.** The Live+Snapshot pattern in §D3 already handles reconnect correctly via `onStarted` invalidation + cursor-aware refetch. Building `tracked()` adds an event-log store (in-memory ring buffer, Redis Stream, or Postgres table) plus a retention policy — infrastructure that pays off only for specific domain shapes.

### Revisit when ALL of the following hold

1. **Reconnect refetch is measurably expensive.** The query that backs the UI surface performs heavy joins, ranking, or spans many aggregates (e.g., "last page of messages across 20 chat rooms," ranked social feed). A `COUNT`/list refetch does not qualify.
2. **Event rate is high relative to refetch cost.** Missing events during a 30s blip yields a small delta (cheap to replay) but the authoritative refetch is large (expensive). The inequality `replay_cost × avg_events_per_disconnect ≪ refetch_cost` must be true under realistic load.
3. **Most disconnects are short.** If users routinely disconnect for hours, they exceed retention and fall back to refetch anyway (see "Retention bound" below) — replay buys nothing.
4. **Duplicate/out-of-order tolerance matters.** Unordered payload-shape events (e.g., `presence-updated`) benefit from `tracked()`'s per-event idempotency keys even without replay, because the client can dedupe by ID.

If fewer than all four hold, keep §D3's refetch pattern.

### Challenge prompts before adopting

- What is the P50 and P95 disconnect duration for real users on this domain? (If you don't know, measure first.)
- What does the `onStarted` refetch currently cost in ms and bytes? Is it actually a problem?
- What retention window does the replay store need to cover 95% of disconnects? Does that fit in memory / Redis / Postgres within your ops budget?
- Who owns the retention-expiry job and its alerting? (If the answer is "nobody," you will ship a silent data-loss bug.)
- Does the domain already need a durable event log for audit / compliance? If yes, `tracked()` is nearly free on top. If no, you are standing up stateful infra solely for reconnect optimization.

### Retention bound — honesty clause

Whatever store you pick is bounded. When a client reconnects with a `lastEventId` that has aged out of retention:

- The server detects "ID not in store" and falls back to yielding from live only
- The client's `onStarted` invalidation still runs (same path as today)
- Result: long disconnects converge via refetch, identical to the no-`tracked()` baseline

`tracked()` is therefore an **optimization for short-to-medium disconnects**, never a replacement for cursor-aware refetch. The fallback path must remain implemented and tested.

### Implementation sketch (Redis Streams)

Preferred backing store for this template: Redis Streams. Reuses the Redis instance already required by `@project/realtime`, provides server-side monotonic IDs, and supports `MAXLEN ~ N` capped retention natively.

```ts
// Durable variant alongside the existing Channel abstraction
export interface DurableChannel<T> extends Channel<T> {
  // XRANGE from exclusive-id to "+"
  replay(sinceEventId: string | undefined): AsyncIterable<[string, T]>;
}

// Subscription generator
onInboxEvent: protectedProcedure
  .input(z.object({ lastEventId: z.string().optional() }))
  .subscription(async function* ({ ctx, input }) {
    const ch = ctx.channels.durable<InboxEvent>(key(ctx.session.userId));

    // Replay phase — only events the client missed
    for await (const [id, ev] of ch.replay(input.lastEventId)) {
      yield tracked(id, ev);
    }

    // Live phase — XREAD BLOCK
    for await (const [id, ev] of ch.subscribe()) {
      yield tracked(id, ev);
    }
  });
```

Publishers additionally `XADD` to the stream with `MAXLEN ~ <cap>` to trim. Cap is per-user-per-domain; size it so `cap / avg_events_per_minute` exceeds P95 disconnect duration.

Client migrates from `wsLink` to `httpSubscriptionLink` to get automatic `Last-Event-ID` handshake. See `apps/web/src/router.tsx` and the `TODO.md` recipe note.

### Verdict

Documented as an available optimization. **Not adopted for any current domain** in this template. If a future domain's reconnect refetch becomes a measured bottleneck, revisit — do not adopt speculatively.

---

## Implementation

File structure aligned with the template's FSD/DDD cross-layer naming:

```
packages/api/src/domains/chat/
├── chat-constants.ts         # event SSOT tuple, message limits, channel keys
├── chat-events.ts            # event union + channel key helper
├── chat-service.ts           # business logic + publish
├── chat-router.ts            # tRPC queries + subscription
└── chat-types.ts             # shared types

apps/web/src/features/chat/
├── event-handlers.ts         # per-kind dispatch map
├── use-inbox-live-updates.ts # WS subscription + onStarted glue
├── use-messages.ts           # cursor-aware message query
└── use-rooms.ts              # room list query
```

### 1. Event SSOT (`packages/api/src/domains/chat/chat-events.ts`)

```ts
// Event union published to per-user inbox channels.
// Pattern: ADR-001.
// Consumed by:
//   - chat-router.ts (tRPC subscription; fan-out to WS clients)
//   - chat-service tests (via MemoryChannel assertions)

import type { Message, RoomMember, User } from "@project/db";

// SSOT tuple. Adding a kind without extending this tuple produces a
// compile error at every exhaustive consumer (handlers map, server
// publishers).
export const CHAT_EVENT_KINDS = [
  // Payload-shape: cache-patchable, carry watermark for ordered streams.
  "room-message-created",
  "room-message-edited",
  "room-message-deleted",

  // Notification-shape: invalidate-and-refetch; no payload guarantees.
  "room-membership-changed",
  "room-member-banned",
  "room-deleted",

  // Presence (payload-shape but unordered; no watermark).
  "presence-updated",

  // Unread (payload-shape; derives from room watermark).
  "room-unread-bumped",

  // DM (payload-shape; DM is modeled as a 2-member room under the hood,
  // but the event kind is distinct so the sidebar handler knows which
  // UI list to update).
  "dm-message-created",

  // Session authority (notification-shape; tab revalidates auth).
  "session-invalidated",
] as const;

export type ChatEventKind = (typeof CHAT_EVENT_KINDS)[number];

// Shapes per kind. Payload events carry the full post-commit entity so
// clients can patch cache without refetching. Notification events carry
// only identifiers; clients invalidate and refetch the authoritative
// state.
export type ChatEvent =
  // --- Payload-shape, ordered (watermark-bearing) ---
  | {
      kind: "room-message-created";
      roomId: string;
      watermark: number;        // monotonic per roomId
      message: Message & { author: Pick<User, "id" | "username"> };
    }
  | {
      kind: "room-message-edited";
      roomId: string;
      watermark: number;
      message: Message & { author: Pick<User, "id" | "username"> };
    }
  | {
      kind: "room-message-deleted";
      roomId: string;
      watermark: number;
      messageId: string;
    }

  // --- Notification-shape ---
  | { kind: "room-membership-changed"; roomId: string; userId: string }
  | { kind: "room-member-banned"; roomId: string; userId: string; bannedBy: string }
  | { kind: "room-deleted"; roomId: string }
  | { kind: "session-invalidated"; sessionId: string }

  // --- Payload-shape, unordered ---
  | {
      kind: "presence-updated";
      userId: string;
      status: "online" | "afk" | "offline";
      lastActivityAt: string;   // ISO timestamp
    }
  | { kind: "room-unread-bumped"; roomId: string; watermark: number }
  | {
      kind: "dm-message-created";
      peerUserId: string;
      watermark: number;
      message: Message & { author: Pick<User, "id" | "username"> };
    };

export function userInboxChannelKey(userId: string): string {
  return `user:${userId}`;
}
```

### 2. Service — publish with watermark and authz (`chat-service.ts`)

Atomic watermark assignment via `UPDATE ... RETURNING` inside the same
transaction as the insert. Fan-out loops over authorized recipients and
publishes to each user's inbox channel.

```ts
import { prisma, type PrismaClient } from "@project/db";
import type { Channel, ChannelFactory } from "@project/realtime/types";
import type { ChatEvent } from "./chat-events";
import { userInboxChannelKey } from "./chat-events";

// Service is dependency-injected with a ChannelFactory so unit tests can
// use MemoryChannel and assert on emitted events.
export class ChatService {
  constructor(
    private readonly db: PrismaClient,
    private readonly channels: ChannelFactory,
  ) {}

  async sendRoomMessage(input: {
    roomId: string;
    authorUserId: string;
    text: string;
  }): Promise<{ messageId: string; watermark: number }> {
    // 1. Authz. Throws if caller isn't a non-banned member.
    await this.assertRoomMember(input.roomId, input.authorUserId);

    // 2. Transactional watermark + insert. The UPDATE ... RETURNING is
    //    atomic in Postgres; concurrent senders serialize on the row
    //    lock without deadlock risk.
    const { message, watermark } = await this.db.$transaction(async (tx) => {
      const room = await tx.room.update({
        where: { id: input.roomId },
        data: { nextWatermark: { increment: 1 } },
        select: { nextWatermark: true },
      });
      const watermark = room.nextWatermark;
      const message = await tx.message.create({
        data: {
          roomId: input.roomId,
          authorUserId: input.authorUserId,
          text: input.text,
          roomWatermark: watermark,
        },
        include: { author: { select: { id: true, username: true } } },
      });
      return { message, watermark };
    });

    // 3. Fan-out. Read current membership AFTER commit so any membership
    //    changes racing this send are applied consistently. A user banned
    //    between step 1 and step 3 does NOT receive the event.
    const recipients = await this.db.roomMember.findMany({
      where: { roomId: input.roomId, bannedAt: null },
      select: { userId: true },
    });

    const event: ChatEvent = {
      kind: "room-message-created",
      roomId: input.roomId,
      watermark,
      message,
    };

    await Promise.all(
      recipients.map((r) =>
        this.channels
          .channel<ChatEvent>(userInboxChannelKey(r.userId))
          .publish(event),
      ),
    );

    return { messageId: message.id, watermark };
  }

  private async assertRoomMember(roomId: string, userId: string): Promise<void> {
    const membership = await this.db.roomMember.findUnique({
      where: { roomId_userId: { roomId, userId } },
      select: { bannedAt: true },
    });
    if (!membership || membership.bannedAt !== null) {
      throw new Error("FORBIDDEN"); // tRPC router translates to TRPCError
    }
  }
}
```

### 3. Router — cursor-aware query + subscription (`chat-router.ts`)

```ts
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../../trpc";
import type { ChatEvent } from "./chat-events";
import { userInboxChannelKey } from "./chat-events";
import { subscribeToInbox } from "./subscribe-to-inbox";

const MESSAGE_PAGE_LIMIT = 50;

export const chatRouter = router({
  // --- Cursor-aware snapshot query: messages in a room ---
  // Cursor semantics:
  //   cursor undefined  → latest MESSAGE_PAGE_LIMIT messages (initial load)
  //   cursor { before } → older than cursor.before (scrollback)
  //   cursor { after  } → newer than cursor.after (reconnect gap-recovery)
  //
  // The SAME endpoint serves all three callers — the cursor arg changes
  // role but the endpoint shape does not.
  messagesForRoom: protectedProcedure
    .input(
      z.object({
        roomId: z.string(),
        cursor: z
          .union([
            z.object({ before: z.number().int().nonnegative() }),
            z.object({ after: z.number().int().nonnegative() }),
          ])
          .optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      await ctx.chat.assertRoomMember(input.roomId, ctx.session.userId);

      const where = input.cursor
        ? "before" in input.cursor
          ? { roomId: input.roomId, roomWatermark: { lt: input.cursor.before } }
          : { roomId: input.roomId, roomWatermark: { gt: input.cursor.after } }
        : { roomId: input.roomId };

      const messages = await ctx.db.message.findMany({
        where,
        orderBy: { roomWatermark: "desc" },
        take: MESSAGE_PAGE_LIMIT,
        include: { author: { select: { id: true, username: true } } },
      });

      // Return in ascending order so client can append naturally.
      return messages.reverse();
    }),

  // --- Full-snapshot queries (small-set, no cursor) ---
  myRooms: protectedProcedure.query(({ ctx }) =>
    ctx.chat.listRoomsForUser(ctx.session.userId),
  ),

  presenceForContacts: protectedProcedure.query(({ ctx }) =>
    ctx.chat.presenceForContactsOf(ctx.session.userId),
  ),

  // --- The subscription: receives heterogeneous inbox events ---
  // Authz: viewer may only subscribe to their own inbox. tRPC subscription
  // input is viewer-supplied, but the channel key is viewer-derived —
  // there is no "subscribe to somebody else's inbox" surface.
  onInboxEvent: protectedProcedure.subscription(async function* ({
    ctx,
    signal,
  }) {
    const channel = ctx.channels.channel<ChatEvent>(
      userInboxChannelKey(ctx.session.userId),
    );
    yield* subscribeToInbox(channel, ctx.session.userId, signal);
  }),
});
```

`subscribeToInbox` mirrors the template's `subscribeToListEvents` generator
(handles AbortSignal + unsubscribe cleanup + authz-cascade auto-close on
`session-invalidated` for the current viewer).

### 4. Client hook — WS subscription + reconnect glue (`use-inbox-live-updates.ts`)

This is the heart of the Live+Snapshot glue.

```ts
// Subscribes to the user's inbox channel. Leader tab owns the WS,
// BroadcastChannels relay to peer tabs (template pattern, verbatim).
//
// Pattern: ADR-001.
// - onStarted fires on initial connect AND every reconnect. Invalidates
//   live-backed query keys; TanStack Query refetches each with its
//   current input args. This is what closes reconnect gaps.
// - onData dispatches each event to its kind-specific handler, which
//   either patches the cache (payload-shape) or invalidates (notification).

import type {
  ChatEvent,
  ChatEventKind,
} from "@project/api/domains/chat/chat-events";
import { CHAT_EVENT_KINDS } from "@project/api/domains/chat/chat-events";
import type { AppRouter } from "@project/api/router";
import { useQueryClient } from "@tanstack/react-query";
import type { TRPCOptionsProxy } from "@trpc/tanstack-react-query";
import { useSubscription } from "@trpc/tanstack-react-query";
import { useEffect } from "react";
import { eventHandlers } from "./event-handlers";
// In this template, use-leader-tab lives alongside its first consumer:
// apps/web/src/features/todo-list/use-leader-tab.ts. A second consumer
// (user-inbox) justifies promoting it to apps/web/src/features/user/ or
// apps/web/src/shared/ — path shown here is illustrative.
import { useLeaderTab } from "../todo-list/use-leader-tab";

export function useInboxLiveUpdates(
  trpc: TRPCOptionsProxy<AppRouter>,
  userId: string | null,
  currentRoomId: string | null,
) {
  const qc = useQueryClient();
  const { isLeader, broadcast, onMessage } = useLeaderTab(userId);

  // Leader path: owns the WS; relays to peer tabs.
  useSubscription(
    trpc.chat.onInboxEvent.subscriptionOptions(undefined, {
      enabled: isLeader && userId !== null,

      // Live-backed query keys. This is the "explicit list" discussed
      // in ADR-001 §D3 reconnect glue. Fires on initial connect AND
      // every reconnect. The cursor on `messagesForRoom` is carried by
      // the currently-active query's input args; TanStack Query refetches
      // with those args, so the server returns the delta.
      onStarted: () => {
        qc.invalidateQueries(trpc.chat.myRooms.queryFilter());
        qc.invalidateQueries(trpc.chat.presenceForContacts.queryFilter());
        if (currentRoomId) {
          qc.invalidateQueries(
            trpc.chat.messagesForRoom.queryFilter({ roomId: currentRoomId }),
          );
        }
        // Other live-backed query keys follow the same pattern as they
        // are added (rooms.publicCatalog, contacts.list, sessions.list, ...).
      },

      onData: (data) => {
        // tRPC serializes Date → string; discriminator `kind` is intact.
        const event = data as unknown as ChatEvent;
        broadcast({ __relay: true, event });
        dispatch(trpc, qc, event);
      },
    }),
  );

  // Peer path: receives events relayed from the leader tab.
  useEffect(() => {
    return onMessage((d) => {
      if (isChatRelay(d)) dispatch(trpc, qc, d.event);
    });
  }, [trpc, qc, onMessage]);
}

function dispatch(
  trpc: TRPCOptionsProxy<AppRouter>,
  qc: ReturnType<typeof useQueryClient>,
  event: ChatEvent,
) {
  eventHandlers[event.kind](trpc, qc, event as never);
}

function isChatRelay(d: unknown): d is { __relay: true; event: ChatEvent } {
  if (!d || typeof d !== "object") return false;
  const rec = d as Record<string, unknown>;
  if (rec.__relay !== true) return false;
  const ev = rec.event as { kind?: unknown } | undefined;
  if (!ev || typeof ev.kind !== "string") return false;
  return (CHAT_EVENT_KINDS as readonly string[]).includes(
    ev.kind as ChatEventKind,
  );
}
```

### 5. Event handlers — payload vs notification + gap detection (`event-handlers.ts`)

Every payload-shape handler for an ordered event includes the **gap-detection
branch**: if the incoming watermark is not `lastSeen + 1`, invalidate the
query instead of patching, so the refetch closes the gap.

```ts
import type {
  ChatEvent,
  ChatEventKind,
} from "@project/api/domains/chat/chat-events";
import type { AppRouter } from "@project/api/router";
import type { QueryClient } from "@tanstack/react-query";
import type { TRPCOptionsProxy } from "@trpc/tanstack-react-query";
import type { MessageWithAuthor } from "./types";

type Handler<K extends ChatEventKind> = (
  trpc: TRPCOptionsProxy<AppRouter>,
  qc: QueryClient,
  event: Extract<ChatEvent, { kind: K }>,
) => void;

export const eventHandlers: { [K in ChatEventKind]: Handler<K> } = {
  // --- Payload-shape, ordered: gap-check then patch ---
  "room-message-created": (trpc, qc, ev) => {
    const key = trpc.chat.messagesForRoom.queryFilter({
      roomId: ev.roomId,
    }).queryKey;
    const cache = qc.getQueryData<MessageWithAuthor[]>(key);
    if (!cache) return; // No active view of this room — sidebar bump is emitted as `room-unread-bumped` separately.

    const lastSeen = cache.at(-1)?.roomWatermark ?? 0;
    if (ev.watermark === lastSeen + 1) {
      // In-order: patch.
      qc.setQueryData<MessageWithAuthor[]>(key, [...cache, ev.message]);
    } else if (ev.watermark > lastSeen + 1) {
      // Gap detected: refetch with cursor = lastSeen so server returns delta.
      // The missing messages (including this one) land via the refetch.
      qc.invalidateQueries({ queryKey: key });
    }
    // ev.watermark <= lastSeen is a stale/duplicate event — ignore.
  },

  "room-message-edited": (trpc, qc, ev) => {
    // Edits don't advance the room watermark (they're reversions of the
    // same message), so no gap-check. Patch the matching message.
    const key = trpc.chat.messagesForRoom.queryFilter({
      roomId: ev.roomId,
    }).queryKey;
    qc.setQueryData<MessageWithAuthor[]>(key, (old) =>
      old?.map((m) => (m.id === ev.message.id ? ev.message : m)),
    );
  },

  "room-message-deleted": (trpc, qc, ev) => {
    const key = trpc.chat.messagesForRoom.queryFilter({
      roomId: ev.roomId,
    }).queryKey;
    qc.setQueryData<MessageWithAuthor[]>(key, (old) =>
      old?.filter((m) => m.id !== ev.messageId),
    );
  },

  // --- Notification-shape: invalidate, let query refetch authoritative state ---
  "room-membership-changed": (trpc, qc, ev) => {
    qc.invalidateQueries(trpc.chat.myRooms.queryFilter());
    qc.invalidateQueries(
      trpc.chat.messagesForRoom.queryFilter({ roomId: ev.roomId }),
    );
  },

  "room-member-banned": (trpc, qc, ev) => {
    qc.invalidateQueries(trpc.chat.myRooms.queryFilter());
    qc.invalidateQueries(
      trpc.chat.messagesForRoom.queryFilter({ roomId: ev.roomId }),
    );
  },

  "room-deleted": (trpc, qc, ev) => {
    qc.invalidateQueries(trpc.chat.myRooms.queryFilter());
    qc.removeQueries(
      trpc.chat.messagesForRoom.queryFilter({ roomId: ev.roomId }),
    );
  },

  "session-invalidated": (_trpc, qc) => {
    // Nuke all auth-gated data; router guard will redirect to sign-in.
    qc.clear();
  },

  // --- Payload-shape, unordered ---
  "presence-updated": (trpc, qc, ev) => {
    qc.setQueryData<Record<string, PresenceSnapshot>>(
      trpc.chat.presenceForContacts.queryFilter().queryKey,
      (old) =>
        old
          ? {
              ...old,
              [ev.userId]: {
                status: ev.status,
                lastActivityAt: ev.lastActivityAt,
              },
            }
          : old,
    );
  },

  "room-unread-bumped": (trpc, qc, ev) => {
    // The server-authoritative unread pointer is derived from room
    // watermark vs user's lastReadWatermark. Patch the sidebar row.
    qc.setQueryData<RoomSummary[]>(
      trpc.chat.myRooms.queryFilter().queryKey,
      (old) =>
        old?.map((r) =>
          r.id === ev.roomId ? { ...r, lastWatermark: ev.watermark } : r,
        ),
    );
  },

  "dm-message-created": (trpc, qc, ev) => {
    // Mirror of room-message-created but keyed by peerUserId for DM views.
    const key = trpc.chat.dmMessagesWithPeer.queryFilter({
      peerUserId: ev.peerUserId,
    }).queryKey;
    const cache = qc.getQueryData<MessageWithAuthor[]>(key);
    if (!cache) return;
    const lastSeen = cache.at(-1)?.dmWatermark ?? 0;
    if (ev.watermark === lastSeen + 1) {
      qc.setQueryData<MessageWithAuthor[]>(key, [...cache, ev.message]);
    } else if (ev.watermark > lastSeen + 1) {
      qc.invalidateQueries({ queryKey: key });
    }
  },
};

type PresenceSnapshot = { status: "online" | "afk" | "offline"; lastActivityAt: string };
type RoomSummary = { id: string; name: string; lastWatermark: number };
```

### 6. Cursor-aware message hook (`use-messages.ts`)

The hook that drives the main chat view. Initial load uses no cursor
(latest page). Scrollback uses `before`. **Reconnect refetch uses the
SAME hook — the cursor is whatever the current pagination state says.**

```ts
import type { AppRouter } from "@project/api/router";
import { useQuery } from "@tanstack/react-query";
import type { TRPCOptionsProxy } from "@trpc/tanstack-react-query";

// Initial-page load. On reconnect, the `onStarted` hook in
// use-inbox-live-updates.ts invalidates THIS query key, which causes
// TanStack Query to re-run this query with its stored input — the
// cursor is whatever state the hook last observed.
export function useLatestMessages(
  trpc: TRPCOptionsProxy<AppRouter>,
  roomId: string,
) {
  return useQuery(
    trpc.chat.messagesForRoom.queryOptions({ roomId, cursor: undefined }),
  );
}

// Scrollback. Triggered by intersection observer at the top of the
// scroll viewport.
export function useMessagesBefore(
  trpc: TRPCOptionsProxy<AppRouter>,
  roomId: string,
  before: number,
) {
  return useQuery(
    trpc.chat.messagesForRoom.queryOptions({
      roomId,
      cursor: { before },
    }),
  );
}
```

### 7. How it all connects — the reconnect sequence

```
t=0    User online, viewing room X, sidebar visible with 20 rooms.
       Live subscription active. lastSeenWatermark for room X = 42.

t=5    Network blip. WS drops. tRPC client enters reconnect backoff.
       Meanwhile, on the server, 3 new messages land in room X
       (watermarks 43, 44, 45). Server tries to publish → user's WS
       is disconnected → publish is a no-op on that socket.

t=8    Network restored. tRPC WS reconnects.

       onStarted fires:
         qc.invalidateQueries(trpc.chat.myRooms.queryFilter());
         qc.invalidateQueries(trpc.chat.presenceForContacts.queryFilter());
         qc.invalidateQueries(
           trpc.chat.messagesForRoom.queryFilter({ roomId: "X" }),
         );

       TanStack Query refetches:
         messagesForRoom({ roomId: "X", cursor: { after: 42 } })

         ^ cursor value comes from the hook's current state — the last
           page rendered ended at watermark 42, so the refetch asks for
           `after: 42`. Server returns messages 43, 44, 45.

       Cache is patched with the 3 new messages. UI updates.

t=9    A new message arrives live in room X (watermark 46) via WS.
       onData → dispatch → handler checks: 46 === 45 + 1. In-order.
       Patch cache. lastSeenWatermark becomes 46.
```

### 8. Initial mount sequence — same pattern, cursor-free

```
User signs in, navigates to /rooms/X.
  - useLatestMessages(roomId="X") fires with cursor: undefined.
    → server returns latest 50 messages, watermarks [... 38..42].
  - useInboxLiveUpdates mounts. Subscription opens. onStarted fires,
    invalidates queries that just ran — they refetch once (idempotent,
    cheap), converge, then stabilize.

Live events arrive via WS from this point on.
```

### 9. Gap-detection sequence

```
Current cache for room X: watermarks [40, 41, 42]. lastSeen = 42.

Network blip eats event at watermark 43. Event at watermark 44 arrives live.

onData:
  ev.watermark = 44. lastSeen = 42. 44 !== 42 + 1.
  → qc.invalidateQueries(messagesForRoom({ roomId: "X" })).

TanStack Query refetches with cursor: { after: 42 }.
Server returns [43, 44]. Cache patched to [40, 41, 42, 43, 44].
lastSeen is now 44. Next event (watermark 45) lands in-order.
```

---

## Consequences

### Positive

- **Single logical subscription per user.** Lifecycle simpler to reason
  about; reconnect is one event, not N.
- **Authz is atomic at publish.** No subscription-cancel dance on ban; no
  race where a banned user receives a message mid-ban.
- **Gap recovery is self-healing.** Arbitrarily long disconnects recover
  via the same cursor-aware queries used for scrollback. No event log,
  no retention policy.
- **Reuse of template primitives.** Channel abstraction, event SSOT,
  leader-tab, payload-vs-notification dispatch — all template-canonical.
  The novel glue is ~50 LOC in `use-inbox-live-updates.ts` and the
  watermark branches in event handlers.
- **Reference-ready.** This pattern generalizes to any high-event-rate
  domain with a persistent cross-feature UI surface. Suitable for
  upstreaming as a second reference domain alongside todo-list.

### Negative

- **Fan-out cost at publish.** For a room message with 1000 members, the
  server does 1000 `channel.publish()` calls (vs. 1 for a per-entity
  channel). At spec scale this is <1,500 publishes/sec cluster-wide —
  trivial on Redis.
- **Payload reaches inactive viewers.** Every room member receives every
  room message even if they're not viewing that room. Keeps caches warm
  for instant room-switch; wasteful at 10K+ users in many rooms (not
  our regime — the spec caps at 300 concurrent users).
- **Cache can accumulate stale entries.** If a user drifts through many
  rooms, per-room message caches hold. Mitigated by TanStack Query's
  `gcTime` defaults; aggressive pruning could be added if memory becomes
  an issue.
- **Handler authoring discipline required.** Every payload-shape handler
  for an ordered event MUST include the gap-detection branch. This is a
  footgun — easy to forget on the first handler for a new ordered kind.
  Mitigation: a linter rule or a helper `patchOrderedCache(...)` that
  encapsulates the gap-check; defer to a follow-up ADR if needed.

### Risks

- **Watermark skew if the room counter is restored from backup.** The
  atomic `UPDATE ... RETURNING` relies on `Room.nextWatermark` being
  strictly monotonic. A backup restore that rolls back `nextWatermark`
  while preserving message watermarks could reassign a collided value.
  Unlikely in our timeframe; flag for production hardening.
- **Session-invalidated event racing reconnect.** If a session is
  invalidated while the WS is disconnected, the user's next request
  hits auth gates normally. No special handling needed, but document
  that session events carry no durability guarantee during a
  disconnect window — auth gates are authoritative.

---

## Rollout

This ADR is realized in `packages/api/src/domains/user/` (user-inbox channel, this repo) and `packages/api/src/domains/todo-list/` (per-entity channel, retained for focused single-entity collab with static authz).

---

## References

- Template primitives: `packages/realtime/src/channel.ts`,
  `packages/api/src/domains/todo-list/events.ts`,
  `apps/web/src/features/todo-list/use-todo-list-live-updates.ts`,
  `apps/web/src/features/todo-list/event-handlers.ts`.
- Template conventions: `docs/conventions.md` (event naming, shape
  discipline, SSOT tuple rule).
