// ADR-0013 (DB Layer ergonomics — exercised via tryDb + transaction).
// ADR-0019 (bun test as the @project/api test runner).
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { db } from "@project/db";
import { Effect } from "effect";
import { ForbiddenError } from "../../../errors.ts";
import {
  makeTestUser,
  provideTestSession,
  resetDb,
} from "../../../test-helpers.ts";
import {
  createTodo,
  createTodoList,
  deleteTodoList,
  listTodoLists,
  listTodos,
  toggleTodo,
} from "../todo-service.ts";

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await db.$disconnect();
});

describe("todo-list service", () => {
  test("listTodoLists is empty for a new user", async () => {
    const session = await makeTestUser();
    const lists = await Effect.runPromise(
      provideTestSession(listTodoLists, session),
    );
    expect(lists).toEqual([]);
  });

  test("createTodoList persists and adds an owner membership (transaction)", async () => {
    const session = await makeTestUser();
    const created = await Effect.runPromise(
      provideTestSession(
        createTodoList({ name: "Groceries", color: "#ff0000" }),
        session,
      ),
    );
    expect(created.name).toBe("Groceries");

    const lists = await Effect.runPromise(
      provideTestSession(listTodoLists, session),
    );
    expect(lists).toHaveLength(1);
    expect(lists[0]?.id).toBe(created.id);

    const memberships = await db.todoListMembership.findMany({
      where: { todoListId: created.id },
    });
    expect(memberships).toHaveLength(1);
    expect(memberships[0]?.role).toBe("owner");
    expect(memberships[0]?.userId).toBe(session.user.id);
  });

  test("createTodo + listTodos round-trips", async () => {
    const session = await makeTestUser();
    const list = await Effect.runPromise(
      provideTestSession(
        createTodoList({ name: "Work", color: "#000000" }),
        session,
      ),
    );
    const todo = await Effect.runPromise(
      provideTestSession(
        createTodo({ todoListId: list.id, title: "Finish report" }),
        session,
      ),
    );
    expect(todo.title).toBe("Finish report");
    expect(todo.completed).toBe(false);

    const todos = await Effect.runPromise(
      provideTestSession(listTodos({ todoListId: list.id }), session),
    );
    expect(todos.map((t) => t.title)).toEqual(["Finish report"]);
  });

  test("toggleTodo flips completed", async () => {
    const session = await makeTestUser();
    const list = await Effect.runPromise(
      provideTestSession(
        createTodoList({ name: "L", color: "#000000" }),
        session,
      ),
    );
    const todo = await Effect.runPromise(
      provideTestSession(
        createTodo({ todoListId: list.id, title: "X" }),
        session,
      ),
    );
    const toggled = await Effect.runPromise(
      provideTestSession(toggleTodo({ id: todo.id }), session),
    );
    expect(toggled.completed).toBe(true);
  });

  test("deleteTodoList rejects another user (ForbiddenError)", async () => {
    const owner = await makeTestUser();
    const stranger = await makeTestUser();
    const list = await Effect.runPromise(
      provideTestSession(
        createTodoList({ name: "Owner only", color: "#000000" }),
        owner,
      ),
    );

    const result = await Effect.runPromiseExit(
      provideTestSession(deleteTodoList({ id: list.id }), stranger),
    );
    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      const failures = result.cause.toString();
      expect(failures).toContain("ForbiddenError");
    }
    // Ensure list is still there.
    const ownerLists = await Effect.runPromise(
      provideTestSession(listTodoLists, owner),
    );
    expect(ownerLists).toHaveLength(1);
  });

  test("listTodoLists is scoped to the requester", async () => {
    const a = await makeTestUser();
    const b = await makeTestUser();
    await Effect.runPromise(
      provideTestSession(
        createTodoList({ name: "A list", color: "#000000" }),
        a,
      ),
    );
    const bLists = await Effect.runPromise(
      provideTestSession(listTodoLists, b),
    );
    expect(bLists).toEqual([]);
  });

  // Sanity: ForbiddenError import is not unused.
  test("ForbiddenError remains importable", () => {
    expect(ForbiddenError).toBeDefined();
  });
});
