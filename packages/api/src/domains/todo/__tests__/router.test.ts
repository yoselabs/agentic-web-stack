import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { db } from "@project/db";
import { createContext } from "../../../context.js";
import { appRouter } from "../../../router.js";

const TEST_USER_ID = "test-user-todo-router";
const TEST_USER = {
  id: TEST_USER_ID,
  name: "Router Test User",
  email: "test-todo-router@example.com",
  emailVerified: false,
  image: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const fakeSession = {
  user: TEST_USER,
  session: {
    id: "test-session-router",
    token: "test-token-router",
    userId: TEST_USER_ID,
    expiresAt: new Date(Date.now() + 1000 * 60 * 60),
    ipAddress: null,
    userAgent: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
};

let TEST_LIST_ID: string;

async function createCaller() {
  const ctx = await createContext({ session: fakeSession });
  return appRouter.createCaller(ctx);
}

beforeAll(async () => {
  await db.todo.deleteMany({ where: { userId: TEST_USER_ID } });
  await db.todoList.deleteMany({ where: { userId: TEST_USER_ID } });
  await db.user.deleteMany({ where: { id: TEST_USER_ID } });
  await db.user.create({
    data: {
      id: TEST_USER_ID,
      name: TEST_USER.name,
      email: TEST_USER.email,
      emailVerified: TEST_USER.emailVerified,
    },
  });
  const list = await db.todoList.create({
    data: { name: "Router Test List", userId: TEST_USER_ID },
  });
  TEST_LIST_ID = list.id;
});

afterAll(async () => {
  await db.todo.deleteMany({ where: { userId: TEST_USER_ID } });
  await db.todoList.deleteMany({ where: { userId: TEST_USER_ID } });
  await db.user.delete({ where: { id: TEST_USER_ID } }).catch(() => {});
  await db.$disconnect();
});

describe("todo router (integration)", () => {
  it("rejects unauthenticated calls", async () => {
    const ctx = await createContext({ session: null });
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.todo.list({ todoListId: TEST_LIST_ID }),
    ).rejects.toThrow("UNAUTHORIZED");
  });

  it("rejects empty title", async () => {
    const caller = await createCaller();
    await expect(
      caller.todo.create({ title: "", todoListId: TEST_LIST_ID }),
    ).rejects.toThrow();
  });

  it("rejects empty reorder array", async () => {
    const caller = await createCaller();
    await expect(caller.todo.reorder({ ids: [] })).rejects.toThrow();
  });

  it("round-trips a todo through create and list", async () => {
    const caller = await createCaller();
    const todo = await caller.todo.create({
      title: "Router round-trip",
      todoListId: TEST_LIST_ID,
    });

    expect(todo.title).toBe("Router round-trip");
    expect(todo.userId).toBe(TEST_USER_ID);

    const todos = await caller.todo.list({ todoListId: TEST_LIST_ID });
    expect(todos.some((t) => t.id === todo.id)).toBe(true);

    // Clean up
    await caller.todo.delete({ id: todo.id });
  });
});
