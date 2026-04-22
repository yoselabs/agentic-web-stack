// Pure formatter for activity feed events. One case per kind; exhaustive
// switch so adding a new kind in @project/api/domains/activity-feed/events
// surfaces as a TS error here.

import type { ActivityEventPayload } from "@project/api/domains/activity-feed/events";

// Structural input — both the Prisma-shaped ActivityEventRecord (Date
// fields) and the wire-serialized query-output row (string-typed Date
// fields) satisfy this contract. The formatter only reads `payload`.
export function formatActivityEvent(
  event: { payload: ActivityEventPayload },
  actorName: string,
): string {
  const p = event.payload;
  switch (p.kind) {
    case "todo-created":
      return `${actorName} added ${p.title}`;
    case "todo-updated":
      return `${actorName} renamed to ${p.title}`;
    case "todo-completed":
      return `${actorName} completed ${p.title}`;
    case "todo-uncompleted":
      return `${actorName} reopened ${p.title}`;
    case "todo-deleted":
      return `${actorName} deleted ${p.title}`;
    case "list-renamed":
      return `${actorName} renamed list from "${p.from}" to "${p.to}"`;
    case "member-added":
      return `${actorName} added ${p.memberName}`;
    case "member-removed":
      return `${actorName} removed ${p.memberName}`;
    default: {
      // Exhaustiveness guard — adding a new kind to
      // ActivityEventPayload surfaces a TS error here.
      const _exhaustive: never = p;
      return _exhaustive;
    }
  }
}
