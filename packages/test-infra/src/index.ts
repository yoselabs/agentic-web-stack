// Test infrastructure: deterministic port/container derivation per worktree,
// Docker Postgres lifecycle, Prisma schema push. Consumed by:
// - scripts/dev/kill-ports.ts (derives ports to kill before a test run)
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
  e2e: {
    db: 5400,
    web: 3100,
    api: 3200,
    redis: 6300,
    mailpitSmtp: 2500,
    mailpitHttp: 8100,
  },
  unit: {
    db: 5500,
    web: 3300,
    api: 3400,
    redis: 6400,
    mailpitSmtp: 2600,
    mailpitHttp: 8200,
  },
} as const satisfies Record<TestSuite, Record<string, number>>;

// Container-backed services: map a PROFILES port key to the env var an
// app process expects, and how to format the connection URL. Process-only
// ports (web, api) are NOT listed here — they're not container-backed
// and don't emit env vars for downstream apps.
//
// Adding a new container service = one entry here + one column in PROFILES
// above + compose blocks + Zod schema entry in @project/env/server. The
// `scripts/checks/check-test-infra-integrity.ts` audit cross-checks all three.
export const CONTAINER_SERVICES = {
  db: {
    envVar: "DATABASE_URL",
    url: (port: number) =>
      `postgresql://postgres:postgres@localhost:${port}/${TEST_DB_NAME}`,
  },
  redis: {
    envVar: "REDIS_URL",
    url: (port: number) => `redis://localhost:${port}`,
  },
  mailpitSmtp: {
    envVar: "SMTP_URL",
    url: (port: number) => `smtp://localhost:${port}`,
  },
  mailpitHttp: {
    envVar: "MAILPIT_API_URL",
    url: (port: number) => `http://localhost:${port}`,
  },
} as const satisfies Record<
  string,
  { envVar: string; url: (p: number) => string }
>;

// Role-specific env a process needs. Passed as the second arg to
// envForSubprocess; omit when the subprocess doesn't bind a server port
// (e.g. `bun test` in the unit suite).
//
//   "api" → PORT bound to the API suite port
//   "web" → PORT bound to the web suite port + VITE_API_URL for the
//           Vite build that runs inline as part of the web process.
export type ProcessRole = "api" | "web";

// Returns the full env var set every subprocess spawned by test-runner.ts
// or playwright.config.ts must receive. Groups:
//
//  1. Container-service URLs (DATABASE_URL, REDIS_URL, ...) — derived
//     from CONTAINER_SERVICES + PROFILES. Adding a service = one entry
//     in CONTAINER_SERVICES + one column per suite in PROFILES.
//  2. Auth + CORS vars (BETTER_AUTH_URL, CORS_ORIGIN, BETTER_AUTH_SECRET)
//     — derived from the suite's web/api ports. Kept in sync across
//     both test runners; no per-consumer duplication.
//  3. Role-specific vars (PORT, VITE_API_URL) — only included when the
//     role argument identifies an API or web server subprocess.
//
// Callers spread this AFTER process.env so test-infra values win over any
// ambient shell environment (dev DATABASE_URL, etc.):
//
//     env: { ...process.env, ...envForSubprocess("e2e", "api") }
export function envForSubprocess(
  suite: TestSuite,
  role?: ProcessRole,
): Record<string, string> {
  const hash = createHash("md5").update(PROJECT_ROOT).digest("hex");
  const portOffset = Number.parseInt(hash.slice(0, 4), 16) % 100;
  const profile = PROFILES[suite] as Record<string, number>;
  const apiPort = profile.api + portOffset;
  const webPort = profile.web + portOffset;
  const apiUrl = `http://localhost:${apiPort}`;
  const webUrl = `http://localhost:${webPort}`;
  const out: Record<string, string> = {
    BETTER_AUTH_URL: apiUrl,
    // Any 32+ char string works — Better-Auth only needs stability within
    // one test process lifetime. Per-suite value documents the scope in
    // logs and keeps the two suites' sessions naturally unforgeable
    // across each other.
    BETTER_AUTH_SECRET: `test-secret-key-for-${suite}-tests-only-32chars`,
    CORS_ORIGIN: webUrl,
    WEB_URL: webUrl,
    // Signals "this process is running under the test harness" without
    // overloading NODE_ENV (which Vite's SSR build switches jsxDEV imports
    // on — setting NODE_ENV=test breaks the built web bundle used by e2e).
    // Read via `env.IS_TEST` in @project/env/server. See
    // docs/conventions.md "Test-mode detection".
    TEST_MODE: "1",
  };
  for (const [svc, cfg] of Object.entries(CONTAINER_SERVICES)) {
    const base = profile[svc];
    if (base === undefined) {
      throw new Error(
        `test-infra: CONTAINER_SERVICES has "${svc}" but PROFILES[${suite}] does not`,
      );
    }
    out[cfg.envVar] = cfg.url(base + portOffset);
  }
  if (role === "api") {
    out.PORT = String(apiPort);
  } else if (role === "web") {
    out.PORT = String(webPort);
    out.VITE_API_URL = apiUrl;
    // Web container's SSR runtime uses SSR_API_URL (defaults to :3001
    // in @project/env/server). Tests run on dynamic ports, so without
    // this override the SSR auth fetch hits the wrong port, fail-soft
    // in session.ts deletes the cookie, and every scenario lands on
    // /login. Same value as VITE_API_URL here because test web and
    // test api share one host — docker demo is where they differ.
    out.SSR_API_URL = apiUrl;
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
  const redisPort = profile.redis + portOffset;
  const mailpitSmtpPort = profile.mailpitSmtp + portOffset;
  const mailpitHttpPort = profile.mailpitHttp + portOffset;
  const container = `agentic-postgres-${suite}-${hash8}`;
  const redisContainer = `agentic-redis-${suite}-${hash8}`;
  const mailpitContainer = `agentic-mailpit-${suite}-${hash8}`;
  return {
    TEST_PORT: port,
    TEST_WEB_PORT: webPort,
    TEST_API_PORT: apiPort,
    TEST_REDIS_PORT: redisPort,
    TEST_MAILPIT_SMTP_PORT: mailpitSmtpPort,
    TEST_MAILPIT_HTTP_PORT: mailpitHttpPort,
    TEST_WEB_URL: `http://localhost:${webPort}`,
    TEST_API_URL: `http://localhost:${apiPort}`,
    TEST_MAILPIT_API_URL: `http://localhost:${mailpitHttpPort}`,
    TEST_CONTAINER: container,
    TEST_REDIS_CONTAINER: redisContainer,
    TEST_MAILPIT_CONTAINER: mailpitContainer,
    TEST_DB_NAME,
    TEST_DATABASE_URL: `postgresql://postgres:postgres@localhost:${port}/${TEST_DB_NAME}`,
    TEST_REDIS_URL: `redis://localhost:${redisPort}`,
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
  const env = testDbEnv(suite);
  const { TEST_DATABASE_URL } = env;
  // Every var substituted in docker-compose.test.yml must appear here —
  // otherwise `docker compose up` silently expands to the empty string
  // and the container binds the wrong port or dies on a bad name.
  const composeEnv = {
    ...process.env,
    TEST_PORT: String(env.TEST_PORT),
    TEST_CONTAINER: env.TEST_CONTAINER,
    TEST_REDIS_PORT: String(env.TEST_REDIS_PORT),
    TEST_REDIS_CONTAINER: env.TEST_REDIS_CONTAINER,
    TEST_MAILPIT_SMTP_PORT: String(env.TEST_MAILPIT_SMTP_PORT),
    TEST_MAILPIT_HTTP_PORT: String(env.TEST_MAILPIT_HTTP_PORT),
    TEST_MAILPIT_CONTAINER: env.TEST_MAILPIT_CONTAINER,
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

  // Warm path: ALL suite containers must be healthy. If only postgres is up
  // but redis/mailpit are missing (e.g. after a previous run on an older
  // compose file), fall through to cold boot — partial startup would make
  // the tests fail with "connection refused" on the missing service.
  const allHealthy =
    isContainerHealthy(env.TEST_CONTAINER) &&
    isContainerHealthy(env.TEST_REDIS_CONTAINER) &&
    isContainerHealthy(env.TEST_MAILPIT_CONTAINER);
  if (allHealthy) {
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
