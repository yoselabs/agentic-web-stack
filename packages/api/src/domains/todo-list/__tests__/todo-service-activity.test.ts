import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { db } from "@project/db";
import { completeTodo, createTodo, deleteTodo } from "../todo-service.js";

const TEST_USER_ID = "test-user-todo-activity";
let TEST_LIST_ID: string;

beforeAll(async () => {
  await db.activityEvent.deleteMany({ where: { actorId: TEST_USER_ID } });
  await db.todo.deleteMany({ where: { userId: TEST_USER_ID } });
  await db.todoList.deleteMany({ where: { userId: TEST_USER_ID } });
  await db.user.deleteMany({ where: { id: TEST_USER_ID } });
  await db.user.create({
    data: {
      id: TEST_USER_ID,
      name: "Activity Test User",
      email: "test-todo-activity@example.com",
      username: "test-todo-activity",
      emailVerified: false,
    },
  });
  const list = await db.todoList.create({
    data: { name: "Activity List", userId: TEST_USER_ID },
  });
  TEST_LIST_ID = list.id;
});

afterEach(async () => {
  await db.activityEvent.deleteMany({ where: { todoListId: TEST_LIST_ID } });
  await db.todo.deleteMany({ where: { todoListId: TEST_LIST_ID } });
});

afterAll(async () => {
  await db.activityEvent.deleteMany({ where: { actorId: TEST_USER_ID } });
  await db.todo.deleteMany({ where: { userId: TEST_USER_ID } });
  await db.todoList.deleteMany({ where: { userId: TEST_USER_ID } });
  await db.user.delete({ where: { id: TEST_USER_ID } }).catch(() => {});
  await db.$disconnect();
});

describe("todo-service activity emission", () => {
  it("createTodo emits a todo-created activity event", async () => {
    const todo = await db.$transaction((tx) =>
      createTodo(tx, TEST_USER_ID, "buy milk", TEST_LIST_ID),
    );

    const events = await db.activityEvent.findMany({
      where: { todoListId: TEST_LIST_ID, kind: "todo-created" },
      orderBy: { id: "desc" },
      take: 1,
    });
    expect(events[0]).toBeDefined();
    expect(events[0]?.kind).toBe("todo-created");
    expect(events[0]?.actorId).toBe(TEST_USER_ID);
    expect(events[0]?.payload).toMatchObject({
      todoId: todo.id,
      title: "buy milk",
    });
  });

  it("completeTodo emits todo-completed when completed=true", async () => {
    const todo = await db.$transaction((tx) =>
      createTodo(tx, TEST_USER_ID, "do laundry", TEST_LIST_ID),
    );
    await db.$transaction((tx) =>
      completeTodo(tx, TEST_USER_ID, todo.id, true),
    );

    const events = await db.activityEvent.findMany({
      where: { todoListId: TEST_LIST_ID, kind: "todo-completed" },
      orderBy: { id: "desc" },
      take: 1,
    });
    expect(events[0]?.kind).toBe("todo-completed");
    expect(events[0]?.actorId).toBe(TEST_USER_ID);
    expect(events[0]?.payload).toMatchObject({
      todoId: todo.id,
      title: "do laundry",
    });
  });

  it("completeTodo emits todo-uncompleted when completed=false", async () => {
    const todo = await db.$transaction((tx) =>
      createTodo(tx, TEST_USER_ID, "buy bread", TEST_LIST_ID),
    );
    await db.$transaction((tx) =>
      completeTodo(tx, TEST_USER_ID, todo.id, true),
    );
    await db.$transaction((tx) =>
      completeTodo(tx, TEST_USER_ID, todo.id, false),
    );

    const events = await db.activityEvent.findMany({
      where: { todoListId: TEST_LIST_ID, kind: "todo-uncompleted" },
      orderBy: { id: "desc" },
      take: 1,
    });
    expect(events[0]?.kind).toBe("todo-uncompleted");
    expect(events[0]?.actorId).toBe(TEST_USER_ID);
    expect(events[0]?.payload).toMatchObject({
      todoId: todo.id,
      title: "buy bread",
    });
  });

  it("deleteTodo emits a todo-deleted activity event", async () => {
    const todo = await db.$transaction((tx) =>
      createTodo(tx, TEST_USER_ID, "obsolete task", TEST_LIST_ID),
    );
    await db.$transaction((tx) => deleteTodo(tx, TEST_USER_ID, todo.id));

    const events = await db.activityEvent.findMany({
      where: { todoListId: TEST_LIST_ID, kind: "todo-deleted" },
      orderBy: { id: "desc" },
      take: 1,
    });
    expect(events[0]?.kind).toBe("todo-deleted");
    expect(events[0]?.actorId).toBe(TEST_USER_ID);
    expect(events[0]?.payload).toMatchObject({
      todoId: todo.id,
      title: "obsolete task",
    });
  });
});
