import type { AppRouter } from "@project/api/router";
import type { inferRouterOutputs } from "@trpc/server";

type RouterOutput = inferRouterOutputs<AppRouter>;

export type ChatMessage = RouterOutput["chat"]["messages"]["list"][number];
export type ChatRoomSummary = RouterOutput["chat"]["rooms"]["listMine"][number];
export type UserSearchResult = RouterOutput["user"]["search"][number];
