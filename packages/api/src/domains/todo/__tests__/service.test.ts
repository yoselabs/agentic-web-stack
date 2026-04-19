import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "bun:test";
import { db } from "@project/db";
import { MemoryChannelFactory } from "@project/realtime/memory";
import {
  listChannelKey,
  type TodoListEvent,
} from "@project/api/domains/todo-list/events";
import {
  completeTodo,
  createTodo,
  deleteTodo,
  exportTodosAsCSV,
  importTodosFromCSV,
  listTodos,
  reorderTodos,
} from "../service.js";

const TEST_USER_ID = "test-user-todo-service";
let TEST_LIST_ID: string;

const createdTodoIds: string[] = [];

beforeAll(async () => {
  await db.todo.deleteMany({ where: { userId: TEST_USER_ID } });
  await db.todoList.deleteMany({ where: { userId: TEST_USER_ID } });
  await db.user.deleteMany({ where: { id: TEST_USER_ID } });
  await db.user.create({
    data: {
      id: TEST_USER_ID,
      name: "Service Test User",
      email: "test-todo-service@example.com",
      username: "test-todo-service",
      emailVerified: false,
    },
  });
  const list = await db.todoList.create({
    data: { name: "Test List", userId: TEST_USER_ID },
  });
  TEST_LIST_ID = list.id;
});

afterEach(async () => {
  if (createdTodoIds.length > 0) {
    await db.todo.deleteMany({
      where: { id: { in: createdTodoIds } },
    });
    createdTodoIds.length = 0;
  }
});

afterAll(async () => {
  await db.todo.deleteMany({ where: { userId: TEST_USER_ID } });
  await db.todoList.deleteMany({ where: { userId: TEST_USER_ID } });
  await db.user.delete({ where: { id: TEST_USER_ID } }).catch(() => {});
  await db.$disconnect();
});

describe("todo service", () => {
  it("lists todos (empty)", async () => {
    const todos = await listTodos(db, TEST_USER_ID, TEST_LIST_ID);
    expect(todos).toEqual([]);
  });

  it("creates a todo at position 0 and shifts others", async () => {
    const first = await db.$transaction((tx) =>
      createTodo(tx, TEST_USER_ID, "First", TEST_LIST_ID),
    );
    createdTodoIds.push(first.id);

    const second = await db.$transaction((tx) =>
      createTodo(tx, TEST_USER_ID, "Second", TEST_LIST_ID),
    );
    createdTodoIds.push(second.id);

    const todos = await listTodos(db, TEST_USER_ID, TEST_LIST_ID);
    const active = todos.filter((t) => !t.completed);

    expect(active[0]?.title).toBe("Second");
    expect(active[0]?.position).toBe(0);
    expect(active[1]?.title).toBe("First");
    expect(active[1]?.position).toBe(1);
  });

  it("completes a todo", async () => {
    const todo = await db.$transaction((tx) =>
      createTodo(tx, TEST_USER_ID, "To complete", TEST_LIST_ID),
    );
    createdTodoIds.push(todo.id);

    const updated = await db.$transaction((tx) =>
      completeTodo(tx, TEST_USER_ID, todo.id, true),
    );
    expect(updated.completed).toBe(true);
  });

  it("uncompleting a todo moves it to position 0", async () => {
    const first = await db.$transaction((tx) =>
      createTodo(tx, TEST_USER_ID, "Stay", TEST_LIST_ID),
    );
    const second = await db.$transaction((tx) =>
      createTodo(tx, TEST_USER_ID, "Toggle", TEST_LIST_ID),
    );
    createdTodoIds.push(first.id, second.id);

    await db.$transaction((tx) =>
      completeTodo(tx, TEST_USER_ID, second.id, true),
    );
    await db.$transaction((tx) =>
      completeTodo(tx, TEST_USER_ID, second.id, false),
    );

    const todos = await listTodos(db, TEST_USER_ID, TEST_LIST_ID);
    const active = todos.filter((t) => !t.completed);
    expect(active[0]?.title).toBe("Toggle");
    expect(active[0]?.position).toBe(0);
  });

  it("reorders todos with bulk UPDATE", async () => {
    const a = await db.$transaction((tx) =>
      createTodo(tx, TEST_USER_ID, "A", TEST_LIST_ID),
    );
    const b = await db.$transaction((tx) =>
      createTodo(tx, TEST_USER_ID, "B", TEST_LIST_ID),
    );
    const c = await db.$transaction((tx) =>
      createTodo(tx, TEST_USER_ID, "C", TEST_LIST_ID),
    );
    createdTodoIds.push(a.id, b.id, c.id);

    // Current order: C(0), B(1), A(2). Reorder to A, C, B.
    await db.$transaction((tx) =>
      reorderTodos(tx, TEST_USER_ID, TEST_LIST_ID, [a.id, c.id, b.id]),
    );

    const todos = await listTodos(db, TEST_USER_ID, TEST_LIST_ID);
    const active = todos.filter((t) => !t.completed);
    expect(active.map((t) => t.title)).toEqual(["A", "C", "B"]);
  });

  it("deletes a todo", async () => {
    const todo = await db.$transaction((tx) =>
      createTodo(tx, TEST_USER_ID, "To delete", TEST_LIST_ID),
    );

    await db.$transaction((tx) => deleteTodo(tx, TEST_USER_ID, todo.id));

    const todos = await listTodos(db, TEST_USER_ID, TEST_LIST_ID);
    expect(todos.find((t) => t.id === todo.id)).toBeUndefined();
  });

  it("imports todos from CSV with title column", async () => {
    const csv = Buffer.from("title\nBuy milk\nWalk the dog");
    const result = await db.$transaction((tx) =>
      importTodosFromCSV(tx, TEST_USER_ID, csv, TEST_LIST_ID),
    );
    expect(result.count).toBe(2);

    const todos = await listTodos(db, TEST_USER_ID, TEST_LIST_ID);
    const active = todos.filter((t) => !t.completed);
    createdTodoIds.push(...active.map((t) => t.id));
    expect(active[0]?.title).toBe("Buy milk");
    expect(active[1]?.title).toBe("Walk the dog");
  });

  it("rejects CSV without title column", async () => {
    const csv = Buffer.from("name,email\nAlice,a@b.com");
    await expect(
      db.$transaction((tx) =>
        importTodosFromCSV(tx, TEST_USER_ID, csv, TEST_LIST_ID),
      ),
    ).rejects.toThrow("title");
  });

  it("ignores extra columns beyond title", async () => {
    const csv = Buffer.from("title,priority,notes\nTest todo,high,some note");
    const result = await db.$transaction((tx) =>
      importTodosFromCSV(tx, TEST_USER_ID, csv, TEST_LIST_ID),
    );
    expect(result.count).toBe(1);

    const todos = await listTodos(db, TEST_USER_ID, TEST_LIST_ID);
    const imported = todos.filter((t) => t.title === "Test todo");
    createdTodoIds.push(...imported.map((t) => t.id));
    expect(todos.some((t) => t.title === "Test todo")).toBe(true);
  });

  it("exports todos as CSV with title and completed columns", async () => {
    const todo = await db.$transaction((tx) =>
      createTodo(tx, TEST_USER_ID, "Export me", TEST_LIST_ID),
    );
    createdTodoIds.push(todo.id);

    const csv = await exportTodosAsCSV(db, TEST_USER_ID, TEST_LIST_ID);
    expect(csv).toContain("title");
    expect(csv).toContain("completed");
    expect(csv).toContain("Export me");
  });

  it("exports empty CSV with headers when no todos exist", async () => {
    const csv = await exportTodosAsCSV(db, TEST_USER_ID, TEST_LIST_ID);
    expect(csv).toBe("title,completed");
  });

  it("properly escapes titles containing commas", async () => {
    const todo = await db.$transaction((tx) =>
      createTodo(tx, TEST_USER_ID, "Buy eggs, milk, bread", TEST_LIST_ID),
    );
    createdTodoIds.push(todo.id);

    const csv = await exportTodosAsCSV(db, TEST_USER_ID, TEST_LIST_ID);
    expect(csv).toContain('"Buy eggs, milk, bread"');
  });

  it("sorts completed todos after active ones", async () => {
    const active = await db.$transaction((tx) =>
      createTodo(tx, TEST_USER_ID, "Active", TEST_LIST_ID),
    );
    const done = await db.$transaction((tx) =>
      createTodo(tx, TEST_USER_ID, "Done", TEST_LIST_ID),
    );
    createdTodoIds.push(active.id, done.id);

    await db.$transaction((tx) =>
      completeTodo(tx, TEST_USER_ID, done.id, true),
    );

    const todos = await listTodos(db, TEST_USER_ID, TEST_LIST_ID);
    expect(todos[0]?.title).toBe("Active");
    expect(todos[1]?.title).toBe("Done");
    expect(todos[1]?.completed).toBe(true);
  });

  it("listTodos returns todoList via include", async () => {
    const todo = await db.$transaction((tx) =>
      createTodo(tx, TEST_USER_ID, "With list", TEST_LIST_ID),
    );
    createdTodoIds.push(todo.id);

    const todos = await listTodos(db, TEST_USER_ID, TEST_LIST_ID);
    const found = todos.find((t) => t.id === todo.id);
    expect(found?.todoList?.name).toBe("Test List");
  });

  it("position scoping: creating in one list does not shift another list", async () => {
    const listB = await db.todoList.create({
      data: { name: "List B", userId: TEST_USER_ID },
    });
    const todoB = await db.$transaction((tx) =>
      createTodo(tx, TEST_USER_ID, "B-item", listB.id),
    );

    const todoA = await db.$transaction((tx) =>
      createTodo(tx, TEST_USER_ID, "A-item", TEST_LIST_ID),
    );
    createdTodoIds.push(todoA.id, todoB.id);

    const listBTodos = await listTodos(db, TEST_USER_ID, listB.id);
    expect(listBTodos[0]?.position).toBe(0); // unchanged

    await db.todo.deleteMany({ where: { todoListId: listB.id } });
    await db.todoList.delete({ where: { id: listB.id } });
  });
});

describe("todo CRUD by collaborators", () => {
  const OWNER_ID = "test-owner-todo-collab";
  const COLLAB_ID = "test-collab-todo-collab";
  const OUTSIDER_ID = "test-outsider-todo-collab";
  let sharedListId: string;

  beforeAll(async () => {
    await db.user.deleteMany({
      where: { id: { in: [OWNER_ID, COLLAB_ID, OUTSIDER_ID] } },
    });
    await db.user.createMany({
      data: [
        {
          id: OWNER_ID,
          name: "Owner",
          email: "owner-todo-collab@example.com",
          username: "owner-todo-collab",
          emailVerified: false,
        },
        {
          id: COLLAB_ID,
          name: "Collab",
          email: "collab-todo-collab@example.com",
          username: "collab-todo-collab",
          emailVerified: false,
        },
        {
          id: OUTSIDER_ID,
          name: "Outsider",
          email: "outsider-todo-collab@example.com",
          username: "outsider-todo-collab",
          emailVerified: false,
        },
      ],
    });
  });

  beforeEach(async () => {
    const list = await db.todoList.create({
      data: { name: "Shared Todo List", userId: OWNER_ID },
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
      where: { id: { in: [OWNER_ID, COLLAB_ID, OUTSIDER_ID] } },
    });
  });

  it("collaborator can listTodos and sees owner's rows", async () => {
    await db.todo.create({
      data: {
        title: "Owner's milk",
        userId: OWNER_ID,
        todoListId: sharedListId,
        position: 0,
      },
    });
    const todos = await listTodos(db, COLLAB_ID, sharedListId);
    expect(todos.map((t) => t.title)).toContain("Owner's milk");
    expect(todos.length).toBe(1);
  });

  it("collaborator can createTodo; userId records the creator", async () => {
    const created = await db.$transaction((tx) =>
      createTodo(tx, COLLAB_ID, "Bob's bread", sharedListId),
    );
    expect(created.userId).toBe(COLLAB_ID);
    expect(created.todoListId).toBe(sharedListId);
    expect(created.title).toBe("Bob's bread");
  });

  it("collaborator can completeTodo on owner's row; update actually applies", async () => {
    const ownerTodo = await db.todo.create({
      data: {
        title: "Owner's todo",
        userId: OWNER_ID,
        todoListId: sharedListId,
        position: 0,
        completed: false,
      },
    });
    const updated = await db.$transaction((tx) =>
      completeTodo(tx, COLLAB_ID, ownerTodo.id, true),
    );
    expect(updated.id).toBe(ownerTodo.id);
    expect(updated.completed).toBe(true);

    // Verify row actually changed (catches stale {id, userId} filter leaking)
    const fresh = await db.todo.findUnique({ where: { id: ownerTodo.id } });
    expect(fresh?.completed).toBe(true);
  });

  it("collaborator can deleteTodo on owner's row; row actually gone", async () => {
    const ownerTodo = await db.todo.create({
      data: {
        title: "Owner's doomed todo",
        userId: OWNER_ID,
        todoListId: sharedListId,
        position: 0,
      },
    });
    const deleted = await db.$transaction((tx) =>
      deleteTodo(tx, COLLAB_ID, ownerTodo.id),
    );
    expect(deleted.id).toBe(ownerTodo.id);

    const fresh = await db.todo.findUnique({ where: { id: ownerTodo.id } });
    expect(fresh).toBeNull();
  });

  it("collaborator can reorderTodos; positions actually update", async () => {
    const first = await db.todo.create({
      data: {
        title: "First",
        userId: OWNER_ID,
        todoListId: sharedListId,
        position: 0,
        completed: false,
      },
    });
    const second = await db.todo.create({
      data: {
        title: "Second",
        userId: OWNER_ID,
        todoListId: sharedListId,
        position: 1,
        completed: false,
      },
    });

    await db.$transaction((tx) =>
      reorderTodos(tx, COLLAB_ID, sharedListId, [second.id, first.id]),
    );

    const freshFirst = await db.todo.findUnique({ where: { id: first.id } });
    const freshSecond = await db.todo.findUnique({ where: { id: second.id } });
    expect(freshSecond?.position).toBe(0);
    expect(freshFirst?.position).toBe(1);
  });

  it("collaborator can exportTodosAsCSV and CSV includes owner's rows", async () => {
    await db.todo.create({
      data: {
        title: "Owner's export row",
        userId: OWNER_ID,
        todoListId: sharedListId,
        position: 0,
      },
    });
    const csv = await exportTodosAsCSV(db, COLLAB_ID, sharedListId);
    expect(csv).toContain("Owner's export row");
  });

  it("collaborator can importTodosFromCSV; new rows have userId=collaborator", async () => {
    const csv = Buffer.from("title\nCollab row A\nCollab row B\n", "utf-8");
    const res = await db.$transaction((tx) =>
      importTodosFromCSV(tx, COLLAB_ID, csv, sharedListId),
    );
    expect(res.count).toBe(2);

    const todos = await db.todo.findMany({
      where: { todoListId: sharedListId },
      orderBy: { position: "asc" },
    });
    const imported = todos.filter((t) => t.title.startsWith("Collab row"));
    expect(imported.length).toBe(2);
    expect(imported.every((t) => t.userId === COLLAB_ID)).toBe(true);
  });

  it("completeTodo publishes todo-updated event on the list channel", async () => {
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
    expect(published).toEqual([
      { kind: "todo-updated", listId: sharedListId, todoId: ownerTodo.id },
    ]);
  });

  it("outsider listTodos throws FORBIDDEN", async () => {
    await expect(
      listTodos(db, OUTSIDER_ID, sharedListId),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("outsider createTodo throws FORBIDDEN", async () => {
    await expect(
      db.$transaction((tx) => createTodo(tx, OUTSIDER_ID, "x", sharedListId)),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
