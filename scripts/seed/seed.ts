// Canonical demo / test credentials + demo-mode seed runner.
//
// Constants are consumed by:
// - This file's main() (demo-mode migrate sidecar + `make db-seed`)
// - e2e/fixtures/credentials.ts (re-exports for test scenarios)
//
// Complex password future-proofs e2e against Better-Auth adding
// upper/lower/digit/symbol rules.

import { auth } from "@project/auth";
import { db } from "@project/db";

export const SHARED_PASSWORD = "TestPassword!123";

export const SEED_USER = {
  email: "demo@example.com",
  password: SHARED_PASSWORD,
  username: "demo",
} as const;

export const TEST_USER = {
  email: "test@example.com",
  password: SHARED_PASSWORD,
  username: "test",
} as const;

async function main() {
  console.log("Seeding database...");

  // Check if already seeded
  const existing = await db.user.findFirst({
    where: { email: SEED_USER.email },
  });

  if (existing) {
    console.log(`Already seeded (${SEED_USER.email} exists), skipping.`);
    return;
  }

  // Create demo user via Better-Auth (handles password hashing)
  const { user } = await auth.api.signUpEmail({
    body: {
      email: SEED_USER.email,
      password: SEED_USER.password,
      name: "Demo User",
      username: SEED_USER.username,
    },
  });

  console.log(`Created user: ${user.email}`);

  console.log("\nDemo credentials:");
  console.log(`  Email:    ${SEED_USER.email}`);
  console.log(`  Password: ${SEED_USER.password}`);
}

// Only run the seed when invoked as a script (`bun scripts/seed/seed.ts`), not
// when imported as a module (e.g. e2e/fixtures/credentials.ts reaches in
// for the constant exports above). import.meta.main is Bun-native.
if (import.meta.main) {
  main()
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => db.$disconnect());
}
