import { PrismaClient } from "@prisma/client";
import { env } from "@project/env/server";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// Pass DATABASE_URL explicitly so the Zod default from @project/env applies
// even when no .env file is present (zero-conf boot). Prisma's schema
// `env("DATABASE_URL")` binding reads process.env directly and would not see
// the default value — overriding here closes that gap.
export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasources: { db: { url: env.DATABASE_URL } },
  });

if (env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}

// Re-export all generated types (enums, input types, Prisma namespace, PrismaClient, etc.)
// so consumers can `import { Prisma, MyEnum } from "@project/db"` without reaching into @prisma/client
export * from "@prisma/client";
