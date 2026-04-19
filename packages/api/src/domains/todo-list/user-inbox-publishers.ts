// User-inbox publishing helpers scoped to the todo-list domain. Each
// helper resolves its recipient set via a tx-scoped authz query and
// publishes one kind to every recipient's inbox. Services call these
// alongside their existing list-channel publishes. See ADR-001 and
// docs/conventions.md#realtime-channel-granularity.

import type { UserInboxEvent } from "@project/api/domains/user/user-events";
import type { Prisma } from "@project/db";
import { channel as defaultChannel } from "@project/realtime/channel";
import type { Channel } from "@project/realtime/types";
import { userInboxChannelKey } from "@project/realtime/user-inbox";

export type UserInboxChannelProvider = (key: string) => Channel<UserInboxEvent>;

export const defaultUserInboxProvider: UserInboxChannelProvider = (k) =>
  defaultChannel<UserInboxEvent>(k);

async function publishToEach(
  provider: UserInboxChannelProvider,
  recipientIds: readonly string[],
  event: UserInboxEvent,
): Promise<void> {
  if (recipientIds.length === 0) return;
  const unique = Array.from(new Set(recipientIds));
  await Promise.all(
    unique.map((id) => provider(userInboxChannelKey(id)).publish(event)),
  );
}

export async function listMemberIdsForList(
  tx: Prisma.TransactionClient,
  todoListId: string,
): Promise<string[]> {
  const list = await tx.todoList.findUniqueOrThrow({
    where: { id: todoListId },
    select: {
      userId: true,
      memberships: { select: { userId: true } },
    },
  });
  return [list.userId, ...list.memberships.map((m) => m.userId)];
}

export async function publishCountersChanged(
  provider: UserInboxChannelProvider,
  recipientIds: readonly string[],
  listId: string,
): Promise<void> {
  await publishToEach(provider, recipientIds, {
    kind: "todo-list-counters-changed",
    listId,
  });
}

export async function publishAccessGranted(
  provider: UserInboxChannelProvider,
  recipientIds: readonly string[],
  listId: string,
): Promise<void> {
  await publishToEach(provider, recipientIds, {
    kind: "todo-list-access-granted",
    listId,
  });
}

export async function publishAccessRevoked(
  provider: UserInboxChannelProvider,
  recipientIds: readonly string[],
  listId: string,
): Promise<void> {
  await publishToEach(provider, recipientIds, {
    kind: "todo-list-access-revoked",
    listId,
  });
}

export async function publishInvitesChanged(
  provider: UserInboxChannelProvider,
  recipientIds: readonly string[],
  listId: string,
): Promise<void> {
  await publishToEach(provider, recipientIds, {
    kind: "todo-list-invites-changed",
    listId,
  });
}
