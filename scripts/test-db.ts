import { execSync } from "node:child_process";
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

function isContainerHealthy(container: string): boolean {
  try {
    const result = execSync(
      `docker inspect --format='{{.State.Health.Status}}' ${container} 2>/dev/null`,
      { encoding: "utf-8" },
    ).trim();
    return result === "healthy";
  } catch {
    return false;
  }
}

export async function setupTestDatabase(suite: TestSuite): Promise<void> {
  const { TEST_PORT, TEST_CONTAINER, TEST_DATABASE_URL } = testDbEnv(suite);
  const composeEnv = {
    ...process.env,
    TEST_PORT: String(TEST_PORT),
    TEST_CONTAINER,
  };
  const prismaCwd = path.join(PROJECT_ROOT, "packages/db");

  if (isContainerHealthy(TEST_CONTAINER)) {
    execSync("pnpm exec prisma db push --force-reset --skip-generate", {
      cwd: prismaCwd,
      stdio: "inherit",
      env: {
        ...process.env,
        DATABASE_URL: TEST_DATABASE_URL,
        PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION: "yes",
      },
    });
    return;
  }

  execSync(
    "docker compose -f docker-compose.test.yml down -v 2>/dev/null; true",
    { cwd: PROJECT_ROOT, stdio: "inherit", env: composeEnv },
  );
  execSync("docker compose -f docker-compose.test.yml up -d --wait", {
    cwd: PROJECT_ROOT,
    stdio: "inherit",
    env: composeEnv,
  });
  execSync("pnpm exec prisma db push --skip-generate", {
    cwd: prismaCwd,
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
  });
}
