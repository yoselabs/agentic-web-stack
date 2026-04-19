// Per-kind handler map for UserInboxEvent. All kinds in this spec are
// notification-shape; handlers invalidate the affected queries and let
// TanStack Query refetch authoritative state.

import type {
  UserInboxEvent,
  UserInboxEventKind,
} from "@project/api/domains/user/user-events";
import type { AppRouter } from "@project/api/router";
import type { QueryClient } from "@tanstack/react-query";
import type { TRPCOptionsProxy } from "@trpc/tanstack-react-query";

type Handler<K extends UserInboxEventKind> = (
  trpc: TRPCOptionsProxy<AppRouter>,
  qc: QueryClient,
  event: Extract<UserInboxEvent, { kind: K }>,
) => void;

export const eventHandlers: { [K in UserInboxEventKind]: Handler<K> } = {
  "todo-list-counters-changed": (trpc, qc) => {
    qc.invalidateQueries(trpc.todoList.list.queryFilter());
    qc.invalidateQueries(trpc.todoList.listAccessible.queryFilter());
  },
  "todo-list-access-granted": (trpc, qc) => {
    qc.invalidateQueries(trpc.todoList.listAccessible.queryFilter());
  },
  // Note: todoList.collaborators is invalidated by the per-entity
  // channel handler (event-handlers.ts in features/todo-list), not here.
  "todo-list-access-revoked": (trpc, qc, ev) => {
    qc.invalidateQueries(trpc.todoList.list.queryFilter());
    qc.invalidateQueries(trpc.todoList.listAccessible.queryFilter());
    qc.invalidateQueries(trpc.todoList.get.queryFilter({ id: ev.listId }));
    qc.invalidateQueries(trpc.todo.list.queryFilter({ todoListId: ev.listId }));
  },
  "todo-list-invites-changed": (trpc, qc, ev) => {
    qc.invalidateQueries(trpc.todoList.myPendingInvites.queryFilter());
    qc.invalidateQueries(
      trpc.todoList.pendingInvites.queryFilter({ listId: ev.listId }),
    );
  },
};
