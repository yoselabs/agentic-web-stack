import { spawnSync } from "node:child_process";
import path from "node:path";
import { envForSubprocess, setupTestDatabase } from "@project/test-infra";

// ADR-0019 — `bun test` for @project/api. Bootstraps the unit-suite
// Postgres (per packages/test-infra), then runs `bun test` with the
// per-worktree DATABASE_URL/BETTER_AUTH_* env. Forwards CLI args
// untouched so `pnpm --filter @project/api test todo` substring-filters.

const PACKAGE_ROOT = path.resolve(import.meta.dirname, "..");

setupTestDatabase("unit");

const forwardedArgs = process.argv.slice(2);

const result = spawnSync(
  "bun",
  ["test", "--path-ignore-patterns=dist/**", ...forwardedArgs],
  {
    stdio: "inherit",
    cwd: PACKAGE_ROOT,
    env: {
      ...process.env,
      ...envForSubprocess("unit"),
      // `bun test` defaults NODE_ENV to "test" if unset; @project/env's
      // schema rejects that — test-harness signalling goes through
      // TEST_MODE=1, not NODE_ENV.
      NODE_ENV: "development",
    },
  },
);

if (result.signal) {
  console.error(`bun test terminated by signal ${result.signal}`);
  process.exit(128);
}
process.exit(result.status ?? 1);
