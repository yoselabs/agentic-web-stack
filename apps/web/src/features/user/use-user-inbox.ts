// User-inbox subscription hook. One subscription per user session
// (leader-tab pattern shares the WS across tabs). onStarted fires on
// initial connect AND every reconnect; invalidates live-backed queries
// to close any gap. See ADR-001 §D3.

import type { UserInboxEvent } from "@project/api/domains/user/user-events";
import { USER_INBOX_EVENT_KINDS } from "@project/api/domains/user/user-events";
import type { AppRouter } from "@project/api/router";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import type { TRPCOptionsProxy } from "@trpc/tanstack-react-query";
import { useSubscription } from "@trpc/tanstack-react-query";
import { useEffect } from "react";
import { useLeaderTab } from "#/features/todo-list/use-leader-tab";
import { eventHandlers } from "./event-handlers.js";

export function useUserInbox(
  trpc: TRPCOptionsProxy<AppRouter>,
  userId: string | null,
) {
  const queryClient = useQueryClient();
  const { isLeader, broadcast, onMessage } = useLeaderTab(userId);

  useSubscription(
    trpc.user.onInboxEvent.subscriptionOptions(undefined, {
      enabled: isLeader && userId !== null,
      onStarted: () => {
        queryClient.invalidateQueries(trpc.todoList.list.queryFilter());
        queryClient.invalidateQueries(
          trpc.todoList.listAccessible.queryFilter(),
        );
        queryClient.invalidateQueries(
          trpc.todoList.myPendingInvites.queryFilter(),
        );
      },
      onData: (data) => {
        const event = data as unknown as UserInboxEvent;
        broadcast({ __userInboxRelay: true, event });
        dispatch(trpc, queryClient, event);
      },
    }),
  );

  useEffect(() => {
    return onMessage((data) => {
      if (isUserInboxRelay(data)) {
        dispatch(trpc, queryClient, data.event);
      }
    });
  }, [trpc, queryClient, onMessage]);
}

function dispatch(
  trpc: TRPCOptionsProxy<AppRouter>,
  qc: QueryClient,
  event: UserInboxEvent,
): void {
  eventHandlers[event.kind](trpc, qc, event as never);
}

function isUserInboxRelay(
  d: unknown,
): d is { __userInboxRelay: true; event: UserInboxEvent } {
  if (!d || typeof d !== "object") return false;
  const rec = d as Record<string, unknown>;
  if (rec.__userInboxRelay !== true) return false;
  const ev = rec.event as { kind?: unknown } | undefined;
  if (!ev || typeof ev.kind !== "string") return false;
  return (USER_INBOX_EVENT_KINDS as readonly string[]).includes(ev.kind);
}
