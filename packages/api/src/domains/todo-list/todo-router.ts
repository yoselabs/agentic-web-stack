import { Option } from "effect";
import { effectSchemaInput } from "../../runtime/effect-schema-input.ts";
import { runEffect } from "../../runtime/run-effect.ts";
import { protectedProcedure, router } from "../../trpc.ts";
import * as TodoSchema from "./todo-schema.ts";
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
    .input(effectSchemaInput(TodoSchema.CreateTodoListInput))
    .mutation(({ ctx, input }) =>
      runEffect(createTodoList(input), { session: Option.some(ctx.session) }),
    ),
  delete: protectedProcedure
    .input(effectSchemaInput(TodoSchema.TodoListIdInput))
    .mutation(({ ctx, input }) =>
      runEffect(deleteTodoList(input), { session: Option.some(ctx.session) }),
    ),
});

export const todoRouter = router({
  list: protectedProcedure
    .input(effectSchemaInput(TodoSchema.TodosOfListInput))
    .query(({ ctx, input }) =>
      runEffect(listTodos(input), { session: Option.some(ctx.session) }),
    ),
  create: protectedProcedure
    .input(effectSchemaInput(TodoSchema.CreateTodoInput))
    .mutation(({ ctx, input }) =>
      runEffect(createTodo(input), { session: Option.some(ctx.session) }),
    ),
  toggle: protectedProcedure
    .input(effectSchemaInput(TodoSchema.TodoIdInput))
    .mutation(({ ctx, input }) =>
      runEffect(toggleTodo(input), { session: Option.some(ctx.session) }),
    ),
  delete: protectedProcedure
    .input(effectSchemaInput(TodoSchema.TodoIdInput))
    .mutation(({ ctx, input }) =>
      runEffect(deleteTodo(input), { session: Option.some(ctx.session) }),
    ),
});
