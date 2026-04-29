import { PrismaPg } from "@prisma/adapter-pg";
import { env } from "@project/env/server";
import { PrismaClient } from "./generated/client";

// Singleton PrismaClient. The Effect `Db` Layer in @project/api wraps
// this instance — Phase 3 of the Effect-TS rewrite (ADR-0009 / ADR-0013).
// Better-Auth's prismaAdapter consumes the same client directly, since
// Better-Auth is non-Effect.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter: new PrismaPg({ connectionString: env.DATABASE_URL }),
  });

if (env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}

export * from "./generated/client";
