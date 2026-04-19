import { z } from "zod";
import { protectedProcedure, router } from "../../trpc.js";
import {
  completeTodo,
  createTodo,
  deleteTodo,
  listTodos,
  reorderTodos,
} from "./todo-service.js";

export const todoRouter = router({
  list: protectedProcedure
    .input(z.object({ todoListId: z.string() }))
    .query(({ ctx, input }) => {
      return listTodos(ctx.db, ctx.session.user.id, input.todoListId);
    }),
  create: protectedProcedure
    .input(z.object({ title: z.string().min(1), todoListId: z.string() }))
    .mutation(({ ctx, input }) => {
      return ctx.db.$transaction((tx) =>
        createTodo(tx, ctx.session.user.id, input.title, input.todoListId),
      );
    }),
  complete: protectedProcedure
    .input(z.object({ id: z.string(), completed: z.boolean() }))
    .mutation(({ ctx, input }) => {
      return ctx.db.$transaction((tx) =>
        completeTodo(tx, ctx.session.user.id, input.id, input.completed),
      );
    }),
  reorder: protectedProcedure
    .input(
      z.object({
        todoListId: z.string().min(1),
        ids: z.array(z.string()).min(1),
      }),
    )
    .mutation(({ ctx, input }) => {
      return ctx.db.$transaction((tx) =>
        reorderTodos(tx, ctx.session.user.id, input.todoListId, input.ids),
      );
    }),
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ ctx, input }) => {
      return ctx.db.$transaction((tx) =>
        deleteTodo(tx, ctx.session.user.id, input.id),
      );
    }),
});
