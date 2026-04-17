import path from "node:path";
import { defineConfig } from "vitest/config";
import { testDbEnv } from "../../scripts/test-db.ts";

const env = testDbEnv("unit");

process.env.DATABASE_URL = env.TEST_DATABASE_URL;

export default defineConfig({
  test: {
    testTimeout: 15_000,
    exclude: ["dist/**", "node_modules/**"],
    env: { DATABASE_URL: env.TEST_DATABASE_URL },
    pool: "forks",
    globalSetup: [path.resolve(import.meta.dirname, "test-setup.ts")],
  },
});
