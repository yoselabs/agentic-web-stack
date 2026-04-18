// Promotes an existing user to role="admin" by email.
// Usage: bun run scripts/seed-admin.ts admin@example.com

import { db } from "@project/db";

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error("Usage: bun run scripts/seed-admin.ts <email>");
    process.exit(1);
  }

  const user = await db.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`No user with email "${email}". Sign them up first.`);
    process.exit(1);
  }

  await db.user.update({ where: { id: user.id }, data: { role: "admin" } });
  console.log(`Promoted ${email} to admin.`);
  await db.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
