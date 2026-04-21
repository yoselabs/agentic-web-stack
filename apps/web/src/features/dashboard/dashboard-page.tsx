import type { AppRouter } from "@project/api/router";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@project/ui/components/card";
import type { TRPCOptionsProxy } from "@trpc/tanstack-react-query";
import { useSession } from "#/features/auth/auth-client";
import { PendingInvitesDashboard } from "#/features/todo-list/pending-invites-dashboard";

// Composes user-session display with the todo-list pending invites widget.
// Lives in its own feature dir because it spans two domain concerns
// (auth session + todo-list invites); neither alone owns it.
export function DashboardPage({ trpc }: { trpc: TRPCOptionsProxy<AppRouter> }) {
  const { data: session } = useSession();

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
