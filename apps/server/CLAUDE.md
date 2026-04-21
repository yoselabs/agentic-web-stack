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

## Adding a Webhook — `src/webhooks/<name>.ts`

One file per provider / integration. File exports a `Hono` sub-app that
`src/index.ts` mounts at the provider's path.

```typescript
// src/webhooks/stripe.ts
import { createRateLimiter } from "@project/rate-limit/factory";
import { Hono } from "hono";

const stripeLimiter = createRateLimiter({
  name: "webhook:stripe:ip",
  points: 120,
  duration: 60,
});

export const stripeWebhook = new Hono();

stripeWebhook.post("/", async (c) => {
  // 1. Rate-limit by IP (or signature key).
  // 2. Verify HMAC signature against raw body — don't parse JSON first.
  // 3. Enqueue to @project/jobs; return 200 fast.
});
```

Mount in `src/index.ts` alongside `webhooks/example`. Rules:
- One sub-app per provider, named `<provider>Webhook`.
- Always rate-limit — public internet, no auth cookie.
- Verify signatures before touching the body.
- Push work to a BullMQ queue — the handler returns in ms.

## Adding an Admin Mount — `src/admin/<name>.ts`

Admin routes live under `/admin/*` and are ALL gated by `requireAdmin`
middleware before any sub-app mount. Bull Board (`src/admin/bull-board.ts`)
is the reference.

```typescript
// src/admin/metrics.ts
import { Hono } from "hono";
export const adminMetrics = new Hono();
adminMetrics.get("/", (c) => c.json({ ok: true }));
```

Mount in `src/index.ts`:

```typescript
app.use("/admin/*", requireAdmin(auth));  // order-critical: BEFORE mounts
app.route("/admin/queues", bullBoardApp);
app.route("/admin/metrics", adminMetrics);
```

Rules:
- `requireAdmin` MUST be registered before any admin sub-app — otherwise
  you leak payloads (single-use tokens, PII) to unauthenticated users.
- Authorization uses the SAME CASL ability as tRPC (`abilityFor` from
  `@project/api/authz`) — single source of truth.
- An acceptance test locks the ordering in; don't remove it.

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
