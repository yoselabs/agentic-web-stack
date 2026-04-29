import { Effect } from "effect";
import { ForbiddenError, NotFoundError } from "../../errors.ts";
import { requireSession } from "../../runtime/auth-layer.ts";
import { tryDb } from "../../runtime/db-layer.ts";

// ADR-0013 — DB access via the `Db` Layer; per-domain helpers absorb
// the Effect.tryPromise boilerplate. Each procedure that needs a
// logged-in user composes `requireSession` to narrow CurrentSession.

const ensureListOwned = (listId: string) =>
  Effect.gen(function* () {
    const session = yield* requireSession;
    const list = yield* tryDb((db) =>
      db.todoList.findUnique({ where: { id: listId } }),
    );
    if (!list)
      return yield* Effect.fail(
        new NotFoundError({ entity: "TodoList", id: listId }),
      );
    if (list.userId !== session.user.id) {
      return yield* Effect.fail(
        new ForbiddenError({ reason: "not list owner" }),
      );
    }
    return list;
  });

const ensureTodoOwned = (todoId: string) =>
  Effect.gen(function* () {
    const session = yield* requireSession;
    const todo = yield* tryDb((db) =>
      db.todo.findUnique({ where: { id: todoId } }),
    );
    if (!todo)
      return yield* Effect.fail(
        new NotFoundError({ entity: "Todo", id: todoId }),
      );
    if (todo.userId !== session.user.id) {
      return yield* Effect.fail(
        new ForbiddenError({ reason: "not todo owner" }),
      );
    }
    return todo;
  });

export const listTodoLists = Effect.gen(function* () {
  const session = yield* requireSession;
  return yield* tryDb((db) =>
    db.todoList.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: "asc" },
    }),
  );
});

export const createTodoList = (input: { name: string; color: string }) =>
  Effect.gen(function* () {
    const session = yield* requireSession;
    return yield* tryDb((db) =>
      db.$transaction(async (tx) => {
        const list = await tx.todoList.create({
          data: {
            name: input.name,
            color: input.color,
            userId: session.user.id,
          },
        });
        // Owner is also a member with role=owner — keeps membership
        // queries uniform across owners and collaborators (Phase 4
        // collaborators feature consumes this).
        await tx.todoListMembership.create({
          data: {
            todoListId: list.id,
            userId: session.user.id,
            role: "owner",
          },
        });
        return list;
      }),
    );
  });

export const deleteTodoList = (input: { id: string }) =>
  Effect.gen(function* () {
    yield* ensureListOwned(input.id);
    yield* tryDb((db) => db.todoList.delete({ where: { id: input.id } }));
    return { id: input.id };
  });

export const listTodos = (input: { todoListId: string }) =>
  Effect.gen(function* () {
    yield* ensureListOwned(input.todoListId);
    return yield* tryDb((db) =>
      db.todo.findMany({
        where: { todoListId: input.todoListId },
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      }),
    );
  });

export const createTodo = (input: { todoListId: string; title: string }) =>
  Effect.gen(function* () {
    const session = yield* requireSession;
    yield* ensureListOwned(input.todoListId);
    const last = yield* tryDb((db) =>
      db.todo.findFirst({
        where: { todoListId: input.todoListId },
        orderBy: { position: "desc" },
        select: { position: true },
      }),
    );
    return yield* tryDb((db) =>
      db.todo.create({
        data: {
          title: input.title,
          todoListId: input.todoListId,
          userId: session.user.id,
          position: (last?.position ?? -1) + 1,
        },
      }),
    );
  });

export const toggleTodo = (input: { id: string }) =>
  Effect.gen(function* () {
    const todo = yield* ensureTodoOwned(input.id);
    return yield* tryDb((db) =>
      db.todo.update({
        where: { id: input.id },
        data: { completed: !todo.completed },
      }),
    );
  });

export const deleteTodo = (input: { id: string }) =>
  Effect.gen(function* () {
    yield* ensureTodoOwned(input.id);
    yield* tryDb((db) => db.todo.delete({ where: { id: input.id } }));
    return { id: input.id };
  });
