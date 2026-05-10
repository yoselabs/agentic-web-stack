import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

// Runtime env vars for server / node code. Defaults are for zero-conf dev only.
// Prod deployments set every value externally; defaults never fire in prod.
// See docs/superpowers/specs/2026-04-18-zero-conf-architecture-design.md §D1/§D6.
//
// NEVER add client-safe vars here. Those belong in client.ts.
// NEVER read process.env outside this module (enforced by `make lint` grep).

const parsedEnv = createEnv({
  server: {
    DATABASE_URL: z
      .url()
      .default("postgresql://postgres:postgres@localhost:5432/app"),
    REDIS_URL: z.url().default("redis://localhost:6379"),
    SMTP_URL: z.url().default("smtp://localhost:1025"),
    MAIL_FROM: z.email().default("noreply@app.example.com"),
    MAILPIT_API_URL: z.url().default("http://localhost:8025"),
    CORS_ORIGIN: z.url().default("http://localhost:3000"),
    BETTER_AUTH_SECRET: z
      .string()
      .min(32)
      .default("change-me-to-a-random-32-char-secret-key"),
    BETTER_AUTH_URL: z.url().default("http://localhost:3001"),
    // Container-internal URL of the API server, used by the web app's
    // SSR / server-fn runtime to reach the API. In single-host dev this
    // matches VITE_API_URL. In docker demo / prod, set it to the
    // compose service DNS (e.g., http://server:3001) because the web
    // container cannot route to its own "localhost:3001".
    SSR_API_URL: z.url().default("http://localhost:3001"),
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
    WEB_URL: z.url().default("http://localhost:3000"),
    NODE_ENV: z.enum(["development", "production"]).default("development"),
    PORT: z.coerce.number().default(3001),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace"])
      .optional(),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});

// Derived test-mode flag. Centralized here so runtime code never has to
// juggle the sources itself — consumers just read `env.IS_TEST`.
//
// Two sources:
//   1. `process.env.VITEST === "true"` — set natively by Vitest / bun test.
//      Primary signal for unit/integration test runs.
//   2. `process.env.TEST_MODE === "1"` — set ONLY by the Playwright harness
//      (via @project/test-infra's `envForSubprocess`) when spawning the
//      web + API servers under test. Distinct from VITEST because the
//      e2e web server is a built Nitro bundle, not a Vitest process, and
//      Vite flips `jsxDEV` imports on NODE_ENV — so we can't overload
//      NODE_ENV=test without breaking the e2e web build.
//
// `NODE_ENV` is deliberately restricted to "development" | "production" in
// the Zod schema above. Setting `NODE_ENV=test` is a hard error — that's a
// louder failure than silently flipping IS_TEST. See docs/conventions.md
// "Test-mode detection".
const IS_TEST = process.env.VITEST === "true" || process.env.TEST_MODE === "1";

// Wrap parsedEnv in a Proxy that intercepts only IS_TEST and delegates
// everything else to t3-env's Proxy. Spreading parsedEnv would bypass
// its unknown-key guard (the Proxy throws on access to keys not in the
// schema), which is a load-bearing dev-ergonomics feature of t3-env.
export const env: typeof parsedEnv & { readonly IS_TEST: boolean } = new Proxy(
  parsedEnv as typeof parsedEnv & { readonly IS_TEST: boolean },
  {
    get(target, prop, receiver) {
      if (prop === "IS_TEST") return IS_TEST;
      return Reflect.get(target, prop, receiver);
    },
  },
);
