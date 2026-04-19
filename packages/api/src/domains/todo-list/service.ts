import { randomBytes } from "node:crypto";
import type { Prisma, PrismaClient } from "@project/db";
import { channel as defaultChannel } from "@project/realtime/channel";
import type { Channel } from "@project/realtime/types";
import { TRPCError } from "@trpc/server";
import { INVITE_EXPIRY_DAYS, INVITE_RETENTION_DAYS } from "./constants.js";
import { listChannelKey, type TodoListEvent } from "./events.js";

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
) {
  const list = await tx.todoList.findFirstOrThrow({
    where: { id, userId },
  });
  return tx.todoList.delete({ where: { id: list.id } });
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
  username: string,
  options: { nowMs?: number } = {},
): Promise<InviteCollaboratorResult> {
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
  options: { channel?: ChannelProvider; nowMs?: number } = {},
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
    kind: "collaborator-added",
    listId: invite.todoListId,
    userId,
  });

  return membership;
}

export async function removeCollaborator(
  tx: Prisma.TransactionClient,
  ownerId: string,
  listId: string,
  targetUserId: string,
  options: { channel?: ChannelProvider } = {},
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
    kind: "collaborator-removed",
    listId,
    userId: targetUserId,
  });
}

export async function listCollaborators(db: DbClient, listId: string) {
  return db.todoListMembership.findMany({
    where: { todoListId: listId },
    include: {
      user: { select: { id: true, username: true, name: true } },
    },
  });
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
