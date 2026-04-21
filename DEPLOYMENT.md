# Deployment

Universal guide for shipping this template to any container runtime — Docker on a VPS, Kubernetes, Dokploy, Coolify, Railway, Fly.io, ECS. See `docker-compose.prod.example.yml` for a reference stack; translate it to your orchestrator of choice.

## Prereqs

- Container runtime that can build/run the repo `Dockerfile` and reach a Postgres 17 + Redis 7 instance (managed or co-located).
- A reverse proxy terminating TLS in front of the `web` (port 3000) and `server` (port 3001) containers — not shipped here.

## Env vars

SSOT is [`packages/env/src/server.ts`](packages/env/src/server.ts) (+ `packages/env/src/client.ts` for `VITE_*`). Defaults defined there are dev-only — every var below MUST be set explicitly in prod.

| Name | Purpose | Required |
|---|---|---|
| `DATABASE_URL` | Postgres connection string | yes |
| `REDIS_URL` | Redis connection string (queues + pub/sub) | yes |
| `BETTER_AUTH_SECRET` | Session signing key, ≥32 chars, random | yes |
| `BETTER_AUTH_URL` | Public API origin, e.g. `https://api.example.com` | yes |
| `WEB_URL` | Public UI origin, used in outbound email/push links | yes |
| `CORS_ORIGIN` | Allowed browser origin for the API; usually `== WEB_URL` | yes |
| `SSR_API_URL` | Container-internal API URL the web app hits during SSR (e.g. `http://server:3001`) | yes |
| `AUTH_COOKIE_DOMAIN` | Leading-dot domain (`.example.com`) for cross-subdomain sessions | only if web + api are on different subdomains |
| `SMTP_URL` | Outbound mail transport | yes (if you send email) |
| `NODE_ENV` | `production` | yes |
| `PORT` | Server listens on this port (3001 server / 3000 web by convention) | yes |
| `LOG_LEVEL` | Pino level: `info` default; `debug` for diagnosis | no |
| `VITE_API_URL` | **Build-time** browser-facing API URL. Baked into the JS bundle. | yes (at `docker build`) |

Postgres image creds (`POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB`) are only relevant if you run Postgres as a sibling container; managed Postgres ignores them.

## Landmines

1. **Hono must bind `0.0.0.0`.** `@hono/node-server`'s `serve()` defaults to loopback; the container is then silently unreachable externally while internal healthchecks still pass. Enforced by `scripts/check-server-bind.ts` (runs in `make lint`) — do not disable.
2. **No `wget` / `curl` in the runtime image.** The `node:24-slim` base doesn't ship them, and neither does the `oven/bun:1-slim` final stage. Healthchecks use `bun /app/scripts/healthcheck.ts <url>` — the Dockerfile `HEALTHCHECK` and the prod compose example both follow this. Don't change it to `curl -f` on a whim.
3. **Use `pnpm exec prisma`, not `npx prisma`.** `npx` resolves packages over the network and fails with `EAI_AGAIN` on locked-down internal networks (air-gapped prod, Kubernetes with restrictive egress). Even when it works it adds cold-start latency. The `migrate` sidecar calls `pnpm --filter @project/db exec prisma db push --skip-generate`.
4. **Cross-subdomain sessions need `AUTH_COOKIE_DOMAIN`.** If `WEB_URL=https://app.example.com` and `BETTER_AUTH_URL=https://api.example.com`, set `AUTH_COOKIE_DOMAIN=.example.com` (leading dot). Leave unset when UI and API share a host — the host-only cookie is correct then.
5. **`BETTER_AUTH_URL` ≠ `WEB_URL`.** `BETTER_AUTH_URL` is the API origin where Better-Auth handlers live. `WEB_URL` is the UI origin used to build user-facing links in outbound email/push. They coincide in dev, diverge in prod. Don't alias them.
6. **`VITE_API_URL` is baked at build time.** Vite inlines `import.meta.env.VITE_*` into the client JS bundle during `pnpm --filter @project/web build`. You need one image per target environment, or a CI build parameterized with `docker build --build-arg VITE_API_URL=https://api.example.com`. Rotating the API URL means rebuilding, not restarting.
7. **Don't reach for `pnpm prune --prod` in a custom stage.** Use `pnpm deploy` (the idiomatic workspace production-tree extractor) — or, better, follow the template: the `prod-deps` Dockerfile stage uses `pnpm-workspace.prod.yaml` + `pnpm install --prod` against a pruned workspace manifest. Custom prune steps corrupt the symlink tree for workspace packages.

## Rollback

- Tag every build: `ghcr.io/you/agentic-web-stack:<git-sha>` (or equivalent). Keep the last N tags pinned in the registry.
- To roll back, re-point `APP_IMAGE` (or the Kubernetes `Deployment` image, or the platform's image field) to the previous tag and redeploy. Image is reused by `migrate`, `server`, `web` — one change, all three services revert.
- If the rollback crosses a schema migration, run the previous image's `migrate` container **only if** the schema change was backward-compatible. Otherwise restore from a Postgres backup taken before the forward migration.
- Data volumes (`postgres-data`, `redis-data`) are not touched by image rollbacks — state persists.
- Verify `/health` on both services returns 200 before removing the previous tag from the registry.

## Monitoring

`/health` on the API returns DB connectivity status; `/health` on the web container returns process liveness. Bull Board is mounted at `/admin/queues` on the API server for BullMQ queue inspection — put it behind auth at the reverse-proxy layer before exposing publicly. Logs are structured JSON via Pino and written to stdout; ship them from the container runtime to your aggregator (Loki, CloudWatch, Datadog).
