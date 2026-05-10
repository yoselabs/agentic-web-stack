// `import type {} from "zod/v4/core"` brings zod's internal `$strip`
// symbol into module scope so tsc can name the inferred Better-Auth
// type (the magic-link plugin's options reference it via z.object().strip()).
// Without this, TS2883 fires on the exported `auth` const. No runtime
// cost — type-only side-effect import.

import { db } from "@project/db";
import { enqueueSendEmail } from "@project/email/enqueue";
import { env } from "@project/env/server";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { magicLink } from "better-auth/plugins/magic-link";
import type {} from "zod/v4/core";
import { MIN_PASSWORD_LENGTH } from "./constants.ts";

// Phase 4 capability #2: magic-link sign-in + password reset wired to
// the email queue. Both callbacks delegate to enqueueSendEmail (see
// @project/email/enqueue) — the worker handler in apps/worker drives
// the actual SMTP send through MailerService with Effect.Schedule
// retry. ADR-0020 §Decision A — auth is the producer; mailer is the
// consumer.
//
// Templates are inline HTML for now. ADR-0020 acceptance allows a
// dedicated templates package (`@project/email/templates`) as a follow-
// up — the producer surface stays the same.

const renderMagicLinkEmail = (
  url: string,
): { subject: string; html: string } => ({
  subject: "Your sign-in link",
  html: `<p>Sign in by clicking the link below. It expires in 5 minutes.</p>
<p><a href="${url}">${url}</a></p>
<p>If you did not request this email, you can safely ignore it.</p>`,
});

const renderPasswordResetEmail = (
  url: string,
  username: string,
): { subject: string; html: string } => ({
  subject: "Reset your password",
  html: `<p>Hi ${username},</p>
<p>We received a request to reset your password. Click the link below to set a new one:</p>
<p><a href="${url}">${url}</a></p>
<p>If you did not request this, you can safely ignore this email.</p>`,
});

export const auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: prismaAdapter(db, {
    provider: "postgresql",
  }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: MIN_PASSWORD_LENGTH,
    sendResetPassword: async ({ user, url }) => {
      const { subject, html } = renderPasswordResetEmail(
        url,
        (user as { username?: string; name?: string }).username ??
          (user as { name?: string }).name ??
          user.email,
      );
      await enqueueSendEmail({
        to: user.email,
        from: env.MAIL_FROM,
        subject,
        html,
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
  advanced: env.AUTH_COOKIE_DOMAIN
    ? {
        defaultCookieAttributes: {
          domain: env.AUTH_COOKIE_DOMAIN,
          path: "/",
          sameSite: "lax",
        },
      }
    : undefined,
  plugins: [
    magicLink({
      sendMagicLink: async ({ email, url }) => {
        const { subject, html } = renderMagicLinkEmail(url);
        await enqueueSendEmail({
          to: email,
          from: env.MAIL_FROM,
          subject,
          html,
        });
      },
    }),
  ],
});

export type Session = typeof auth.$Infer.Session;
