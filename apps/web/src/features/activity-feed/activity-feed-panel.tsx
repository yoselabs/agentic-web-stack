// Scrollable sidebar panel that renders the activity feed for a
// todo-list detail page. Pure display — all data + live-update wiring
// lives in `useActivityFeed`. Events are shown newest-first, formatted
// via `formatActivityEvent` so "Alice added buy milk" copy stays
// centralized.

import type { AppRouter } from "@project/api/router";
import type { TRPCOptionsProxy } from "@trpc/tanstack-react-query";
import { formatActivityEvent } from "./format-event";
import { useActivityFeed } from "./use-activity-feed";

export function ActivityFeedPanel({
  trpc,
  todoListId,
}: {
  trpc: TRPCOptionsProxy<AppRouter>;
  todoListId: string;
}) {
  const { events, isLoading } = useActivityFeed(trpc, todoListId);

  if (isLoading) {
    return (
      <aside
        aria-label="Activity feed"
        data-testid="activity-feed"
        className="w-80 border-l p-4"
      >
        <h3 className="mb-2 font-semibold text-sm">Activity</h3>
        <p className="text-muted-foreground text-sm">Loading activity…</p>
      </aside>
    );
  }

  return (
    <aside
      aria-label="Activity feed"
      data-testid="activity-feed"
      className="w-80 overflow-y-auto border-l p-4"
    >
      <h3 className="mb-2 font-semibold text-sm">Activity</h3>
      {events.length === 0 ? (
        <p className="text-muted-foreground text-sm">No activity yet.</p>
      ) : (
        <ul className="space-y-2">
          {events.map((e) => (
            <li
              key={e.id}
              className="text-sm"
              data-activity-kind={e.payload.kind}
            >
              <span>{formatActivityEvent(e, e.actor?.name ?? "Someone")}</span>
              <time className="block text-muted-foreground text-xs">
                {new Date(e.createdAt).toLocaleTimeString()}
              </time>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
