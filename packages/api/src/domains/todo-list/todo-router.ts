import { Option } from "effect";
import { runEffect } from "../../runtime/run-effect.ts";
import { protectedProcedure, router } from "../../trpc.ts";
import {
  createTodoInput,
  createTodoListInput,
  todoIdInput,
  todoListIdInput,
  todosOfListInput,
} from "./todo-schema.ts";
import {
  createTodo,
  createTodoList,
  deleteTodo,
  deleteTodoList,
  listTodoLists,
  listTodos,
  toggleTodo,
} from "./todo-service.ts";

// ADR-0012 — tRPC v11 procedures adapted via runEffect. The router
// stays thin: validate input, delegate to the Effect service, return
// the Promise.

export const todoListRouter = router({
  list: protectedProcedure.query(({ ctx }) =>
    runEffect(listTodoLists, { session: Option.some(ctx.session) }),
  ),
  create: protectedProcedure
    .input(createTodoListInput)
    .mutation(({ ctx, input }) =>
      runEffect(createTodoList(input), { session: Option.some(ctx.session) }),
    ),
  delete: protectedProcedure
    .input(todoListIdInput)
    .mutation(({ ctx, input }) =>
      runEffect(deleteTodoList(input), { session: Option.some(ctx.session) }),
    ),
});

export const todoRouter = router({
  list: protectedProcedure
    .input(todosOfListInput)
    .query(({ ctx, input }) =>
      runEffect(listTodos(input), { session: Option.some(ctx.session) }),
    ),
  create: protectedProcedure
    .input(createTodoInput)
    .mutation(({ ctx, input }) =>
      runEffect(createTodo(input), { session: Option.some(ctx.session) }),
    ),
  toggle: protectedProcedure
    .input(todoIdInput)
    .mutation(({ ctx, input }) =>
      runEffect(toggleTodo(input), { session: Option.some(ctx.session) }),
    ),
  delete: protectedProcedure
    .input(todoIdInput)
    .mutation(({ ctx, input }) =>
      runEffect(deleteTodo(input), { session: Option.some(ctx.session) }),
    ),
});
