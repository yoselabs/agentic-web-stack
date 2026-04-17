import { setupTestDatabase } from "../../scripts/test-db.ts";

export async function setup() {
  await setupTestDatabase("unit");
}
