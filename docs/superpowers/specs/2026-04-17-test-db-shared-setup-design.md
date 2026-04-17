# Shared Test Database Setup — Design Spec

## Summary

Extract the hash-derived test-DB boot logic currently in `e2e/` into a shared module at `scripts/test-db.ts`. Reuse it for vitest (unit/integration tests in `packages/api`) so `make test-unit` auto-provisions a hermetic Postgres container instead of relying on the dev DB. Isolate e2e and unit suites into separate containers so they can run in parallel.

## Motivation

Four problems today:

1. **`make test-unit` silently depends on the dev DB (port 5432).** If the dev container isn't running, vitest fails with `Can't reach database server`. The failure is discovered late.
2. **Tests share state with dev.** Running `make test-unit` mutates whatever's in the dev DB, and anything left in dev (stale users, partial schemas) affects tests.
3. **Force-reset races.** If `make test` and `make test-unit` ever run in parallel (dev or CI), the e2e global-setup force-resets a container that unit tests may be mid-transaction on.
4. **Destructive risk against dev DB.** As soon as unit tests gain their own `db push --force-reset` (which they need for schema-change tolerance), a misconfigured `DATABASE_URL` in a worker env would nuke developer data. Isolating unit tests to their own container is the only safe way to introduce force-reset into the unit suite.

The e2e suite already solves the isolation problem cleanly — hash-derived port, hash-derived container name, tmpfs, worktree-safe. We want the same guarantees for unit tests without duplicating the logic.

## Non-goals

- No Prisma migrations — this project uses `prisma db push`. The force-reset flow below assumes `schema.prisma` is the source of truth.
- No teardown on vitest exit — containers persist between runs for speed (matches current e2e behavior).
- No consolidation of root `scripts/` into a workspace package. `test-db.ts` lives alongside `kill-ports.ts`, `generate-routes.ts`, `seed.ts` at the repo root.
- No change to per-test isolation strategy. Existing service tests create their own unique users/lists and clean up in `afterAll`; this spec only changes *which* DB hosts them (from dev → isolated unit container). Cross-test hygiene remains the responsibility of the tests themselves, reinforced by the run-level `db push --force-reset`.

## Architecture

```
scripts/test-db.ts               ← shared: testDbEnv(suite), setupTestDatabase(suite)
├── e2e/test-env.ts              ← re-exports testDbEnv("e2e")
├── e2e/global-setup.ts          ← calls setupTestDatabase("e2e")
└── packages/api/
    ├── vitest.config.ts         ← new: sets DATABASE_URL, registers globalSetup
    └── test-setup.ts            ← new: calls setupTestDatabase("unit")

docker-compose.test.yml          ← unchanged; already parametrised (see below)
```

**`docker-compose.test.yml` is already parametrised** — no edit required:

```yaml
# existing file, lines 6 and 12
container_name: ${TEST_CONTAINER:-agentic-postgres-test}
ports: ["${TEST_PORT:-5433}:5432"]
```

`setupTestDatabase()` passes `TEST_PORT` and `TEST_CONTAINER` through `execSync`'s `env` when calling `docker compose`, so both suites can drive the same compose file with different values.

Two containers per project root, never shared:

| Suite | Container name | Port range |
|---|---|---|
| e2e  | `agentic-postgres-e2e-<hash8>`  | `5400 + (hash16 % 100)` |
| unit | `agentic-postgres-unit-<hash8>` | `5500 + (hash16 % 100)` |

`<hash8>` is the first 8 chars of `md5(PROJECT_ROOT)`. `hash16` is the first 4 hex chars interpreted as an integer. Both values are deterministic per worktree, so the same worktree always gets the same port/container pair — safe to run `make test` and `make test-unit` sequentially or in parallel, in multiple worktrees simultaneously, without conflicts.

## Component 1: `scripts/test-db.ts`

Single file, Node-only, no deps beyond `node:*`.

```ts
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
  const composeEnv = { ...process.env, TEST_PORT: String(TEST_PORT), TEST_CONTAINER };
  const prismaCwd = path.join(PROJECT_ROOT, "packages/db");

  if (isContainerHealthy(TEST_CONTAINER)) {
    // Warm path: reset schema + wipe data. Fast (tmpfs).
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

  // Cold path: down any stale, bring up fresh, push schema.
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
```

**Schema reset semantics.** Every test run starts with a clean schema applied from `packages/db/prisma/schema.prisma`. Warm-path runs `db push --force-reset` (drops and recreates tables). Cold-path creates a fresh tmpfs container and runs `db push`. Either way, no migration drift, no leftover data from a crashed previous run. `--force-reset` is safe because each suite's test DB is isolated by container/port — it cannot touch the dev DB.

## Component 2: E2E consumers

`e2e/test-env.ts` becomes a thin facade preserving current exports:

```ts
import { testDbEnv } from "../scripts/test-db.ts";

const env = testDbEnv("e2e");
export const TEST_PORT = env.TEST_PORT;
export const TEST_CONTAINER = env.TEST_CONTAINER;
export const TEST_DATABASE_URL = env.TEST_DATABASE_URL;
export const PROJECT_ROOT = env.PROJECT_ROOT;
```

`e2e/global-setup.ts` reduces to:

```ts
import { setupTestDatabase } from "../scripts/test-db.ts";

export default async function globalSetup() {
  await setupTestDatabase("e2e");
}
```

All other e2e files (`db-reset.setup.ts`, `playwright.config.ts`) already consume via `TEST_DATABASE_URL` — no change.

**Breaking change:** the e2e container name changes from `agentic-postgres-test-<hash>` to `agentic-postgres-e2e-<hash>`. Any currently-running container under the old name becomes an orphan after this refactor. Cleanup is a one-time manual `docker rm -f agentic-postgres-test-*`, or `make clean` will pick it up (see Component 4).

## Component 3: Vitest wiring for `@project/api`

One existing file modified, one new file:

**`vitest.config.ts`** (modified — current file has `testTimeout: 15_000` and `exclude`, both must be preserved):

```ts
import path from "node:path";
import { defineConfig } from "vitest/config";
import { testDbEnv } from "../../scripts/test-db.ts";

const env = testDbEnv("unit");

// Set at module scope — vitest's main process and all workers (via inheritance
// when pool="forks") read this BEFORE any test file or globalSetup imports
// @project/db. @project/db's `new PrismaClient()` runs at module load and
// captures DATABASE_URL then.
process.env.DATABASE_URL = env.TEST_DATABASE_URL;

export default defineConfig({
  test: {
    testTimeout: 15_000,                        // preserved from existing config
    exclude: ["dist/**", "node_modules/**"],    // preserved from existing config
    // Belt-and-suspenders: inject into worker env explicitly too.
    env: { DATABASE_URL: env.TEST_DATABASE_URL },
    // Forks snapshot process.env at spawn time — the DATABASE_URL we set above
    // is pinned into every worker. Threads share a live process.env by reference,
    // which would leak any later mutation to sibling workers. Forks is the
    // safer choice for DB-URL isolation.
    pool: "forks",
    globalSetup: [path.resolve(import.meta.dirname, "test-setup.ts")],
  },
});
```

**Rule: `test-setup.ts` must not import `@project/db` (directly or transitively).** If it does, the Prisma client is constructed in the vitest main process using whatever `DATABASE_URL` was set when the config file was evaluated, which races with the assignment above. `test-setup.ts` and `scripts/test-db.ts` are deliberately restricted to `node:*` imports plus `child_process` / `docker` calls — no Prisma, no app code.

**`test-setup.ts`:**

```ts
import { setupTestDatabase } from "../../scripts/test-db.ts";

export async function setup() {
  await setupTestDatabase("unit");
}
```

No `teardown` export — matches e2e's "leave container running for next run" behavior.

## Component 4: Makefile changes

- `test-unit` target: unchanged command (`pnpm --filter @project/api test`) — vitest's globalSetup now handles the container.
- Comment on `test-unit:` target (line 47 in current Makefile): update `"uses dev database on port 5432"` → `"uses isolated unit-suite Postgres, dynamic port per worktree — see scripts/test-db.ts"`.
- Comment on `test:` target (line 51 in current Makefile): update `"port 5433"` → `"dynamic port per suite, see scripts/test-db.ts"`.
- `clean` target: add cleanup of both suite containers and any legacy `-test-` container:

```makefile
clean:
	docker compose down -v
	@ids=$$(docker ps -aq --filter "name=agentic-postgres-test-" --filter "name=agentic-postgres-e2e-" --filter "name=agentic-postgres-unit-"); \
	  [ -n "$$ids" ] && docker rm -f $$ids || true
	rm -rf node_modules apps/*/node_modules packages/*/node_modules
	rm -rf apps/web/.output apps/web/dist apps/server/dist
```

(The guarded form avoids `docker rm -f` being invoked with no arguments when no matching containers exist.)

## Data flow

### `make test-unit`, cold start

```
make test-unit
└── pnpm --filter @project/api test
    └── vitest run
        ├── load vitest.config.ts
        │   └── testDbEnv("unit") → DATABASE_URL set in process.env
        ├── run globalSetup: test-setup.ts::setup()
        │   └── setupTestDatabase("unit")
        │       ├── isContainerHealthy(agentic-postgres-unit-<hash>) → false
        │       ├── docker compose -f docker-compose.test.yml down -v
        │       ├── docker compose -f docker-compose.test.yml up -d --wait
        │       └── prisma db push --skip-generate
        └── spawn workers → @project/db reads DATABASE_URL → tests run
```

### `make test-unit`, warm start

```
make test-unit
└── pnpm --filter @project/api test
    └── vitest run
        ├── load vitest.config.ts (same)
        ├── run globalSetup
        │   └── setupTestDatabase("unit")
        │       ├── isContainerHealthy → true
        │       └── prisma db push --force-reset --skip-generate
        └── spawn workers → tests run
```

### `make test` (e2e)

Unchanged flow, now delegates to `setupTestDatabase("e2e")` instead of inline logic.

### Parallel `make test-unit` + `make test`

Different containers (`agentic-postgres-unit-<h>` vs `agentic-postgres-e2e-<h>`), different ports, different DB URLs. No interaction. Force-reset in one never touches the other.

## Testing plan

1. `make clean` — tear down any pre-existing containers.
2. `docker ps` — verify no `agentic-postgres-*` containers.
3. **Verify `DATABASE_URL` isolation.** Add a temporary `console.log(process.env.DATABASE_URL)` at the top of a single test file; run `make test-unit`; confirm the logged URL matches `agentic_web_stack_test` on the unit port (5500+), not the dev `agentic_web_stack` on 5432. Also grep `packages/api/vitest.config.ts` and `packages/api/test-setup.ts` to confirm neither imports from `@project/db` (direct or transitive). Remove the `console.log` after verifying.
4. `make test-unit` (cold) — expect container boot, schema push, 27/27 tests green.
5. `docker ps` — expect one `agentic-postgres-unit-<hash>` container, healthy.
6. `make test-unit` (warm) — expect fast re-use (`db push --force-reset`), 27/27 green.
7. `make test` (cold) — expect e2e container boot, BDD tests run.
8. `docker ps` — expect both `-unit-` and `-e2e-` containers, healthy.
9. `make test-unit` in one shell + `make test` in another, simultaneously — expect no cross-talk, both green.
10. `make clean` — expect both containers + any legacy `-test-` container removed.
11. Edit `packages/db/prisma/schema.prisma` (add a column), run `make test-unit` — expect force-reset to pick up the schema change without manual intervention.

## Rollback

All changes are additive files (`scripts/test-db.ts`, `packages/api/vitest.config.ts`, `packages/api/test-setup.ts`) or thin replacements of existing files (`e2e/test-env.ts`, `e2e/global-setup.ts`). Revert the three commits (shared module, e2e migration, vitest wiring) to return to current behavior. Orphaned `agentic-postgres-e2e-*`/`-unit-*` containers from the attempt are cleaned by `docker rm -f`.
