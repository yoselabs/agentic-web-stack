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

### Public API

```typescript
import { defineChannel } from "@project/api/realtime";
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
```

### Implementation notes

- Backed by Node's `EventEmitter`. Channel name is the event key. Subscribers
  get a named `AsyncIterable<Event>` keyed by the channel name.
- `subscribe()` accepts `AbortSignal` for cleanup on client disconnect.
- Zod schemas run at publish time in dev only (validates developer intent);
  production skips for throughput.
- Zero state persistence — this module only fans out events to currently
  connected subscribers. Durable state lives in Postgres.

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
- `dmFindOrCreate` allows any authenticated user to DM any other user.
- `createGroup` with 0 members is rejected; creator is auto-added.
- `invite` requires caller to be a member.

**Cursor format:** `{ createdAt: ISO8601, id: cuid }`. `sinceCursor` returns
messages where `(createdAt, id) > cursor` using a tuple comparison (primary
sort: `createdAt`; tiebreak: `id`). Server timestamps always win — clients
never set `createdAt`.

**Fanout pattern on send:**
1. Insert `ChatMessage` inside the `$transaction`.
2. After `await tx.$transaction(...)` resolves (not inside it), publish
   `message:new` to `chat:room:{roomId}`.
3. For members who are not currently subscribed to the room channel, publish
   `unread:nudge` to each `user:{userId}`. (Tracking "who's subscribed" is
   exposed from `realtime` via an internal `subscriberCount(channelName)`.)

**Unread count** is derived from `lastReadAt` on `ChatMembership` and is
returned by `chat.rooms.listMine()`. Clients call `chat.messages.markRead({
roomId, lastSeenMessageId })` on room open / activity.

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
- Mime whitelist: permissive (anything that doesn't start with
  `application/x-` executable-ish). Stored as declared by client; not
  re-sniffed.
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
- `Content-Type: {file.mimeType}`
- `Content-Disposition: attachment; filename="{sanitizedFilename}"` —
  sanitization strips quotes, newlines, and backslashes; if empty after
  sanitization, falls back to `file.id`.
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
2s on input change. On unmount or 3s idle, emits `typing:stop`. Client-side
auto-expiry at 5s since last `typing:start` prevents stuck indicators on
network blips.

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
  fetches `sinceCursor` to fill the message gap.
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
2. `packages/api/src/realtime/` — channel primitive with tests.
3. `packages/api/src/domains/chat/` — service + router + constants + tests.
4. `packages/api/src/domains/user/` — user search router + service + tests.
5. `packages/api/package.json` — add new subpath exports.
6. `packages/auth/src/index.ts` — `additionalFields.username` config.
7. `packages/env/src/server.ts` — `ENABLE_CHAT` var + Zod default `false`.
8. `packages/env/src/client.ts` — `VITE_ENABLE_CHAT` var + Zod default `false`.
9. `apps/server/src/index.ts` — chat flag, file endpoints, WS adapter
   attachment to `serve()`'s `http.Server`.
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
