import { db } from "@project/db";
import { env } from "@project/env/server";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { MIN_PASSWORD_LENGTH } from "./constants.js";

// Phase 3 first slice: email + password only. Magic-link, password-reset,
// and email-template-driven flows return in Phase 4 alongside @project/email.
// The `Auth` Effect Layer in @project/api wraps this instance — Better-Auth
// itself is non-Effect (Q5 floor), so wrapping at the boundary is the
// canonical pattern.

export const auth = betterAuth({
  database: prismaAdapter(db, {
    provider: "postgresql",
  }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: MIN_PASSWORD_LENGTH,
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
  advanced: env.AUTH_COOKIE_DOMAIN
    ? {
        defaultCookieAttributes: {
          domain: env.AUTH_COOKIE_DOMAIN,
          path: "/",
          sameSite: "lax",
        },
      }
    : undefined,
});

export type Session = typeof auth.$Infer.Session;
