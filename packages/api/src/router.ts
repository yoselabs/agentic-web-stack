import { todoListRouter, todoRouter } from "./domains/todo-list/todo-router.ts";
import { router } from "./trpc.ts";

// ADR-0012 — composed app router. Domains added per Phase 3 / Phase 4
// capability walk.
export const appRouter = router({
  todoList: todoListRouter,
  todo: todoRouter,
});

export type AppRouter = typeof appRouter;
