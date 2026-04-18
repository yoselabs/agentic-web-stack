import { z } from "zod";
import { protectedProcedure, router } from "../../trpc.js";
import {
  createTodoList,
  deleteTodoList,
  getTodoList,
  listTodoLists,
} from "./service.js";

export const todoListRouter = router({
  list: protectedProcedure.query(({ ctx }) => {
    return listTodoLists(ctx.db, ctx.session.user.id);
  }),
  get: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(({ ctx, input }) => {
      return getTodoList(ctx.db, ctx.session.user.id, input.id);
    }),
  create: protectedProcedure
    .input(z.object({ name: z.string().min(1), color: z.string().optional() }))
    .mutation(({ ctx, input }) => {
      return ctx.db.$transaction((tx) =>
        createTodoList(tx, ctx.session.user.id, input.name, input.color),
      );
    }),
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ ctx, input }) => {
      return ctx.db.$transaction((tx) =>
        deleteTodoList(tx, ctx.session.user.id, input.id),
      );
    }),
});
