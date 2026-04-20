import { randomBytes } from "node:crypto";
import type { Prisma, PrismaClient } from "@project/db";
import { channel as defaultChannel } from "@project/realtime/channel";
import type { Channel } from "@project/realtime/types";
import { TRPCError } from "@trpc/server";
import { INVITE_EXPIRY_DAYS, INVITE_RETENTION_DAYS } from "./constants.js";
import { listChannelKey, type TodoListEvent } from "./events.js";
import {
  defaultUserInboxProvider,
  listMemberIdsForList,
  publishAccessGranted,
  publishAccessRevoked,
  publishInvitesChanged,
  type UserInboxChannelProvider,
} from "./user-inbox-publishers.js";

type DbClient = PrismaClient | Prisma.TransactionClient;
type ChannelProvider = (key: string) => Channel<TodoListEvent>;

const defaultProvider: ChannelProvider = (k) => defaultChannel(k);

export async function listTodoLists(db: DbClient, userId: string) {
  return db.todoList.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { todos: true } },
    },
  });
}

export async function getTodoList(db: DbClient, userId: string, id: string) {
  const allowed = await canReadList(db, userId, id);
  if (!allowed) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You do not have access to this list.",
    });
  }
  return db.todoList.findUniqueOrThrow({ where: { id } });
}

export async function createTodoList(
  tx: Prisma.TransactionClient,
  userId: string,
  name: string,
  color?: string,
) {
  return tx.todoList.create({
    data: { name, userId, ...(color ? { color } : {}) },
  });
}

export async function deleteTodoList(
  tx: Prisma.TransactionClient,
  userId: string,
  id: string,
  options: { userInboxChannel?: UserInboxChannelProvider } = {},
) {
  const list = await tx.todoList.findFirstOrThrow({
    where: { id, userId },
  });
  const memberIds = await listMemberIdsForList(tx, list.id);
  const deleted = await tx.todoList.delete({ where: { id: list.id } });

  const inboxProvider = options.userInboxChannel ?? defaultUserInboxProvider;
  // Everyone except the deleter (the owner) sees their sidebar entry disappear.
  const recipients = memberIds.filter((mid) => mid !== userId);
  await publishAccessRevoked(inboxProvider, recipients, list.id);

  return deleted;
}

export async function canReadList(
  db: DbClient,
  userId: string,
  listId: string,
): Promise<boolean> {
  const list = await db.todoList.findFirst({
    where: {
      id: listId,
      OR: [{ userId }, { memberships: { some: { userId } } }],
    },
  });
  return list !== null;
}

export async function listAccessibleTodoLists(db: DbClient, userId: string) {
  return db.todoList.findMany({
    where: {
      OR: [{ userId }, { memberships: { some: { userId } } }],
    },
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { todos: true, memberships: true } },
    },
  });
}

// Returns the row + the denormalized fields the router needs to send
// the invite email AFTER the transaction commits. Sending inside the tx
// would leak an email for an invite that later rolls back.
export type InviteCollaboratorResult = {
  invite: {
    id: string;
    token: string;
    invitedUserId: string;
    todoListId: string;
    expiresAt: Date;
    createdAt: Date;
  };
  inviteeEmail: string;
  inviterName: string;
  listName: string;
};

export async function inviteCollaborator(
  tx: Prisma.TransactionClient,
  ownerId: string,
  listId: string,
  rawUsername: string,
  options: {
    nowMs?: number;
    userInboxChannel?: UserInboxChannelProvider;
  } = {},
): Promise<InviteCollaboratorResult> {
  // Normalize at the boundary — the autocomplete UI may pass "@alice"
  // if the user re-edits after selection, and a typed-by-hand "@alice"
  // hits the same path. Server is the single point of normalization;
  // see also searchUsersByUsername.
  const username = rawUsername.trim().replace(/^@+/, "");

  const list = await tx.todoList.findFirstOrThrow({
    where: { id: listId, userId: ownerId },
  });

  const invitee = await tx.user.findUnique({ where: { username } });
  if (!invitee) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `No user with username "${username}"`,
    });
  }
  if (invitee.id === ownerId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Cannot invite yourself",
    });
  }

  const existing = await tx.todoListMembership.findUnique({
    where: {
      userId_todoListId: { userId: invitee.id, todoListId: listId },
    },
  });
  if (existing) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "User is already a collaborator",
    });
  }

  const token = randomBytes(24).toString("hex");
  const now = options.nowMs ?? Date.now();
  const expiresAt = new Date(now + INVITE_EXPIRY_DAYS * 86_400_000);

  const invite = await tx.todoListInvite.create({
    data: {
      token,
      invitedUserId: invitee.id,
      todoListId: listId,
      expiresAt,
    },
  });

  const owner = await tx.user.findUniqueOrThrow({
    where: { id: ownerId },
  });

  const inboxProvider = options.userInboxChannel ?? defaultUserInboxProvider;
  await publishInvitesChanged(inboxProvider, [invitee.id], listId);

  return {
    invite,
    inviteeEmail: invitee.email,
    inviterName: owner.name,
    listName: list.name,
  };
}

export async function acceptInvite(
  tx: Prisma.TransactionClient,
  userId: string,
  token: string,
  options: {
    channel?: ChannelProvider;
    nowMs?: number;
    userInboxChannel?: UserInboxChannelProvider;
  } = {},
) {
  const provider = options.channel ?? defaultProvider;
  const now = new Date(options.nowMs ?? Date.now());

  // SECURITY NOTE: the accept link in the invite email is /invites/${token}
  // and the authz is (token + invitedUserId). Tokens are email-carried but
  // only a session matching invitedUserId can accept. DO NOT copy this
  // pattern to email-based invites without adding an email-ownership step.

  // CONCURRENCY: the race-winner guarantee comes from the
  // @@unique([userId, todoListId]) constraint on TodoListMembership.
  // Under concurrent accept attempts on the same token, both txs pass
  // findFirstOrThrow; one wins `create`, the other fails with P2002 and
  // rolls back cleanly — no partial state, no double membership.

  const invite = await tx.todoListInvite.findFirst({
    where: {
      token,
      invitedUserId: userId,
      expiresAt: { gt: now },
    },
  });
  if (!invite) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Invite not found or expired",
    });
  }

  const membership = await tx.todoListMembership.create({
    data: {
      userId,
      todoListId: invite.todoListId,
      role: "collaborator",
    },
  });

  await tx.todoListInvite.delete({ where: { id: invite.id } });

  await provider(listChannelKey(invite.todoListId)).publish({
    kind: "todo-list-collaborator-added",
    listId: invite.todoListId,
    userId,
  });

  const inboxProvider = options.userInboxChannel ?? defaultUserInboxProvider;
  const memberIds = await listMemberIdsForList(tx, invite.todoListId);
  // memberIds now includes the newly-added accepter (membership was created above)
  await publishAccessGranted(inboxProvider, memberIds, invite.todoListId);
  // Owner's pending-invites view changed (invite was deleted)
  const list = await tx.todoList.findUniqueOrThrow({
    where: { id: invite.todoListId },
    select: { userId: true },
  });
  await publishInvitesChanged(inboxProvider, [list.userId], invite.todoListId);

  return membership;
}

export async function removeCollaborator(
  tx: Prisma.TransactionClient,
  ownerId: string,
  listId: string,
  targetUserId: string,
  options: {
    channel?: ChannelProvider;
    userInboxChannel?: UserInboxChannelProvider;
  } = {},
) {
  const provider = options.channel ?? defaultProvider;

  const list = await tx.todoList.findFirst({
    where: { id: listId, userId: ownerId },
  });
  if (!list) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "List not found or not owned by caller",
    });
  }

  const membership = await tx.todoListMembership.findUnique({
    where: {
      userId_todoListId: { userId: targetUserId, todoListId: listId },
    },
  });
  if (!membership) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "User is not a collaborator on this list",
    });
  }

  await tx.todoListMembership.delete({
    where: { id: membership.id },
  });

  await provider(listChannelKey(listId)).publish({
    kind: "todo-list-collaborator-removed",
    listId,
    userId: targetUserId,
  });

  const inboxProvider = options.userInboxChannel ?? defaultUserInboxProvider;
  await publishAccessRevoked(inboxProvider, [targetUserId], listId);
}

// Returns { owner, collaborators } — the router gates read access before
// calling this, so the query itself is authz-less. The owner row is
// synthetic (derived from the TodoList row); collaborators are membership
// rows.
export async function listCollaborators(db: DbClient, listId: string) {
  const list = await db.todoList.findUniqueOrThrow({
    where: { id: listId },
    select: {
      user: { select: { id: true, username: true, name: true } },
    },
  });
  const memberships = await db.todoListMembership.findMany({
    where: { todoListId: listId },
    include: {
      user: { select: { id: true, username: true, name: true } },
    },
  });
  return {
    owner: list.user,
    collaborators: memberships,
  };
}

export async function deleteExpiredInvites(
  tx: Prisma.TransactionClient,
  options: { nowMs?: number } = {},
) {
  const now = new Date(options.nowMs ?? Date.now());
  const cutoff = new Date(now.getTime() - INVITE_RETENTION_DAYS * 86_400_000);
  const result = await tx.todoListInvite.deleteMany({
    where: { expiresAt: { lt: cutoff } },
  });
  return result.count;
}

export async function listMyPendingInvites(
  db: DbClient,
  viewerId: string,
  options: { nowMs?: number } = {},
) {
  const now = new Date(options.nowMs ?? Date.now());
  return db.todoListInvite.findMany({
    where: {
      invitedUserId: viewerId,
      expiresAt: { gt: now },
    },
    orderBy: { createdAt: "desc" },
    include: {
      todoList: {
        select: {
          id: true,
          name: true,
          color: true,
          user: { select: { id: true, name: true, username: true } },
        },
      },
    },
  });
}

export async function listPendingInvitesForList(
  db: DbClient,
  ownerId: string,
  listId: string,
  options: { nowMs?: number } = {},
) {
  const now = new Date(options.nowMs ?? Date.now());
  const list = await db.todoList.findFirst({
    where: { id: listId, userId: ownerId },
    select: { id: true },
  });
  if (!list) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only the list owner can view pending invites.",
    });
  }
  return db.todoListInvite.findMany({
    where: {
      todoListId: listId,
      expiresAt: { gt: now },
    },
    orderBy: { createdAt: "desc" },
    include: {
      invitedUser: { select: { id: true, username: true, name: true } },
    },
  });
}

export async function declineInvite(
  tx: Prisma.TransactionClient,
  viewerId: string,
  token: string,
  options: { userInboxChannel?: UserInboxChannelProvider } = {},
) {
  const invite = await tx.todoListInvite.findFirst({
    where: { token, invitedUserId: viewerId },
    select: { id: true, todoListId: true },
  });
  if (!invite) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Invite not found or not addressed to you",
    });
  }
  await tx.todoListInvite.delete({ where: { id: invite.id } });

  const inboxProvider = options.userInboxChannel ?? defaultUserInboxProvider;
  const list = await tx.todoList.findUniqueOrThrow({
    where: { id: invite.todoListId },
    select: { userId: true },
  });
  await publishInvitesChanged(inboxProvider, [list.userId], invite.todoListId);
}

export async function revokeInvite(
  tx: Prisma.TransactionClient,
  viewerId: string,
  inviteId: string,
  options: { userInboxChannel?: UserInboxChannelProvider } = {},
) {
  const invite = await tx.todoListInvite.findUnique({
    where: { id: inviteId },
    select: {
      id: true,
      invitedUserId: true,
      todoListId: true,
      todoList: { select: { userId: true } },
    },
  });
  if (!invite || invite.todoList.userId !== viewerId) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Invite not found or not owned by caller",
    });
  }
  await tx.todoListInvite.delete({ where: { id: invite.id } });

  const inboxProvider = options.userInboxChannel ?? defaultUserInboxProvider;
  await publishInvitesChanged(
    inboxProvider,
    [invite.invitedUserId],
    invite.todoListId,
  );
}
