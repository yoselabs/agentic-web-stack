---
title: "ADR 0011 — HTTP framework — server-process (proposed, spike pending)"
status: proposed
date: 2026-04-29
deciders: [denis]
draft_for_promotion_in_phase: 3
spike_status: pending — runs as part of Phase 3 first-slice implementation
---

# ADR 0011 — HTTP Framework (server-process)

> **Spike pending.** The plan called for a ≤4h spike validating
> `@effect/platform` HttpServer ergonomics + Better-Auth + Bull
> Board mountability. The spike now runs *as part of Phase 3
> implementation* — the spike code becomes the first slice's HTTP
> boundary rather than throwaway. Promotion gate at the bottom
> enumerates the spike outcomes that must be confirmed before this
> ADR can be flipped to `accepted`.

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

## References

- ADR-0009 — full rewrite onto Effect-TS
- Phase 1 design doc Q5b — TanStack Start floored separately
- `@effect/platform` HTTP docs: https://effect.website/docs/platform/http-server
- `kevin-courbet/tanstack-effect-example` (surveyed Mar 2026)
- `lelabo-m/lister` (surveyed Feb 2026)
- Better-Auth handler API: https://better-auth.com/docs/integrations/hono
- Bull Board Express middleware: https://github.com/felixmosh/bull-board
