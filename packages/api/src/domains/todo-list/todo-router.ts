import { RateLimiter } from "@project/rate-limit/contract";
import { Effect, Option } from "effect";
import { requireSession } from "../../runtime/auth-layer.ts";
import { effectSchemaInput } from "../../runtime/effect-schema-input.ts";
import { runEffect } from "../../runtime/run-effect.ts";
import { protectedProcedure, router } from "../../trpc.ts";
import { TodoListService } from "./todo-contract.ts";
import * as TodoSchema from "./todo-schema.ts";

// ADR-0012 — tRPC v11 procedures adapted via runEffect. The router
// stays thin: validate input, resolve TodoListService from the runtime,
// delegate to the matching method, return the Promise.
//
// ADR-0021 — `create` is the representative procedure that wires
// rate-limiting via Layer composition. The bucket is keyed by user
// id so well-behaved users never starve each other. Default policy
// (30/60s) lives on RateLimiter.Default; a per-procedure tighter
// bucket would compose via Layer.succeed at this site.

export const todoListRouter = router({
  list: protectedProcedure.query(({ ctx }) =>
    runEffect(
      Effect.gen(function* () {
        const svc = yield* TodoListService;
        return yield* svc.list({});
      }),
      { session: Option.some(ctx.session) },
    ),
  ),
  create: protectedProcedure
    .input(effectSchemaInput(TodoSchema.CreateTodoListInput))
    .mutation(({ ctx, input }) =>
      runEffect(
        Effect.gen(function* () {
          const session = yield* requireSession;
          const limiter = yield* RateLimiter;
          yield* limiter.consume(`todo-list:create:${session.user.id}`);
          const svc = yield* TodoListService;
          return yield* svc.create(input);
        }),
        { session: Option.some(ctx.session) },
      ),
    ),
  delete: protectedProcedure
    .input(effectSchemaInput(TodoSchema.TodoListIdInput))
    .mutation(({ ctx, input }) =>
      runEffect(
        Effect.gen(function* () {
          const svc = yield* TodoListService;
          return yield* svc.delete(input);
        }),
        { session: Option.some(ctx.session) },
      ),
    ),
});

export const todoRouter = router({
  list: protectedProcedure
    .input(effectSchemaInput(TodoSchema.TodosOfListInput))
    .query(({ ctx, input }) =>
      runEffect(
        Effect.gen(function* () {
          const svc = yield* TodoListService;
          return yield* svc.listTodos(input);
        }),
        { session: Option.some(ctx.session) },
      ),
    ),
  create: protectedProcedure
    .input(effectSchemaInput(TodoSchema.CreateTodoInput))
    .mutation(({ ctx, input }) =>
      runEffect(
        Effect.gen(function* () {
          const svc = yield* TodoListService;
          return yield* svc.createTodo(input);
        }),
        { session: Option.some(ctx.session) },
      ),
    ),
  toggle: protectedProcedure
    .input(effectSchemaInput(TodoSchema.TodoIdInput))
    .mutation(({ ctx, input }) =>
      runEffect(
        Effect.gen(function* () {
          const svc = yield* TodoListService;
          return yield* svc.toggleTodo(input);
        }),
        { session: Option.some(ctx.session) },
      ),
    ),
  delete: protectedProcedure
    .input(effectSchemaInput(TodoSchema.TodoIdInput))
    .mutation(({ ctx, input }) =>
      runEffect(
        Effect.gen(function* () {
          const svc = yield* TodoListService;
          return yield* svc.deleteTodo(input);
        }),
        { session: Option.some(ctx.session) },
      ),
    ),
});
