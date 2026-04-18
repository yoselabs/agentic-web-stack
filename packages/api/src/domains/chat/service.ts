import { Prisma, type PrismaClient } from "@project/db";
import { TRPCError } from "@trpc/server";

type DbClient = PrismaClient | Prisma.TransactionClient;

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
