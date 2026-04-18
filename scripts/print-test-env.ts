// Prints TEST_WEB_PORT=... TEST_API_PORT=... as shell-sourceable lines,
// one per arg. Consumers:
// - Makefile `test` / `test-ui` targets — sourced to pass to kill-ports.
// - .github/workflows/ci.yml — piped into $GITHUB_ENV.
//
// Pass suite as first arg: `tsx scripts/print-test-env.ts e2e`

import { type TestSuite, testDbEnv } from "./test-db.ts";

const suite = (process.argv[2] ?? "e2e") as TestSuite;
if (suite !== "e2e" && suite !== "unit") {
  console.error(`Invalid suite: ${suite}. Expected "e2e" or "unit".`);
  process.exit(1);
}

const env = testDbEnv(suite);
console.log(`TEST_WEB_PORT=${env.TEST_WEB_PORT}`);
console.log(`TEST_API_PORT=${env.TEST_API_PORT}`);
