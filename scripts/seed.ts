import { auth } from "@project/auth";
import { db } from "@project/db";
import { SEED_USER } from "./seed-credentials.ts";

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
    },
  });

  console.log(`Created user: ${user.email}`);

  console.log("\nDemo credentials:");
  console.log(`  Email:    ${SEED_USER.email}`);
  console.log(`  Password: ${SEED_USER.password}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
