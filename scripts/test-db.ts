import { createHash } from "node:crypto";
import path from "node:path";

export type TestSuite = "e2e" | "unit";

export const PROJECT_ROOT = path.resolve(import.meta.dirname, "..");

export function testDbEnv(suite: TestSuite) {
  const hash = createHash("md5").update(PROJECT_ROOT).digest("hex");
  const hash8 = hash.slice(0, 8);
  const portOffset = Number.parseInt(hash.slice(0, 4), 16) % 100;
  const portBase = suite === "e2e" ? 5400 : 5500;
  const port = portBase + portOffset;
  const container = `agentic-postgres-${suite}-${hash8}`;
  return {
    TEST_PORT: port,
    TEST_CONTAINER: container,
    TEST_DATABASE_URL: `postgresql://postgres:postgres@localhost:${port}/agentic_web_stack_test`,
    PROJECT_ROOT,
  };
}
