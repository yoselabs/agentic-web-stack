// Shared test-time user fixtures. Imported from both Bun unit tests (in
// packages/api) and BDD step definitions (in e2e/steps). Fixtures take the
// `db` client as a parameter — they never read a module-level client — so
// the caller controls which database the seed lands in.

import type { PrismaClient } from "@project/db";

/**
 * Create a user record without a session. Useful for tests that care about
 * presence in the DB but not about login state.
 */
export async function seedUser(
  db: PrismaClient,
  email: string,
  opts: { name?: string; username?: string; emailVerified?: boolean } = {},
) {
  const local = email.split("@")[0];
  return db.user.create({
    data: {
      id: crypto.randomUUID(),
      email,
      emailVerified: opts.emailVerified ?? false,
      name: opts.name ?? local,
      username: opts.username ?? local,
    },
  });
}
