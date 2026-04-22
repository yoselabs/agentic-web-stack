# Tracked Activity Feed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an append-only activity feed on the todo-list detail page that demonstrates tRPC `tracked()` resumable subscriptions — reconnecting clients replay missed events from the DB, not a full refetch.

**Architecture:** New `activity-feed` domain (Prisma `ActivityEvent` table + tRPC domain + web feature). Existing todo-list service mutations record ActivityEvent rows inside the same transaction, then publish to a realtime channel after commit. Subscription handler yields `tracked(event.id, event)`; on reconnect with `lastEventId`, it gap-fills from the DB (`WHERE id > lastEventId`) before tailing live. The DB *is* the replay buffer — no Redis Stream, no ring buffer, just reuse the domain table. Over the replay cap (500 events / 24h), the server emits a `resync` sentinel and the client falls back to a full fetch.

**Tech Stack:** Prisma + PostgreSQL, tRPC v11 (`tracked()` + `lastEventId`), existing `packages/realtime` (Redis pub/sub for transport), TanStack Start + Query on the web, playwright-bdd for E2E.

**Why this demo:** Activity feed is the smallest surface where `tracked()` genuinely pays off — ordered deltas where "Alice did 3 things while you were offline" must visibly stream in, not silently refetch. It also gives the convention doc its exhibit: "use tracked() here, don't use it for invalidate-style events."

---

## File Structure

**Create:**
- `packages/db/prisma/schema/activity-event.prisma` — new Prisma model file (schema is split — see existing `todo-list.prisma`)
- `packages/api/src/domains/activity-feed/events.ts` — event-kind SSOT
- `packages/api/src/domains/activity-feed/service.ts` — `recordEvent`, `listEvents`, `streamEvents`
- `packages/api/src/domains/activity-feed/router.ts` — `list` query + `onListEvents` subscription
- `packages/api/src/domains/activity-feed/constants.ts` — replay caps
- `packages/api/src/domains/activity-feed/__tests__/service.test.ts`
- `packages/api/src/domains/activity-feed/__tests__/router.test.ts`
- `apps/web/src/features/activity-feed/use-activity-feed.ts`
- `apps/web/src/features/activity-feed/activity-feed-panel.tsx`
- `apps/web/src/features/activity-feed/activity-feed-panel.stories.tsx`
- `apps/web/src/features/activity-feed/format-event.ts` — kind → human string
- `e2e/features/activity-feed/activity-feed.feature`
- `e2e/steps/activity-feed/activity-feed.ts`

**Modify:**
- `packages/api/src/router.ts` — register `activity` router
- `packages/api/src/domains/todo-list/service.ts` — emit activity events in every mutation
- `packages/api/src/domains/todo-list/todo-service.ts` — emit activity events in every mutation
- `apps/web/src/routes/_authenticated/todo-lists/$listId.tsx` — mount `<ActivityFeedPanel />` sidebar
- `docs/conventions.md` — new section: "When to use `tracked()`"
- `docs/capabilities.md` — add activity-feed entry

**Generated / won't touch by hand:** `packages/db/src/generated/`, `apps/web/src/routeTree.gen.ts`, `e2e/.features-gen/`.

---

## Task 1: Gherkin spec (source of truth before code)

> Per `docs/testing-guidelines.md` and BDD-first convention: write the behavior contract first. Step defs come AFTER the UI exists (Task 12) because they need real selectors.

**Files:**
- Create: `e2e/features/activity-feed/activity-feed.feature`

- [ ] **Step 1: Write the feature file**

```gherkin
Feature: Activity feed on todo list

  Members of a todo list see an append-only feed of what other members do —
  creates, checks, renames, membership changes. The feed is resumable: a client
  who was offline while events happened sees those events stream in on reconnect,
  in order, without a full page refetch.

  Background:
    Given a user "Alice" with email "alice@example.com"
    And a user "Bob" with email "bob@example.com"
    And Alice has a todo list "Groceries"
    And Bob is a collaborator on "Groceries"

  @activity-feed
  Scenario: Live events appear as other members act
    Given Alice is signed in and viewing "Groceries"
    And Bob is signed in in a second browser and viewing "Groceries"
    When Bob adds a todo "buy milk"
    Then Alice sees an activity entry "Bob added buy milk" within 3 seconds
    When Bob checks the todo "buy milk"
    Then Alice sees an activity entry "Bob completed buy milk" within 3 seconds

  @activity-feed @resume
  Scenario: Missed events replay in order on reconnect
    Given Alice is signed in and viewing "Groceries"
    And Bob is signed in in a second browser and viewing "Groceries"
    When Alice's websocket is severed
    And Bob adds a todo "buy bread"
    And Bob adds a todo "buy eggs"
    And Bob checks the todo "buy bread"
    And Alice's websocket reconnects
    Then within 5 seconds Alice sees activity entries in this order:
      | Bob added buy bread        |
      | Bob added buy eggs         |
      | Bob completed buy bread    |
    And Alice's todo query was not refetched during reconnect

  @activity-feed
  Scenario: Revoked member stops receiving activity
    Given Alice is signed in and viewing "Groceries"
    And Bob is signed in in a second browser and viewing "Groceries"
    When Alice removes Bob from the list
    And Alice adds a todo "buy cheese"
    Then Bob does not see the activity entry "Alice added buy cheese"
```

- [ ] **Step 2: Commit**

```bash
git add e2e/features/activity-feed/activity-feed.feature
git commit -m "spec(activity-feed): gherkin scenarios for live + resume"
```

---

## Task 2: Prisma schema — `ActivityEvent` model

**Files:**
- Create: `packages/db/prisma/schema/activity-event.prisma`

- [ ] **Step 1: Add the model**

Follow the style of `packages/db/prisma/schema/todo-list.prisma`. The schema is a split multi-file Prisma schema.

```prisma
model ActivityEvent {
  id         String   @id @default(cuid())
  todoListId String
  actorId    String
  kind       String
  payload    Json
  createdAt  DateTime @default(now())

  todoList TodoList @relation(fields: [todoListId], references: [id], onDelete: Cascade)
  actor    User     @relation(fields: [actorId], references: [id], onDelete: Cascade)

  @@index([todoListId, id])
  @@index([todoListId, createdAt])
  @@map("activity_event")
}
```

**Notes for the engineer:**
- `cuid` is lexicographically sortable by creation time → safe to use `id > lastEventId` as gap-fill cursor.
- `payload` holds event-kind-specific shape (e.g. `{ todoId, title }`). Typed on the app side (see Task 3), opaque to Prisma.
- `@@index([todoListId, id])` is the critical index — gap-fill and pagination both key off it.

- [ ] **Step 2: Add back-relations to existing models**

In `packages/db/prisma/schema/todo-list.prisma`, append to the `TodoList` model:
```prisma
  activityEvents ActivityEvent[]
```

In `packages/db/prisma/schema/auth.prisma`, append to the `User` model:
```prisma
  activityEvents ActivityEvent[]
```

- [ ] **Step 3: Push schema and regenerate client**

```bash
make db-push
```

Expected: Postgres `activity_event` table created, `@project/db` regenerated. If it asks about data loss, read carefully — there should be none (new table only).

- [ ] **Step 4: Verify generated types**

```bash
grep -r "ActivityEvent" packages/db/src/generated | head -5
```

Expected: `ActivityEvent` type appears in the generated client.

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/schema/
git commit -m "feat(db): add ActivityEvent model for activity feed"
```

---

## Task 3: API domain scaffold — events SSOT + service skeleton

**Files:**
- Create: `packages/api/src/domains/activity-feed/events.ts`
- Create: `packages/api/src/domains/activity-feed/constants.ts`
- Create: `packages/api/src/domains/activity-feed/service.ts` (skeleton)

- [ ] **Step 1: Write the event-kind SSOT**

Pattern from `packages/api/src/domains/todo-list/events.ts` — const tuple → derived type.

```typescript
// packages/api/src/domains/activity-feed/events.ts
import type { ActivityEvent as DbActivityEvent } from "@project/db";

export const ACTIVITY_EVENT_KINDS = [
  "todo-created",
  "todo-updated",
  "todo-completed",
  "todo-uncompleted",
  "todo-deleted",
  "list-renamed",
  "member-added",
  "member-removed",
] as const;

export type ActivityEventKind = (typeof ACTIVITY_EVENT_KINDS)[number];

export type ActivityEventPayload =
  | { kind: "todo-created"; todoId: string; title: string }
  | { kind: "todo-updated"; todoId: string; title: string }
  | { kind: "todo-completed"; todoId: string; title: string }
  | { kind: "todo-uncompleted"; todoId: string; title: string }
  | { kind: "todo-deleted"; todoId: string; title: string }
  | { kind: "list-renamed"; from: string; to: string }
  | { kind: "member-added"; memberId: string; memberName: string }
  | { kind: "member-removed"; memberId: string; memberName: string };

export type ActivityEventRecord = Omit<DbActivityEvent, "payload"> & {
  payload: ActivityEventPayload;
};

// Event envelope yielded by the subscription.
// "event" = normal tracked event. "resync" = client lastEventId is beyond
// replay cap; client must fall back to full fetch.
export type ActivityEventEnvelope =
  | { kind: "event"; event: ActivityEventRecord }
  | { kind: "resync"; reason: "gap-too-large" | "event-expired" };

export function activityChannelKey(todoListId: string): string {
  return `activity:list:${todoListId}`;
}
```

- [ ] **Step 2: Write the constants**

```typescript
// packages/api/src/domains/activity-feed/constants.ts
/** Max events replayed on reconnect via tracked(). Over this → resync sentinel. */
export const ACTIVITY_REPLAY_GAP_MAX = 500;

/** Events older than this aren't replayed via tracked() even if under the gap cap. */
export const ACTIVITY_REPLAY_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h

/** Max events returned by the paginated list query. */
export const ACTIVITY_LIST_PAGE_SIZE = 50;
```

- [ ] **Step 3: Write the service skeleton (just exports + types, no bodies)**

```typescript
// packages/api/src/domains/activity-feed/service.ts
import type { Prisma, PrismaClient } from "@project/db";
import type { Channel } from "@project/realtime";
import type {
  ActivityEventEnvelope,
  ActivityEventPayload,
  ActivityEventRecord,
} from "./events";

export type RecordEventInput = {
  todoListId: string;
  actorId: string;
  payload: ActivityEventPayload;
};

export async function recordActivityEvent(
  _tx: Prisma.TransactionClient,
  _input: RecordEventInput,
): Promise<ActivityEventRecord> {
  throw new Error("not implemented");
}

export type ListEventsInput = {
  todoListId: string;
  limit?: number;
  cursor?: string; // event id
};

export async function listActivityEvents(
  _db: PrismaClient,
  _input: ListEventsInput,
): Promise<{ items: ActivityEventRecord[]; nextCursor: string | null }> {
  throw new Error("not implemented");
}

export type StreamEventsInput = {
  todoListId: string;
  lastEventId?: string;
  channel: Channel<ActivityEventRecord>;
  signal?: AbortSignal;
};

export async function* streamActivityEvents(
  _db: PrismaClient,
  _input: StreamEventsInput,
): AsyncGenerator<ActivityEventEnvelope> {
  throw new Error("not implemented");
  yield* [];
}
```

- [ ] **Step 4: Typecheck**

```bash
make lint
```

Expected: passes (stubs are well-typed).

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/domains/activity-feed/
git commit -m "feat(api): activity-feed domain scaffold + events SSOT"
```

---

## Task 4: `recordActivityEvent` — implementation + unit tests

**Files:**
- Modify: `packages/api/src/domains/activity-feed/service.ts`
- Create: `packages/api/src/domains/activity-feed/__tests__/service.test.ts`

- [ ] **Step 1: Write the failing test**

Follow `docs/testing-guidelines.md` — unit tests for service use the isolated `unit-suite` Postgres (`packages/test-infra`). See existing `packages/api/src/domains/todo-list/__tests__/service.test.ts` for the harness.

```typescript
// packages/api/src/domains/activity-feed/__tests__/service.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { testDb } from "@project/test-infra/db";
import { recordActivityEvent } from "../service";

describe("recordActivityEvent", () => {
  const db = testDb();
  let userId: string;
  let listId: string;

  beforeEach(async () => {
    const user = await db.user.create({
      data: { email: `u-${crypto.randomUUID()}@t.test`, name: "T", emailVerified: true },
    });
    userId = user.id;
    const list = await db.todoList.create({
      data: { name: "L", ownerId: userId },
    });
    listId = list.id;
  });

  it("persists an event with typed payload and returns the row", async () => {
    const event = await db.$transaction(async (tx) =>
      recordActivityEvent(tx, {
        todoListId: listId,
        actorId: userId,
        payload: { kind: "todo-created", todoId: "t1", title: "buy milk" },
      }),
    );

    expect(event.kind).toBe("todo-created");
    expect(event.payload).toEqual({ kind: "todo-created", todoId: "t1", title: "buy milk" });
    expect(event.todoListId).toBe(listId);
    expect(event.actorId).toBe(userId);
    expect(event.id).toMatch(/^c/); // cuid prefix
  });

  it("events from the same millisecond sort by id ascending", async () => {
    const events = await db.$transaction(async (tx) =>
      Promise.all(
        ["a", "b", "c"].map((t) =>
          recordActivityEvent(tx, {
            todoListId: listId,
            actorId: userId,
            payload: { kind: "todo-created", todoId: t, title: t },
          }),
        ),
      ),
    );
    const sorted = [...events].sort((x, y) => x.id.localeCompare(y.id));
    expect(sorted.map((e) => (e.payload as { todoId: string }).todoId)).toEqual(["a", "b", "c"]);
  });
});
```

- [ ] **Step 2: Run the test — expect failure**

```bash
make test-unit ARGS="packages/api/src/domains/activity-feed"
```

Expected: FAIL with `not implemented`.

- [ ] **Step 3: Implement `recordActivityEvent`**

Replace the stub in `service.ts`:

```typescript
export async function recordActivityEvent(
  tx: Prisma.TransactionClient,
  input: RecordEventInput,
): Promise<ActivityEventRecord> {
  const row = await tx.activityEvent.create({
    data: {
      todoListId: input.todoListId,
      actorId: input.actorId,
      kind: input.payload.kind,
      payload: input.payload,
    },
  });
  return { ...row, payload: row.payload as ActivityEventPayload };
}
```

- [ ] **Step 4: Run the test — expect pass**

```bash
make test-unit ARGS="packages/api/src/domains/activity-feed"
```

Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/domains/activity-feed/
git commit -m "feat(api): recordActivityEvent persists typed payload"
```

---

## Task 5: `listActivityEvents` — paginated query + tests

**Files:**
- Modify: `packages/api/src/domains/activity-feed/service.ts`
- Modify: `packages/api/src/domains/activity-feed/__tests__/service.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `service.test.ts`:

```typescript
import { listActivityEvents } from "../service";
import { ACTIVITY_LIST_PAGE_SIZE } from "../constants";

describe("listActivityEvents", () => {
  const db = testDb();
  // same beforeEach as above — extract to shared setup or duplicate

  it("returns events newest-first within a list", async () => {
    // seed 3 events
    // ...
    const page = await listActivityEvents(db, { todoListId: listId });
    expect(page.items.map((e) => (e.payload as { todoId: string }).todoId)).toEqual([
      "c", "b", "a", // newest first
    ]);
    expect(page.nextCursor).toBeNull();
  });

  it("paginates via cursor (descending by id)", async () => {
    // seed 75 events
    const first = await listActivityEvents(db, { todoListId: listId, limit: 50 });
    expect(first.items).toHaveLength(50);
    expect(first.nextCursor).not.toBeNull();

    const second = await listActivityEvents(db, {
      todoListId: listId,
      limit: 50,
      cursor: first.nextCursor!,
    });
    expect(second.items).toHaveLength(25);
    expect(second.nextCursor).toBeNull();
  });

  it("scopes strictly to the given list", async () => {
    // seed events on a different list, assert not returned
  });
});
```

- [ ] **Step 2: Run — expect fail**

```bash
make test-unit ARGS="packages/api/src/domains/activity-feed"
```

- [ ] **Step 3: Implement `listActivityEvents`**

```typescript
export async function listActivityEvents(
  db: PrismaClient,
  input: ListEventsInput,
): Promise<{ items: ActivityEventRecord[]; nextCursor: string | null }> {
  const limit = Math.min(input.limit ?? ACTIVITY_LIST_PAGE_SIZE, ACTIVITY_LIST_PAGE_SIZE);
  const rows = await db.activityEvent.findMany({
    where: {
      todoListId: input.todoListId,
      ...(input.cursor ? { id: { lt: input.cursor } } : {}),
    },
    orderBy: { id: "desc" },
    take: limit + 1,
  });
  const hasMore = rows.length > limit;
  const items = (hasMore ? rows.slice(0, limit) : rows).map((r) => ({
    ...r,
    payload: r.payload as ActivityEventPayload,
  }));
  return {
    items,
    nextCursor: hasMore ? items[items.length - 1].id : null,
  };
}
```

- [ ] **Step 4: Run — expect pass**

```bash
make test-unit ARGS="packages/api/src/domains/activity-feed"
```

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/domains/activity-feed/
git commit -m "feat(api): listActivityEvents with cursor pagination"
```

---

## Task 6: `streamActivityEvents` — tracked subscription with gap-fill + resync

This is the core of the feature. The generator:
1. Subscribes to the realtime channel (in-memory or Redis-backed) and buffers live events as they arrive.
2. If `lastEventId` is provided: gap-fills from DB (`id > lastEventId`, up to cap).
3. If the gap would exceed the cap OR the last event is older than `ACTIVITY_REPLAY_MAX_AGE_MS`, yields `resync` sentinel and skips gap-fill.
4. Yields each gap event, tracking `lastYieldedId`.
5. Drains the live buffer + tails new publishes; skips any id `<= lastYieldedId` (dedup overlap).

**Files:**
- Modify: `packages/api/src/domains/activity-feed/service.ts`
- Modify: `packages/api/src/domains/activity-feed/__tests__/service.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { MemoryChannelFactory } from "@project/realtime";
import { streamActivityEvents } from "../service";
import { activityChannelKey } from "../events";
import { ACTIVITY_REPLAY_GAP_MAX } from "../constants";

describe("streamActivityEvents", () => {
  const db = testDb();
  // shared setup

  async function collect<T>(gen: AsyncGenerator<T>, max: number, signal: AbortSignal): Promise<T[]> {
    const out: T[] = [];
    for await (const v of gen) {
      out.push(v);
      if (out.length >= max) break;
    }
    return out;
  }

  it("tails live events when no lastEventId is provided", async () => {
    const factory = new MemoryChannelFactory();
    const channel = factory.get(activityChannelKey(listId));
    const ac = new AbortController();
    const gen = streamActivityEvents(db, { todoListId: listId, channel, signal: ac.signal });

    // publish after subscribe
    queueMicrotask(async () => {
      const ev = await db.$transaction((tx) =>
        recordActivityEvent(tx, {
          todoListId: listId,
          actorId: userId,
          payload: { kind: "todo-created", todoId: "x", title: "x" },
        }),
      );
      await channel.publish(ev);
    });

    const [envelope] = await collect(gen, 1, ac.signal);
    ac.abort();
    expect(envelope.kind).toBe("event");
    if (envelope.kind === "event") expect(envelope.event.payload).toMatchObject({ todoId: "x" });
  });

  it("replays gap from DB when lastEventId is provided, in order", async () => {
    // seed 3 events "a", "b", "c"
    const factory = new MemoryChannelFactory();
    const channel = factory.get(activityChannelKey(listId));
    const ac = new AbortController();

    const gen = streamActivityEvents(db, {
      todoListId: listId,
      lastEventId: events[0].id, // pretend we have event "a", missed "b" and "c"
      channel,
      signal: ac.signal,
    });

    const got = await collect(gen, 2, ac.signal);
    ac.abort();
    expect(got.map((e) => e.kind)).toEqual(["event", "event"]);
    const ids = got.flatMap((e) => (e.kind === "event" ? [e.event.id] : []));
    expect(ids).toEqual([events[1].id, events[2].id]);
  });

  it("yields resync sentinel when gap exceeds ACTIVITY_REPLAY_GAP_MAX", async () => {
    // seed ACTIVITY_REPLAY_GAP_MAX + 5 events
    const factory = new MemoryChannelFactory();
    const channel = factory.get(activityChannelKey(listId));
    const ac = new AbortController();

    const gen = streamActivityEvents(db, {
      todoListId: listId,
      lastEventId: "c000000000000000000000000", // ancient cuid
      channel,
      signal: ac.signal,
    });

    const [first] = await collect(gen, 1, ac.signal);
    ac.abort();
    expect(first).toEqual({ kind: "resync", reason: "gap-too-large" });
  });

  it("dedups overlap between gap-fill and live buffer", async () => {
    // seed "a", "b"
    // start subscription with lastEventId = "a"
    // publish "b" to channel *while* gap-fill is running
    // assert "b" appears exactly once
  });
});
```

- [ ] **Step 2: Run — expect fail**

```bash
make test-unit ARGS="packages/api/src/domains/activity-feed"
```

- [ ] **Step 3: Implement `streamActivityEvents`**

```typescript
import { ACTIVITY_REPLAY_GAP_MAX, ACTIVITY_REPLAY_MAX_AGE_MS } from "./constants";

export async function* streamActivityEvents(
  db: PrismaClient,
  input: StreamEventsInput,
): AsyncGenerator<ActivityEventEnvelope> {
  const buffered: ActivityEventRecord[] = [];
  let bufferResolve: (() => void) | null = null;

  const unsub = await input.channel.subscribe((event) => {
    buffered.push(event);
    bufferResolve?.();
  });

  input.signal?.addEventListener("abort", () => {
    void unsub();
    bufferResolve?.();
  });

  try {
    let lastYieldedId: string | null = input.lastEventId ?? null;

    // 1. Gap-fill from DB if a cursor was given.
    if (input.lastEventId) {
      // Count first — cheap. Over cap → resync.
      const gapCount = await db.activityEvent.count({
        where: { todoListId: input.todoListId, id: { gt: input.lastEventId } },
      });

      if (gapCount > ACTIVITY_REPLAY_GAP_MAX) {
        yield { kind: "resync", reason: "gap-too-large" };
      } else if (gapCount > 0) {
        const oldest = await db.activityEvent.findFirst({
          where: { todoListId: input.todoListId, id: { gt: input.lastEventId } },
          orderBy: { id: "asc" },
          select: { createdAt: true },
        });
        if (oldest && Date.now() - oldest.createdAt.getTime() > ACTIVITY_REPLAY_MAX_AGE_MS) {
          yield { kind: "resync", reason: "event-expired" };
        } else {
          const gap = await db.activityEvent.findMany({
            where: { todoListId: input.todoListId, id: { gt: input.lastEventId } },
            orderBy: { id: "asc" },
            take: ACTIVITY_REPLAY_GAP_MAX,
          });
          for (const row of gap) {
            const rec = { ...row, payload: row.payload as ActivityEventPayload };
            yield { kind: "event", event: rec };
            lastYieldedId = rec.id;
          }
        }
      }
    }

    // 2. Drain buffer + tail live. Dedup anything <= lastYieldedId.
    while (!input.signal?.aborted) {
      while (buffered.length > 0) {
        const ev = buffered.shift()!;
        if (lastYieldedId && ev.id <= lastYieldedId) continue;
        yield { kind: "event", event: ev };
        lastYieldedId = ev.id;
      }
      await new Promise<void>((resolve) => {
        bufferResolve = resolve;
      });
      bufferResolve = null;
    }
  } finally {
    await unsub();
  }
}
```

- [ ] **Step 4: Run — expect pass**

```bash
make test-unit ARGS="packages/api/src/domains/activity-feed"
```

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/domains/activity-feed/
git commit -m "feat(api): streamActivityEvents with gap-fill + resync sentinel"
```

---

## Task 7: Wire emission into existing todo-list mutations

Each existing mutation in the `todo-list` domain service calls `recordActivityEvent` inside its `$transaction`, then publishes after commit. **Pattern: INSERT then PUBLISH, never reverse** (so gap-fill is always a superset of pub/sub).

**Files:**
- Modify: `packages/api/src/domains/todo-list/service.ts`
- Modify: `packages/api/src/domains/todo-list/todo-service.ts`

- [ ] **Step 1: Add a shared helper at the top of `todo-service.ts`**

```typescript
import { recordActivityEvent } from "@project/api/domains/activity-feed/service";
import { activityChannelKey, type ActivityEventPayload, type ActivityEventRecord }
  from "@project/api/domains/activity-feed/events";
import { defaultChannel } from "@project/realtime";

async function emitActivity(
  tx: Prisma.TransactionClient,
  input: { todoListId: string; actorId: string; payload: ActivityEventPayload },
): Promise<ActivityEventRecord> {
  return recordActivityEvent(tx, input);
}

async function publishActivity(event: ActivityEventRecord): Promise<void> {
  await defaultChannel<ActivityEventRecord>(activityChannelKey(event.todoListId)).publish(event);
}
```

- [ ] **Step 2: Update every mutation**

For each of:
- `createTodo` → emit `{ kind: "todo-created", todoId, title }`
- `updateTodo` (when title changed) → `todo-updated`
- `toggleTodo` → `todo-completed` or `todo-uncompleted` based on new state
- `deleteTodo` → `todo-deleted`
- `renameTodoList` → `list-renamed`
- `addMember` → `member-added`
- `removeMember` → `member-removed`

The pattern in each mutation:

```typescript
export async function createTodo(db: PrismaClient, input: CreateTodoInput, actorId: string) {
  const { todo, activityEvent } = await db.$transaction(async (tx) => {
    const todo = await tx.todo.create({ data: { ... } });
    const activityEvent = await emitActivity(tx, {
      todoListId: input.todoListId,
      actorId,
      payload: { kind: "todo-created", todoId: todo.id, title: todo.title },
    });
    return { todo, activityEvent };
  });

  // existing todo-list realtime event (invalidate-style) stays
  await provider(listChannelKey(input.todoListId)).publish({
    kind: "todo-created", listId: input.todoListId, todo,
  });
  // NEW — activity event for the activity-feed subscription
  await publishActivity(activityEvent);

  return todo;
}
```

**Actor id:** every service fn that performs a mutation needs `actorId` threaded through. Check the caller — router procs already have `ctx.session.user.id`. If the service signature doesn't already accept it, add it as a required arg. Update callers in the router at the same time.

- [ ] **Step 3: Update existing unit tests that call these service fns**

Callers that pass positional args: add `actorId`. Tests should seed a user and pass `user.id`. Don't mock — same guidance as the rest of the repo.

- [ ] **Step 4: Add a focused emission test per mutation**

E.g. in `packages/api/src/domains/todo-list/__tests__/todo-service.test.ts`:

```typescript
it("createTodo emits a todo-created activity event", async () => {
  const todo = await createTodo(db, { todoListId: listId, title: "buy milk" }, userId);
  const events = await db.activityEvent.findMany({ where: { todoListId: listId } });
  expect(events).toHaveLength(1);
  expect(events[0].kind).toBe("todo-created");
  expect(events[0].payload).toMatchObject({ todoId: todo.id, title: "buy milk" });
  expect(events[0].actorId).toBe(userId);
});
```

Repeat for each mutation (7 tests total).

- [ ] **Step 5: Run full unit suite**

```bash
make test-unit
```

Expected: all existing tests still green, 7 new emission tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/domains/todo-list/
git commit -m "feat(api): todo-list mutations emit activity events"
```

---

## Task 8: Router — `activity.list` query + `activity.onListEvents` subscription

**Files:**
- Create: `packages/api/src/domains/activity-feed/router.ts`
- Modify: `packages/api/src/router.ts`
- Create: `packages/api/src/domains/activity-feed/__tests__/router.test.ts`

- [ ] **Step 1: Write the router**

Follow `packages/api/src/domains/todo-list/router.ts` shape.

```typescript
// packages/api/src/domains/activity-feed/router.ts
import { z } from "zod";
import { tracked, TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "@project/api/trpc";
import { defaultChannel } from "@project/realtime";
import { canReadList } from "@project/api/domains/todo-list/authz";
import { listActivityEvents, streamActivityEvents } from "./service";
import { activityChannelKey, type ActivityEventRecord } from "./events";
import { ACTIVITY_LIST_PAGE_SIZE } from "./constants";

export const activityFeedRouter = router({
  list: protectedProcedure
    .input(
      z.strictObject({
        todoListId: z.string().min(1),
        cursor: z.string().min(1).optional(),
        limit: z.number().int().min(1).max(ACTIVITY_LIST_PAGE_SIZE).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      if (!(await canReadList(ctx.db, ctx.session.user.id, input.todoListId))) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      return listActivityEvents(ctx.db, input);
    }),

  onListEvents: protectedProcedure
    .input(z.strictObject({ todoListId: z.string().min(1) }))
    .subscription(async function* ({ ctx, input, signal, lastEventId }) {
      if (!(await canReadList(ctx.db, ctx.session.user.id, input.todoListId))) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const channel = defaultChannel<ActivityEventRecord>(activityChannelKey(input.todoListId));
      for await (const envelope of streamActivityEvents(ctx.db, {
        todoListId: input.todoListId,
        lastEventId,
        channel,
        signal,
      })) {
        if (envelope.kind === "event") {
          yield tracked(envelope.event.id, envelope);
        } else {
          // resync sentinel — no id to track against
          yield envelope;
        }
      }
    }),
});
```

**Note on `lastEventId`:** tRPC v11's subscription procedure receives `lastEventId` automatically on reconnect if the client uses `wsLink`/`httpSubscriptionLink` and a prior event was `tracked()`. No client-side state to thread manually for the envelope case.

- [ ] **Step 2: Register the router**

In `packages/api/src/router.ts`, add (alpha-sorted):
```typescript
import { activityFeedRouter } from "./domains/activity-feed/router";
// ...
export const appRouter = router({
  activity: activityFeedRouter,
  // ...
});
```

- [ ] **Step 3: Write an integration test for the router**

```typescript
// packages/api/src/domains/activity-feed/__tests__/router.test.ts
import { describe, it, expect } from "vitest";
import { createCaller } from "@project/api/test-utils"; // existing helper, check exact path
// ... test: seed list + events, call activity.list as owner, expect newest-first + pagination.
// ... test: non-member calling activity.list throws FORBIDDEN.
```

- [ ] **Step 4: Run full lint + unit**

```bash
make lint && make test-unit
```

- [ ] **Step 5: Commit**

```bash
git add packages/api/
git commit -m "feat(api): activity.list + activity.onListEvents tracked subscription"
```

---

## Task 9: Web — `use-activity-feed` hook

**Files:**
- Create: `apps/web/src/features/activity-feed/use-activity-feed.ts`
- Create: `apps/web/src/features/activity-feed/format-event.ts`

Pattern from `apps/web/src/features/todo-list/use-todo-list-live-updates.ts`.

- [ ] **Step 1: Write `format-event.ts`**

Pure kind → human string mapping:

```typescript
// apps/web/src/features/activity-feed/format-event.ts
import type { ActivityEventRecord } from "@project/api/domains/activity-feed/events";

export function formatActivityEvent(event: ActivityEventRecord, actorName: string): string {
  const p = event.payload;
  switch (p.kind) {
    case "todo-created":     return `${actorName} added ${p.title}`;
    case "todo-updated":     return `${actorName} renamed to ${p.title}`;
    case "todo-completed":   return `${actorName} completed ${p.title}`;
    case "todo-uncompleted": return `${actorName} reopened ${p.title}`;
    case "todo-deleted":     return `${actorName} deleted ${p.title}`;
    case "list-renamed":     return `${actorName} renamed list from "${p.from}" to "${p.to}"`;
    case "member-added":     return `${actorName} added ${p.memberName}`;
    case "member-removed":   return `${actorName} removed ${p.memberName}`;
  }
}
```

Unit test: one case per kind, snapshot-free explicit assertions.

- [ ] **Step 2: Write `use-activity-feed.ts`**

Hook composes:
1. `useQuery` for initial page via `trpc.activity.list.queryOptions({ todoListId })`.
2. `useSubscription` for `trpc.activity.onListEvents` — appends live events to a local `events` state array, deduping by id.
3. On `resync` envelope → call `queryClient.invalidateQueries` for the list query and clear local state.

```typescript
import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTRPC, useSubscription } from "@project/web/trpc"; // path per existing pattern
import type {
  ActivityEventEnvelope,
  ActivityEventRecord,
} from "@project/api/domains/activity-feed/events";

export function useActivityFeed(todoListId: string) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [liveEvents, setLiveEvents] = useState<ActivityEventRecord[]>([]);

  const initial = useQuery(trpc.activity.list.queryOptions({ todoListId }));

  const onData = useCallback(
    (envelope: ActivityEventEnvelope) => {
      if (envelope.kind === "resync") {
        setLiveEvents([]);
        void queryClient.invalidateQueries({
          queryKey: trpc.activity.list.queryKey({ todoListId }),
        });
        return;
      }
      setLiveEvents((prev) => {
        if (prev.some((e) => e.id === envelope.event.id)) return prev;
        return [envelope.event, ...prev];
      });
    },
    [queryClient, trpc, todoListId],
  );

  useSubscription(trpc.activity.onListEvents, { todoListId }, { onData });

  const merged = mergeById([...liveEvents, ...(initial.data?.items ?? [])]);
  return { events: merged, isLoading: initial.isLoading };
}
```

- [ ] **Step 3: Lint**

```bash
make lint
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/features/activity-feed/
git commit -m "feat(web): useActivityFeed hook with resync handling"
```

---

## Task 10: Web — `ActivityFeedPanel` component + story

**Files:**
- Create: `apps/web/src/features/activity-feed/activity-feed-panel.tsx`
- Create: `apps/web/src/features/activity-feed/activity-feed-panel.stories.tsx`

- [ ] **Step 1: Write the component**

Scrollable list, newest at top. Each row shows actor name + formatted action + relative time. No mutations, no click handlers — pure display.

```tsx
// activity-feed-panel.tsx
import { useActivityFeed } from "./use-activity-feed";
import { formatActivityEvent } from "./format-event";

export function ActivityFeedPanel({ todoListId }: { todoListId: string }) {
  const { events, isLoading } = useActivityFeed(todoListId);

  if (isLoading) return <aside aria-label="Activity feed" data-testid="activity-feed">…</aside>;

  return (
    <aside
      aria-label="Activity feed"
      data-testid="activity-feed"
      className="w-80 border-l p-4 overflow-y-auto"
    >
      <h3 className="text-sm font-semibold mb-2">Activity</h3>
      {events.length === 0 ? (
        <p className="text-sm text-muted-foreground">No activity yet.</p>
      ) : (
        <ul className="space-y-2">
          {events.map((e) => (
            <li key={e.id} className="text-sm" data-activity-kind={e.payload.kind}>
              <span>{formatActivityEvent(e, e.actor.name)}</span>
              <time className="block text-xs text-muted-foreground">
                {new Date(e.createdAt).toLocaleTimeString()}
              </time>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
```

**Note:** the row key is `e.id`, test selector hook is `data-testid="activity-feed"` + text match via Gherkin.

**`e.actor.name` — data shape:** the API currently returns `ActivityEventRecord` without the actor relation. Add `include: { actor: { select: { id, name } } }` on both `listActivityEvents` and the stream path, and update the `ActivityEventRecord` type to reflect. Do this now (not earlier) because it's UI-driven.

- [ ] **Step 2: Write a storybook story**

Mock the trpc query via `parameters.msw` or the existing storybook-session decorator. One story per state: empty, single-event, many-events, resync-just-happened.

- [ ] **Step 3: Run storybook project**

```bash
pnpm --filter web test -- --project storybook
```

Expected: story renders, interaction tests pass.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/features/activity-feed/
git commit -m "feat(web): ActivityFeedPanel component + stories"
```

---

## Task 11: Mount the panel on the list detail route

**Files:**
- Modify: `apps/web/src/routes/_authenticated/todo-lists/$listId.tsx`

- [ ] **Step 1: Add loader prefetch for activity**

Append to the existing `loader`:
```typescript
queryClient.fetchQuery(trpc.activity.list.queryOptions({ todoListId: params.listId })),
```

Wrap with the same FORBIDDEN/NOT_FOUND swallowing as the list-detail loader (see commit `edf3823`). Pattern:

```typescript
queryClient.fetchQuery(trpc.activity.list.queryOptions({ todoListId: params.listId }))
  .catch((e) => {
    if (isTRPCClientError(e) && (e.data?.code === "FORBIDDEN" || e.data?.code === "NOT_FOUND")) return;
    throw e;
  }),
```

- [ ] **Step 2: Render the panel**

In the `RouteComponent` or `TodoListDetailPage` composition, add:
```tsx
<div className="flex">
  <main className="flex-1">{/* existing */}</main>
  <ActivityFeedPanel todoListId={listId} />
</div>
```

Check the actual page component — it's `apps/web/src/features/todo-list/todo-list-detail-page.tsx` per the Explore report. Put the panel composition there, not in the route file.

- [ ] **Step 3: Regenerate routes + run dev server**

```bash
make routes
make dev
```

Manually verify in a browser: open a list as the owner, see the panel. Add a todo, see the activity entry appear.

- [ ] **Step 4: Run type check + lint**

```bash
make lint
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/
git commit -m "feat(web): mount ActivityFeedPanel on list detail page"
```

---

## Task 12: E2E — step definitions + BDD to green

> Per CLAUDE.md and docs/testing-guidelines.md: step defs come AFTER UI exists. We now have real selectors (`data-testid="activity-feed"`, row text).

**Files:**
- Create: `e2e/steps/activity-feed/activity-feed.ts`

- [ ] **Step 1: Write step definitions**

Pattern: `e2e/steps/todo-list/todos.ts`. Use existing shared steps where possible (sign-in, create list, add collaborator). For the "websocket severed / reconnect" scenario, use the existing helper in `e2e/steps/` (grep for "websocket" or "cdp" in that directory — realtime tests already do this).

Key new steps:
```typescript
Then("Alice sees an activity entry {string} within 3 seconds", async ({ alicePage }, text: string) => {
  await expect(alicePage.getByTestId("activity-feed").getByText(text)).toBeVisible({ timeout: 3000 });
});

Then(
  "within 5 seconds Alice sees activity entries in this order:",
  async ({ alicePage }, table) => {
    const expected = table.raw().map((r: string[]) => r[0]);
    const feed = alicePage.getByTestId("activity-feed");
    await expect
      .poll(
        async () => (await feed.locator("li").allTextContents()).map((s) => s.replace(/\s+/g, " ").trim()),
        { timeout: 5000 },
      )
      .toEqual(expect.arrayContaining(expected));
    // assert exact order of the matching subset
    const actual = (await feed.locator("li").allTextContents()).map((s) => s.trim());
    const filtered = actual.filter((a) => expected.some((e) => a.includes(e)));
    expect(filtered).toEqual(expected.map((e) => expect.stringContaining(e)));
  },
);

Then(
  "Alice's todo query was not refetched during reconnect",
  async ({ aliceNetworkLog }) => {
    // aliceNetworkLog is set up in background context — records tRPC HTTP paths.
    // After reconnect moment (a timestamp captured in the reconnect step), assert no
    // `todo.list` HTTP request was issued.
    const after = aliceNetworkLog.filter((r) => r.timestamp > aliceNetworkLog.reconnectTs);
    expect(after.some((r) => r.path.includes("todo.list"))).toBe(false);
  },
);
```

The "no refetch" assertion requires capturing HTTP requests on Alice's page. See `e2e/steps/realtime-*` for the network-tap pattern — reuse rather than invent.

- [ ] **Step 2: Generate BDD bindings and run**

```bash
make test ARGS="--grep @activity-feed"
```

Expected: all three scenarios pass on desktop + mobile projects.

- [ ] **Step 3: Run the full suite to catch regressions**

```bash
make test
```

Expected: 49/49 (was 46/46; +3 new activity-feed scenarios).

- [ ] **Step 4: Commit**

```bash
git add e2e/
git commit -m "test(e2e): step defs for activity feed + resume flow"
```

---

## Task 13: Docs — convention + capabilities

**Files:**
- Modify: `docs/conventions.md`
- Modify: `docs/capabilities.md`

- [ ] **Step 1: Add "When to use `tracked()`" section to `docs/conventions.md`**

Include the taxonomy table from the conversation:

```markdown
## When to use `tracked()`

tRPC's `tracked(id, payload)` enables resumable subscriptions: on reconnect,
the client's `lastEventId` is threaded back to the server, which replays
missed events before tailing live.

**Prescribe `tracked()` when:** missed events have user-visible consequences
that don't self-heal on reconnect — ordered deltas where "apply event N then
N+1" matters to the user (activity feeds, chat, collaborative cursors with
history). The event kind is durable domain data persisted in its own table.

**Do NOT use `tracked()` when:** the event is an "invalidate this query"
notification (todo-list mutation events, revoke cascade) — refetch on reconnect
is already correct and cheaper. Or when the event is ephemeral state
(presence, typing) — fresh snapshot on reconnect is the right semantic.

**Storage rule:** reuse the domain table as the replay buffer. Do not
introduce Redis Streams or ring buffers as a separate replay layer unless
the event kind has no durable form (rare). The messages / activity-events
table already satisfies gap-fill via `WHERE id > lastEventId`.

**Ordering rule:** INSERT into the domain table inside the mutation's
transaction, then PUBLISH to the realtime channel after commit. Never
publish before commit — the gap query would miss an event the client
already saw via pub/sub and got de-duplicated incorrectly.

**Replay bounds:** cap the gap query (500 events / 24h). On overflow, yield
a `resync` sentinel envelope; client falls back to a full fetch.

**Exhibit:** `packages/api/src/domains/activity-feed/` implements this
pattern end-to-end — model, service, router, web hook, BDD spec.
```

- [ ] **Step 2: Add activity-feed entry to `docs/capabilities.md`**

Follow the existing entry shape (capability, import path, when to use, when not, references).

- [ ] **Step 3: Commit**

```bash
git add docs/
git commit -m "docs: when to use tracked() convention + activity-feed capability"
```

---

## Task 14: Final checks + PR

- [ ] **Step 1: Full lint + full test + full BDD**

```bash
make lint
make test-unit
make test
```

Expected: all green.

- [ ] **Step 2: Push branch and open PR**

```bash
git push -u origin feat/tracked-activity-feed
gh pr create --title "feat: tracked activity feed (resumable subscriptions demo)" \
  --body "$(cat <<'EOF'
## Summary
- New `activity-feed` domain: Prisma model, tRPC query + tracked subscription, web panel on list detail page.
- Demonstrates tRPC `tracked()` with DB-as-replay-buffer (no Redis Stream).
- Convention doc: when to use `tracked()` vs invalidate-on-notify.

## Test plan
- [ ] `make test` — 49/49 (46 existing + 3 new @activity-feed)
- [ ] Manual: open list, add todo in second tab, see entry appear
- [ ] Manual: sever websocket via devtools → add 3 todos in second tab → reconnect → see 3 entries stream in, no full refetch
EOF
)"
```

---

## Self-Review Notes

**Spec coverage:**
- Live streaming — Task 6 (service) + Task 8 (router) + Task 9-11 (web) + Scenario 1 (Task 1, 12).
- Resumability (gap-fill) — Task 6 (gap-fill logic) + Scenario 2 (Task 1, 12). "Query not refetched" assertion via network tap in Task 12.
- Revocation still works — Task 8 authz guard + Scenario 3 (Task 1, 12).
- Resync overflow path — Task 6 (sentinel) + Task 9 (client invalidate-on-resync). No dedicated BDD scenario (would require seeding >500 events per run — not worth the test-suite time). Unit test covers it.
- Convention doc — Task 13.

**Type consistency:**
- `ActivityEventRecord` is the shared DB-row type with typed `payload` — used in service, router, hook, component. Augmented in Task 10 to include `actor: { id, name }`.
- `ActivityEventEnvelope` is the subscription yield shape with `kind: "event" | "resync"` — same string enum across server yield and client `onData`.
- `lastEventId` param: tRPC v11 threads automatically via `tracked()`, not a manual argument.

**Known risks / gotchas:**
- `tracked()` with tRPC v11 requires `wsLink` or `httpSubscriptionLink` on the client — confirm the web app's existing trpc client config supports it. If only `httpBatchLink` is wired for subscriptions, a link swap is a prerequisite and should be called out in Task 9 before the hook implementation.
- The "no refetch during reconnect" assertion depends on the subscription-level cache behavior. If the client hook's resync path always invalidates on reconnect start, the test fails for the wrong reason — make sure `onStarted` does NOT auto-invalidate; only the `resync` envelope path does.
- `cuid` is lexicographically time-sortable but not strictly monotonic under clock skew across nodes. For a single Postgres writer this is fine. If the stack ever grows multi-writer, swap to a DB-sequence or ULID and revise the gap-fill cursor comment.
