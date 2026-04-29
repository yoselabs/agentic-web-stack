import type { AppRouter } from "@project/api/router";
import { type QueryClient, useMutation, useQuery } from "@tanstack/react-query";
import type { TRPCOptionsProxy } from "@trpc/tanstack-react-query";

export function useTodos(
  trpc: TRPCOptionsProxy<AppRouter>,
  queryClient: QueryClient,
  todoListId: string,
) {
  const todos = useQuery(trpc.todo.list.queryOptions({ todoListId }));

  const invalidate = () => {
    queryClient.invalidateQueries(trpc.todo.list.queryFilter({ todoListId }));
  };

  const createTodo = useMutation(
    trpc.todo.create.mutationOptions({ onSuccess: invalidate }),
  );

  const toggleTodo = useMutation(
    trpc.todo.toggle.mutationOptions({ onSuccess: invalidate }),
  );

  const deleteTodo = useMutation(
    trpc.todo.delete.mutationOptions({ onSuccess: invalidate }),
  );

  return { todos, createTodo, toggleTodo, deleteTodo };
}
