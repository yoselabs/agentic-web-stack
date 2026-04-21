import { PrismaPg } from "@prisma/adapter-pg";
import { env } from "@project/env/server";
import { PrismaClient } from "./generated/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// Prisma 7 replaced the `datasources: { db: { url } }` constructor override
// with driver adapters. PrismaPg wraps node-postgres (pg) and handles the
// connection pool. Passing `env.DATABASE_URL` (from @project/env/server)
// keeps the zero-conf default path working — the Zod default fires when no
// shell env / .env is present, same as before.
export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter: new PrismaPg({ connectionString: env.DATABASE_URL }),
  });

if (env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}

// Re-export all generated types (enums, input types, Prisma namespace, PrismaClient, etc.)
// so consumers can `import { Prisma, MyEnum } from "@project/db"` without reaching into
// the generated output. The new `prisma-client` generator emits a standalone ESM client
// under src/generated/ — the output path is internal; consumers always go through @project/db.
export * from "./generated/client";
