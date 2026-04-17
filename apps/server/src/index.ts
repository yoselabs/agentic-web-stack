import { serve } from "@hono/node-server";
import { trpcServer } from "@hono/trpc-server";
import {
  appRouter,
  createContext,
  exportTodosAsCSV,
  importTodosFromCSV,
} from "@project/api";
import { auth } from "@project/auth";
import { AUTH_MOUNT, MAX_UPLOAD_BYTES, TRPC_MOUNT } from "@project/config";
import { db } from "@project/db";
import { env } from "@project/env/server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";

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

// Better-Auth handler
app.on(["POST", "GET"], `${AUTH_MOUNT}/**`, (c) => {
  return auth.handler(c.req.raw);
});

// Todo import — multipart CSV
app.post("/api/todos/import", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "Unauthorized" }, 401);

  const formData = await c.req.formData();
  const file = formData.get("file");
  if (!(file instanceof File))
    return c.json({ error: "No file provided" }, 400);

  if (file.size > MAX_UPLOAD_BYTES) {
    return c.json({ error: "File too large (max 10 MB)" }, 413);
  }

  const isCSV =
    file.type === "text/csv" ||
    file.type === "application/vnd.ms-excel" ||
    file.name.endsWith(".csv");
  if (!isCSV) {
    return c.json({ error: "Only CSV files are accepted" }, 400);
  }

  const todoListId = formData.get("todoListId");
  if (typeof todoListId !== "string")
    return c.json({ error: "todoListId is required" }, 400);

  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    const result = await db.$transaction((tx) =>
      importTodosFromCSV(tx, session.user.id, buffer, todoListId),
    );
    return c.json(result, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Import failed";
    return c.json({ error: message }, 400);
  }
});

// Todo export — CSV download
app.get("/api/todos/export", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "Unauthorized" }, 401);

  const todoListId = c.req.query("todoListId");
  if (!todoListId) return c.json({ error: "todoListId is required" }, 400);

  const csv = await exportTodosAsCSV(db, session.user.id, todoListId);

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": 'attachment; filename="todos.csv"',
    },
  });
});

// tRPC handler — pass session into context
app.use(
  `${TRPC_MOUNT}/*`,
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

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  logger.info(`Server running at http://localhost:${info.port}`);
});
