// Subscribes to a list's realtime events. Leader tab opens the WS; peers
// receive events via BroadcastChannel relay.
//
// Dispatch is delegated to the typed eventHandlers map in ./event-handlers.
// Payload-shaped kinds patch cache via setQueryData; notification-shaped
// kinds invalidateQueries.

import type { TodoListEvent } from "@project/api/domains/todo-list/events";
import { TODO_LIST_EVENT_KINDS } from "@project/api/domains/todo-list/events";
import type { AppRouter } from "@project/api/router";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import type { TRPCOptionsProxy } from "@trpc/tanstack-react-query";
import { useSubscription } from "@trpc/tanstack-react-query";
import { useEffect } from "react";
import { eventHandlers } from "./event-handlers.js";
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
          // tRPC wire serialization turns Date -> string, so `data`'s
          // static type from the subscription may not match TodoListEvent
          // assignment-compatibly. The kind discriminator is intact
          // either way — dispatch is safe.
          const event = data as unknown as TodoListEvent;
          broadcast({ __relay: true, event });
          dispatch(trpc, queryClient, event);
        },
      },
    ),
  );

  // Peer path: listen for relayed events.
  useEffect(() => {
    return onMessage((data) => {
      if (isTodoListRelay(data)) {
        dispatch(trpc, queryClient, data.event);
      }
    });
  }, [trpc, queryClient, onMessage]);
}

// Dispatch by kind to the typed handler map. The `event as never` cast is
// necessary because TS cannot narrow `event` across the index lookup —
// each handler expects its narrow Extract<TodoListEvent, {kind: K}> type,
// not the full union. Do NOT change to `event as TodoListEvent` — that
// widens the arg and breaks the narrow handler signatures.
function dispatch(
  trpc: TRPCOptionsProxy<AppRouter>,
  qc: QueryClient,
  event: TodoListEvent,
): void {
  eventHandlers[event.kind](trpc, qc, event as never);
}

// Kind-only validation — BroadcastChannel is same-origin trusted, so
// payload shape is not validated here. The leader tab publishes the
// exact shape it received from the server (type-narrowed). A malformed
// relay implies a same-origin logic bug, not hostile input.
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
