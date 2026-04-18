import { chatRouter } from "./domains/chat/router.js";
import { todoListRouter } from "./domains/todo-list/router.js";
import { todoRouter } from "./domains/todo/router.js";
import { userRouter } from "./domains/user/router.js";
import { router } from "./trpc.js";

// Append-alpha convention: register sub-routers one per line in alphabetical
// order of their key. New features INSERT at the alpha position, not append
// to the bottom — so two agents adding features in parallel edit different
// lines. See packages/api/CLAUDE.md § "Append-Alpha Router Registration".
export const appRouter = router({
  chat: chatRouter,
  todo: todoRouter,
  todoList: todoListRouter,
  user: userRouter,
});

export type AppRouter = typeof appRouter;
