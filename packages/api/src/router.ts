import { todoListRouter } from "./routers/todo-list.js";
import { todoRouter } from "./routers/todo.js";
import { router } from "./trpc.js";

export const appRouter = router({
  todoList: todoListRouter,
  todo: todoRouter,
});

export type AppRouter = typeof appRouter;
