import type { AppRouter } from "@project/api";
import { type QueryClient, useMutation, useQuery } from "@tanstack/react-query";
import type { TRPCOptionsProxy } from "@trpc/tanstack-react-query";
import { useState } from "react";
import { toast } from "sonner";
import type { TodoListWithCount } from "./types.js";

export function useTodoLists(
  trpc: TRPCOptionsProxy<AppRouter>,
  queryClient: QueryClient,
) {
  const [newName, setNewName] = useState("");

  const todoLists = useQuery(trpc.todoList.list.queryOptions());

  const createTodoList = useMutation(
    trpc.todoList.create.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries(trpc.todoList.list.queryFilter());
        setNewName("");
        toast.success("List created");
      },
      onError: () => toast.error("Failed to create list"),
    }),
  );

  const deleteTodoList = useMutation(
    trpc.todoList.delete.mutationOptions({
      onMutate: async ({ id }) => {
        await queryClient.cancelQueries(trpc.todoList.list.queryFilter());
        const previous = queryClient.getQueryData<TodoListWithCount[]>(
          trpc.todoList.list.queryFilter().queryKey,
        );
        queryClient.setQueryData<TodoListWithCount[]>(
          trpc.todoList.list.queryFilter().queryKey,
          (old) => old?.filter((list) => list.id !== id),
        );
        return { previous };
      },
      onError: (_err, _vars, context) => {
        if (context?.previous) {
          queryClient.setQueryData(
            trpc.todoList.list.queryFilter().queryKey,
            context.previous,
          );
        }
        toast.error("Failed to delete list");
      },
      onSettled: () => {
        queryClient.invalidateQueries(trpc.todoList.list.queryFilter());
      },
    }),
  );

  const handleSubmit = (e: React.FormEvent) => {
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
