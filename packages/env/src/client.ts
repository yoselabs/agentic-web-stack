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
  },
  runtimeEnv: {
    VITE_API_URL: viteEnv?.VITE_API_URL ?? process.env.VITE_API_URL,
  },
  emptyStringAsUndefined: true,
});
