# packages/test-infra — Test Infrastructure

Single source of truth for test-time values: dynamic ports, container
names, the DB URL, auth/CORS env vars, process-role env vars. Consumed by
`scripts/dev/kill-ports.ts`, `packages/api/scripts/test-runner.ts`,
`e2e/global-setup.ts`, `e2e/test-env.ts`, and `e2e/playwright.config.ts`.

Never imported by application code (`apps/*`, `packages/api` services,
`packages/auth`). This package uses `node:child_process` and shells out
to `docker compose` — it is Node-only test tooling, not runtime code.

## What lives here

- **`PROFILES`** — port bases per suite (`e2e`, `unit`), per port role
  (`db`, `web`, `api`, future `redis`). Bases spaced ≥100 so the
  modulo-100 hash offset never produces overlapping ranges across
  services, suites, or worktrees.
- **`CONTAINER_SERVICES`** — map a PROFILES port key to the env var an
  app process expects (`db` → `DATABASE_URL`) + the URL template. Drives
  `envForSubprocess()` automatically; adding a container service = one
  entry here + one column per suite in `PROFILES`.
- **`testDbEnv(suite)`** — returns the full set of derived values
  (`TEST_PORT`, `TEST_WEB_PORT`, `TEST_API_PORT`, `TEST_WEB_URL`,
  `TEST_API_URL`, `TEST_CONTAINER`, `TEST_DATABASE_URL`, `PROJECT_ROOT`).
  Used for Playwright config, compose env substitution, and diagnostic
  lookups.
- **`envForSubprocess(suite, role?)`** — returns the env var object every
  spawned subprocess needs:
  - Container URLs (DATABASE_URL + future REDIS_URL) from
    `CONTAINER_SERVICES`.
  - Auth + CORS (BETTER_AUTH_URL, CORS_ORIGIN, BETTER_AUTH_SECRET)
    derived from the suite's web/api ports.
  - Role-specific PORT (+ VITE_API_URL for `role === "web"`).
  Callers spread AFTER `process.env` so test-infra wins over ambient
  shell env.
- **`setupTestDatabase(suite)`** — boots the Postgres container for the
  suite via `docker-compose.test.yml`, runs `prisma db push`. Handles the
  warm/cold paths (healthy container reuses; otherwise full compose
  down/up).

## Adding a new container service (e.g. Redis)

This is a multi-file change the integrity audit
(`scripts/checks/check-test-infra-integrity.ts`) backs up. Touch points:

1. **`src/index.ts`:**
   - Add `redis: 6300` to `PROFILES.e2e`, `redis: 6400` to `PROFILES.unit`.
   - Add an entry to `CONTAINER_SERVICES`:
     ```ts
     redis: {
       envVar: "REDIS_URL",
       url: (port: number) => `redis://localhost:${port}`,
     },
     ```
2. **`docker-compose.test.yml`** — add a Redis service block parameterized
   on `TEST_REDIS_PORT` / `TEST_REDIS_CONTAINER`.
3. **`packages/env/src/server.ts`** — add `REDIS_URL` to the Zod schema
   (matching the envVar declared in step 1).
4. **`docker-compose.dev.yml` + `docker-compose.yml`** — add Redis for
   dev + demo-mode (fixed port 6379). These aren't covered by the audit
   script but `make dev` and `docker compose up` will fail loudly if
   missing.
5. **App code** — wire the Redis client (BullMQ queue init, etc.).

The integrity audit runs in `make lint` and fails if step 1's
`CONTAINER_SERVICES` entry has no matching compose block in step 2 or no
matching Zod schema entry in step 3. Miss either and lint catches it
before commit. Zod validation catches step-5-time misses at module load
(loud, not silent).

## Why this package is separate from `@project/env`

They look related (both touch env vars) but diverge architecturally:

- `@project/env` runs in every app process (web, server, scripts). It's
  client-safe via the `/client` subpath.
- `@project/test-infra` runs only at test setup. Uses `node:child_process`,
  shells out to Docker. Would break any client bundle.

The packages stay separate so the package boundary itself communicates
"don't import this from app code." The integrity audit bridges them
without merging them — that's the right tradeoff.

## Do Not

- Import this package from `apps/*`, `packages/api`, `packages/auth`, or
  any other runtime code. Node-only.
- Use `@project/test-infra/<anything>` subpath imports — the package
  exposes only the bare `.` entry.
- Edit `PROFILES` or `CONTAINER_SERVICES` without also updating the
  compose files + Zod schema. The integrity audit will stop the commit
  if you forget, but don't lean on it as a substitute for the mental
  model.
