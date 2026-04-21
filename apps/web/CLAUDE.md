# apps/web — TanStack Start Frontend

> **Cross-layer naming:** each feature's folder name mirrors `packages/api/src/domains/<same-name>/` and `e2e/features/<same-name>/`. See root `CLAUDE.md` § "Cross-Layer Naming".

## FSD (Feature-Sliced Design)

Frontend is organized by FSD layers. Routes stay file-based (TanStack Router requirement), everything else follows FSD:

```
src/
  routes/          # TanStack Router file-based routes — thin shells, ~8 lines per file
  features/        # User-facing capabilities — page components, hooks, forms, live-updates
    auth/          # auth-client, login-page, signup-page, forms, session (SSR)
    todo-list/     # todo-lists-page, detail page, invite-page, hooks, widgets
    dashboard/     # cross-domain dashboard composition
    landing/       # public landing page
    user/          # user-scoped hooks (inbox, debounce)
  widgets/         # Composed UI blocks used across features (Navbar, AppShell)
```

Cross-cutting primitives that previously lived in `src/shared/` now live in workspace packages:

- HTTP fetch wrapper → `@project/http/client`
- Optimistic-mutation helper → `@project/query/use-optimistic-mutation`
- Authed media primitives → `@project/media/authed-image`

See `docs/package-taxonomy.md` for the full decision tree.

**Layer rules:**
- `routes/` → imports from `features/`, `widgets/`, `@project/ui`
- `widgets/` → imports from `features/`, `@project/ui`
- `features/` → imports from other `features/`, `@project/*` packages, `@project/ui`
- **Never import upward** (features must not import from widgets or routes)

**Adding a new feature:** create `src/features/<name>/` with its UI components and logic. Import it from routes.

**Mandatory — route-shell rule.** Routes are thin shells: `createFileRoute` config, `beforeLoad` guard, `validateSearch`, and a `component:` that imports the real page from `features/<name>/<page>-page.tsx`. The whole file is ~8 lines. The page component — which owns layout, forms, data wiring, and composition — lives under `features/`.

Before/after — the rule catches this regression cleanly:

```tsx
// BAD — inlined page component in the route file
export const Route = createFileRoute("/login")({ component: LoginPage });
function LoginPage() { return (<main>...50 lines of JSX...</main>); }

// GOOD — route file is a shell, page lives in features/
// routes/login.tsx
import { createFileRoute, redirect } from "@tanstack/react-router";
import { LoginPage } from "#/features/auth/login-page";
export const Route = createFileRoute("/login")({
  beforeLoad: ({ context }) => {
    if (context.session) throw redirect({ to: "/dashboard" });
  },
  component: LoginPage,
});

// features/auth/login-page.tsx
export function LoginPage() { return (<main>...50 lines of JSX...</main>); }
```

If the page needs route context (`useRouteContext`, `useParams`, `useSearch`), wrap one thin component in the route file that calls those hooks and passes the values down as props:

```tsx
// routes/_authenticated/todo-lists/$listId.tsx
export const Route = createFileRoute("/_authenticated/todo-lists/$listId")({
  component: RouteComponent,
});
function RouteComponent() {
  const { trpc, session } = Route.useRouteContext();
  const { listId } = Route.useParams();
  return (
    <TodoListDetailPage
      trpc={trpc}
      listId={listId}
      currentUserId={session?.user.id ?? null}
    />
  );
}
```

## Adding a New Page

1. Create the page component under `src/features/<name>/<name>-page.tsx` (e.g. `features/auth/login-page.tsx`, `features/landing/landing-page.tsx`). If the page composes two domains that neither alone owns, create a new `features/<name>/` dir (e.g. `features/dashboard/` for a dashboard that mixes user session and todo-list invites).
2. Create a thin route file in `src/routes/`:
   - Public page: `src/routes/about.tsx`
   - Authenticated page: `src/routes/_authenticated/settings.tsx`
3. Export `Route` using `createFileRoute` and set `component` to the page (or a `RouteComponent` wrapper that forwards route-context values).
4. The route tree regenerates automatically on `vite dev`. If the dev server isn't running, run `make routes` to regenerate without starting it. When adding multiple routes, create all route files first, then run `make routes` once.

### Public page (no route context)

```tsx
// features/landing/landing-page.tsx
export function LandingPage() { return <main>Landing</main>; }

// routes/index.tsx
import { createFileRoute } from "@tanstack/react-router";
import { LandingPage } from "#/features/landing/landing-page";
export const Route = createFileRoute("/")({ component: LandingPage });
```

### Authenticated page

```tsx
// routes/_authenticated/settings.tsx
import { createFileRoute } from "@tanstack/react-router";
import { SettingsPage } from "#/features/user/settings-page";
export const Route = createFileRoute("/_authenticated/settings")({
  component: SettingsPage,
});
```

Pages under `_authenticated/` are protected by the layout route's auth guard — `ctx.session` is guaranteed non-null inside.

## Using tRPC Data

Access tRPC via route context, use with React Query hooks:

```tsx
function MyComponent() {
  const { trpc } = Route.useRouteContext();
  const queryClient = useQueryClient();

  // Query
  const data = useQuery(trpc.todo.list.queryOptions());

  // Mutation with cache invalidation and toast
  const createTodo = useMutation(
    trpc.todo.create.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries(trpc.todo.list.queryFilter());
        toast.success("Created");
      },
      onError: () => toast.error("Failed to create"),
    }),
  );
}
```

### Hook Extraction Pattern

When a route has 2+ mutations or the return object would have 5+ properties, extract orchestration into a `features/*/use-*.ts` hook. The route becomes a thin shell.

```tsx
// features/todo-list/use-todos.ts — orchestration hook (scoped to a list)
export function useTodos(
  trpc: TRPCOptionsProxy<AppRouter>,
  queryClient: QueryClient,
  todoListId: string,
) {
  const todos = useQuery(trpc.todo.list.queryOptions({ todoListId }));
  const createTodo = useMutation(trpc.todo.create.mutationOptions({ ... }));
  // ... all mutations, handlers, derived state
  return { todos, createTodo, handleSubmit, handleDragEnd, ... };
}

// features/todo-list/use-todo-lists.ts — list-level orchestration with optimistic delete
export function useTodoLists(
  trpc: TRPCOptionsProxy<AppRouter>,
  queryClient: QueryClient,
) { ... }

// routes/_authenticated/todo-lists/$listId.tsx — thin shell
function TodoListDetailPage() {
  const { trpc } = Route.useRouteContext();
  const { listId } = Route.useParams();
  const queryClient = useQueryClient();
  const { todos, handleSubmit, ... } = useTodos(trpc, queryClient, listId);
  return <main>...</main>;
}
```

The hook receives `trpc` and `queryClient` as parameters because `Route.useRouteContext()` can only be called inside the route component.

### Optimistic Updates

For instant UI feedback before the server confirms, see the drag-and-drop reorder handler in `src/features/todo-list/use-todos.ts` (`handleDragEnd`) — it uses `queryClient.setQueryData` to update the cache immediately, with `onError` invalidation as fallback.

When using `onMutate` callbacks with tRPC, define explicit types for the data shape — tRPC's type inference breaks on the callback parameter:

```tsx
// Define explicit types matching your router's return shape
type TodoItem = { id: string; title: string; position: number };
type TodoList = TodoItem[];

const previous = queryClient.getQueryData<TodoList>(trpc.todo.list.queryFilter().queryKey);
queryClient.setQueryData<TodoList>(trpc.todo.list.queryFilter().queryKey, (old) => {
  if (!old) return old;
  // TypeScript now knows old is TodoList, not unknown
  return old.map((item) => (item.id === targetId ? { ...item, position: newPos } : item));
});
```

### Include Type Workaround

When using `setQueryData` on a query that returns data with Prisma `include`, tRPC's type inference breaks on the callback parameter. Define an explicit type:

```typescript
type TodoListWithCount = RouterOutput["todoList"]["list"][number];

queryClient.setQueryData<TodoListWithCount[]>(
  trpc.todoList.list.queryFilter().queryKey,
  (old) => old?.filter((list) => list.id !== id),
);
```

See `features/todo-list/use-todo-lists.ts` for the full optimistic delete pattern.

## Non-tRPC HTTP Calls

For endpoints that aren't tRPC procedures (file upload/download, webhooks), use `apiClient`:

```typescript
import { apiClient } from "@project/http/client";

// POST with FormData
const res = await apiClient.fetch("/api/upload", {
  method: "POST",
  body: formData,
});

// GET with query string
const res = await apiClient.fetch(`/api/export?id=${id}`);
```

Never write `fetch("http://localhost:3001/...")` or `` fetch(`${import.meta.env.VITE_API_URL}/...`) `` — both duplicate the base URL and bypass the `@project/env/client` validation boundary.

## Auth Client

Import from `#/features/auth/auth-client`:

```tsx
import { useSession, signIn, signUp, signOut } from "#/features/auth/auth-client";
```

- `useSession()` — returns `{ data: session, isPending }`
- `signIn.email({ email, password })` — sign in
- `signUp.email({ email, password, name })` — sign up
- `signOut()` — sign out (returns Promise)

## File Structure

- `src/router.tsx` — router factory, tRPC client, QueryClient
- `src/routes/__root.tsx` — HTML shell, QueryClientProvider, Toaster, 404/500 pages
- `src/routes/_authenticated.tsx` — auth guard layout with Navbar
- `src/routes/_authenticated/*.tsx` — protected pages
- `src/routes/*.tsx` — public pages
- `src/features/auth/` — auth-client config, UserBlock
- `src/widgets/` — Navbar (desktop + mobile), Logo
- `src/styles.css` — Tailwind v4 entry point + shadcn/ui CSS variables
- `vite.config.ts` — Vite + TanStack Start + Tailwind + Nitro

## Navigation

Use `Link` for declarative navigation, `useNavigate` for programmatic:

```tsx
import { Link, useNavigate } from "@tanstack/react-router";

// Declarative
<Link to="/dashboard">Dashboard</Link>

// Programmatic (in event handlers or useEffect only)
const navigate = useNavigate();
navigate({ to: "/dashboard" });
```

Never call `navigate()` during render — use `useEffect`.

## Do Not

- Edit `routeTree.gen.ts` — it's auto-generated
- Use `getServerSideProps`, `"use server"`, or Next.js patterns
- Create `QueryClient` as a module-level singleton — use `getQueryClient()` pattern
- Import `appRouter` value (only `import type { AppRouter }`)
- **Never import from `@project/env` without a subpath.** The env package exposes `/server` and `/client` only; there is no barrel (enforced by `packages/lint/src/check-no-barrel.ts`). Web code imports from `@project/env/client` exclusively. A barrel would transitively pull server-only vars (DATABASE_URL, BETTER_AUTH_SECRET) into the client bundle.
- **Make HTTP calls directly with `fetch()`.** All server calls from the web app MUST go through `apiClient` (from `@project/http/client`). `apiClient.fetch(path, init)` prepends the base URL and sets cookie-auth credentials. This keeps the base URL in a single place and prevents scattered `fetch(`http://...`)` calls.
- Put `verbatimModuleSyntax: true` in tsconfig — breaks TanStack Start
- Add `credentials: "include"` — already configured in the tRPC httpBatchLink
- Import upward in FSD layers (features must not import from widgets or routes)
