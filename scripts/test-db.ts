import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { TEST_DB_NAME } from "@project/config/db";

export type TestSuite = "e2e" | "unit";

export const PROJECT_ROOT = path.resolve(import.meta.dirname, "..");

export function testDbEnv(suite: TestSuite) {
  const hash = createHash("md5").update(PROJECT_ROOT).digest("hex");
  const hash8 = hash.slice(0, 8);
  // 100-slot modulo → birthday-paradox collision between worktrees becomes
  // likely past ~12 checkouts of this repo on one host. Container names
  // (hash8) don't collide, but the host port bind will — docker fails loudly
  // with "port already allocated", which is acceptable and rare in practice.
  const portOffset = Number.parseInt(hash.slice(0, 4), 16) % 100;
  const portBase = suite === "e2e" ? 5400 : 5500;
  const port = portBase + portOffset;
  const container = `agentic-postgres-${suite}-${hash8}`;
  return {
    TEST_PORT: port,
    TEST_CONTAINER: container,
    TEST_DB_NAME,
    TEST_DATABASE_URL: `postgresql://postgres:postgres@localhost:${port}/${TEST_DB_NAME}`,
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

function assertDockerRunning(): void {
  try {
    execSync("docker info", { stdio: "ignore" });
  } catch {
    throw new Error(
      "Docker daemon is not running. Start Docker (or OrbStack) and retry.",
    );
  }
}

// Shell-string form below (with `2>/dev/null; true` and `${container}` interp)
// is POSIX and works on /bin/sh across macOS / Linux CI. It does NOT work on
// Windows (cmd.exe). `container` is always an md5-derived hex identifier — no
// injection surface. If Windows support is ever added, convert to execFileSync.
export function setupTestDatabase(suite: TestSuite): void {
  assertDockerRunning();
  const {
    TEST_PORT,
    TEST_CONTAINER,
    TEST_DB_NAME: dbName,
    TEST_DATABASE_URL,
  } = testDbEnv(suite);
  const composeEnv = {
    ...process.env,
    TEST_PORT: String(TEST_PORT),
    TEST_CONTAINER,
    TEST_DB_NAME: dbName,
  };
  const prismaCwd = path.join(PROJECT_ROOT, "packages/db");
  const pushEnv = {
    ...process.env,
    DATABASE_URL: TEST_DATABASE_URL,
    // Set on both paths: harmless without --force-reset, and prevents the
    // cold path from hanging on an interactive prompt if someone later
    // changes it to force-reset in a non-TTY context.
    PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION: "yes",
  };

  if (isContainerHealthy(TEST_CONTAINER)) {
    try {
      execSync("pnpm exec prisma db push --force-reset --skip-generate", {
        cwd: prismaCwd,
        stdio: "inherit",
        env: pushEnv,
      });
      return;
    } catch {
      // Container died between health check and push (e.g. laptop sleep).
      // Fall through to cold boot — the next run auto-recovers.
    }
  }

  // `-p` scopes the compose project to this suite. Without it, both suites
  // share the compose yaml's top-level `name:` (`agentic-web-stack-test`), so
  // `down -v` from one suite tears down the sibling's container as a side
  // effect. Per-suite project names isolate teardown. Container names are
  // already per-suite via TEST_CONTAINER, so no collision risk.
  const composeProject = `agentic-web-stack-${suite}`;
  const composeBase = `docker compose -p ${composeProject} -f docker-compose.test.yml`;
  // `|| true` preserves stderr on genuine compose failures (bad yaml, bad
  // env) while still tolerating the common "nothing to tear down" case.
  // Previous `2>/dev/null; true` form swallowed both.
  execSync(`${composeBase} down -v || true`, {
    cwd: PROJECT_ROOT,
    stdio: "inherit",
    env: composeEnv,
  });
  execSync(`${composeBase} up -d --wait`, {
    cwd: PROJECT_ROOT,
    stdio: "inherit",
    env: composeEnv,
  });
  execSync("pnpm exec prisma db push --skip-generate", {
    cwd: prismaCwd,
    stdio: "inherit",
    env: pushEnv,
  });
}
