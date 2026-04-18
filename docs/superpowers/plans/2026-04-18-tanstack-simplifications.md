# TanStack Simplifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land four independent simplifications from `docs/superpowers/specs/2026-04-18-tanstack-simplifications-design.md` — drop the `start-client-core` type shim (A1), relocate the todo file-I/O Hono routing into the domain and consume it via a typed `hc` client (B1), replace the `useEffect`-redirect auth guard with `beforeLoad` + server-side session (A2), and rewrite `login.tsx` on TanStack Form + Zod (B2).

**Architecture:** Each piece is its own commit with `make lint && make test && make test-unit` green. Land order: A1 → B1 → A2 → B2 (per spec "Ordering and dependencies"). No server consolidation, no tRPC over multipart, no new auth backend — the existing two-app layout is preserved.

**Tech Stack:** TanStack Start 1.167, TanStack Router 1.168, TanStack React Query 5, Hono 4.7, tRPC 11, Better-Auth 1.6, Prisma 6, Zod 3, Bun test, Playwright-BDD.

---

## Task 0: Preflight — version probes

Resolve the Open Questions from the spec before touching code. All answers go into the commit bodies of the subsequent tasks; no standalone commit.

**Files:** none modified in this task.

- [ ] **Step 0.1: Confirm installed versions**

Run:
```bash
pnpm why -r @tanstack/react-start @tanstack/start-client-core @tanstack/react-router @tanstack/react-form 2>&1 | head -60
```

Expected: `@tanstack/react-start@1.167.x`, `@tanstack/react-router@1.168.x`, `@tanstack/start-client-core@1.167.x` present on `apps/web`; `@tanstack/react-form` **not** present (installed in Task 4).

Record the exact versions in a scratch note for Task 4's dep pin.

- [ ] **Step 0.2: Probe Better-Auth `/api/auth/get-session` response shape**

Start dev stack:
```bash
make dev
```

In a second shell, create a user and probe:
```bash
curl -s -c /tmp/cookies.txt -X POST http://localhost:3001/api/auth/sign-up/email \
  -H "Content-Type: application/json" \
  -d '{"email":"probe@example.com","password":"probe12345","name":"Probe"}'

echo "--- logged-in ---"
curl -s -b /tmp/cookies.txt http://localhost:3001/api/auth/get-session

echo "--- logged-out ---"
curl -s http://localhost:3001/api/auth/get-session
```

Expected "logged-in" output: JSON with `{ "user": { "id": ..., "email": ..., "name": ... }, "session": { ... } }`.
Expected "logged-out" output: `null` or `{}` with HTTP 200 (Better-Auth returns 200 + empty body / null when no session).

Record both shapes. The spec's `getSession` server-fn assumes `data?.user` distinguishes authed from unauthed — confirm by inspecting the actual bodies.

Stop `make dev`.

- [ ] **Step 0.3: Probe TanStack Start server-fn surface**

Check the installed package's exports:
```bash
node -e "console.log(Object.keys(require('@tanstack/react-start')))" 2>&1
node -e "console.log(Object.keys(require('@tanstack/react-start/server')))" 2>&1
```

Expected: `createServerFn` in `@tanstack/react-start`; `getHeaders` (or `getRequestHeaders` / `getEvent`) in `@tanstack/react-start/server`.

If `getHeaders` is absent, search installed types:
```bash
grep -rn "getHeaders\|getRequestHeaders" node_modules/@tanstack/react-start/dist/*.d.ts 2>/dev/null | head -20
```

Record the exact import name used for cookie access. Task 3 Step 3A uses whichever name is present.

- [ ] **Step 0.4: Confirm Hono `hc` + `zValidator` are installed on server**

```bash
pnpm why -r hono @hono/zod-validator 2>&1 | head -40
```

Expected: `hono@4.7.x` on `apps/server`. If `@hono/zod-validator` is not present, Task 2 adds it to `packages/api/package.json` dependencies.

Check `hono/client` exists:
```bash
node -e "console.log(typeof require('hono/client').hc)" 2>&1
```

Expected: `function`. If not present, upgrade Hono or use direct URL path in Task 2 Step 2E (fallback).

---

## Task 1: A1 — Drop `start-client-core` type shim

**Files:**
- Modify: `apps/web/src/routes/health.ts:1-19` (delete import + comment)
- Modify: `apps/web/package.json:27` (conditionally remove dep)

- [ ] **Step 1.1: Snapshot current state**

```bash
git status
```

Expected: clean working tree.

Read current `apps/web/src/routes/health.ts`:
```bash
cat apps/web/src/routes/health.ts
```

Confirm the file contains `import type {} from "@tanstack/start-client-core";` and the 4-line comment block above the `createFileRoute` call.

- [ ] **Step 1.2: Delete the shim**

Replace file contents with:

```ts
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/health")({
  server: {
    handlers: {
      GET: () =>
        Response.json({
          status: "ok",
          uptime: process.uptime(),
          timestamp: new Date().toISOString(),
        }),
    },
  },
});
```

- [ ] **Step 1.3: Verify TypeScript still accepts the `server:` key**

Run:
```bash
pnpm --filter @project/web exec tsc -b
```

Expected: exit code 0, no errors.

- [ ] **Step 1.4a (if Step 1.3 PASSED): Remove the dep**

Edit `apps/web/package.json` — delete the line:
```json
"@tanstack/start-client-core": "^1.167.16",
```

Run:
```bash
pnpm install
pnpm --filter @project/web exec tsc -b
```

Expected: exit code 0 on both commands.

- [ ] **Step 1.4b (if Step 1.3 FAILED): Restore a one-line shim**

Put back a **single** line (no comment) at the top of `apps/web/src/routes/health.ts`:

```ts
import type {} from "@tanstack/start-client-core";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/health")({
  server: {
    handlers: {
      GET: () =>
        Response.json({
          status: "ok",
          uptime: process.uptime(),
          timestamp: new Date().toISOString(),
        }),
    },
  },
});
```

Keep `@tanstack/start-client-core` in `apps/web/package.json`. Re-run `pnpm --filter @project/web exec tsc -b` to confirm green.

- [ ] **Step 1.5: Full quality gate**

```bash
make lint
```

Expected: all checks pass.

- [ ] **Step 1.6: Commit**

```bash
git add apps/web/src/routes/health.ts apps/web/package.json pnpm-lock.yaml
git commit -m "refactor(web): drop start-client-core type shim

Newer @tanstack/react-start types the route \`server:\` handler key
natively — the module-augmentation workaround is no longer needed.
Record 1.4a (dep removed) or 1.4b (one-line shim kept) in the commit
body based on whether tsc accepted the deletion.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: B1 — Todo HTTP domain relocation + typed `hc` client

This piece has the most moving parts. All changes land as **one commit** at Step 2.10 (spec acceptance: each piece independently commits green).

**Files:**
- Modify: `packages/api/src/domains/todo/constants.ts` (add `CSV_MIME_TYPES`)
- Create: `packages/api/src/domains/todo/http.ts`
- Create: `packages/api/src/domains/todo/__tests__/http.test.ts`
- Modify: `packages/api/package.json` (add `./domains/todo/http` export; add `@hono/zod-validator` dep if absent)
- Modify: `apps/server/src/index.ts:1-17, 94-148` (remove old handlers, add mount)
- Modify: `apps/server/package.json` (ensure `@hono/zod-validator` available if the import lives here instead — see 2.2)
- Create: `apps/web/src/shared/todo-http-client.ts`
- Modify: `apps/web/src/features/todo/use-todos.ts:124-164` (consumer rewrite)

- [ ] **Step 2.1: Add `CSV_MIME_TYPES` to the domain constants**

Current `packages/api/src/domains/todo/constants.ts` only has `MAX_UPLOAD_BYTES` and its comment lists `apps/server/src/index.ts` + `apps/web/src/features/todo/use-todos.ts` as consumers. Both of those callers are removed/rewritten by later steps in this task (Step 2.7 + Step 2.10). Update the consumer list in the comment to reflect the end state:

```ts
// Todo domain constants. Client-safe primitives only — never import
// server modules (services, Prisma) from this file; if you do, the
// web bundle will silently pull in server code.
//
// Consumed by:
// - packages/api/src/domains/todo/http.ts (multipart validation)

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

export const CSV_MIME_TYPES: ReadonlySet<string> = new Set([
  "text/csv",
  "application/vnd.ms-excel",
]);
```

- [ ] **Step 2.2: Add `@hono/zod-validator` dep to `packages/api`**

Check if already present:
```bash
grep '"@hono/zod-validator"' packages/api/package.json
```

If absent, add under `dependencies` in `packages/api/package.json`:
```json
"@hono/zod-validator": "^0.4.0",
```

Also add `hono` itself (domain code imports it):
```json
"hono": "^4.7.0",
```

Run:
```bash
pnpm install
```

Verify:
```bash
pnpm --filter @project/api exec tsc --noEmit 2>&1 | head
```

Expected: exit code 0 (package.json change alone shouldn't break types).

- [ ] **Step 2.3: Write the failing unit tests for `todoHttpRouter`**

Create `packages/api/src/domains/todo/__tests__/http.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { db } from "@project/db";
import { todoHttpRouter } from "../http.js";

const TEST_USER_ID = "test-user-todo-http";
const TEST_USER = {
  id: TEST_USER_ID,
  name: "HTTP Test User",
  email: "test-todo-http@example.com",
  emailVerified: false,
  image: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

let TEST_LIST_ID: string;
let TEST_SESSION_TOKEN: string;

beforeAll(async () => {
  await db.todo.deleteMany({ where: { userId: TEST_USER_ID } });
  await db.todoList.deleteMany({ where: { userId: TEST_USER_ID } });
  await db.session.deleteMany({ where: { userId: TEST_USER_ID } });
  await db.account.deleteMany({ where: { userId: TEST_USER_ID } });
  await db.user.deleteMany({ where: { id: TEST_USER_ID } });

  await db.user.create({ data: TEST_USER });

  const session = await db.session.create({
    data: {
      id: "test-session-todo-http",
      token: "test-token-todo-http",
      userId: TEST_USER_ID,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      ipAddress: null,
      userAgent: null,
    },
  });
  TEST_SESSION_TOKEN = session.token;

  const list = await db.todoList.create({
    data: { userId: TEST_USER_ID, name: "HTTP test list", position: 0 },
  });
  TEST_LIST_ID = list.id;
});

afterAll(async () => {
  await db.todo.deleteMany({ where: { userId: TEST_USER_ID } });
  await db.todoList.deleteMany({ where: { userId: TEST_USER_ID } });
  await db.session.deleteMany({ where: { userId: TEST_USER_ID } });
  await db.account.deleteMany({ where: { userId: TEST_USER_ID } });
  await db.user.deleteMany({ where: { id: TEST_USER_ID } });
});

function authCookie(): string {
  // Better-Auth cookie name convention: `better-auth.session_token`
  return `better-auth.session_token=${TEST_SESSION_TOKEN}`;
}

function buildImportRequest(csv: string, todoListId: string): Request {
  const form = new FormData();
  form.set("file", new File([csv], "todos.csv", { type: "text/csv" }));
  form.set("todoListId", todoListId);
  return new Request("http://test/import", {
    method: "POST",
    body: form,
    headers: { cookie: authCookie() },
  });
}

describe("todoHttpRouter POST /import", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const form = new FormData();
    form.set("file", new File(["title\nfoo"], "t.csv", { type: "text/csv" }));
    form.set("todoListId", TEST_LIST_ID);
    const res = await todoHttpRouter.request("/import", {
      method: "POST",
      body: form,
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Unauthorized");
  });

  it("rejects missing todoListId with 400", async () => {
    const form = new FormData();
    form.set("file", new File(["title\nfoo"], "t.csv", { type: "text/csv" }));
    const res = await todoHttpRouter.request("/import", {
      method: "POST",
      body: form,
      headers: { cookie: authCookie() },
    });
    expect(res.status).toBe(400);
  });

  it("rejects non-CSV files with 400", async () => {
    const form = new FormData();
    form.set("file", new File(["<html>"], "t.html", { type: "text/html" }));
    form.set("todoListId", TEST_LIST_ID);
    const res = await todoHttpRouter.request("/import", {
      method: "POST",
      body: form,
      headers: { cookie: authCookie() },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Only CSV files are accepted");
  });

  it("accepts .CSV extension case-insensitively", async () => {
    const form = new FormData();
    form.set(
      "file",
      new File(["title\nfoo"], "TODOS.CSV", { type: "application/octet-stream" }),
    );
    form.set("todoListId", TEST_LIST_ID);
    const res = await todoHttpRouter.request("/import", {
      method: "POST",
      body: form,
      headers: { cookie: authCookie() },
    });
    expect(res.status).toBe(201);
  });

  it("imports valid CSV and returns count", async () => {
    await db.todo.deleteMany({ where: { userId: TEST_USER_ID } });
    const csv = "title\nalpha\nbeta\n";
    const res = await todoHttpRouter.request(buildImportRequest(csv, TEST_LIST_ID));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { count: number };
    expect(body.count).toBe(2);
  });
});

describe("todoHttpRouter GET /export", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const res = await todoHttpRouter.request(
      `/export?todoListId=${TEST_LIST_ID}`,
    );
    expect(res.status).toBe(401);
  });

  it("rejects missing todoListId with 400", async () => {
    const res = await todoHttpRouter.request("/export", {
      headers: { cookie: authCookie() },
    });
    expect(res.status).toBe(400);
  });

  it("returns CSV with attachment disposition", async () => {
    const res = await todoHttpRouter.request(
      `/export?todoListId=${TEST_LIST_ID}`,
      { headers: { cookie: authCookie() } },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv");
    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="todos.csv"',
    );
    const body = await res.text();
    expect(body.split("\n")[0]).toContain("title");
  });
});
```

Do not run tests yet — the implementation (Step 2.4) hasn't landed.

- [ ] **Step 2.4: Create `packages/api/src/domains/todo/http.ts`**

Create the file exactly as specified in the design doc:

```ts
import { zValidator } from "@hono/zod-validator";
import { auth } from "@project/auth";
import { db } from "@project/db";
import { Hono } from "hono";
import { z } from "zod";
import { CSV_MIME_TYPES, MAX_UPLOAD_BYTES } from "./constants.js";
import { exportTodosAsCSV, importTodosFromCSV } from "./service.js";

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
      CSV_MIME_TYPES.has(file.type) ||
      file.name.toLowerCase().endsWith(".csv");
    if (!mimeOk) {
      return c.json({ error: "Only CSV files are accepted" }, 400);
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await db.$transaction((tx) =>
      importTodosFromCSV(tx, session.user.id, buffer, todoListId),
    );
    return c.json(result, 201);
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
```

- [ ] **Step 2.5: Add the subpath export to `packages/api/package.json`**

**Important:** this MUST land before any import site references `@project/api/domains/todo/http`, or the import resolves to the package root and explodes. The package-export edit + the `http.ts` file both go in before we modify `apps/server/src/index.ts`.

In `packages/api/package.json`, add under `"exports"`:

```json
    "./domains/todo/http": { "default": "./src/domains/todo/http.ts" },
```

Preserve alphabetical order inside the domain block; insert between `./domains/todo/constants` and `./domains/todo-list/service`.

- [ ] **Step 2.6: Run the unit tests**

```bash
make test-unit ARGS="todo/http"
```

Or if that filter isn't honored:
```bash
pnpm --filter @project/api test http
```

Expected: all 8 tests pass. If the `better-auth.session_token` cookie name is wrong (Step 2.3 uses a guess), the 401 and 201 tests fail together; inspect:
```bash
grep -rn "session_token\|cookieName" node_modules/better-auth/dist/*.d.ts 2>/dev/null | head
```

and update `authCookie()` in the test + re-run.

- [ ] **Step 2.7: Mount the sub-app in `apps/server/src/index.ts`**

Remove lines 94-148 (the two `app.post("/api/todos/import", ...)` and `app.get("/api/todos/export", ...)` handlers) and replace with a single mount. Also drop the now-unused imports.

Edit imports at the top of `apps/server/src/index.ts`:

```ts
// Remove these:
//   import { MAX_UPLOAD_BYTES } from "@project/api/domains/todo/constants";
//   import {
//     exportTodosAsCSV,
//     importTodosFromCSV,
//   } from "@project/api/domains/todo/service";

// Add:
import { todoHttpRouter } from "@project/api/domains/todo/http";
```

Where the old handlers lived (between the Better-Auth handler block and the tRPC handler block), put:

```ts
// Todo file I/O — domain-owned Hono sub-app.
app.route("/api/todos", todoHttpRouter);
```

- [ ] **Step 2.8: Verify the server typechecks and boots**

```bash
pnpm --filter @project/server exec tsc --noEmit
```

Expected: exit code 0.

```bash
make dev &
sleep 8
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3001/api/todos/export?todoListId=dummy
```

Expected: `401` (unauthenticated). A 404 means the mount path is wrong.

Stop the dev server.

- [ ] **Step 2.9: Create the typed web client**

Create `apps/web/src/shared/todo-http-client.ts`:

```ts
import type { TodoHttpRouter } from "@project/api/domains/todo/http";
import { hc } from "hono/client";
import { apiClient } from "./api-client";

// `apiClient.baseUrl` is the bare origin (no trailing slash, no path) per
// `api-client.ts`. hc's first arg is the path prefix for this router and
// must match the server-side mount `app.route("/api/todos", todoHttpRouter)`.
// `fetch: apiClient.fetch` inherits credentials:"include" + base-URL rules,
// keeping the "all HTTP via apiClient" rule from apps/web/CLAUDE.md.
export const todoHttpClient = hc<TodoHttpRouter>(
  `${apiClient.baseUrl}/api/todos`,
  { fetch: apiClient.fetch },
);
```

The `import type` is non-negotiable — a value import pulls `@project/auth` → `@project/db` → Prisma into the web bundle.

Add `hono` as a dep of `apps/web` (for the `hono/client` subpath):

```bash
pnpm --filter @project/web add hono@^4.7.0
```

- [ ] **Step 2.10: Rewrite `use-todos.ts` consumers**

In `apps/web/src/features/todo/use-todos.ts`:

Remove the import:
```ts
// Remove:
//   import { MAX_UPLOAD_BYTES } from "@project/api/domains/todo/constants";
//   import { apiClient } from "#/shared/api-client";
```

Add:
```ts
import { todoHttpClient } from "#/shared/todo-http-client";
```

Replace lines 124-147 (the `importTodos` mutation) with:

```ts
  const importTodos = useMutation({
    mutationFn: async (file: File) => {
      const res = await todoHttpClient.import.$post({
        form: { file, todoListId },
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error ?? "Import failed");
      }
      return (await res.json()) as { count: number };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries(trpc.todo.list.queryFilter({ todoListId }));
      toast.success(`Imported ${data.count} todos`);
    },
    onError: (err: Error) => toast.error(err.message),
  });
```

Replace lines 149-164 (the `exportTodos` function) with:

```ts
  const exportTodos = async () => {
    const res = await todoHttpClient.export.$get({ query: { todoListId } });
    if (!res.ok) {
      toast.error("Export failed");
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "todos.csv";
    a.click();
    URL.revokeObjectURL(url);
  };
```

The client-side `file.size > MAX_UPLOAD_BYTES` pre-check is removed — the server is the authoritative boundary.

- [ ] **Step 2.11: Full quality gate**

```bash
make lint
make test-unit
make test ARGS="--grep 'Import todos from CSV'"
make test ARGS="--grep 'Export todos as CSV'"
```

Expected: all green. If a BDD scenario fails on a mismatched selector or URL, the fault is in Step 2.7's mount path or the test's cookie name, not the spec.

- [ ] **Step 2.12: Server-bundle hygiene smoke check**

```bash
pnpm --filter @project/web build 2>&1 | tail -20
```

Expected: build succeeds. If a chunk pulls in `@project/auth` / `@project/db` / `papaparse`, the `import type` discipline leaked somewhere — most likely a missing `type` keyword in `todo-http-client.ts`. Preflight grep (smoke; not the gate per spec):

```bash
cd apps/web/dist && grep -l "better-auth\|@prisma/client\|papaparse" assets/*.js 2>/dev/null
cd - >/dev/null
```

Expected: no output. The spec's gate is the lint rule (Task 5 if added) + bundle analyzer; this grep is a fast preflight only.

- [ ] **Step 2.13: Commit**

```bash
git add packages/api/src/domains/todo/constants.ts \
        packages/api/src/domains/todo/http.ts \
        packages/api/src/domains/todo/__tests__/http.test.ts \
        packages/api/package.json \
        apps/server/src/index.ts \
        apps/web/src/shared/todo-http-client.ts \
        apps/web/src/features/todo/use-todos.ts \
        apps/web/package.json \
        pnpm-lock.yaml
git commit -m "refactor(todo): relocate import/export routing into domain

Move POST /api/todos/import and GET /api/todos/export from raw Hono
handlers in apps/server/src/index.ts into packages/api/src/domains/todo/
http.ts — a Hono sub-app owned by the todo domain. apps/server now
mounts it with app.route(), collapsing 50 lines of routing + validation
+ auth to one line. apps/web consumes via hc<TodoHttpRouter> (typed
Hono RPC client) through apiClient.fetch, preserving the credentials +
base-URL rule.

Split validator strategy for /import: zValidator(\"form\", ...) covers the
scalar todoListId so hc propagates its input type to the client;
parseBody() + manual instanceof File covers the file itself (undici
File vs global File makes z.instanceof unreliable).

Case-sensitivity on .CSV accepted intentionally relaxed (was
case-sensitive); URLs, payloads, status codes, error body shape all
preserved — revert is safe.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: A2 — `beforeLoad` auth guard via server-fn

**Files:**
- Create: `apps/web/src/shared/session.ts`
- Modify: `apps/web/src/router.tsx:49-56` (seed `session: null` in context)
- Modify: `apps/web/src/routes/__root.tsx:19-24` (extend `RouterContext`; add root `beforeLoad`)
- Modify: `apps/web/src/routes/_authenticated.tsx` (drop `useEffect`, add `beforeLoad`)
- Modify: `apps/web/src/routes/login.tsx:30-34, 61` (drop redirect-useEffect + `if (session) return null`)

- [ ] **Step 3.1: Create `apps/web/src/shared/session.ts`**

Use the `createServerFn` / `getHeaders` names confirmed in Task 0 Step 0.3. The snippet below uses `getHeaders` from `@tanstack/react-start/server`; swap if the probe revealed a different name.

```ts
import { createServerFn } from "@tanstack/react-start";
import { getHeaders } from "@tanstack/react-start/server";
import { apiClient } from "./api-client";

export type SessionData =
  | { user: { id: string; email: string; name: string | null } }
  | null;

export const getSession = createServerFn({ method: "GET" }).handler(
  async (): Promise<SessionData> => {
    const raw = getHeaders().cookie;
    // getHeaders() delegates to h3/Nitro; under some proxy configurations
    // cookie headers arrive as string[]. Coerce to a single string so the
    // downstream fetch always sends a well-formed Cookie header.
    const cookie = Array.isArray(raw) ? raw.join("; ") : (raw ?? "");
    if (!cookie) return null;
    const res = await apiClient.fetch("/api/auth/get-session", {
      headers: { cookie },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as
      | { user?: { id: string; email: string; name: string | null } }
      | null;
    return data?.user ? { user: data.user } : null;
  },
);
```

If Step 0.2's probe showed a different envelope (e.g. `/api/auth/get-session` returns the user at the top level rather than under `user`), adjust the parse shape and the `SessionData` type accordingly. Keep `SessionData` narrow — only fields the UI needs.

- [ ] **Step 3.2: Extend `RouterContext` in `__root.tsx`**

Edit `apps/web/src/routes/__root.tsx` at the `RouterContext` interface (around line 19):

```ts
import type { SessionData } from "#/shared/session";
import { getSession } from "#/shared/session";
// ... other imports stay the same

export interface RouterContext {
  trpc: TRPCOptionsProxy<AppRouter>;
  queryClient: QueryClient;
  session: SessionData;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  beforeLoad: async () => {
    const session = await getSession();
    return { session };
  },
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Agentic Web Stack" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  shellComponent: RootDocument,
  notFoundComponent: NotFound,
  errorComponent: RootError,
});
```

The root `beforeLoad`'s return value merges into all descendant route contexts.

- [ ] **Step 3.3: Seed `session: null` in `router.tsx`**

Edit `apps/web/src/router.tsx` at the `createTanStackRouter` call (around line 49):

```ts
  const router = createTanStackRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: "intent",
    defaultPendingMs: 200,
    defaultPendingMinMs: 300,
    context: { trpc, queryClient, session: null },
  });
```

Without the seed, TypeScript complains that `context` is missing the `session` field required by `RouterContext`.

- [ ] **Step 3.4: Rewrite `_authenticated.tsx`**

Replace the entire file `apps/web/src/routes/_authenticated.tsx`:

```tsx
import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";
import { Navbar } from "#/widgets/navbar";

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: ({ context }) => {
    if (!context.session) throw redirect({ to: "/login" });
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  return (
    <div className="min-h-screen">
      <Navbar />
      <Outlet />
    </div>
  );
}
```

Gone: `useSession`, `useNavigate`, `useEffect`, `isPending` branch, "Loading…" shell, `if (!session) return null` no-op.

- [ ] **Step 3.5: Drop the redirect-if-logged-in useEffect in `login.tsx`**

Edit `apps/web/src/routes/login.tsx`. Keep the form body exactly as-is (TanStack Form rewrite is Task 4). Only touch the route definition and the redirect hack:

Replace the route definition at line 16:

```tsx
export const Route = createFileRoute("/login")({
  beforeLoad: ({ context }) => {
    if (context.session) throw redirect({ to: "/dashboard" });
  },
  component: LoginPage,
});
```

Add `redirect` to the imports:

```tsx
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
```

Inside `LoginPage`, **remove**:
- The `const { data: session } = useSession();` line
- The `useEffect(() => { if (session) navigate({ to: "/dashboard" }); }, [session, navigate])` block
- The `if (session) return null;` guard at line 61

Keep:
- All form state (`email`, `password`, `name`, `error`, `isSignUp` `useState`s) — Task 4 replaces these
- The `handleSubmit` and its `navigate({ to: "/dashboard" })` success branch
- All JSX

Remove the `useSession` import:
```tsx
import { signIn, signUp } from "#/features/auth/auth-client";
```

Remove unused `useEffect` from the React import if no other `useEffect` remains in the file.

- [ ] **Step 3.6: Typecheck web**

```bash
pnpm --filter @project/web exec tsc -b
```

Expected: exit code 0. Common failure: `context` in `createTanStackRouter` doesn't accept `session: null` — means the `RouterContext` type wasn't updated in Step 3.2. Re-check.

- [ ] **Step 3.7: SSR-no-refetch manual verification**

Start the full stack:
```bash
make dev
```

In a browser: open DevTools → Network tab → filter `get-session`. Sign up a test user via the UI, navigate to `/dashboard`, **reload** the page.

Expected on the reload (the initial-SSR case the spec pins):
- Zero browser requests to `/api/auth/get-session` during the first paint.
- The server logs in the `make dev` output show exactly one `GET /api/auth/get-session` (from the web Nitro to the Hono server) for the reload.

If the browser **does** issue a `/api/auth/get-session` request during first paint, the fallback is to gate the server-fn call on `typeof window === "undefined"` inside `session.ts` and manage the cache in `router.tsx` instead. Document the observed behavior in the commit message either way.

Also measure client-nav behavior (spec calls this out as a "characterize, don't constrain" item):
- From `/dashboard`, click a link to `/todo-lists`. Watch the Network tab.
- Record whether a new `/api/auth/get-session` fires from the browser. Either outcome is acceptable; note it in the commit body.

Stop `make dev`.

- [ ] **Step 3.8: Full quality gate**

```bash
make lint
make test-unit
make test
```

Expected: all green. The existing `e2e/features/auth.feature` and `e2e/features/todos.feature` scenarios must still pass — the `beforeLoad` guard is transparent to user-flow tests.

- [ ] **Step 3.9: Commit**

```bash
git add apps/web/src/shared/session.ts \
        apps/web/src/router.tsx \
        apps/web/src/routes/__root.tsx \
        apps/web/src/routes/_authenticated.tsx \
        apps/web/src/routes/login.tsx
git commit -m "refactor(web): server-side auth guard via beforeLoad

Replace the useEffect(() => navigate({ to: \"/login\" })) pattern in
_authenticated.tsx and login.tsx with TanStack Router's beforeLoad +
throw redirect(). Session is loaded by a new Start createServerFn that
forwards the incoming Cookie header to the Hono server's
/api/auth/get-session endpoint.

Removes: Loading… flash on authenticated navigations, the
if (!session) return null no-op render, the useEffect-in-render
pattern root CLAUDE.md warns against. Keeps useSession() client-side
for reactive UI (UserBlock greeting).

SSR behavior measured during step 3.7: [record observed behavior —
initial-load refetch (yes/no), client-nav refetch (yes/no)].

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: B2 — `login.tsx` with TanStack Form + Zod

**Files:**
- Modify: `apps/web/package.json` (add `@tanstack/react-form`)
- Modify: `apps/web/src/routes/login.tsx` (form body rewrite)

- [ ] **Step 4.1: Pin and install `@tanstack/react-form`**

Check current parallel-release version with installed TanStack deps:
```bash
npm view @tanstack/react-form@latest version
```

Install:
```bash
pnpm --filter @project/web add @tanstack/react-form@^<pinned-version>
```

Record the pinned version.

- [ ] **Step 4.2: Decide validator-adapter path**

Check whether the installed version supports standard-schema (Zod directly):
```bash
grep -rn "standardSchema\|StandardSchema" node_modules/@tanstack/react-form/dist/*.d.ts 2>/dev/null | head
```

Expected: matches found → standard-schema path (pass `loginSchema` directly to `validators.onChange`). If nothing found → add `@tanstack/zod-form-adapter`:
```bash
pnpm --filter @project/web add @tanstack/zod-form-adapter@^<compatible-version>
```

Record the path chosen.

- [ ] **Step 4.3: Inspect form-level error API on the installed version**

```bash
grep -n "setErrorMap\|formError\|errorMap" node_modules/@tanstack/react-form/dist/*.d.ts 2>/dev/null | head -30
```

One of three outcomes:
- `setErrorMap({ onSubmit: ... })` present → use it.
- Returning an error from `onSubmit` is supported → return a string from the submit handler.
- Neither is clean → use the fallback: local `useState<string | null>` (spec's B2 fallback).

Record the chosen approach.

- [ ] **Step 4.4: Rewrite `login.tsx`**

This is the version using the standard-schema path + `useState` fallback for form-level errors (the most conservative combo; pivot to `setErrorMap` or submit-return if Step 4.3 showed clean support).

```tsx
import { MIN_PASSWORD_LENGTH } from "@project/auth/constants";
import { Button } from "@project/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@project/ui/components/card";
import { Input } from "@project/ui/components/input";
import { Label } from "@project/ui/components/label";
import { useForm } from "@tanstack/react-form";
import {
  createFileRoute,
  redirect,
  useNavigate,
} from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { signIn, signUp } from "#/features/auth/auth-client";

export const Route = createFileRoute("/login")({
  beforeLoad: ({ context }) => {
    if (context.session) throw redirect({ to: "/dashboard" });
  },
  component: LoginPage,
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(MIN_PASSWORD_LENGTH),
  name: z.string().optional(),
});

function LoginPage() {
  const navigate = useNavigate();
  const [isSignUp, setIsSignUp] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm({
    defaultValues: { email: "", password: "", name: "" },
    validators: { onChange: loginSchema },
    onSubmit: async ({ value }) => {
      setFormError(null);
      if (isSignUp) {
        const result = await signUp.email({
          email: value.email,
          password: value.password,
          name: value.name || value.email.split("@")[0],
        });
        if (result.error) {
          setFormError(result.error.message ?? "Sign up failed");
          return;
        }
      } else {
        const result = await signIn.email({
          email: value.email,
          password: value.password,
        });
        if (result.error) {
          setFormError(result.error.message ?? "Sign in failed");
          return;
        }
      }
      navigate({ to: "/dashboard" });
    },
  });

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">
            {isSignUp ? "Create Account" : "Sign In"}
          </CardTitle>
          <CardDescription>
            {isSignUp
              ? "Enter your details to create an account"
              : "Enter your credentials to sign in"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              form.handleSubmit();
            }}
            className="space-y-4"
          >
            {isSignUp && (
              <form.Field name="name">
                {(field) => (
                  <div className="space-y-2">
                    <Label htmlFor={field.name}>Name</Label>
                    <Input
                      id={field.name}
                      type="text"
                      placeholder="Your name"
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                    />
                  </div>
                )}
              </form.Field>
            )}

            <form.Field name="email">
              {(field) => (
                <div className="space-y-2">
                  <Label htmlFor={field.name}>Email</Label>
                  <Input
                    id={field.name}
                    type="email"
                    placeholder="you@example.com"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    required
                  />
                  {field.state.meta.errors.length > 0 && (
                    <p className="text-sm text-destructive">
                      {String(field.state.meta.errors[0])}
                    </p>
                  )}
                </div>
              )}
            </form.Field>

            <form.Field name="password">
              {(field) => (
                <div className="space-y-2">
                  <Label htmlFor={field.name}>Password</Label>
                  <Input
                    id={field.name}
                    type="password"
                    placeholder={`Min ${MIN_PASSWORD_LENGTH} characters`}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    required
                    minLength={MIN_PASSWORD_LENGTH}
                  />
                  {field.state.meta.errors.length > 0 && (
                    <p className="text-sm text-destructive">
                      {String(field.state.meta.errors[0])}
                    </p>
                  )}
                </div>
              )}
            </form.Field>

            {formError && (
              <p className="text-sm text-destructive">{formError}</p>
            )}

            <form.Subscribe selector={(s) => s.isSubmitting}>
              {(isSubmitting) => (
                <Button type="submit" className="w-full" disabled={isSubmitting}>
                  {isSignUp ? "Sign Up" : "Sign In"}
                </Button>
              )}
            </form.Subscribe>
          </form>

          <p className="mt-4 text-center text-sm text-muted-foreground">
            {isSignUp ? "Already have an account?" : "Don't have an account?"}{" "}
            <button
              type="button"
              onClick={() => {
                setIsSignUp(!isSignUp);
                setFormError(null);
              }}
              className="text-foreground underline underline-offset-4 hover:text-primary"
            >
              {isSignUp ? "Sign In" : "Sign Up"}
            </button>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
```

Notes on the rewrite:
- `isSignUp` and `formError` remain `useState` — spec explicitly keeps them; `isSignUp` is a mode switch, `formError` is the form-level fallback.
- Email and password get inline field errors from `loginSchema`; name is optional and unvalidated at field level.
- The submit button disables via `form.Subscribe` during submission — replaces the previous always-clickable button.
- The `beforeLoad` redirect from Task 3 Step 3.5 stays exactly as-is.

If Step 4.2 chose the adapter path, add:
```tsx
import { zodValidator } from "@tanstack/zod-form-adapter";
// ... inside useForm:
validatorAdapter: zodValidator(),
```

If Step 4.3 preferred `setErrorMap`, replace `setFormError(msg)` with whatever API the installed version exposes (and delete the `useState<formError>` + its render).

- [ ] **Step 4.5: Typecheck**

```bash
pnpm --filter @project/web exec tsc -b
```

Expected: exit code 0. Common failures:
- `Property 'Field' does not exist on type ...` → older `@tanstack/react-form` with different API shape; check `node_modules/@tanstack/react-form/dist/*.d.ts` for the correct render-prop pattern.
- `validators.onChange` expects a different shape → the schema-vs-function choice depends on version; `z.object({ ... }).parse` or `loginSchema.parse` may be needed instead of the schema object directly.

- [ ] **Step 4.6: Run the auth BDD scenarios**

```bash
make test ARGS="--grep 'Sign up'"
make test ARGS="--grep 'Sign in'"
make test ARGS="--grep 'Log in'"
```

Expected: all auth scenarios green. The Gherkin doesn't care whether the form is built on `useState` or TanStack Form as long as label text + button text + field names match; the rewrite preserves all three.

- [ ] **Step 4.7: Manual smoke test**

```bash
make dev
```

In the browser:
1. Visit `/login`. Enter an invalid email (`foo`). The field-level "Invalid email" error should appear inline.
2. Enter a password shorter than `MIN_PASSWORD_LENGTH`. Field-level error appears.
3. Submit with valid credentials. Navigates to `/dashboard`.
4. Submit with an existing email in sign-up mode. `formError` shows the Better-Auth message.

Stop `make dev`.

- [ ] **Step 4.8: Full quality gate**

```bash
make lint
make test-unit
make test
```

Expected: all green.

- [ ] **Step 4.9: Commit**

```bash
git add apps/web/src/routes/login.tsx apps/web/package.json pnpm-lock.yaml
git commit -m "refactor(web): rewrite login form on @tanstack/react-form

Replace the four useState + manual handleSubmit pattern with
useForm + a Zod loginSchema. Field-level validation runs on change;
form-level Better-Auth errors are surfaced via a local useState
(fallback pattern from the spec, chosen after checking the installed
react-form API). Submit button disables during submission.

Validator path: [standard-schema | @tanstack/zod-form-adapter] (record
per Step 4.2). Pinned version: @tanstack/react-form@<version>.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Final verification

- [ ] **Step 5.1: Verify each commit is green independently**

The spec's acceptance criterion: `make lint && make test && make test-unit` pass on each of the four piece commits independently.

```bash
# Starting from current HEAD (Task 4 commit):
git log --oneline -5
```

Expected (in reverse chronological order):
```
<sha4> refactor(web): rewrite login form on @tanstack/react-form
<sha3> refactor(web): server-side auth guard via beforeLoad
<sha2> refactor(todo): relocate import/export routing into domain
<sha1> refactor(web): drop start-client-core type shim
```

For each of the four SHAs, verify the tree is green:

```bash
for sha in <sha1> <sha2> <sha3> <sha4>; do
  git checkout "$sha"
  make lint && make test-unit || { echo "FAIL at $sha"; break; }
done
git checkout -
```

(Full BDD runs take minutes; run them on at least the latest commit.)

- [ ] **Step 5.2: Verify acceptance criteria from spec**

Check each acceptance criterion from the spec's "Acceptance criteria" section:

1. **No `useEffect` → `navigate()` on session state in `apps/web/src/`:**
   ```bash
   grep -rn "navigate.*to.*login\|navigate.*to.*dashboard" apps/web/src/routes/ | grep -v ".gen" | grep -v "beforeLoad"
   ```
   Expected: only occurrences inside event handlers (e.g., post-submit nav), never in a `useEffect`.

2. **`apps/server/src/index.ts` is a pure transport host:**
   ```bash
   grep -E "^import" apps/server/src/index.ts
   ```
   Expected: imports only from `@project/api/*`, `@project/auth`, `@project/env/server`, `@project/db`, `hono`, `@hono/*`, `@hono/node-server`, local `./logger.js`. No `@project/api/domains/*/service` imports.

3. **`use-todos.ts` has no hand-assembled `FormData` / string-path `apiClient.fetch`:**
   ```bash
   grep -n "FormData\|apiClient.fetch" apps/web/src/features/todo/use-todos.ts
   ```
   Expected: zero matches.

4. **`login.tsx` has zero `useState` for field values:**
   ```bash
   grep -n "useState" apps/web/src/routes/login.tsx
   ```
   Expected: only `isSignUp` and (if fallback chosen) `formError`. No `email`, `password`, `name`, `error` `useState`s.

5. **SSR-no-refetch:** recorded in Task 3 Step 3.7's commit body.

6. **Bundle hygiene lint gate:** check whether `agent-harness lint` flags value imports of `@project/api/domains/todo/http`:
   ```bash
   echo 'import { todoHttpRouter } from "@project/api/domains/todo/http";' > /tmp/leak-test.ts
   # Run agent-harness lint against the project and see if the rule fires.
   # If no rule exists yet, note it as a follow-up — the spec acknowledged
   # "enforced by existing rule or added to it."
   ```

7. **Per-commit green:** done in Step 5.1.

If any criterion fails, treat it as a scope gap: open a follow-up ticket; do not force-fix during this plan's execution without discussion.

- [ ] **Step 5.3: Announce completion**

No commit. Summarize to the user:
- Four commits landed; each green on `make lint && make test-unit`.
- SSR behavior observed: [copy from Task 3 Step 3.7].
- TanStack Form path chosen: [standard-schema or adapter].
- Any acceptance gaps: [list or "none"].
- Follow-ups queued (if any): bundle analyzer, explicit lint rule for `@project/api/domains/todo/http` value-imports.
