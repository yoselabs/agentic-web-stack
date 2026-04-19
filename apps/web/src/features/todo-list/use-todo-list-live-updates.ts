// Subscribes to a list's realtime events. Leader tab opens the WS; peers
// receive events via BroadcastChannel relay.
//
// Uses @trpc/tanstack-react-query's subscriptionOptions API. Caller
// passes the trpc proxy from Route.useRouteContext().

import {
  TODO_LIST_EVENT_KINDS,
  type TodoListEvent,
} from "@project/api/domains/todo-list/events";
import type { AppRouter } from "@project/api/router";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import type { TRPCOptionsProxy } from "@trpc/tanstack-react-query";
import { useSubscription } from "@trpc/tanstack-react-query";
import { useEffect } from "react";
import { useLeaderTab } from "./use-leader-tab.js";

export function useTodoListLiveUpdates(
  trpc: TRPCOptionsProxy<AppRouter>,
  listId: string | null,
  userId: string | null,
) {
  const queryClient = useQueryClient();
  const { isLeader, broadcast, onMessage } = useLeaderTab(userId);

  // Leader path: subscribe to the tRPC WS, relay to peers, apply locally.
  useSubscription(
    trpc.todoList.onListEvent.subscriptionOptions(
      { listId: listId ?? "" },
      {
        enabled: isLeader && listId !== null,
        onData: (data) => {
          // tRPC serialization turns Date fields into string over the wire;
          // cast back to the logical TodoListEvent shape. applyEvent only
          // reads listId (a string), so the Date-vs-string drift is inert.
          // Task 1.7 will replace this with per-kind handlers that read
          // serialized payloads through superjson, removing the cast.
          const event = data as unknown as TodoListEvent;
          broadcast({ __relay: true, event });
          applyEvent(trpc, queryClient, event);
        },
      },
    ),
  );

  // Peer path: listen for relayed events.
  useEffect(() => {
    return onMessage((data) => {
      if (isTodoListRelay(data)) {
        applyEvent(trpc, queryClient, data.event);
      }
    });
  }, [trpc, queryClient, onMessage]);
}

function isTodoListRelay(
  d: unknown,
): d is { __relay: true; event: TodoListEvent } {
  if (!d || typeof d !== "object") return false;
  const rec = d as Record<string, unknown>;
  if (rec.__relay !== true) return false;
  const ev = rec.event as { kind?: unknown } | undefined;
  if (!ev || typeof ev.kind !== "string") return false;
  return (TODO_LIST_EVENT_KINDS as readonly string[]).includes(ev.kind);
}

function applyEvent(
  trpc: TRPCOptionsProxy<AppRouter>,
  queryClient: QueryClient,
  event: TodoListEvent,
) {
  // Use procedure-specific queryFilter — precise, no false positives.
  queryClient.invalidateQueries(trpc.todoList.listAccessible.queryFilter());
  queryClient.invalidateQueries(
    trpc.todoList.get.queryFilter({ id: event.listId }),
  );
  queryClient.invalidateQueries(
    trpc.todoList.collaborators.queryFilter({ listId: event.listId }),
  );
  queryClient.invalidateQueries(
    trpc.todo.list.queryFilter({ todoListId: event.listId }),
  );
}
