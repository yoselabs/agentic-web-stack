import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

// Runtime env vars for server / node code. Defaults are for zero-conf dev only.
// Prod deployments set every value externally; defaults never fire in prod.
// See docs/superpowers/specs/2026-04-18-zero-conf-architecture-design.md §D1/§D6.
//
// NEVER add client-safe vars here. Those belong in client.ts.
// NEVER read process.env outside this module (enforced by `make lint` grep).

export const env = createEnv({
  server: {
    DATABASE_URL: z
      .string()
      .url()
      .default("postgresql://postgres:postgres@localhost:5432/app"),
    REDIS_URL: z.string().url().default("redis://localhost:6379"),
    SMTP_URL: z.string().url().default("smtp://localhost:1025"),
    MAILPIT_API_URL: z.string().url().default("http://localhost:8025"),
    CORS_ORIGIN: z.string().url().default("http://localhost:3000"),
    BETTER_AUTH_SECRET: z
      .string()
      .min(32)
      .default("change-me-to-a-random-32-char-secret-key"),
    BETTER_AUTH_URL: z.string().url().default("http://localhost:3001"),
    // Optional: leading dot = cross-subdomain cookie scope (e.g. ".example.com"
    // lets app.example.com and api.example.com share the session cookie).
    // Leave unset for the default host-only cookie — correct when frontend
    // and API share a host.
    AUTH_COOKIE_DOMAIN: z
      .string()
      .startsWith(".", "must start with . for cross-subdomain cookies")
      .optional(),
    // Public origin of the web UI. Used by server-side code that needs
    // to construct user-facing links for external channels (email body,
    // push notifications, SMS). Distinct from BETTER_AUTH_URL (the API
    // origin where Better-Auth handlers live) and CORS_ORIGIN (the
    // allowed cross-origin policy) — even when they coincide in dev,
    // separating them keeps the intent explicit.
    WEB_URL: z.string().url().default("http://localhost:3000"),
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),
    PORT: z.coerce.number().default(3001),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace"])
      .optional(),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
