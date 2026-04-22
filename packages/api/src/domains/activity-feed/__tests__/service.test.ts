import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { db } from "@project/db";
import { MemoryChannelFactory } from "@project/realtime/memory";
import {
  ACTIVITY_LIST_PAGE_SIZE,
  ACTIVITY_REPLAY_GAP_MAX,
} from "../constants.js";
import {
  type ActivityEventEnvelope,
  type ActivityEventRecord,
  activityChannelKey,
} from "../events.js";
import {
  listActivityEvents,
  recordActivityEvent,
  streamActivityEvents,
} from "../service.js";

const TEST_USER_ID = `u-${crypto.randomUUID()}`;
const TEST_EMAIL = `u-${crypto.randomUUID()}@t.test`;
let userId: string;
let listId: string;

beforeAll(async () => {
  const user = await db.user.create({
    data: {
      id: TEST_USER_ID,
      name: "Activity Feed Test User",
      email: TEST_EMAIL,
      username: TEST_USER_ID,
      emailVerified: false,
    },
  });
  userId = user.id;

  const list = await db.todoList.create({
    data: { name: "Activity Feed Test List", userId },
  });
  listId = list.id;
});

afterAll(async () => {
  await db.activityEvent.deleteMany({ where: { todoListId: listId } });
  await db.todoList.deleteMany({ where: { id: listId } });
  await db.user.delete({ where: { id: userId } }).catch(() => {});
  await db.$disconnect();
});

describe("recordActivityEvent", () => {
  it("persists an event with typed payload and returns the row", async () => {
    const event = await db.$transaction(async (tx) =>
      recordActivityEvent(tx, {
        todoListId: listId,
        actorId: userId,
        payload: { kind: "todo-created", todoId: "t1", title: "buy milk" },
      }),
    );

    expect(event.kind).toBe("todo-created");
    expect(event.payload).toEqual({
      kind: "todo-created",
      todoId: "t1",
      title: "buy milk",
    });
    expect(event.todoListId).toBe(listId);
    expect(event.actorId).toBe(userId);
    expect(event.actor).toEqual({
      id: userId,
      name: "Activity Feed Test User",
    });
    expect(event.id).toMatch(/^c/);
  });

  it("events from the same transaction sort by id ascending in creation order", async () => {
    const events = await db.$transaction(async (tx) => {
      const a = await recordActivityEvent(tx, {
        todoListId: listId,
        actorId: userId,
        payload: { kind: "todo-created", todoId: "a", title: "a" },
      });
      const b = await recordActivityEvent(tx, {
        todoListId: listId,
        actorId: userId,
        payload: { kind: "todo-created", todoId: "b", title: "b" },
      });
      const c = await recordActivityEvent(tx, {
        todoListId: listId,
        actorId: userId,
        payload: { kind: "todo-created", todoId: "c", title: "c" },
      });
      return [a, b, c];
    });
    const sorted = [...events].sort((x, y) => x.id.localeCompare(y.id));
    expect(sorted.map((e) => (e.payload as { todoId: string }).todoId)).toEqual(
      ["a", "b", "c"],
    );
  });
});

describe("listActivityEvents", () => {
  async function createList(name: string): Promise<string> {
    const list = await db.todoList.create({
      data: { name, userId },
    });
    return list.id;
  }

  it("returns events newest-first within a list", async () => {
    const scopedListId = await createList("listActivityEvents newest-first");

    await db.$transaction(async (tx) => {
      await recordActivityEvent(tx, {
        todoListId: scopedListId,
        actorId: userId,
        payload: { kind: "todo-created", todoId: "a", title: "a" },
      });
      await recordActivityEvent(tx, {
        todoListId: scopedListId,
        actorId: userId,
        payload: { kind: "todo-created", todoId: "b", title: "b" },
      });
      await recordActivityEvent(tx, {
        todoListId: scopedListId,
        actorId: userId,
        payload: { kind: "todo-created", todoId: "c", title: "c" },
      });
    });

    const result = await listActivityEvents(db, { todoListId: scopedListId });
    expect(
      result.items.map((e) => (e.payload as { todoId: string }).todoId),
    ).toEqual(["c", "b", "a"]);
    expect(result.nextCursor).toBeNull();
    for (const e of result.items) {
      expect(e.actor).toEqual({
        id: userId,
        name: "Activity Feed Test User",
      });
    }

    await db.activityEvent.deleteMany({ where: { todoListId: scopedListId } });
    await db.todoList.delete({ where: { id: scopedListId } });
  });

  it("paginates via cursor (descending by id)", async () => {
    const scopedListId = await createList("listActivityEvents paginates");
    const total = 75;

    await db.$transaction(async (tx) => {
      for (let i = 0; i < total; i++) {
        await recordActivityEvent(tx, {
          todoListId: scopedListId,
          actorId: userId,
          payload: {
            kind: "todo-created",
            todoId: String(i),
            title: `t${i}`,
          },
        });
      }
    });

    const first = await listActivityEvents(db, {
      todoListId: scopedListId,
      limit: ACTIVITY_LIST_PAGE_SIZE,
    });
    expect(first.items.length).toBe(ACTIVITY_LIST_PAGE_SIZE);
    expect(first.nextCursor).not.toBeNull();

    const second = await listActivityEvents(db, {
      todoListId: scopedListId,
      limit: ACTIVITY_LIST_PAGE_SIZE,
      cursor: first.nextCursor ?? undefined,
    });
    expect(second.items.length).toBe(total - ACTIVITY_LIST_PAGE_SIZE);
    expect(second.nextCursor).toBeNull();

    const firstIds = new Set(first.items.map((e) => e.id));
    for (const e of second.items) {
      expect(firstIds.has(e.id)).toBe(false);
    }

    await db.activityEvent.deleteMany({ where: { todoListId: scopedListId } });
    await db.todoList.delete({ where: { id: scopedListId } });
  });

  it("scopes strictly to the given list", async () => {
    const firstListId = await createList("listActivityEvents scope-a");
    const secondListId = await createList("listActivityEvents scope-b");

    await db.$transaction(async (tx) => {
      await recordActivityEvent(tx, {
        todoListId: firstListId,
        actorId: userId,
        payload: { kind: "todo-created", todoId: "first-1", title: "x" },
      });
      await recordActivityEvent(tx, {
        todoListId: secondListId,
        actorId: userId,
        payload: { kind: "todo-created", todoId: "second-1", title: "x" },
      });
      await recordActivityEvent(tx, {
        todoListId: secondListId,
        actorId: userId,
        payload: { kind: "todo-created", todoId: "second-2", title: "x" },
      });
    });

    const result = await listActivityEvents(db, { todoListId: firstListId });
    const todoIds = result.items.map(
      (e) => (e.payload as { todoId: string }).todoId,
    );
    expect(todoIds).toEqual(["first-1"]);
    expect(todoIds).not.toContain("second-1");
    expect(todoIds).not.toContain("second-2");

    await db.activityEvent.deleteMany({
      where: { todoListId: { in: [firstListId, secondListId] } },
    });
    await db.todoList.deleteMany({
      where: { id: { in: [firstListId, secondListId] } },
    });
  });
});

describe("streamActivityEvents", () => {
  async function createList(name: string): Promise<string> {
    const list = await db.todoList.create({ data: { name, userId } });
    return list.id;
  }

  async function collectN(
    gen: AsyncGenerator<ActivityEventEnvelope>,
    n: number,
    ac: AbortController,
  ): Promise<ActivityEventEnvelope[]> {
    const out: ActivityEventEnvelope[] = [];
    for await (const v of gen) {
      out.push(v);
      if (out.length >= n) {
        ac.abort();
        break;
      }
    }
    return out;
  }

  it("tails a live event when no lastEventId is provided", async () => {
    const scopedListId = await createList("streamActivityEvents tail-live");
    const factory = new MemoryChannelFactory();
    const channel = factory.channel<ActivityEventRecord>(
      activityChannelKey(scopedListId),
    );
    const ac = new AbortController();

    const gen = streamActivityEvents(db, {
      todoListId: scopedListId,
      channel,
      signal: ac.signal,
    });

    // Schedule persist + publish on a microtask so the generator enters its
    // first await before we publish.
    queueMicrotask(async () => {
      const event = await db.$transaction((tx) =>
        recordActivityEvent(tx, {
          todoListId: scopedListId,
          actorId: userId,
          payload: { kind: "todo-created", todoId: "x", title: "buy milk" },
        }),
      );
      await channel.publish(event);
    });

    const envelopes = await collectN(gen, 1, ac);
    expect(envelopes.length).toBe(1);
    const first = envelopes[0];
    expect(first?.kind).toBe("event");
    if (first?.kind === "event") {
      expect((first.event.payload as { todoId: string }).todoId).toBe("x");
    }

    await factory.closeAll();
    await db.activityEvent.deleteMany({ where: { todoListId: scopedListId } });
    await db.todoList.delete({ where: { id: scopedListId } });
  });

  it("replays gap from DB in ascending order when lastEventId is provided", async () => {
    const scopedListId = await createList("streamActivityEvents gap-replay");
    const factory = new MemoryChannelFactory();
    const channel = factory.channel<ActivityEventRecord>(
      activityChannelKey(scopedListId),
    );

    const events = await db.$transaction(async (tx) => {
      const a = await recordActivityEvent(tx, {
        todoListId: scopedListId,
        actorId: userId,
        payload: { kind: "todo-created", todoId: "a", title: "a" },
      });
      const b = await recordActivityEvent(tx, {
        todoListId: scopedListId,
        actorId: userId,
        payload: { kind: "todo-created", todoId: "b", title: "b" },
      });
      const c = await recordActivityEvent(tx, {
        todoListId: scopedListId,
        actorId: userId,
        payload: { kind: "todo-created", todoId: "c", title: "c" },
      });
      return [a, b, c];
    });

    const ac = new AbortController();
    const gen = streamActivityEvents(db, {
      todoListId: scopedListId,
      lastEventId: events[0]?.id,
      channel,
      signal: ac.signal,
    });

    const envelopes = await collectN(gen, 2, ac);
    expect(envelopes.length).toBe(2);
    expect(envelopes[0]?.kind).toBe("event");
    expect(envelopes[1]?.kind).toBe("event");
    if (envelopes[0]?.kind === "event" && envelopes[1]?.kind === "event") {
      expect(envelopes[0].event.id).toBe(events[1]?.id ?? "");
      expect(envelopes[1].event.id).toBe(events[2]?.id ?? "");
    }

    await factory.closeAll();
    await db.activityEvent.deleteMany({ where: { todoListId: scopedListId } });
    await db.todoList.delete({ where: { id: scopedListId } });
  });

  it("yields resync sentinel when the gap exceeds ACTIVITY_REPLAY_GAP_MAX", async () => {
    const scopedListId = await createList("streamActivityEvents gap-resync");
    const factory = new MemoryChannelFactory();
    const channel = factory.channel<ActivityEventRecord>(
      activityChannelKey(scopedListId),
    );

    // Seed enough events to exceed the gap cap. A cuid starting with "c000..."
    // is lexically less than any real cuid, so `id > ancientId` returns all rows.
    await db.$transaction(async (tx) => {
      for (let i = 0; i < ACTIVITY_REPLAY_GAP_MAX + 5; i++) {
        await recordActivityEvent(tx, {
          todoListId: scopedListId,
          actorId: userId,
          payload: {
            kind: "todo-created",
            todoId: `t${i}`,
            title: `t${i}`,
          },
        });
      }
    });

    const ac = new AbortController();
    const gen = streamActivityEvents(db, {
      todoListId: scopedListId,
      lastEventId: "c000000000000000000000000",
      channel,
      signal: ac.signal,
    });

    const envelopes = await collectN(gen, 1, ac);
    expect(envelopes.length).toBe(1);
    expect(envelopes[0]).toEqual({ kind: "resync", reason: "gap-too-large" });

    await factory.closeAll();
    await db.activityEvent.deleteMany({ where: { todoListId: scopedListId } });
    await db.todoList.delete({ where: { id: scopedListId } });
  }, 30_000);

  it("dedups overlap between gap-fill and live buffer", async () => {
    const scopedListId = await createList("streamActivityEvents dedup");
    const factory = new MemoryChannelFactory();
    const channel = factory.channel<ActivityEventRecord>(
      activityChannelKey(scopedListId),
    );

    const events = await db.$transaction(async (tx) => {
      const a = await recordActivityEvent(tx, {
        todoListId: scopedListId,
        actorId: userId,
        payload: { kind: "todo-created", todoId: "a", title: "a" },
      });
      const b = await recordActivityEvent(tx, {
        todoListId: scopedListId,
        actorId: userId,
        payload: { kind: "todo-created", todoId: "b", title: "b" },
      });
      return [a, b];
    });

    const ac = new AbortController();
    const gen = streamActivityEvents(db, {
      todoListId: scopedListId,
      lastEventId: events[0]?.id,
      channel,
      signal: ac.signal,
    });

    // Publish b via the live channel right after the generator starts.
    // It should also appear via gap-fill — dedup keeps it to a single yield.
    const eventB = events[1];
    if (!eventB) throw new Error("seed failed");
    queueMicrotask(() => {
      void channel.publish(eventB);
    });

    // Collect everything until a short quiet window; expect exactly 1 envelope for b.
    const collected: ActivityEventEnvelope[] = [];
    const timer = setTimeout(() => ac.abort(), 300);
    try {
      for await (const v of gen) {
        collected.push(v);
      }
    } finally {
      clearTimeout(timer);
    }

    const eventEnvelopes = collected.filter((e) => e.kind === "event");
    expect(eventEnvelopes.length).toBe(1);
    if (eventEnvelopes[0]?.kind === "event") {
      expect(eventEnvelopes[0].event.id).toBe(eventB.id);
    }

    await factory.closeAll();
    await db.activityEvent.deleteMany({ where: { todoListId: scopedListId } });
    await db.todoList.delete({ where: { id: scopedListId } });
  });
});
