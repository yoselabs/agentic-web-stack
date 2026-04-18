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
    CORS_ORIGIN: z.string().url().default("http://localhost:3000"),
    BETTER_AUTH_SECRET: z
      .string()
      .min(32)
      .default("change-me-to-a-random-32-char-secret-key"),
    BETTER_AUTH_URL: z.string().url().default("http://localhost:3001"),
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),
    PORT: z.coerce.number().default(3001),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace"])
      .optional(),
    ENABLE_CHAT: z
      .string()
      .optional()
      .default("false")
      .transform((v) => v === "true"),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
