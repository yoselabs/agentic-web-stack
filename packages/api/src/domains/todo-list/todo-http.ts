import { zValidator } from "@hono/zod-validator";
import { auth } from "@project/auth";
import { db } from "@project/db";
import { Hono } from "hono";
import { z } from "zod";
import { CSV_MIME_TYPES, MAX_UPLOAD_BYTES } from "./todo-constants.js";
import { exportTodosAsCSV, importTodosFromCSV } from "./todo-service.js";

// Scalar-only schema: todoListId is validated by zValidator so hc propagates
// its input type to the client. The file itself is checked manually in the
// handler because z.instanceof(File) is unreliable across Node runtimes
// (undici's File vs. global File can differ at the constructor level,
// causing false-negative instanceof). This split preserves hc's typed
// `form: { todoListId }` input while keeping the File check robust.
const importFormSchema = z.object({ todoListId: z.string().min(1) });
const exportSchema = z.object({ todoListId: z.string().min(1) });

export const todoHttpRouter = new Hono()
  .post("/import", zValidator("form", importFormSchema), async (c) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: "Unauthorized" }, 401);

    const { todoListId } = c.req.valid("form");

    // parseBody() re-reads the multipart body; zValidator already consumed it
    // once for the scalar field, but Hono's bodyCache makes this cheap.
    // Returns File | string | null per field.
    const body = await c.req.parseBody();
    const file = body.file;

    if (!(file instanceof File)) {
      return c.json({ error: "No file provided" }, 400);
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return c.json({ error: "File too large (max 10 MB)" }, 413);
    }
    const mimeOk =
      CSV_MIME_TYPES.has(file.type) || file.name.toLowerCase().endsWith(".csv");
    if (!mimeOk) {
      return c.json({ error: "Only CSV files are accepted" }, 400);
    }

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
  })
  .get("/export", zValidator("query", exportSchema), async (c) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: "Unauthorized" }, 401);

    const { todoListId } = c.req.valid("query");
    const csv = await exportTodosAsCSV(db, session.user.id, todoListId);
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": 'attachment; filename="todos.csv"',
      },
    });
  });

export type TodoHttpRouter = typeof todoHttpRouter;
