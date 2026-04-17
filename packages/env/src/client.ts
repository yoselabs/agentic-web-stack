import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

// Client-side env vars. Only vars prefixed with VITE_ are safe to
// ship to the browser. `@t3-oss/env-core` validates at module load;
// if a required VITE_* is missing at build time, the app fails to
// start rather than silently shipping `undefined` to the client.
//
// Never add server-only secrets (DATABASE_URL, BETTER_AUTH_SECRET)
// to this file. Those belong in server.ts.

// Vite injects import.meta.env at build time. In non-Vite (node/SSR)
// contexts, access it via process.env. The cast avoids a type error
// since `ImportMeta.env` is only declared in vite/client types, not
// the base node types.
const viteEnv = (
  import.meta as unknown as { env?: Record<string, string | undefined> }
).env;

export const env = createEnv({
  clientPrefix: "VITE_",
  client: {
    VITE_API_URL: z.string().url(),
  },
  runtimeEnv: {
    VITE_API_URL: viteEnv?.VITE_API_URL ?? process.env.VITE_API_URL,
  },
  emptyStringAsUndefined: true,
});
