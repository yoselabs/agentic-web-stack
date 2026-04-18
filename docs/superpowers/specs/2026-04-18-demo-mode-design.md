# Demo Mode — Design

**Date:** 2026-04-18
**Branch:** `spike/demo-mode`
**Motivated by:** deferred item A from `docs/superpowers/specs/2026-04-11-bun-test-spike-handover.md`
**Related:** also folds in deferred item B (`apps/server` `tsx watch` → `bun --watch`) as a separate commit

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
3. Seeded user `demo@example.com` / `demodemo` can sign in immediately.
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

**`make clean`** tears down both stacks:
```
docker compose down -v
docker compose -f docker-compose.dev.yml down -v
```

### Single `Dockerfile` at repo root (pattern borrowed from `a2sdlc-demo3`)

One `Dockerfile` is reused across all three app services (`migrate`, `server`, `web`) via YAML anchors in compose. Compose builds the image once; each service overrides `command:` only.

Four build stages:

1. **`base`** — `node:24-slim` + `openssl` (Prisma) + corepack + pnpm via `corepack prepare`. Workdir `/app`.
2. **`deps`** — full install (dev dependencies included). Produces the tooling tree used by the build stage (`vite`, `prisma` CLI, `tsc`). Uses `pnpm-workspace.yaml` (includes `e2e/`).
3. **`prod-deps`** — parallel stage, same inputs but `--prod` and `pnpm-workspace.prod.yaml` (excludes `e2e/`, so Playwright + fixtures don't land in the runtime). This is what ships.
4. **`build`** — starts from `deps`, `COPY . .`, restores `pnpm-workspace.prod.yaml` (the full COPY clobbered it), `prisma generate`, `pnpm -r build`. Accepts `ARG VITE_API_URL` → `ENV VITE_API_URL=...` so vite bakes the correct browser-facing API URL into the client bundle.
5. **`runtime`** — `oven/bun:1-slim` (or equivalent). Overlays:
   - `prod-deps/` workspace tree (the ship baseline)
   - `build/apps/web/.output` (Nitro SSR bundle)
   - `build/packages/*/src` (shared TS source — domain packages export `./src/*.ts` paths)
   - Runs as non-root `app` user
   - `HEALTHCHECK NONE` at image level; compose defines per-service healthchecks

Dockerfile uses `# syntax=docker/dockerfile:1-labs` for `COPY --parents` (preserves workspace layout with glob patterns so new packages don't require Dockerfile edits).

### `pnpm-workspace.prod.yaml`

New file. Same as `pnpm-workspace.yaml` minus `e2e/*`. Runtime images don't need Playwright or feature files. Keeps the runtime image ~250MB smaller and its security surface narrower.

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
    command: ["sh", "-c", "pnpm --filter @project/db exec prisma db push --skip-generate && bun /app/scripts/seed-demo.ts"]
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

Four env vars reach the app through different paths — getting this wrong silently breaks sign-in:

| Var | Path | Value | Why |
|---|---|---|---|
| `DATABASE_URL` | server runtime env | `postgresql://postgres:postgres@db:5432/app` | Docker DNS — server resolves `db` to the postgres container |
| `CORS_ORIGIN` | server runtime env | `http://localhost:3000` | Browser sends this as `Origin`; server compares literally |
| `BETTER_AUTH_URL` | server runtime env | `http://localhost:3001` | Better-Auth uses this to construct callback/cookie URLs for the browser |
| `VITE_API_URL` | **build-arg, baked into web bundle** | `http://localhost:3001` | Vite inlines `import.meta.env.VITE_API_URL` at build time. Must be the browser's URL, NOT a container DNS name. The web container itself never reads this at runtime — the browser does. |

### Seed script (`scripts/seed-demo.ts`)

Single file at repo root, ~15 lines:

```typescript
import { auth } from "@project/auth/server";

const email = "demo@example.com";
const password = "demodemo";

try {
  await auth.api.signUpEmail({
    body: { email, password, name: "Demo User" },
  });
  console.log(`✓ Demo user created: ${email} / ${password}`);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  if (/already exists|duplicate|unique/i.test(message)) {
    console.log(`✓ Demo user already present: ${email} / ${password}`);
  } else {
    throw err;
  }
}
```

- Uses Better-Auth's in-process API so password hashing matches whatever algo Better-Auth is configured with. No direct Prisma writes, no brittle hash duplication.
- Idempotent: rerunning `docker compose up` against the same volume no-ops cleanly.
- Runs inside the `migrate` sidecar after `prisma db push`.
- Prints credentials to the compose log so evaluators see them on first boot.

### `.dockerignore`

New file. Excludes at minimum: `node_modules`, `**/node_modules`, `**/.output`, `**/dist`, `**/.features-gen`, `e2e/test-results`, `.git`, `.claude`, `docs`, `README.md` (not needed in image), `.env*`, `TODO.md`.

### Makefile updates

Three existing targets gain `-f docker-compose.dev.yml`:

```makefile
setup:
    ...
    docker compose -f docker-compose.dev.yml up -d
    @until docker compose -f docker-compose.dev.yml exec -T postgres pg_isready -U postgres > /dev/null 2>&1; do sleep 1; done
    ...

db:
    docker compose -f docker-compose.dev.yml up -d

clean:
    docker compose down -v
    docker compose -f docker-compose.dev.yml down -v
    ...
```

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
- **Password:** `demodemo`

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

**Commits 2–N — demo mode** (contents of this spec)
- `pnpm-workspace.prod.yaml`
- Root `Dockerfile`
- `docker-compose.yml` (flip to full demo)
- `docker-compose.dev.yml` (extract postgres-only dev infra)
- `.dockerignore`
- `scripts/seed-demo.ts`
- Makefile target updates
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
