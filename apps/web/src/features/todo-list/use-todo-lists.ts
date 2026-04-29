import type { AppRouter } from "@project/api/router";
import { type QueryClient, useMutation, useQuery } from "@tanstack/react-query";
import type { TRPCOptionsProxy } from "@trpc/tanstack-react-query";

// Orchestration hook for the todo-lists pane. Encapsulates the query +
// create/delete mutations with cache invalidation. Route components
// stay thin shells.

export function useTodoLists(
  trpc: TRPCOptionsProxy<AppRouter>,
  queryClient: QueryClient,
) {
  const lists = useQuery(trpc.todoList.list.queryOptions());

  const createList = useMutation(
    trpc.todoList.create.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries(trpc.todoList.list.queryFilter());
      },
    }),
  );

  const deleteList = useMutation(
    trpc.todoList.delete.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries(trpc.todoList.list.queryFilter());
      },
    }),
  );

  return { lists, createList, deleteList };
}
