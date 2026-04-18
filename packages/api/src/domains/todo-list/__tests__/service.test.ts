import { db } from "@project/db";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  createTodoList,
  deleteTodoList,
  getTodoList,
  listTodoLists,
} from "../service.js";

const TEST_USER_ID = "test-user-todolist-service";
const createdListIds: string[] = [];

beforeAll(async () => {
  await db.todoList.deleteMany({ where: { userId: TEST_USER_ID } });
  await db.todo.deleteMany({ where: { userId: TEST_USER_ID } });
  await db.user.deleteMany({ where: { id: TEST_USER_ID } });
  await db.user.create({
    data: {
      id: TEST_USER_ID,
      name: "TodoList Test User",
      email: "test-todolist-service@example.com",
      emailVerified: false,
    },
  });
});

afterEach(async () => {
  if (createdListIds.length > 0) {
    await db.todoList.deleteMany({
      where: { id: { in: createdListIds } },
    });
    createdListIds.length = 0;
  }
});

afterAll(async () => {
  await db.todoList.deleteMany({ where: { userId: TEST_USER_ID } });
  await db.user.delete({ where: { id: TEST_USER_ID } }).catch(() => {});
  await db.$disconnect();
});

describe("todo-list service", () => {
  it("lists todo lists (empty)", async () => {
    const lists = await listTodoLists(db, TEST_USER_ID);
    expect(lists).toEqual([]);
  });

  it("creates a todo list", async () => {
    const list = await createTodoList(db, TEST_USER_ID, "Groceries");
    createdListIds.push(list.id);
    expect(list.name).toBe("Groceries");
    expect(list.color).toBe("#6366f1");
    expect(list.userId).toBe(TEST_USER_ID);
  });

  it("creates a todo list with custom color", async () => {
    const list = await createTodoList(db, TEST_USER_ID, "Work", "#ef4444");
    createdListIds.push(list.id);
    expect(list.color).toBe("#ef4444");
  });

  it("gets a todo list by id", async () => {
    const created = await createTodoList(db, TEST_USER_ID, "Get Test");
    createdListIds.push(created.id);
    const found = await getTodoList(db, TEST_USER_ID, created.id);
    expect(found.name).toBe("Get Test");
  });

  it("deletes a todo list", async () => {
    const list = await createTodoList(db, TEST_USER_ID, "To Delete");
    await deleteTodoList(db, TEST_USER_ID, list.id);
    const lists = await listTodoLists(db, TEST_USER_ID);
    expect(lists.find((l) => l.id === list.id)).toBeUndefined();
  });

  it("includes todo count in list", async () => {
    const list = await createTodoList(db, TEST_USER_ID, "With Todos");
    createdListIds.push(list.id);
    await db.todo.create({
      data: { title: "Task 1", userId: TEST_USER_ID, todoListId: list.id },
    });
    await db.todo.create({
      data: { title: "Task 2", userId: TEST_USER_ID, todoListId: list.id },
    });

    const lists = await listTodoLists(db, TEST_USER_ID);
    const found = lists.find((l) => l.id === list.id);
    expect(found?._count.todos).toBe(2);
  });
});
