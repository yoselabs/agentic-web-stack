---
title: "ADR-0008 — WebSocket path-prefix discipline"
status: accepted
date: 2026-04-23
deciders: [denis]
verified_by:
  # Original entries (apps/server/src/index.ts, apps/server/CLAUDE.md)
  # were removed during the Phase 1 wipe of the Effect-TS rewrite.
  # The wipe plan itself cites ADR-0008 and is the temporary verifier
  # until Phase 3 rebuilds the server and restores the real entries.
  - docs/capabilities.md
---

# ADR-0008 — WebSocket Path-Prefix Discipline

## Context

The server supports two distinct WebSocket use cases that may coexist
on the same Node `http.Server`:

1. **tRPC subscriptions** — end-to-end typed, owned by the tRPC client.
   The server mounts a raw `ws.WebSocketServer` wired through
   `@trpc/server/adapters/ws`'s `applyWSSHandler`. tRPC controls the
   upgrade lifecycle directly.
2. **Custom wire protocols** — future features that need a typed
   bidirectional channel outside the tRPC subscription model
   (e.g. XMPP over WebSocket per RFC 7395, MQTT, a custom binary
   presence/typing channel for a chat domain). Hono v2's
   `upgradeWebSocket(c, events)` is the right primitive here:
   Hono-route-level WS, full Context for auth + middleware, owner
   defines the message wire format.

Mixing both naively is technically possible — Node's `http.Server`
supports multiple `upgrade` listeners — but without a convention a
future author (human or AI) has three questions they shouldn't have to
re-derive:

- Which primitive do I reach for?
- Where does the code live?
- Do the two step on each other?

A template that evolves toward chat-class workloads (see the research
captured in `docs/superpowers/specs/2026-04-23-codebase-upgrade-audit.md`
§2.1 and the a2sdlc-demo3 chat reference) will eventually want both.
Better to document the seams up front than refactor under time pressure.

## Decision

**One WebSocket path tree, two disjoint prefixes:**

| Path prefix | Primitive | Owner file | Typing surface |
|---|---|---|---|
| `/trpc-ws` | `new ws.WebSocketServer({ server, path: "/trpc-ws" })` + `applyWSSHandler` | `apps/server/src/index.ts` | tRPC end-to-end types via `@project/api/router` |
| `/ws/<protocol>/*` | Hono route using `upgradeWebSocket(c, events)` from `@hono/node-server` | `apps/server/src/ws/<protocol>.ts` (create when needed; do not add empty stubs) | Domain-owned — the route author brings their own (de)serializer and types |
| any other path | — | — | Default-rejected by the `ws` library's path filter; see "Coexistence" below for the mixed case |

### Why the two live on different prefixes

- `/trpc-ws` is tRPC's existing convention (matches the client's
  `wsLink` URL) and tRPC's adapter needs raw WSS ownership.
- `/ws/*` is a clean namespace that says "this endpoint speaks a custom
  protocol, not tRPC." Subpath (`/ws/xmpp`, `/ws/presence`) distinguishes
  protocols cleanly.

### Coexistence

Both `ws.WebSocketServer` and Hono v2's `setupWebSocket` register their
own `server.on("upgrade", ...)` listeners. This is **cooperatively
safe by design**, not by coincidence:

- `ws`'s path-filtering constructor (`{ server, path }`) aborts the
  handshake with HTTP 400 on non-matching paths, freeing the socket.
- Hono v2's upgrade handler explicitly checks
  `server.listenerCount("upgrade")` — if other listeners are registered
  (e.g. the tRPC WSS), Hono silently returns on non-matching routes
  instead of rejecting, letting the sibling listener claim the upgrade.
  Source: `@hono/node-server@2`'s `setupWebSocket`.

Order of listener registration therefore does not matter for
correctness. What *does* matter:

1. **No overlapping path filters.** If a Hono route uses
   `upgradeWebSocket` at `"/trpc-ws"` or the tRPC WSS path changes to
   match a Hono route, upgrades will race. Keep `/trpc-ws` tRPC-only.
2. **Unclaimed upgrades.** If a request arrives at `/ws/unknown`
   after Hono v2 is added (no tRPC path match, no Hono route match),
   Hono's handler returns silently because `listenerCount > 1`, and
   the socket dangles until TCP timeout. The fix is a small fallthrough
   listener; add it only when the first Hono WS route lands:

   ```ts
   // Add after the Hono WS route(s) and the tRPC WSS are registered.
   httpServer.on("upgrade", (req, socket) => {
     // If no sibling listener claimed this upgrade by now, reject it.
     // listenerCount includes this listener; >1 means someone else is
     // registered, which would have claimed a matching path already.
     if (!socket.destroyed && !socket.writableEnded) {
       socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
     }
   });
   ```

### When to add a Hono-route-level WS endpoint

Trigger:

- You need a typed bidirectional channel where the client pushes
  messages mid-stream (tRPC's subscription model is one-way by design,
  so if the client→server direction would carry domain payloads, that's
  the signal).
- You need a wire protocol that is not tRPC's binary framing (XMPP,
  MQTT, custom binary, ORM sync protocols).

Recipe:

1. Create `apps/server/src/ws/<protocol>.ts` exporting a Hono sub-app.
2. Use `upgradeWebSocket((c) => ({ onOpen, onMessage, onClose, onError }))`.
3. Authenticate in the route handler before the upgrade — the Hono
   `Context` is available, so `auth.api.getSession({ headers: c.req.raw.headers })`
   works identically to the HTTP routes.
4. Mount in `apps/server/src/index.ts` at `/ws/<protocol>`.
5. Add the fallthrough `upgrade` listener described above if this is
   the first Hono WS route (it only needs to be registered once).
6. Update this ADR's table if the prefix pattern extends.

### What NOT to do

- **Do not migrate tRPC subscriptions to SSE** just because SSE would
  work for the current 2-subscriptions-per-page workload. Industry
  consensus for chat-class apps (Slack, Teams, Discord, WhatsApp Web,
  Telegram Web, Matrix, Linear) is WebSocket; multiplexing and
  client-push capacity become relevant as the app grows. Pivoting later
  is higher-cost than keeping WS now.
- **Do not route custom bidirectional payloads over tRPC mutations
  fired from a subscription callback.** That works, but it's
  two round-trips where one would do, and loses the "one-socket"
  property that makes WS valuable for chat-class apps.
- **Do not add an empty `apps/server/src/ws/` folder preemptively.**
  Empty folders rot. Create the folder with its first real endpoint.

## Consequences

- **Positive.** The WS landscape has one decision tree: tRPC procedure
  → `/trpc-ws`; custom protocol → `/ws/<protocol>`. A future author
  asking "where do I put this?" gets a mechanical answer.
- **Positive.** tRPC's end-to-end typing stays intact for the 90% case
  (subscriptions), while the escape hatch for genuine bidirectional
  needs is documented rather than accidental.
- **Positive.** Coexistence is a property of the primitives we already
  use, not a hack we maintain. Nothing to break.
- **Negative.** Two WebSocket primitives live in the codebase when the
  first `/ws/*` endpoint lands. That is the price of the escape hatch;
  the alternative (force everything through one primitive) means either
  hand-rolling chat over tRPC mutations+subscriptions only, or
  migrating off tRPC subscriptions for bidirectional work.
- **Negative.** Test coverage for the coexistence seam does not exist
  today because there is no `/ws/*` endpoint. Add coverage (a Playwright
  check that `/ws/unknown` rejects, `/ws/<protocol>` connects) as part
  of the first Hono WS endpoint's acceptance criteria.

## Alternatives considered

- **All-SSE for subscriptions via `httpSubscriptionLink`** — simpler,
  deletes ~40 lines of server WS boot and the `ws` dep. Rejected:
  SSE is one connection per subscription (browser cap ~6/origin), which
  is fine for the current 2 subs per page but becomes a ceiling in a
  chat-class app with multiple rooms + presence + typing streams open
  concurrently. Per-page connection count is the forcing function, not
  protocol bidirectionality. See research notes in the 2026-04-23
  codebase upgrade audit.
- **Split ports (tRPC WS on :3001, custom WS on :3002).** Cleaner
  separation but doubles deploy surface (firewall, Traefik routing,
  health checks, CORS per port). Not justified by the mild coexistence
  complexity.
- **All traffic over WS (`wsLink` only on the client, no
  `httpBatchLink`).** Rejected up front — loses HTTP caching,
  observability, and middleware ergonomics for queries/mutations.
  tRPC docs recommend the split link pattern this repo already uses.

## Related

- `docs/adrs/0001-realtime-architecture.md` — the Channel abstraction
  (MemoryChannel / RedisChannel) that feeds tRPC subscriptions; agnostic
  to the client-facing transport.
- `docs/superpowers/specs/2026-04-23-codebase-upgrade-audit.md` §2.1,
  §4.2 — the audit that surfaced this decision.
- `apps/server/CLAUDE.md` — day-to-day navigation; mirrors the path
  table here.
