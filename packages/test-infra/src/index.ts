// Test infrastructure: deterministic port/container derivation per worktree,
// Docker Postgres lifecycle, Prisma schema push. Consumed by:
// - scripts/kill-ports.ts (derives ports to kill before a test run)
// - packages/api/scripts/test-runner.ts (boots unit suite DB + runs bun test)
// - e2e/global-setup.ts (boots e2e suite DB before Playwright)
// - e2e/test-env.ts (re-exports named fields for Playwright config)

import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";

// Standardized DB name for dev + test (different containers, different ports).
// Pinned to "app" per design §D2 — docker-compose.test.yml also hardcodes this;
// TEST_DATABASE_URL below is the single derived consumer.
// See docs/superpowers/specs/2026-04-18-zero-conf-architecture-design.md §D2.
const TEST_DB_NAME = "app";

export type TestSuite = "e2e" | "unit";

// Walk up the directory tree looking for pnpm-workspace.yaml. Robust to the
// module's filesystem location: works whether this lives at scripts/test-db.ts
// or packages/test-infra/src/index.ts. Evaluated once at module load.
function findProjectRoot(): string {
  let dir = import.meta.dirname;
  while (dir !== path.parse(dir).root) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error(
    "test-infra: could not find pnpm-workspace.yaml in any parent directory",
  );
}

export const PROJECT_ROOT = findProjectRoot();

// Port bases per suite, per service. Bases are spaced by ≥100 so the
// modulo-100 offset below can never produce overlapping ranges — not
// across services within one suite, not across suites, not across
// worktrees on the same host. Adding a service = one column per suite.
// Example for future Redis: `redis: 6300` (e2e) / `redis: 6400` (unit).
const PROFILES = {
  e2e: { db: 5400, web: 3100, api: 3200 },
  unit: { db: 5500, web: 3300, api: 3400 },
} as const satisfies Record<TestSuite, Record<string, number>>;

// Container-backed services: map a PROFILES port key to the env var an
// app process expects, and how to format the connection URL. Process-only
// ports (web, api) are NOT listed here — they're not container-backed
// and don't emit env vars for downstream apps.
//
// Adding a new container service = one entry here + one column in PROFILES
// above + compose blocks + Zod schema entry in @project/env/server. The
// `scripts/check-test-infra-integrity.ts` audit cross-checks all three.
export const CONTAINER_SERVICES = {
  db: {
    envVar: "DATABASE_URL",
    url: (port: number) =>
      `postgresql://postgres:postgres@localhost:${port}/${TEST_DB_NAME}`,
  },
  // Example for future Redis:
  // redis: {
  //   envVar: "REDIS_URL",
  //   url: (port: number) => `redis://localhost:${port}`,
  // },
} as const satisfies Record<
  string,
  { envVar: string; url: (p: number) => string }
>;

// Returns the env vars every subprocess spawned by test-runner.ts or
// playwright.config.ts must receive. Add a service to CONTAINER_SERVICES
// above and every subprocess consumer picks it up automatically — no need
// to edit test-runner.ts and playwright.config.ts separately.
export function envForSubprocess(suite: TestSuite): Record<string, string> {
  const hash = createHash("md5").update(PROJECT_ROOT).digest("hex");
  const portOffset = Number.parseInt(hash.slice(0, 4), 16) % 100;
  const profile = PROFILES[suite] as Record<string, number>;
  const out: Record<string, string> = {};
  for (const [svc, cfg] of Object.entries(CONTAINER_SERVICES)) {
    const base = profile[svc];
    if (base === undefined) {
      throw new Error(
        `test-infra: CONTAINER_SERVICES has "${svc}" but PROFILES[${suite}] does not`,
      );
    }
    out[cfg.envVar] = cfg.url(base + portOffset);
  }
  return out;
}

export function testDbEnv(suite: TestSuite) {
  const hash = createHash("md5").update(PROJECT_ROOT).digest("hex");
  const hash8 = hash.slice(0, 8);
  // 100-slot modulo → birthday-paradox collision between worktrees becomes
  // likely past ~12 checkouts of this repo on one host. Container names
  // (hash8) don't collide, but the host port bind will — docker fails loudly
  // with "port already allocated", which is acceptable and rare in practice.
  const portOffset = Number.parseInt(hash.slice(0, 4), 16) % 100;
  const profile = PROFILES[suite];
  const port = profile.db + portOffset;
  const webPort = profile.web + portOffset;
  const apiPort = profile.api + portOffset;
  const container = `agentic-postgres-${suite}-${hash8}`;
  return {
    TEST_PORT: port,
    TEST_WEB_PORT: webPort,
    TEST_API_PORT: apiPort,
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
  const { TEST_PORT, TEST_CONTAINER, TEST_DATABASE_URL } = testDbEnv(suite);
  const composeEnv = {
    ...process.env,
    TEST_PORT: String(TEST_PORT),
    TEST_CONTAINER,
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
