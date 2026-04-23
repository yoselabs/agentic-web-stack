import { db } from "@project/db";
import { sendEmail } from "@project/email/service";
import { env } from "@project/env/server";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { magicLink } from "better-auth/plugins";
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
  plugins: [
    // Magic-link sign-in (Pattern 2 — secondary option below the password
    // form). Defaults: 5-minute expiry, single-use token. The "expired
    // link" BDD scenario hits the verify endpoint with an invalid token
    // rather than skipping past the default expiry.
    magicLink({
      sendMagicLink: async ({ email, url }) => {
        await sendEmail({
          template: "magic-link",
          to: email,
          vars: { signInUrl: url },
        });
      },
    }),
  ],
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
  // Cross-subdomain cookie scope. Enabled only when AUTH_COOKIE_DOMAIN is
  // set; otherwise better-auth uses its default host-only cookie.
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
