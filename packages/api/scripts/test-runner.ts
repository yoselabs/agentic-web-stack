import { spawnSync } from "node:child_process";
import path from "node:path";
import { setupTestDatabase, testDbEnv } from "../../../scripts/test-db.ts";

// Package root is one level up from this scripts/ folder. bun test discovers
// files relative to cwd, so point it at the package root, not at scripts/.
const PACKAGE_ROOT = path.resolve(import.meta.dirname, "..");

setupTestDatabase("unit");
const env = testDbEnv("unit");

// Forward any CLI args past our own script (e.g. a test path filter,
// `--test-name-pattern`, `--watch`). Bun test's positional filters match on
// substring, so `pnpm --filter @project/api test todo/service` works.
const forwardedArgs = process.argv.slice(2);

const result = spawnSync(
  "bun",
  ["test", "--path-ignore-patterns=dist/**", ...forwardedArgs],
  {
    stdio: "inherit",
    cwd: PACKAGE_ROOT,
    env: {
      ...process.env,
      DATABASE_URL: env.TEST_DATABASE_URL,
      BETTER_AUTH_SECRET:
        process.env.BETTER_AUTH_SECRET ??
        "test-secret-key-for-unit-tests-only-32chars",
      CORS_ORIGIN: process.env.CORS_ORIGIN ?? "http://localhost:3000",
      BETTER_AUTH_URL: process.env.BETTER_AUTH_URL ?? "http://localhost:3001",
    },
  },
);

// Report signal crashes distinctly from test failures. CI sees "tests failed"
// as exit 1, but "worker crashed" needs a visible marker so operators don't
// spend time investigating test logic for a SIGSEGV.
if (result.signal) {
  console.error(`bun test terminated by signal ${result.signal}`);
  process.exit(128);
}
process.exit(result.status ?? 1);
