import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { db } from "@project/db";
import { recordActivityEvent } from "../service.js";

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
