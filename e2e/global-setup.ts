import { setupTestDatabase } from "@project/test-infra";

export default async function globalSetup() {
  await setupTestDatabase("e2e");
}
