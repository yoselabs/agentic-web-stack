# Demo Mode — Design

**Date:** 2026-04-18
**Branch:** `spike/demo-mode`
**Motivated by:** deferred item A from `docs/superpowers/specs/2026-04-11-bun-test-spike-handover.md`
**Related:** also folds in two small cleanups as separate commits — (B) `apps/server` `tsx watch` → `bun --watch`, (C) zero-conf dev compose (literals, no `${DEV_DB_*}`)

**Not folded in (intentionally):** `@project/auth` barrel-to-subpath migration. An earlier iteration of this spec proposed it, but `docs/superpowers/specs/2026-04-18-zero-conf-architecture-handover.md:127-136` explicitly carves `@project/auth` out of the no-barrel rule ("`@project/auth`'s root IS the primary module — it exports the configured `auth` instance and the `Session` type, not re-exports from subpaths"). Reversing that carve-out is a scope outside this spike's remit. The `scripts/seed.ts` edits below keep the existing `import { auth } from "@project/auth"` as-is.

## Goal

An external developer evaluating the template runs:

```bash
git clone <repo>
cd agentic-web-stack
docker compose up
```

— opens `http://localhost:3000`, logs in as a seeded demo user, clicks around a working todo app. No `.env` file, no `make setup`, no prior knowledge of the stack.

## Success criteria

1. Plain `docker compose up` (no flags, no profiles, no env files) boots postgres + migrate + server + web cold on a clean machine.
2. First-boot schema provision runs automatically; server does not start before the schema is ready.
3. Seeded user `demo@example.com` / `TestPassword!123` (from `e2e/fixtures/credentials.ts::SEED_USER`) can sign in immediately.
4. `make dev`, `make setup`, `make test`, `make test-unit`, `make lint` remain unchanged in behavior — dev workflow untouched.
5. `make clean` tears down both demo and dev compose stacks.
6. Rerunning `docker compose up` against the same volume is idempotent (migrate sidecar and seed both no-op if state already exists).

## Non-goals

- Production deployment config (this is a local demo artifact; prod deploys are a separate concern).
- Real Prisma migrations — uses `prisma db push` for demo-mode. `prisma migrate deploy` is a one-word swap when real migrations land.
- Fixing the pre-existing `BETTER_AUTH_SECRET` Zod default issue flagged in the bun-test-spike handover. Demo overrides it explicitly via compose env; the underlying prod-safety issue stays in TODO.
- Seeded todos. The demo user lands in the empty state and creates their first todo — that IS the first-run UX.

## Architecture

### Compose file layout (two files)

| File | Purpose | Invoked by |
|---|---|---|
| `docker-compose.yml` | Demo: postgres + migrate + server + web | Plain `docker compose up` (the external-dev story) |
| `docker-compose.dev.yml` | Dev infra only: postgres | `make setup`, `make db`, `make clean` explicitly pass `-f docker-compose.dev.yml` |

Rationale: external devs expect `docker compose up` to "just work" with no flags. The root compose file is the first-impression artifact, so it IS the demo. Dev infra moves to a dedicated file with an explicit `-f` flag in the Makefile — a minor ergonomic cost paid by the team, not by evaluators.

**`docker-compose.dev.yml` uses literal values, not `${DEV_DB_*}` interpolation.** Today's `docker-compose.yml` interpolates `${DEV_DB_NAME}`, `${DEV_DB_USER}`, `${DEV_DB_PASSWORD}`, `${DEV_DB_PORT}` — but those variables aren't defined in any committed `.env.example`, so `make setup` without a manually-crafted `.env` emits `WARN: variable not set` and creates `POSTGRES_DB=""`. That silently breaks the zero-conf promise (root CLAUDE.md: "Zero-conf setup: clone → make setup → make dev. .env file is NOT required"). The spec fixes this by baking literals:

```yaml
# docker-compose.dev.yml (post-spec)
services:
  postgres:
    image: postgres:17
    container_name: agentic-postgres
    environment:
      POSTGRES_DB: app
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    ports:
      - "5432:5432"
    # …healthcheck, volume, restart unchanged
```

This matches the literal-duplication rule in root CLAUDE.md: *"Infra constants (dev ports 3000/3001/5432, DB name `"app"`, user `"postgres"`) → literal in docker-compose.yml, Makefile, .github/workflows/ci.yml, and Zod defaults in `packages/env/src/server.ts`. Not in a shared package."* The spike is the right time to bring this file into compliance.

**`make clean`** tears down both stacks:
```
docker compose down -v
docker compose -f docker-compose.dev.yml down -v
```

### Single `Dockerfile` at repo root (pattern borrowed from `a2sdlc-demo3`)

One `Dockerfile` is reused across all three app services (`migrate`, `server`, `web`) via YAML anchors in compose. Compose builds the image once; each service overrides `command:` only.

**What ships to runtime:** `apps/web/.output` (the Nitro SSR bundle — the only built artifact) + `apps/server/src/**` (bun runs TS directly, no dist) + `packages/*/src/**` (shared TS source — every domain package exports `./src/*.ts` paths) + `node_modules/` (prod-only). Nothing else. Narrow the build accordingly.

Five build stages:

1. **`base`** — `node:24-slim` + `openssl` (Prisma) + `corepack enable && corepack prepare pnpm@10.32.1 --activate` (pin matches root `package.json#packageManager`). Workdir `/app`.
2. **`deps`** — full install (dev dependencies included). Produces the tooling tree used by the build stage (`vite`, `prisma` CLI). Uses `pnpm-workspace.yaml` (includes `e2e/`). Uses `--mount=type=cache,target=/root/.local/share/pnpm/store` so repeat builds reuse pnpm's content-addressable store.
3. **`prod-deps`** — parallel stage, same inputs but `--prod` and `pnpm-workspace.prod.yaml` (excludes `e2e/`, so Playwright + fixtures don't land in the runtime). Same pnpm cache mount. This is the tree the runtime inherits.
4. **`build`** — starts from `deps`, `COPY . .`, restores `pnpm-workspace.prod.yaml` (the full `COPY` clobbered it), then narrowly: `pnpm --filter @project/db generate && pnpm --filter @project/web build`. **Deliberately skips `pnpm -r build`** — `apps/server` has a `tsc` build script but we don't ship its `dist/` (bun runs TS directly); `packages/*` export source; only `apps/web` produces an artifact we actually need. Accepts `ARG VITE_API_URL` → `ENV VITE_API_URL=...` so vite bakes the correct browser-facing API URL into the client bundle before `vite build` runs.
5. **`runtime`** — **fresh `FROM oven/bun:1-slim`** (not an overlay on `node:24-slim`). COPY list:
   - `COPY --from=prod-deps /app /app` — workspace + prod `node_modules` (includes `prisma` CLI binary at `/app/node_modules/.bin/prisma` — see `packages/db` dep change below)
   - `COPY --from=build /app/apps/web/.output /app/apps/web/.output` — Nitro SSR bundle
   - `COPY --from=build --parents /app/./packages/*/src /app` — shared TS source for domain packages
   - `COPY --from=build /app/apps/server/src /app/apps/server/src` — bun runs this directly, no dist
   - `COPY --from=build /app/packages/db/prisma /app/packages/db/prisma` — prisma schema (used by migrate sidecar)
   - `COPY --from=build /app/scripts /app/scripts` — seed script + credentials module (new)
   - `COPY --from=build /app/tsconfig.base.json /app/tsconfig.base.json` — bun needs it for path resolution when running TS from the scripts/ dir
   - Add non-root `app` user, `USER app`. `HEALTHCHECK NONE` at image level — compose services each define their own.

Dockerfile uses `# syntax=docker/dockerfile:1-labs` for `COPY --parents` (preserves workspace layout with glob patterns so new packages don't require Dockerfile edits). Buildx / modern Docker Desktop default to BuildKit; CI environments without BuildKit need `DOCKER_BUILDKIT=1` set.

### `pnpm-workspace.prod.yaml`

New file. Same as `pnpm-workspace.yaml` minus `e2e/*`. Runtime images don't need Playwright or feature files. Keeps the runtime image ~250MB smaller and its security surface narrower.

### `packages/db` dep change: `prisma` → dependencies

Today `packages/db/package.json` has `prisma` in **devDependencies** (only used at build time for `prisma generate`). The demo migrate sidecar needs the `prisma` CLI at runtime to run `prisma db push`. Move it to `dependencies`:

```diff
 "dependencies": {
   "@prisma/client": "catalog:",
+  "prisma": "catalog:",
   "@project/env": "workspace:*"
 },
 "devDependencies": {
   "@types/node": "catalog:",
-  "prisma": "catalog:"
 }
```

After this change, `pnpm install --prod` includes `prisma`, and `/app/node_modules/.bin/prisma` resolves in the runtime image. Pattern matches a2sdlc-demo3 (which uses `/app/node_modules/.pnpm/node_modules/.bin/prisma` directly from its prod tree).

### Compose services

Defined in `docker-compose.yml`. YAML anchors DRY the image tag, build context, and shared env:

```yaml
x-app-env: &app-env
  DATABASE_URL: "postgresql://postgres:postgres@db:5432/app"
  BETTER_AUTH_SECRET: "demo-not-for-production-use-32-chars"
  BETTER_AUTH_URL: "http://localhost:3001"
  CORS_ORIGIN: "http://localhost:3000"
  NODE_ENV: "production"

services:
  db:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: app
    volumes:
      - postgres-demo-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d app"]
      interval: 10s
      timeout: 5s
      retries: 5

  migrate:
    image: &app-image agentic-web-stack:local
    build: &app-build
      context: .
      args:
        VITE_API_URL: http://localhost:3001
    command:
      - "sh"
      - "-c"
      - "cd /app/packages/db && /app/node_modules/.bin/prisma db push --skip-generate && bun /app/scripts/seed.ts"
    environment: { <<: *app-env }
    depends_on:
      db: { condition: service_healthy }

  server:
    image: *app-image
    build: *app-build
    command: ["bun", "/app/apps/server/src/index.ts"]
    environment:
      <<: *app-env
      PORT: "3001"
    ports:
      - "127.0.0.1:3001:3001"
    depends_on:
      migrate: { condition: service_completed_successfully }
    healthcheck:
      test: ["CMD", "bun", "-e", "fetch('http://127.0.0.1:3001/health').then(r => process.exit(r.status < 500 ? 0 : 1)).catch(() => process.exit(1))"]
      interval: 10s
      timeout: 5s
      retries: 3
      start_period: 30s

  web:
    image: *app-image
    build: *app-build
    command: ["bun", "/app/apps/web/.output/server/index.mjs"]
    environment:
      <<: *app-env
      PORT: "3000"
    ports:
      - "127.0.0.1:3000:3000"
    depends_on:
      migrate: { condition: service_completed_successfully }
    healthcheck:
      test: ["CMD", "bun", "-e", "fetch('http://127.0.0.1:3000/').then(r => process.exit(r.status < 500 ? 0 : 1)).catch(() => process.exit(1))"]
      interval: 10s
      timeout: 5s
      retries: 3
      start_period: 30s

volumes:
  postgres-demo-data:
```

Port binds are `127.0.0.1:PORT:PORT` — loopback only. Safer default for a local artifact; doesn't accidentally expose to the network.

Volume is named `postgres-demo-data` (distinct from the dev-compose volume `postgres_data`) so demo and dev state don't interfere. `docker compose down -v` clears it; `docker compose up` then reseeds from scratch.

### Browser vs container URL split (critical)

Five env vars reach the app through different paths — getting this wrong silently breaks sign-in:

| Var | Path | Value | Why |
|---|---|---|---|
| `DATABASE_URL` | server runtime env | `postgresql://postgres:postgres@db:5432/app` | Docker DNS — server resolves `db` to the postgres container |
| `CORS_ORIGIN` | server runtime env | `http://localhost:3000` | Browser sends this as `Origin`; server compares against `trustedOrigins` in `packages/auth/src/index.ts` |
| `BETTER_AUTH_URL` | server runtime env | `http://localhost:3001` | Better-Auth uses this to construct callback/cookie URLs for the browser |
| `VITE_API_URL` | **build-arg, baked into web bundle** | `http://localhost:3001` | Vite inlines `import.meta.env.VITE_API_URL` at build time. Must be the browser's URL, NOT a container DNS name. The web container itself never reads this at runtime — the browser does. |
| `NODE_ENV` | server + web runtime env | `production` | Suppresses dev-only branches (`env.NODE_ENV !== "production"` guards in `packages/db/src/index.ts:18` skip the globalThis singleton cache in prod). No code currently branches on it beyond that; set intentionally so runtime behavior matches a deployed build. |

**Note on seed path:** the seed script (see below) uses Better-Auth's **in-process `auth.api.signUpEmail`**, which bypasses HTTP entirely — so it's not subject to `trustedOrigins` / `CORS_ORIGIN` checks. The seed works even if we ever got `BETTER_AUTH_URL` wrong, because it never hits the wire.

### Seed — reuse `scripts/seed.ts`

The repo already has `scripts/seed.ts` that creates the demo user via `auth.api.signUpEmail` and checks existence first. Wired to `make db-seed`. Reuse it with two small edits:

1. **Drop the 5 sample todos block** (`db.todo.createMany({...})`) — per the design decision that the demo user lands in the empty state. Net reduction: ~30 lines deleted.
2. **Invert the credentials import** (see below). Today `scripts/seed.ts` imports `SEED_USER` from `e2e/fixtures/credentials.ts`. Problem: `e2e/` is excluded from the runtime image (`pnpm-workspace.prod.yaml` and `.dockerignore`), so the sidecar would fail to resolve the import. Fix by inverting direction.

**Credentials stay**: `demo@example.com` / `TestPassword!123`. The complex password is deliberate (the existing fixture comment explains: future-proofs against Better-Auth adding complexity rules). The demo README and seed output both reflect this value — **don't substitute `demodemo`**, that would break the invariant that one credential works across seed + test scenarios.

**Migrate sidecar runs** (note: direct prisma binary, not via pnpm — `pnpm` isn't in the runtime image; see §Image strategy):

```yaml
command:
  - "sh"
  - "-c"
  - "cd /app/packages/db && /app/node_modules/.bin/prisma db push --skip-generate && bun /app/scripts/seed.ts"
```

`scripts/seed.ts` disconnects Prisma in a `.finally()` block and exits cleanly — compatible with sidecar `service_completed_successfully` semantics.

### Credentials module inversion (`scripts/seed-credentials.ts`)

**Today:**
- `e2e/fixtures/credentials.ts` owns `SEED_USER` / `TEST_USER` / `SHARED_PASSWORD`
- `scripts/seed.ts` imports from there via relative path `../e2e/fixtures/credentials.ts`

**Problem:** in the demo runtime image, `e2e/` is excluded — the import fails.

**Fix:** invert direction. The *canonical* values move to a small file under `scripts/` (which IS in the runtime image); e2e re-exports.

1. **New file** `scripts/seed-credentials.ts`:
   ```typescript
   // Canonical demo / test credentials. Used by:
   // - scripts/seed.ts (demo-mode migrate sidecar + `make db-seed`)
   // - e2e/fixtures/credentials.ts (re-exports for test scenarios)
   //
   // Complex password future-proofs e2e against Better-Auth adding
   // upper/lower/digit/symbol rules.
   export const SHARED_PASSWORD = "TestPassword!123";
   export const SEED_USER = {
     email: "demo@example.com",
     password: SHARED_PASSWORD,
   } as const;
   export const TEST_USER = {
     email: "test@example.com",
     password: SHARED_PASSWORD,
   } as const;
   ```

2. **Update `e2e/fixtures/credentials.ts`** to re-export:
   ```typescript
   export { SHARED_PASSWORD, SEED_USER, TEST_USER } from "../../scripts/seed-credentials.ts";
   ```

3. **Update `scripts/seed.ts`** to import from the same-dir local path: `import { SEED_USER } from "./seed-credentials.ts"`.

Nothing breaks in the existing e2e code because `e2e/fixtures/credentials.ts` still exports the same names — it's just a pass-through now. Single source of truth, runtime image has what it needs.

### `.dockerignore`

New file. Excludes at minimum: `node_modules`, `**/node_modules`, `**/.output`, `**/dist`, `**/.features-gen`, `e2e/test-results`, `.git`, `.claude`, `docs`, `README.md` (not needed in image), `.env*`, `TODO.md`.

### Makefile updates

Three existing targets gain `-f docker-compose.dev.yml`:

```makefile
setup:
    # …prereq checks, pnpm install unchanged…
    docker compose -f docker-compose.dev.yml up -d
    @until docker compose -f docker-compose.dev.yml exec -T postgres pg_isready -U postgres > /dev/null 2>&1; do sleep 1; done
    # …db:push, routes, prek install unchanged…

db:
    docker compose -f docker-compose.dev.yml up -d

clean:
    docker compose down -v                                 # demo stack
    docker compose -f docker-compose.dev.yml down -v       # dev postgres
    @ids=$$(docker ps -aq --filter "name=agentic-postgres-test-" --filter "name=agentic-postgres-e2e-" --filter "name=agentic-postgres-unit-"); \
      [ -n "$$ids" ] && docker rm -f $$ids || true        # test suite containers (existing)
    rm -rf node_modules apps/*/node_modules packages/*/node_modules  # existing
    rm -rf apps/web/.output apps/web/dist apps/server/dist           # existing
```

The `rm -rf` lines and the test-container sweep are preserved verbatim from the current `Makefile:82-87`; only the `docker compose down -v` lines are edited (to cover both files).

No new `make demo` target. The whole point is that `docker compose up` works unaided. A `make demo` wrapper would be misleading — it suggests `make` is required.

### README quick-start

Prepend to `README.md` (before any existing content):

```markdown
## Quick start (demo mode)

```bash
git clone https://github.com/.../agentic-web-stack.git
cd agentic-web-stack
docker compose up
```

Open `http://localhost:3000`. Sign in with:

- **Email:** `demo@example.com`
- **Password:** `TestPassword!123`

First build takes ~2–3 minutes (pnpm install + vite build + bun install). Subsequent `docker compose up` runs start in ~10 seconds.

Want to hack on it? See the Development section below — `make setup` + `make dev` is the dev workflow; `docker compose up` is the demo artifact.
```

## Commit sequence

The branch lands multiple commits so either can be reverted independently:

**Commit 1 — `chore(apps/server): swap tsx watch → bun --watch`** (the deferred B)
- `apps/server/package.json`: `dev` script `tsx watch --env-file-if-exists=.env src/index.ts` → `bun --watch --env-file-if-exists=.env src/index.ts`
- Drop `tsx` from `apps/server` devDeps
- Verification: `make dev` hot-reloads after a router edit; Better-Auth endpoints still respond correctly after reload
- Independent of demo mode. If it breaks a subtle Better-Auth hot-reload path, revert this one commit.

**Commit 2 — `fix(compose): bake literals into dev compose (zero-conf)`**
- Rename today's `docker-compose.yml` → `docker-compose.dev.yml`
- Replace `${DEV_DB_*}` interpolation with literal `app` / `postgres` / `postgres` / `5432:5432`
- Update `Makefile` targets `setup`, `db`, `clean` to pass `-f docker-compose.dev.yml`
- Verify `make setup && make dev` works on a clean checkout with no `.env`
- Isolated from demo-mode work — if demo-mode hits snags, this zero-conf fix stands on its own

**Commit 3 — `refactor(seed): invert credentials import + drop sample todos`**
- New `scripts/seed-credentials.ts` — canonical `SEED_USER` / `TEST_USER` / `SHARED_PASSWORD`
- `e2e/fixtures/credentials.ts` becomes a 1-line re-export from `scripts/seed-credentials.ts`
- `scripts/seed.ts`: import from `./seed-credentials.ts` (local, runtime-resident); delete the `db.todo.createMany` block + "Created 5 sample todos" log
- `make db-seed` on a fresh DB produces just the user now
- `make test` + `make test-unit` confirm e2e still uses the same fixture values

**Commit 4 — `chore(db): move prisma CLI to dependencies`**
- `packages/db/package.json`: move `prisma` from `devDependencies` → `dependencies`
- Enables `pnpm install --prod` to include the prisma binary in the runtime image
- Tiny but load-bearing for the migrate sidecar

**Commits 5–N — demo mode proper**
- `pnpm-workspace.prod.yaml`
- Root `Dockerfile` (5-stage, pnpm cache mounts, pinned pnpm@10.32.1, runtime copies `scripts/`)
- `docker-compose.yml` (new file, full demo stack — docker-compose.dev.yml was split out in commit 2)
- `Makefile` — `clean` target gains the second `down -v` line (preserves existing `rm -rf` + test-container cleanup)
- `.dockerignore`
- `README.md` quick-start prepend

## Testing

1. **Fresh clone, cold build**: `git clone ... && cd ... && docker compose up` on a machine without the repo's images cached. Expect ~2–3 min first build, then all four services healthy; web reachable at `localhost:3000`; sign-in as demo user succeeds.
2. **Warm rerun**: `docker compose down` (keep volume), `docker compose up`. Migrate sidecar runs, seed logs "already present", services come up in ~10s.
3. **Clean slate rerun**: `docker compose down -v`, `docker compose up`. Migrate reprovisions schema and re-seeds user.
4. **Dev workflow untouched**: `make setup && make dev` — only postgres in compose, app runs via pnpm dev.
5. **Test workflow untouched**: `make test`, `make test-unit`, `make lint` all pass.
6. **Both stacks co-existing is NOT supported** — demo uses port 3000/3001/5432, dev uses 3000/3001/5432 via `make dev`. If the user tries to `docker compose up` while `make dev` is running, they get port conflicts. Document this in README (same note a2sdlc-demo3 uses: "Port 3000/3001 will clash with `make dev` — don't run both at once").

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| `vite build` inside Docker needs node + bun + pnpm simultaneously in build stage; image gets fat | Multi-stage discards build stage; runtime is bun + prod-deps only |
| `VITE_API_URL` baked as container DNS name by accident → browser can't reach API | Explicit build-arg in compose with `http://localhost:3001`; document in spec |
| `BETTER_AUTH_SECRET` demo default leaks into prod (same class as existing flagged bug) | String literal `demo-not-for-production-use-32-chars` makes intent obvious; pre-existing prod issue tracked in TODO |
| pnpm install inside container is slow on cold build | `--mount=type=cache,target=/root/.local/share/pnpm/store` (a2sdlc-demo3 pattern) |
| Seed script runs before server is up → HTTP-based sign-up would deadlock | Uses in-process Better-Auth API, no HTTP. Server isn't needed for seed. |
| Migrate sidecar runs `prisma db push` on every `up` — slow-ish | `prisma db push` is ~1s against a schema that's already current. Acceptable for a demo. |
| `e2e/` accidentally shipped in runtime | `pnpm-workspace.prod.yaml` exclusion + `.dockerignore` |
| Two postgres volumes (demo + dev) eat disk | Acceptable — intentional isolation. `make clean` drops both. |

## Out of scope — tracked for follow-up

- **Real migrations**: `prisma migrate deploy` instead of `prisma db push`. Trivial swap when migrations land.
- **Prod-safety of `BETTER_AUTH_SECRET` Zod default**: pre-existing (noted in bun-test-spike handover). Demo mode works around it explicitly; fixing the root cause is a separate spike.
- **CI smoke test**: `docker compose up` in CI to prove demo mode stays healthy. Not in this spike — add once the base pattern is validated locally.
- **Seeded todos / richer demo data**: deliberately out. Empty state + first-todo creation is the first-run UX.

## References

- `docs/superpowers/specs/2026-04-11-bun-test-spike-handover.md` — deferred item A (demo mode) and item B (bun --watch)
- `~/Workspaces/a2sdlc-demo3/Dockerfile` and `docker-compose.yml` — pattern source for multi-stage + YAML anchors
- `packages/auth/src/constants.ts` — `MIN_PASSWORD_LENGTH = 8` (constrains demo password choice)
