import type { ActivityEvent as DbActivityEvent } from "@project/db";

export const ACTIVITY_EVENT_KINDS = [
  "todo-created",
  "todo-updated",
  "todo-completed",
  "todo-uncompleted",
  "todo-deleted",
  "list-renamed",
  "member-added",
  "member-removed",
] as const;

export type ActivityEventKind = (typeof ACTIVITY_EVENT_KINDS)[number];

export type ActivityEventPayload =
  | { kind: "todo-created"; todoId: string; title: string }
  | { kind: "todo-updated"; todoId: string; title: string }
  | { kind: "todo-completed"; todoId: string; title: string }
  | { kind: "todo-uncompleted"; todoId: string; title: string }
  | { kind: "todo-deleted"; todoId: string; title: string }
  | { kind: "list-renamed"; from: string; to: string }
  | { kind: "member-added"; memberId: string; memberName: string }
  | { kind: "member-removed"; memberId: string; memberName: string };

export type ActivityEventRecord = Omit<DbActivityEvent, "payload"> & {
  payload: ActivityEventPayload;
  actor: { id: string; name: string };
};

// Envelope yielded by the subscription. "event" = normal tracked event.
// "resync" = client lastEventId is beyond replay cap; client must fall
// back to full fetch.
export type ActivityEventEnvelope =
  | { kind: "event"; event: ActivityEventRecord }
  | { kind: "resync"; reason: "gap-too-large" | "event-expired" };

export function activityChannelKey(todoListId: string): string {
  return `activity:list:${todoListId}`;
}
