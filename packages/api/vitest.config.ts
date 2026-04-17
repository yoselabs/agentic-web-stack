import path from "node:path";
import { defineConfig } from "vitest/config";
import { testDbEnv } from "../../scripts/test-db.ts";

const env = testDbEnv("unit");

// Set at module scope — vitest's main process and all workers (via inheritance
// when pool="forks") read this BEFORE any test file or globalSetup imports
// @project/db. @project/db's `new PrismaClient()` runs at module load and
// captures DATABASE_URL then. Moving this line below defineConfig() or into
// test.env breaks cold-start main-process code paths. Do not reorder.
// Rule: neither this file nor test-setup.ts may import @project/db (directly
// or transitively).
process.env.DATABASE_URL = env.TEST_DATABASE_URL;
// @project/env/server validates all server env vars at module load (including
// @project/db which now imports it). Provide safe test-only values so the
// schema validation passes in workers where .env is not loaded.
process.env.BETTER_AUTH_SECRET =
  process.env.BETTER_AUTH_SECRET ??
  "test-secret-key-for-unit-tests-only-32chars";
process.env.CORS_ORIGIN = process.env.CORS_ORIGIN ?? "http://localhost:3000";
process.env.BETTER_AUTH_URL =
  process.env.BETTER_AUTH_URL ?? "http://localhost:3001";

export default defineConfig({
  test: {
    testTimeout: 15_000,
    exclude: ["dist/**", "node_modules/**"],
    // Belt-and-suspenders: inject into every worker's env explicitly. The
    // module-scope mutation above covers the main process; this covers workers
    // whose pool spawner snapshots at spawn time. Both are load-bearing — do
    // not delete either thinking the other is redundant.
    env: {
      DATABASE_URL: env.TEST_DATABASE_URL,
      BETTER_AUTH_SECRET: "test-secret-key-for-unit-tests-only-32chars",
      CORS_ORIGIN: "http://localhost:3000",
      BETTER_AUTH_URL: "http://localhost:3001",
    },
    // Forks snapshot process.env at spawn — the DATABASE_URL set above pins
    // into every worker. Threads share a live process.env by reference, which
    // would leak any later mutation to sibling workers. Forks is the safer
    // choice for DB-URL isolation; do NOT switch to "threads" without a
    // different DATABASE_URL strategy.
    pool: "forks",
    globalSetup: [path.resolve(import.meta.dirname, "test-setup.ts")],
  },
});
