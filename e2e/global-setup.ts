import { setupTestDatabase } from "@project/test-infra";

// Phase 3 of the Effect-TS rewrite: apps/worker is deleted (returns in
// Phase 4 with the queue capability walk). Until then, global setup is
// just the e2e Postgres bootstrap; no worker child process.
export default async function globalSetup() {
  await setupTestDatabase("e2e");
}
