// Placeholder types — commit 2 (schema migration) replaces these with
// `Schema.Schema.Type<typeof TodoSchema.X>` once todo-schema.ts is
// rewritten to Effect Schema.
type TodoList = {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly userId: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

type Todo = {
  readonly id: string;
  readonly title: string;
  readonly completed: boolean;
  readonly position: number;
  readonly userId: string;
  readonly todoListId: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

type CreateTodoListInput = { readonly name: string; readonly color: string };
type TodoListIdInput = { readonly id: string };
type TodosOfListInput = { readonly todoListId: string };
type CreateTodoInput = { readonly todoListId: string; readonly title: string };
type TodoIdInput = { readonly id: string };
type DeleteResult = { readonly id: string };
type PurgeInput = { readonly olderThanDays: number };
type PurgeReport = { readonly deleted: number };

import { Effect } from "effect";
import type { CurrentSession } from "../../runtime/auth-layer.ts";
import type { Db } from "../../runtime/db-layer.ts";
import type {
  TodoListError,
  TodoListNotFoundError,
  TodoNotFoundError,
  TodoNotOwnedError,
  TodoSkippedError,
} from "./todo-errors.ts";

export class TodoListService extends Effect.Service<TodoListService>()(
  "@project/api/TodoListService",
  {
    succeed: {
      list: (
        _input: Record<string, never>,
      ): Effect.Effect<
        ReadonlyArray<TodoList>,
        TodoListError,
        Db | CurrentSession
      > => Effect.die("not implemented"),

      create: (
        _input: CreateTodoListInput,
      ): Effect.Effect<TodoList, TodoListError, Db | CurrentSession> =>
        Effect.die("not implemented"),

      delete: (
        _input: TodoListIdInput,
      ): Effect.Effect<
        DeleteResult,
        TodoListError | TodoListNotFoundError | TodoNotOwnedError,
        Db | CurrentSession
      > => Effect.die("not implemented"),

      listTodos: (
        _input: TodosOfListInput,
      ): Effect.Effect<
        ReadonlyArray<Todo>,
        TodoListError | TodoListNotFoundError | TodoNotOwnedError,
        Db | CurrentSession
      > => Effect.die("not implemented"),

      createTodo: (
        _input: CreateTodoInput,
      ): Effect.Effect<
        Todo,
        TodoListError | TodoListNotFoundError | TodoNotOwnedError,
        Db | CurrentSession
      > => Effect.die("not implemented"),

      toggleTodo: (
        _input: TodoIdInput,
      ): Effect.Effect<
        Todo,
        TodoListError | TodoNotFoundError | TodoNotOwnedError,
        Db | CurrentSession
      > => Effect.die("not implemented"),

      deleteTodo: (
        _input: TodoIdInput,
      ): Effect.Effect<
        DeleteResult,
        TodoListError | TodoNotFoundError | TodoNotOwnedError,
        Db | CurrentSession
      > => Effect.die("not implemented"),

      /**
       * Purge stale completed todos older than the cutoff.
       * @totality
       */
      purge: (
        _input: PurgeInput,
      ): Effect.Effect<PurgeReport, TodoSkippedError | TodoListError, Db> =>
        Effect.die("not implemented"),
    },
  },
) {}
