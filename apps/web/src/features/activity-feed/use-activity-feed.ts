// Combines an initial paginated fetch of activity events with a live
// tRPC subscription. Tracked events (`kind: "event"`) append to a local
// buffer merged in front of the initial page. `resync` envelopes clear
// the local buffer and invalidate the list query so we refetch from the
// server — this is the recovery path when the client's lastEventId is
// beyond replay range.
//
// Reconnect resumption relies on tRPC's subscription link threading
// `lastEventId` automatically from `tracked(id, ...)` envelopes (see
// router.ts in packages/api/src/domains/activity-feed). The client input
// only carries `{ todoListId }`.

import type { ActivityEventEnvelope } from "@project/api/domains/activity-feed/events";
import type { AppRouter } from "@project/api/router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import type { TRPCOptionsProxy } from "@trpc/tanstack-react-query";
import { useSubscription } from "@trpc/tanstack-react-query";
import { useCallback, useMemo, useState } from "react";

// tRPC serializes Date -> string on the wire, so the event shape observed
// by the client for both the paginated list and the subscription differs
// from ActivityEventRecord (which uses Date). Derive the wire shape from
// the router output so the two sources merge under one type without
// silent drift if the schema changes.
type RouterOutput = inferRouterOutputs<AppRouter>;
type WireActivityEvent = RouterOutput["activity"]["list"]["items"][number];

export function useActivityFeed(
  trpc: TRPCOptionsProxy<AppRouter>,
  todoListId: string,
) {
  const queryClient = useQueryClient();
  const [liveEvents, setLiveEvents] = useState<WireActivityEvent[]>([]);

  const initial = useQuery(trpc.activity.list.queryOptions({ todoListId }));

  const onData = useCallback(
    (data: unknown) => {
      // tRPC wire serialization turns Date -> string, so the subscription's
      // static type may not be assignment-compatible with
      // ActivityEventEnvelope. The `kind` discriminator is intact either
      // way — dispatch is safe. Same pattern as use-todo-list-live-updates.
      const envelope = data as ActivityEventEnvelope;
      if (envelope.kind === "resync") {
        setLiveEvents([]);
        void queryClient.invalidateQueries({
          queryKey: trpc.activity.list.queryKey({ todoListId }),
        });
        return;
      }
      // Cross the wire/domain type boundary once, here: the subscription
      // payload has string-serialized dates in practice, matching the
      // query output shape that the merged list uses.
      const ev = envelope.event as unknown as WireActivityEvent;
      setLiveEvents((prev) =>
        prev.some((e) => e.id === ev.id) ? prev : [ev, ...prev],
      );
    },
    [queryClient, trpc, todoListId],
  );

  useSubscription(
    trpc.activity.onListEvents.subscriptionOptions({ todoListId }, { onData }),
  );

  // Merge: live events (newest first) then initial page (also newest
  // first), deduplicated by id. Live buffer wins on overlap — if a
  // refetch returns a row that was also delivered via subscription the
  // live copy is what renders.
  const events = useMemo(() => {
    const seen = new Set<string>();
    const merged: WireActivityEvent[] = [];
    for (const e of liveEvents) {
      if (!seen.has(e.id)) {
        seen.add(e.id);
        merged.push(e);
      }
    }
    for (const e of initial.data?.items ?? []) {
      if (!seen.has(e.id)) {
        seen.add(e.id);
        merged.push(e);
      }
    }
    return merged;
  }, [liveEvents, initial.data]);

  return { events, isLoading: initial.isLoading };
}
