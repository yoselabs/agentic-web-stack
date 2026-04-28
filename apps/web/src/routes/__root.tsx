// PHASE-1 STUB: placeholder to keep TanStack Router config valid during the
// Effect-TS rewrite wipe. Phase 3 replaces this with the rebuilt root route.
import { createRootRoute, Outlet } from "@tanstack/react-router";

export const Route = createRootRoute({
  component: () => <Outlet />,
});
