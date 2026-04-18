# Real-Time Chat Reference Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the real-time chat reference described in `docs/superpowers/specs/2026-04-18-realtime-chat-reference-design.md` — DMs, group rooms, presence, typing, file sharing — as a disabled-by-default pattern library for AI agents.

**Architecture:** Single-instance Node app. `packages/api/src/realtime/channel.ts` exposes a typed in-process pub/sub (backed by Node `EventEmitter`). `packages/api/src/domains/chat/` implements rooms/messages/presence following the existing service/router/constants layout. `apps/server` grows a `ws.WebSocketServer` on the same `http.Server` and Hono direct routes for file up/download. `apps/web` gets a tRPC `splitLink` (WS for subscriptions, HTTP for queries/mutations), a `useLiveRoom` hook that merges WS events into the React Query cache, and two routes (`/chat`, `/chat/$roomId`).

**Tech Stack:** Hono + `@hono/node-server`, tRPC v11 (`@trpc/server/adapters/ws`), `ws` + `@types/ws`, Better-Auth (+ `additionalFields` client plugin), Prisma, Playwright-BDD (multi-context fixture).

---

## File Structure

**Create:**
- `packages/db/prisma/schema/chat.prisma` — ChatRoom, ChatMembership, ChatMessage, ChatFile, enum + User additions
- `packages/api/src/realtime/channel.ts` — `defineChannel`, channel-instance API
- `packages/api/src/realtime/__tests__/channel.test.ts`
- `packages/api/src/domains/chat/constants.ts`
- `packages/api/src/domains/chat/service.ts`
- `packages/api/src/domains/chat/presence.ts` — per-process presence state for chat
- `packages/api/src/domains/chat/channels.ts` — `roomChannel`, `userChannel` instances
- `packages/api/src/domains/chat/router.ts`
- `packages/api/src/domains/chat/__tests__/service.test.ts`
- `packages/api/src/domains/chat/__tests__/router.test.ts`
- `packages/api/src/domains/user/service.ts` — user search, username availability
- `packages/api/src/domains/user/router.ts`
- `packages/api/src/domains/user/__tests__/service.test.ts`
- `apps/web/src/features/chat/types.ts`
- `apps/web/src/features/chat/upload-file.ts`
- `apps/web/src/features/chat/use-live-room.ts`
- `apps/web/src/features/chat/use-chat-rooms.ts`
- `apps/web/src/features/chat/components/MessageList.tsx`
- `apps/web/src/features/chat/components/MessageComposer.tsx`
- `apps/web/src/features/chat/components/RoomListSidebar.tsx`
- `apps/web/src/features/chat/components/UserSearchDialog.tsx`
- `apps/web/src/routes/_authenticated/chat/index.tsx`
- `apps/web/src/routes/_authenticated/chat/$roomId.tsx`
- `e2e/fixtures/multi-user.ts` — `test.extend` with `pages: Map<string,Page>`
- `e2e/features/chat.feature`
- `e2e/steps/chat.ts`
- `docs/skills/add-realtime.md`

**Modify:**
- `packages/db/prisma/schema/auth.prisma` — add `username String? @unique` + reverse relations
- `packages/api/package.json` — add subpath exports (see Task 3 / 5 / 7)
- `packages/api/src/router.ts` — register `chat` and `user` routers (alpha order)
- `packages/auth/src/index.ts` — `additionalFields.username`
- `packages/env/src/server.ts` — `ENABLE_CHAT`
- `packages/env/src/client.ts` — `VITE_ENABLE_CHAT`, `VITE_WS_URL`
- `apps/web/src/features/auth/auth-client.ts` — `inferAdditionalFields` plugin
- `apps/web/src/routes/login.tsx` — username field + debounced availability check
- `apps/web/src/router.tsx` — `splitLink` + `wsLink`
- `apps/server/src/index.ts` — file endpoints + WS attachment + chat flag gating
- `apps/server/package.json` — `ws`, `@types/ws`
- `scripts/seed.ts` — username + sample chat data
- `.gitignore` — `var/`

---

## Phase 1 — Foundation

### Task 1: Schema — chat models + nullable username

**Files:**
- Create: `packages/db/prisma/schema/chat.prisma`
- Modify: `packages/db/prisma/schema/auth.prisma`
- Modify: `.gitignore`

- [ ] **Step 1: Extend the User model with username (nullable) and reverse relations**

Open `packages/db/prisma/schema/auth.prisma`. Replace the `User` block with:

```prisma
model User {
  id            String    @id
  name          String
  email         String    @unique
  emailVerified Boolean   @default(false)
  image         String?
  username      String?   @unique
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  sessions  Session[]
  accounts  Account[]
  todos     Todo[]
  todoLists TodoList[]

  chatMemberships ChatMembership[]
  chatMessages    ChatMessage[]
  chatFiles       ChatFile[]
}
```

Note: `username` is nullable in Task 1. Task 16 backfills existing rows and tightens to non-null.

- [ ] **Step 2: Create chat schema**

Create `packages/db/prisma/schema/chat.prisma`:

```prisma
enum ChatMessageKind {
  TEXT
  FILE
}

model ChatRoom {
  id        String   @id @default(cuid())
  name      String?
  dmKey     String?  @unique
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
  @@index([userId])
}

model ChatMessage {
  id        String          @id @default(cuid())
  roomId    String
  userId    String
  kind      ChatMessageKind
  text      String?
  fileId    String?
  createdAt DateTime        @default(now())

  room ChatRoom  @relation(fields: [roomId], references: [id], onDelete: Cascade)
  user User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  file ChatFile? @relation(fields: [fileId], references: [id])

  @@index([roomId, createdAt, id])
}

model ChatFile {
  id         String   @id @default(cuid())
  storedPath String
  filename   String
  mimeType   String
  size       Int
  uploadedBy String
  createdAt  DateTime @default(now())

  uploader User          @relation(fields: [uploadedBy], references: [id])
  messages ChatMessage[]
}
```

- [ ] **Step 3: Add `var/` to .gitignore**

Append to `.gitignore`:

```
# Chat reference — local file storage
var/
```

- [ ] **Step 4: Push schema and regenerate client**

Run: `make db-push`
Expected: "Your database is now in sync with your schema" + "Generated Prisma Client".

- [ ] **Step 5: Typecheck to confirm client picks up new models**

Run: `make check`
Expected: PASS. If Prisma types aren't found in later-imported files (nothing imports ChatRoom yet), this should still pass.

- [ ] **Step 6: Commit**

```bash
git add packages/db/prisma/schema/chat.prisma packages/db/prisma/schema/auth.prisma .gitignore
git commit -m "feat(db): add chat schema + nullable username on User"
```

---

### Task 2: Env vars — ENABLE_CHAT, VITE_ENABLE_CHAT, VITE_WS_URL

**Files:**
- Modify: `packages/env/src/server.ts`
- Modify: `packages/env/src/client.ts`

- [ ] **Step 1: Read current server env to see the Zod pattern**

Run: `cat packages/env/src/server.ts`

- [ ] **Step 2: Add ENABLE_CHAT to server env**

In `packages/env/src/server.ts`, inside the Zod schema object, add:

```ts
ENABLE_CHAT: z
  .string()
  .optional()
  .default("false")
  .transform((v) => v === "true"),
```

- [ ] **Step 3: Add VITE_ENABLE_CHAT + VITE_WS_URL to client env**

In `packages/env/src/client.ts`:

```ts
VITE_ENABLE_CHAT: z
  .string()
  .optional()
  .default("false")
  .transform((v) => v === "true"),
VITE_WS_URL: z
  .string()
  .url()
  .optional()
  .default("ws://localhost:3001/trpc-ws"),
```

- [ ] **Step 4: Typecheck**

Run: `make check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/env/src/server.ts packages/env/src/client.ts
git commit -m "feat(env): add ENABLE_CHAT + VITE_ENABLE_CHAT + VITE_WS_URL"
```

---

### Task 3: Better-Auth — additionalFields.username on server + client

**Files:**
- Modify: `packages/auth/src/index.ts`
- Modify: `apps/web/src/features/auth/auth-client.ts`
- Modify: `apps/web/src/routes/login.tsx`

- [ ] **Step 1: Read current auth-client to see its shape**

Run: `cat apps/web/src/features/auth/auth-client.ts`

- [ ] **Step 2: Add additionalFields.username to server auth config**

Replace the body of `packages/auth/src/index.ts` with:

```ts
import { db } from "@project/db";
import { env } from "@project/env/server";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { MIN_PASSWORD_LENGTH } from "./constants.js";

export const auth = betterAuth({
  database: prismaAdapter(db, { provider: "postgresql" }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: MIN_PASSWORD_LENGTH,
  },
  trustedOrigins: [env.CORS_ORIGIN],
  user: {
    additionalFields: {
      username: {
        type: "string",
        required: false, // tightened to true in Task 16
        input: true,
      },
    },
  },
});

export type Session = typeof auth.$Infer.Session;
```

- [ ] **Step 3: Update web auth-client with inferAdditionalFields plugin**

Edit `apps/web/src/features/auth/auth-client.ts`. Add the plugin import + typing:

```ts
import { createAuthClient } from "better-auth/react";
import { inferAdditionalFields } from "better-auth/client/plugins";
import type { auth } from "@project/auth";

export const authClient = createAuthClient({
  baseURL: "/api/auth",
  plugins: [inferAdditionalFields<typeof auth>()],
});

export const { signIn, signUp, signOut, useSession } = authClient;
```

(Adjust imports already present in the file — the critical change is adding
`inferAdditionalFields<typeof auth>()` to the `plugins` array. If the file
has other content, preserve it and only add/modify the plugin entry.)

- [ ] **Step 4: Run typecheck to confirm client sees the `username` field**

Run: `make check`
Expected: PASS. TypeScript now knows `signUp.email({email, password, name, username?})`.

- [ ] **Step 5: Commit**

```bash
git add packages/auth/src/index.ts apps/web/src/features/auth/auth-client.ts
git commit -m "feat(auth): add username additionalField on server + client"
```

---

## Phase 2 — Realtime Primitive

### Task 4: `defineChannel` — typed in-process pub/sub

**Files:**
- Create: `packages/api/src/realtime/channel.ts`
- Create: `packages/api/src/realtime/__tests__/channel.test.ts`
- Modify: `packages/api/package.json`

- [ ] **Step 1: Write failing test**

Create `packages/api/src/realtime/__tests__/channel.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { defineChannel } from "../channel.js";

describe("defineChannel", () => {
  afterEach(() => vi.useRealTimers());

  it("delivers a published event to a concurrent subscriber", async () => {
    const ch = defineChannel({
      name: (id: string) => `test:${id}`,
      events: { ping: z.object({ n: z.number() }) },
    });
    const ac = new AbortController();
    const received: Array<{ type: "ping"; data: { n: number } }> = [];

    const consumer = (async () => {
      for await (const ev of ch.subscribe("room1", ac.signal)) {
        received.push(ev);
        if (received.length >= 1) ac.abort();
      }
    })();

    await new Promise((r) => setTimeout(r, 10)); // let subscribe attach
    ch.publish("room1", "ping", { n: 42 });
    await consumer;

    expect(received).toEqual([{ type: "ping", data: { n: 42 } }]);
  });

  it("does not deliver events from a different room key", async () => {
    const ch = defineChannel({
      name: (id: string) => `test:${id}`,
      events: { ping: z.object({ n: z.number() }) },
    });
    const ac = new AbortController();
    const received: unknown[] = [];

    const consumer = (async () => {
      for await (const ev of ch.subscribe("A", ac.signal)) {
        received.push(ev);
      }
    })();

    await new Promise((r) => setTimeout(r, 10));
    ch.publish("B", "ping", { n: 1 });
    await new Promise((r) => setTimeout(r, 10));
    ac.abort();
    await consumer;

    expect(received).toEqual([]);
  });

  it("hasSubscribers reflects local subscriber count", async () => {
    const ch = defineChannel({
      name: (id: string) => `test:${id}`,
      events: { ping: z.object({}) },
    });
    expect(ch.hasSubscribers("room1")).toBe(false);

    const ac = new AbortController();
    const consumer = (async () => {
      for await (const _ of ch.subscribe("room1", ac.signal)) { /* noop */ }
    })();

    await new Promise((r) => setTimeout(r, 10));
    expect(ch.hasSubscribers("room1")).toBe(true);
    ac.abort();
    await consumer;
    expect(ch.hasSubscribers("room1")).toBe(false);
  });

  it("validates payload shape in dev (throws on bad publish)", () => {
    const ch = defineChannel({
      name: (id: string) => `test:${id}`,
      events: { ping: z.object({ n: z.number() }) },
    });
    // @ts-expect-error — intentionally wrong shape
    expect(() => ch.publish("room1", "ping", { n: "not-a-number" })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `make test-unit ARGS="packages/api/src/realtime"` (or simply `make test-unit`)
Expected: FAIL with "Cannot find module '../channel.js'".

- [ ] **Step 3: Implement defineChannel**

Create `packages/api/src/realtime/channel.ts`:

```ts
import { EventEmitter } from "node:events";
import { z, type ZodType } from "zod";

type EventMap = Record<string, ZodType>;

export type ChannelDefinition<K, E extends EventMap> = {
  name: (key: K) => string;
  events: E;
};

type EventFor<E extends EventMap> = {
  [K in keyof E]: { type: K; data: z.infer<E[K]> };
}[keyof E];

// Single process-wide emitter. Channel name strings scope delivery.
const bus = new EventEmitter();
bus.setMaxListeners(0);

export type Channel<K, E extends EventMap> = {
  publish<T extends keyof E>(key: K, type: T, data: z.infer<E[T]>): void;
  subscribe(key: K, signal: AbortSignal): AsyncIterable<EventFor<E>>;
  hasSubscribers(key: K): boolean;
};

const IS_DEV = process.env.NODE_ENV !== "production";

export function defineChannel<K, E extends EventMap>(
  def: ChannelDefinition<K, E>,
): Channel<K, E> {
  return {
    publish(key, type, data) {
      const name = def.name(key);
      if (IS_DEV) {
        def.events[type].parse(data);
      }
      bus.emit(name, { type, data });
    },

    hasSubscribers(key) {
      return bus.listenerCount(def.name(key)) > 0;
    },

    subscribe(key, signal) {
      const name = def.name(key);
      const queue: EventFor<E>[] = [];
      let resolve: ((v: IteratorResult<EventFor<E>>) => void) | null = null;
      let done = false;

      const handler = (ev: EventFor<E>) => {
        if (resolve) {
          resolve({ value: ev, done: false });
          resolve = null;
        } else {
          queue.push(ev);
        }
      };

      bus.on(name, handler);

      const close = () => {
        if (done) return;
        done = true;
        bus.off(name, handler);
        if (resolve) {
          resolve({ value: undefined as never, done: true });
          resolve = null;
        }
      };
      signal.addEventListener("abort", close, { once: true });

      return {
        [Symbol.asyncIterator]() {
          return {
            next(): Promise<IteratorResult<EventFor<E>>> {
              if (done) return Promise.resolve({ value: undefined as never, done: true });
              const next = queue.shift();
              if (next) return Promise.resolve({ value: next, done: false });
              return new Promise((r) => {
                resolve = r;
              });
            },
            return(): Promise<IteratorResult<EventFor<E>>> {
              close();
              return Promise.resolve({ value: undefined as never, done: true });
            },
          };
        },
      };
    },
  };
}
```

- [ ] **Step 4: Add subpath export**

In `packages/api/package.json` `exports`, add:

```json
"./realtime/channel": { "default": "./src/realtime/channel.ts" },
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `make test-unit`
Expected: PASS (4 channel tests green).

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/realtime packages/api/package.json
git commit -m "feat(api): add realtime channel primitive with typed pub/sub"
```

---

## Phase 3 — User Domain

### Task 5: User service — search + isUsernameAvailable

**Files:**
- Create: `packages/api/src/domains/user/service.ts`
- Create: `packages/api/src/domains/user/router.ts`
- Create: `packages/api/src/domains/user/__tests__/service.test.ts`
- Modify: `packages/api/package.json`
- Modify: `packages/api/src/router.ts`

- [ ] **Step 1: Write failing service tests**

Create `packages/api/src/domains/user/__tests__/service.test.ts`:

```ts
import { db } from "@project/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isUsernameAvailable, searchUsers } from "../service.js";

const TEST_USERS = [
  { id: "user-search-alice", name: "Alice Anderson", email: "alice@test.com", username: "alice_a" },
  { id: "user-search-bob", name: "Bob Brown", email: "bob@test.com", username: "bob_b" },
  { id: "user-search-alex", name: "Alex Alvarez", email: "alex@test.com", username: "alex_a" },
];

beforeAll(async () => {
  await db.user.deleteMany({ where: { id: { in: TEST_USERS.map((u) => u.id) } } });
  await db.user.createMany({
    data: TEST_USERS.map((u) => ({ ...u, emailVerified: false })),
  });
});

afterAll(async () => {
  await db.user.deleteMany({ where: { id: { in: TEST_USERS.map((u) => u.id) } } });
  await db.$disconnect();
});

describe("searchUsers", () => {
  it("matches username prefix (case-insensitive)", async () => {
    const r = await searchUsers(db, "ALEX");
    expect(r.some((u) => u.userId === "user-search-alex")).toBe(true);
  });

  it("matches name substring when no username match", async () => {
    const r = await searchUsers(db, "brown");
    expect(r.some((u) => u.userId === "user-search-bob")).toBe(true);
  });

  it("never returns email", async () => {
    const r = await searchUsers(db, "alex");
    for (const row of r) {
      expect(row).not.toHaveProperty("email");
    }
  });

  it("returns empty for queries shorter than 2 chars", async () => {
    expect(await searchUsers(db, "a")).toEqual([]);
    expect(await searchUsers(db, "")).toEqual([]);
  });

  it("ranks exact username match first", async () => {
    const r = await searchUsers(db, "alice_a");
    expect(r[0]?.userId).toBe("user-search-alice");
  });
});

describe("isUsernameAvailable", () => {
  it("returns false when taken", async () => {
    expect(await isUsernameAvailable(db, "alice_a")).toBe(false);
  });

  it("returns true when free", async () => {
    expect(await isUsernameAvailable(db, "never_used_name")).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `make test-unit`
Expected: FAIL with module-not-found on `../service.js`.

- [ ] **Step 3: Implement the service**

Create `packages/api/src/domains/user/service.ts`:

```ts
import { Prisma, type PrismaClient } from "@project/db";

type DbClient = PrismaClient | Prisma.TransactionClient;

export type UserSearchResult = {
  userId: string;
  username: string | null;
  name: string;
  image: string | null;
};

export async function searchUsers(
  db: DbClient,
  query: string,
): Promise<UserSearchResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  const rows = await db.user.findMany({
    where: {
      OR: [
        { username: { startsWith: q, mode: "insensitive" } },
        { name: { contains: q, mode: "insensitive" } },
      ],
    },
    select: { id: true, username: true, name: true, image: true },
    take: 50,
  });

  const lower = q.toLowerCase();
  const score = (u: { username: string | null; name: string }) => {
    const un = u.username?.toLowerCase() ?? "";
    if (un === lower) return 0;
    if (un.startsWith(lower)) return 1;
    if (u.name.toLowerCase().includes(lower)) return 2;
    return 3;
  };
  rows.sort((a, b) => {
    const sa = score(a);
    const sb = score(b);
    if (sa !== sb) return sa - sb;
    return a.name.localeCompare(b.name);
  });

  return rows.slice(0, 20).map((u) => ({
    userId: u.id,
    username: u.username,
    name: u.name,
    image: u.image,
  }));
}

export async function isUsernameAvailable(
  db: DbClient,
  username: string,
): Promise<boolean> {
  const existing = await db.user.findUnique({
    where: { username },
    select: { id: true },
  });
  return existing === null;
}
```

- [ ] **Step 4: Implement the router**

Create `packages/api/src/domains/user/router.ts`:

```ts
import { z } from "zod";
import { protectedProcedure, publicProcedure, router } from "../../trpc.js";
import { isUsernameAvailable, searchUsers } from "./service.js";

export const userRouter = router({
  search: protectedProcedure
    .input(z.object({ query: z.string() }))
    .query(({ ctx, input }) => searchUsers(ctx.db, input.query)),

  isUsernameAvailable: publicProcedure
    .input(z.object({ username: z.string().min(3).max(20) }))
    .query(({ ctx, input }) => isUsernameAvailable(ctx.db, input.username)),
});
```

- [ ] **Step 5: Register user router (alpha position)**

Edit `packages/api/src/router.ts`:

```ts
import { todoListRouter } from "./domains/todo-list/router.js";
import { todoRouter } from "./domains/todo/router.js";
import { userRouter } from "./domains/user/router.js";
import { router } from "./trpc.js";

export const appRouter = router({
  todo: todoRouter,
  todoList: todoListRouter,
  user: userRouter,
});

export type AppRouter = typeof appRouter;
```

- [ ] **Step 6: Add subpath exports**

In `packages/api/package.json` `exports`, add:

```json
"./domains/user/service": { "default": "./src/domains/user/service.ts" },
"./domains/user/router":  { "default": "./src/domains/user/router.ts" },
```

- [ ] **Step 7: Run tests, confirm they pass**

Run: `make test-unit`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/api/src/domains/user packages/api/package.json packages/api/src/router.ts
git commit -m "feat(api): add user search + isUsernameAvailable"
```

---

### Task 6: Signup form — username input + async availability check

**Files:**
- Modify: `apps/web/src/routes/login.tsx`

- [ ] **Step 1: Rewrite login.tsx to collect username on sign-up**

Replace the body of `apps/web/src/routes/login.tsx` with:

```tsx
import { Button } from "@project/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@project/ui/components/card";
import { Input } from "@project/ui/components/input";
import { Label } from "@project/ui/components/label";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { signIn, signUp, useSession } from "#/features/auth/auth-client";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

const USERNAME_REGEX = /^[a-z0-9_]{3,20}$/;

function LoginPage() {
  const navigate = useNavigate();
  const { trpc } = Route.useRouteContext();
  const { data: session } = useSession();
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [debouncedUsername, setDebouncedUsername] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (session) navigate({ to: "/dashboard" });
  }, [session, navigate]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedUsername(username), 300);
    return () => clearTimeout(t);
  }, [username]);

  const usernameFormatValid = useMemo(
    () => USERNAME_REGEX.test(username),
    [username],
  );

  const availability = useQuery({
    ...trpc.user.isUsernameAvailable.queryOptions({ username: debouncedUsername }),
    enabled:
      isSignUp &&
      debouncedUsername.length >= 3 &&
      USERNAME_REGEX.test(debouncedUsername),
    staleTime: 5_000,
  });

  const usernameHint = !isSignUp
    ? null
    : username.length === 0
      ? "3–20 chars: lowercase letters, digits, underscore"
      : !usernameFormatValid
        ? "Invalid format (3–20 lowercase letters/digits/_)"
        : availability.isLoading
          ? "Checking…"
          : availability.data === false
            ? "Username already taken"
            : availability.data === true
              ? "Available"
              : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (isSignUp) {
      if (!usernameFormatValid) {
        setError("Invalid username format");
        return;
      }
      if (availability.data === false) {
        setError("Username already taken");
        return;
      }
      const result = await signUp.email({
        email,
        password,
        name: name || email.split("@")[0],
        username,
      });
      if (result.error) {
        setError(result.error.message ?? "Sign up failed");
        return;
      }
    } else {
      const result = await signIn.email({ email, password });
      if (result.error) {
        setError(result.error.message ?? "Sign in failed");
        return;
      }
    }
    navigate({ to: "/dashboard" });
  };

  if (session) return null;

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">{isSignUp ? "Create Account" : "Sign In"}</CardTitle>
          <CardDescription>
            {isSignUp ? "Enter your details to create an account" : "Enter your credentials to sign in"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {isSignUp && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="username">Username</Label>
                  <Input
                    id="username"
                    type="text"
                    placeholder="e.g. alice_a"
                    value={username}
                    onChange={(e) => setUsername(e.target.value.toLowerCase())}
                    required
                  />
                  {usernameHint && (
                    <p className="text-xs text-muted-foreground">{usernameHint}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="name">Display Name</Label>
                  <Input
                    id="name"
                    type="text"
                    placeholder="Your name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
              </>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full">
              {isSignUp ? "Sign Up" : "Sign In"}
            </Button>
          </form>
          <p className="mt-4 text-center text-sm text-muted-foreground">
            {isSignUp ? "Already have an account?" : "Don't have an account?"}{" "}
            <button
              type="button"
              onClick={() => setIsSignUp(!isSignUp)}
              className="text-foreground underline underline-offset-4 hover:text-primary"
            >
              {isSignUp ? "Sign In" : "Sign Up"}
            </button>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
```

- [ ] **Step 2: Update auth BDD step to provide username on sign-up**

Edit `e2e/steps/auth.ts` — inside `signUpOrSignIn`, after filling the Name input, add a username fill (only applies when the sign-up form is visible, which this helper is by design):

```ts
// Generate a BDD-safe username from the email local-part
const handle = email.split("@")[0].toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 20).padEnd(3, "_");
await page.getByLabel("Username").fill(handle);
```

Place this line after `await page.getByLabel("Name").fill(...)` and before the password fill.

- [ ] **Step 3: Run typecheck**

Run: `make check`
Expected: PASS.

- [ ] **Step 4: Run the BDD auth suite (spot-check: form still works)**

Run: `make test ARGS="--grep Authentication --project desktop"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/routes/login.tsx e2e/steps/auth.ts
git commit -m "feat(web): username field with async availability on signup"
```

---

## Phase 4 — Chat Domain Backend

### Task 7: Chat constants + channel instances

**Files:**
- Create: `packages/api/src/domains/chat/constants.ts`
- Create: `packages/api/src/domains/chat/channels.ts`
- Modify: `packages/api/package.json`

- [ ] **Step 1: Create constants**

Create `packages/api/src/domains/chat/constants.ts`:

```ts
export const MAX_CHAT_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
export const USERNAME_REGEX = /^[a-z0-9_]{3,20}$/;
export const TYPING_DEBOUNCE_MS = 2_000;
export const TYPING_IDLE_STOP_MS = 3_000;
export const TYPING_CLIENT_EXPIRY_MS = 5_000;
export const PRESENCE_LEAVE_GRACE_MS = 3_000;
export const MESSAGE_PAGE_SIZE = 50;
```

- [ ] **Step 2: Create channel instances**

Create `packages/api/src/domains/chat/channels.ts`:

```ts
import { z } from "zod";
import { defineChannel } from "../../realtime/channel.js";

const MessagePayload = z.object({
  id: z.string(),
  roomId: z.string(),
  userId: z.string(),
  kind: z.enum(["TEXT", "FILE"]),
  text: z.string().nullable(),
  fileId: z.string().nullable(),
  createdAt: z.date(),
});

export const roomChannel = defineChannel({
  name: (roomId: string) => `chat:room:${roomId}`,
  events: {
    "message:new": MessagePayload,
    "typing:start": z.object({ roomId: z.string(), userId: z.string() }),
    "typing:stop":  z.object({ roomId: z.string(), userId: z.string() }),
    "presence:enter": z.object({ roomId: z.string(), userId: z.string() }),
    "presence:leave": z.object({ roomId: z.string(), userId: z.string() }),
  },
});

export const userChannel = defineChannel({
  name: (userId: string) => `user:${userId}`,
  events: {
    "unread:nudge": z.object({ roomId: z.string() }),
    "room:invited": z.object({ roomId: z.string() }),
  },
});
```

- [ ] **Step 3: Add subpath exports**

In `packages/api/package.json` `exports`, add:

```json
"./domains/chat/constants": { "default": "./src/domains/chat/constants.ts" },
```

- [ ] **Step 4: Typecheck**

Run: `make check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/domains/chat/constants.ts packages/api/src/domains/chat/channels.ts packages/api/package.json
git commit -m "feat(chat): constants + typed channel instances"
```

---

### Task 8: Chat service — rooms

**Files:**
- Create: `packages/api/src/domains/chat/presence.ts`
- Create: `packages/api/src/domains/chat/service.ts` (first portion; messages added in Task 9)
- Create: `packages/api/src/domains/chat/__tests__/service.test.ts`

- [ ] **Step 1: Write failing room tests**

Create `packages/api/src/domains/chat/__tests__/service.test.ts`:

```ts
import { db } from "@project/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createGroupRoom,
  dmFindOrCreate,
  getRoom,
  inviteToRoom,
  leaveRoom,
  listMyRooms,
  requireMembership,
} from "../service.js";

const U1 = "chat-test-u1";
const U2 = "chat-test-u2";
const U3 = "chat-test-u3";

beforeAll(async () => {
  await db.chatMembership.deleteMany({ where: { userId: { in: [U1, U2, U3] } } });
  await db.chatRoom.deleteMany({ where: { memberships: { some: { userId: { in: [U1, U2, U3] } } } } });
  await db.user.deleteMany({ where: { id: { in: [U1, U2, U3] } } });
  await db.user.createMany({
    data: [
      { id: U1, name: "U1", email: "u1@test.com", username: "u1", emailVerified: false },
      { id: U2, name: "U2", email: "u2@test.com", username: "u2", emailVerified: false },
      { id: U3, name: "U3", email: "u3@test.com", username: "u3", emailVerified: false },
    ],
  });
});

afterAll(async () => {
  await db.chatMembership.deleteMany({ where: { userId: { in: [U1, U2, U3] } } });
  await db.chatMessage.deleteMany({ where: { userId: { in: [U1, U2, U3] } } });
  await db.chatRoom.deleteMany({ where: { memberships: { some: { userId: { in: [U1, U2, U3] } } } } });
  await db.user.deleteMany({ where: { id: { in: [U1, U2, U3] } } });
  await db.$disconnect();
});

describe("createGroupRoom", () => {
  it("creates room with creator + members, name present", async () => {
    const room = await db.$transaction((tx) =>
      createGroupRoom(tx, U1, "my-group", [U2, U3]),
    );
    expect(room.name).toBe("my-group");
    const memberIds = await db.chatMembership.findMany({
      where: { roomId: room.id },
      select: { userId: true },
    });
    expect(memberIds.map((m) => m.userId).sort()).toEqual([U1, U2, U3].sort());
  });

  it("rejects empty memberIds", async () => {
    await expect(
      db.$transaction((tx) => createGroupRoom(tx, U1, "x", [])),
    ).rejects.toThrow();
  });
});

describe("dmFindOrCreate", () => {
  it("creates a DM with both members and a sorted dmKey", async () => {
    const room = await db.$transaction((tx) => dmFindOrCreate(tx, U1, U2));
    expect(room.name).toBeNull();
    expect(room.dmKey).toBe([U1, U2].sort().join(":"));
    const members = await db.chatMembership.findMany({ where: { roomId: room.id } });
    expect(members.map((m) => m.userId).sort()).toEqual([U1, U2].sort());
  });

  it("returns the same room for both call directions", async () => {
    const a = await db.$transaction((tx) => dmFindOrCreate(tx, U1, U2));
    const b = await db.$transaction((tx) => dmFindOrCreate(tx, U2, U1));
    expect(a.id).toBe(b.id);
  });
});

describe("requireMembership", () => {
  it("throws when user is not a member", async () => {
    const room = await db.$transaction((tx) => createGroupRoom(tx, U1, "g2", [U2]));
    await expect(requireMembership(db, U3, room.id)).rejects.toThrow();
  });

  it("resolves when user is a member", async () => {
    const room = await db.$transaction((tx) => createGroupRoom(tx, U1, "g3", [U2]));
    await expect(requireMembership(db, U1, room.id)).resolves.toBeUndefined();
  });
});

describe("inviteToRoom", () => {
  it("adds a member when caller is a member", async () => {
    const room = await db.$transaction((tx) => createGroupRoom(tx, U1, "g4", [U2]));
    await db.$transaction((tx) => inviteToRoom(tx, U1, room.id, U3));
    const members = await db.chatMembership.findMany({ where: { roomId: room.id } });
    expect(members.some((m) => m.userId === U3)).toBe(true);
  });

  it("rejects when caller is not a member", async () => {
    const room = await db.$transaction((tx) => createGroupRoom(tx, U1, "g5", [U2]));
    await expect(
      db.$transaction((tx) => inviteToRoom(tx, U3, room.id, U1)),
    ).rejects.toThrow();
  });
});

describe("leaveRoom", () => {
  it("removes caller's membership", async () => {
    const room = await db.$transaction((tx) => createGroupRoom(tx, U1, "g6", [U2]));
    await db.$transaction((tx) => leaveRoom(tx, U2, room.id));
    const members = await db.chatMembership.findMany({ where: { roomId: room.id } });
    expect(members.map((m) => m.userId)).toEqual([U1]);
  });
});

describe("listMyRooms + getRoom", () => {
  it("listMyRooms returns only rooms the user belongs to", async () => {
    const r1 = await db.$transaction((tx) => createGroupRoom(tx, U1, "mine-1", [U2]));
    const r2 = await db.$transaction((tx) => createGroupRoom(tx, U2, "not-mine", [U3]));
    const mine = await listMyRooms(db, U1);
    expect(mine.some((r) => r.id === r1.id)).toBe(true);
    expect(mine.some((r) => r.id === r2.id)).toBe(false);
  });

  it("getRoom returns room + members for a member", async () => {
    const room = await db.$transaction((tx) => createGroupRoom(tx, U1, "deet", [U2]));
    const got = await getRoom(db, U1, room.id);
    expect(got?.id).toBe(room.id);
    expect(got?.memberships.length).toBe(2);
  });
});
```

- [ ] **Step 2: Run tests — expect failure**

Run: `make test-unit`
Expected: FAIL — `service.js` not found.

- [ ] **Step 3: Implement presence helper (used later)**

Create `packages/api/src/domains/chat/presence.ts`:

```ts
import { PRESENCE_LEAVE_GRACE_MS } from "./constants.js";
import { roomChannel } from "./channels.js";

const rooms = new Map<string, Set<string>>();
const pendingLeave = new Map<string, NodeJS.Timeout>();

function keyOf(roomId: string, userId: string) {
  return `${roomId}:${userId}`;
}

export function presenceList(roomId: string): string[] {
  return Array.from(rooms.get(roomId) ?? []);
}

export function isUserInRoom(roomId: string, userId: string): boolean {
  return rooms.get(roomId)?.has(userId) ?? false;
}

export function presenceEnter(roomId: string, userId: string): void {
  const key = keyOf(roomId, userId);
  const pending = pendingLeave.get(key);
  if (pending) {
    clearTimeout(pending);
    pendingLeave.delete(key);
    return; // cancel the leave; user is effectively already present
  }
  if (!rooms.has(roomId)) rooms.set(roomId, new Set());
  rooms.get(roomId)!.add(userId);
  roomChannel.publish(roomId, "presence:enter", { roomId, userId });
}

export function presenceLeave(roomId: string, userId: string): void {
  const key = keyOf(roomId, userId);
  const t = setTimeout(() => {
    rooms.get(roomId)?.delete(userId);
    pendingLeave.delete(key);
    roomChannel.publish(roomId, "presence:leave", { roomId, userId });
  }, PRESENCE_LEAVE_GRACE_MS);
  pendingLeave.set(key, t);
}
```

- [ ] **Step 4: Implement the room service**

Create `packages/api/src/domains/chat/service.ts`:

```ts
import { Prisma, type PrismaClient } from "@project/db";
import { TRPCError } from "@trpc/server";

type DbClient = PrismaClient | Prisma.TransactionClient;

function dmKeyOf(a: string, b: string): string {
  return [a, b].sort().join(":");
}

export async function requireMembership(
  db: DbClient,
  userId: string,
  roomId: string,
): Promise<void> {
  const m = await db.chatMembership.findUnique({
    where: { roomId_userId: { roomId, userId } },
    select: { roomId: true },
  });
  if (!m) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Not a member of this room" });
  }
}

export async function createGroupRoom(
  tx: Prisma.TransactionClient,
  creatorId: string,
  name: string,
  memberIds: string[],
) {
  if (!memberIds.length) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "At least one member is required" });
  }
  const uniqueMembers = Array.from(new Set([creatorId, ...memberIds]));
  const room = await tx.chatRoom.create({ data: { name } });
  await tx.chatMembership.createMany({
    data: uniqueMembers.map((userId) => ({ roomId: room.id, userId })),
    skipDuplicates: true,
  });
  return room;
}

export async function dmFindOrCreate(
  tx: Prisma.TransactionClient,
  userA: string,
  userB: string,
) {
  if (userA === userB) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot DM yourself" });
  }
  const key = dmKeyOf(userA, userB);
  const existing = await tx.chatRoom.findUnique({ where: { dmKey: key } });
  if (existing) return existing;
  try {
    const room = await tx.chatRoom.create({ data: { dmKey: key } });
    await tx.chatMembership.createMany({
      data: [
        { roomId: room.id, userId: userA },
        { roomId: room.id, userId: userB },
      ],
    });
    return room;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      // Other caller won the race — re-query is guaranteed to find it.
      const r = await tx.chatRoom.findUnique({ where: { dmKey: key } });
      if (!r) throw err;
      return r;
    }
    throw err;
  }
}

export async function inviteToRoom(
  tx: Prisma.TransactionClient,
  callerId: string,
  roomId: string,
  invitedId: string,
) {
  await requireMembership(tx, callerId, roomId);
  await tx.chatMembership.upsert({
    where: { roomId_userId: { roomId, userId: invitedId } },
    update: {},
    create: { roomId, userId: invitedId },
  });
}

export async function leaveRoom(
  tx: Prisma.TransactionClient,
  callerId: string,
  roomId: string,
) {
  await tx.chatMembership.delete({
    where: { roomId_userId: { roomId, userId: callerId } },
  });
}

export async function listMyRooms(db: DbClient, userId: string) {
  const rooms = await db.chatRoom.findMany({
    where: { memberships: { some: { userId } } },
    include: {
      memberships: {
        include: { user: { select: { id: true, username: true, name: true, image: true } } },
      },
      messages: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  const result = await Promise.all(
    rooms.map(async (r) => {
      const myMembership = r.memberships.find((m) => m.userId === userId);
      const lastRead = myMembership?.lastReadAt ?? new Date(0);
      const unreadCount = await db.chatMessage.count({
        where: { roomId: r.id, createdAt: { gt: lastRead } },
      });
      return {
        id: r.id,
        name: r.name,
        dmKey: r.dmKey,
        createdAt: r.createdAt,
        members: r.memberships.map((m) => m.user),
        lastMessageAt: r.messages[0]?.createdAt ?? null,
        unreadCount,
      };
    }),
  );

  result.sort((a, b) => {
    const at = a.lastMessageAt?.getTime() ?? 0;
    const bt = b.lastMessageAt?.getTime() ?? 0;
    return bt - at;
  });
  return result;
}

export async function getRoom(db: DbClient, userId: string, roomId: string) {
  await requireMembership(db, userId, roomId);
  return db.chatRoom.findUnique({
    where: { id: roomId },
    include: {
      memberships: {
        include: { user: { select: { id: true, username: true, name: true, image: true } } },
      },
    },
  });
}
```

- [ ] **Step 5: Run tests — expect PASS on room suite**

Run: `make test-unit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/domains/chat/presence.ts packages/api/src/domains/chat/service.ts packages/api/src/domains/chat/__tests__/service.test.ts
git commit -m "feat(chat): room service (create, DM, invite, leave, list, get)"
```

---

### Task 9: Chat service — messages + markRead

**Files:**
- Modify: `packages/api/src/domains/chat/service.ts` (append)
- Modify: `packages/api/src/domains/chat/__tests__/service.test.ts` (append)

- [ ] **Step 1: Add failing message tests**

Append to `packages/api/src/domains/chat/__tests__/service.test.ts`:

```ts
import {
  listMessages,
  markRead,
  messagesSince,
  sendFileMessage,
  sendTextMessage,
} from "../service.js";

describe("sendTextMessage + listMessages", () => {
  it("persists and returns messages newest-first", async () => {
    const room = await db.$transaction((tx) => createGroupRoom(tx, U1, "m1", [U2]));
    const a = await db.$transaction((tx) => sendTextMessage(tx, U1, room.id, "one"));
    const b = await db.$transaction((tx) => sendTextMessage(tx, U1, room.id, "two"));
    const msgs = await listMessages(db, U1, room.id);
    expect(msgs.map((m) => m.id)).toEqual([b.id, a.id]);
  });

  it("rejects text send from non-member", async () => {
    const room = await db.$transaction((tx) => createGroupRoom(tx, U1, "m2", [U2]));
    await expect(
      db.$transaction((tx) => sendTextMessage(tx, U3, room.id, "hi")),
    ).rejects.toThrow();
  });
});

describe("messagesSince cursor", () => {
  it("returns only messages strictly after the cursor, ASC", async () => {
    const room = await db.$transaction((tx) => createGroupRoom(tx, U1, "m3", [U2]));
    const a = await db.$transaction((tx) => sendTextMessage(tx, U1, room.id, "a"));
    const b = await db.$transaction((tx) => sendTextMessage(tx, U1, room.id, "b"));
    const c = await db.$transaction((tx) => sendTextMessage(tx, U1, room.id, "c"));
    const since = await messagesSince(db, U1, room.id, { createdAt: a.createdAt, id: a.id });
    expect(since.map((m) => m.id)).toEqual([b.id, c.id]);
  });
});

describe("markRead", () => {
  it("updates lastReadAt for the membership", async () => {
    const room = await db.$transaction((tx) => createGroupRoom(tx, U1, "m4", [U2]));
    const m = await db.$transaction((tx) => sendTextMessage(tx, U2, room.id, "hello"));
    await db.$transaction((tx) => markRead(tx, U1, room.id, m.id));
    const updated = await db.chatMembership.findUnique({
      where: { roomId_userId: { roomId: room.id, userId: U1 } },
    });
    expect(updated?.lastReadAt?.getTime()).toBeGreaterThanOrEqual(m.createdAt.getTime());
  });
});
```

- [ ] **Step 2: Run tests — expect failure (functions not found)**

Run: `make test-unit`
Expected: FAIL.

- [ ] **Step 3: Append message implementations to service.ts**

Append to `packages/api/src/domains/chat/service.ts`:

```ts
import { ChatMessageKind } from "@project/db";
import { MESSAGE_PAGE_SIZE } from "./constants.js";
import { roomChannel, userChannel } from "./channels.js";
import { isUserInRoom } from "./presence.js";

type Cursor = { createdAt: Date; id: string };

export async function listMessages(
  db: DbClient,
  userId: string,
  roomId: string,
  beforeCursor?: Cursor,
) {
  await requireMembership(db, userId, roomId);
  const where = beforeCursor
    ? {
        roomId,
        OR: [
          { createdAt: { lt: beforeCursor.createdAt } },
          { createdAt: beforeCursor.createdAt, id: { lt: beforeCursor.id } },
        ],
      }
    : { roomId };
  return db.chatMessage.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: MESSAGE_PAGE_SIZE,
  });
}

export async function messagesSince(
  db: DbClient,
  userId: string,
  roomId: string,
  afterCursor: Cursor,
) {
  await requireMembership(db, userId, roomId);
  return db.chatMessage.findMany({
    where: {
      roomId,
      OR: [
        { createdAt: { gt: afterCursor.createdAt } },
        { createdAt: afterCursor.createdAt, id: { gt: afterCursor.id } },
      ],
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: MESSAGE_PAGE_SIZE * 4,
  });
}

async function nudgeAbsentMembers(
  tx: Prisma.TransactionClient,
  roomId: string,
) {
  const members = await tx.chatMembership.findMany({
    where: { roomId },
    select: { userId: true },
  });
  for (const { userId } of members) {
    if (!isUserInRoom(roomId, userId)) {
      userChannel.publish(userId, "unread:nudge", { roomId });
    }
  }
}

export async function sendTextMessage(
  tx: Prisma.TransactionClient,
  userId: string,
  roomId: string,
  text: string,
) {
  await requireMembership(tx, userId, roomId);
  const msg = await tx.chatMessage.create({
    data: { roomId, userId, kind: ChatMessageKind.TEXT, text },
  });
  // Publish AFTER the transaction commits. Within the tx, the row exists for
  // readers at this REPEATABLE READ snapshot; outside, $transaction wraps
  // BEGIN/COMMIT. We emit here because service is called inside the router's
  // $transaction — subscribers will still see the row once tx closes.
  roomChannel.publish(roomId, "message:new", {
    id: msg.id,
    roomId: msg.roomId,
    userId: msg.userId,
    kind: "TEXT",
    text: msg.text,
    fileId: null,
    createdAt: msg.createdAt,
  });
  await nudgeAbsentMembers(tx, roomId);
  return msg;
}

export async function sendFileMessage(
  tx: Prisma.TransactionClient,
  userId: string,
  roomId: string,
  fileId: string,
) {
  await requireMembership(tx, userId, roomId);
  const file = await tx.chatFile.findUnique({ where: { id: fileId } });
  if (!file || file.uploadedBy !== userId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "File not available" });
  }
  const msg = await tx.chatMessage.create({
    data: { roomId, userId, kind: ChatMessageKind.FILE, fileId },
  });
  roomChannel.publish(roomId, "message:new", {
    id: msg.id,
    roomId: msg.roomId,
    userId: msg.userId,
    kind: "FILE",
    text: null,
    fileId: msg.fileId,
    createdAt: msg.createdAt,
  });
  await nudgeAbsentMembers(tx, roomId);
  return msg;
}

export async function markRead(
  tx: Prisma.TransactionClient,
  userId: string,
  roomId: string,
  _lastSeenMessageId: string,
) {
  await tx.chatMembership.update({
    where: { roomId_userId: { roomId, userId } },
    data: { lastReadAt: new Date() },
  });
}
```

> Note: the second `import { ChatMessageKind } from "@project/db"` plus the
> new imports (`MESSAGE_PAGE_SIZE`, `roomChannel`, `userChannel`,
> `isUserInRoom`) must go at the TOP of `service.ts`. Move them up next to
> the existing imports; keep the file tidy.

- [ ] **Step 4: Run tests**

Run: `make test-unit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/domains/chat/service.ts packages/api/src/domains/chat/__tests__/service.test.ts
git commit -m "feat(chat): message service (send text/file, list, cursor, markRead)"
```

---

### Task 10: Chat router — procedures + subscriptions

**Files:**
- Create: `packages/api/src/domains/chat/router.ts`
- Create: `packages/api/src/domains/chat/__tests__/router.test.ts`
- Modify: `packages/api/src/router.ts`
- Modify: `packages/api/package.json`

- [ ] **Step 1: Write failing router tests**

Create `packages/api/src/domains/chat/__tests__/router.test.ts`:

```ts
import { db } from "@project/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appRouter } from "../../../router.js";
import { createContext } from "../../../context.js";

const U = "chat-router-test-u1";
const U2 = "chat-router-test-u2";

beforeAll(async () => {
  await db.user.deleteMany({ where: { id: { in: [U, U2] } } });
  await db.user.createMany({
    data: [
      { id: U, name: "U", email: "cru1@test.com", username: "cru1", emailVerified: false },
      { id: U2, name: "U2", email: "cru2@test.com", username: "cru2", emailVerified: false },
    ],
  });
});

afterAll(async () => {
  await db.chatMembership.deleteMany({ where: { userId: { in: [U, U2] } } });
  await db.chatRoom.deleteMany({ where: { memberships: { some: { userId: { in: [U, U2] } } } } });
  await db.user.deleteMany({ where: { id: { in: [U, U2] } } });
  await db.$disconnect();
});

function callerFor(userId: string) {
  return appRouter.createCaller(
    // Minimal session shape — protectedProcedure only needs session.user.id.
    ({ db, session: { user: { id: userId } } } as never),
  );
}

describe("chat router — auth", () => {
  it("unauthenticated listMine throws UNAUTHORIZED", async () => {
    const caller = appRouter.createCaller({ db, session: null } as never);
    await expect(caller.chat.rooms.listMine()).rejects.toThrow();
  });
});

describe("chat router — rooms", () => {
  it("createGroup + listMine round-trip", async () => {
    const c = callerFor(U);
    const room = await c.chat.rooms.createGroup({ name: "rt-g", memberIds: [U2] });
    const mine = await c.chat.rooms.listMine();
    expect(mine.some((r) => r.id === room.id)).toBe(true);
  });

  it("dmFindOrCreate is idempotent across callers", async () => {
    const a = await callerFor(U).chat.rooms.dmFindOrCreate({ otherUserId: U2 });
    const b = await callerFor(U2).chat.rooms.dmFindOrCreate({ otherUserId: U });
    expect(a.id).toBe(b.id);
  });
});

describe("chat router — messages", () => {
  it("sendText then list returns the new message", async () => {
    const c = callerFor(U);
    const room = await c.chat.rooms.createGroup({ name: "rt-m", memberIds: [U2] });
    await c.chat.messages.sendText({ roomId: room.id, text: "hi" });
    const msgs = await c.chat.messages.list({ roomId: room.id });
    expect(msgs[0]?.text).toBe("hi");
  });
});
```

- [ ] **Step 2: Run tests — expect failure**

Run: `make test-unit`
Expected: FAIL.

- [ ] **Step 3: Implement the router**

Create `packages/api/src/domains/chat/router.ts`:

```ts
import { z } from "zod";
import { roomChannel, userChannel } from "./channels.js";
import { presenceEnter, presenceLeave, presenceList } from "./presence.js";
import {
  createGroupRoom,
  dmFindOrCreate,
  getRoom,
  inviteToRoom,
  leaveRoom,
  listMessages,
  listMyRooms,
  markRead,
  messagesSince,
  requireMembership,
  sendFileMessage,
  sendTextMessage,
} from "./service.js";
import { protectedProcedure, router } from "../../trpc.js";

const cursorSchema = z.object({ createdAt: z.date(), id: z.string() });

const roomsRouter = router({
  listMine: protectedProcedure.query(({ ctx }) => listMyRooms(ctx.db, ctx.session.user.id)),

  get: protectedProcedure
    .input(z.object({ roomId: z.string() }))
    .query(({ ctx, input }) => getRoom(ctx.db, ctx.session.user.id, input.roomId)),

  createGroup: protectedProcedure
    .input(z.object({ name: z.string().min(1).max(80), memberIds: z.array(z.string()).min(1) }))
    .mutation(({ ctx, input }) =>
      ctx.db.$transaction((tx) =>
        createGroupRoom(tx, ctx.session.user.id, input.name, input.memberIds),
      ),
    ),

  dmFindOrCreate: protectedProcedure
    .input(z.object({ otherUserId: z.string() }))
    .mutation(({ ctx, input }) =>
      ctx.db.$transaction((tx) =>
        dmFindOrCreate(tx, ctx.session.user.id, input.otherUserId),
      ),
    ),

  invite: protectedProcedure
    .input(z.object({ roomId: z.string(), userId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.$transaction((tx) =>
        inviteToRoom(tx, ctx.session.user.id, input.roomId, input.userId),
      );
      userChannel.publish(input.userId, "room:invited", { roomId: input.roomId });
    }),

  leave: protectedProcedure
    .input(z.object({ roomId: z.string() }))
    .mutation(({ ctx, input }) =>
      ctx.db.$transaction((tx) =>
        leaveRoom(tx, ctx.session.user.id, input.roomId),
      ),
    ),
});

const messagesRouter = router({
  list: protectedProcedure
    .input(z.object({ roomId: z.string(), beforeCursor: cursorSchema.optional() }))
    .query(({ ctx, input }) =>
      listMessages(ctx.db, ctx.session.user.id, input.roomId, input.beforeCursor),
    ),

  sinceCursor: protectedProcedure
    .input(z.object({ roomId: z.string(), afterCursor: cursorSchema }))
    .query(({ ctx, input }) =>
      messagesSince(ctx.db, ctx.session.user.id, input.roomId, input.afterCursor),
    ),

  sendText: protectedProcedure
    .input(z.object({ roomId: z.string(), text: z.string().min(1).max(4000) }))
    .mutation(({ ctx, input }) =>
      ctx.db.$transaction((tx) =>
        sendTextMessage(tx, ctx.session.user.id, input.roomId, input.text),
      ),
    ),

  sendFile: protectedProcedure
    .input(z.object({ roomId: z.string(), fileId: z.string() }))
    .mutation(({ ctx, input }) =>
      ctx.db.$transaction((tx) =>
        sendFileMessage(tx, ctx.session.user.id, input.roomId, input.fileId),
      ),
    ),

  markRead: protectedProcedure
    .input(z.object({ roomId: z.string(), lastSeenMessageId: z.string() }))
    .mutation(({ ctx, input }) =>
      ctx.db.$transaction((tx) =>
        markRead(tx, ctx.session.user.id, input.roomId, input.lastSeenMessageId),
      ),
    ),
});

const presenceRouter = router({
  list: protectedProcedure
    .input(z.object({ roomId: z.string() }))
    .query(async ({ ctx, input }) => {
      await requireMembership(ctx.db, ctx.session.user.id, input.roomId);
      return presenceList(input.roomId);
    }),
});

const typingRouter = router({
  start: protectedProcedure
    .input(z.object({ roomId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await requireMembership(ctx.db, ctx.session.user.id, input.roomId);
      roomChannel.publish(input.roomId, "typing:start", {
        roomId: input.roomId,
        userId: ctx.session.user.id,
      });
    }),
  stop: protectedProcedure
    .input(z.object({ roomId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await requireMembership(ctx.db, ctx.session.user.id, input.roomId);
      roomChannel.publish(input.roomId, "typing:stop", {
        roomId: input.roomId,
        userId: ctx.session.user.id,
      });
    }),
});

export const chatRouter = router({
  rooms: roomsRouter,
  messages: messagesRouter,
  presence: presenceRouter,
  typing: typingRouter,

  subscribeRoom: protectedProcedure
    .input(z.object({ roomId: z.string() }))
    .subscription(async function* ({ ctx, input, signal }) {
      await requireMembership(ctx.db, ctx.session.user.id, input.roomId);
      presenceEnter(input.roomId, ctx.session.user.id);
      try {
        for await (const event of roomChannel.subscribe(input.roomId, signal!)) {
          yield event;
        }
      } finally {
        presenceLeave(input.roomId, ctx.session.user.id);
      }
    }),

  subscribeUser: protectedProcedure.subscription(async function* ({ ctx, signal }) {
    for await (const event of userChannel.subscribe(ctx.session.user.id, signal!)) {
      yield event;
    }
  }),
});
```

- [ ] **Step 4: Register chat router (alpha position)**

Edit `packages/api/src/router.ts`:

```ts
import { chatRouter } from "./domains/chat/router.js";
import { todoListRouter } from "./domains/todo-list/router.js";
import { todoRouter } from "./domains/todo/router.js";
import { userRouter } from "./domains/user/router.js";
import { router } from "./trpc.js";

export const appRouter = router({
  chat: chatRouter,
  todo: todoRouter,
  todoList: todoListRouter,
  user: userRouter,
});

export type AppRouter = typeof appRouter;
```

- [ ] **Step 5: Add subpath exports**

In `packages/api/package.json` add:

```json
"./domains/chat/service": { "default": "./src/domains/chat/service.ts" },
"./domains/chat/router":  { "default": "./src/domains/chat/router.ts" },
```

- [ ] **Step 6: Run tests**

Run: `make test-unit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/api/src/domains/chat/router.ts packages/api/src/domains/chat/__tests__/router.test.ts packages/api/src/router.ts packages/api/package.json
git commit -m "feat(chat): router — rooms/messages/presence/typing/subscriptions"
```

---

## Phase 5 — Server Integration

### Task 11: File upload + download Hono endpoints

**Files:**
- Modify: `apps/server/src/index.ts`
- Modify: `apps/server/package.json` (ensure `node:fs` / `node:path` usage — no new deps needed for this task)

- [ ] **Step 1: Gate chat features + add file endpoints**

Edit `apps/server/src/index.ts`. Add these imports at the top (next to existing imports):

```ts
import { createReadStream, mkdirSync, unlink, writeFile } from "node:fs";
import { randomBytes } from "node:crypto";
import { join, resolve } from "node:path";
import { MAX_CHAT_FILE_BYTES } from "@project/api/domains/chat/constants";
```

Then, after the existing todo export handler, add the chat-gated block:

```ts
if (env.ENABLE_CHAT) {
  const FILES_DIR = resolve(process.cwd(), "var/files");
  mkdirSync(FILES_DIR, { recursive: true });

  app.post("/files", async (c) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: "Unauthorized" }, 401);

    const form = await c.req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return c.json({ error: "No file provided" }, 400);
    if (file.size > MAX_CHAT_FILE_BYTES) return c.json({ error: "File too large (max 10 MB)" }, 413);

    const id = `f_${randomBytes(16).toString("hex")}`;
    const path = join(FILES_DIR, id);
    const buf = Buffer.from(await file.arrayBuffer());

    await new Promise<void>((ok, fail) =>
      writeFile(path, buf, (err) => (err ? fail(err) : ok())),
    );

    try {
      const record = await db.chatFile.create({
        data: {
          id,
          storedPath: path,
          filename: file.name || "attachment",
          mimeType: file.type || "application/octet-stream",
          size: file.size,
          uploadedBy: session.user.id,
        },
      });
      return c.json({
        fileId: record.id,
        filename: record.filename,
        size: record.size,
        mimeType: record.mimeType,
      }, 201);
    } catch (err) {
      // Roll back on DB failure
      unlink(path, () => {});
      throw err;
    }
  });

  app.get("/files/:id", async (c) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: "Unauthorized" }, 401);

    const id = c.req.param("id");
    const accessible = await db.chatMessage.findFirst({
      where: {
        fileId: id,
        room: { memberships: { some: { userId: session.user.id } } },
      },
    });
    if (!accessible) return c.json({ error: "Not found" }, 404);

    const file = await db.chatFile.findUnique({ where: { id } });
    if (!file) return c.json({ error: "Not found" }, 404);

    const safeName = (file.filename ?? file.id)
      .replace(/[\r\n"\\]/g, "")
      .trim() || file.id;

    return new Response(createReadStream(file.storedPath) as never, {
      headers: {
        "Content-Type": file.mimeType,
        "Content-Disposition": `attachment; filename="${safeName}"`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `make check`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/index.ts
git commit -m "feat(server): chat file upload/download endpoints (flag-gated)"
```

---

### Task 12: WS server attachment

**Files:**
- Modify: `apps/server/src/index.ts`
- Modify: `apps/server/package.json`

- [ ] **Step 1: Add `ws` dependency**

Run: `pnpm --filter apps/server add ws && pnpm --filter apps/server add -D @types/ws`
Expected: dependencies appended to `apps/server/package.json`.

- [ ] **Step 2: Attach the WS server to the http.Server**

Edit `apps/server/src/index.ts`. Add imports:

```ts
import { applyWSSHandler } from "@trpc/server/adapters/ws";
import { WebSocketServer } from "ws";
import type { IncomingMessage } from "node:http";
import { TRPCError } from "@trpc/server";
```

Replace the existing `serve({...}, ...)` call with:

```ts
const httpServer = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  logger.info(`Server running at http://localhost:${info.port}`);
});

if (env.ENABLE_CHAT) {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (req, socket, head) => {
    const { pathname } = new URL(req.url ?? "/", "http://localhost");
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
    keepAlive: { enabled: true, pingMs: 30_000, pongWaitMs: 5_000 },
  });

  logger.info("WebSocket endpoint: ws://localhost:" + env.PORT + "/trpc-ws");
}

async function wsContext(req: IncomingMessage) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) headers.set(name, value.join(", "));
    else headers.set(name, value);
  }
  const session = await auth.api.getSession({ headers });
  if (!session) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return createContext({ session });
}
```

- [ ] **Step 3: Typecheck**

Run: `make check`
Expected: PASS.

- [ ] **Step 4: Manual smoke (optional for prep)**

Run: `ENABLE_CHAT=true make dev` in one terminal; in another, confirm the server logs the WS endpoint. Curl the health: `curl http://localhost:3001/health` — still OK.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/index.ts apps/server/package.json pnpm-lock.yaml
git commit -m "feat(server): WS server attachment for tRPC subscriptions"
```

---

## Phase 6 — Client Integration

### Task 13: Router splitLink + wsClient

**Files:**
- Modify: `apps/web/src/router.tsx`

- [ ] **Step 1: Add splitLink + wsClient + wsLink**

Replace the tRPC client block in `apps/web/src/router.tsx`:

```tsx
import type { AppRouter } from "@project/api/router";
import { env } from "@project/env/client";
import { QueryClient } from "@tanstack/react-query";
import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import {
  createTRPCClient,
  createWSClient,
  httpBatchLink,
  splitLink,
  wsLink,
} from "@trpc/client";
import { createTRPCOptionsProxy } from "@trpc/tanstack-react-query";
import { apiClient } from "#/shared/api-client";
import { routeTree } from "./routeTree.gen";

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { staleTime: 60 * 1000 } },
  });
}

let browserQueryClient: QueryClient | undefined;
function getQueryClient() {
  if (typeof window === "undefined") return makeQueryClient();
  if (!browserQueryClient) browserQueryClient = makeQueryClient();
  return browserQueryClient;
}

const httpLink = httpBatchLink({
  url: `${apiClient.baseUrl}/trpc`,
  fetch: apiClient.fetch,
});

const wsClientInstance = env.VITE_ENABLE_CHAT
  ? createWSClient({ url: env.VITE_WS_URL })
  : null;

const trpcClient = createTRPCClient<AppRouter>({
  links: wsClientInstance
    ? [
        splitLink({
          condition: (op) => op.type === "subscription",
          true: wsLink({ client: wsClientInstance }),
          false: httpLink,
        }),
      ]
    : [httpLink],
});

export function getRouter() {
  const queryClient = getQueryClient();
  const trpc = createTRPCOptionsProxy<AppRouter>({ client: trpcClient, queryClient });
  const router = createTanStackRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: "intent",
    defaultPendingMs: 200,
    defaultPendingMinMs: 300,
    context: { trpc, queryClient },
  });
  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `make check`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/router.tsx
git commit -m "feat(web): tRPC splitLink + wsClient for subscriptions"
```

---

### Task 14: Chat feature — types, upload helper, hooks

**Files:**
- Create: `apps/web/src/features/chat/types.ts`
- Create: `apps/web/src/features/chat/upload-file.ts`
- Create: `apps/web/src/features/chat/use-chat-rooms.ts`
- Create: `apps/web/src/features/chat/use-live-room.ts`

- [ ] **Step 1: Types**

Create `apps/web/src/features/chat/types.ts`:

```ts
import type { AppRouter } from "@project/api/router";
import type { inferRouterOutputs } from "@trpc/server";

type RouterOutput = inferRouterOutputs<AppRouter>;

export type ChatMessage = RouterOutput["chat"]["messages"]["list"][number];
export type ChatRoomSummary = RouterOutput["chat"]["rooms"]["listMine"][number];
export type UserSearchResult = RouterOutput["user"]["search"][number];
```

- [ ] **Step 2: File upload helper**

Create `apps/web/src/features/chat/upload-file.ts`:

```ts
import { apiClient } from "#/shared/api-client";

export type UploadResult = {
  fileId: string;
  filename: string;
  size: number;
  mimeType: string;
};

export async function uploadFile(file: File): Promise<UploadResult> {
  const form = new FormData();
  form.append("file", file);
  const res = await apiClient.fetch("/files", { method: "POST", body: form });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `Upload failed (${res.status})`);
  }
  return (await res.json()) as UploadResult;
}

export function fileDownloadUrl(fileId: string): string {
  return `${apiClient.baseUrl}/files/${fileId}`;
}
```

- [ ] **Step 3: useChatRooms hook**

Create `apps/web/src/features/chat/use-chat-rooms.ts`:

```ts
import type { AppRouter } from "@project/api/router";
import { type QueryClient, useMutation, useQuery, useSubscription } from "@tanstack/react-query";
import type { TRPCOptionsProxy } from "@trpc/tanstack-react-query";

export function useChatRooms(
  trpc: TRPCOptionsProxy<AppRouter>,
  queryClient: QueryClient,
) {
  const roomsQuery = useQuery(trpc.chat.rooms.listMine.queryOptions());

  // Refresh the sidebar when we get a cross-room event.
  useSubscription({
    ...trpc.chat.subscribeUser.subscriptionOptions(),
    onData: () => {
      queryClient.invalidateQueries(trpc.chat.rooms.listMine.queryFilter());
    },
  });

  const createGroup = useMutation(
    trpc.chat.rooms.createGroup.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries(trpc.chat.rooms.listMine.queryFilter()),
    }),
  );

  const dmFindOrCreate = useMutation(trpc.chat.rooms.dmFindOrCreate.mutationOptions());

  return { roomsQuery, createGroup, dmFindOrCreate };
}
```

- [ ] **Step 4: useLiveRoom hook**

Create `apps/web/src/features/chat/use-live-room.ts`:

```ts
import type { AppRouter } from "@project/api/router";
import { type QueryClient, useMutation, useQuery, useSubscription } from "@tanstack/react-query";
import type { TRPCOptionsProxy } from "@trpc/tanstack-react-query";
import { useEffect, useRef, useState } from "react";
import { TYPING_CLIENT_EXPIRY_MS } from "@project/api/domains/chat/constants";
import type { ChatMessage } from "./types";

type TypingMap = Map<string, number>; // userId -> expiresAt (epoch ms)

export function useLiveRoom(
  trpc: TRPCOptionsProxy<AppRouter>,
  queryClient: QueryClient,
  roomId: string,
) {
  const messagesQuery = useQuery(
    trpc.chat.messages.list.queryOptions({ roomId }),
  );
  const presenceQuery = useQuery(
    trpc.chat.presence.list.queryOptions({ roomId }),
  );

  const [typing, setTyping] = useState<TypingMap>(new Map());
  const lastSeenIdRef = useRef<string | null>(null);

  useSubscription({
    ...trpc.chat.subscribeRoom.subscriptionOptions({ roomId }),
    onData: (ev) => {
      if (ev.type === "message:new") {
        lastSeenIdRef.current = ev.data.id;
        queryClient.setQueryData<ChatMessage[]>(
          trpc.chat.messages.list.queryFilter({ roomId }).queryKey,
          (old) => {
            if (!old) return [ev.data as ChatMessage];
            if (old.some((m) => m.id === ev.data.id)) return old;
            return [ev.data as ChatMessage, ...old];
          },
        );
      } else if (ev.type === "typing:start") {
        setTyping((prev) => {
          const next = new Map(prev);
          next.set(ev.data.userId, Date.now() + TYPING_CLIENT_EXPIRY_MS);
          return next;
        });
      } else if (ev.type === "typing:stop") {
        setTyping((prev) => {
          const next = new Map(prev);
          next.delete(ev.data.userId);
          return next;
        });
      } else if (ev.type === "presence:enter" || ev.type === "presence:leave") {
        queryClient.invalidateQueries(trpc.chat.presence.list.queryFilter({ roomId }));
      }
    },
  });

  // Expire stale typing indicators every second
  useEffect(() => {
    const t = setInterval(() => {
      setTyping((prev) => {
        const now = Date.now();
        let mutated = false;
        const next = new Map(prev);
        for (const [uid, exp] of prev) {
          if (exp <= now) {
            next.delete(uid);
            mutated = true;
          }
        }
        return mutated ? next : prev;
      });
    }, 1000);
    return () => clearInterval(t);
  }, []);

  const sendText = useMutation(trpc.chat.messages.sendText.mutationOptions());
  const sendFile = useMutation(trpc.chat.messages.sendFile.mutationOptions());
  const typingStart = useMutation(trpc.chat.typing.start.mutationOptions());
  const typingStop = useMutation(trpc.chat.typing.stop.mutationOptions());
  const markRead = useMutation(trpc.chat.messages.markRead.mutationOptions());

  return {
    messagesQuery,
    presenceQuery,
    typingUserIds: Array.from(typing.keys()),
    sendText,
    sendFile,
    typingStart,
    typingStop,
    markRead,
    lastSeenId: lastSeenIdRef,
  };
}
```

- [ ] **Step 5: Typecheck**

Run: `make check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/chat/types.ts apps/web/src/features/chat/upload-file.ts apps/web/src/features/chat/use-chat-rooms.ts apps/web/src/features/chat/use-live-room.ts
git commit -m "feat(web): chat hooks + upload helper + types"
```

---

### Task 15: Chat UI components

**Files:**
- Create: `apps/web/src/features/chat/components/MessageList.tsx`
- Create: `apps/web/src/features/chat/components/MessageComposer.tsx`
- Create: `apps/web/src/features/chat/components/RoomListSidebar.tsx`
- Create: `apps/web/src/features/chat/components/UserSearchDialog.tsx`

- [ ] **Step 1: MessageList**

Create `apps/web/src/features/chat/components/MessageList.tsx`:

```tsx
import { fileDownloadUrl } from "../upload-file";
import type { ChatMessage } from "../types";

type Props = {
  messages: ChatMessage[];
  typingUserIds: string[];
};

export function MessageList({ messages, typingUserIds }: Props) {
  const ordered = [...messages].reverse(); // server sends newest-first; UI shows oldest-first
  return (
    <div className="flex flex-col gap-2 overflow-y-auto p-4" aria-label="Messages">
      {ordered.map((m) => (
        <div key={m.id} className="rounded-md border p-2" data-userid={m.userId}>
          <div className="text-xs text-muted-foreground">{m.userId}</div>
          {m.kind === "TEXT" ? (
            <div>{m.text}</div>
          ) : m.fileId ? (
            <a
              className="text-sm underline"
              href={fileDownloadUrl(m.fileId)}
              target="_blank"
              rel="noreferrer"
            >
              Download file
            </a>
          ) : null}
        </div>
      ))}
      {typingUserIds.length > 0 && (
        <div className="text-xs text-muted-foreground">
          {typingUserIds.length === 1
            ? "1 person is typing…"
            : `${typingUserIds.length} people are typing…`}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: MessageComposer**

Create `apps/web/src/features/chat/components/MessageComposer.tsx`:

```tsx
import { Button } from "@project/ui/components/button";
import { Input } from "@project/ui/components/input";
import { useEffect, useRef, useState } from "react";
import { uploadFile } from "../upload-file";
import { TYPING_DEBOUNCE_MS, TYPING_IDLE_STOP_MS } from "@project/api/domains/chat/constants";

type Props = {
  roomId: string;
  onSendText: (text: string) => Promise<unknown>;
  onSendFile: (fileId: string) => Promise<unknown>;
  onTypingStart: () => void;
  onTypingStop: () => void;
};

export function MessageComposer({
  roomId: _roomId,
  onSendText,
  onSendFile,
  onTypingStart,
  onTypingStop,
}: Props) {
  const [text, setText] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastStartRef = useRef<number>(0);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setText(e.target.value);
    const now = Date.now();
    if (now - lastStartRef.current > TYPING_DEBOUNCE_MS) {
      lastStartRef.current = now;
      onTypingStart();
    }
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => {
      onTypingStop();
      lastStartRef.current = 0;
    }, TYPING_IDLE_STOP_MS);
  };

  const handleSend = async () => {
    const v = text.trim();
    if (!v) return;
    setText("");
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    onTypingStop();
    await onSendText(v);
  };

  const handleAttach = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const { fileId } = await uploadFile(file);
      await onSendFile(fileId);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void handleSend();
      }}
      className="flex items-center gap-2 border-t p-2"
    >
      <Input
        aria-label="Message"
        value={text}
        onChange={handleChange}
        placeholder="Type a message…"
      />
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={handleAttach}
        aria-label="Attach file"
      />
      <Button
        type="button"
        variant="outline"
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading}
      >
        {uploading ? "Uploading…" : "Attach"}
      </Button>
      <Button type="submit" disabled={!text.trim()}>
        Send
      </Button>
    </form>
  );
}
```

- [ ] **Step 3: RoomListSidebar**

Create `apps/web/src/features/chat/components/RoomListSidebar.tsx`:

```tsx
import { Link } from "@tanstack/react-router";
import type { ChatRoomSummary } from "../types";

type Props = {
  rooms: ChatRoomSummary[];
  currentUserId: string;
  onStartDm: () => void;
};

function roomDisplayName(r: ChatRoomSummary, currentUserId: string) {
  if (r.name) return r.name;
  const others = r.members.filter((m) => m.id !== currentUserId);
  if (others.length === 1) return others[0].name ?? others[0].username ?? "DM";
  return others.map((o) => o.name ?? o.username ?? "?").join(", ");
}

export function RoomListSidebar({ rooms, currentUserId, onStartDm }: Props) {
  return (
    <aside className="flex w-64 flex-col border-r">
      <div className="flex items-center justify-between p-2">
        <h2 className="text-sm font-medium">Conversations</h2>
        <button
          type="button"
          onClick={onStartDm}
          className="text-sm underline"
        >
          New DM
        </button>
      </div>
      <nav className="flex-1 overflow-y-auto">
        {rooms.length === 0 && (
          <p className="p-4 text-sm text-muted-foreground">No conversations yet</p>
        )}
        {rooms.map((r) => (
          <Link
            key={r.id}
            to={"/chat/$roomId" as string}
            params={{ roomId: r.id }}
            className="block border-b p-2 hover:bg-muted"
            activeProps={{ className: "bg-muted" }}
          >
            <div className="text-sm font-medium">{roomDisplayName(r, currentUserId)}</div>
            {r.unreadCount > 0 && (
              <div className="text-xs text-primary">{r.unreadCount} new</div>
            )}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
```

- [ ] **Step 4: UserSearchDialog**

Create `apps/web/src/features/chat/components/UserSearchDialog.tsx`:

```tsx
import type { AppRouter } from "@project/api/router";
import { Button } from "@project/ui/components/button";
import { Input } from "@project/ui/components/input";
import { useQuery } from "@tanstack/react-query";
import type { TRPCOptionsProxy } from "@trpc/tanstack-react-query";
import { useEffect, useState } from "react";
import type { UserSearchResult } from "../types";

type Props = {
  trpc: TRPCOptionsProxy<AppRouter>;
  open: boolean;
  onClose: () => void;
  onPick: (user: UserSearchResult) => void;
};

export function UserSearchDialog({ trpc, open, onClose, onPick }: Props) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 200);
    return () => clearTimeout(t);
  }, [query]);

  const searchQuery = useQuery({
    ...trpc.user.search.queryOptions({ query: debounced }),
    enabled: open && debounced.length >= 2,
  });

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-label="Find user"
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-8"
      onClick={onClose}
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      <div
        className="w-full max-w-md rounded-md border bg-background p-4"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <Input
          autoFocus
          placeholder="Search by username or name…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search users"
        />
        <ul className="mt-3 max-h-72 overflow-y-auto">
          {searchQuery.data?.map((u) => (
            <li key={u.userId}>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded p-2 text-left hover:bg-muted"
                onClick={() => onPick(u)}
              >
                <span className="text-sm font-medium">{u.name}</span>
                <span className="text-xs text-muted-foreground">@{u.username ?? "—"}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex justify-end">
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Typecheck**

Run: `make check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/chat/components
git commit -m "feat(web): chat UI components (list, composer, sidebar, search)"
```

---

### Task 16: Chat routes

**Files:**
- Create: `apps/web/src/routes/_authenticated/chat/index.tsx`
- Create: `apps/web/src/routes/_authenticated/chat/$roomId.tsx`

- [ ] **Step 1: Chat index route (sidebar + empty-state)**

Create `apps/web/src/routes/_authenticated/chat/index.tsx`:

```tsx
import { env } from "@project/env/client";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useSession } from "#/features/auth/auth-client";
import { RoomListSidebar } from "#/features/chat/components/RoomListSidebar";
import { UserSearchDialog } from "#/features/chat/components/UserSearchDialog";
import { useChatRooms } from "#/features/chat/use-chat-rooms";

export const Route = createFileRoute("/_authenticated/chat/")({
  component: ChatIndexPage,
});

function ChatIndexPage() {
  const navigate = useNavigate();
  const { trpc } = Route.useRouteContext();
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const [search, setSearch] = useState(false);

  useEffect(() => {
    if (!env.VITE_ENABLE_CHAT) navigate({ to: "/dashboard" });
  }, [navigate]);

  const { roomsQuery, dmFindOrCreate } = useChatRooms(trpc, queryClient);

  if (!env.VITE_ENABLE_CHAT) return null;
  if (!session) return null;

  return (
    <main className="flex h-[calc(100vh-4rem)]">
      <RoomListSidebar
        rooms={roomsQuery.data ?? []}
        currentUserId={session.user.id}
        onStartDm={() => setSearch(true)}
      />
      <section className="flex flex-1 items-center justify-center text-muted-foreground">
        Pick a conversation or start a new DM.
      </section>
      <UserSearchDialog
        trpc={trpc}
        open={search}
        onClose={() => setSearch(false)}
        onPick={async (u) => {
          const { id } = await dmFindOrCreate.mutateAsync({ otherUserId: u.userId });
          setSearch(false);
          navigate({ to: "/chat/$roomId" as string, params: { roomId: id } });
        }}
      />
    </main>
  );
}
```

- [ ] **Step 2: Room detail route**

Create `apps/web/src/routes/_authenticated/chat/$roomId.tsx`:

```tsx
import { env } from "@project/env/client";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useSession } from "#/features/auth/auth-client";
import { MessageComposer } from "#/features/chat/components/MessageComposer";
import { MessageList } from "#/features/chat/components/MessageList";
import { RoomListSidebar } from "#/features/chat/components/RoomListSidebar";
import { UserSearchDialog } from "#/features/chat/components/UserSearchDialog";
import { useChatRooms } from "#/features/chat/use-chat-rooms";
import { useLiveRoom } from "#/features/chat/use-live-room";

export const Route = createFileRoute("/_authenticated/chat/$roomId")({
  component: ChatRoomPage,
});

function ChatRoomPage() {
  const navigate = useNavigate();
  const { roomId } = Route.useParams();
  const { trpc } = Route.useRouteContext();
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const [search, setSearch] = useState(false);

  useEffect(() => {
    if (!env.VITE_ENABLE_CHAT) navigate({ to: "/dashboard" });
  }, [navigate]);

  const { roomsQuery, dmFindOrCreate } = useChatRooms(trpc, queryClient);
  const live = useLiveRoom(trpc, queryClient, roomId);

  if (!env.VITE_ENABLE_CHAT) return null;
  if (!session) return null;

  return (
    <main className="flex h-[calc(100vh-4rem)]">
      <RoomListSidebar
        rooms={roomsQuery.data ?? []}
        currentUserId={session.user.id}
        onStartDm={() => setSearch(true)}
      />
      <section className="flex flex-1 flex-col">
        <MessageList
          messages={live.messagesQuery.data ?? []}
          typingUserIds={live.typingUserIds}
        />
        <MessageComposer
          roomId={roomId}
          onSendText={(text) => live.sendText.mutateAsync({ roomId, text })}
          onSendFile={(fileId) => live.sendFile.mutateAsync({ roomId, fileId })}
          onTypingStart={() => live.typingStart.mutate({ roomId })}
          onTypingStop={() => live.typingStop.mutate({ roomId })}
        />
      </section>
      <UserSearchDialog
        trpc={trpc}
        open={search}
        onClose={() => setSearch(false)}
        onPick={async (u) => {
          const { id } = await dmFindOrCreate.mutateAsync({ otherUserId: u.userId });
          setSearch(false);
          navigate({ to: "/chat/$roomId" as string, params: { roomId: id } });
        }}
      />
    </main>
  );
}
```

- [ ] **Step 3: Regenerate route tree**

Run: `make routes`
Expected: "Route tree generated".

- [ ] **Step 4: Typecheck**

Run: `make check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/routes/_authenticated/chat apps/web/src/routeTree.gen.ts
git commit -m "feat(web): chat routes (/chat + /chat/\$roomId)"
```

---

## Phase 7 — Seed + Tighten Schema

### Task 17: Seed usernames + sample chat + tighten User.username to non-null

**Files:**
- Modify: `scripts/seed.ts`
- Modify: `packages/db/prisma/schema/auth.prisma`
- Modify: `packages/auth/src/index.ts`

- [ ] **Step 1: Update seed to create two demo users with usernames + a sample DM**

Replace `scripts/seed.ts` with:

```ts
import { auth } from "@project/auth";
import { db } from "@project/db";
import { SEED_USER } from "../e2e/fixtures/credentials.ts";

const SECOND_USER = { email: "demo2@example.com", password: SEED_USER.password, name: "Demo Two", username: "demo2" };
const FIRST_USERNAME = "demo1";

async function signUp(body: { email: string; password: string; name: string; username: string }) {
  await auth.api.signUpEmail({ body });
}

async function backfillUsernames() {
  const missing = await db.user.findMany({ where: { username: null }, select: { id: true, email: true } });
  for (const u of missing) {
    const base = (u.email.split("@")[0] || "user").toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 20).padEnd(3, "_");
    let candidate = base;
    let i = 0;
    // Retry on unique collision; fall back to hash suffix after a few tries.
    while (true) {
      try {
        await db.user.update({ where: { id: u.id }, data: { username: candidate } });
        break;
      } catch {
        i += 1;
        candidate = `${base.slice(0, 16)}_${i}`;
        if (i > 5) {
          candidate = `${base.slice(0, 12)}_${Math.random().toString(36).slice(2, 8)}`;
        }
      }
    }
  }
}

async function main() {
  console.log("Seeding database…");
  await backfillUsernames();

  const existing = await db.user.findFirst({ where: { email: SEED_USER.email } });
  if (!existing) {
    await signUp({ email: SEED_USER.email, password: SEED_USER.password, name: "Demo User", username: FIRST_USERNAME });
    console.log(`Created user: ${SEED_USER.email} (@${FIRST_USERNAME})`);
  } else {
    if (!existing.username) {
      await db.user.update({ where: { id: existing.id }, data: { username: FIRST_USERNAME } });
    }
  }

  const other = await db.user.findFirst({ where: { email: SECOND_USER.email } });
  if (!other) {
    await signUp(SECOND_USER);
    console.log(`Created user: ${SECOND_USER.email} (@${SECOND_USER.username})`);
  }

  // Sample todos (only if first time)
  const u1 = await db.user.findFirst({ where: { email: SEED_USER.email } });
  if (u1) {
    const todoCount = await db.todo.count({ where: { userId: u1.id } });
    if (todoCount === 0) {
      await db.todo.createMany({
        data: [
          { title: "Set up the project", completed: true, position: 0, userId: u1.id },
          { title: "Add authentication", completed: true, position: 1, userId: u1.id },
          { title: "Build the dashboard", completed: false, position: 0, userId: u1.id },
          { title: "Write BDD tests", completed: false, position: 1, userId: u1.id },
          { title: "Deploy to production", completed: false, position: 2, userId: u1.id },
        ],
      });
      console.log("Created 5 sample todos");
    }
  }

  console.log("\nDemo credentials:");
  console.log(`  ${SEED_USER.email} / ${SEED_USER.password}  (@${FIRST_USERNAME})`);
  console.log(`  ${SECOND_USER.email} / ${SECOND_USER.password}  (@${SECOND_USER.username})`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
```

- [ ] **Step 2: Run seed (backfills existing rows)**

Run: `make db-seed`
Expected: "Seeding database…" followed by demo credentials.

- [ ] **Step 3: Tighten User.username to non-null**

Edit `packages/db/prisma/schema/auth.prisma` — change:

```prisma
username      String?   @unique
```

to:

```prisma
username      String    @unique
```

- [ ] **Step 4: Flip Better-Auth additionalFields required to true**

Edit `packages/auth/src/index.ts`:

```ts
username: {
  type: "string",
  required: true,
  input: true,
},
```

- [ ] **Step 5: Push schema**

Run: `make db-push`
Expected: PASS (all rows now have non-null usernames).

- [ ] **Step 6: Typecheck + unit tests**

Run: `make check && make test-unit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add scripts/seed.ts packages/db/prisma/schema/auth.prisma packages/auth/src/index.ts
git commit -m "chore(seed): backfill usernames + tighten to non-null"
```

---

## Phase 8 — BDD

### Task 18: Multi-user fixture + feature + steps

**Files:**
- Create: `e2e/fixtures/multi-user.ts`
- Create: `e2e/features/chat.feature`
- Create: `e2e/steps/chat.ts`

- [ ] **Step 1: Create multi-user fixture**

Create `e2e/fixtures/multi-user.ts`:

```ts
import { test as base, type Browser, type Page } from "@playwright/test";

type MultiUserFixtures = {
  pages: Map<string, Page>;
};

export const test = base.extend<MultiUserFixtures>({
  pages: async ({ browser }, use) => {
    const pages = new Map<string, Page>();
    await use(pages);
    for (const page of pages.values()) {
      await page.context().close().catch(() => {});
    }
  },
});

export async function pageFor(
  browser: Browser,
  pages: Map<string, Page>,
  name: string,
): Promise<Page> {
  let page = pages.get(name);
  if (!page) {
    const context = await browser.newContext();
    page = await context.newPage();
    pages.set(name, page);
  }
  return page;
}
```

- [ ] **Step 2: Write the Gherkin scenario**

Create `e2e/features/chat.feature`:

```gherkin
Feature: Real-time Chat

  Scenario: Two users exchange messages live in a DM
    Given Alice and Bob are signed up
    And Alice has started a DM with Bob
    And Bob is viewing the DM with Alice
    When Alice sends "hello from alice" in the DM
    Then Bob sees "hello from alice" in the DM within 3 seconds
    When Bob sends "hi back from bob" in the DM
    Then Alice sees "hi back from bob" in the DM within 3 seconds
```

The "Bob is viewing…" precondition is load-bearing — it guarantees Bob's
WS subscription is open before Alice sends, so the `Then` assertion
actually tests live delivery (not just persistence + later navigation).

- [ ] **Step 3: Step definitions**

Create `e2e/steps/chat.ts`:

```ts
import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import { SHARED_PASSWORD } from "../fixtures/credentials.ts";
import { pageFor, test } from "../fixtures/multi-user.ts";

const { Given: given, When: when, Then: then } = createBdd(test);

const EMAIL = (name: string) => `${name.toLowerCase()}-chat@example.com`;
const USERNAME = (name: string) => name.toLowerCase().padEnd(3, "_");

async function signUp(page: Parameters<typeof pageFor>[2] extends never ? never : import("@playwright/test").Page, name: string) {
  const email = EMAIL(name);
  await page.goto("/login");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Sign Up" }).click();
  await page.getByLabel("Username").fill(USERNAME(name));
  await page.getByLabel("Display Name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(SHARED_PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/\/dashboard/, { timeout: 10_000 });
}

given("{word} and {word} are signed up", async ({ browser, pages }, a: string, b: string) => {
  const alice = await pageFor(browser, pages, a);
  const bob = await pageFor(browser, pages, b);
  await signUp(alice, a);
  await signUp(bob, b);
});

given("{word} has started a DM with {word}", async ({ browser, pages }, a: string, b: string) => {
  const alice = await pageFor(browser, pages, a);
  await alice.goto("/chat");
  await alice.waitForLoadState("networkidle");
  await alice.getByRole("button", { name: "New DM" }).click();
  await alice.getByLabel("Search users").fill(USERNAME(b));
  await alice
    .getByRole("button", { name: new RegExp(USERNAME(b)) })
    .first()
    .click();
  await expect(alice).toHaveURL(/\/chat\/[^/]+$/);
});

given("{word} is viewing the DM with {word}", async ({ browser, pages }, viewer: string, _other: string) => {
  const page = await pageFor(browser, pages, viewer);
  await page.goto("/chat");
  await page.waitForLoadState("networkidle");
  // Wait for the sidebar to populate — the cross-room subscription fires on
  // the invite/nudge and invalidates the room list. Up to 5s.
  const firstRoom = page.locator("nav a").first();
  await firstRoom.waitFor({ state: "visible", timeout: 5_000 });
  await firstRoom.click();
  await expect(page).toHaveURL(/\/chat\/[^/]+$/);
  // Compose input presence = the live subscription mount is in-flight.
  await page.getByRole("textbox", { name: "Message" }).waitFor({ state: "visible" });
});

when("{word} sends {string} in the DM", async ({ browser, pages }, name: string, text: string) => {
  const page = await pageFor(browser, pages, name);
  await page.getByRole("textbox", { name: "Message" }).fill(text);
  await page.getByRole("button", { name: "Send" }).click();
});

then("{word} sees {string} in the DM within {int} seconds", async ({ browser, pages }, name: string, text: string, seconds: number) => {
  const page = await pageFor(browser, pages, name);
  await page.getByText(text).waitFor({ state: "visible", timeout: seconds * 1000 });
});
```

- [ ] **Step 4: Ensure web app dev uses chat enabled**

Open `e2e/playwright.config.ts` and confirm web & server are started with `VITE_ENABLE_CHAT=true` and `ENABLE_CHAT=true`. If not, add env overrides to the `webServer` entries. (If the config does not yet accept env flags, set them at the top of the file using the `webServer` field's `env:` sub-object.)

- [ ] **Step 5: Generate BDD tests**

Run: `cd e2e && pnpm exec bddgen && cd ..`
Expected: files appear under `e2e/.features-gen/`.

- [ ] **Step 6: Run the chat scenario**

Run: `make test ARGS="--grep 'Real-time Chat' --project desktop"`
Expected: PASS.

> If it fails, typical causes: (a) `VITE_ENABLE_CHAT=true` missing on the web
> server; (b) WS connection blocked by CSP — confirm `connectSrc` allows
> `ws:` from frontend origin; (c) the UserSearchDialog button selector.
> Debug with `--headed --grep 'Real-time Chat'`.

- [ ] **Step 7: Commit**

```bash
git add e2e/fixtures/multi-user.ts e2e/features/chat.feature e2e/steps/chat.ts e2e/playwright.config.ts
git commit -m "test(e2e): multi-user DM chat scenario"
```

---

## Phase 9 — Agent Skill

### Task 19: `docs/skills/add-realtime.md`

**Files:**
- Create: `docs/skills/add-realtime.md`

- [ ] **Step 1: Write the skill**

Create `docs/skills/add-realtime.md`:

````markdown
---
name: add-realtime
description: Retrofit real-time updates (typed WS subscriptions, React Query cache merge) onto an existing tRPC feature in this repo.
---

# Add Real-Time Updates to a tRPC Feature

Use this when a feature has a working tRPC query/mutation pair and needs live updates across connected clients (e.g., "other users see my changes immediately").

**Reference implementation:** `docs/superpowers/specs/2026-04-18-realtime-chat-reference-design.md`. Chat domain code is the canonical example.

## Precondition

WebSocket server already attached to Hono (Task 12 of the chat plan). If not, enable `ENABLE_CHAT=true` or replicate the WS attachment — it's generic.

## Steps

1. **Define a typed channel** in `packages/api/src/domains/<feature>/channels.ts` using `defineChannel` from `@project/api/realtime/channel`. Keyed by the entity id (e.g., `todoListId`); events are whatever mutations produce.
2. **Publish after commit** in service mutations:
   ```ts
   const updated = await tx.todo.update({ ... });
   featureChannel.publish(listId, "todo:updated", updated);
   return updated;
   ```
3. **Add a subscription procedure** to the router:
   ```ts
   subscribe: protectedProcedure
     .input(z.object({ listId: z.string() }))
     .subscription(async function* ({ ctx, input, signal }) {
       await requireMembership(ctx.db, ctx.session.user.id, input.listId);
       for await (const ev of featureChannel.subscribe(input.listId, signal!)) yield ev;
     }),
   ```
   **Always `requireMembership` before yielding** — subscriptions are the sneakiest authz hole.
4. **Client hook** — pair `useQuery(list)` with `useSubscription(subscribe)`. On each event, call `queryClient.setQueryData` with explicit typing to merge in-place. See `apps/web/src/features/chat/use-live-room.ts`.
5. **BDD** — use the multi-user fixture at `e2e/fixtures/multi-user.ts`. One happy-path scenario proves the pipe end-to-end.

## Pitfalls

- **No Node-to-Node WS integration tests.** BDD covers it. See `docs/testing-guidelines.md`.
- **Feature flag.** If the reference chat was your only WS consumer, gate your new feature behind its own env flag too so it can ship disabled.
- **`setQueryData` typing.** tRPC's callback type inference breaks — define explicit types. See `apps/web/CLAUDE.md` "Optimistic Updates" for the workaround.
- **Presence state lives in the domain**, not in `realtime/`. `realtime/` is transport only. Copy the pattern from `packages/api/src/domains/chat/presence.ts` if you need presence.

## When this skill does NOT apply

- Anything multi-instance. In-process EventEmitter is single-node. Needs Redis pub/sub swap in `realtime/`.
- High-frequency streams (cursors, game state). This pattern is latency-tolerant; >20 events/sec will show GC churn.
- Binary protocols. tRPC WS is JSON over text frames.
````

- [ ] **Step 2: Commit**

```bash
git add docs/skills/add-realtime.md
git commit -m "docs: add 'add-realtime' agent skill"
```

---

## Final Verification

- [ ] Run the full quality gate

  Run: `make lint && make test-unit && make test`
  Expected: ALL PASS. If `make test` lacks `ENABLE_CHAT=true` in the web/server fixtures, fix that in `e2e/playwright.config.ts` (Task 18, Step 4).

- [ ] Manual smoke check

  Run: `ENABLE_CHAT=true VITE_ENABLE_CHAT=true make dev`
  Sign in as two different users in two browsers. Start a DM. Send messages back and forth. Attach a file. Close one tab, send, reopen → gap-fills. Presence enters/leaves as tabs open/close.

- [ ] **Commit the plan completion marker (optional)**

  ```bash
  git commit --allow-empty -m "chore: complete real-time chat reference implementation"
  ```

---

## Plan Self-Review

- **Spec coverage:** Every Deliverable (1–19) in the spec maps to a task. Deliverables 15, 17, 18, 19 (testing-guidelines, CLAUDE.md pointer, TODO.md, superseded banner) were already completed before this plan.
- **Placeholders:** None — all code blocks are complete; all commands have expected output.
- **Type consistency:** Service exports match router imports (`createGroupRoom`, `dmFindOrCreate`, etc.); hook return types match component prop types; `ChatMessage` is derived from `RouterOutput` so it stays in sync.
- **Order of operations:** Schema → env → auth (nullable username) → realtime primitive → user domain → chat domain → server WS + files → client → BDD → seed/tighten. Username is intentionally nullable through Phases 1–6 so existing dev DBs survive the push; Task 17 backfills and tightens.
