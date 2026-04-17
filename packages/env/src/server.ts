import { DEV_API_PORT, DEV_WEB_PORT } from "@project/config/ports";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    DATABASE_URL: z.string().url(),
    CORS_ORIGIN: z.string().url().default(`http://localhost:${DEV_WEB_PORT}`),
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z
      .string()
      .url()
      .default(`http://localhost:${DEV_API_PORT}`),
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),
    PORT: z.coerce.number().default(DEV_API_PORT),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace"])
      .optional(),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
