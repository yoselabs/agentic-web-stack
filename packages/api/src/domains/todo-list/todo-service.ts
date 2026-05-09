import { Effect } from "effect";
import type { CurrentSession } from "../../runtime/auth-layer.ts";
import { requireSession } from "../../runtime/auth-layer.ts";
import { type Db, tryDb, withTransaction } from "../../runtime/db-layer.ts";
import {
  TodoListError,
  TodoListNotFoundError,
  TodoNotFoundError,
  TodoNotOwnedError,
  type TodoSkippedError,
} from "./todo-errors.ts";
import type * as TodoSchema from "./todo-schema.ts";

// ADR-0013 — DB access via the `Db` Layer; per-domain helpers absorb
// the Effect.tryPromise boilerplate. Each procedure that needs a
// logged-in user composes `requireSession` to narrow CurrentSession.

// Maps DbError to the domain's TodoListError wrapper, keeping the cause
// for observability while presenting a clean E channel to callers.
const dbOp = <A>(
  thunk: Parameters<typeof tryDb>[0],
): Effect.Effect<A, TodoListError, Db> =>
  tryDb(thunk).pipe(
    Effect.mapError((e) => new TodoListError({ cause: e })),
  ) as Effect.Effect<A, TodoListError, Db>;

// requireSession inside a protected procedure is always satisfied — the
// tRPC protectedProcedure guard ensures CurrentSession is Some. If it is
// somehow None, that is a caller-layer bug; die rather than surface an
// E-channel UnauthorizedError from domain methods.
const session = requireSession.pipe(Effect.orDie);

const ensureListOwned = (
  listId: string,
): Effect.Effect<
  TodoSchema.TodoList,
  TodoListError | TodoListNotFoundError | TodoNotOwnedError,
  Db | CurrentSession
> =>
  Effect.gen(function* () {
    const s = yield* session;
    const list = yield* dbOp<TodoSchema.TodoList | null>((db) =>
      db.todoList.findUnique({ where: { id: listId } }),
    );
    if (!list)
      return yield* Effect.fail(new TodoListNotFoundError({ id: listId }));
    if (list.userId !== s.user.id) {
      return yield* Effect.fail(
        new TodoNotOwnedError({ listId, userId: s.user.id }),
      );
    }
    return list;
  });

const ensureTodoOwned = (
  todoId: string,
): Effect.Effect<
  TodoSchema.Todo,
  TodoListError | TodoNotFoundError | TodoNotOwnedError,
  Db | CurrentSession
> =>
  Effect.gen(function* () {
    const s = yield* session;
    const todo = yield* dbOp<TodoSchema.Todo | null>((db) =>
      db.todo.findUnique({ where: { id: todoId } }),
    );
    if (!todo) return yield* Effect.fail(new TodoNotFoundError({ id: todoId }));
    if (todo.userId !== s.user.id) {
      return yield* Effect.fail(
        new TodoNotOwnedError({
          listId: todo.todoListId,
          userId: s.user.id,
        }),
      );
    }
    return todo;
  });

// ── Exported method implementations ───────────────────────────────────────
// Canonical implementation of every TodoListService method.
// Consumed by:
//   - todo-contract.ts  (TodoListService.succeed: assembles these)
//   - todo-router.ts    (legacy direct usage until commit 4 migrates to Service API)
//   - todo-service.test.ts (unit tests until commit 4)

export const listTodoLists: Effect.Effect<
  ReadonlyArray<TodoSchema.TodoList>,
  TodoListError,
  Db | CurrentSession
> = Effect.gen(function* () {
  const s = yield* session;
  return yield* dbOp<ReadonlyArray<TodoSchema.TodoList>>((db) =>
    db.todoList.findMany({
      where: { userId: s.user.id },
      orderBy: { createdAt: "asc" },
    }),
  );
});

export const createTodoList = (
  input: TodoSchema.CreateTodoListInput,
): Effect.Effect<TodoSchema.TodoList, TodoListError, Db | CurrentSession> =>
  Effect.gen(function* () {
    const s = yield* session;
    return yield* dbOp<TodoSchema.TodoList>((db) =>
      db.$transaction(async (tx) => {
        const list = await tx.todoList.create({
          data: {
            name: input.name,
            color: input.color,
            userId: s.user.id,
          },
        });
        // Owner is also a member with role=owner — keeps membership
        // queries uniform across owners and collaborators (Phase 4
        // collaborators feature consumes this).
        await tx.todoListMembership.create({
          data: {
            todoListId: list.id,
            userId: s.user.id,
            role: "owner",
          },
        });
        return list;
      }),
    );
  });

export const deleteTodoList = (
  input: TodoSchema.TodoListIdInput,
): Effect.Effect<
  TodoSchema.DeleteResult,
  TodoListError | TodoListNotFoundError | TodoNotOwnedError,
  Db | CurrentSession
> =>
  Effect.gen(function* () {
    yield* ensureListOwned(input.id);
    yield* dbOp<unknown>((db) =>
      db.todoList.delete({ where: { id: input.id } }),
    );
    return { id: input.id };
  });

export const listTodos = (
  input: TodoSchema.TodosOfListInput,
): Effect.Effect<
  ReadonlyArray<TodoSchema.Todo>,
  TodoListError | TodoListNotFoundError | TodoNotOwnedError,
  Db | CurrentSession
> =>
  Effect.gen(function* () {
    yield* ensureListOwned(input.todoListId);
    return yield* dbOp<ReadonlyArray<TodoSchema.Todo>>((db) =>
      db.todo.findMany({
        where: { todoListId: input.todoListId },
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      }),
    );
  });

export const createTodo = (
  input: TodoSchema.CreateTodoInput,
): Effect.Effect<
  TodoSchema.Todo,
  TodoListError | TodoListNotFoundError | TodoNotOwnedError,
  Db | CurrentSession
> =>
  Effect.gen(function* () {
    const s = yield* session;
    yield* ensureListOwned(input.todoListId);
    const last = yield* dbOp<{ position: number } | null>((db) =>
      db.todo.findFirst({
        where: { todoListId: input.todoListId },
        orderBy: { position: "desc" },
        select: { position: true },
      }),
    );
    return yield* dbOp<TodoSchema.Todo>((db) =>
      db.todo.create({
        data: {
          title: input.title,
          todoListId: input.todoListId,
          userId: s.user.id,
          position: (last?.position ?? -1) + 1,
        },
      }),
    );
  });

export const toggleTodo = (
  input: TodoSchema.TodoIdInput,
): Effect.Effect<
  TodoSchema.Todo,
  TodoListError | TodoNotFoundError | TodoNotOwnedError,
  Db | CurrentSession
> =>
  Effect.gen(function* () {
    const todo = yield* ensureTodoOwned(input.id);
    return yield* dbOp<TodoSchema.Todo>((db) =>
      db.todo.update({
        where: { id: input.id },
        data: { completed: !todo.completed },
      }),
    );
  });

export const deleteTodo = (
  input: TodoSchema.TodoIdInput,
): Effect.Effect<
  TodoSchema.DeleteResult,
  TodoListError | TodoNotFoundError | TodoNotOwnedError,
  Db | CurrentSession
> =>
  Effect.gen(function* () {
    yield* ensureTodoOwned(input.id);
    yield* dbOp<unknown>((db) => db.todo.delete({ where: { id: input.id } }));
    return { id: input.id };
  });

/**
 * Purge stale completed todos older than the cutoff.
 * @totality
 *
 * Maintenance: delete completed todos older than N days. Called by the
 * repeatable `purge-stale-todos` cron registered on the maintenance
 * queue (apps/worker/src/schedule.ts).
 *
 * Staleness signal: `completed = true` AND `updatedAt < now - olderThanDays`.
 * `updatedAt` is bumped whenever the row changes (Prisma `@updatedAt`),
 * so a completed todo that hasn't been touched in N days is the target
 * — toggling completion on/off resets the clock, which is the desired
 * UX (intentional re-engagement keeps the row alive).
 *
 * R023: `TodoSkippedError` is declared in the E channel even though
 * today's implementation never raises it (purge is unconditional).
 * Future skip-with-reason behavior is type-tracked from day one.
 */
export const purgeTodos = (
  input: TodoSchema.PurgeInput,
): Effect.Effect<
  TodoSchema.PurgeReport,
  TodoSkippedError | TodoListError,
  Db
> =>
  withTransaction(
    Effect.gen(function* () {
      const cutoff = new Date(
        Date.now() - input.olderThanDays * 24 * 60 * 60 * 1000,
      );
      const result = yield* dbOp<{ count: number }>((db) =>
        db.todo.deleteMany({
          where: {
            completed: true,
            updatedAt: { lt: cutoff },
          },
        }),
      );
      return { deleted: result.count };
    }),
  ).pipe(Effect.mapError((e) => new TodoListError({ cause: e })));
