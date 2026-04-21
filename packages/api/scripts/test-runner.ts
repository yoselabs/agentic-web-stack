import { spawnSync } from "node:child_process";
import path from "node:path";
import { envForSubprocess, setupTestDatabase } from "@project/test-infra";

// Package root is one level up from this scripts/ folder. bun test discovers
// files relative to cwd, so point it at the package root, not at scripts/.
const PACKAGE_ROOT = path.resolve(import.meta.dirname, "..");

setupTestDatabase("unit");

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
      // All test-infra-derived env vars (DATABASE_URL, BETTER_AUTH_URL,
      // BETTER_AUTH_SECRET, CORS_ORIGIN, future REDIS_URL, ...). Single
      // source of truth — adding a service in CONTAINER_SERVICES flows
      // through automatically, no hand-wiring here.
      ...envForSubprocess("unit"),
      // Bun's `bun test` defaults NODE_ENV to "test" if unset. The env
      // schema (packages/env/src/server.ts) deliberately rejects that —
      // test-harness signalling goes through TEST_MODE=1, not NODE_ENV.
      // Pin NODE_ENV explicitly so the child process sees a schema-valid
      // value regardless of what bun would otherwise inject.
      NODE_ENV: "development",
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
