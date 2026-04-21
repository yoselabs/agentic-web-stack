# apps/server — Hono API Server

## Architecture

Hono server on port 3001, bound to `0.0.0.0` (container runtimes can't reach
`127.0.0.1` from another container). Enforced by `scripts/check-server-bind.ts`
via `make lint`.

Responsibilities:
1. **Better-Auth handler** at `/api/auth/**` — sign-up, sign-in, session
2. **tRPC handler** at `/trpc/*` — all application API routes (WS + HTTP)
3. **Bull-Board** at `/admin/queues` (admin-gated) — BullMQ dashboard
4. **Direct webhooks** under `src/webhooks/` — reference: `webhooks/example.ts`
   (uses `@project/rate-limit` factory)
5. **CORS + `secureHeaders`** — configured from `CORS_ORIGIN`

## Adding a New Hono Route

Most routes should be tRPC procedures in `packages/api/`. Only add direct Hono routes for:
- Webhook endpoints (need raw request body; see `src/webhooks/example.ts`)
- File upload endpoints
- Health checks

```typescript
app.get("/health", (c) => c.json({ status: "ok" }));
```

For rate-limited webhooks, import a limiter from `@project/rate-limit/factory`
(Redis when `REDIS_URL` reachable, in-memory fallback otherwise).

## Auth Flow

1. Better-Auth handler receives auth requests at `/api/auth/**`
2. For tRPC routes, the server extracts session from cookies via `auth.api.getSession()`
3. Session is passed into tRPC context via `createContext({ session })`
4. `protectedProcedure` in packages/api checks for session

## Env Vars

Loaded from root `.env` via `--env-file-if-exists=../../.env` in the dev
script (optional — zero-conf boot relies on `@project/env` Zod defaults when
no `.env` exists).

Required (must be set in prod, defaults fire in dev): `DATABASE_URL`,
`BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `CORS_ORIGIN`.

## Do Not

- Add business logic here — put it in tRPC procedures (`packages/api/`)
- Mount auth at a different path than `/api/auth/**` — Better-Auth client expects this
- Remove `credentials: true` from CORS — breaks cookie-based auth
- Forget `allowHeaders: ["Content-Type", "Authorization"]` in CORS
