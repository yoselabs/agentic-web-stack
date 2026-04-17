# Shared Test Database Setup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract test-DB boot logic into a shared `scripts/test-db.ts` module, migrate e2e to consume it, and wire it into vitest so `make test-unit` auto-provisions an isolated Postgres container (matching e2e's worktree-safe pattern) instead of depending on the dev DB.

**Architecture:** One shared module at repo-root `scripts/`, consumed by e2e's existing globalSetup and by a new vitest globalSetup in `packages/api`. Two separate containers per project root — `agentic-postgres-e2e-<hash>` on port `5400+offset`, `agentic-postgres-unit-<hash>` on port `5500+offset` — so the suites never stomp each other. Hash is derived from project root directory (worktree-safe).

**Tech Stack:** TypeScript (ESM, `.ts` imports via Node 22 / tsx), vitest 4, Prisma (db push, not migrations), Docker Compose, existing `docker-compose.test.yml`.

**Spec:** `docs/superpowers/specs/2026-04-17-test-db-shared-setup-design.md`

---

## Task 1: Create pure `testDbEnv()` in `scripts/test-db.ts`

This task lands only the deterministic, IO-free part: types, `PROJECT_ROOT`, and `testDbEnv()`. The `setupTestDatabase()` IO function comes in Task 2. Splitting makes Task 1 trivially reviewable.

**Files:**
- Create: `scripts/test-db.ts`

- [ ] **Step 1: Confirm the file does not yet exist**

Run:
```bash
ls scripts/test-db.ts 2>&1
```

Expected: `ls: scripts/test-db.ts: No such file or directory`

- [ ] **Step 2: Create `scripts/test-db.ts` with pure helpers only**

Write this exact content:

```ts
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
```

- [ ] **Step 3: Smoke-verify the pure function**

Run:
```bash
pnpm exec tsx -e "import('./scripts/test-db.ts').then(m => { console.log('e2e:', m.testDbEnv('e2e')); console.log('unit:', m.testDbEnv('unit')); })"
```

Expected: two JSON-ish objects printed. Verify:
- `e2e.TEST_PORT` is in range `5400..5499`
- `unit.TEST_PORT` is in range `5500..5599`
- `e2e.TEST_CONTAINER` starts with `agentic-postgres-e2e-`
- `unit.TEST_CONTAINER` starts with `agentic-postgres-unit-`
- `PROJECT_ROOT` equals the repo root path
- Ports for e2e and unit differ by exactly 100

- [ ] **Step 4: Verify determinism**

Run the same command a second time:
```bash
pnpm exec tsx -e "import('./scripts/test-db.ts').then(m => { console.log('e2e:', m.testDbEnv('e2e')); console.log('unit:', m.testDbEnv('unit')); })"
```

Expected: identical output to step 3 (same port, same hash). If not, the hash derivation is non-deterministic — stop and fix.

- [ ] **Step 5: Run lint**

Run:
```bash
make lint
```

Expected: `13 passed, 0 failed` + `tsc -b` clean. If tsc can't resolve `scripts/test-db.ts` because it's outside any `tsconfig.json` include glob, ignore — this file is run via `tsx`, not `tsc`. Only fix if there's an actual error message referencing the file.

- [ ] **Step 6: Commit**

Run:
```bash
git add scripts/test-db.ts
git commit -m "feat(scripts): add pure testDbEnv() helper for test DB isolation"
```

Expected: commit succeeds, pre-commit hooks green.

---

## Task 2: Add `setupTestDatabase()` to `scripts/test-db.ts`

Appends the IO-heavy function (docker compose + prisma db push) without wiring it to any caller yet. Verification is deferred to Tasks 3 and 4, where the function actually runs.

**Files:**
- Modify: `scripts/test-db.ts` (append)

- [ ] **Step 1: Append `isContainerHealthy` and `setupTestDatabase`**

Add these to the end of `scripts/test-db.ts` (below the existing `testDbEnv` function):

```ts
import { execSync } from "node:child_process";

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
```

Move the new `import { execSync } from "node:child_process";` to the top of the file with the other imports — the final import block should be:

```ts
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
```

- [ ] **Step 2: Verify the module still parses**

Run:
```bash
pnpm exec tsx -e "import('./scripts/test-db.ts').then(m => console.log('exports:', Object.keys(m)))"
```

Expected output includes all four exports:
```
exports: [ 'PROJECT_ROOT', 'testDbEnv', 'setupTestDatabase' ]
```
(`TestSuite` is a type-only export so it won't appear.)

- [ ] **Step 3: Run lint**

Run:
```bash
make lint
```

Expected: `13 passed, 0 failed` + `tsc -b` clean.

- [ ] **Step 4: Commit**

```bash
git add scripts/test-db.ts
git commit -m "feat(scripts): add setupTestDatabase() for docker+prisma boot"
```

Expected: commit succeeds, pre-commit hooks green.

---

## Task 3: Migrate e2e to the shared module

Rewrite `e2e/test-env.ts` and `e2e/global-setup.ts` to consume the shared module. Container name changes from `agentic-postgres-test-<hash>` to `agentic-postgres-e2e-<hash>`; port range stays the same (5400+). Verify e2e still passes end-to-end.

**Files:**
- Modify: `e2e/test-env.ts` (full rewrite)
- Modify: `e2e/global-setup.ts` (full rewrite)

- [ ] **Step 1: Kill any legacy e2e container**

Run:
```bash
docker rm -f $(docker ps -aq --filter "name=agentic-postgres-test-") 2>/dev/null || true
```

Expected: either container IDs removed, or silent exit if none exist. This prevents name collisions with the new `-e2e-` naming.

- [ ] **Step 2: Rewrite `e2e/test-env.ts` as a thin facade**

Replace the full file contents with:

```ts
import { testDbEnv } from "../scripts/test-db.ts";

const env = testDbEnv("e2e");
export const TEST_PORT = env.TEST_PORT;
export const TEST_CONTAINER = env.TEST_CONTAINER;
export const TEST_DATABASE_URL = env.TEST_DATABASE_URL;
export const PROJECT_ROOT = env.PROJECT_ROOT;
```

- [ ] **Step 3: Rewrite `e2e/global-setup.ts`**

Replace the full file contents with:

```ts
import { setupTestDatabase } from "../scripts/test-db.ts";

export default async function globalSetup() {
  await setupTestDatabase("e2e");
}
```

- [ ] **Step 4: Verify downstream consumers still compile**

Run:
```bash
make lint
```

Expected: `13 passed, 0 failed` + `tsc -b` clean. `e2e/db-reset.setup.ts` and `e2e/playwright.config.ts` already consume `TEST_DATABASE_URL` by name — the facade preserves those exports so they should type-check unchanged.

If tsc complains about `Cannot find module '../scripts/test-db.ts'`, check whether `e2e/tsconfig.json` has a restrictive `rootDir` or `include`. Fix by adding `"../scripts/test-db.ts"` to the `include` array. Do NOT add a new `tsconfig.json` to `scripts/` — the file is meant to be consumed by multiple workspaces.

- [ ] **Step 5: Cold-start e2e against the new container name**

Run:
```bash
make test
```

Expected:
- docker compose creates a new `agentic-postgres-e2e-<hash>` container (visible via `docker ps`)
- Schema pushed via `prisma db push`
- Playwright BDD tests run and pass

If tests fail for unrelated reasons (existing flake), investigate whether the failure predates this change — check `git stash && make test` to confirm.

- [ ] **Step 6: Warm-start to verify reuse**

Run:
```bash
make test
```
again.

Expected:
- `isContainerHealthy` returns true
- `db push --force-reset` runs (not a new compose up)
- BDD tests pass
- `docker ps` still shows the single `agentic-postgres-e2e-<hash>` container

- [ ] **Step 7: Commit**

```bash
git add e2e/test-env.ts e2e/global-setup.ts
git commit -m "refactor(e2e): use shared setupTestDatabase from scripts/test-db"
```

Expected: commit succeeds. Pre-commit hooks green.

---

## Task 4: Wire up vitest for `@project/api` unit tests

Modify the existing `packages/api/vitest.config.ts` (preserving `testTimeout: 15_000` and `exclude`) to set `DATABASE_URL` and register a globalSetup. Create `packages/api/test-setup.ts`. Verify unit tests pass against the new isolated unit container.

**Files:**
- Modify: `packages/api/vitest.config.ts`
- Create: `packages/api/test-setup.ts`

- [ ] **Step 1: Read current `vitest.config.ts` to confirm starting state**

Run:
```bash
cat packages/api/vitest.config.ts
```

Expected — current content:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 15_000,
    exclude: ["dist/**", "node_modules/**"],
  },
});
```

If the content differs, adapt Step 2 to preserve whatever is there.

- [ ] **Step 2: Replace `packages/api/vitest.config.ts` with the full new version**

Replace the full file contents with:

```ts
import path from "node:path";
import { defineConfig } from "vitest/config";
import { testDbEnv } from "../../scripts/test-db.ts";

const env = testDbEnv("unit");

process.env.DATABASE_URL = env.TEST_DATABASE_URL;

export default defineConfig({
  test: {
    testTimeout: 15_000,
    exclude: ["dist/**", "node_modules/**"],
    env: { DATABASE_URL: env.TEST_DATABASE_URL },
    pool: "forks",
    globalSetup: [path.resolve(import.meta.dirname, "test-setup.ts")],
  },
});
```

- [ ] **Step 3: Create `packages/api/test-setup.ts`**

Write this exact content:

```ts
import { setupTestDatabase } from "../../scripts/test-db.ts";

export async function setup() {
  await setupTestDatabase("unit");
}
```

- [ ] **Step 4: Verify no `@project/db` import leaks into the config graph**

Run:
```bash
grep -rE "@project/db|packages/db" packages/api/vitest.config.ts packages/api/test-setup.ts scripts/test-db.ts
```

Expected: **no output** (no matches). If anything matches, the config-time instantiation of Prisma will race the `DATABASE_URL` assignment. Stop and fix before proceeding.

- [ ] **Step 5: Ensure dev DB is down (optional sanity check)**

Run:
```bash
docker compose down 2>&1 | tail -3
```

Expected: dev container `agentic-postgres` removed or already absent. This proves the next step does NOT fall back to the dev DB — if unit tests pass with the dev DB down, isolation is real.

- [ ] **Step 6: Cold-start `make test-unit`**

Run:
```bash
make test-unit
```

Expected:
- `setupTestDatabase("unit")` runs: docker compose up a new container named `agentic-postgres-unit-<hash>` on port `5500+offset`
- Schema pushed via `prisma db push --skip-generate`
- 27/27 tests pass (`Test Files  4 passed (4)`, `Tests  27 passed (27)`)

If tests fail with "Can't reach database server", the container didn't start or `DATABASE_URL` didn't propagate — inspect with `docker ps` and `echo $DATABASE_URL` inside a test temporarily.

- [ ] **Step 7: Verify the unit container is running**

Run:
```bash
docker ps --filter "name=agentic-postgres-unit-" --format "{{.Names}} {{.Status}} {{.Ports}}"
```

Expected: one line showing `agentic-postgres-unit-<hash> Up ... (healthy) 0.0.0.0:55XX->5432/tcp`.

- [ ] **Step 8: Verify `DATABASE_URL` isolation at runtime (testing-plan step 3)**

Temporarily add a console.log to prove the URL that reaches workers:

Edit `packages/api/src/services/__tests__/todo.test.ts` — at the very top, above imports, add:
```ts
console.log("[isolation-check] DATABASE_URL=", process.env.DATABASE_URL);
```

Run:
```bash
make test-unit 2>&1 | grep isolation-check
```

Expected output line:
```
[isolation-check] DATABASE_URL= postgresql://postgres:postgres@localhost:55XX/agentic_web_stack_test
```
where `55XX` is in 5500..5599 (unit port range) and the DB name is `agentic_web_stack_test` (not `agentic_web_stack`). If the URL shows port 5432 or DB `agentic_web_stack`, isolation has failed.

Remove the console.log:
```bash
git checkout packages/api/src/services/__tests__/todo.test.ts
```

- [ ] **Step 9: Warm-start `make test-unit`**

Run:
```bash
make test-unit
```

Expected: this time, `isContainerHealthy` returns true → only `prisma db push --force-reset` runs (no compose up). All 27 tests pass. Notably faster than Step 6.

- [ ] **Step 10: Run full lint**

Run:
```bash
make lint
```

Expected: `13 passed, 0 failed` + `tsc -b` clean.

- [ ] **Step 11: Commit**

```bash
git add packages/api/vitest.config.ts packages/api/test-setup.ts
git commit -m "feat(api): isolate vitest to dedicated unit test Postgres container"
```

Expected: commit succeeds, pre-commit hooks green.

---

## Task 5: Update Makefile

Fix stale comments and broaden `clean` to cover both suite containers plus legacy `-test-` leftovers.

**Files:**
- Modify: `Makefile`

- [ ] **Step 1: Update the `test-unit` target comment**

Replace line 47 in `Makefile`:

Old:
```makefile
# Unit / integration tests (vitest, uses dev database on port 5432)
```

New:
```makefile
# Unit / integration tests (vitest, uses isolated unit-suite Postgres, dynamic port per worktree — see scripts/test-db.ts)
```

- [ ] **Step 2: Update the `test` (BDD) target comment**

Replace line 51 in `Makefile`:

Old:
```makefile
# BDD Tests (uses separate test database on port 5433)
```

New:
```makefile
# BDD Tests (uses separate test database, dynamic port per suite — see scripts/test-db.ts)
```

- [ ] **Step 3: Update the `clean` target**

Find the current `clean` target (around line 60):

```makefile
clean:
	docker compose down -v
	rm -rf node_modules apps/*/node_modules packages/*/node_modules
	rm -rf apps/web/.output apps/web/dist apps/server/dist
```

Replace with:

```makefile
clean:
	docker compose down -v
	@ids=$$(docker ps -aq --filter "name=agentic-postgres-test-" --filter "name=agentic-postgres-e2e-" --filter "name=agentic-postgres-unit-"); \
	  [ -n "$$ids" ] && docker rm -f $$ids || true
	rm -rf node_modules apps/*/node_modules packages/*/node_modules
	rm -rf apps/web/.output apps/web/dist apps/server/dist
```

Note the `@` prefix silences Make's command echo for the docker block; `$$` is how Make escapes `$` for the shell. The guarded form avoids `docker rm -f` being called with no arguments when no matching containers exist.

- [ ] **Step 4: Sanity check `make clean` runs without error**

First verify the updated target with a dry run — don't actually clean, just check Make parses it:
```bash
make -n clean
```

Expected: Make prints the commands it would run, no parse errors.

- [ ] **Step 5: Run lint**

```bash
make lint
```

Expected: `13 passed, 0 failed`.

- [ ] **Step 6: Commit**

```bash
git add Makefile
git commit -m "chore(make): isolate test containers, fix stale port comments"
```

Expected: commit succeeds, pre-commit hooks green.

---

## Task 6: End-to-end verification (testing plan)

Manual verification of every scenario in the spec's testing plan. No code changes here — if any step fails, diagnose and fix in a follow-up commit on the appropriate component.

**Files:** none (verification only)

- [ ] **Step 1: Full clean**

```bash
make clean 2>&1 | tail -5
```

Expected: dev compose stack down, any `agentic-postgres-*` containers force-removed.

- [ ] **Step 2: Confirm no test containers remain**

```bash
docker ps -a --filter "name=agentic-postgres-" --format "{{.Names}}"
```

Expected: empty output (no containers).

- [ ] **Step 3: Reinstall pnpm deps removed by `make clean`**

```bash
pnpm install
```

Expected: dependencies restored.

- [ ] **Step 4: Unit cold start**

```bash
make test-unit
```

Expected: container boot + schema push, 27/27 green.

- [ ] **Step 5: Unit warm start**

```bash
make test-unit
```

Expected: fast re-use (force-reset only), 27/27 green.

- [ ] **Step 6: Verify both suite containers**

```bash
docker ps --filter "name=agentic-postgres-" --format "{{.Names}} {{.Status}}"
```

Expected at this point: one `agentic-postgres-unit-<hash>` container, healthy. (E2e not yet run in this verification pass.)

- [ ] **Step 7: E2E cold + warm**

```bash
make test
make test
```

Expected: both runs pass. After this, `docker ps` should show BOTH `-unit-` and `-e2e-` containers healthy:

```bash
docker ps --filter "name=agentic-postgres-" --format "{{.Names}} {{.Status}}"
```

Expected: two lines, both healthy.

- [ ] **Step 8: Parallel run (cross-talk check)**

In one terminal:
```bash
make test-unit
```
In another terminal, simultaneously:
```bash
make test
```

Expected: both complete successfully. No errors about port conflicts, container name collisions, or force-reset touching unrelated data.

- [ ] **Step 9: Schema-change propagation**

Add a throwaway column to `packages/db/prisma/schema.prisma`. Find the `Todo` model and add one line:

```prisma
model Todo {
  // ... existing fields ...
  planVerificationColumn String?
}
```

Run:
```bash
make test-unit
```

Expected: force-reset picks up the schema change automatically. 27/27 pass (the new column is nullable, doesn't break existing tests).

Revert the schema change:
```bash
git checkout packages/db/prisma/schema.prisma
```

- [ ] **Step 10: Final clean**

```bash
make clean
pnpm install
docker ps -a --filter "name=agentic-postgres-" --format "{{.Names}}"
```

Expected: last command prints empty output. No orphan containers.

- [ ] **Step 11: No commit (verification only)**

This task produces no artifacts. If any step failed, open a fixup task in a new branch / commit for the specific component.

---

## Self-Review Notes

**Spec coverage check:**

| Spec section | Implemented in |
|---|---|
| Component 1: `scripts/test-db.ts` pure function | Task 1 |
| Component 1: `scripts/test-db.ts` IO function | Task 2 |
| Component 2: e2e consumers | Task 3 |
| Component 3: vitest wiring | Task 4 |
| Component 4: Makefile | Task 5 |
| Testing plan steps 1-11 | Task 6 (plus intra-task verifications in Tasks 3, 4) |
| Rollback plan | N/A — implicit in commit-per-task structure (revert individual commits) |

**Ordering rationale:** Shared module before consumers (can't import what doesn't exist). E2e before unit so the first migration happens against a suite that already had a working setup; if anything breaks, blast radius is the e2e suite only. Makefile last because `clean` references container names introduced by Tasks 3-4. Task 6 is pure verification and doesn't change code.

**Commit structure:** Six targeted commits. Each is independently revertable via `git revert <sha>`, per spec's rollback section.