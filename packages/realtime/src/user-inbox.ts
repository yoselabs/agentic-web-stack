// User-inbox channel helpers — shared across the API. See ADR-001 and
// docs/conventions.md#realtime-channel-granularity.
//
// These helpers are PURE fan-out: they accept already-resolved user
// ids, a ChannelFactory, and an event; they call channel.publish.
// They MUST NOT touch Prisma, import from @project/db, or carry
// domain knowledge. Services resolve recipient ids from their own
// authz-gate queries and pass the array here.

import type { ChannelFactory } from "./types.js";

export function userInboxChannelKey(userId: string): string {
  return `user:${userId}`;
}

export async function publishToUserInbox<TEvent>(
  factory: ChannelFactory,
  userId: string,
  event: TEvent,
): Promise<void> {
  await factory.channel<TEvent>(userInboxChannelKey(userId)).publish(event);
}

export async function fanOutToMembers<TEvent>(
  factory: ChannelFactory,
  userIds: readonly string[],
  event: TEvent,
): Promise<void> {
  if (userIds.length === 0) return;
  const unique = Array.from(new Set(userIds));
  await Promise.all(
    unique.map((id) =>
      factory.channel<TEvent>(userInboxChannelKey(id)).publish(event),
    ),
  );
}
