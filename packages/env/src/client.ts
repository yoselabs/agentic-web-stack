import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

// Client-side env vars. Only VITE_ prefixed vars are safe to ship.
// Default is for zero-conf dev. Prod build always injects VITE_API_URL
// at build time (set by the CI / deployment pipeline).

// Cast: ImportMeta.env is declared by vite/client only; we also support node SSR.
const viteEnv = (
  import.meta as unknown as { env?: Record<string, string | undefined> }
).env;

export const env = createEnv({
  clientPrefix: "VITE_",
  client: {
    VITE_API_URL: z.string().url().default("http://localhost:3001"),
    VITE_ENABLE_CHAT: z
      .string()
      .optional()
      .default("false")
      .transform((v) => v === "true"),
    VITE_WS_URL: z
      .string()
      .url()
      .optional()
      .default("ws://localhost:3001/trpc-ws"),
  },
  runtimeEnv: {
    VITE_API_URL: viteEnv?.VITE_API_URL ?? process.env.VITE_API_URL,
    VITE_ENABLE_CHAT: viteEnv?.VITE_ENABLE_CHAT ?? process.env.VITE_ENABLE_CHAT,
    VITE_WS_URL: viteEnv?.VITE_WS_URL ?? process.env.VITE_WS_URL,
  },
  emptyStringAsUndefined: true,
});
