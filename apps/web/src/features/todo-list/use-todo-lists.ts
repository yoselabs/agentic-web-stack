import type { AppRouter } from "@project/api/router";
import { type QueryClient, useMutation, useQuery } from "@tanstack/react-query";
import type { TRPCOptionsProxy } from "@trpc/tanstack-react-query";
import { useState } from "react";
import { toast } from "sonner";
import type { AccessibleTodoList } from "./types.js";

// Uses listAccessible so collaborators also see shared lists in the sidebar
// alongside their owned lists. The `list` procedure (owned-only) is still
// invalidated for delete-path optimistic updates below, since `delete` only
// applies to owned lists.
export function useTodoLists(
  trpc: TRPCOptionsProxy<AppRouter>,
  queryClient: QueryClient,
) {
  const [newName, setNewName] = useState("");

  const todoLists = useQuery(trpc.todoList.listAccessible.queryOptions());

  const createTodoList = useMutation(
    trpc.todoList.create.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries(
          trpc.todoList.listAccessible.queryFilter(),
        );
        setNewName("");
        toast.success("List created");
      },
      onError: () => toast.error("Failed to create list"),
    }),
  );

  const deleteTodoList = useMutation(
    trpc.todoList.delete.mutationOptions({
      onMutate: async ({ id }) => {
        await queryClient.cancelQueries(
          trpc.todoList.listAccessible.queryFilter(),
        );
        const previous = queryClient.getQueryData<AccessibleTodoList[]>(
          trpc.todoList.listAccessible.queryFilter().queryKey,
        );
        queryClient.setQueryData<AccessibleTodoList[]>(
          trpc.todoList.listAccessible.queryFilter().queryKey,
          (old) => old?.filter((list) => list.id !== id),
        );
        return { previous };
      },
      onError: (_err, _vars, context) => {
        if (context?.previous) {
          queryClient.setQueryData(
            trpc.todoList.listAccessible.queryFilter().queryKey,
            context.previous,
          );
        }
        toast.error("Failed to delete list");
      },
      onSettled: () => {
        queryClient.invalidateQueries(
          trpc.todoList.listAccessible.queryFilter(),
        );
      },
    }),
  );

  const handleSubmit: React.SubmitEventHandler<HTMLFormElement> = (e) => {
    e.preventDefault();
    if (!newName.trim()) return;
    createTodoList.mutate({ name: newName.trim() });
  };

  return {
    newName,
    setNewName,
    todoLists,
    createTodoList,
    deleteTodoList,
    handleSubmit,
  };
}
