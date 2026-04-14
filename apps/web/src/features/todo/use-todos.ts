import {
  type DragEndEvent,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import type { AppRouter } from "@project/api";
import { type QueryClient, useMutation, useQuery } from "@tanstack/react-query";
import type { TRPCOptionsProxy } from "@trpc/tanstack-react-query";
import { useState } from "react";
import { flushSync } from "react-dom";
import { toast } from "sonner";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

export function useTodos(
  trpc: TRPCOptionsProxy<AppRouter>,
  queryClient: QueryClient,
  todoListId: string,
) {
  const [newTitle, setNewTitle] = useState("");

  const todos = useQuery(trpc.todo.list.queryOptions({ todoListId }));

  const activeTodos = todos.data?.filter((t) => !t.completed) ?? [];
  const completedTodos = todos.data?.filter((t) => t.completed) ?? [];

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const createTodo = useMutation(
    trpc.todo.create.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries(trpc.todo.list.queryFilter({ todoListId }));
        setNewTitle("");
        toast.success("Todo added");
      },
      onError: () => toast.error("Failed to add todo"),
    }),
  );

  const completeTodo = useMutation(
    trpc.todo.complete.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries(trpc.todo.list.queryFilter({ todoListId }));
      },
      onError: () => toast.error("Failed to update todo"),
    }),
  );

  const deleteTodo = useMutation(
    trpc.todo.delete.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries(trpc.todo.list.queryFilter({ todoListId }));
        toast.success("Todo deleted");
      },
      onError: () => toast.error("Failed to delete todo"),
    }),
  );

  const reorderTodos = useMutation(
    trpc.todo.reorder.mutationOptions({
      onError: () => {
        // Rollback: refetch server state since optimistic update was wrong
        queryClient.invalidateQueries(trpc.todo.list.queryFilter({ todoListId }));
        toast.error("Failed to reorder");
      },
    }),
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    createTodo.mutate({ title: newTitle.trim(), todoListId });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = activeTodos.findIndex((t) => t.id === active.id);
    const newIndex = activeTodos.findIndex((t) => t.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(activeTodos, oldIndex, newIndex);

    // Read current completed todos from cache to avoid stale closure
    const currentData = queryClient.getQueryData<typeof todos.data>(
      trpc.todo.list.queryFilter({ todoListId }).queryKey,
    );
    const currentCompleted = currentData?.filter((t) => t.completed) ?? [];

    // Cancel in-flight list queries (fire-and-forget — setQueryData below overrides anyway)
    queryClient.cancelQueries(trpc.todo.list.queryFilter({ todoListId }));

    // flushSync forces React to re-render synchronously so the DOM order
    // matches before @dnd-kit resets CSS transforms (prevents item flash)
    flushSync(() => {
      queryClient.setQueryData(trpc.todo.list.queryFilter({ todoListId }).queryKey, [
        ...reordered,
        ...currentCompleted,
      ]);
    });

    reorderTodos.mutate({ ids: reordered.map((t) => t.id) });
  };

  const importTodos = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("todoListId", todoListId);
      const res = await fetch(`${API_URL}/api/todos/import`, {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Import failed");
      }
      return res.json() as Promise<{ count: number }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries(trpc.todo.list.queryFilter({ todoListId }));
      toast.success(`Imported ${data.count} todos`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const exportTodos = async () => {
    const res = await fetch(`${API_URL}/api/todos/export?todoListId=${todoListId}`, {
      credentials: "include",
    });
    if (!res.ok) {
      toast.error("Export failed");
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "todos.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return {
    newTitle,
    setNewTitle,
    todos,
    activeTodos,
    completedTodos,
    sensors,
    createTodo,
    completeTodo,
    deleteTodo,
    handleSubmit,
    handleDragEnd,
    importTodos,
    exportTodos,
  };
}
