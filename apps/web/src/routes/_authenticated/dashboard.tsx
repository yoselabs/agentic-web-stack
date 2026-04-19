import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@project/ui/components/card";
import { createFileRoute } from "@tanstack/react-router";
import { useSession } from "#/features/auth/auth-client";
import { PendingInvitesDashboard } from "#/features/todo-list/pending-invites-dashboard";
import { useUserInbox } from "#/features/user/use-user-inbox";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardPage,
});

function DashboardPage() {
  const { data: session } = useSession();
  const { trpc } = Route.useRouteContext();
  useUserInbox(trpc, session?.user.id ?? null);

  return (
    <main className="max-w-2xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
      <h1 className="text-3xl font-bold mb-6">Dashboard</h1>
      <PendingInvitesDashboard trpc={trpc} />
      <Card>
        <CardHeader>
          <CardTitle>
            Welcome, {session?.user.name ?? session?.user.email}
          </CardTitle>
          <CardDescription>You are signed in and ready to go.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Use the navigation above to manage your todos or explore the app.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
