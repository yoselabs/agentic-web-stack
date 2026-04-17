import { MIN_PASSWORD_LENGTH } from "@project/config";
import { db } from "@project/db";
import { env } from "@project/env/server";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";

export const auth = betterAuth({
  database: prismaAdapter(db, {
    provider: "postgresql",
  }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: MIN_PASSWORD_LENGTH,
  },
  trustedOrigins: [env.CORS_ORIGIN],
});

export type Session = typeof auth.$Infer.Session;
