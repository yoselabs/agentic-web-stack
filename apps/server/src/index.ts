import { randomBytes } from "node:crypto";
import { createReadStream, mkdirSync, unlink, writeFile } from "node:fs";
import { join, resolve } from "node:path";
import { serve } from "@hono/node-server";
import { trpcServer } from "@hono/trpc-server";
import { createContext } from "@project/api/context";
import { MAX_CHAT_FILE_BYTES } from "@project/api/domains/chat/constants";
import { MAX_UPLOAD_BYTES } from "@project/api/domains/todo/constants";
import {
  exportTodosAsCSV,
  importTodosFromCSV,
} from "@project/api/domains/todo/service";
import { appRouter } from "@project/api/router";
import { auth } from "@project/auth";
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

// Better-Auth handler.
// NOTE: "/api/auth" is inlined by design — Better-Auth's client hardcodes
// this path internally, so a shared constant would be a false SSOT. See
// docs/superpowers/specs/2026-04-18-zero-conf-architecture-design.md §D3.
app.on(["POST", "GET"], "/api/auth/**", (c) => {
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

if (env.ENABLE_CHAT) {
  const FILES_DIR = resolve(process.cwd(), "var/files");
  mkdirSync(FILES_DIR, { recursive: true });

  app.post("/files", async (c) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: "Unauthorized" }, 401);

    const form = await c.req.formData();
    const file = form.get("file");
    if (!(file instanceof File))
      return c.json({ error: "No file provided" }, 400);
    if (file.size > MAX_CHAT_FILE_BYTES)
      return c.json({ error: "File too large (max 10 MB)" }, 413);

    const id = `f_${randomBytes(16).toString("hex")}`;
    const path = join(FILES_DIR, id);
    const buf = Buffer.from(await file.arrayBuffer());

    await new Promise<void>((ok, fail) =>
      writeFile(path, buf, (err) => (err ? fail(err) : ok())),
    );

    try {
      const record = await db.chatFile.create({
        data: {
          id,
          storedPath: path,
          filename: file.name || "attachment",
          mimeType: file.type || "application/octet-stream",
          size: file.size,
          uploadedBy: session.user.id,
        },
      });
      return c.json(
        {
          fileId: record.id,
          filename: record.filename,
          size: record.size,
          mimeType: record.mimeType,
        },
        201,
      );
    } catch (err) {
      // Roll back on DB failure
      unlink(path, () => {});
      throw err;
    }
  });

  app.get("/files/:id", async (c) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: "Unauthorized" }, 401);

    const id = c.req.param("id");
    const accessible = await db.chatMessage.findFirst({
      where: {
        fileId: id,
        room: { memberships: { some: { userId: session.user.id } } },
      },
    });
    if (!accessible) return c.json({ error: "Not found" }, 404);

    const file = await db.chatFile.findUnique({ where: { id } });
    if (!file) return c.json({ error: "Not found" }, 404);

    const safeName =
      (file.filename ?? file.id).replace(/[\r\n"\\]/g, "").trim() || file.id;

    return new Response(createReadStream(file.storedPath) as never, {
      headers: {
        "Content-Type": file.mimeType,
        "Content-Disposition": `attachment; filename="${safeName}"`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}

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

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  logger.info(`Server running at http://localhost:${info.port}`);
});
