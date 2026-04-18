import { defineConfig } from "@playwright/test";
import { envForSubprocess } from "@project/test-infra";
import { defineBddConfig } from "playwright-bdd";

import { TEST_API_PORT, TEST_WEB_PORT, TEST_WEB_URL } from "./test-env.js";

// Desktop runs every scenario except @mobile-tagged ones.
// Mobile runs ONLY @mobile-tagged scenarios — not a re-run of the full
// suite on a narrow viewport. Scenarios that need both viewports should
// either (a) live in desktop only (the default) or (b) add a new tag
// like @cross-viewport and include it in both filters here.
//
// Because the two filters are disjoint, the two projects share no test
// identity (no email/DB-row collisions), so they run fully parallel
// with no DB reset between them — see the `projects` array below.
const desktopTestDir = defineBddConfig({
  features: "features/**/*.feature",
  steps: "steps/**/*.ts",
  outputDir: ".features-gen/desktop",
  tags: "not @mobile",
});

const mobileTestDir = defineBddConfig({
  features: "features/**/*.feature",
  steps: "steps/**/*.ts",
  outputDir: ".features-gen/mobile",
  tags: "@mobile",
});

export default defineConfig({
  globalSetup: "./global-setup.ts",
  timeout: 30_000,
  retries: 0,
  fullyParallel: true,
  use: {
    baseURL: TEST_WEB_URL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "desktop",
      testDir: desktopTestDir,
      use: { browserName: "chromium" },
    },
    {
      name: "mobile",
      testDir: mobileTestDir,
      use: {
        browserName: "chromium",
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: [
    // Hono server runs via `bun src/index.ts` directly — no tsx, no watch,
    // no build. Bun executes TS natively and the server compiles all routes
    // once at import (no on-demand compilation like SSR), so it's inherently
    // stable under parallel test load. ~300ms faster cold start than
    // `tsx watch` and removes the test-time watcher overhead.
    {
      command: "pnpm --filter @project/server exec bun src/index.ts",
      port: TEST_API_PORT,
      reuseExistingServer: !process.env.CI,
      // All env vars (DATABASE_URL, BETTER_AUTH_URL, BETTER_AUTH_SECRET,
      // CORS_ORIGIN, PORT, future REDIS_URL, ...) derived from
      // @project/test-infra's single source of truth.
      env: envForSubprocess("e2e", "api"),
    },
    // Web runs in BUILT mode, not `vite dev`. Dev-server on-demand SSR
    // compilation can't keep up when N Playwright workers cold-hit routes
    // in parallel — clicks can land before hydration, tests wedge for the
    // full timeout. A Nitro production server (built bundle, no on-demand
    // compile) serves requests with stable latency under contention.
    // First run pays a ~15–20s build cost; subsequent runs with
    // `reuseExistingServer` skip it. CI always rebuilds.
    {
      // Pre-existing stderr noise: TanStack Router's SSR `loadMatches` path
      // throws `Cannot destructure property '__extends'` in the Nitro bundle.
      // Present under BOTH node and bun runtimes — tslib interop issue in
      // how Nitro bundles TanStack Router, not a runtime bug. Tests pass
      // (SSR falls back cleanly). Worth filing upstream at some point.
      // `rm -rf .output` before build: protects against a partially-written
      // Nitro bundle from a previously-interrupted build (Ctrl-C, OOM, etc.)
      // being served silently. vite build should overwrite cleanly, but the
      // trailing output files from a different source tree are not guaranteed
      // to be replaced. Cheap (< 100ms) and only runs on cold starts where
      // reuseExistingServer doesn't kick in.
      command:
        "pnpm --filter @project/web exec rm -rf .output && pnpm --filter @project/web build && pnpm --filter @project/web exec bun .output/server/index.mjs",
      port: TEST_WEB_PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      // Same SSOT as the API server above — "web" role adds VITE_API_URL
      // (baked into the Vite build) + PORT (Nitro listener).
      env: envForSubprocess("e2e", "web"),
    },
  ],
});
