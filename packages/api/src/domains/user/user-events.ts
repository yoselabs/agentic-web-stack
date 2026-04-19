// Cross-feature user-inbox events. Every kind is notification-shape
// in this spec (no entity payload); client handlers invalidate queries
// and refetch authoritative state. See docs/conventions.md and ADR-001.
//
// Domains that publish to a user's inbox import from this file; this
// file has no reverse dependency on any domain.

export const USER_INBOX_EVENT_KINDS = [
  "todo-list-counters-changed",
  "todo-list-access-granted",
  "todo-list-access-revoked",
  "todo-list-invites-changed",
] as const;

export type UserInboxEventKind = (typeof USER_INBOX_EVENT_KINDS)[number];

export type UserInboxEvent =
  | { kind: "todo-list-counters-changed"; listId: string }
  | { kind: "todo-list-access-granted"; listId: string }
  | { kind: "todo-list-access-revoked"; listId: string }
  | { kind: "todo-list-invites-changed"; listId: string };

// Channel-key helper is imported directly from @project/realtime/user-inbox
// by consumers (keeps this file a pure type-SSOT; avoids a barrel file).
