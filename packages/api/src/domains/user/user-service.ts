import type { Prisma, PrismaClient } from "@project/db";

type DbClient = PrismaClient | Prisma.TransactionClient;

const MAX_SEARCH_RESULTS = 8;

export async function searchUsersByUsername(
  db: DbClient,
  callerId: string,
  prefix: string,
): Promise<Array<{ id: string; username: string; name: string }>> {
  // Accept both "alice" and "@alice" (the autocomplete UI renders
  // usernames as "@alice" after selection, and that value feeds back
  // into the search on next keystroke). Normalize at the boundary —
  // one fix covers the UI re-edit path AND users who type "@" by hand.
  const normalized = prefix.trim().replace(/^@+/, "");
  if (normalized.length === 0) return [];
  return db.user.findMany({
    where: {
      AND: [
        { id: { not: callerId } },
        {
          OR: [
            { username: { startsWith: normalized, mode: "insensitive" } },
            { name: { startsWith: normalized, mode: "insensitive" } },
          ],
        },
      ],
    },
    select: { id: true, username: true, name: true },
    orderBy: { username: "asc" },
    take: MAX_SEARCH_RESULTS,
  });
}
