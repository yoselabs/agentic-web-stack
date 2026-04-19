// Subscribes to a list's realtime events. Leader tab opens the WS; peers
// receive events via BroadcastChannel relay.
//
// Uses @trpc/tanstack-react-query's subscriptionOptions API. Caller
// passes the trpc proxy from Route.useRouteContext().

import type { TodoListEvent } from "@project/api/domains/todo-list/events";
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
        onData: (event: TodoListEvent) => {
          broadcast({ __relay: true, event });
          applyEvent(trpc, queryClient, event);
        },
      },
    ),
  );

  // Peer path: listen for relayed events.
  useEffect(() => {
    return onMessage((data) => {
      if (
        data &&
        typeof data === "object" &&
        "__relay" in data &&
        "event" in data
      ) {
        applyEvent(trpc, queryClient, (data as { event: TodoListEvent }).event);
      }
    });
  }, [trpc, queryClient, onMessage]);
}

function applyEvent(
  trpc: TRPCOptionsProxy<AppRouter>,
  queryClient: QueryClient,
  event: TodoListEvent,
) {
  // Use procedure-specific queryFilter — precise, no false positives.
  queryClient.invalidateQueries(trpc.todoList.listAccessible.queryFilter());
  queryClient.invalidateQueries(
    trpc.todoList.collaborators.queryFilter({ listId: event.listId }),
  );
  queryClient.invalidateQueries(
    trpc.todo.list.queryFilter({ todoListId: event.listId }),
  );
}
