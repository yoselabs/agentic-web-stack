// Event union published to per-list realtime channels.
// Consumed by: the tRPC subscription on the server (fan-out to WS clients),
// the service's own unit tests (via MemoryChannel assertion).

export type TodoListEvent =
  | { kind: "list-updated"; listId: string }
  | { kind: "todo-updated"; listId: string; todoId: string }
  | { kind: "collaborator-added"; listId: string; userId: string }
  | { kind: "collaborator-removed"; listId: string; userId: string };

export function listChannelKey(listId: string): string {
  return `todo-list:${listId}`;
}
