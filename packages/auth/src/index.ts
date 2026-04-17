import { MIN_PASSWORD_LENGTH } from "@project/config";
import { db } from "@project/db";
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
  trustedOrigins: [process.env.CORS_ORIGIN ?? "http://localhost:3000"],
});

export type Session = typeof auth.$Infer.Session;
