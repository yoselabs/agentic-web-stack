import { db } from "@project/db";
import { sendEmail } from "@project/email/service";
import { env } from "@project/env/server";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { MIN_PASSWORD_LENGTH } from "./constants.js";

export const auth = betterAuth({
  database: prismaAdapter(db, {
    provider: "postgresql",
  }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: MIN_PASSWORD_LENGTH,
    sendResetPassword: async ({ user, url }) => {
      await sendEmail({
        template: "password-reset",
        to: user.email,
        vars: { userName: user.name, resetUrl: url },
      });
    },
  },
  user: {
    additionalFields: {
      role: {
        type: "string",
        defaultValue: "user",
        input: false,
        unique: false,
      },
      username: {
        type: "string",
        input: true,
        unique: true,
        required: true,
      },
    },
  },
  trustedOrigins: [env.CORS_ORIGIN],
});

export type Session = typeof auth.$Infer.Session;
