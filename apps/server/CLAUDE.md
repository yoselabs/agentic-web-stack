# apps/server — Hono API Server

## Architecture

Hono server on port 3001 with three responsibilities:
1. **Better-Auth handler** at `/api/auth/**` — handles sign-up, sign-in, session management
2. **tRPC handler** at `/trpc/*` — all application API routes
3. **CORS** — configured via `CORS_ORIGIN` env var

## Adding a New Hono Route

Most routes should be tRPC procedures in `packages/api/`. Only add direct Hono routes for:
- Webhook endpoints (need raw request body)
- File upload endpoints
- Health checks

```typescript
app.get("/health", (c) => c.json({ status: "ok" }));
```

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
