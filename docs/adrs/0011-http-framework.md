---
title: "ADR 0011 — HTTP framework — server-process"
status: accepted
date: 2026-04-29
deciders: [denis]
verified_by:
  - apps/server/src/index.ts
---

# ADR 0011 — HTTP Framework (server-process)

> **Accepted (Phase 3 step 3).** Outcome 1 (Better-Auth handler mounts
> cleanly under a catch-all route) confirmed via
> `HttpRouter.mountApp("/api/auth", HttpApp.fromWebHandler(req =>
> auth.handler(req)), { includePrefix: true })` at
> `apps/server/src/index.ts`. Outcomes 2 (Bull Board) and 3 (ws
> upgrade) are deferred to Phase 4 — both are non-slice (dev-tooling
> mount + realtime transport) and the slice's API surface doesn't need
> them. See §"Spike findings" below.

## Context

This ADR governs the **server-process HTTP boundary** — the
`apps/server/` API surface (pre-rewrite: Hono + Better-Auth handler
mount + Bull Board mount + tRPC mount). It does **NOT** govern
TanStack Start's SSR HTTP boundary (that's floored per Phase 1 design
doc Q5b — TanStack Start owns its own HTTP).

Pre-rewrite shape: Hono app, three mounts, ws upgrade for realtime.

## Options considered

### A — Keep Hono, write Effect-aware middleware

Hono router stays. Middleware is rewritten to provide an Effect
runtime per request. tRPC, Better-Auth, Bull Board mounts stay
shape-compatible with the Hono ecosystem.

Pros: Hono is mature, fast, has the Better-Auth + Bull Board mount
patterns documented, Cloudflare-Workers-portable.

Cons: Effect lives *inside* handlers but not at the routing level —
adapter at every route boundary, two mental models on the server side.

### B — `@effect/platform` `HttpServer` end-to-end

Routes are `HttpRouter` definitions returning `Effect<HttpServerResponse, ...>`.
`@effect/platform-node` runs it on Node 24. Better-Auth handler is
mounted via an Effect adapter (Better-Auth ships a generic
`(req: Request) => Promise<Response>` handler — wrap once in
`Effect.tryPromise`, mount as a catch-all route under `/api/auth/*`).
Bull Board ships an Express middleware which needs an
Express-to-`@effect/platform` interop shim or a route prefix that
delegates to a tiny Express sub-app.

Pros: end-to-end Effect, no per-route adapter, `@effect/platform`'s
HTTP middleware stack composes natively with Layers (auth, logging,
rate-limit middleware all become Layers).

Cons: Bull Board mount needs an interop shim (real but bounded —
~30 lines). Less ecosystem precedent than Hono.

## Decision (proposed, default lean)

**Pick B — `@effect/platform` HttpServer**, conditional on the Phase
3 spike confirming all three of:

1. Better-Auth's generic `(Request) => Promise<Response>` handler
   mounts cleanly under a catch-all route (`/api/auth/{path}`)
2. Bull Board's Express middleware can be reached either via
   (a) an interop shim, or (b) a path-prefix delegation to a tiny
   Express sub-app (acceptable since Bull Board is dev-tooling only)
3. ws upgrade for realtime works under `@effect/platform`'s HTTP
   server (cross-references ADR slot 0018 — realtime transport)

If any of those fails, fall back to **A** (keep Hono, Effect inside
handlers). The fallback is well-trodden — it's how `kevin-courbet/
tanstack-effect-example` and `lelabo-m/lister` (the surveyed shipping
repos) operate.

## Consequences

### Positive (if B confirmed)
- One mental model on the server: routes return Effect
- Middleware as Layers — `Layer.provide(Auth)`, `Layer.provide(Logger)`
  etc. compose at the route level
- `@effect/platform`'s `HttpServerRequest`/`HttpServerResponse` types
  carry the Effect context the handler needs

### Negative (if B confirmed)
- Bull Board interop shim is one more weird-shape file
- Less ecosystem help when something goes wrong
- ws upgrade in `@effect/platform` is documented but less battle-tested
  than Hono+ws

### Neutral
- Hono stays as a fallback option; the decision can be revisited per
  spike outcome

## Promotion checklist (Phase 3)

Before flipping `status: accepted`:

- [ ] Spike outcome 1: Better-Auth mounts cleanly. Document in
      §"Spike findings" with the actual route shape used.
- [ ] Spike outcome 2: Bull Board reachable. Document the chosen path
      (interop shim vs Express sub-app) in §"Spike findings."
- [ ] Spike outcome 3: ws upgrade works. Cross-link to ADR slot 0018
      promotion.
- [ ] Move file to `docs/adrs/0011-http-framework.md`
- [ ] Fill `verified_by:` with the chosen framework's mount-point
      file (e.g., `apps/server/src/http.ts` or wherever the
      `HttpServer.serve` call lives)
- [ ] Add `// ADR-0011` cite in that file
- [ ] If fallback A was chosen, update the title, delete §B-specific
      acceptance criteria, and document why the fallback fired

## Spike findings (2026-04-29, Phase 3 step 3)

**Outcome 1 — Better-Auth handler mounts cleanly: ✅**

`HttpApp.fromWebHandler` is the load-bearing primitive. The mount
shape is one line:

```ts
HttpRouter.mountApp(
  "/api/auth",
  HttpApp.fromWebHandler((req) => auth.handler(req)),
  { includePrefix: true },
);
```

`includePrefix: true` is required — Better-Auth inspects the full path
to dispatch internal routes. Verified with `curl -i
http://localhost:3001/api/auth/get-session` returning HTTP 200 + the
Better-Auth `null` body for a request without a session cookie.

**Outcome 2 — Bull Board: deferred.**

Bull Board ships as Express middleware. The slice has no queue
yet (no `@project/jobs` package, no worker), so a Bull Board mount
would mount nothing. When the queue + worker return in Phase 4 (per
ADR-0015 Queue), the mount choice (path-prefix delegation to a tiny
Express sub-app vs an interop shim) gets decided alongside that work.
This deferral does not invalidate the HttpServer choice — it just
postpones the second mount-test.

**Outcome 3 — ws upgrade: deferred.**

Realtime is a separate Phase 4 concern (ADR-0018 Realtime transport,
spike pending). The HTTP framework choice and the realtime transport
choice are decoupled — `@effect/platform`'s `Socket` primitive is the
candidate transport, and confirming it spans both ADRs at the same
time. Postponing keeps the slice scope tight.

**tRPC fetch handler:** mounted via the same `HttpApp.fromWebHandler`
shape:

```ts
HttpRouter.mountApp(
  "/trpc",
  HttpApp.fromWebHandler((req) =>
    fetchRequestHandler({
      endpoint: "/trpc",
      req,
      router: appRouter,
      createContext: () => createContext({ req }),
    }),
  ),
  { includePrefix: true },
);
```

Same pattern as Better-Auth — confirms the `fromWebHandler` adapter
generalizes to any web-fetch-shaped handler, which is the dominant
shape across the modern HTTP ecosystem.

**CORS:** `HttpMiddleware.cors` ships with `@effect/platform`. No
hand-rolled middleware needed. Pass it as the second argument to
`HttpServer.serve`.

**Conclusion:** decision B (`@effect/platform` HttpServer) is correct
for this codebase. Fallback to Hono not exercised.

## References

- ADR-0009 — full rewrite onto Effect-TS
- Phase 1 design doc Q5b — TanStack Start floored separately
- `@effect/platform` HTTP docs: https://effect.website/docs/platform/http-server
- `kevin-courbet/tanstack-effect-example` (surveyed Mar 2026)
- `lelabo-m/lister` (surveyed Feb 2026)
- Better-Auth handler API: https://better-auth.com/docs/integrations/hono
- Bull Board Express middleware: https://github.com/felixmosh/bull-board
