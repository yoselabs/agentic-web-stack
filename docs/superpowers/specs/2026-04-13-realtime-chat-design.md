# Real-Time Chat Room — Design Spec

> **Superseded by** `docs/superpowers/specs/2026-04-18-realtime-chat-reference-design.md`.
> The 2026-04-18 spec expands scope (DMs, file sharing, unique usernames, user
> search, single-instance realtime abstraction inside `packages/api/`) and
> aligns with the updated domain conventions (`packages/api/src/domains/`,
> subpath exports, `apiClient`). This file is retained for historical context
> only; do not implement from it.

## Summary

Add WebSocket-based real-time chat as a reference implementation for the template. Includes a typed channel abstraction (`packages/realtime/`), tRPC subscriptions over WebSocket, and a chat room feature with messages, presence, and typing indicators.

This is a **reference feature for AI agents** — it demonstrates the full real-time wiring through every layer of the stack. Ships on a dedicated `/chat` route behind a feature flag so it can be studied but not exposed in production.

## Architecture Overview

```
Client (splitLink)
  ├─ HTTP: queries + mutations ──→ Hono ──→ tRPC httpBatchLink
  └─ WS:   subscriptions ────────→ WSS ──→ tRPC wsLink
                                     ↕
                              packages/realtime
                              (defineChannel abstraction)
                                     ↕
                              packages/db (Prisma)
```

- **tRPC stays the single API layer.** Subscriptions run over WebSocket, queries/mutations over HTTP. `splitLink` on the client routes by operation type.
- **`packages/realtime/`** is a standalone package providing a typed, room-scoped event bus with automatic presence. It has no dependency on tRPC — it's consumed by tRPC subscription procedures but could be used independently.
- **Single HTTP server, shared.** The WebSocket server attaches to the same `http.Server` that Hono uses. No extra port.

## `packages/realtime/` — Channel Abstraction

### Public API

```typescript
import { defineChannel } from "@project/realtime";
import { z } from "zod";

const chatRoom = defineChannel("chat", {
  events: {
    message: z.object({
      id: z.string(),
      userId: z.string(),
      text: z.string(),
      createdAt: z.date(),
    }),
    typing: z.object({
      userId: z.string(),
      isTyping: z.boolean(),
    }),
  },
  presence: z.object({
    userId: z.string(),
    name: z.string(),
  }),
});

// Subscribe to a room — returns AsyncIterable of typed events
// Automatically tracks presence (adds on subscribe, removes on cleanup)
const events = chatRoom.subscribe(roomId, { userId, name });

// Emit a typed event to all subscribers in a room
chatRoom.emit(roomId, "message", { id, userId, text, createdAt });

// Query current presence for a room
chatRoom.getPresence(roomId); // → Array<{ userId, name }>
```

### Event Union Type

Subscribers receive a discriminated union:

```typescript
type ChatChannelEvent =
  | { type: "message"; data: { id: string; userId: string; text: string; createdAt: Date } }
  | { type: "typing"; data: { userId: string; isTyping: boolean } }
  | { type: "presence"; data: { members: Array<{ userId: string; name: string }> } };
```

Client-side handling is a clean `switch` on `event.type`.

### Internals

- **Event distribution:** `EventEmitter` keyed by `${channelName}:${roomId}`.
- **Presence store:** `Map<roomId, Map<subscriberId, presenceData>>`. On subscribe: add entry, emit `presence` event with full member list. On cleanup: remove entry, emit updated list.
- **`subscribe()` returns an `AsyncIterable`** bridged from the EventEmitter via an async generator. Uses `AbortSignal` or `finally` block to ensure presence cleanup runs when the iterator is terminated (client disconnect, explicit unsubscribe).
- **Typing throttle:** Server-side per-user throttle — ignore typing events if the last one was <500ms ago. Prevents flood from misbehaving clients.

### Scaling Note

This is a **single-process, in-memory** event bus. It works for single-server deployments (the template default). For horizontal scaling, swap the EventEmitter for a PostgreSQL `LISTEN/NOTIFY` adapter or Redis pub/sub — the `defineChannel` API stays the same, only the transport changes. This should be documented in the package README as the upgrade path.

## Server Wiring

### WebSocket Server Setup (`apps/server/src/index.ts`)

The current code discards the return value of `serve()`. Change to capture the HTTP server:

```typescript
import { serve } from "@hono/node-server";
import { WebSocketServer } from "ws";
import { applyWSSHandler } from "@trpc/server/adapters/ws";

// Capture the HTTP server instance (currently discarded)
const server = serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 3001) }, (info) => {
  logger.info(`Server running at http://localhost:${info.port}`);
});

// Attach WebSocket server to the same HTTP server
const wss = new WebSocketServer({ noServer: true });
applyWSSHandler({ wss, router: appRouter, createContext: createWsContext });

server.on("upgrade", async (req, socket, head) => {
  // Extract Better-Auth session from cookies (same auth as HTTP)
  const session = await auth.api.getSession({
    headers: new Headers(req.headers as Record<string, string>),
  });
  // Attach to request for createContext
  (req as any).session = session;
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
});
```

**Important:** Verify tRPC v11's exact WS adapter exports during implementation. The `@trpc/server/adapters/ws` module exists in v11 but the API surface may differ from v10. Check `node_modules/@trpc/server/adapters/ws/` for the actual exports before writing code.

### Context Creation — Dual Path

The current `createContext` in `packages/api/src/context.ts` accepts `{ session }`. The WS upgrade handler extracts the session from cookies and passes it in the same shape. No changes to `createContext` itself — the adaptation happens in the server wiring:

```typescript
// HTTP path (existing): Hono middleware extracts session, passes to createContext
// WS path (new): upgrade handler extracts session, attaches to req, createContext reads it

function createWsContext({ req }: { req: IncomingMessage }): Context {
  return createContext({ session: (req as any).session });
}
```

### CORS / CSP

The WS `upgrade` event is handled at the raw HTTP server level, **before Hono middleware runs**. CORS headers and CSP do not apply to WebSocket upgrades. However:

- The `connect-src` CSP directive in `__root.tsx` may need `ws://localhost:3001` added for development (browsers enforce CSP on WebSocket connections).
- In production with TLS, use `wss://` matching the API domain.

### New Dependencies

| Package | Where | Purpose |
|---------|-------|---------|
| `ws` | `apps/server` | WebSocket server |
| `@types/ws` | `apps/server` (devDep) | TypeScript types |

The client-side `wsLink` is already included in `@trpc/client` — no new client dependency.

## Client Wiring (`apps/web/src/router.tsx`)

### Split Link

```typescript
import { splitLink, httpBatchLink, wsLink } from "@trpc/client";

const wsUrl = (import.meta.env.VITE_API_URL ?? "http://localhost:3001")
  .replace(/^http/, "ws") + "/trpc";

const trpcClient = createTRPCClient<AppRouter>({
  links: [
    splitLink({
      condition: (op) => op.type === "subscription",
      true: wsLink({ url: wsUrl }),
      false: httpBatchLink({
        url: `${import.meta.env.VITE_API_URL ?? "http://localhost:3001"}/trpc`,
        fetch(url, options) {
          return fetch(url, { ...options, credentials: "include" });
        },
      }),
    }),
  ],
});
```

The WS URL is derived from `VITE_API_URL` by replacing `http` with `ws`. No new env var needed.

### Reconnection Strategy

tRPC's `wsLink` handles reconnection automatically (exponential backoff). On reconnect:

1. Active subscriptions re-subscribe — the server sees a new `onRoomEvents` call, which re-adds the client to the channel and re-emits presence.
2. The `use-chat` hook detects reconnection and re-fetches `recentMessages` to fill any gap during disconnect.

## Data Model

### `packages/db/prisma/schema/chat.prisma`

```prisma
model ChatRoom {
  id        String        @id @default(cuid())
  name      String
  messages  ChatMessage[]
  createdAt DateTime      @default(now())
}

model ChatMessage {
  id        String   @id @default(cuid())
  text      String
  roomId    String
  room      ChatRoom @relation(fields: [roomId], references: [id])
  userId    String
  user      User     @relation(fields: [userId], references: [id])
  createdAt DateTime @default(now())

  @@index([roomId, createdAt])
}
```

Add `todos` → `chatMessages` relation to `User` in `auth.prisma`:

```prisma
model User {
  // ... existing fields
  chatMessages ChatMessage[]
}
```

### Seeding

Add to the existing `scripts/seed.ts`: create one "General" `ChatRoom` so the chat page works immediately after `make setup`.

## tRPC Procedures

### `packages/api/src/routers/chat.ts`

| Procedure | Type | Input | What it does |
|-----------|------|-------|-------------|
| `chat.listRooms` | query | — | List available rooms |
| `chat.recentMessages` | query | `{ roomId, limit? }` | Last 50 messages for a room, with user info |
| `chat.sendMessage` | mutation | `{ roomId, text }` | Save to DB → emit `message` to channel |
| `chat.onRoomEvents` | subscription | `{ roomId }` | Subscribe to channel → yields message, typing, presence events |

### Typing — Over WS, Not HTTP

Typing indicators are **ephemeral signals** that should not go through HTTP mutations. Instead, typing is sent through the subscription's WS connection:

**Option: Client-to-server typing via a separate subscription input or a lightweight `setTyping` subscription procedure.**

The recommended approach: add a `chat.setTyping` procedure as a **mutation that routes over WS** by adjusting the `splitLink` condition to also route `chat.setTyping` mutations over WS. This keeps the tRPC type safety while avoiding HTTP round-trips for ephemeral signals:

```typescript
splitLink({
  condition: (op) =>
    op.type === "subscription" ||
    (op.type === "mutation" && op.path === "chat.setTyping"),
  true: wsLink({ url: wsUrl }),
  false: httpBatchLink({ ... }),
}),
```

| Procedure | Type | Input | What it does |
|-----------|------|-------|-------------|
| `chat.setTyping` | mutation | `{ roomId, isTyping }` | Emit typing event via channel (no persistence) |

### Service Layer (`packages/api/src/services/chat.ts`)

- `listRooms(db)` — `db.chatRoom.findMany()`
- `getRecentMessages(db, roomId, limit = 50)` — last N messages ordered by `createdAt ASC`, include `user` relation
- `createMessage(tx, roomId, userId, text)` — insert + return with user relation

No service functions for typing or presence — those are ephemeral, handled by the channel abstraction.

### Flow: Sending a Message

```
Client calls chat.sendMessage({ roomId, text })
  → protectedProcedure validates auth
  → db.$transaction → createMessage(tx, roomId, userId, text)
  → chatRoom.emit(roomId, "message", { id, userId, text, createdAt })
  → all subscribers in that room receive it via onRoomEvents
```

## Frontend

### Route: `apps/web/src/routes/_authenticated/chat.tsx`

**Feature flag:** Gated behind `VITE_FEATURE_CHAT=true` env var. When disabled, the route redirects to dashboard. The nav link is conditionally rendered. Default: disabled.

### Layout

- **Left sidebar:** Room list (just "General" initially, structure supports multiple)
- **Main area:** Message feed + typing indicator + input

### Message Feed

- Messages ordered oldest-to-top, newest-at-bottom
- **Auto-scroll:** If user is at the bottom, scroll to new messages. If user has scrolled up to read history, don't auto-scroll — show a "↓ New messages" button instead
- Load recent messages via `chat.recentMessages` on mount, scroll to bottom

### Message Rendering

- User name + avatar initial on the left
- Message text
- **Timestamp:** Relative for recent ("2m ago"), absolute for older ("Apr 13, 14:32")
- Own messages visually distinct (different background or alignment)

### Typing Indicator

- Below the message feed, above the input: "Alice is typing..." with subtle animation
- Multiple typers: "Alice and Bob are typing..."
- **Client-side debounce:** Emit `setTyping(true)` on keypress, `setTyping(false)` after 2s of no input
- **Server-side throttle:** Ignore typing events if last one from same user was <500ms ago

### Presence

- Header or sidebar shows online members with green dot
- Join/leave shown as subtle system messages in the feed ("Alice joined")

### Input

- Text input + send button
- Enter to send, Shift+Enter for newline
- Disabled state when WS is disconnected (detect via subscription status)

### Hook: `apps/web/src/features/chat/use-chat.ts`

Orchestration hook that wires:

- `trpc.chat.recentMessages.useQuery({ roomId })` — initial message load
- `trpc.chat.onRoomEvents.useSubscription({ roomId })` — live events
- `trpc.chat.sendMessage.useMutation()` — sending messages
- `trpc.chat.setTyping.useMutation()` — typing signals
- Local state that merges subscription events into the message list
- Reconnection handler: re-fetch `recentMessages` when subscription reconnects

## Testing Strategy

### Unit Tests (Vitest)

- `packages/realtime/`: Test `defineChannel` — subscribe, emit, presence tracking, cleanup on unsubscribe, typing throttle
- `packages/api/src/services/chat.ts`: Test `createMessage`, `getRecentMessages`, `listRooms` against test DB

### Router Integration Tests (Vitest)

- `packages/api/src/__tests__/chat.test.ts`: Test chat procedures via `appRouter.createCaller()`. Subscription tests will need a WS client or direct channel verification.

### E2E Tests (Playwright-BDD)

- Gherkin scenarios for: send message → appears in feed, presence updates on join/leave, typing indicator shows/hides
- These are written AFTER the UI exists, per the project's BDD-first workflow (Gherkin spec first, step defs after UI)

## File Structure

```
packages/realtime/
  src/
    index.ts              — exports defineChannel
    channel.ts            — defineChannel implementation
    types.ts              — ChannelConfig, ChannelEvent, etc.
  package.json            — @project/realtime
  tsconfig.json

packages/api/src/
  routers/chat.ts         — chat procedures (query, mutation, subscription)
  services/chat.ts        — chat business logic

packages/db/prisma/schema/
  chat.prisma             — ChatRoom + ChatMessage models

apps/server/src/
  index.ts                — (modified) capture server, attach WSS, upgrade handler
  ws-context.ts           — createWsContext adapter

apps/web/src/
  routes/_authenticated/
    chat.tsx              — chat page route
  features/chat/
    use-chat.ts           — orchestration hook
    message-feed.tsx      — message list with auto-scroll
    message-item.tsx      — single message rendering
    typing-indicator.tsx  — "X is typing..." display
    chat-input.tsx        — text input with send
    presence-list.tsx     — online members
```

## Open Questions for Implementation

1. **tRPC v11 WS adapter API:** Verify exact exports from `@trpc/server/adapters/ws` before writing server code. The API may differ from v10 docs.
2. **wsLink cookie forwarding:** Verify that `wsLink` sends cookies on the WS handshake for Better-Auth session extraction. May need custom headers config.
3. **SSR considerations:** The WS connection should only initialize on the client, not during SSR. The `splitLink` setup may need a `typeof window !== "undefined"` guard for the wsLink.
