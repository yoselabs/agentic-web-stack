import { createFileRoute, useRouter } from "@tanstack/react-router";
import { signOut } from "../../lib/auth-client.ts";

export const Route = createFileRoute("/_authed/dashboard")({
  component: DashboardPage,
});

function DashboardPage() {
  const router = useRouter();
  const { session } = Route.useRouteContext();
  if (!session) return null;

  async function handleSignOut() {
    await signOut();
    await router.invalidate();
    router.navigate({ to: "/" });
  }

  return (
    <main style={{ padding: "2rem", maxWidth: "640px", margin: "0 auto" }}>
      <h1>Dashboard</h1>
      <p>
        Welcome, <strong>{session.user.name}</strong> (
        <code>{session.user.email}</code>).
      </p>
      <p>Todo-list lands in step 6 of the Phase 3 plan.</p>
      <button type="button" onClick={handleSignOut}>
        Sign out
      </button>
    </main>
  );
}
