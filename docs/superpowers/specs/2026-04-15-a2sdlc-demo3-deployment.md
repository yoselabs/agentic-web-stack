# a2sdlc-demo3 Deployment Setup

## Goal

Create a deployable fork of the agentic-web-stack template at `iorlas/a2sdlc-demo3`, hosted on shen as a private Tailscale domain. This repo will be used for a2sdlc demo runs.

## Repo & Branch Strategy

- **GitHub repo:** `iorlas/a2sdlc-demo3` (private)
- **`baseline`** — agentic-web-stack template code + deployment files (Dockerfile, docker-compose.prod.yml, CI workflow). Source of truth. Periodically rebased onto template updates.
- **`main`** — created from `baseline`, disposable. Recreated as needed for a2sdlc demo runs.

## Single Image, Two Containers

One `Dockerfile` at repo root — multi-stage pnpm monorepo build:

1. **deps** — `pnpm install --frozen-lockfile`
2. **build** — `pnpm -r build` with `VITE_API_URL` passed as build arg (Vite bakes `import.meta.env.VITE_*` at build time)
3. **runtime** — slim Node image, copy built outputs only

`docker-compose.prod.yml` runs these services:

| Service | Image | Role | Network |
|---------|-------|------|---------|
| `db` | `postgres:17-alpine` | PostgreSQL, no port binding, `pull_policy: always` | `app-internal` only |
| `migrate` | app image | `npx prisma db push --skip-generate`, one-shot | `app-internal` |
| `web` | app image | TanStack Start SSR, `hostname: a2sdlc-demo3-web` | `dokploy-network` + `app-internal` |
| `server` | app image | Hono API, `hostname: a2sdlc-demo3-api` | `dokploy-network` + `app-internal` |

All long-running services (`db`, `web`, `server`) have `restart: unless-stopped`.

### Healthchecks

| Service | Check |
|---------|-------|
| `db` | `pg_isready -U demo` |
| `web` | `wget -qO- http://localhost:3000/ \|\| exit 1` |
| `server` | `wget -qO- http://localhost:3001/ \|\| exit 1` |

### Networking

- Both `web` and `server` get Traefik labels — both need to be reachable from the browser.
- `web` serves the frontend at `a2sdlc-demo3.ts.shen.iorlas.net`.
- `server` serves the API at `api.a2sdlc-demo3.ts.shen.iorlas.net` — the browser calls it directly via `VITE_API_URL`.
- `db` is fully internal — no port binding, no Tailscale exposure.

**Why both need Traefik:** The frontend uses `VITE_API_URL` in browser-side code (`import.meta.env.VITE_API_URL`) for tRPC, auth, and fetch calls. Compose DNS (`http://server:3001`) is unreachable from the browser, so the API server needs its own routable domain.

```yaml
networks:
  dokploy-network: { external: true }
  app-internal: { internal: true }

volumes:
  postgres-data:
```

### Traefik Labels

**`web` service:**
```yaml
labels:
  - tailscale=true
  - traefik.enable=true
  - traefik.docker.network=dokploy-network
  - traefik.http.routers.a2sdlc-demo3-web.rule=Host(`a2sdlc-demo3.ts.shen.iorlas.net`)
  - traefik.http.routers.a2sdlc-demo3-web.entrypoints=web
  - traefik.http.services.a2sdlc-demo3-web.loadbalancer.server.port=3000
```

**`server` service:**
```yaml
labels:
  - tailscale=true
  - traefik.enable=true
  - traefik.docker.network=dokploy-network
  - traefik.http.routers.a2sdlc-demo3-api.rule=Host(`api.a2sdlc-demo3.ts.shen.iorlas.net`)
  - traefik.http.routers.a2sdlc-demo3-api.entrypoints=web
  - traefik.http.services.a2sdlc-demo3-api.loadbalancer.server.port=3001
```

## Cookie Domain for Auth

Better Auth runs on the `server` (Hono) at `api.a2sdlc-demo3.ts.shen.iorlas.net`. Without explicit cookie domain config, auth cookies are scoped to the `api.` subdomain and invisible to the frontend at `a2sdlc-demo3.ts.shen.iorlas.net`.

**Fix:** Configure Better Auth cookie domain in `packages/auth/src/index.ts` via a new env var `AUTH_COOKIE_DOMAIN`. In prod compose, set to `.a2sdlc-demo3.ts.shen.iorlas.net` (leading dot = parent domain, shared across subdomains). In dev, leave unset (defaults to current domain).

## Environment Variables

| Var | Value | Source |
|-----|-------|--------|
| `POSTGRES_USER` | `demo` | Hardcoded in compose |
| `POSTGRES_PASSWORD` | `demo3-pg-2026` | Hardcoded in compose (accepted deviation — private demo, no real data) |
| `POSTGRES_DB` | `a2sdlc_demo3` | Hardcoded in compose |
| `DATABASE_URL` | `postgresql://demo:demo3-pg-2026@db:5432/a2sdlc_demo3` | Hardcoded in compose |
| `NODE_ENV` | `production` | Hardcoded in compose |
| `BETTER_AUTH_SECRET` | `${BETTER_AUTH_SECRET}` | GitHub Secret |
| `BETTER_AUTH_URL` | `http://api.a2sdlc-demo3.ts.shen.iorlas.net` | Hardcoded in compose |
| `AUTH_COOKIE_DOMAIN` | `.a2sdlc-demo3.ts.shen.iorlas.net` | Hardcoded in compose |
| `VITE_API_URL` | `http://api.a2sdlc-demo3.ts.shen.iorlas.net` | Docker build arg (baked at build time) |
| `CORS_ORIGIN` | `http://a2sdlc-demo3.ts.shen.iorlas.net` | Hardcoded in compose |
| `IMAGE_TAG` | `main-<sha7>` | Computed in CI |
| `DOKPLOY_AUTH_TOKEN` | — | GitHub Secret |
| `DOKPLOY_URL` | — | GitHub Secret |
| `DOKPLOY_COMPOSE_ID` | — | GitHub Secret |

## CI/CD Pipeline

`.github/workflows/deploy.yml` — modeled on aggre's pattern:

- **Trigger:** push to `main`, PRs to `main`, manual dispatch
- **PR:** validate compose syntax only (no push, no deploy)
- **Push to main:** build image → push to GHCR → `dokploy-ctl deploy`
- **Platform:** `linux/amd64` only (shen is amd64)
- **Image tags:** `type=ref,event=branch` + `type=sha,prefix=main-`
- **dokploy-ctl:** installed via `uvx` (same as aggre), resolves `${VAR}` refs via `--env`
- **IMAGE_TAG:** computed as `main-${GIT_SHA::7}` (7-char truncation, matches `type=sha` default)
- **VITE_API_URL:** passed as `--build-arg` to Docker build

## Dockerfile Details

```
FROM node:20-alpine AS base
  - corepack enable, pnpm

FROM base AS deps
  - copy package.json, pnpm-lock.yaml, pnpm-workspace.yaml
  - copy all package.json files from apps/ and packages/
  - pnpm install --frozen-lockfile

FROM base AS build
  - copy deps node_modules
  - copy full source
  - ARG VITE_API_URL
  - ENV VITE_API_URL=$VITE_API_URL
  - pnpm -r build
  - pnpm prune --prod

FROM node:20-alpine AS runtime
  - copy pruned node_modules
  - copy built outputs (apps/web/.output, apps/server/dist)
  - copy prisma schema (for migrate)
  - non-root user
```

No `CMD` — each compose service specifies its own command. The image is environment-specific (VITE_API_URL baked in), acceptable for a demo deployment.

## Dokploy Setup

- Create a Dokploy project + compose app via `dokploy-ctl init`
- Save returned compose ID as `DOKPLOY_COMPOSE_ID` GitHub secret

## Human Gates

Before first deploy, the user must:
1. Set GitHub secrets: `DOKPLOY_AUTH_TOKEN`, `DOKPLOY_URL`, `DOKPLOY_COMPOSE_ID`, `BETTER_AUTH_SECRET`
2. Confirm the Dokploy compose app is created

## Out of Scope

- Public HTTPS / Let's Encrypt (private Tailscale only)
- Custom domain beyond `*.a2sdlc-demo3.ts.shen.iorlas.net`
- Monitoring, logging, or alerting
- Template sync automation (manual rebase)
