import { setupTestDatabase } from "../scripts/test-db.ts";

export default async function globalSetup() {
  await setupTestDatabase("e2e");
}
