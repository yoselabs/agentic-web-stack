// Event union published to per-list realtime channels.
// Consumed by: the tRPC subscription on the server (fan-out to WS clients),
// the service's own unit tests (via MemoryChannel assertion).

import type { Todo, TodoList } from "@project/db";
import type { Channel } from "@project/realtime/types";

// Matches the `todo.list` query shape (todo-service.ts: include: { todoList: true }).
// Payloads MUST match this shape exactly — the client cache stores rows of this
// shape, and patching with a narrower shape would corrupt downstream consumers
// that read `t.todoList.name` etc.
export type TodoWithList = Todo & { todoList: TodoList };

export const TODO_LIST_EVENT_KINDS = [
  "todo-list-updated",
  "todo-list-collaborator-added",
  "todo-list-collaborator-removed",
  "todo-created",
  "todo-updated",
  "todo-deleted",
  "todos-reordered",
  "todos-imported",
] as const;

export type TodoListEventKind = (typeof TODO_LIST_EVENT_KINDS)[number];

export type TodoListEvent =
  | { kind: "todo-list-updated"; listId: string }
  | { kind: "todo-list-collaborator-added"; listId: string; userId: string }
  | { kind: "todo-list-collaborator-removed"; listId: string; userId: string }
  | { kind: "todo-created"; listId: string; todo: TodoWithList }
  | { kind: "todo-updated"; listId: string; todo: TodoWithList }
  | { kind: "todo-deleted"; listId: string; todoId: string }
  | {
      kind: "todos-reordered";
      listId: string;
      positions: Array<{ id: string; position: number }>;
    }
  | { kind: "todos-imported"; listId: string; todos: TodoWithList[] };

export function listChannelKey(listId: string): string {
  return `todo-list:${listId}`;
}

// Consumed by the tRPC onListEvent subscription. Extracted so unit tests
// can drive the auto-close path (viewer-revoked-while-subscribed) without
// spinning up a tRPC caller.
//
// The generator:
//   - yields every event received on the channel
//   - auto-closes when a `todo-list-collaborator-removed` event names the viewer
//     (authz cascade — subscription MUST NOT outlive viewer access)
//   - honors AbortSignal for client-initiated cancellation
//   - always unsubscribes on exit via the try/finally
export async function* subscribeToListEvents(
  ch: Channel<TodoListEvent>,
  viewerId: string,
  signal?: AbortSignal,
): AsyncGenerator<TodoListEvent> {
  const buffer: TodoListEvent[] = [];
  let resolveNext: (() => void) | null = null;

  const unsub = await ch.subscribe((event) => {
    buffer.push(event);
    resolveNext?.();
    resolveNext = null;
  });

  try {
    while (true) {
      while (buffer.length > 0) {
        // biome-ignore lint/style/noNonNullAssertion: length guard above
        const event = buffer.shift()!;
        yield event;
        // Authz cascade: viewer removed → close their own stream.
        // Owner never receives this about themselves (they're not in
        // the membership table), so the check is safe for both roles.
        if (
          event.kind === "todo-list-collaborator-removed" &&
          event.userId === viewerId
        ) {
          return;
        }
      }
      if (signal?.aborted) return;
      await new Promise<void>((resolve) => {
        resolveNext = resolve;
        signal?.addEventListener("abort", () => resolve(), { once: true });
      });
    }
  } finally {
    unsub();
  }
}
