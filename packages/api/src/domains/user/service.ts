import type { Prisma, PrismaClient } from "@project/db";

type DbClient = PrismaClient | Prisma.TransactionClient;

export type UserSearchResult = {
  userId: string;
  username: string | null;
  name: string;
  image: string | null;
};

export async function searchUsers(
  db: DbClient,
  query: string,
): Promise<UserSearchResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  const rows = await db.user.findMany({
    where: {
      OR: [
        { username: { startsWith: q, mode: "insensitive" } },
        { name: { contains: q, mode: "insensitive" } },
      ],
    },
    select: { id: true, username: true, name: true, image: true },
    take: 50,
  });

  const lower = q.toLowerCase();
  const score = (u: { username: string | null; name: string }) => {
    const un = u.username?.toLowerCase() ?? "";
    if (un === lower) return 0;
    if (un.startsWith(lower)) return 1;
    if (u.name.toLowerCase().includes(lower)) return 2;
    return 3;
  };
  rows.sort((a, b) => {
    const sa = score(a);
    const sb = score(b);
    if (sa !== sb) return sa - sb;
    return a.name.localeCompare(b.name);
  });

  return rows.slice(0, 20).map((u) => ({
    userId: u.id,
    username: u.username,
    name: u.name,
    image: u.image,
  }));
}

export async function isUsernameAvailable(
  db: DbClient,
  username: string,
): Promise<boolean> {
  const existing = await db.user.findUnique({
    where: { username },
    select: { id: true },
  });
  return existing === null;
}
