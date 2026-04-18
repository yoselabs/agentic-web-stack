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

Four independent pieces (problem-statement order below; the **land order** is separate and appears in "Ordering and dependencies" near the end of this document):

- **A1** — drop the `@tanstack/start-client-core` type-only shim if newer Start types the `server:` key natively.
- **A2** — replace the `useEffect`-redirect auth guard with `beforeLoad` + `throw redirect(...)`, sourcing the session server-side via a Start `createServerFn`.
- **B1** — move the todo import/export Hono routing into `packages/api/src/domains/todo/http.ts`, and consume it from the web via `hc<TodoHttpType>` (typed Hono RPC client).
- **B2** — rewrite `apps/web/src/routes/login.tsx` using TanStack Form + Zod.

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

1. Delete the `import type {}` line and the 4-line comment. Run `tsc -b`.
2. **If `tsc -b` passes:** remove `@tanstack/start-client-core` from `apps/web/package.json` dependencies, run `pnpm install`, re-run `tsc -b` to confirm.
3. **If `tsc -b` fails:** restore a single-line `import type {} from "@tanstack/start-client-core";` (drop the 4-line comment, keep the import), leave the dep in place.

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
  const raw = getHeaders().cookie;
  // getHeaders() delegates to h3/Nitro; under some proxy configurations cookie
  // headers arrive as string[]. Coerce to a single string so the downstream
  // `fetch` always sends a well-formed Cookie header.
  const cookie = Array.isArray(raw) ? raw.join("; ") : (raw ?? "");
  if (!cookie) return null;
  const res = await apiClient.fetch("/api/auth/get-session", {
    headers: { cookie },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data?.user ? data : null;
});
```

The contract this module owes the rest of the spec: a `getSession()` that runs **server-only** on the web Nitro, returns `SessionData` (never throws), and forwards incoming cookies. The exact `createServerFn` chaining and `getHeaders()` import path are installed-version-specific — the plan step verifies both against the pinned Start version; the contract above is what the plan is held to, not the surface syntax.

**Server-only execution + hydration.** `createServerFn` emits a handler that runs only on the server; the client reaches it via an RPC call. The guarantees this spec relies on:

- **Initial SSR:** `beforeLoad` runs on the web Nitro, calls the server-fn handler directly (in-process, no HTTP hop), and the resulting `session` is merged into router context and serialized into the SSR HTML via router dehydration.
- **First-paint hydration:** the client reuses the dehydrated router context — no `/api/auth/get-session` call is issued from the browser on the initial page load.

What the spec does **not** guarantee (Router-version-specific; verified at plan step):

- **Client-side navigation between authenticated routes:** Router's match-reuse rules decide whether `beforeLoad` re-runs on a nav from `/dashboard` → `/_authenticated/todo-lists/abc`. If it does, the server-fn is invoked over the wire (HTTP to Nitro). If cached route context is reused, it isn't. The plan step measures actual re-invocation with browser DevTools and pins the behavior in the plan's verification notes. Either behavior is acceptable for this spec's correctness (both produce a valid guard); the measurement informs whether a follow-up memoization step is needed.
- **After `router.invalidate()`** (e.g., post-sign-in/sign-out): `beforeLoad` re-runs, server-fn is invoked, fresh session propagates. This is intended.

**Router context** — extend `apps/web/src/routes/__root.tsx`'s `RouterContext`:

```ts
export interface RouterContext {
  trpc: TRPCOptionsProxy<AppRouter>;
  queryClient: QueryClient;
  session: SessionData;
}
```

`router.tsx`'s `createTanStackRouter({ context })` seeds `session: null` initially; the root route's `beforeLoad` calls `getSession()` and returns `{ session }` so it merges into `context` for all descendants. `router.invalidate()` after sign-in/sign-out re-runs the root `beforeLoad` → refreshed session propagates.

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

- **Extra HTTP hop on session loads.** Each `beforeLoad` call to the server-fn triggers one Web Nitro → Hono `/api/auth/get-session` request. Frequency is bounded by: (a) every initial SSR page load (one hop, definitely happens), (b) `router.invalidate()` post-auth (rare), and (c) client-side navigations that don't reuse cached route context (Router-version-specific, measured at plan step). Both containers are on the same Docker network (<1 ms RTT); acceptable for the demo. For a production-grade template a follow-up step can memoize the session within a single request (React cache / AsyncLocalStorage); not load-bearing for this spec.
- **Tighter coupling of `apps/web` to `apps/server` availability.** Previously the web could render an unauthenticated shell even if the API was down; now a broken API degrades to "redirect to /login" because `getSession()` returns `null` on non-2xx. Matches user expectation (no API ⇒ no app) and surfaces outages honestly.
- **Start server-fn surface version drift** — plan step verifies `createServerFn`, `getHeaders`, and the server-only execution guarantee against the installed version. If the guarantee doesn't hold in the installed version (client-side rehydration re-invokes the handler), fallback is to load the session inside `router.tsx` during `getRouter()` using a direct `apiClient.fetch` server-side guarded by `typeof window === "undefined"`.

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
    // once for the scalar field, but Hono's body-cache makes this cheap.
    // Returns File | string | null per field.
    const body = await c.req.parseBody();
    const file = body.file;

    if (!(file instanceof File)) return c.json({ error: "No file provided" }, 400);
    if (file.size > MAX_UPLOAD_BYTES) {
      return c.json({ error: "File too large (max 10 MB)" }, 413);
    }
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

**Intentional behavior changes** vs. the current handlers in `apps/server/src/index.ts`:

- File extension check becomes case-insensitive (`TODOS.CSV` now accepts). Current code uses `file.name.endsWith(".csv")` (case-sensitive).
- Error bodies keep the existing shape `{ error: string }` — BDD and any caller that destructures `err.error` are unaffected.
- Status codes preserved exactly: 401 unauthorized, 400 missing/invalid inputs, 413 file too large, 201 success.

**Package exports** — extend `packages/api/package.json` **before** adding any import site (otherwise `@project/api/domains/todo/http` resolves to the package root and explodes — same class of bug as the no-barrel rule):

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

`apiClient.baseUrl` is the bare origin (no trailing slash, no path) — established by `apps/web/src/shared/api-client.ts:13` (`API_BASE_URL = env.VITE_API_URL`). `hc`'s first arg is the path-prefix for the router; `${baseUrl}/api/todos` matches the server-side mount at `app.route("/api/todos", todoHttpRouter)` exactly. The client inherits `apiClient.fetch`'s `credentials: "include"` + base-URL rule, so no bypassing the `apps/web/CLAUDE.md` "all HTTP through `apiClient`" guard.

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

Gains: typed scalar inputs (`todoListId` flows through `hc` from the `zValidator("form", importFormSchema)` metadata), typed success and error response bodies via the handler's `c.json(...)` return types, typed query params for export. The `file: File` field is accepted by `hc`'s multipart form input type; exact typing (`File` vs. `Blob | File`) depends on `hc`'s form-input helpers on the pinned version and is verified at plan step. Either way, the shape is tighter than today's `apiClient.fetch` + `res.json() as Promise<{ count: number }>` cast. Size check moves to the server (authoritative); the 10 MB client-side pre-check that duplicated `MAX_UPLOAD_BYTES` is deleted.

### Testing

The existing BDD flow in `e2e/features/todo-import-export.feature` (or equivalent) is the contract; no test changes required if URLs and payload shapes don't move. Add one unit test per Hono handler in `packages/api/src/domains/todo/__tests__/http.test.ts` — pattern per `packages/api/CLAUDE.md` (boot test DB, call handlers via `todoHttpRouter.request(new Request(...))`).

### Risk

- **`hc` + File on the wire:** browser `File` passed into `$post({ form })` must serialize as multipart; `hc` does this when the input contains a `File` instance. If a future bundler transform strips the `File` check, the body goes out as JSON and the server returns 400. Mitigation: the e2e BDD scenario covers the success path; a unit test in `http.test.ts` exercises an actual `FormData` request against `todoHttpRouter.request(...)`.
- **Subpath import discipline:** if any consumer does `import { TodoHttpRouter } from "@project/api/domains/todo/http"` as a value instead of `import type`, it leaks the server bundle into web. Same class of bug as `import { appRouter }`. Enforced by the existing `agent-harness lint` rule or added to it.
- **Rollback:** URLs, payload shapes, status codes, and error-body shape are preserved. Reverting the B1 commit restores the previous server without client-side coordination.

---

## B2 — `login.tsx` with TanStack Form + Zod

### Current state

`apps/web/src/routes/login.tsx` uses four `useState`s (`email`, `password`, `name`, `error`), one `useState` toggle (`isSignUp`), and a manual `handleSubmit` that awaits `signIn.email` / `signUp.email`, pattern-matches `result.error`, and calls `navigate`. Validation is a bare `minLength={MIN_PASSWORD_LENGTH}` + `required` HTML attribute.

### Change

Add `@tanstack/react-form` to `apps/web/package.json`. Version pinned during the plan step against the latest minor compatible with the installed TanStack Router/Start pair. **Do not** default to adding `@tanstack/zod-form-adapter` — recent `@tanstack/react-form` releases accept Zod schemas directly via Standard Schema; the plan step verifies which API the pinned version uses and only adds the adapter dep if the pinned version still requires it.

**Spec contract** (what the rewritten `login.tsx` must satisfy — exact method and option names verified against the installed API during the plan step, not this spec):

- The schema below is used for client-side validation. The password `min(MIN_PASSWORD_LENGTH)` value is imported from `@project/auth/constants` (already used by the current `login.tsx:110`).
  ```ts
  const loginSchema = z.object({
    email: z.string().email(),
    password: z.string().min(MIN_PASSWORD_LENGTH),
    name: z.string().optional(),
  });
  ```
- Form state uses `useForm` from `@tanstack/react-form` with `defaultValues: { email: "", password: "", name: "" }`.
- Field-level validation runs on change against `loginSchema` (exact option name — `validators.onChange` vs. standard-schema alternative — verified at plan step).
- Submit handler is async: it calls either `signUp.email` or `signIn.email` based on the `isSignUp` local-state toggle (toggle stays a `useState` — it's a mode switch, not a form value), threads `value.email`/`value.password` (plus derived `name` when signing up: `value.name || value.email.split("@")[0]`), then either `navigate({ to: "/dashboard" })` on success or surfaces `result.error.message` as a form-level error (exact form-error API — `setErrorMap`, returning a string from `onSubmit`, or form-level validator result — verified at plan step). **Fallback** if no pinned-version API cleanly maps submit-time errors: a single `const [formError, setFormError] = useState<string | null>(null)` rendered in a non-field error slot (same pattern as the existing `login.tsx:27`). This keeps the refactor shippable regardless of TanStack Form's form-error ergonomics in the pinned version.
- Each input renders inside a `form.Field` render-prop so field-level errors from `loginSchema` surface near the input.
- No `useSession`, no `useEffect`, no redirect logic — A2's `beforeLoad` handles the logged-in-already case.

The goal of this section is the *shape* of the refactor, not copy-paste-ready TanStack Form code; the plan step produces the runnable version against the pinned API.

### Risk

- **New dep** (~20 KB gzipped). Acceptable; it's the forms primitive for a template.
- **TanStack Form API still stabilizing.** Pin a minor; plan step verifies the exact form-level error API and the validator-adapter vs. standard-schema choice.

---

## Ordering and dependencies

1. **A1** — standalone, no runtime impact. Do first to get a fast win out.
2. **B1** — standalone *contract-wise* (URLs and payloads don't change). Lands before A2 because the spec review might surface Hono `hc` quirks that affect B1's shape; catching them early avoids bundling them with the more subtle auth work.
3. **A2** — depends on Start server-fn API verification + Better-Auth's `/api/auth/get-session` shape. Land after B1 so the new `shared/session.ts` sits alongside `shared/todo-http-client.ts`, reusing the same `apiClient.fetch`-forwarding pattern B1 establishes.
4. **B2** — standalone, depends only on A2 having removed the session logic from `login.tsx`. If A2 lands first, B2's diff is small and focused.

Each piece is its own commit; each piece leaves `make lint && make test && make test-unit` green before the next starts.

## Open questions

- **Does `@tanstack/start-client-core` still need to be a direct dep of `apps/web`** after A1, or did newer Start fold its types into `@tanstack/react-start`? Plan step resolves by running `tsc -b` after deletion.
- **Does Better-Auth's `/api/auth/get-session` return a consistent shape** for "logged out" vs. "logged in"? The server-fn contract assumes `null` on non-2xx or empty body; on 2xx the response is `{ user, session }` or similar. Plan step probes live response both ways before committing to the parsing.
- **TanStack Form's form-level error API** on the pinned minor — `setErrorMap`, returning a string from `onSubmit`, or another shape. Resolved by reading the installed `.d.ts` at plan time, not by the spec.

## Acceptance criteria

- No file in `apps/web/src/` calls `useEffect` to trigger a `navigate()` on session state.
- `apps/server/src/index.ts` imports only from `@project/api/*`, `@project/auth`, `@project/env/server`, `@project/db` (for the `/health` DB ping), and `hono`/`@hono/*`/`@hono/node-server` — no imports from `@project/api/domains/*/service` or domain-level CSV helpers. Domain HTTP sub-apps are mounted via one-line `app.route(...)` calls.
- `apps/web/src/features/todo/use-todos.ts` contains zero hand-assembled `FormData` or string-path `apiClient.fetch` calls. Both import/export go through `todoHttpClient`.
- `apps/web/src/routes/login.tsx` has zero `useState` for field values.
- **SSR-no-refetch (initial load):** on server-side load of any authenticated page, the web Nitro issues exactly one `GET /api/auth/get-session` to the Hono server. The browser's DevTools Network tab for the same initial page load shows **zero** requests to `/api/auth/get-session` from the browser. Verified manually during plan execution and captured in the plan's verification notes.
- **Client-navigation behavior characterized (not constrained):** the plan records whether client-side navigation between two authenticated routes re-invokes the session server-fn (a browser request to Nitro) or reuses cached router context. Either outcome is acceptable; the measurement is a deliverable of the plan, not a gate of this spec.
- **Server-bundle hygiene** is enforced by **two** checks, not a grep alone:
  1. **Lint gate** (primary): `agent-harness lint` (or an added Biome/custom rule) flags any non-`import type` import of `@project/api/domains/todo/http` from `apps/web/**`, mirroring the existing `import type { AppRouter }` discipline. This is the enforcement mechanism.
  2. **Bundle-analyzer smoke check** (diagnostic): `pnpm --filter @project/web build` is run with Vite's `rollup-plugin-visualizer` (or `vite-bundle-visualizer`) to produce a module-graph report; the report must contain no chunk referencing `better-auth`, `@prisma/client`, or `papaparse` as module IDs. A plain-text `grep` on the minified output is kept as a fast preflight but not the acceptance gate — identifier mangling makes grep unreliable.
- `make lint && make test && make test-unit` pass on each of the four piece commits independently.
