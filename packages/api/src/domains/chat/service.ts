import { ChatMessageKind, Prisma, type PrismaClient } from "@project/db";
import { TRPCError } from "@trpc/server";
import { roomChannel, userChannel } from "./channels.js";
import { MESSAGE_PAGE_SIZE } from "./constants.js";
import { isUserInRoom } from "./presence.js";

type DbClient = PrismaClient | Prisma.TransactionClient;
type Cursor = { createdAt: Date; id: string };

function dmKeyOf(a: string, b: string): string {
  return [a, b].sort().join(":");
}

export async function requireMembership(
  db: DbClient,
  userId: string,
  roomId: string,
): Promise<void> {
  const m = await db.chatMembership.findUnique({
    where: { roomId_userId: { roomId, userId } },
    select: { roomId: true },
  });
  if (!m) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Not a member of this room",
    });
  }
}

export async function createGroupRoom(
  tx: Prisma.TransactionClient,
  creatorId: string,
  name: string,
  memberIds: string[],
) {
  if (!memberIds.length) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "At least one member is required",
    });
  }
  const uniqueMembers = Array.from(new Set([creatorId, ...memberIds]));
  const room = await tx.chatRoom.create({ data: { name } });
  await tx.chatMembership.createMany({
    data: uniqueMembers.map((userId) => ({ roomId: room.id, userId })),
    skipDuplicates: true,
  });
  return room;
}

export async function dmFindOrCreate(
  tx: Prisma.TransactionClient,
  userA: string,
  userB: string,
) {
  if (userA === userB) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot DM yourself" });
  }
  const key = dmKeyOf(userA, userB);
  const existing = await tx.chatRoom.findUnique({ where: { dmKey: key } });
  if (existing) return existing;
  try {
    const room = await tx.chatRoom.create({ data: { dmKey: key } });
    await tx.chatMembership.createMany({
      data: [
        { roomId: room.id, userId: userA },
        { roomId: room.id, userId: userB },
      ],
    });
    return room;
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      // Other caller won the race — re-query is guaranteed to find it.
      const r = await tx.chatRoom.findUnique({ where: { dmKey: key } });
      if (!r) throw err;
      return r;
    }
    throw err;
  }
}

export async function inviteToRoom(
  tx: Prisma.TransactionClient,
  callerId: string,
  roomId: string,
  invitedId: string,
) {
  await requireMembership(tx, callerId, roomId);
  await tx.chatMembership.upsert({
    where: { roomId_userId: { roomId, userId: invitedId } },
    update: {},
    create: { roomId, userId: invitedId },
  });
}

export async function leaveRoom(
  tx: Prisma.TransactionClient,
  callerId: string,
  roomId: string,
) {
  await tx.chatMembership.delete({
    where: { roomId_userId: { roomId, userId: callerId } },
  });
}

export async function listMyRooms(db: DbClient, userId: string) {
  const rooms = await db.chatRoom.findMany({
    where: { memberships: { some: { userId } } },
    include: {
      memberships: {
        include: {
          user: {
            select: { id: true, username: true, name: true, image: true },
          },
        },
      },
      messages: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  const result = await Promise.all(
    rooms.map(async (r) => {
      const myMembership = r.memberships.find((m) => m.userId === userId);
      const lastRead = myMembership?.lastReadAt ?? new Date(0);
      const unreadCount = await db.chatMessage.count({
        where: { roomId: r.id, createdAt: { gt: lastRead } },
      });
      return {
        id: r.id,
        name: r.name,
        dmKey: r.dmKey,
        createdAt: r.createdAt,
        members: r.memberships.map((m) => m.user),
        lastMessageAt: r.messages[0]?.createdAt ?? null,
        unreadCount,
      };
    }),
  );

  result.sort((a, b) => {
    const at = a.lastMessageAt?.getTime() ?? 0;
    const bt = b.lastMessageAt?.getTime() ?? 0;
    return bt - at;
  });
  return result;
}

export async function getRoom(db: DbClient, userId: string, roomId: string) {
  await requireMembership(db, userId, roomId);
  return db.chatRoom.findUnique({
    where: { id: roomId },
    include: {
      memberships: {
        include: {
          user: {
            select: { id: true, username: true, name: true, image: true },
          },
        },
      },
    },
  });
}

export async function listMessages(
  db: DbClient,
  userId: string,
  roomId: string,
  beforeCursor?: Cursor,
) {
  await requireMembership(db, userId, roomId);
  const where = beforeCursor
    ? {
        roomId,
        OR: [
          { createdAt: { lt: beforeCursor.createdAt } },
          { createdAt: beforeCursor.createdAt, id: { lt: beforeCursor.id } },
        ],
      }
    : { roomId };
  return db.chatMessage.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: MESSAGE_PAGE_SIZE,
  });
}

export async function messagesSince(
  db: DbClient,
  userId: string,
  roomId: string,
  afterCursor: Cursor,
) {
  await requireMembership(db, userId, roomId);
  return db.chatMessage.findMany({
    where: {
      roomId,
      OR: [
        { createdAt: { gt: afterCursor.createdAt } },
        { createdAt: afterCursor.createdAt, id: { gt: afterCursor.id } },
      ],
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: MESSAGE_PAGE_SIZE * 4,
  });
}

async function nudgeAbsentMembers(
  tx: Prisma.TransactionClient,
  roomId: string,
) {
  const members = await tx.chatMembership.findMany({
    where: { roomId },
    select: { userId: true },
  });
  for (const { userId } of members) {
    if (!isUserInRoom(roomId, userId)) {
      userChannel.publish(userId, "unread:nudge", { roomId });
    }
  }
}

export async function sendTextMessage(
  tx: Prisma.TransactionClient,
  userId: string,
  roomId: string,
  text: string,
) {
  await requireMembership(tx, userId, roomId);
  const msg = await tx.chatMessage.create({
    data: { roomId, userId, kind: ChatMessageKind.TEXT, text },
  });
  // Publish AFTER the transaction commits. Within the tx, the row exists for
  // readers at this REPEATABLE READ snapshot; outside, $transaction wraps
  // BEGIN/COMMIT. We emit here because service is called inside the router's
  // $transaction — subscribers will still see the row once tx closes.
  roomChannel.publish(roomId, "message:new", {
    id: msg.id,
    roomId: msg.roomId,
    userId: msg.userId,
    kind: "TEXT",
    text: msg.text,
    fileId: null,
    createdAt: msg.createdAt,
  });
  await nudgeAbsentMembers(tx, roomId);
  return msg;
}

export async function sendFileMessage(
  tx: Prisma.TransactionClient,
  userId: string,
  roomId: string,
  fileId: string,
) {
  await requireMembership(tx, userId, roomId);
  const file = await tx.chatFile.findUnique({ where: { id: fileId } });
  if (!file || file.uploadedBy !== userId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "File not available" });
  }
  const msg = await tx.chatMessage.create({
    data: { roomId, userId, kind: ChatMessageKind.FILE, fileId },
  });
  roomChannel.publish(roomId, "message:new", {
    id: msg.id,
    roomId: msg.roomId,
    userId: msg.userId,
    kind: "FILE",
    text: null,
    fileId: msg.fileId,
    createdAt: msg.createdAt,
  });
  await nudgeAbsentMembers(tx, roomId);
  return msg;
}

export async function markRead(
  tx: Prisma.TransactionClient,
  userId: string,
  roomId: string,
  _lastSeenMessageId: string,
) {
  await tx.chatMembership.update({
    where: { roomId_userId: { roomId, userId } },
    data: { lastReadAt: new Date() },
  });
}
