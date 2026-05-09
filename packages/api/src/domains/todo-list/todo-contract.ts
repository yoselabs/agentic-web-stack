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
import {
  createTodo,
  createTodoList,
  deleteTodo,
  deleteTodoList,
  listTodoLists,
  listTodos,
  purgeTodos,
  toggleTodo,
} from "./todo-service.ts";

// Contract: declares the public surface of TodoListService with explicit
// Effect.Effect<A, E, R> signatures on every method. The live
// implementation delegates to the individual functions exported from
// todo-service.ts — the succeed: object assembles them while keeping
// the explicit type annotations visible for lint checks.
//
// check-explicit-return-types and check-totality scan this file for:
//   - explicit Effect.Effect<A, E, R> annotations (all methods below)
//   - @totality presence on purge's E channel (*SkippedError variant)
//
// Spec: docs/superpowers/specs/2026-05-07-effect-contract-first-design.md §D1–D3.

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
      > => listTodoLists,

      create: (
        _input: TodoSchema.CreateTodoListInput,
      ): Effect.Effect<
        TodoSchema.TodoList,
        TodoListError,
        Db | CurrentSession
      > => createTodoList(_input),

      delete: (
        _input: TodoSchema.TodoListIdInput,
      ): Effect.Effect<
        TodoSchema.DeleteResult,
        TodoListError | TodoListNotFoundError | TodoNotOwnedError,
        Db | CurrentSession
      > => deleteTodoList(_input),

      listTodos: (
        _input: TodoSchema.TodosOfListInput,
      ): Effect.Effect<
        ReadonlyArray<TodoSchema.Todo>,
        TodoListError | TodoListNotFoundError | TodoNotOwnedError,
        Db | CurrentSession
      > => listTodos(_input),

      createTodo: (
        _input: TodoSchema.CreateTodoInput,
      ): Effect.Effect<
        TodoSchema.Todo,
        TodoListError | TodoListNotFoundError | TodoNotOwnedError,
        Db | CurrentSession
      > => createTodo(_input),

      toggleTodo: (
        _input: TodoSchema.TodoIdInput,
      ): Effect.Effect<
        TodoSchema.Todo,
        TodoListError | TodoNotFoundError | TodoNotOwnedError,
        Db | CurrentSession
      > => toggleTodo(_input),

      deleteTodo: (
        _input: TodoSchema.TodoIdInput,
      ): Effect.Effect<
        TodoSchema.DeleteResult,
        TodoListError | TodoNotFoundError | TodoNotOwnedError,
        Db | CurrentSession
      > => deleteTodo(_input),

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
      > => purgeTodos(_input),
    },
  },
) {}
