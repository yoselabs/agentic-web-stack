# TanStack Simplifications

## Goal

Lean on newer TanStack/Start APIs (and move one Hono sub-app into the domain that owns it) to remove workarounds, eliminate a React anti-pattern the project explicitly warns against, and tighten the type-safety boundary on the two non-tRPC HTTP endpoints. No change to the two-app deployment shape.

## Motivation

Four unrelated smells accumulated while APIs were maturing:

1. A `type {}` shim is needed in `apps/web/src/routes/health.ts` to unlock the `server:` handler key on `createFileRoute`.
2. Auth guarding uses `useEffect → navigate()` in render (`_authenticated.tsx`, `login.tsx`) — a pattern the root `CLAUDE.md` flags as a common mistake. It also produces a "Loading…" flash on every authenticated navigation and a `if (!session) return null` no-op render.
3. The CSV import/export endpoints live as raw `app.post(...)` / `app.get(...)` handlers in `apps/server/src/index.ts` with 50 lines of auth + validation + transaction wiring. The todo domain's other routing is in `packages/api/src/domains/todo/router.ts`. The project rule is: routing lives in routers, business logic lives in the domain.
4. The web calls those endpoints via `apiClient.fetch("/api/todos/…")` with hand-assembled `FormData` and untyped `res.json()`. The rest of the app is fully typed end-to-end via tRPC; this is the one place that isn't.

Addressing them together is cheap because they interlock: fixing (3) unblocks (4) by exporting a typed Hono sub-app from the domain, and (2) is the ergonomics payoff of Start's `beforeLoad`.

## Non-goals

- **No server consolidation.** `apps/server` (Hono on :3001) stays separate from `apps/web` (Nitro on :3000). Collapsing them is a larger architectural move the user explicitly deferred.
- **No tRPC-over-multipart.** File upload/download stay on plain HTTP — tRPC's JSON transport is the wrong tool for binary bodies and `Content-Disposition` downloads.
- **No DnD-kit replacement.** No TanStack DnD exists; Pragmatic DnD would be a sideways move.
- **No wholesale forms library migration.** Only `login.tsx` is rewritten (it's the only form today); future forms adopt the new pattern as they appear.
- **No `getQueryClient()` change** in `router.tsx` — still the idiomatic Start SSR pattern.
- **No `data-hydrated` change** in `__root.tsx` — test-infra concern, no TanStack replacement.

## Scope

Four independent pieces, landed in the order below so later pieces can depend on earlier ones:

1. **A1** — drop the `@tanstack/start-client-core` type-only shim if newer Start types the `server:` key natively.
2. **A2** — replace the `useEffect`-redirect auth guard with `beforeLoad` + `throw redirect(...)`, sourcing the session server-side via a Start `createServerFn`.
3. **B1** — move the todo import/export Hono routing into `packages/api/src/domains/todo/http.ts`, and consume it from the web via `hc<TodoHttpType>` (typed Hono RPC client).
4. **B2** — rewrite `apps/web/src/routes/login.tsx` using TanStack Form + Zod.

Each piece compiles independently; A2 and B1 are the two that touch shared contracts.

---

## A1 — Drop the `start-client-core` type shim

### Current state

`apps/web/src/routes/health.ts:6`

```ts
import type {} from "@tanstack/start-client-core";
```

Plus a 4-line comment block explaining that the import loads module augmentation for the `server:` key on route options. `@tanstack/start-client-core` is listed as a direct dependency of `apps/web/package.json` solely for this type-load.

### Change

1. Delete the `import type {}` line and the 4-line comment.
2. Run `tsc -b`. If the `server:` key still type-checks, remove `@tanstack/start-client-core` from `apps/web/package.json` dependencies.
3. If `tsc -b` fails, keep the line but compress the comment to one line, and leave the dep.

### Risk

None — the compiler is the oracle.

---

## A2 — Server-side auth guard via `beforeLoad`

### Current state

**`apps/web/src/routes/_authenticated.tsx`** — layout component reads `useSession()`, runs `useEffect(() => { if (!isPending && !session) navigate({ to: "/login" }) }, ...)`, renders a "Loading…" shell while pending or unauthenticated, then renders `Navbar + Outlet` once `session` is truthy.

**`apps/web/src/routes/login.tsx`** — mirror pattern: `useEffect(() => { if (session) navigate({ to: "/dashboard" }) })`, plus an `if (session) return null;` guard.

Both patterns run the redirect in render via `useEffect`, producing a visible "Loading…" flash and a no-op render cycle. The root `CLAUDE.md` lists "Use `navigate()` during React render" as a common mistake requiring `useEffect` as the workaround. `beforeLoad` is the clean alternative.

### Change

**Web server function — `apps/web/src/shared/session.ts` (new):**

```ts
import { createServerFn } from "@tanstack/react-start";
import { getHeaders } from "@tanstack/react-start/server";
import { apiClient } from "./api-client";

export type SessionData = { user: { id: string; email: string; name: string | null } } | null;

export const getSession = createServerFn({ method: "GET" }).handler(async (): Promise<SessionData> => {
  const cookie = getHeaders().cookie ?? "";
  if (!cookie) return null;
  const res = await apiClient.fetch("/api/auth/get-session", {
    headers: { cookie },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data?.user ? data : null;
});
```

Exact Start server-fn API surface (`createServerFn` chaining, header access helper name) may differ in the installed version — the implementation plan verifies against installed types. The contract this module owes the rest of the spec: a `getSession()` that runs on the web Nitro, returns `SessionData`, and forwards incoming cookies.

**Router context** — extend `apps/web/src/routes/__root.tsx`'s `RouterContext`:

```ts
export interface RouterContext {
  trpc: TRPCOptionsProxy<AppRouter>;
  queryClient: QueryClient;
  session: SessionData;
}
```

`router.tsx`'s `createTanStackRouter({ context })` receives `session` from the root route's `beforeLoad`, which calls `getSession()`. (Start re-runs `beforeLoad` per navigation, so logout/login reflect correctly.)

**Authenticated layout — `apps/web/src/routes/_authenticated.tsx`:**

```ts
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

Remove: `useSession`, `useNavigate`, `useEffect`, the `isPending` branch, the "Loading…" shell, the `if (!session)` no-op.

**Login page — `apps/web/src/routes/login.tsx`:**

```ts
export const Route = createFileRoute("/login")({
  beforeLoad: ({ context }) => {
    if (context.session) throw redirect({ to: "/dashboard" });
  },
  component: LoginPage,
});
```

Remove the `useEffect(() => navigate({ to: "/dashboard" }))` and `if (session) return null;` hacks from inside the component.

**Client `useSession()` stays** — still used by `UserBlock` (navbar greeting) and anywhere else that needs reactive auth state after a client-side sign-in/out. The server guard handles the redirect; the hook handles the display.

### Http-only cookie compatibility

Better-Auth defaults to http-only cookies. Http-only prevents JS reads, not cookie transmission — browsers still send them on every request when `credentials: "include"` is set, which `apiClient.fetch` already does (`api-client.ts:34`). The server-fn reads them from the inbound `Cookie` header (`getHeaders().cookie`) and forwards them to `/api/auth/get-session` on the Hono server, which already does `auth.api.getSession({ headers: c.req.raw.headers })` (`apps/server/src/index.ts:95`). Full pipeline is http-only safe.

### Risk

- **Extra HTTP hop per SSR request.** Web Nitro → Hono on :3001 per navigation. Acceptable: both containers run on the same Docker network in the demo compose, <1 ms localhost RTT. In future we can cache the session in the server-fn for the duration of a single request (trivial), but not needed initially.
- **Tighter coupling of `apps/web` to `apps/server` availability.** Previously the web could render an unauthenticated shell even if the API was down; now `beforeLoad` fails. Matches user expectation (no API ⇒ no app) and surfaces outages honestly.
- **Start server-fn API may have evolved** — plan step verifies `createServerFn`/`getHeaders` names against the installed version.

---

## B1 — Todo HTTP router relocation + typed Hono client

### Current state

**`apps/server/src/index.ts:94-148`** — two Hono handlers (`POST /api/todos/import`, `GET /api/todos/export`) containing:

- Session check (`auth.api.getSession`)
- Multipart parse + `file instanceof File` check
- Size check (`MAX_UPLOAD_BYTES`)
- Content-type sniff (`.csv`, `text/csv`, `application/vnd.ms-excel`)
- `todoListId` string extraction
- Buffer conversion
- `db.$transaction` wrapping `importTodosFromCSV` / direct call to `exportTodosAsCSV`
- Error shaping + CSV response with `Content-Disposition`

**`apps/web/src/features/todo/use-todos.ts:124-164`** — consumer side:

- `importTodos` mutation hand-assembles `FormData` + `apiClient.fetch("/api/todos/import")` + untyped `res.json() as Promise<{ count: number }>`
- `exportTodos` calls `apiClient.fetch(\`/api/todos/export?todoListId=${id}\`)`, reads `res.blob()`, constructs `<a download>` element

**Violation:** `packages/api/src/CLAUDE.md` and root CLAUDE.md state routing lives in routers under `packages/api/src/domains/<name>/`. The Hono handlers above are domain routing placed in the transport host.

### Change

**New file — `packages/api/src/domains/todo/http.ts`:**

```ts
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { auth } from "@project/auth";
import { db } from "@project/db";
import { MAX_UPLOAD_BYTES, CSV_MIME_TYPES } from "./constants.js";
import { importTodosFromCSV, exportTodosAsCSV } from "./service.js";

const importSchema = z.object({
  file: z.instanceof(File).refine((f) => f.size <= MAX_UPLOAD_BYTES, "File too large (max 10 MB)"),
  todoListId: z.string().min(1),
});

const exportSchema = z.object({ todoListId: z.string().min(1) });

export const todoHttpRouter = new Hono()
  .post("/import", zValidator("form", importSchema), async (c) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: "Unauthorized" }, 401);

    const { file, todoListId } = c.req.valid("form");
    const mimeOk =
      CSV_MIME_TYPES.has(file.type) || file.name.toLowerCase().endsWith(".csv");
    if (!mimeOk) return c.json({ error: "Only CSV files are accepted" }, 400);

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

Method chaining on `new Hono()` is the pattern `hc` requires to preserve route types. `CSV_MIME_TYPES` moves from inlined comparisons into `constants.ts` (set-based lookup).

**Package exports** — extend `packages/api/package.json`:

```json
"./domains/todo/http": { "default": "./src/domains/todo/http.ts" }
```

**Server wiring** — replace `apps/server/src/index.ts:94-148` with:

```ts
import { todoHttpRouter } from "@project/api/domains/todo/http";
// ...
app.route("/api/todos", todoHttpRouter);
```

Fifty lines collapse to one. Auth, validation, transaction boundary, response shaping — all now inside the domain.

**Web client — `apps/web/src/shared/todo-http-client.ts` (new):**

```ts
import { hc } from "hono/client";
import type { TodoHttpRouter } from "@project/api/domains/todo/http";
import { apiClient } from "./api-client";

export const todoHttpClient = hc<TodoHttpRouter>(`${apiClient.baseUrl}/api/todos`, {
  fetch: apiClient.fetch,
});
```

The client inherits `apiClient.fetch`'s `credentials: "include"` + base-URL rule, so no bypassing the `apps/web/CLAUDE.md` "all HTTP through `apiClient`" guard.

**Type-only import** — importing `TodoHttpRouter` from `@project/api/domains/todo/http` must be `import type` to avoid pulling the Hono app (which imports `@project/auth` → `@project/db` → Prisma) into the web bundle. This is the same discipline as `import type { AppRouter }` for tRPC.

**Consumer rewrite — `use-todos.ts`:**

```ts
const importTodos = useMutation({
  mutationFn: async (file: File) => {
    const res = await todoHttpClient.import.$post({
      form: { file, todoListId },
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error("error" in err ? err.error : "Import failed");
    }
    return res.json();
  },
  // ...
});

const exportTodos = async () => {
  const res = await todoHttpClient.export.$get({ query: { todoListId } });
  if (!res.ok) { toast.error("Export failed"); return; }
  const blob = await res.blob();
  // ...download dance stays — it's correct browser UX
};
```

Gains: typed request bodies, typed success responses, typed error discriminant. Size check moves to the server (authoritative); the 10 MB client-side pre-check that duplicated `MAX_UPLOAD_BYTES` is deleted.

### Testing

The existing BDD flow in `e2e/features/todo-import-export.feature` (or equivalent) is the contract; no test changes required if URLs and payload shapes don't move. Add one unit test per Hono handler in `packages/api/src/domains/todo/__tests__/http.test.ts` — pattern per `packages/api/CLAUDE.md` (boot test DB, call handlers via `todoHttpRouter.request(new Request(...))`).

### Risk

- **Hono `hc` quirks:** form-data typing in `hc` requires the `zValidator("form", ...)` pattern specifically. If installed `@hono/zod-validator` has an incompatible API, fall back to manual `c.req.formData()` + Zod parse inside the handler — the client-side type still works via the explicit `TodoHttpRouter` export.
- **Subpath import discipline:** if any consumer does `import { TodoHttpRouter } from "@project/api/domains/todo/http"` as a value instead of `import type`, it leaks the server bundle into web. Same class of bug as `import { appRouter }`. Enforced by the existing `agent-harness lint` rule or added to it.

---

## B2 — `login.tsx` with TanStack Form + Zod

### Current state

`apps/web/src/routes/login.tsx` uses four `useState`s (`email`, `password`, `name`, `error`), one `useState` toggle (`isSignUp`), and a manual `handleSubmit` that awaits `signIn.email` / `signUp.email`, pattern-matches `result.error`, and calls `navigate`. Validation is a bare `minLength={MIN_PASSWORD_LENGTH}` + `required` HTML attribute.

### Change

Add dependencies to `apps/web/package.json`:

```json
"@tanstack/react-form": "^x.y.z",
"@tanstack/zod-form-adapter": "^x.y.z"
```

Version lookup during plan step; both are in active parallel release with other TanStack packages.

Define the schema next to the form:

```ts
const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(MIN_PASSWORD_LENGTH),
  name: z.string().optional(),
});
```

Form shape:

```tsx
const form = useForm({
  defaultValues: { email: "", password: "", name: "" },
  validatorAdapter: zodValidator(),
  validators: { onChange: loginSchema },
  onSubmit: async ({ value }) => {
    const fn = isSignUp ? signUp.email : signIn.email;
    const result = await fn({
      email: value.email,
      password: value.password,
      ...(isSignUp ? { name: value.name || value.email.split("@")[0] } : {}),
    });
    if (result.error) {
      form.setErrorMap({ onSubmit: result.error.message ?? "Auth failed" });
      return;
    }
    navigate({ to: "/dashboard" });
  },
});
```

Each field renders via `<form.Field name="email">{(field) => <Input ... />}</form.Field>`, surfacing `field.state.meta.errors` per field. The top-level error moves into the submit error map.

The `isSignUp` toggle stays local state — it's a mode switch, not a form value. The `<form onSubmit>` hooks into `form.handleSubmit`.

The redirect-if-already-logged-in concern is A2's job (now in `beforeLoad`); this file no longer reads `useSession` at all.

### Risk

- **New dep** (~20 KB gzipped). Acceptable; it's the forms primitive for a template.
- **TanStack Form API still stabilizing.** Install pinned minor; track changelogs before major bumps.

---

## Ordering and dependencies

1. **A1** — standalone, no runtime impact. Do first to get a fast win out.
2. **B1** — standalone *contract-wise* (URLs and payloads don't change). Lands before A2 because the spec review might surface Hono `hc` quirks that affect B1's shape; catching them early avoids bundling them with the more subtle auth work.
3. **A2** — depends on Start server-fn API verification + Better-Auth's `/api/auth/get-session` shape. Land after B1 so the new `shared/session.ts` sits alongside `shared/todo-http-client.ts`, reusing the same `apiClient.fetch`-forwarding pattern B1 establishes.
4. **B2** — standalone, depends only on A2 having removed the session logic from `login.tsx`. If A2 lands first, B2's diff is small and focused.

Each piece is its own commit; each piece leaves `make lint && make test && make test-unit` green before the next starts.

## Open questions

- **Does `@tanstack/start-client-core` still need to be a direct dep of `apps/web`** after A1, or did newer Start fold its types into `@tanstack/react-start`? Plan step resolves by running `tsc -b` after deletion.
- **Can Start's `createServerFn` run inside a root-route `beforeLoad`** without triggering a double-fetch during hydration? Start's `beforeLoad` already supports server-only context; needs a 5-minute test on a throwaway route.
- **Does Better-Auth's `/api/auth/get-session` return a consistent shape** for "logged out" vs. "logged in"? The server-fn contract assumes `null` on non-2xx or empty body. Plan step probes live response both ways before committing to the shape.
- **Hono `hc` + multipart + `File` instances in browser** — verified-working pattern exists but API churn is real. Fallback path (manual `FormData` + `fetch` through `apiClient.fetch`) keeps the hc client for `export` only if `import` hits a wall.

## Acceptance criteria

- No file in `apps/web/src/` calls `useEffect` to trigger a `navigate()` on session state.
- No file in `apps/server/src/` contains domain business logic or domain routing — `apps/server/src/index.ts` is a pure transport host (auth handler mount, tRPC mount, domain HTTP sub-app mounts, middleware).
- `apps/web/src/features/todo/use-todos.ts` contains zero hand-assembled `FormData` or string-path `apiClient.fetch` calls. Both import/export go through `todoHttpClient`.
- `apps/web/src/routes/login.tsx` has zero `useState` for field values.
- `make lint && make test && make test-unit` pass on each of the four piece commits independently.
