// DEV-ONLY database defaults. Production credentials come from env
// (DATABASE_URL) and are never duplicated here. Do not put prod
// secrets in this file.
//
// These values are consumed by:
// - docker-compose.yml (via scripts/export-config.ts)
// - scripts/generate-env-example.ts (builds .env.example)

export const DEV_DB_NAME = "agentic_web_stack";
export const DEV_DB_USER = "postgres";
export const DEV_DB_PASSWORD = "postgres";

// Test DB name — referenced by docker-compose.test.yml via
// scripts/test-db.ts (which already owns test-suite port derivation).
export const TEST_DB_NAME = "agentic_web_stack_test";
