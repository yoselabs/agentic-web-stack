# apps/web — TanStack Start Frontend

## FSD (Feature-Sliced Design)

Frontend is organized by FSD layers. Routes stay file-based (TanStack Router requirement), everything else follows FSD:

```
src/
  routes/          # TanStack Router file-based routes — thin shells that compose features/widgets
  features/        # User-facing capabilities with business logic
    auth/          # auth-client, UserBlock
  widgets/         # Composed UI blocks (combine features + UI components)
    navbar.tsx     # Navbar, Logo
  shared/          # Cross-cutting: lib, config (when needed)
```

**Layer rules:**
- `routes/` → imports from `features/`, `widgets/`, `@project/ui`
- `widgets/` → imports from `features/`, `@project/ui`
- `features/` → imports from `shared/`, `@project/ui`
- `shared/` → imports from `@project/ui` only
- **Never import upward** (features must not import from widgets or routes)

**Adding a new feature:** create `src/features/<name>/` with its UI components and logic. Import it from routes.

**Mandatory:** Routes must be thin shells — layout, context providers, mutation hooks, and composition only. Extract all reusable components, types, and business logic into `features/` or `widgets/`. Never inline feature components in route files.

## Adding a New Page

1. Create a route file in `src/routes/`:
   - Public page: `src/routes/about.tsx`
   - Authenticated page: `src/routes/_authenticated/settings.tsx`
2. Export `Route` using `createFileRoute`
3. The route tree regenerates automatically on `vite dev`
   If the dev server isn't running, run `make routes` to regenerate without starting the full dev server.
   When adding multiple routes, create all route files first, then run `make routes` once.

### Public page

```tsx
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/about")({
  component: AboutPage,
});

function AboutPage() {
  return <main>About</main>;
}
```

### Authenticated page

```tsx
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  // ctx.session is guaranteed non-null inside _authenticated
  return <main>Settings</main>;
}
```

Pages under `_authenticated/` are protected by the layout route's auth guard.

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

### Optimistic Updates

For instant UI feedback before the server confirms, see the drag-and-drop reorder handler in `src/routes/_authenticated/todos.tsx` — it uses `queryClient.setQueryData` to update the cache immediately, with `onError` invalidation as fallback.

When using `onMutate` callbacks with tRPC, define explicit types for the data shape — tRPC's type inference breaks on the callback parameter:

```tsx
// Define explicit types matching your router's return shape
type TodoItem = { id: string; title: string; position: number };
type TodoList = TodoItem[];

const previous = queryClient.getQueryData<TodoList>(trpc.todo.list.queryOptions().queryKey);
queryClient.setQueryData<TodoList>(trpc.todo.list.queryOptions().queryKey, (old) => {
  if (!old) return old;
  // TypeScript now knows old is TodoList, not unknown
  return old.map((item) => (item.id === targetId ? { ...item, position: newPos } : item));
});
```

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
- Put `verbatimModuleSyntax: true` in tsconfig — breaks TanStack Start
- Add `credentials: "include"` — already configured in the tRPC httpBatchLink
- Import upward in FSD layers (features must not import from widgets or routes)
