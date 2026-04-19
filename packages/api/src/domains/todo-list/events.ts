// Event union published to per-list realtime channels.
// Consumed by: the tRPC subscription on the server (fan-out to WS clients),
// the service's own unit tests (via MemoryChannel assertion).

import type { Channel } from "@project/realtime/types";

export type TodoListEvent =
  | { kind: "list-updated"; listId: string }
  | { kind: "todo-updated"; listId: string; todoId: string }
  | { kind: "collaborator-added"; listId: string; userId: string }
  | { kind: "collaborator-removed"; listId: string; userId: string };

export function listChannelKey(listId: string): string {
  return `todo-list:${listId}`;
}

// Consumed by the tRPC onListEvent subscription. Extracted so unit tests
// can drive the auto-close path (viewer-revoked-while-subscribed) without
// spinning up a tRPC caller.
//
// The generator:
//   - yields every event received on the channel
//   - auto-closes when a `collaborator-removed` event names the viewer
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
          event.kind === "collaborator-removed" &&
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
