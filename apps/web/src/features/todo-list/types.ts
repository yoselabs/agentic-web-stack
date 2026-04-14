import type { AppRouter, inferRouterOutputs } from "@project/api";

type RouterOutput = inferRouterOutputs<AppRouter>;
export type TodoListWithCount = RouterOutput["todoList"]["list"][number];
