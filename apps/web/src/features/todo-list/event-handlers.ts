// Per-kind realtime-event handler map. Each handler applies a cache patch
// (or invalidation) in response to a TodoListEvent.
//
// Payload-shaped kinds (todo-*, todos-*) use setQueryData — no refetch on
// the hot path. Notification-shaped kinds (todo-list-*) use invalidateQueries.

import type {
  TodoListEvent,
  TodoListEventKind,
  TodoWithList,
} from "@project/api/domains/todo-list/events";
import type { AppRouter } from "@project/api/router";
import type { QueryClient } from "@tanstack/react-query";
import type { TRPCOptionsProxy } from "@trpc/tanstack-react-query";

type Handler<K extends TodoListEventKind> = (
  trpc: TRPCOptionsProxy<AppRouter>,
  qc: QueryClient,
  event: Extract<TodoListEvent, { kind: K }>,
) => void;

// Re-sort to match the server's `orderBy: [{ completed: "asc" }, { position: "asc" }]`.
// The cache stores a pre-sorted array; consumers (use-todos.ts) filter by
// `completed` and rely on array order for display. Any patch that changes
// completed-status or position MUST re-sort, or the UI stays in the
// pre-patch order until the next refetch.
function sortTodos(arr: TodoWithList[]): TodoWithList[] {
  return [...arr].sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    return a.position - b.position;
  });
}

export const eventHandlers: { [K in TodoListEventKind]: Handler<K> } = {
  "todo-created": (trpc, qc, ev) => {
    qc.setQueryData<TodoWithList[]>(
      trpc.todo.list.queryFilter({ todoListId: ev.listId }).queryKey,
      (old) => (old ? sortTodos([...old, ev.todo]) : old),
    );
  },
  "todo-updated": (trpc, qc, ev) => {
    qc.setQueryData<TodoWithList[]>(
      trpc.todo.list.queryFilter({ todoListId: ev.listId }).queryKey,
      (old) =>
        old
          ? sortTodos(old.map((t) => (t.id === ev.todo.id ? ev.todo : t)))
          : old,
    );
  },
  "todo-deleted": (trpc, qc, ev) => {
    qc.setQueryData<TodoWithList[]>(
      trpc.todo.list.queryFilter({ todoListId: ev.listId }).queryKey,
      (old) => old?.filter((t) => t.id !== ev.todoId),
    );
  },
  "todos-reordered": (trpc, qc, ev) => {
    const byId = new Map(ev.positions.map((p) => [p.id, p.position]));
    qc.setQueryData<TodoWithList[]>(
      trpc.todo.list.queryFilter({ todoListId: ev.listId }).queryKey,
      (old) => {
        if (!old) return old;
        const patched = old.map((t) =>
          byId.has(t.id) ? { ...t, position: byId.get(t.id) ?? t.position } : t,
        );
        return sortTodos(patched);
      },
    );
  },
  "todos-imported": (trpc, qc, ev) => {
    // Server semantics (importTodosFromCSV): existing active rows get
    // position += N, imported rows occupy positions [0..N). Mirror that
    // in the cache: prepend imported rows, shift existing active rows'
    // positions, then resort. Without this shift, a refetch shows imports
    // at the TOP and the cache-patched view shows them at the BOTTOM —
    // visible UX drift.
    const n = ev.todos.length;
    qc.setQueryData<TodoWithList[]>(
      trpc.todo.list.queryFilter({ todoListId: ev.listId }).queryKey,
      (old) => {
        if (!old) return old;
        const shifted = old.map((t) =>
          t.completed ? t : { ...t, position: t.position + n },
        );
        return sortTodos([...ev.todos, ...shifted]);
      },
    );
  },
  "todo-list-updated": (trpc, qc, ev) => {
    qc.invalidateQueries(trpc.todoList.get.queryFilter({ id: ev.listId }));
    qc.invalidateQueries(trpc.todoList.listAccessible.queryFilter());
  },
  "todo-list-collaborator-added": (trpc, qc, ev) => {
    qc.invalidateQueries(
      trpc.todoList.collaborators.queryFilter({ listId: ev.listId }),
    );
  },
  "todo-list-collaborator-removed": (trpc, qc, ev) => {
    qc.invalidateQueries(
      trpc.todoList.collaborators.queryFilter({ listId: ev.listId }),
    );
    qc.invalidateQueries(trpc.todoList.listAccessible.queryFilter());
  },
};
