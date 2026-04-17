// Emits @project/config values as shell exports. Consumers:
// - Makefile (dev, setup, test, test-ui targets) — sources the
//   output to set env vars before `docker compose up` and
//   `scripts/kill-ports.ts` invocations.
// - GitHub Actions CI (.github/workflows/ci.yml) — pipes output
//   into $GITHUB_ENV so workflow steps see the values.
//
// Deliberately simple: no args, prints all relevant values. If this
// grows (e.g., per-environment selection), split into
// scripts/export-dev-config.ts and scripts/export-test-config.ts.

import {
  DEV_DB_NAME,
  DEV_DB_PASSWORD,
  DEV_DB_USER,
  TEST_DB_NAME,
} from "@project/config/db";
import {
  DEV_API_PORT,
  DEV_DB_PORT,
  DEV_WEB_PORT,
  TEST_API_PORT,
  TEST_WEB_PORT,
} from "@project/config/ports";

const exports: Record<string, string | number> = {
  DEV_DB_PORT,
  DEV_DB_NAME,
  DEV_DB_USER,
  DEV_DB_PASSWORD,
  DEV_WEB_PORT,
  DEV_API_PORT,
  TEST_WEB_PORT,
  TEST_API_PORT,
  TEST_DB_NAME,
  // URLs derived from ports so CI + playwright + Makefile can
  // consume them as a single value without re-concatenating.
  TEST_CORS_ORIGIN: `http://localhost:${TEST_WEB_PORT}`,
  TEST_BETTER_AUTH_URL: `http://localhost:${TEST_API_PORT}`,
};

for (const [key, value] of Object.entries(exports)) {
  console.log(`${key}=${value}`);
}
