import type { AppRouter } from "@project/api/router";
import type { inferRouterOutputs } from "@trpc/server";

type RouterOutput = inferRouterOutputs<AppRouter>;
export type TodoListWithCount = RouterOutput["todoList"]["list"][number];
