// Shared test credentials. Import from this fixture instead of hardcoding
// passwords in step definitions or seed scripts.
//
// Two accounts:
// - SEED_USER: the demo account written by scripts/seed.ts. Stable across runs.
// - TEST_USER: a stable identity for E2E scenarios that don't parameterize the
//   email. Scenarios that take {string} emails parametrically use those
//   directly — this is only for steps that need a default.
//
// Both accounts share the same password so developers have one value to
// remember when debugging locally.

// Passes any reasonable complexity policy (upper, lower, digit, symbol) so
// a future Better-Auth config that adds password rules doesn't invalidate
// every scenario at once.
export const SHARED_PASSWORD = "TestPassword!123";

export const SEED_USER = {
  email: "demo@example.com",
  password: SHARED_PASSWORD,
} as const;

export const TEST_USER = {
  email: "test@example.com",
  password: SHARED_PASSWORD,
} as const;
