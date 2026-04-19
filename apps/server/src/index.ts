import { serve } from "@hono/node-server";
import { trpcServer } from "@hono/trpc-server";
import { createContext } from "@project/api/context";
import { todoHttpRouter } from "@project/api/domains/todo/http";
import { appRouter } from "@project/api/router";
import { auth } from "@project/auth";
import { db } from "@project/db";
import { env } from "@project/env/server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { createBullBoardAdapter } from "./admin/bull-board.js";
import { requireAdmin } from "./admin/middleware.js";
import { logger } from "./logger.js";

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

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  logger.info(`Server running at http://localhost:${info.port}`);
});
