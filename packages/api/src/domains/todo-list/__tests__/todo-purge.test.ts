import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { db } from "@project/db";
import { purgeStaleCompletedTodos } from "../todo-service.js";

// Randomized per run so parallel tests using the same fixture can't collide.
const PURGE_USER_ID = `test-user-todo-purge-${crypto.randomUUID()}`;
let purgeListId: string;

beforeAll(async () => {
  await db.todo.deleteMany({ where: { userId: PURGE_USER_ID } });
  await db.todoList.deleteMany({ where: { userId: PURGE_USER_ID } });
  await db.user.deleteMany({ where: { id: PURGE_USER_ID } });
  await db.user.create({
    data: {
      id: PURGE_USER_ID,
      name: "Purge Test User",
      email: "test-todo-purge@example.com",
      username: "test-todo-purge",
      emailVerified: false,
    },
  });
  const list = await db.todoList.create({
    data: { name: "Purge List", userId: PURGE_USER_ID },
  });
  purgeListId = list.id;
});

afterAll(async () => {
  await db.todo.deleteMany({ where: { userId: PURGE_USER_ID } });
  await db.todoList.deleteMany({ where: { userId: PURGE_USER_ID } });
  await db.user.delete({ where: { id: PURGE_USER_ID } }).catch(() => {});
  await db.$disconnect();
});

describe("purgeStaleCompletedTodos", () => {
  it("deletes only completed todos older than the cutoff", async () => {
    const now = Date.now();
    const stale = await db.todo.create({
      data: {
        title: "stale completed",
        completed: true,
        userId: PURGE_USER_ID,
        todoListId: purgeListId,
        updatedAt: new Date(now - 31 * 86_400_000),
      },
    });
    const recentCompleted = await db.todo.create({
      data: {
        title: "recent completed",
        completed: true,
        userId: PURGE_USER_ID,
        todoListId: purgeListId,
        updatedAt: new Date(now - 5 * 86_400_000),
      },
    });
    const staleActive = await db.todo.create({
      data: {
        title: "stale but active",
        completed: false,
        userId: PURGE_USER_ID,
        todoListId: purgeListId,
        updatedAt: new Date(now - 90 * 86_400_000),
      },
    });

    const deleted = await db.$transaction((tx) =>
      purgeStaleCompletedTodos(tx, { olderThanDays: 30, nowMs: now }),
    );
    expect(deleted).toBe(1);

    const remaining = await db.todo.findMany({
      where: { todoListId: purgeListId },
      orderBy: { title: "asc" },
    });
    const ids = remaining.map((t) => t.id).sort();
    expect(ids).toEqual([recentCompleted.id, staleActive.id].sort());
    expect(remaining.find((t) => t.id === stale.id)).toBeUndefined();
  });
});
