import { defineConfig } from "@playwright/test";
import { defineBddConfig } from "playwright-bdd";

import { TEST_DATABASE_URL } from "./test-env.js";

// Static 3100/3101 until Task 5 makes test ports dynamic per worktree.
const TEST_WEB_PORT = 3100;
const TEST_API_PORT = 3101;

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

const WEB_URL = `http://localhost:${TEST_WEB_PORT}`;
const API_URL = `http://localhost:${TEST_API_PORT}`;

export default defineConfig({
  globalSetup: "./global-setup.ts",
  timeout: 30_000,
  retries: 0,
  fullyParallel: true,
  use: {
    baseURL: WEB_URL,
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
    {
      command: "pnpm --filter @project/server dev",
      port: TEST_API_PORT,
      reuseExistingServer: !process.env.CI,
      env: {
        PORT: String(TEST_API_PORT),
        DATABASE_URL: TEST_DATABASE_URL,
        BETTER_AUTH_SECRET: "test-secret-key-for-e2e-tests-only-32chars",
        BETTER_AUTH_URL: API_URL,
        CORS_ORIGIN: WEB_URL,
      },
    },
    {
      command: `pnpm --filter @project/web exec vite dev --port ${TEST_WEB_PORT}`,
      port: TEST_WEB_PORT,
      reuseExistingServer: !process.env.CI,
      env: {
        VITE_API_URL: API_URL,
      },
    },
  ],
});
