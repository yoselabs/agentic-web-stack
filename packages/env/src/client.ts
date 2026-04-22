import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

// Client-side env vars. Only VITE_ prefixed vars are safe to ship.
// Default is for zero-conf dev. Prod build always injects VITE_API_URL
// at build time (set by the CI / deployment pipeline).

// Cast: ImportMeta.env is declared by vite/client only; we also support node SSR.
const viteEnv = (
  import.meta as unknown as { env?: Record<string, string | undefined> }
).env;

// Browser-safe `process.env` access. `process` is undefined in Vitest
// browser-mode (real Chromium) and any plain-browser consumer; guarding
// lets this module import cleanly in every environment.
const nodeEnv: Record<string, string | undefined> | undefined =
  typeof globalThis !== "undefined"
    ? (globalThis as { process?: { env?: Record<string, string | undefined> } })
        .process?.env
    : undefined;

export const env = createEnv({
  clientPrefix: "VITE_",
  client: {
    VITE_API_URL: z.url().default("http://localhost:3001"),
  },
  runtimeEnv: {
    VITE_API_URL: viteEnv?.VITE_API_URL ?? nodeEnv?.VITE_API_URL,
  },
  emptyStringAsUndefined: true,
});
