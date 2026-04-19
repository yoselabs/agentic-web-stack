import type { Prisma, PrismaClient } from "@project/db";

type DbClient = PrismaClient | Prisma.TransactionClient;

const MAX_SEARCH_RESULTS = 8;

export async function searchUsersByUsername(
  db: DbClient,
  callerId: string,
  prefix: string,
): Promise<Array<{ id: string; username: string; name: string }>> {
  const trimmed = prefix.trim();
  if (trimmed.length === 0) return [];
  return db.user.findMany({
    where: {
      AND: [
        { id: { not: callerId } },
        {
          OR: [
            { username: { startsWith: trimmed, mode: "insensitive" } },
            { name: { startsWith: trimmed, mode: "insensitive" } },
          ],
        },
      ],
    },
    select: { id: true, username: true, name: true },
    orderBy: { username: "asc" },
    take: MAX_SEARCH_RESULTS,
  });
}
