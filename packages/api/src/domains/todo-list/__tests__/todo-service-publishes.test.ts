import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "bun:test";
import {
  listChannelKey,
  type TodoListEvent,
} from "@project/api/domains/todo-list/events";
import { db } from "@project/db";
import { MemoryChannelFactory } from "@project/realtime/memory";
import {
  completeTodo,
  createTodo,
  deleteTodo,
  importTodosFromCSV,
  reorderTodos,
} from "../todo-service.js";

describe("todo-service publish assertions", () => {
  const OWNER_ID = "test-owner-publish-svc";
  const COLLAB_ID = "test-collab-publish-svc";
  let sharedListId: string;

  beforeAll(async () => {
    await db.user.deleteMany({
      where: { id: { in: [OWNER_ID, COLLAB_ID] } },
    });
    await db.user.createMany({
      data: [
        {
          id: OWNER_ID,
          name: "Owner",
          email: "owner-publish-svc@example.com",
          username: "owner-publish-svc",
          emailVerified: false,
        },
        {
          id: COLLAB_ID,
          name: "Collab",
          email: "collab-publish-svc@example.com",
          username: "collab-publish-svc",
          emailVerified: false,
        },
      ],
    });
  });

  beforeEach(async () => {
    const list = await db.todoList.create({
      data: { name: "Publish Test List", userId: OWNER_ID },
    });
    sharedListId = list.id;
    await db.todoListMembership.create({
      data: {
        userId: COLLAB_ID,
        todoListId: sharedListId,
        role: "collaborator",
      },
    });
  });

  afterEach(async () => {
    await db.todo.deleteMany({ where: { todoListId: sharedListId } });
    await db.todoListMembership.deleteMany({
      where: { todoListId: sharedListId },
    });
    await db.todoList.deleteMany({ where: { id: sharedListId } });
  });

  afterAll(async () => {
    await db.user.deleteMany({
      where: { id: { in: [OWNER_ID, COLLAB_ID] } },
    });
    await db.$disconnect();
  });

  it("completeTodo publishes todo-updated with the full TodoWithList", async () => {
    const factory = new MemoryChannelFactory();
    const published: TodoListEvent[] = [];
    const unsub = await factory
      .channel<TodoListEvent>(listChannelKey(sharedListId))
      .subscribe((e) => {
        published.push(e);
      });
    const ownerTodo = await db.todo.create({
      data: { title: "Publish me", userId: OWNER_ID, todoListId: sharedListId },
    });
    await db.$transaction((tx) =>
      completeTodo(tx, COLLAB_ID, ownerTodo.id, true, {
        channel: (k) => factory.channel(k),
      }),
    );
    unsub();
    await factory.closeAll();

    expect(published.length).toBe(1);
    const ev = published[0];
    if (ev?.kind !== "todo-updated") throw new Error("expected todo-updated");
    expect(ev.listId).toBe(sharedListId);
    expect(ev.todo.id).toBe(ownerTodo.id);
    expect(ev.todo.completed).toBe(true);
    expect(ev.todo.todoList?.id).toBe(sharedListId);
  });

  it("createTodo publishes todo-created with the full created row including todoList", async () => {
    const factory = new MemoryChannelFactory();
    const published: TodoListEvent[] = [];
    const unsub = await factory
      .channel<TodoListEvent>(listChannelKey(sharedListId))
      .subscribe((e) => {
        published.push(e);
      });
    const created = await db.$transaction((tx) =>
      createTodo(tx, COLLAB_ID, "Bob's bread", sharedListId, {
        channel: (k) => factory.channel(k),
      }),
    );
    unsub();
    await factory.closeAll();

    expect(published.length).toBe(1);
    const ev = published[0];
    if (ev?.kind !== "todo-created") throw new Error("expected todo-created");
    expect(ev.listId).toBe(sharedListId);
    expect(ev.todo.id).toBe(created.id);
    expect(ev.todo.title).toBe("Bob's bread");
    expect(ev.todo.todoList?.id).toBe(sharedListId);
  });

  it("deleteTodo publishes todo-deleted with the deleted id", async () => {
    const ownerTodo = await db.todo.create({
      data: {
        title: "Doomed",
        userId: OWNER_ID,
        todoListId: sharedListId,
        position: 0,
      },
    });
    const factory = new MemoryChannelFactory();
    const published: TodoListEvent[] = [];
    const unsub = await factory
      .channel<TodoListEvent>(listChannelKey(sharedListId))
      .subscribe((e) => {
        published.push(e);
      });
    await db.$transaction((tx) =>
      deleteTodo(tx, COLLAB_ID, ownerTodo.id, {
        channel: (k) => factory.channel(k),
      }),
    );
    unsub();
    await factory.closeAll();

    expect(published).toEqual([
      { kind: "todo-deleted", listId: sharedListId, todoId: ownerTodo.id },
    ]);
  });

  it("reorderTodos publishes todos-reordered with the full positions map", async () => {
    const first = await db.todo.create({
      data: {
        title: "F",
        userId: OWNER_ID,
        todoListId: sharedListId,
        position: 0,
      },
    });
    const second = await db.todo.create({
      data: {
        title: "S",
        userId: OWNER_ID,
        todoListId: sharedListId,
        position: 1,
      },
    });
    const factory = new MemoryChannelFactory();
    const published: TodoListEvent[] = [];
    const unsub = await factory
      .channel<TodoListEvent>(listChannelKey(sharedListId))
      .subscribe((e) => {
        published.push(e);
      });
    await db.$transaction((tx) =>
      reorderTodos(tx, COLLAB_ID, sharedListId, [second.id, first.id], {
        channel: (k) => factory.channel(k),
      }),
    );
    unsub();
    await factory.closeAll();

    expect(published).toEqual([
      {
        kind: "todos-reordered",
        listId: sharedListId,
        positions: [
          { id: second.id, position: 0 },
          { id: first.id, position: 1 },
        ],
      },
    ]);
  });

  it("importTodosFromCSV publishes todos-imported with each imported row including todoList", async () => {
    const csv = Buffer.from("title\nRow A\nRow B\n", "utf-8");
    const factory = new MemoryChannelFactory();
    const published: TodoListEvent[] = [];
    const unsub = await factory
      .channel<TodoListEvent>(listChannelKey(sharedListId))
      .subscribe((e) => {
        published.push(e);
      });
    const result = await db.$transaction((tx) =>
      importTodosFromCSV(tx, COLLAB_ID, csv, sharedListId, {
        channel: (k) => factory.channel(k),
      }),
    );
    unsub();
    await factory.closeAll();

    expect(result.count).toBe(2);
    expect(published.length).toBe(1);
    const ev = published[0];
    if (ev?.kind !== "todos-imported")
      throw new Error("expected todos-imported");
    expect(ev.listId).toBe(sharedListId);
    expect(ev.todos.length).toBe(2);
    expect(ev.todos.map((t) => t.title).sort()).toEqual(["Row A", "Row B"]);
    expect(ev.todos.every((t) => t.todoList?.id === sharedListId)).toBe(true);
  });
});
