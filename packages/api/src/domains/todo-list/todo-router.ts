import { env } from "@project/env/server";
import { createRateLimiter } from "@project/rate-limit/factory";
import { getSharedRedis } from "@project/rate-limit/redis";
import { z } from "zod";
import { rateLimitByUser } from "../../rate-limit-middleware.js";
import { protectedProcedure, router } from "../../trpc.js";
import {
  completeTodo,
  createTodo,
  deleteTodo,
  listTodos,
  reorderTodos,
} from "./todo-service.js";

// 10 writes/minute per user. Under the test harness (`env.IS_TEST`) we
// use the in-memory backend so unit/integration tests don't require a
// live Redis — the counter still enforces the limit within a single
// process. Production + dev use the shared Redis connection so multiple
// server instances share one counter.
const todoWriteLimiter = createRateLimiter({
  name: "todo:write",
  points: 10,
  duration: 60,
  redis: env.IS_TEST ? undefined : getSharedRedis(),
});

const rateLimitedWrite = protectedProcedure.use(
  rateLimitByUser(todoWriteLimiter),
);

export const todoRouter = router({
  list: protectedProcedure
    .input(z.object({ todoListId: z.string() }))
    .query(({ ctx, input }) => {
      return listTodos(ctx.db, ctx.session.user.id, input.todoListId);
    }),
  create: rateLimitedWrite
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
