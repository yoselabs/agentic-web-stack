// Canonical demo / test credentials. Used by:
// - scripts/seed.ts (demo-mode migrate sidecar + `make db-seed`)
// - e2e/fixtures/credentials.ts (re-exports for test scenarios)
//
// Moved here from e2e/fixtures so the demo-mode runtime image (which
// excludes e2e/) can still resolve the import.
//
// Complex password future-proofs e2e against Better-Auth adding
// upper/lower/digit/symbol rules.

export const SHARED_PASSWORD = "TestPassword!123";

export const SEED_USER = {
  email: "demo@example.com",
  password: SHARED_PASSWORD,
} as const;

export const TEST_USER = {
  email: "test@example.com",
  password: SHARED_PASSWORD,
} as const;
