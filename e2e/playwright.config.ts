import { defineConfig } from "@playwright/test";
import { TEST_API_PORT, TEST_WEB_PORT } from "@project/config";
import { defineBddConfig } from "playwright-bdd";

import { TEST_DATABASE_URL } from "./test-env.js";

// Desktop runs all features except @mobile-tagged ones
const desktopTestDir = defineBddConfig({
  features: "features/**/*.feature",
  steps: "steps/**/*.ts",
  outputDir: ".features-gen/desktop",
  tags: "not @mobile",
});

// Mobile runs all features (including @mobile-specific ones)
const mobileTestDir = defineBddConfig({
  features: "features/**/*.feature",
  steps: "steps/**/*.ts",
  outputDir: ".features-gen/mobile",
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
      name: "mobile-setup",
      testMatch: /db-reset\.setup\.ts/,
      dependencies: ["desktop"],
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
      dependencies: ["mobile-setup"],
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
