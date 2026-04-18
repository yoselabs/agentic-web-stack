# Real-Time Chat — Reference Implementation Design

## Summary

A full real-time chat module for the template — groups + DMs, presence, typing
indicators, file sharing, live updates — built as a **reference implementation
and pattern library for AI agents**. The module ships disabled behind a feature
flag and exists to document how the stack wires WebSocket subscriptions,
typed channels, in-process pub/sub, and React Query cache merging.

The design introduces a small reusable primitive (`packages/api/src/realtime/`),
augments the Better-Auth `User` with a unique `username`, and adds a
`chat` domain following the established domain conventions.

## Reference vs. Hackathon Module

**This module is not a shippable feature.** It is:

- A template asset: complete, linted, tested — so agents can study working code.
- A pattern library: each subsystem (room channel, user channel, presence, file
  flow, reconnect/gap-fill, cache merge) is isolated enough to be cited by an
  agent skill independently.
- Disabled by default: `ENABLE_CHAT=false` on the server gates WS upgrade +
  tRPC chat router + file endpoints; `VITE_ENABLE_CHAT=false` gates routes
  and UI.

**Intended usage at the hackathon:** leave this module disabled. Scaffold a new
chat domain fresh (empty domain folder, no copy-paste) and drive the
implementation through the agent skill in `docs/skills/add-realtime.md`, which
points at this reference for patterns. Judges see a disabled reference + a
freshly written module — no "turned on a pre-built chat" risk.

## Architecture Overview

```
Client
 ├─ HTTP  : queries, mutations, file upload/download ──┐
 └─ WS    : subscriptions (typed channels)             │
                                                       ▼
                               apps/server (Hono + @hono/node-server)
                                     ├─ /api/auth/**                 (Better-Auth)
                                     ├─ /trpc/*                      (tRPC HTTP)
                                     ├─ /files, /files/:id           (Hono direct)
                                     └─ ws://host/trpc-ws            (tRPC WS adapter
                                                                      on the same
                                                                      http.Server)
                                                       ▼
                               packages/api
                                 ├─ domains/chat/    (router + service + tests)
                                 ├─ domains/user/    (search only — not chat-specific)
                                 └─ realtime/        (channel abstraction, in-process)
                                                       ▼
                               packages/db (Prisma) — ChatRoom, ChatMembership,
                                                      ChatMessage, ChatFile
```

**Single-instance architecture.** No Redis, no Postgres LISTEN/NOTIFY, no
external pub/sub. The `realtime` module is an in-process event bus. If scale
beyond one Node process is ever needed, the swap happens inside `realtime`
— no change to consuming code. Explicitly out of scope for this spec.

## Data Model

New Prisma file: `packages/db/prisma/schema/chat.prisma`.

```prisma
model ChatRoom {
  id        String   @id @default(cuid())
  name      String?                         // null for DMs and unnamed groups
  dmKey     String?  @unique                // set only for DMs; see "DM race" below
  createdAt DateTime @default(now())

  memberships ChatMembership[]
  messages    ChatMessage[]
}

model ChatMembership {
  roomId     String
  userId     String
  joinedAt   DateTime  @default(now())
  lastReadAt DateTime?

  room ChatRoom @relation(fields: [roomId], references: [id], onDelete: Cascade)
  user User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@id([roomId, userId])
  @@index([userId])                        // "my rooms" query
}

enum ChatMessageKind {
  TEXT
  FILE
}

model ChatMessage {
  id        String          @id @default(cuid())
  roomId    String
  userId    String
  kind      ChatMessageKind
  text      String?                        // present when kind = TEXT
  fileId    String?                        // present when kind = FILE
  createdAt DateTime        @default(now())

  room ChatRoom  @relation(fields: [roomId], references: [id], onDelete: Cascade)
  user User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  file ChatFile? @relation(fields: [fileId], references: [id])

  @@index([roomId, createdAt, id])         // gap-fill cursor + history pagination
}

model ChatFile {
  id         String   @id @default(cuid())
  storedPath String                         // ./var/files/{id} — no extension on disk
  filename   String                         // original, for Content-Disposition
  mimeType   String
  size       Int
  uploadedBy String
  createdAt  DateTime @default(now())

  uploader User          @relation(fields: [uploadedBy], references: [id])
  messages ChatMessage[]
}
```

**`User` augmentation** (additive — Better-Auth owns this table):

```prisma
model User {
  // ... existing fields
  username String @unique
  // reverse relations
  chatMemberships ChatMembership[]
  chatMessages    ChatMessage[]
  chatFiles       ChatFile[]
}
```

`username` format: `^[a-z0-9_]{3,20}$`. Required at signup. Demo users in
`scripts/seed.ts` get generated usernames (e.g., `demo1`, `demo2`).

**DM identity** is a `ChatRoom` with `name = null` and exactly two memberships.
`dmFindOrCreate(otherUserId)` queries for such a room whose memberships are
`{currentUser, otherUser}`, returns it if found, else creates. No `kind`
discriminator on ChatRoom.

## Realtime Primitive — `packages/api/src/realtime/`

New subpath export: `@project/api/realtime` (no barrel; single subpath per
the root CLAUDE.md rule).

### Subpath exports

`packages/api/package.json` adds (one entry per file — no barrel):

- `"./realtime/channel"` → `./src/realtime/channel.ts` (defines `defineChannel`, channel-instance methods)
- `"./realtime/presence"` → `./src/realtime/presence.ts` (optional reusable presence helper; may also live inside `domains/chat/` if only chat uses it — see "Presence ownership" below)

### Public API

```typescript
import { defineChannel } from "@project/api/realtime/channel";
import { z } from "zod";

// A channel is a typed pub/sub group. Name is a string template.
// Events are declared up front with Zod schemas.
const roomChannel = defineChannel({
  name: (roomId: string) => `chat:room:${roomId}`,
  events: {
    "message:new":    z.object({ id: z.string(), roomId: z.string(), userId: z.string(), kind: z.enum(["TEXT", "FILE"]), text: z.string().nullable(), fileId: z.string().nullable(), createdAt: z.date() }),
    "typing:start":   z.object({ roomId: z.string(), userId: z.string() }),
    "typing:stop":    z.object({ roomId: z.string(), userId: z.string() }),
    "presence:enter": z.object({ roomId: z.string(), userId: z.string() }),
    "presence:leave": z.object({ roomId: z.string(), userId: z.string() }),
  },
});

// Server side: publish an event.
roomChannel.publish(roomId, "message:new", { ... });

// Server side: subscribe (used inside tRPC subscription procedures).
for await (const event of roomChannel.subscribe(roomId, signal)) {
  yield event;
}

// Server side: check whether this process has any local subscriber for a
// channel instance. Used by chat's nudge-fanout (see "Fanout pattern").
// Typed on the channel instance — not a free function over channel names —
// so it composes with the declared API and is easy to stub for a future
// Redis swap.
roomChannel.hasSubscribers(roomId); // boolean, single-instance only
```

### Implementation notes

- Backed by Node's `EventEmitter`. Channel name is the event key. Subscribers
  get a named `AsyncIterable<Event>` keyed by the channel name.
- `subscribe()` accepts `AbortSignal` for cleanup on client disconnect.
- Zod schemas run at publish time in dev only (validates developer intent);
  production skips for throughput.
- Zero state persistence — this module only fans out events to currently
  connected subscribers. Durable state lives in Postgres.
- `hasSubscribers(roomId)` returns `listenerCount(channelName) > 0` — local
  to this process. **Single-instance only.** When Redis is swapped in,
  `hasSubscribers` becomes local-only too (for nudge fanout a missed nudge
  is a harmless UI miss; cluster-wide presence would use a separate
  mechanism). This is an acceptable degradation, not a bug to fix later.

### Presence ownership

Presence *state* (who is in which room) lives inside `domains/chat/` — not
in `realtime/`. `realtime/` is transport only: it fans out events. The
chat domain owns a per-room `Map<roomId, Set<userId>>` that is mutated on
`subscribeRoom` enter/leave and queried by `chat.presence.list`. This
keeps the realtime primitive small and prevents domain logic (3s debounce,
membership checks) from leaking into infrastructure.

If a second domain later needs presence, factor a small `presence.ts`
helper out of chat — don't pre-factor.

### Two well-known channels for chat

- `chat:room:{roomId}` — events scoped to an open room: messages, typing,
  presence.
- `user:{userId}` — a user's personal cross-room inbox: `room:invited`,
  `unread:nudge` (sent when a message arrives in a room the user is a member
  of but not currently subscribed to). No duplication of `message:new`.

## tRPC Chat Domain — `packages/api/src/domains/chat/`

Follows the established domain pattern (`service.ts` + `router.ts` +
`constants.ts` + `__tests__/`). Services take `Prisma.TransactionClient`
for writes and `DbClient` for reads; router wraps every mutation in
`ctx.db.$transaction`.

### Procedures

```
chat.rooms.listMine()                            → recent conversations + unread counts
chat.rooms.get({ roomId })                       → room detail + members
chat.rooms.createGroup({ name, memberIds })      → new group room
chat.rooms.dmFindOrCreate({ otherUserId })       → DM room
chat.rooms.invite({ roomId, userId })            → add member
chat.rooms.leave({ roomId })                     → remove self

chat.messages.list({ roomId, beforeCursor? })    → paginated history (DESC by createdAt,id)
chat.messages.sendText({ roomId, text })         → insert + publish message:new
chat.messages.sendFile({ roomId, fileId })       → insert + publish message:new
chat.messages.sinceCursor({ roomId, afterCursor }) → gap-fill on reconnect

chat.presence.list({ roomId })                   → current online user ids in room
chat.typing.start({ roomId })                    → publish typing:start
chat.typing.stop({ roomId })                     → publish typing:stop

chat.subscribeRoom({ roomId })                   → subscription, all room events
chat.subscribeUser()                             → subscription, user inbox events
```

**Authorization:**
- Every non-DM mutation checks `ChatMembership` membership via service-level
  `requireMembership(tx, userId, roomId)` that throws `TRPCError FORBIDDEN`
  if absent.
- **Subscriptions check membership too.** `chat.subscribeRoom({ roomId })`
  calls `requireMembership(ctx.db, userId, roomId)` before yielding. Without
  this, a client could subscribe to arbitrary room IDs and eavesdrop.
- `dmFindOrCreate` allows any authenticated user to DM any other user.
- `createGroup` with 0 members is rejected; creator is auto-added.
- `invite` requires caller to be a member.

**Cursor format:** `{ createdAt: ISO8601, id: cuid }`. Tuple comparison —
primary sort: `createdAt`; tiebreak: `id`.
- `messages.list({ roomId, beforeCursor? })` returns `(createdAt, id) <
  cursor` DESC (newest first). When `beforeCursor` is absent, returns the
  most recent N messages.
- `messages.sinceCursor({ roomId, afterCursor })` returns `(createdAt, id) >
  cursor` ASC (oldest first), used for gap-fill on reconnect.
- Server timestamps always win — clients never set `createdAt`.

**Fanout pattern on send:**
1. Insert `ChatMessage` inside the `$transaction`.
2. After `await tx.$transaction(...)` resolves (not inside it), publish
   `message:new` to `chat:room:{roomId}`.
3. Iterate the room's memberships; for each member who is **not** currently
   subscribed to that room channel, publish `unread:nudge` to their
   `user:{userId}` channel. The per-user subscription check uses
   `roomChannel.hasSubscribers(roomId)` combined with the chat domain's
   presence set to resolve "who among the members is actually subscribed."
   Concretely: `for (m of members) if (!presenceSet.get(roomId)?.has(m.userId))
   userChannel.publish(m.userId, "unread:nudge", ...)`.

**No additional presence leak from nudge fanout.** Presence (enter/leave) is
already broadcast to all members of a room via the room channel. The nudge
flow uses the same presence state the sender's browser already receives.
If nudges are missed because of a race between enter and publish, the
client falls back to periodic `chat.rooms.listMine()` polling (cheap, just
unread counts).

**Unread count** is derived from `lastReadAt` on `ChatMembership` and is
returned by `chat.rooms.listMine()`. Clients call `chat.messages.markRead({
roomId, lastSeenMessageId })` on room open / activity.

## WebSocket Server Attachment — `apps/server/src/index.ts`

The Hono app ships HTTP via `@hono/node-server`'s `serve(...)`. tRPC's WS
adapter is a separate package (`@trpc/server/adapters/ws`) and takes a `ws`
`WebSocketServer` instance — not a Hono/Fetch handler. The two coexist on
one `http.Server` by using `noServer: true` and routing upgrades by URL
pathname.

New dependencies on `apps/server`: `ws`, `@types/ws`.

```typescript
import { serve } from "@hono/node-server";
import { applyWSSHandler } from "@trpc/server/adapters/ws";
import { appRouter } from "@project/api/router";
import { createContext } from "@project/api/context";
import { auth } from "@project/auth";
import { env } from "@project/env/server";
import { WebSocketServer } from "ws";
import type { IncomingMessage } from "node:http";

const httpServer = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  logger.info(`Server running at http://localhost:${info.port}`);
});

if (env.ENABLE_CHAT) {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (req, socket, head) => {
    const { pathname } = new URL(req.url ?? "/", "http://localhost");
    // NOTE: "/trpc-ws" inlined by design — matches client wsLink URL.
    if (pathname !== "/trpc-ws") {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  applyWSSHandler({
    wss,
    router: appRouter,
    createContext: async ({ req }) => wsContext(req),
    // keepAlive helps detect half-closed connections behind proxies.
    keepAlive: { enabled: true, pingMs: 30_000, pongWaitMs: 5_000 },
  });
}

// IncomingMessage.headers is IncomingHttpHeaders (string | string[] | undefined).
// Better-Auth's getSession wants a Fetch Headers object. Coerce by flattening.
async function wsContext(req: IncomingMessage) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) headers.set(name, value.join(", "));
    else headers.set(name, value);
  }
  const session = await auth.api.getSession({ headers });
  if (!session) {
    // tRPC's adapter will bubble this as a subscription error; the client
    // detects via closeCode / error link and redirects to /login.
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return createContext({ session });
}
```

**Authentication failure close code.** tRPC's default handler closes with a
generic code on context error. To emit `4401` so the client can distinguish
"auth" from "generic disconnect," wrap the upgrade handler to inspect the
result of `wsContext(req)` before `handleUpgrade` accepts the socket — or,
simpler, let the context error bubble and rely on the client's existing
session polling (`useSession`) to redirect on 401 from the next HTTP
request. For prep, the simpler path is sufficient; the explicit `4401`
code is a polish item.

**Why not `@hono/trpc-server` for WS.** `@hono/trpc-server` is an HTTP
adapter only; it does not implement tRPC's subscription transport. Using
two adapters (HTTP via Hono, WS via `@trpc/server/adapters/ws`) is the
supported pattern with tRPC v11 and `ws` ^8.

## Non-tRPC Endpoints — `apps/server/src/index.ts`

Mirrors the existing todo import/export pattern. Auth via
`auth.api.getSession({ headers: c.req.raw.headers })`; unauthorized → 401.

### File upload

```
POST /files                    multipart/form-data, field name "file"
  → 201 { fileId, filename, size, mimeType }
```

- Max size 10 MB (constant `MAX_CHAT_FILE_BYTES` in
  `packages/api/src/domains/chat/constants.ts`).
- **No MIME whitelist.** The real XSS defense is forcing download with
  `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff`
  on the GET response (see below). A mime blocklist is theater; arbitrary
  `application/octet-stream` uploads bypass it.
- Client-declared `file.type` is stored in `ChatFile.mimeType` for display
  purposes only; never used to decide how the server treats the content.
- Disk write path: `./var/files/{id}` (no extension on disk, original
  filename held in `ChatFile.filename`). `./var/files/` is `.gitignore`d.
- Transaction: file row insert is a single statement; no lock needed.
- Failure modes: size limit → 413; disk write failure → 500 + no DB row;
  DB insert failure → attempt to unlink file, return 500.

### File download

```
GET /files/:id                 auth-gated
  → 200 file bytes + Content-Type + Content-Disposition
```

Authorization check: caller must be a member of some room that contains a
`ChatMessage` referencing this `fileId`. Query:

```typescript
const accessible = await db.chatMessage.findFirst({
  where: {
    fileId,
    room: { memberships: { some: { userId: session.user.id } } },
  },
});
if (!accessible) return c.json({ error: "Not found" }, 404);
```

Return 404 (not 403) to avoid leaking existence.

Response headers:
- `Content-Type: {file.mimeType}` (display-only; see below)
- `Content-Disposition: attachment; filename="{sanitizedFilename}"` —
  sanitization strips quotes, newlines, and backslashes; if empty after
  sanitization, falls back to `file.id`.
- `X-Content-Type-Options: nosniff` — prevents the browser from sniffing
  an attacker-declared `text/html` mime into a rendered page. Load-bearing
  given the "no MIME whitelist" decision above.
- Streamed from disk (`createReadStream`), not buffered in memory.

## User Domain — `packages/api/src/domains/user/`

Separate from chat because user search is generic and may be reused.

```
user.search({ query })           → [{ userId, username, name, image? }, ...]
```

- Matches `username` prefix (preferred) or `name` substring (case-insensitive).
- Returns up to 20 results, ordered: exact `username` match first, then
  `username` prefix, then `name` substring, alphabetical within each group.
- Never returns email.
- Minimum query length: 2 characters.

## Username on the User Model

### Schema

Adds `username String @unique` to `User` in `packages/db/prisma/schema/auth.prisma`.

**Migration handling for existing dev installs.** A developer with rows
already in `User` will fail `make db-push` on a non-null `username` with
no backfill. Two-phase approach:

1. **Initial push:** add `username String? @unique` (nullable). `make
   db-push` succeeds against an existing DB.
2. **Backfill:** `scripts/seed.ts` gains a pass that, for any user with
   `username = null`, generates `email.split("@")[0]` + a short random
   suffix, retrying on unique collision. Run via `make db-seed` (existing
   target).
3. **Tighten:** once all rows have a value, change schema to
   `username String @unique` (non-null). `make db-push` succeeds.

For greenfield installs (CI, fresh clones) step 2 is a no-op. For
hackathon prep where we control the dev DB, steps 1+3 can be collapsed —
drop the dev DB with `docker compose -f docker-compose.yml down -v &&
make setup` and go straight to non-null. The spec records both paths so
the implementation plan can pick.

### Better-Auth configuration

In `packages/auth/src/index.ts`, enable `additionalFields`:

```typescript
user: {
  additionalFields: {
    username: {
      type: "string",
      required: true,
      input: true,
      validator: {
        regex: /^[a-z0-9_]{3,20}$/,
      },
    },
  },
},
```

Uniqueness is enforced at the DB level via `@unique`; Better-Auth surfaces
the constraint violation as a sign-up error which the client shows inline.

**Client-side typing.** Better-Auth's `additionalFields` must also be
declared on the client's `createAuthClient` config (e.g., via the
`inferAdditionalFields` plugin) so `signUp.email({ email, password, name,
username })` type-checks. `apps/web/src/features/auth/auth-client.ts` needs
the plugin + the matching additional-fields block, otherwise the call in
`login.tsx` will produce a TS error on `username`.

### Signup form

`apps/web/src/routes/login.tsx` adds a `username` input alongside `name`.
Validation:
- Client-side: regex match, 3–20 chars, lowercase letters/digits/underscore.
- Async uniqueness check via a new tRPC query `user.isUsernameAvailable({
  username })` — debounced 300ms on input change; displays inline hint.
- Server-side: DB unique constraint is the final guard; race-condition signup
  errors show "Username already taken."

### Seed users

`scripts/seed.ts` currently creates demo users via Better-Auth signup. Extend
with deterministic usernames (`demo1`, `demo2`, ...). Any existing data in a
developer's local DB is wiped on `make db-push --force-reset` if the new
`@unique` constraint fails — acceptable for dev.

## Client Integration

### Router wiring

`apps/web/src/router.tsx` gains a `splitLink`:

```typescript
import { createTRPCClient, httpBatchLink, wsLink, splitLink, createWSClient } from "@trpc/client";

const wsClient = createWSClient({
  url: apiClient.baseUrl.replace(/^http/, "ws") + "/trpc-ws",
});

const trpcClient = createTRPCClient<AppRouter>({
  links: [
    splitLink({
      condition: (op) => op.type === "subscription",
      true:  wsLink({ client: wsClient }),
      false: httpBatchLink({ url: `${apiClient.baseUrl}/trpc`, fetch: apiClient.fetch }),
    }),
  ],
});
```

`wsClient` reconnects with exponential backoff (built in). On reconnect, the
app re-subscribes, then calls `chat.messages.sinceCursor` to fill the gap.

### `useLiveRoom(roomId)` hook

Located at `apps/web/src/features/chat/use-live-room.ts`. Composes
`useInfiniteQuery(chat.messages.list)` with `useSubscription(chat.subscribeRoom)`.
On every subscription event:
- `message:new` — prepend to the first page of the infinite query cache
  (messages are displayed newest-last; reverse as needed in the view).
  Dedupe by message id.
- `typing:start` — add `{userId, expiresAt: now + 5s}` to a local map.
  Visible rows auto-expire; a `setInterval(1000)` prunes stale entries.
- `typing:stop` — remove from the local map.
- `presence:enter` / `presence:leave` — update a local Set.

The hook returns: `{ messages, presence, typing, sendText, sendFile,
uploadFile, markRead, ... }`. Route component stays a thin shell per
`apps/web/CLAUDE.md` conventions.

### File upload flow

`apps/web/src/features/chat/upload-file.ts`:

```typescript
export async function uploadFile(file: File) {
  const form = new FormData();
  form.append("file", file);
  const res = await apiClient.fetch("/files", { method: "POST", body: form });
  if (!res.ok) throw new Error((await res.json()).error ?? "Upload failed");
  return res.json() as Promise<{ fileId: string; filename: string; size: number; mimeType: string }>;
}
```

Then `useLiveRoom.sendFile({ fileId })` finishes the two-step upload→send.

File downloads: `<a href="{apiClient.baseUrl}/files/{fileId}" download>`.
Browser sends cookie via `credentials: "include"` configured globally in
`apiClient.fetch`; for `<a>` tags the browser already includes same-origin
cookies, and cross-origin requires CORS which is already configured.

### Routes

- `src/routes/_authenticated/chat/index.tsx` — room list + user search entry
  point. Empty state when no rooms. Clicking a room navigates to
  `/chat/{roomId}`.
- `src/routes/_authenticated/chat/$roomId.tsx` — active room. Split pane on
  desktop: left = room list, right = active room + message composer + file
  attach button + typing indicator + presence badges.
- `src/features/chat/` — `use-live-room.ts`, `upload-file.ts`, components
  (`MessageList`, `MessageComposer`, `RoomListSidebar`, `UserSearchDialog`).

## UX Flows

**Start a DM:**
1. `/chat` → "New DM" → `UserSearchDialog` (input, debounced `user.search`).
2. Click user → `chat.rooms.dmFindOrCreate({ otherUserId })` → receive
   `{ roomId }`.
3. Navigate to `/chat/{roomId}`.

**Create a group:**
1. `/chat` → "New Group" → form: name + `UserSearchDialog` multi-select.
2. Submit → `chat.rooms.createGroup({ name, memberIds })` → navigate to
   the returned `/chat/{roomId}`.
3. Inside a group, "Add people" button reuses `UserSearchDialog` and calls
   `chat.rooms.invite` per pick.

**Send a file:** click attach icon → native file picker → uploadFile →
sendFile → message appears in list with download link.

**Typing:** `MessageComposer` throttles `typing:start` to at most once per
2s on input change. On unmount or 3s idle, emits `typing:stop`. `typing:stop`
is **best-effort**; the 5s client-side auto-expiry since the last
`typing:start` is the authoritative source — UI must not depend on a
`typing:stop` actually arriving.

**Presence:** On `/chat/{roomId}` mount, `useLiveRoom` subscribes — the
subscription's server-side handler adds the user to the room's presence set
and publishes `presence:enter`. On unmount (or abort), publishes
`presence:leave` after a 3s debounce (cancels if the same user resubscribes
within the window — handles brief reconnects).

## Error Handling

- **WS auth fail on connect:** server closes the WS with code `4401` and
  reason `unauthorized`. Client detects close code, redirects to `/login`.
- **WS reconnect:** `wsClient` handles exponential backoff. On successful
  reconnect, active subscriptions are re-opened automatically; `useLiveRoom`
  fetches `sinceCursor` to fill the message gap. The hook tracks
  `lastSeenMessageId` on **every** incoming `message:new`, not only at
  reconnect — so a disconnect that happens mid-stream still has a usable
  cursor. Dedupe by id when the gap-fill result overlaps with events that
  arrived before disconnect detection.
- **File size limit:** 413 response; UI shows "File too large (max 10 MB)".
- **Disk write failure:** 500 response; message is not sent.
- **Message insert after successful file upload failed:** file row stays;
  orphan cleanup is out of scope (see "Out of Scope").
- **Race: two users grab the same DM-creation path:** `ChatRoom.dmKey` is
  a `@unique` string formed as `${min(userIdA, userIdB)}:${max(userIdA,
  userIdB)}` for DM rooms. `dmFindOrCreate` first queries by `dmKey`; if
  found, return. If not, attempt insert with that `dmKey`. On unique
  violation (P2002), re-run the query — the other caller just won the
  race; return their room. No advisory lock needed. Group rooms leave
  `dmKey` null.
- **User search with <2 chars:** returns empty array, no DB query.
- **Group creation with 0 members:** rejected with `BAD_REQUEST`.

## Feature Flag

- Server (`apps/server/src/index.ts`): if `env.ENABLE_CHAT !== true`, skip
  mounting the chat routes and the WS adapter entirely. Still mount the
  auth handler, tRPC HTTP, health, etc.
- Client (`apps/web/src/routes/_authenticated/chat/*`): guard with
  `env.VITE_ENABLE_CHAT` in the route component; redirect to `/dashboard`
  when disabled.
- Default: both flags `false`. Demo usage sets both `true` in the dev
  `.env`.
- Env vars added to `packages/env/src/server.ts` and `packages/env/src/client.ts`.

## Testing

### Unit (Vitest, `make test-unit`)

Located in `packages/api/src/domains/chat/__tests__/` and
`packages/api/src/realtime/__tests__/`.

- `service.test.ts` — room create, DM find-or-create dedupe, membership
  require, message insert, cursor pagination, search ranking.
- `router.test.ts` — auth guards, input validation, happy-path
  `createCaller` flows.
- `realtime.test.ts` — `defineChannel` publish/subscribe round-trip, signal
  abort cleanup, subscriber count.

### BDD (Playwright-BDD, `make test`)

One happy-path scenario exercising the WS path end-to-end via two real
browser contexts (see `docs/testing-guidelines.md`):

```gherkin
Scenario: Alice and Bob chat live
  Given Alice and Bob are signed in
  And they are both in room "general"
  When Alice sends "hello"
  Then Bob sees "hello" within 2 seconds
```

### Not tested

- Node-to-Node WS integration tests. BDD covers the WS contract via real
  browser WebSocket — adding a Vitest-based WS client duplicates coverage
  with more flake surface. See `docs/testing-guidelines.md`.
- File upload/download in BDD — unit tests cover the service, the browser
  path is exercised manually for prep.
- Typing, presence, reconnect in BDD — unit-tested logic, UI validated
  manually for prep.

## Out of Scope (for this spec)

Deferred to hackathon-time agent skill retrofits if the challenge demands them:

- Read receipts
- Message edit/delete
- Reactions/emoji
- Reply threads
- Message search
- Image thumbnails / previews
- Infinite scroll polish (beyond basic `beforeCursor`)
- S3 / object storage (documented swap from local disk)
- Orphan file cleanup (requires BullMQ or cron)
- Rate limiting on send / upload
- Friend/contact requests
- Email-based invitations
- Presence in the user list / "last seen"
- Multi-instance scaling (Redis pub/sub swap in `realtime`)
- Group admin roles, kick, mute
- Notification sounds / desktop notifications

## Deliverables

1. `packages/db/prisma/schema/chat.prisma` — four models + User additions.
2. `packages/api/src/realtime/` — channel primitive (`channel.ts`) with tests.
3. `packages/api/src/domains/chat/` — service + router + constants + tests
   (owns presence state per "Presence ownership").
4. `packages/api/src/domains/user/` — user search router + service + tests.
5. `packages/api/package.json` — add subpath exports: `./realtime/channel`,
   `./domains/chat/service`, `./domains/chat/router`, `./domains/chat/constants`,
   `./domains/user/service`, `./domains/user/router`. One entry per file —
   no barrel.
6. `packages/auth/src/index.ts` — `additionalFields.username` config.
7. `packages/env/src/server.ts` — `ENABLE_CHAT` var + Zod default `false`.
8. `packages/env/src/client.ts` — `VITE_ENABLE_CHAT` var + Zod default `false`.
9. `apps/server/src/index.ts` — chat flag, file endpoints, WS adapter
   attachment to `serve()`'s `http.Server` (see "WebSocket Server
   Attachment" for the concrete snippet). Also: `apps/server/package.json`
   gets `ws` + `@types/ws` dependencies.
10. `apps/web/src/routes/_authenticated/chat/index.tsx` + `$roomId.tsx`.
11. `apps/web/src/features/chat/` — `use-live-room.ts`, `upload-file.ts`,
    components.
12. `apps/web/src/router.tsx` — `splitLink` + `wsLink` wiring.
13. `apps/web/src/routes/login.tsx` — username field + async availability
    check.
14. `scripts/seed.ts` — usernames for demo users.
15. `docs/testing-guidelines.md` — multi-user BDD pattern, test type
    guidance.
16. `docs/skills/add-realtime.md` — agent skill for retrofitting real-time
    to an existing feature; cites this spec's patterns.
17. `CLAUDE.md` (root) — pointer to `docs/testing-guidelines.md`.
18. `TODO.md` — Real-time section: add new entries (already done in prep).
19. `.gitignore` — `var/files/`.

## Effort Estimate

~6-8 hours. Rough allocation:

- Schema + migration + Better-Auth username: 1 h
- `packages/api/src/realtime/` with tests: 1 h
- Chat service + router + tests: 2 h
- File upload/download + authz: 0.5 h
- WS server adapter + auth on connect: 0.5 h
- Client splitLink + `useLiveRoom` + cache merge: 1 h
- Routes + components (basic UI, not polished): 1 h
- Signup form update + async check: 0.5 h
- BDD scenario + testing-guidelines doc: 0.5 h

Polish, debugging, and the agent skill doc consume any remaining budget.

**Add ~25% buffer if library surprises appear** — tRPC v11's WS adapter
paired with Hono via `noServer: true`, Better-Auth's `additionalFields`
client typing, and the first multi-user Playwright-BDD scenario are the
three places that routinely eat time.
