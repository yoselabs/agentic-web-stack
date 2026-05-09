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
import type * as TodoSchema from "./todo-schema.ts";

export class TodoListService extends Effect.Service<TodoListService>()(
  "@project/api/TodoListService",
  {
    succeed: {
      list: (
        _input: TodoSchema.ListTodoListsInput,
      ): Effect.Effect<
        ReadonlyArray<TodoSchema.TodoList>,
        TodoListError,
        Db | CurrentSession
      > => Effect.die("not implemented"),

      create: (
        _input: TodoSchema.CreateTodoListInput,
      ): Effect.Effect<
        TodoSchema.TodoList,
        TodoListError,
        Db | CurrentSession
      > => Effect.die("not implemented"),

      delete: (
        _input: TodoSchema.TodoListIdInput,
      ): Effect.Effect<
        TodoSchema.DeleteResult,
        TodoListError | TodoListNotFoundError | TodoNotOwnedError,
        Db | CurrentSession
      > => Effect.die("not implemented"),

      listTodos: (
        _input: TodoSchema.TodosOfListInput,
      ): Effect.Effect<
        ReadonlyArray<TodoSchema.Todo>,
        TodoListError | TodoListNotFoundError | TodoNotOwnedError,
        Db | CurrentSession
      > => Effect.die("not implemented"),

      createTodo: (
        _input: TodoSchema.CreateTodoInput,
      ): Effect.Effect<
        TodoSchema.Todo,
        TodoListError | TodoListNotFoundError | TodoNotOwnedError,
        Db | CurrentSession
      > => Effect.die("not implemented"),

      toggleTodo: (
        _input: TodoSchema.TodoIdInput,
      ): Effect.Effect<
        TodoSchema.Todo,
        TodoListError | TodoNotFoundError | TodoNotOwnedError,
        Db | CurrentSession
      > => Effect.die("not implemented"),

      deleteTodo: (
        _input: TodoSchema.TodoIdInput,
      ): Effect.Effect<
        TodoSchema.DeleteResult,
        TodoListError | TodoNotFoundError | TodoNotOwnedError,
        Db | CurrentSession
      > => Effect.die("not implemented"),

      /**
       * Purge stale completed todos older than the cutoff.
       * @totality
       */
      purge: (
        _input: TodoSchema.PurgeInput,
      ): Effect.Effect<
        TodoSchema.PurgeReport,
        TodoSkippedError | TodoListError,
        Db
      > => Effect.die("not implemented"),
    },
  },
) {}
