# Plan C: Realtime + Todo Collaborators + UI

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the hero feature — Alice invites Bob to a TodoList by username, both see edits in real time, removing Bob cuts his access mid-session. Along the way, establish `@project/realtime` (RedisChannel production + MemoryChannel test fixture), tRPC subscriptions over WS, `useOptimisticMutation`, `useLeaderTab`, and the `expire-invites` cron.

**Architecture:** `@project/realtime` exposes a `Channel<T>` interface. Production path uses Redis pub/sub; `MemoryChannel` is a test fixture that the same contract tests drive. Services publish events via a channel factory injected at call time (tests inject `MemoryChannel`, prod resolves to `RedisChannel`). tRPC subscriptions are mounted at `ws://host/trpc-ws` using `@hono/node-ws`. Frontend: one leader tab per user holds the WS; peer tabs receive events via `BroadcastChannel`. Optimistic mutations wrap tRPC's `useMutation` with rollback + toast. Invites: a `TodoListInvite` row carries a token + `invitedUserId`; the invite email (from Plan A's `@project/email`) links to an accept endpoint; nightly cron deletes rows 30+ days past `expiresAt`.

**Tech Stack:** @trpc/server/adapters/ws, @hono/node-ws, ws, ioredis pub/sub, BroadcastChannel, @dnd-kit-less optimistic UI patterns (follow `apps/web/CLAUDE.md`).

**Spec:** `docs/superpowers/specs/2026-04-19-template-reference-implementation-design.md`

**Depends on:** Plan A (jobs + email + Redis) and Plan B (authz + User.username) complete.

---

### Task 1: Create `@project/realtime` package skeleton

**Files:**
- Create: `packages/realtime/package.json`
- Create: `packages/realtime/tsconfig.json`
- Create: `packages/realtime/src/types.ts`
- Create: `packages/realtime/src/memory-channel.ts`

- [ ] **Step 1: Create `packages/realtime/package.json`**

```json
{
  "name": "@project/realtime",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    "./channel": {
      "default": "./src/channel.ts"
    },
    "./memory": {
      "default": "./src/memory-channel.ts"
    },
    "./types": {
      "default": "./src/types.ts"
    }
  },
  "dependencies": {
    "@project/env": "workspace:*",
    "ioredis": "catalog:"
  },
  "devDependencies": {
    "@types/node": "catalog:",
    "typescript": "catalog:"
  }
}
```

- [ ] **Step 2: Create `packages/realtime/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src"]
}
```

- [ ] **Step 3: Create `packages/realtime/src/types.ts`**

```ts
// Channel contract. Both RedisChannel and MemoryChannel satisfy this.
// Events are JSON-serializable application payloads — the transport
// handles encoding. Consumers define their own event union per domain.

export type Unsubscribe = () => void;

export interface Channel<TEvent> {
  publish(event: TEvent): Promise<void>;
  subscribe(handler: (event: TEvent) => void): Promise<Unsubscribe>;
}

export interface ChannelFactory {
  channel<TEvent>(key: string): Channel<TEvent>;
  closeAll(): Promise<void>;
}
```

- [ ] **Step 4: Create `packages/realtime/src/memory-channel.ts`**

```ts
// In-memory Channel implementation. Used by:
//   - service-layer unit tests (no Docker needed)
//   - as reference code for agents learning the abstraction
//
// Not runtime-selectable in app code — do not import this from apps/*.
// Tests inject it directly via the service layer's DI seam.

import type { Channel, ChannelFactory, Unsubscribe } from "./types.js";

type Handler<T> = (event: T) => void;

class MemoryChannelImpl<T> implements Channel<T> {
  private handlers = new Set<Handler<T>>();

  async publish(event: T): Promise<void> {
    for (const h of this.handlers) {
      try {
        h(event);
      } catch (err) {
        console.error("[memory-channel] handler threw:", err);
      }
    }
  }

  async subscribe(handler: Handler<T>): Promise<Unsubscribe> {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }
}

export class MemoryChannelFactory implements ChannelFactory {
  // biome-ignore lint/suspicious/noExplicitAny: factory is generic over channel event types
  private channels = new Map<string, MemoryChannelImpl<any>>();

  channel<TEvent>(key: string): Channel<TEvent> {
    let existing = this.channels.get(key);
    if (!existing) {
      existing = new MemoryChannelImpl<TEvent>();
      this.channels.set(key, existing);
    }
    return existing as Channel<TEvent>;
  }

  async closeAll(): Promise<void> {
    this.channels.clear();
  }
}
```

- [ ] **Step 5: Install + lint**

```bash
pnpm install
make lint
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/realtime/ pnpm-lock.yaml
git commit -m "feat(realtime): Channel interface + MemoryChannel implementation"
```

---

### Task 2: `RedisChannel` implementation + `channel` factory

**Files:**
- Create: `packages/realtime/src/redis-channel.ts`
- Create: `packages/realtime/src/channel.ts`

- [ ] **Step 1: Create `packages/realtime/src/redis-channel.ts`**

```ts
// Production Channel implementation backed by Redis pub/sub.
//
// Each Channel<T> owns:
//   - one publisher (shared across channels from the factory — publishing
//     only needs one command connection)
//   - one subscriber (Redis requires subscriber connections be dedicated —
//     you cannot run regular commands on a SUBSCRIBE'd connection)
//
// CONCURRENCY NOTE: subscriber initialization must be race-safe. Two
// near-simultaneous subscribe() callers would both see `this.subscriber`
// as null, both call `new Redis()`, and only one of the two assignments
// would win — leaking a dangling subscriber. We guard with a Promise
// captured synchronously before the first await so concurrent callers
// share the same init promise.

import { env } from "@project/env/server";
import { Redis } from "ioredis";
import type { Channel, ChannelFactory, Unsubscribe } from "./types.js";

type Handler<T> = (event: T) => void;

class RedisChannelImpl<T> implements Channel<T> {
  private handlers = new Set<Handler<T>>();
  // Promise resolves once the subscriber exists AND has finished SUBSCRIBE.
  // Set synchronously in the first subscribe() call; all later callers
  // await the same promise.
  private subscriberReady: Promise<Redis> | null = null;

  constructor(
    private readonly key: string,
    private readonly publisher: Redis,
  ) {}

  async publish(event: T): Promise<void> {
    await this.publisher.publish(this.key, JSON.stringify(event));
  }

  async subscribe(handler: Handler<T>): Promise<Unsubscribe> {
    if (!this.subscriberReady) {
      this.subscriberReady = this.initSubscriber();
    }
    await this.subscriberReady;
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
      // Keep subscriber alive for fast re-subscribe; closeAll() drains.
    };
  }

  private async initSubscriber(): Promise<Redis> {
    const sub = new Redis(env.REDIS_URL);
    sub.on("message", (_channel, payload) => {
      let event: T;
      try {
        event = JSON.parse(payload) as T;
      } catch (err) {
        console.error(
          `[redis-channel:${this.key}] invalid JSON payload:`,
          err,
        );
        return;
      }
      // Snapshot handlers before iterating — a handler may call
      // unsubscribe() mid-iteration and mutate the Set.
      for (const h of [...this.handlers]) {
        try {
          h(event);
        } catch (err) {
          console.error(
            `[redis-channel:${this.key}] handler threw:`,
            err,
          );
        }
      }
    });
    await sub.subscribe(this.key);
    return sub;
  }

  async close(): Promise<void> {
    this.handlers.clear();
    const ready = this.subscriberReady;
    this.subscriberReady = null;
    if (ready) {
      const sub = await ready;
      await sub.quit();
    }
  }
}

export class RedisChannelFactory implements ChannelFactory {
  private publisher: Redis;
  // biome-ignore lint/suspicious/noExplicitAny: factory is generic over channel event types
  private channels = new Map<string, RedisChannelImpl<any>>();

  constructor() {
    this.publisher = new Redis(env.REDIS_URL);
  }

  channel<TEvent>(key: string): Channel<TEvent> {
    let existing = this.channels.get(key);
    if (!existing) {
      existing = new RedisChannelImpl<TEvent>(key, this.publisher);
      this.channels.set(key, existing);
    }
    return existing as Channel<TEvent>;
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.channels.values()].map((c) => c.close()));
    this.channels.clear();
    await this.publisher.quit();
  }
}
```

- [ ] **Step 2: Create `packages/realtime/src/channel.ts`**

```ts
// Production default factory — one process-wide RedisChannelFactory.
// App code calls channel<T>(key); tests bypass this and construct
// MemoryChannelFactory directly.

import { RedisChannelFactory } from "./redis-channel.js";
import type { Channel } from "./types.js";

let defaultFactory: RedisChannelFactory | null = null;

function factory(): RedisChannelFactory {
  if (!defaultFactory) defaultFactory = new RedisChannelFactory();
  return defaultFactory;
}

export function channel<TEvent>(key: string): Channel<TEvent> {
  return factory().channel<TEvent>(key);
}

export async function closeAllChannels(): Promise<void> {
  await defaultFactory?.closeAll();
  defaultFactory = null;
}
```

- [ ] **Step 3: Lint**

```bash
make lint
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/realtime/src/
git commit -m "feat(realtime): RedisChannel implementation + default channel() factory"
```

---

### Task 3: Contract tests — both implementations satisfy the same suite

**Files:**
- Create: `packages/realtime/__tests__/contract.test.ts`
- Modify: `packages/realtime/package.json` (add `test` script)

- [ ] **Step 1: Add test script**

Extend `packages/realtime/package.json`:

```json
"scripts": {
  "test": "bun test"
}
```

Add `devDependencies`:

```json
"@types/bun": "^1.3.0"
```

- [ ] **Step 2: Write the contract test suite**

Create `packages/realtime/__tests__/contract.test.ts`:

```ts
import { afterAll, describe, expect, it } from "bun:test";
import { MemoryChannelFactory } from "../src/memory-channel.js";
import { RedisChannelFactory } from "../src/redis-channel.js";
import type { ChannelFactory } from "../src/types.js";

type TestEvent = { kind: "created"; id: string };

async function runContract(
  name: string,
  makeFactory: () => ChannelFactory,
) {
  describe(`${name} — Channel contract`, () => {
    const factory = makeFactory();
    afterAll(async () => {
      await factory.closeAll();
    });

    it("delivers published events to subscribers", async () => {
      const ch = factory.channel<TestEvent>(
        `contract-${name}-${Date.now()}-1`,
      );
      const received: TestEvent[] = [];
      const unsub = await ch.subscribe((e) => received.push(e));

      await ch.publish({ kind: "created", id: "a" });
      // Redis round-trip needs a moment; memory is synchronous.
      await new Promise((r) => setTimeout(r, 50));

      expect(received).toEqual([{ kind: "created", id: "a" }]);
      unsub();
    });

    it("stops delivery after unsubscribe", async () => {
      const ch = factory.channel<TestEvent>(
        `contract-${name}-${Date.now()}-2`,
      );
      const received: TestEvent[] = [];
      const unsub = await ch.subscribe((e) => received.push(e));
      unsub();

      await ch.publish({ kind: "created", id: "a" });
      await new Promise((r) => setTimeout(r, 50));

      expect(received).toEqual([]);
    });

    it("delivers to multiple subscribers", async () => {
      const ch = factory.channel<TestEvent>(
        `contract-${name}-${Date.now()}-3`,
      );
      const a: TestEvent[] = [];
      const b: TestEvent[] = [];
      await ch.subscribe((e) => a.push(e));
      await ch.subscribe((e) => b.push(e));

      await ch.publish({ kind: "created", id: "x" });
      await new Promise((r) => setTimeout(r, 50));

      expect(a).toEqual([{ kind: "created", id: "x" }]);
      expect(b).toEqual([{ kind: "created", id: "x" }]);
    });
  });
}

await runContract("MemoryChannel", () => new MemoryChannelFactory());
await runContract("RedisChannel", () => new RedisChannelFactory());
```

- [ ] **Step 3: Run**

```bash
make test-unit ARGS="realtime"
```

Expected: 6 tests PASS (3 each × 2 implementations).

- [ ] **Step 4: Commit**

```bash
git add packages/realtime/
git commit -m "test(realtime): contract suite running against Memory + Redis impls"
```

---

### Task 4: Schema — TodoListMembership + TodoListInvite

**Files:**
- Modify: `packages/db/prisma/schema/todo-list.prisma`

- [ ] **Step 1: Extend the schema**

In `packages/db/prisma/schema/todo-list.prisma`, add new models and relations:

```prisma
// Application owned — full control.

model TodoList {
  id        String   @id @default(cuid())
  name      String
  color     String   @default("#6366f1")
  userId    String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  user        User                   @relation(fields: [userId], references: [id], onDelete: Cascade)
  todos       Todo[]
  memberships TodoListMembership[]
  invites     TodoListInvite[]
}

model TodoListMembership {
  id         String   @id @default(cuid())
  userId     String
  todoListId String
  role       String   @default("collaborator") // "collaborator" | "owner"
  createdAt  DateTime @default(now())

  user     User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  todoList TodoList @relation(fields: [todoListId], references: [id], onDelete: Cascade)

  @@unique([userId, todoListId])
}

model TodoListInvite {
  id            String   @id @default(cuid())
  token         String   @unique
  invitedUserId String
  todoListId    String
  expiresAt     DateTime
  createdAt     DateTime @default(now())

  invitedUser User     @relation(fields: [invitedUserId], references: [id], onDelete: Cascade)
  todoList    TodoList @relation(fields: [todoListId], references: [id], onDelete: Cascade)

  @@index([invitedUserId])
  @@index([todoListId])
}
```

- [ ] **Step 2: Add reverse relations on User**

In `packages/db/prisma/schema/auth.prisma`, extend `User`:

```prisma
  memberships TodoListMembership[]
  invitesReceived TodoListInvite[]
```

(Append to the existing relations list.)

- [ ] **Step 3: Push schema**

```bash
make db-push
```

- [ ] **Step 4: Commit**

```bash
git add packages/db/prisma/schema/
git commit -m "feat(schema): TodoListMembership + TodoListInvite"
```

---

### Task 5: Extend todo-list service — invite, accept, remove

**Files:**
- Modify: `packages/api/src/domains/todo-list/service.ts`
- Create: `packages/api/src/domains/todo-list/events.ts`
- Create: `packages/api/src/domains/todo-list/constants.ts` (if not present)
- Modify: `packages/api/src/authz/rules/todo.ts`
- Modify: `packages/api/src/domains/todo-list/__tests__/service.test.ts`

- [ ] **Step 1: Define events**

Create `packages/api/src/domains/todo-list/events.ts`:

```ts
// Event union published to per-list realtime channels.
// Consumed by: the tRPC subscription on the server (fan-out to WS clients),
// the service's own unit tests (via MemoryChannel assertion).

export type TodoListEvent =
  | { kind: "list-updated"; listId: string }
  | { kind: "todo-updated"; listId: string; todoId: string }
  | { kind: "collaborator-added"; listId: string; userId: string }
  | { kind: "collaborator-removed"; listId: string; userId: string };

export function listChannelKey(listId: string): string {
  return `todo-list:${listId}`;
}
```

- [ ] **Step 2: Add invite expiry constant**

Extend/create `packages/api/src/domains/todo-list/constants.ts`:

```ts
export const INVITE_EXPIRY_DAYS = 7;
export const INVITE_RETENTION_DAYS = 30; // cron deletes rows older than this past expiresAt
```

- [ ] **Step 3: Extend authz rule for memberships**

Replace `packages/api/src/authz/rules/todo.ts`:

```ts
// Owner OR collaborator can read/update. Only owner can delete.
// Membership check is done at service level (service fetches the
// membership row before issuing the authz check) — CASL conditions
// over collection relations aren't expressive enough for this shape.

import type { AbilityBuilder } from "@casl/ability";
import type { AppAbility, SessionUser } from "../types.js";

export function applyTodoRules(
  { can }: AbilityBuilder<AppAbility>,
  user: SessionUser | null,
): void {
  if (!user) return;
  // Owner-side rules — used for delete and the fast path.
  can("manage", "TodoList", { userId: user.id });
  can("manage", "Todo", { userId: user.id });
}
```

(Collaborator access is enforced imperatively in the service layer — see step 4.)

- [ ] **Step 4: Extend the todo-list service**

Extend `packages/api/src/domains/todo-list/service.ts`. Add these exports (preserve any existing ones):

```ts
import { Prisma, type PrismaClient } from "@project/db";
import { randomBytes } from "node:crypto";
import type { Channel } from "@project/realtime/types";
import { channel as defaultChannel } from "@project/realtime/channel";
import { sendEmail } from "@project/email/service";
import {
  INVITE_EXPIRY_DAYS,
  INVITE_RETENTION_DAYS,
} from "./constants.js";
import { listChannelKey, type TodoListEvent } from "./events.js";

type DbClient = PrismaClient | Prisma.TransactionClient;
type ChannelProvider = (key: string) => Channel<TodoListEvent>;

const defaultProvider: ChannelProvider = (k) => defaultChannel(k);

export async function canReadList(
  db: DbClient,
  userId: string,
  listId: string,
): Promise<boolean> {
  const list = await db.todoList.findFirst({
    where: {
      id: listId,
      OR: [
        { userId },
        { memberships: { some: { userId } } },
      ],
    },
  });
  return list !== null;
}

export async function listAccessibleTodoLists(
  db: DbClient,
  userId: string,
) {
  return db.todoList.findMany({
    where: {
      OR: [
        { userId },
        { memberships: { some: { userId } } },
      ],
    },
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { todos: true, memberships: true } },
    },
  });
}

export async function inviteCollaborator(
  tx: Prisma.TransactionClient,
  ownerId: string,
  listId: string,
  username: string,
  options: { channel?: ChannelProvider; nowMs?: number } = {},
) {
  const list = await tx.todoList.findFirstOrThrow({
    where: { id: listId, userId: ownerId },
  });

  const invitee = await tx.user.findUnique({ where: { username } });
  if (!invitee) {
    throw new Error(`No user with username "${username}"`);
  }
  if (invitee.id === ownerId) {
    throw new Error("Cannot invite yourself");
  }

  const existing = await tx.todoListMembership.findUnique({
    where: {
      userId_todoListId: { userId: invitee.id, todoListId: listId },
    },
  });
  if (existing) {
    throw new Error("User is already a collaborator");
  }

  const token = randomBytes(24).toString("hex");
  const now = options.nowMs ?? Date.now();
  const expiresAt = new Date(now + INVITE_EXPIRY_DAYS * 86_400_000);

  const invite = await tx.todoListInvite.create({
    data: {
      token,
      invitedUserId: invitee.id,
      todoListId: listId,
      expiresAt,
    },
  });

  const owner = await tx.user.findUniqueOrThrow({
    where: { id: ownerId },
  });

  await sendEmail({
    template: "invite-collaborator",
    to: invitee.email,
    vars: {
      inviterName: owner.name,
      listName: list.name,
      acceptUrl: `/invites/${token}`,
    },
  });

  return invite;
}

export async function acceptInvite(
  tx: Prisma.TransactionClient,
  userId: string,
  token: string,
  options: { channel?: ChannelProvider; nowMs?: number } = {},
) {
  const provider = options.channel ?? defaultProvider;
  const now = new Date(options.nowMs ?? Date.now());

  // SECURITY NOTE: the accept link in the invite email is /invites/${token}
  // and the authz is (token + invitedUserId). A user with a valid session
  // as the invitee can accept; any other session cannot. But the token
  // is email-carried, so anyone who reads the invitee's email *and* has
  // a session as the invitee can accept. That's by design for username-
  // targeted invites. Do NOT copy this pattern to email-based invites
  // (where the invitee may not yet have a session) without adding an
  // email-ownership challenge step.

  // Lock the invite row to serialize concurrent accept attempts against
  // this token. Without the lock, two tabs clicking Accept could both
  // pass the expiry check and one would fail on the membership unique
  // constraint — recoverable but noisy. Ordering clause keeps the lock
  // deterministic per repo convention (see packages/api/CLAUDE.md).
  await tx.$queryRaw`
    SELECT id FROM "TodoListInvite"
    WHERE token = ${token}
      AND "invitedUserId" = ${userId}
      AND "expiresAt" > ${now}
    ORDER BY id
    FOR NO KEY UPDATE
  `;

  const invite = await tx.todoListInvite.findFirstOrThrow({
    where: {
      token,
      invitedUserId: userId,
      expiresAt: { gt: now },
    },
  });

  const membership = await tx.todoListMembership.create({
    data: {
      userId,
      todoListId: invite.todoListId,
      role: "collaborator",
    },
  });

  await tx.todoListInvite.delete({ where: { id: invite.id } });

  await provider(listChannelKey(invite.todoListId)).publish({
    kind: "collaborator-added",
    listId: invite.todoListId,
    userId,
  });

  return membership;
}

export async function removeCollaborator(
  tx: Prisma.TransactionClient,
  ownerId: string,
  listId: string,
  targetUserId: string,
  options: { channel?: ChannelProvider } = {},
) {
  const provider = options.channel ?? defaultProvider;

  await tx.todoList.findFirstOrThrow({
    where: { id: listId, userId: ownerId },
  });

  await tx.todoListMembership.delete({
    where: {
      userId_todoListId: { userId: targetUserId, todoListId: listId },
    },
  });

  await provider(listChannelKey(listId)).publish({
    kind: "collaborator-removed",
    listId,
    userId: targetUserId,
  });
}

export async function listCollaborators(db: DbClient, listId: string) {
  return db.todoListMembership.findMany({
    where: { todoListId: listId },
    include: {
      user: { select: { id: true, username: true, name: true } },
    },
  });
}

export async function deleteExpiredInvites(
  tx: Prisma.TransactionClient,
  options: { nowMs?: number } = {},
) {
  const now = new Date(options.nowMs ?? Date.now());
  const cutoff = new Date(
    now.getTime() - INVITE_RETENTION_DAYS * 86_400_000,
  );
  const result = await tx.todoListInvite.deleteMany({
    where: { expiresAt: { lt: cutoff } },
  });
  return result.count;
}
```

- [ ] **Step 5: Export subpaths**

In `packages/api/package.json` `exports`, add:

```json
"./domains/todo-list/service": {
  "default": "./src/domains/todo-list/service.ts"
},
"./domains/todo-list/events": {
  "default": "./src/domains/todo-list/events.ts"
},
"./domains/todo-list/constants": {
  "default": "./src/domains/todo-list/constants.ts"
}
```

- [ ] **Step 6: Add @project/realtime + @project/email deps to @project/api**

```bash
pnpm --filter @project/api add @project/realtime@workspace:* @project/email@workspace:*
```

- [ ] **Step 7: Lint**

```bash
make lint
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/api/ pnpm-lock.yaml
git commit -m "feat(todo-list): invite/accept/remove collaborator + realtime events"
```

---

### Task 6: Service unit tests using MemoryChannel

**Files:**
- Modify: `packages/api/src/domains/todo-list/__tests__/service.test.ts`

- [ ] **Step 1: Add test cases**

Append (don't replace existing tests) to `packages/api/src/domains/todo-list/__tests__/service.test.ts`. First, imports at the top:

```ts
import { MemoryChannelFactory } from "@project/realtime/memory";
import {
  inviteCollaborator,
  acceptInvite,
  removeCollaborator,
  listAccessibleTodoLists,
  deleteExpiredInvites,
} from "../service.js";
import { listChannelKey } from "../events.js";
```

Then append the new describe block:

```ts
describe("collaborator lifecycle", () => {
  const OWNER_ID = "test-owner-collab";
  const INVITEE_ID = "test-invitee-collab";
  let listId: string;

  beforeAll(async () => {
    await db.user.deleteMany({
      where: { id: { in: [OWNER_ID, INVITEE_ID] } },
    });
    await db.user.createMany({
      data: [
        {
          id: OWNER_ID,
          name: "Owner",
          email: "owner-collab@example.com",
          username: "owner-collab",
          emailVerified: true,
        },
        {
          id: INVITEE_ID,
          name: "Invitee",
          email: "invitee-collab@example.com",
          username: "invitee-collab",
          emailVerified: true,
        },
      ],
    });
  });

  beforeEach(async () => {
    const list = await db.todoList.create({
      data: { name: "Shared", userId: OWNER_ID },
    });
    listId = list.id;
  });

  afterEach(async () => {
    await db.todoListInvite.deleteMany({ where: { todoListId: listId } });
    await db.todoListMembership.deleteMany({
      where: { todoListId: listId },
    });
    await db.todoList.deleteMany({ where: { id: listId } });
  });

  afterAll(async () => {
    await db.user.deleteMany({
      where: { id: { in: [OWNER_ID, INVITEE_ID] } },
    });
  });

  it("invite creates TodoListInvite with 7-day expiry", async () => {
    await db.$transaction(async (tx) => {
      const invite = await inviteCollaborator(
        tx,
        OWNER_ID,
        listId,
        "invitee-collab",
      );
      expect(invite.invitedUserId).toBe(INVITEE_ID);
      expect(invite.todoListId).toBe(listId);
      expect(invite.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });
  });

  it("invite with unknown username throws", async () => {
    await expect(
      db.$transaction((tx) =>
        inviteCollaborator(tx, OWNER_ID, listId, "ghost"),
      ),
    ).rejects.toThrow(/ghost/);
  });

  it("accept consumes invite and creates membership; publishes event", async () => {
    const factory = new MemoryChannelFactory();
    let received: unknown = null;
    const unsub = await factory
      .channel(listChannelKey(listId))
      .subscribe((e) => {
        received = e;
      });

    const invite = await db.$transaction((tx) =>
      inviteCollaborator(tx, OWNER_ID, listId, "invitee-collab"),
    );
    await db.$transaction((tx) =>
      acceptInvite(tx, INVITEE_ID, invite.token, {
        channel: (k) => factory.channel(k),
      }),
    );

    const membership = await db.todoListMembership.findUnique({
      where: {
        userId_todoListId: { userId: INVITEE_ID, todoListId: listId },
      },
    });
    expect(membership).not.toBeNull();

    const remaining = await db.todoListInvite.findUnique({
      where: { id: invite.id },
    });
    expect(remaining).toBeNull();

    expect(received).toEqual({
      kind: "collaborator-added",
      listId,
      userId: INVITEE_ID,
    });
    unsub();
    await factory.closeAll();
  });

  it("accept fails when invite is expired", async () => {
    const invite = await db.$transaction((tx) =>
      inviteCollaborator(tx, OWNER_ID, listId, "invitee-collab", {
        nowMs: Date.now() - 10 * 86_400_000, // 10 days ago
      }),
    );
    await expect(
      db.$transaction((tx) =>
        acceptInvite(tx, INVITEE_ID, invite.token),
      ),
    ).rejects.toThrow();
  });

  it("remove deletes membership and publishes event", async () => {
    const invite = await db.$transaction((tx) =>
      inviteCollaborator(tx, OWNER_ID, listId, "invitee-collab"),
    );
    await db.$transaction((tx) =>
      acceptInvite(tx, INVITEE_ID, invite.token),
    );

    const factory = new MemoryChannelFactory();
    let received: unknown = null;
    const unsub = await factory
      .channel(listChannelKey(listId))
      .subscribe((e) => {
        received = e;
      });

    await db.$transaction((tx) =>
      removeCollaborator(tx, OWNER_ID, listId, INVITEE_ID, {
        channel: (k) => factory.channel(k),
      }),
    );

    const membership = await db.todoListMembership.findUnique({
      where: {
        userId_todoListId: { userId: INVITEE_ID, todoListId: listId },
      },
    });
    expect(membership).toBeNull();
    expect(received).toEqual({
      kind: "collaborator-removed",
      listId,
      userId: INVITEE_ID,
    });
    unsub();
    await factory.closeAll();
  });

  it("listAccessibleTodoLists returns owner's + collaborator's lists", async () => {
    const invite = await db.$transaction((tx) =>
      inviteCollaborator(tx, OWNER_ID, listId, "invitee-collab"),
    );
    await db.$transaction((tx) =>
      acceptInvite(tx, INVITEE_ID, invite.token),
    );

    const ownerLists = await listAccessibleTodoLists(db, OWNER_ID);
    expect(ownerLists.find((l) => l.id === listId)).toBeTruthy();

    const inviteeLists = await listAccessibleTodoLists(db, INVITEE_ID);
    expect(inviteeLists.find((l) => l.id === listId)).toBeTruthy();
  });

  it("deleteExpiredInvites removes rows past retention window", async () => {
    // Manually insert an invite expired 31 days ago.
    await db.todoListInvite.create({
      data: {
        token: "old-invite-token",
        invitedUserId: INVITEE_ID,
        todoListId: listId,
        expiresAt: new Date(Date.now() - 31 * 86_400_000),
      },
    });

    // And a recent one that must survive.
    await db.todoListInvite.create({
      data: {
        token: "recent-invite-token",
        invitedUserId: INVITEE_ID,
        todoListId: listId,
        expiresAt: new Date(Date.now() - 1 * 86_400_000),
      },
    });

    const deleted = await db.$transaction((tx) => deleteExpiredInvites(tx));
    expect(deleted).toBe(1);

    const remaining = await db.todoListInvite.findMany({
      where: { todoListId: listId },
    });
    expect(remaining.map((i) => i.token)).toEqual(["recent-invite-token"]);
  });
});
```

- [ ] **Step 2: Run tests**

```bash
make test-unit ARGS="todo-list"
```

Expected: all new tests PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/api/src/domains/todo-list/__tests__/
git commit -m "test(todo-list): collaborator lifecycle with MemoryChannel assertions"
```

---

### Task 7: tRPC router — mutations + subscription

**Files:**
- Modify: `packages/api/src/domains/todo-list/router.ts`

- [ ] **Step 1: Extend the router**

Add mutation and subscription procedures alongside existing ones:

```ts
import { observable } from "@trpc/server/observable";
import { z } from "zod";
import { channel as defaultChannel } from "@project/realtime/channel";
import { listChannelKey, type TodoListEvent } from "./events.js";
import {
  acceptInvite,
  inviteCollaborator,
  listAccessibleTodoLists,
  listCollaborators,
  removeCollaborator,
  canReadList,
} from "./service.js";
import { protectedProcedure, router } from "../../trpc.js";
import { TRPCError } from "@trpc/server";

// ... inside your existing todoListRouter — merge these in:

export const todoListRouter = router({
  // ... existing list/create/update/delete

  listAccessible: protectedProcedure.query(({ ctx }) =>
    listAccessibleTodoLists(ctx.db, ctx.session.user.id),
  ),

  inviteCollaborator: protectedProcedure
    .input(
      z.object({
        listId: z.string().min(1),
        username: z.string().min(1),
      }),
    )
    .mutation(({ ctx, input }) =>
      ctx.db.$transaction((tx) =>
        inviteCollaborator(
          tx,
          ctx.session.user.id,
          input.listId,
          input.username,
        ),
      ),
    ),

  acceptInvite: protectedProcedure
    .input(z.object({ token: z.string().min(1) }))
    .mutation(({ ctx, input }) =>
      ctx.db.$transaction((tx) =>
        acceptInvite(tx, ctx.session.user.id, input.token),
      ),
    ),

  removeCollaborator: protectedProcedure
    .input(
      z.object({
        listId: z.string().min(1),
        userId: z.string().min(1),
      }),
    )
    .mutation(({ ctx, input }) =>
      ctx.db.$transaction((tx) =>
        removeCollaborator(
          tx,
          ctx.session.user.id,
          input.listId,
          input.userId,
        ),
      ),
    ),

  collaborators: protectedProcedure
    .input(z.object({ listId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const allowed = await canReadList(
        ctx.db,
        ctx.session.user.id,
        input.listId,
      );
      if (!allowed) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      return listCollaborators(ctx.db, input.listId);
    }),

  onListEvent: protectedProcedure
    .input(z.object({ listId: z.string().min(1) }))
    .subscription(async ({ ctx, input }) => {
      const allowed = await canReadList(
        ctx.db,
        ctx.session.user.id,
        input.listId,
      );
      if (!allowed) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const ch = defaultChannel<TodoListEvent>(
        listChannelKey(input.listId),
      );
      return observable<TodoListEvent>((emit) => {
        const unsubPromise = ch.subscribe((event) => emit.next(event));
        return () => {
          unsubPromise.then((u) => u());
        };
      });
    }),
});
```

(If the existing router already uses a different composition pattern, insert these procedures in-place rather than replacing the export.)

- [ ] **Step 2: Lint**

```bash
make lint
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/api/src/domains/todo-list/router.ts
git commit -m "feat(todo-list): invite/accept/remove mutations + onListEvent subscription"
```

---

### Task 8: Mount tRPC WS adapter in the server

**Files:**
- Modify: `apps/server/package.json`
- Modify: `apps/server/src/index.ts`
- Modify: `pnpm-workspace.yaml`

- [ ] **Step 1: Add catalog entries**

```yaml
  "@hono/node-ws": ^1.1.1
  ws: ^8.18.0
  "@types/ws": ^8.5.13
```

- [ ] **Step 2: Add to server deps**

Edit `apps/server/package.json`:

```json
"@hono/node-ws": "catalog:",
"ws": "catalog:",
"@trpc/server": "^11.0.0"
```

And devDependencies:

```json
"@types/ws": "catalog:"
```

- [ ] **Step 3: Install**

```bash
pnpm install
```

- [ ] **Step 4: Wire the WS adapter into `apps/server/src/index.ts`**

Inspect the current server entry (`apps/server/src/index.ts`). It boots Hono via `@hono/node-server`. Extend it to mount the tRPC WS adapter on the same `http.Server`. The exact shape depends on how `serve()` is called — below is a representative patch:

```ts
import { applyWSSHandler } from "@trpc/server/adapters/ws";
import { WebSocketServer } from "ws";
import { appRouter } from "@project/api/router";
import { createContext } from "@project/api/context";

// ... existing serve() call returns the http.Server:
const httpServer = serve({ fetch: app.fetch, port: env.PORT });

const wss = new WebSocketServer({ server: httpServer, path: "/trpc-ws" });
const wsHandler = applyWSSHandler({
  wss,
  router: appRouter,
  createContext: async ({ req }) =>
    createContext({ headers: req.headers as unknown as Headers }),
});

process.on("SIGTERM", () => {
  wsHandler.broadcastReconnectNotification();
  wss.close();
});
```

Adjust `createContext` invocation to match the repo's actual signature. If `createContext` currently takes a Hono `c` object, extract a lightweight context builder (the session headers are what's actually needed).

- [ ] **Step 5: Smoke test**

```bash
make dev
```

In a browser console on an authenticated page:

```js
const ws = new WebSocket("ws://localhost:3001/trpc-ws");
ws.onopen = () => console.log("open");
ws.onerror = (e) => console.error(e);
```

Expected: `open` logs. Close the socket with `ws.close()`.

- [ ] **Step 6: Commit**

```bash
git add apps/server/ pnpm-workspace.yaml pnpm-lock.yaml
git commit -m "feat(server): mount tRPC WS adapter at /trpc-ws"
```

---

### Task 9: `expire-invites` cron — queue + worker + schedule

**Files:**
- Modify: `apps/worker/src/handlers/maintenance.ts`
- Create: `apps/worker/src/schedule.ts`
- Modify: `apps/worker/src/index.ts`

- [ ] **Step 1: Implement handler**

Replace `apps/worker/src/handlers/maintenance.ts`:

```ts
import { db } from "@project/db";
import {
  deleteExpiredInvites,
} from "@project/api/domains/todo-list/service";
import { MAINTENANCE_QUEUE_NAME } from "@project/jobs/queues";
import { createRedis } from "@project/jobs/redis";
import { Worker } from "bullmq";

export const EXPIRE_INVITES_JOB = "expire-invites" as const;

export function startMaintenanceWorker(): Worker {
  const worker = new Worker(
    MAINTENANCE_QUEUE_NAME,
    async (job) => {
      if (job.name === EXPIRE_INVITES_JOB) {
        const count = await db.$transaction((tx) =>
          deleteExpiredInvites(tx),
        );
        console.log(`[maintenance] expire-invites removed ${count} rows`);
        return;
      }
      console.warn(
        `[maintenance-worker] unknown job "${job.name}"`,
      );
    },
    { connection: createRedis("worker") },
  );

  worker.on("failed", (job, err) => {
    console.error(
      `[maintenance-worker] job ${job?.id} failed:`,
      err.message,
    );
  });

  return worker;
}
```

Add `@project/api` and `@project/db` to `apps/worker/package.json` dependencies:

```json
"@project/api": "workspace:*",
"@project/db": "workspace:*"
```

- [ ] **Step 2: Create `apps/worker/src/schedule.ts`**

```ts
// Registers the repeatable maintenance crons with BullMQ on worker boot.
// BullMQ's repeatable-job registration is idempotent — calling `add` with
// the same job name + repeat pattern updates the existing scheduler entry.

import { maintenanceQueue } from "@project/jobs/queues";
import { EXPIRE_INVITES_JOB } from "./handlers/maintenance.js";

export async function registerSchedules(): Promise<void> {
  await maintenanceQueue().add(
    EXPIRE_INVITES_JOB,
    {},
    {
      repeat: { pattern: "0 3 * * *" }, // daily at 03:00
      jobId: `cron:${EXPIRE_INVITES_JOB}`,
      removeOnComplete: { count: 30 },
      removeOnFail: { count: 100 },
    },
  );
  console.log(
    `[worker] registered repeatable job "${EXPIRE_INVITES_JOB}" (0 3 * * *)`,
  );
}
```

- [ ] **Step 3: Wire into worker boot**

Extend `apps/worker/src/index.ts`:

```ts
import { closeQueues } from "@project/jobs/queues";
import { startEmailWorker } from "./handlers/email.js";
import { startMaintenanceWorker } from "./handlers/maintenance.js";
import { registerSchedules } from "./schedule.js";

const workers = [startEmailWorker(), startMaintenanceWorker()];
await registerSchedules();

console.log("[worker] started email + maintenance workers");

async function shutdown(signal: NodeJS.Signals) {
  console.log(`[worker] received ${signal}, shutting down`);
  await Promise.all(workers.map((w) => w.close()));
  await closeQueues();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
```

- [ ] **Step 4: Install + lint**

```bash
pnpm install
make lint
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/ pnpm-lock.yaml
git commit -m "feat(worker): expire-invites repeatable cron + schedule registry"
```

---

### Task 10: `useOptimisticMutation` helper

**Files:**
- Create: `apps/web/src/shared/use-optimistic-mutation.ts`

Per `apps/web/CLAUDE.md`, generic cross-feature hooks live under
`shared/`. This helper accepts an already-built tRPC mutation from the
caller (constructed via `useMutation(trpc.x.mutationOptions({...}))`) and
adds optimistic snapshot/rollback. It does NOT wrap the tRPC mutation
creation — keeping that in userland preserves the idiomatic call site.

- [ ] **Step 1: Review the existing pattern**

Read `apps/web/src/features/todo/use-todos.ts` to see how mutations are
currently built via `trpc.x.mutationOptions({...})` + query-filter
invalidation. This helper should compose on top of that pattern, not
replace it.

- [ ] **Step 2: Create the helper**

```ts
// Adds optimistic snapshot/rollback to any existing tRPC-backed mutation.
// Call site stays idiomatic:
//
//   const { trpc } = Route.useRouteContext();
//   const queryClient = useQueryClient();
//   const mutation = useMutation(trpc.todo.update.mutationOptions({
//     onSuccess: () => queryClient.invalidateQueries(
//       trpc.todo.list.queryFilter({ todoListId }),
//     ),
//   }));
//
//   const optimistic = useOptimisticMutation(mutation, {
//     queryFilter: trpc.todo.list.queryFilter({ todoListId }),
//     applyOptimistic: (prev, input) => prev?.map((t) =>
//       t.id === input.id ? { ...t, ...input.patch } : t
//     ),
//     errorMessage: "Failed to update todo",
//   });
//
//   optimistic.run({ id: "...", patch: { completed: true } });
//
// setQueryData's callback type via tRPC's proxy is fragile (see
// apps/web/CLAUDE.md); consumers narrow their TQueryData explicitly.

import {
  useQueryClient,
  type QueryFilters,
} from "@tanstack/react-query";
import { toast } from "sonner";

type MutationLike<TInput, TOutput> = {
  mutateAsync: (input: TInput) => Promise<TOutput>;
  isPending: boolean;
};

export function useOptimisticMutation<TInput, TOutput, TQueryData>(
  mutation: MutationLike<TInput, TOutput>,
  options: {
    queryFilter: QueryFilters;
    applyOptimistic: (
      previous: TQueryData | undefined,
      input: TInput,
    ) => TQueryData | undefined;
    errorMessage?: string;
  },
) {
  const queryClient = useQueryClient();

  async function run(input: TInput): Promise<TOutput | null> {
    await queryClient.cancelQueries(options.queryFilter);
    const previous = queryClient.getQueryData<TQueryData>(
      options.queryFilter.queryKey ?? [],
    );
    queryClient.setQueryData<TQueryData>(
      options.queryFilter.queryKey ?? [],
      (old) => options.applyOptimistic(old, input),
    );
    try {
      return await mutation.mutateAsync(input);
    } catch (err) {
      queryClient.setQueryData<TQueryData>(
        options.queryFilter.queryKey ?? [],
        previous,
      );
      toast.error(options.errorMessage ?? "Failed to save");
      throw err;
    } finally {
      queryClient.invalidateQueries(options.queryFilter);
    }
  }

  return { run, isPending: mutation.isPending };
}
```

Verify `sonner` is in `apps/web/package.json` (it's used in
`use-todos.ts` — it should be). If not, `pnpm --filter agentic-web add sonner`.

- [ ] **Step 3: Lint**

```bash
make lint
```

Expected: PASS. The `check-trpc-patterns.ts` guard from Plan B Task 3.5
will reject any accidental `createTRPCReact` drift.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/shared/use-optimistic-mutation.ts
git commit -m "feat(web): useOptimisticMutation helper — snapshot + rollback + toast"
```

---

### Task 11: `useLeaderTab` hook

**Files:**
- Create: `apps/web/src/features/todo-list/use-leader-tab.ts`

Uses the Web Locks API for election — the browser guarantees exactly one
lock holder per name, handles unload, and eliminates hand-rolled heartbeat
races. `BroadcastChannel` is used only for leader→peer event relay, not
for election.

Web Locks is available in all modern browsers (Chrome 69+, Firefox 96+,
Safari 15.4+). If unavailable (SSR, ancient browsers), fall back to
"every tab subscribes directly" — correct if slightly wasteful.

- [ ] **Step 1: Create the hook**

```ts
// Leader-tab election via Web Locks + event relay via BroadcastChannel.
//
// Only the leader opens the WebSocket (tRPC subscription); peers receive
// events via BroadcastChannel. The election is delegated to the browser
// via navigator.locks — this is correct by construction (no heartbeat
// race, no double-leader, unload handled automatically when the tab
// closes and releases the lock).
//
// Contract for callers:
//   - isLeader: stable boolean; flips at most twice per mount (false→true
//     on acquire, true→false never during a mount — when leader tab closes
//     the promise-held lock releases and a peer promotes on its own hook
//     re-run).
//   - broadcast(data): leader calls this with events to relay to peers.
//   - onMessage(handler): peers register; returns unsubscribe.
//
// All functions are stable across renders (useRef-backed) so dependent
// effects don't re-subscribe on every render.

import { useCallback, useEffect, useRef, useState } from "react";

export function useLeaderTab(userId: string | null): {
  isLeader: boolean;
  broadcast: (data: unknown) => void;
  onMessage: (handler: (data: unknown) => void) => () => void;
} {
  const [isLeader, setIsLeader] = useState(false);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const handlersRef = useRef<Set<(data: unknown) => void>>(new Set());

  useEffect(() => {
    if (!userId) return;

    // BroadcastChannel for event relay — separate from election.
    const bcName = `leader-relay:${userId}`;
    const bc =
      typeof BroadcastChannel !== "undefined"
        ? new BroadcastChannel(bcName)
        : null;
    channelRef.current = bc;

    if (bc) {
      bc.onmessage = (evt) => {
        for (const h of [...handlersRef.current]) h(evt.data);
      };
    }

    // Web Locks election. If unavailable (SSR, very old browsers), every
    // tab acts as leader — correct but wasteful.
    const hasWebLocks =
      typeof navigator !== "undefined" &&
      typeof navigator.locks?.request === "function";

    if (!hasWebLocks) {
      setIsLeader(true);
      return () => {
        bc?.close();
        channelRef.current = null;
      };
    }

    let cancelled = false;
    let releaseLock: (() => void) | null = null;

    navigator.locks.request(
      `leader-tab:${userId}`,
      { mode: "exclusive" },
      () =>
        new Promise<void>((resolve) => {
          if (cancelled) {
            resolve();
            return;
          }
          releaseLock = () => resolve();
          setIsLeader(true);
        }),
    );

    return () => {
      cancelled = true;
      setIsLeader(false);
      releaseLock?.();
      bc?.close();
      channelRef.current = null;
    };
  }, [userId]);

  const broadcast = useCallback((data: unknown) => {
    try {
      channelRef.current?.postMessage(data);
    } catch {
      // Channel may be closed during unmount — ignore.
    }
  }, []);

  const onMessage = useCallback(
    (handler: (data: unknown) => void): (() => void) => {
      handlersRef.current.add(handler);
      return () => {
        handlersRef.current.delete(handler);
      };
    },
    [],
  );

  return { isLeader, broadcast, onMessage };
}
```

- [ ] **Step 2: Lint**

```bash
make lint
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/features/todo-list/use-leader-tab.ts
git commit -m "feat(web): useLeaderTab via Web Locks + BroadcastChannel relay"
```

---

### Task 12: tRPC client WS link + live-updates hook

**Files:**
- Modify: `apps/web/src/router.tsx` (the `createTRPCClient` call — found via grep)
- Create: `apps/web/src/features/todo-list/use-todo-list-live-updates.ts`

- [ ] **Step 1: Find tRPC client config**

```bash
grep -rn "createTRPCClient\|httpBatchLink" apps/web/src --include="*.ts" --include="*.tsx" | head
```

Note the exact file + shape of the existing links array.

- [ ] **Step 2: Add a `splitLink` with `wsLink` for subscriptions**

Edit the `createTRPCClient({ links: [...] })` call. Replace the single
`httpBatchLink` with a `splitLink` that routes subscriptions over WS:

```ts
import {
  createTRPCClient,
  createWSClient,
  httpBatchLink,
  splitLink,
  wsLink,
} from "@trpc/client";

// NOTE: hardcoded dev port. Accepted for this spike per root CLAUDE.md's
// "dev port literals are allowed" rule. Production would derive from
// @project/env/client.
const wsUrl =
  typeof window === "undefined"
    ? "ws://localhost:3001/trpc-ws"
    : `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.hostname}:3001/trpc-ws`;

const wsClient = createWSClient({ url: wsUrl });

// Inside createTRPCClient(...):
links: [
  splitLink({
    condition: (op) => op.type === "subscription",
    true: wsLink({ client: wsClient }),
    false: httpBatchLink({ url: apiClient.baseUrl + "/trpc" }),
  }),
],
```

(Match the existing `httpBatchLink`'s URL — whatever the file uses now.)

- [ ] **Step 3: Create the live-updates hook**

Create `apps/web/src/features/todo-list/use-todo-list-live-updates.ts`:

```ts
// Subscribes to a list's realtime events. Leader tab opens the WS; peers
// receive events via BroadcastChannel relay.
//
// Uses @trpc/tanstack-react-query's subscriptionOptions API. Caller
// passes the trpc proxy from Route.useRouteContext().

import type { AppRouter } from "@project/api/router";
import type { TodoListEvent } from "@project/api/domains/todo-list/events";
import {
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { useSubscription } from "@trpc/tanstack-react-query";
import type { TRPCOptionsProxy } from "@trpc/tanstack-react-query";
import { useEffect } from "react";
import { useLeaderTab } from "./use-leader-tab.js";

export function useTodoListLiveUpdates(
  trpc: TRPCOptionsProxy<AppRouter>,
  listId: string | null,
  userId: string | null,
) {
  const queryClient = useQueryClient();
  const { isLeader, broadcast, onMessage } = useLeaderTab(userId);

  // Leader path: subscribe to the tRPC WS, relay to peers, apply locally.
  useSubscription(
    trpc.todoList.onListEvent.subscriptionOptions(
      { listId: listId ?? "" },
      {
        enabled: isLeader && listId !== null,
        onData: (event: TodoListEvent) => {
          broadcast({ __relay: true, event });
          applyEvent(trpc, queryClient, event);
        },
      },
    ),
  );

  // Peer path: listen for relayed events.
  useEffect(() => {
    return onMessage((data) => {
      if (
        data &&
        typeof data === "object" &&
        "__relay" in data &&
        "event" in data
      ) {
        applyEvent(
          trpc,
          queryClient,
          (data as { event: TodoListEvent }).event,
        );
      }
    });
  }, [trpc, queryClient, onMessage]);
}

function applyEvent(
  trpc: TRPCOptionsProxy<AppRouter>,
  queryClient: QueryClient,
  event: TodoListEvent,
) {
  // Use procedure-specific queryFilter — precise, no false positives.
  queryClient.invalidateQueries(trpc.todoList.listAccessible.queryFilter());
  queryClient.invalidateQueries(
    trpc.todoList.collaborators.queryFilter({ listId: event.listId }),
  );
  queryClient.invalidateQueries(
    trpc.todo.list.queryFilter({ todoListId: event.listId }),
  );
}
```

If `@trpc/tanstack-react-query` v11 exposes `useSubscription` at a
different export path, match what `apps/web/src/features/todo/use-todos.ts`
uses as the reference pattern.

- [ ] **Step 4: Lint**

```bash
make lint
```

Expected: PASS (including the `check-trpc-patterns.ts` guard).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/
git commit -m "feat(web): tRPC WS split link + useTodoListLiveUpdates (leader-aware)"
```

---

### Task 13: Sharing dialog + collaborator list UI

**Files:**
- Create: `apps/web/src/features/todo-list/share-list-dialog.tsx`
- Create: `apps/web/src/features/todo-list/collaborator-list.tsx`
- Modify: the list-detail route (find via `ls apps/web/src/routes/`)

Per `apps/web/CLAUDE.md`'s FSD rules, feature UI lives in
`features/<name>/`, never in a top-level `components/`. Uses
`Route.useRouteContext()` to access `trpc` + `queryClient` per the
canonical pattern in `features/todo/use-todos.ts`.

- [ ] **Step 1: Create the sharing dialog**

```tsx
// apps/web/src/features/todo-list/share-list-dialog.tsx
import { Button } from "@project/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@project/ui/dialog";
import { Input } from "@project/ui/input";
import { useMutation } from "@tanstack/react-query";
import type { AppRouter } from "@project/api/router";
import type { TRPCOptionsProxy } from "@trpc/tanstack-react-query";
import { useState } from "react";
import { toast } from "sonner";

export function ShareListDialog({
  listId,
  trpc,
}: {
  listId: string;
  trpc: TRPCOptionsProxy<AppRouter>;
}) {
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState("");

  const invite = useMutation(
    trpc.todoList.inviteCollaborator.mutationOptions({
      onSuccess: () => {
        toast.success(`Invite sent to ${username}`);
        setUsername("");
        setOpen(false);
      },
      onError: (err) => {
        toast.error(err.message);
      },
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
        </DialogHeader>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const trimmed = username.trim();
            if (!trimmed) return;
            invite.mutate({ listId, username: trimmed });
          }}
        >
          <Input
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={invite.isPending}
            autoFocus
          />
          <Button type="submit" disabled={invite.isPending}>
            Invite
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Create the collaborator list**

```tsx
// apps/web/src/features/todo-list/collaborator-list.tsx
import type { AppRouter } from "@project/api/router";
import { Button } from "@project/ui/button";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
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
  const list = collaborators.data ?? [];

  if (list.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No collaborators yet.</p>
    );
  }

  return (
    <ul className="space-y-2">
      {list.map((m) => (
        <li
          key={m.id}
          className="flex items-center justify-between rounded border p-2"
        >
          <span>
            {m.user.name}{" "}
            <span className="text-muted-foreground">@{m.user.username}</span>
          </span>
          {isOwner && m.user.id !== ownerId && (
            <Button
              size="sm"
              variant="ghost"
              disabled={remove.isPending}
              onClick={() =>
                remove.mutate({ listId, userId: m.user.id })
              }
            >
              Remove
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 3: Wire into the list-detail route**

Find the list-detail route:

```bash
grep -rln "listId\|\\\$listId" apps/web/src/routes/ | head
```

In that route component:

```tsx
const { trpc, session } = Route.useRouteContext();

// Hook up live updates near the top of the component
useTodoListLiveUpdates(trpc, listId, session?.user.id ?? null);

// Render the UI — alongside existing todo list rendering
<ShareListDialog listId={listId} trpc={trpc} />
<CollaboratorList
  listId={listId}
  ownerId={list.userId}
  currentUserId={session.user.id}
  trpc={trpc}
/>
```

Adjust `session` access to match the existing route — it's typically
provided by the `_authenticated` layout context.

- [ ] **Step 4: Smoke test**

```bash
make dev
```

In the browser: sign up two users (two private windows), owner clicks
Share, enters the other user's username, submits. Mailpit
(`http://localhost:8025`) shows the invite.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/
git commit -m "feat(web): sharing dialog + collaborator list + live updates on list detail"
```

---

### Task 14: Access-lost empty state

**Files:**
- Create: `apps/web/src/features/todo-list/access-lost-empty-state.tsx`
- Modify: list-detail route component

- [ ] **Step 1: Create the empty-state component**

```tsx
// apps/web/src/features/todo-list/access-lost-empty-state.tsx
import { Button } from "@project/ui/button";
import { Link } from "@tanstack/react-router";

export function AccessLostEmptyState() {
  return (
    <div className="rounded-lg border p-8 text-center">
      <h2 className="text-xl font-semibold">
        You no longer have access to this list
      </h2>
      <p className="text-muted-foreground mt-2">
        The owner removed you as a collaborator.
      </p>
      <Button asChild className="mt-4">
        <Link to={"/todo-lists" as string}>Back to your lists</Link>
      </Button>
    </div>
  );
}
```

- [ ] **Step 2: Render it on FORBIDDEN in the list-detail route**

tRPC v11 exposes the error shape via the tanstack-query result; TRPCClientError
carries `data.code`. Check in the route:

```tsx
import { TRPCClientError } from "@trpc/client";
import { AccessLostEmptyState } from "#/features/todo-list/access-lost-empty-state";

// ... inside the component:
const list = useQuery(trpc.todoList.get.queryOptions({ id: listId }));

if (
  list.error instanceof TRPCClientError &&
  list.error.data?.code === "FORBIDDEN"
) {
  return <AccessLostEmptyState />;
}
```

Adjust the `get` procedure name to whatever the existing list-detail route
calls. If the route uses `listAccessible` and filters client-side, switch
to an explicit `get` that returns the list or 403.

- [ ] **Step 2: Make the subscription close trigger a refetch**

The subscription handler already invalidates queries on `collaborator-removed`. For the removed user, the next fetch will return 403 — that triggers the empty state.

- [ ] **Step 3: Smoke test**

Two browser windows. Owner removes Bob. Bob's window should flip to the empty state within ~500ms (subscription event → invalidate → refetch → 403 → empty state).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/features/todo-list/access-lost-empty-state.tsx apps/web/src/routes/
git commit -m "feat(web): access-lost empty state on FORBIDDEN from list query"
```

---

### Task 15: E2E — invite + real-time sync + multi-tab + revocation

**Files:**
- Create: `e2e/features/collaborators.feature`
- Create: `e2e/steps/collaborators.steps.ts`

- [ ] **Step 1: Feature file**

Create `e2e/features/collaborators.feature`:

```gherkin
Feature: Todo list collaborators

  Background:
    Given user "alice" is signed up and signed in as "alice" with email "alice@example.com"
    And user "bob" is signed up with username "bob" and email "bob@example.com"
    And "alice" has a list named "Shared shopping"

  Scenario: Invite email lands in Mailpit and Bob gains access
    When "alice" invites "bob" to "Shared shopping"
    Then "bob" receives an email with subject containing "Shared shopping"
    When "bob" signs in and opens the invite link
    Then "bob" sees "Shared shopping" in their sidebar

  Scenario: Real-time sync between owner and collaborator
    Given "bob" is a collaborator on "Shared shopping"
    And "alice" has "Shared shopping" open in a browser
    And "bob" has "Shared shopping" open in a browser
    When "bob" toggles a todo to done
    Then "alice" sees that todo marked done within 1 second

  Scenario: Multi-tab leader election
    Given "bob" is a collaborator on "Shared shopping"
    When "bob" opens "Shared shopping" in two browser tabs
    Then exactly one tab has an open WebSocket to "/trpc-ws"
    When "alice" edits a todo
    Then both "bob" tabs reflect the edit within 1 second

  Scenario: Authorization cascade on removal
    Given "bob" is a collaborator on "Shared shopping"
    And "bob" has "Shared shopping" open in a browser
    When "alice" removes "bob" from "Shared shopping"
    Then "bob" sees "You no longer have access to this list" within 1 second
    And reloading "Shared shopping" shows 403
```

- [ ] **Step 2: Step definitions**

Use the nearest existing feature file as the concrete template — find it:

```bash
ls e2e/steps/
```

Copy the most recent step file that does multi-user sign-up + list
interaction; the existing patterns for `page.request.post`, route
navigation, and BDD parameter types are the reference. The outline for
each scenario's steps:

Create `e2e/steps/collaborators.steps.ts`:

```ts
import { createBdd } from "playwright-bdd";
import { expect, test } from "@playwright/test";
import {
  deleteAllMail,
  waitForMailTo,
} from "../helpers/mailpit.js";

const { Given, When, Then } = createBdd();

// Scenarios covering two users (alice, bob) run in two Playwright
// contexts. Use `test.use({ storageState: ... })` or a per-user fixture
// to hold distinct sessions. See the existing step file noted above for
// the pattern already used by multi-user scenarios.

// Key step implementations — full bodies to write:
//
// "user {string} is signed up and signed in as {string} with email {string}"
//   → sign up via authClient.signUp.email({email, password, name, username})
//   → persist storageState for that user
//
// "{string} has a list named {string}"
//   → use trpc over HTTP or navigate to /todo-lists and create via UI
//
// "{string} invites {string} to {string}"
//   → navigate to the list, click Share, enter username, submit
//
// "{string} receives an email with subject containing {string}"
//   → waitForMailTo(user.email) + assert Subject contains substring
//
// "{string} toggles a todo to done"
//   → click the checkbox for the last todo in the list
//
// "{string} sees that todo marked done within {int} second(s)"
//   → expect(page.locator(...).getAttribute('data-completed')).toBe('true')
//     with Playwright's built-in retry, capped at the timeout
//
// "exactly one tab has an open WebSocket to {string}"
//   → each page registers page.on("websocket", ...) handlers earlier in
//     the scenario; assert the count across the two pages is exactly 1
//
// "reloading {string} shows 403"
//   → page.reload(); expect the AccessLostEmptyState heading to be visible

// For "exactly one tab has an open WebSocket to /trpc-ws":
//   in each Playwright page, inspect page.on("websocket") events during
//   the scenario and assert exactly one open WS per user across the two
//   tabs.

// For "reloading Shared shopping shows 403":
//   assert the list-detail page now renders the access-lost empty state.
```

The full step implementations mirror existing patterns in `e2e/steps/`. Copy conventions from the nearest existing feature (e.g., todo CRUD scenarios).

- [ ] **Step 3: Run**

```bash
make test ARGS="--grep 'Todo list collaborators'"
```

Iterate until green. Expect first-run failures on selector details and timing; fix them by adjusting selectors and adding appropriate `waitFor` calls — do NOT add arbitrary `page.waitForTimeout`.

- [ ] **Step 4: Commit**

```bash
git add e2e/
git commit -m "test(e2e): todo list collaborators — invite, sync, multi-tab, revocation"
```

---

### Task 16: E2E — retry + dead-letter via Bull Board

**Files:**
- Create: `e2e/features/queue-retry.feature`
- Create: `e2e/steps/queue-retry.steps.ts`

- [ ] **Step 1: Feature file**

```gherkin
Feature: Email retry + dead-letter visibility

  Scenario: Failed invite is retried, appears in Bull Board, and manual retry succeeds
    Given "alice" is signed in as admin
    And "bob" is a registered user
    And Mailpit is stopped
    When "alice" invites "bob" to a list
    Then the "email" queue has 1 failed job within 30 seconds
    When "alice" opens "/admin/queues/email/failed"
    Then the failed job's error contains "ECONNREFUSED"
    When Mailpit is started again
    And "alice" clicks Retry on the failed job
    Then "bob" receives the invite email
```

- [ ] **Step 2: Step definitions + failsafe cleanup fixture**

The hard parts are:
- Stopping/starting Mailpit for just this suite (`docker compose -f docker-compose.test.yml stop mailpit` with the suite env).
- Asserting the failed-job count via Bull Board UI.
- Clicking Retry (Bull Board button — inspect actual DOM selector).
- **Failsafe:** if the scenario dies between `stop` and `start` (crashed
  assertion, killed test runner), Mailpit stays down and pollutes every
  later test run. A Playwright `afterEach` fixture ensures Mailpit is
  always running before the next scenario.

```ts
import { createBdd } from "playwright-bdd";
import { expect, test } from "@playwright/test";
import { execSync } from "node:child_process";
import { testDbEnv } from "@project/test-infra";

const { Given, When, Then } = createBdd();
const env = testDbEnv("e2e");

function composeEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    TEST_CONTAINER: env.TEST_CONTAINER,
    TEST_PORT: String(env.TEST_PORT),
    TEST_REDIS_CONTAINER: env.TEST_REDIS_CONTAINER,
    TEST_REDIS_PORT: String(env.TEST_REDIS_PORT),
    TEST_MAILPIT_CONTAINER: env.TEST_MAILPIT_CONTAINER,
    TEST_MAILPIT_SMTP_PORT: String(env.TEST_MAILPIT_SMTP_PORT),
    TEST_MAILPIT_HTTP_PORT: String(env.TEST_MAILPIT_HTTP_PORT),
  };
}

function startMailpit(): void {
  execSync(
    `docker compose -p agentic-web-stack-test -f docker-compose.test.yml start mailpit`,
    { env: composeEnv(), stdio: "inherit" },
  );
}

function stopMailpit(): void {
  execSync(
    `docker compose -p agentic-web-stack-test -f docker-compose.test.yml stop mailpit`,
    { env: composeEnv(), stdio: "inherit" },
  );
}

// Failsafe: always restore Mailpit after every scenario so a mid-test
// crash doesn't leave it stopped for the next run.
test.afterEach(async () => {
  try {
    startMailpit();
  } catch {
    // already running — ignore
  }
});

Given("Mailpit is stopped", () => {
  stopMailpit();
});

When("Mailpit is started again", () => {
  startMailpit();
});

// ... remaining steps — adapt from collaborators.steps.ts patterns.
```

- [ ] **Step 3: Run**

```bash
make test ARGS="--grep 'Email retry'"
```

Iterate to green.

- [ ] **Step 4: Commit**

```bash
git add e2e/
git commit -m "test(e2e): email retry + dead-letter + manual Bull Board retry"
```

---

## Verification Checklist

- [ ] `make lint` PASS (including `scripts/check-trpc-patterns.ts` from Plan B Task 3.5)
- [ ] `make test-unit` PASS (all existing tests + realtime contract + todo-list collaborator tests — invite/accept/remove/listAccessible/deleteExpiredInvites)
- [ ] `make test ARGS="--grep 'Todo list collaborators'"` PASS (4 scenarios)
- [ ] `make test ARGS="--grep 'Email retry'"` PASS (1 scenario) — also verifies the `afterEach` Mailpit-restart fixture by running twice in a row
- [ ] Manual: two browser windows — Alice and Bob — live sync works; removing Bob produces the access-lost empty state within 1s
- [ ] Manual: browse `/admin/queues` as admin, see both `email` and `maintenance` queues with recent jobs
- [ ] Manual: confirm the repeatable `expire-invites` scheduler shows in Bull Board's Repeatable tab
- [ ] Manual: open a list in two tabs — `navigator.locks.query()` in DevTools shows exactly one held `leader-tab:<userId>` lock; closing the leader tab promotes the peer within ~100ms
