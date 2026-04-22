import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { useAppSession } from "#/features/auth/session-context";
import { useUserInbox } from "#/features/user/use-user-inbox";

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: ({ context }) => {
    if (!context.session) throw redirect({ to: "/login" });
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const { trpc } = Route.useRouteContext();
  const { data: session } = useAppSession();
  // Session-scoped inbox subscription. Mounted at the authenticated layout
  // so every protected route has live counter/invite/access updates —
  // not just the dashboard. See ADR-001 §D1.
  useUserInbox(trpc, session?.user.id ?? null);

  return (
    <div className="min-h-screen">
      <Outlet />
    </div>
  );
}
