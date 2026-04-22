import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { db } from "@project/db";
import { ACTIVITY_LIST_PAGE_SIZE } from "../constants.js";
import { listActivityEvents, recordActivityEvent } from "../service.js";

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
