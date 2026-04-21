import type { IncomingMessage, Server } from "node:http";
import { serve } from "@hono/node-server";
import { trpcServer } from "@hono/trpc-server";
import { createContext } from "@project/api/context";
import { todoHttpRouter } from "@project/api/domains/todo-list/todo-http";
import { appRouter } from "@project/api/router";
import { auth } from "@project/auth";
import { db } from "@project/db";
import { env } from "@project/env/server";
import {
  applyWSSHandler,
  type CreateWSSContextFnOptions,
} from "@trpc/server/adapters/ws";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { WebSocketServer } from "ws";
import { createBullBoardAdapter } from "./admin/bull-board.js";
import { requireAdmin } from "./admin/middleware.js";
import { logger } from "./logger.js";
import { exampleWebhookRouter } from "./webhooks/example.js";

const app = new Hono();

// Request logging middleware
app.use(async (c, next) => {
  const start = Date.now();
  await next();
  const duration = Date.now() - start;
  logger.info(
    {
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      duration,
    },
    "request completed",
  );
});

const frontendOrigin = env.CORS_ORIGIN;

app.use(
  secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", frontendOrigin],
      connectSrc: ["'self'", frontendOrigin],
      styleSrc: ["'self'", "'unsafe-inline'", frontendOrigin],
      imgSrc: ["'self'", "data:", frontendOrigin],
      fontSrc: ["'self'", frontendOrigin],
      frameAncestors: ["'none'"],
    },
    strictTransportSecurity: "max-age=63072000; includeSubDomains; preload",
    xFrameOptions: "DENY",
    xContentTypeOptions: "nosniff",
    referrerPolicy: "strict-origin-when-cross-origin",
  }),
);

app.use(
  cors({
    origin: env.CORS_ORIGIN,
    credentials: true,
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "OPTIONS"],
  }),
);

// Health check — before tRPC so it bypasses tRPC middleware
app.get("/health", async (c) => {
  let dbStatus: "ok" | "error" = "ok";
  try {
    await db.$queryRaw`SELECT 1`;
  } catch {
    dbStatus = "error";
  }

  const body = {
    status: dbStatus === "ok" ? ("ok" as const) : ("degraded" as const),
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    db: dbStatus,
  };

  return c.json(body, dbStatus === "ok" ? 200 : 503);
});

// Better-Auth handler.
// NOTE: "/api/auth" is inlined by design — Better-Auth's client hardcodes
// this path internally, so a shared constant would be a false SSOT. See
// docs/superpowers/specs/2026-04-18-zero-conf-architecture-design.md §D3.
//
// NOTE: `app.use` (not `app.on`) is required here. `app.on(["POST","GET"], "/api/auth/**")`
// breaks Hono's TrieRouter when `@bull-board/hono` is mounted via `app.route()` —
// the `**` wildcard and `*` wildcard from Bull Board's serveStatic route conflict
// in the TrieRouter, silently returning 0 matches for all auth endpoints. `app.use`
// registers with method=ALL and its wildcard semantics are handled separately,
// avoiding the conflict. See the bug analysis in the admin-gate e2e test PR.
app.use("/api/auth/*", (c) => {
  return auth.handler(c.req.raw);
});

// Todo file I/O — domain-owned Hono sub-app.
app.route("/api/todos", todoHttpRouter);

// Reference webhook route — rate-limited by client IP.
// See apps/server/src/webhooks/example.ts for the pattern.
app.route("/webhooks", exampleWebhookRouter);

// tRPC handler — pass session into context.
// NOTE: "/trpc" is inlined by design — ≤2 call sites and no library
// coupling. See docs/superpowers/specs/2026-04-18-zero-conf-architecture-design.md §D3.
app.use(
  "/trpc/*",
  trpcServer({
    router: appRouter,
    createContext: async (_opts, c) => {
      const session = await auth.api.getSession({
        headers: c.req.raw.headers,
      });
      return createContext({ session });
    },
  }),
);

// requireAdmin applies to the whole /admin subtree. Do NOT place any
// other /admin/* route above this line.
app.use("/admin/*", requireAdmin(auth));

const bullBoardAdapter = createBullBoardAdapter();
app.route("/admin/queues", bullBoardAdapter.registerPlugin());

// hostname "0.0.0.0" is mandatory for container runtimes — binding to the
// default (localhost/::1) leaves the server unreachable from Traefik, Docker
// networks, or any host that isn't the container itself. Enforced by
// scripts/check-server-bind.ts.
const httpServer = serve(
  { fetch: app.fetch, port: env.PORT, hostname: "0.0.0.0" },
  (info) => {
    logger.info(`Server running at http://localhost:${info.port}`);
  },
);

// WebSocket server for tRPC subscriptions.
// Piggybacks on the same port as the HTTP server — the Node http.Server
// dispatches "upgrade" events to the WebSocketServer before Hono sees them.
const wss = new WebSocketServer({
  server: httpServer as Server,
  path: "/trpc-ws",
});

function incomingMessageToHeaders(req: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const v of value) headers.append(key, v);
    } else {
      headers.set(key, value);
    }
  }
  return headers;
}

const wsHandler = applyWSSHandler({
  wss,
  router: appRouter,
  createContext: async ({ req }: CreateWSSContextFnOptions) => {
    const session = await auth.api.getSession({
      headers: incomingMessageToHeaders(req),
    });
    return createContext({ session });
  },
});

process.on("SIGTERM", () => {
  wsHandler.broadcastReconnectNotification();
  wss.close();
});
