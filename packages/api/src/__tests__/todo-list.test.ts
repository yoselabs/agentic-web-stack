import { db } from "@project/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createContext } from "../context.js";
import { appRouter } from "../router.js";

const TEST_USER_ID = "test-user-todolist-router";
const TEST_USER = {
  id: TEST_USER_ID,
  name: "TodoList Router Test User",
  email: "test-todolist-router@example.com",
  emailVerified: false,
  image: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const fakeSession = {
  user: TEST_USER,
  session: {
    id: "test-session-todolist-router",
    token: "test-token-todolist-router",
    userId: TEST_USER_ID,
    expiresAt: new Date(Date.now() + 1000 * 60 * 60),
    ipAddress: null,
    userAgent: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
};

async function createCaller() {
  const ctx = await createContext({ session: fakeSession });
  return appRouter.createCaller(ctx);
}

beforeAll(async () => {
  await db.todoList.deleteMany({ where: { userId: TEST_USER_ID } });
  await db.todo.deleteMany({ where: { userId: TEST_USER_ID } });
  await db.user.deleteMany({ where: { id: TEST_USER_ID } });
  await db.user.create({
    data: {
      id: TEST_USER_ID,
      name: TEST_USER.name,
      email: TEST_USER.email,
      emailVerified: TEST_USER.emailVerified,
    },
  });
});

afterAll(async () => {
  await db.todoList.deleteMany({ where: { userId: TEST_USER_ID } });
  await db.user.delete({ where: { id: TEST_USER_ID } }).catch(() => {});
  await db.$disconnect();
});

describe("todoList router (integration)", () => {
  it("rejects unauthenticated calls", async () => {
    const ctx = await createContext({ session: null });
    const caller = appRouter.createCaller(ctx);
    await expect(caller.todoList.list()).rejects.toThrow("UNAUTHORIZED");
  });

  it("round-trips a todo list through create and list", async () => {
    const caller = await createCaller();
    const list = await caller.todoList.create({ name: "Integration Test" });

    expect(list.name).toBe("Integration Test");

    const lists = await caller.todoList.list();
    expect(lists.some((l) => l.id === list.id)).toBe(true);

    await caller.todoList.delete({ id: list.id });
  });
});
