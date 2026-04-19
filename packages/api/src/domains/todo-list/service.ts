import { randomBytes } from "node:crypto";
import type { Prisma, PrismaClient } from "@project/db";
import { sendEmail } from "@project/email/service";
import { channel as defaultChannel } from "@project/realtime/channel";
import type { Channel } from "@project/realtime/types";
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
  return db.todoList.findFirstOrThrow({
    where: { id, userId },
  });
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

export async function inviteCollaborator(
  tx: Prisma.TransactionClient,
  ownerId: string,
  listId: string,
  username: string,
  options: { channel?: ChannelProvider; nowMs?: number } = {},
) {
  const list = await tx.todoList.findFirstOrThrow({
    where: { id: listId, userId: ownerId },
  });

  const invitee = await tx.user.findUnique({ where: { username } });
  if (!invitee) {
    throw new Error(`No user with username "${username}"`);
  }
  if (invitee.id === ownerId) {
    throw new Error("Cannot invite yourself");
  }

  const existing = await tx.todoListMembership.findUnique({
    where: {
      userId_todoListId: { userId: invitee.id, todoListId: listId },
    },
  });
  if (existing) {
    throw new Error("User is already a collaborator");
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

  await sendEmail({
    template: "invite-collaborator",
    to: invitee.email,
    vars: {
      inviterName: owner.name,
      listName: list.name,
      acceptUrl: `/invites/${token}`,
    },
  });

  return invite;
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

  // Lock the invite row to serialize concurrent accept attempts. Without
  // the lock, two tabs clicking Accept could both pass the expiry check
  // and one would then fail on the unique membership constraint.
  await tx.$queryRaw`
    SELECT id FROM "TodoListInvite"
    WHERE token = ${token}
      AND "invitedUserId" = ${userId}
      AND "expiresAt" > ${now}
    ORDER BY id
    FOR NO KEY UPDATE
  `;

  const invite = await tx.todoListInvite.findFirstOrThrow({
    where: {
      token,
      invitedUserId: userId,
      expiresAt: { gt: now },
    },
  });

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

  await tx.todoList.findFirstOrThrow({
    where: { id: listId, userId: ownerId },
  });

  await tx.todoListMembership.delete({
    where: {
      userId_todoListId: { userId: targetUserId, todoListId: listId },
    },
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
