import { Button } from "@project/ui/components/button";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useSession } from "#/features/auth/auth-client";

export const Route = createFileRoute("/")({
  component: HomePage,
});

function HomePage() {
  const { data: session, isPending } = useSession();

  return (
    <main className="flex min-h-[calc(100vh-57px)] items-center justify-center">
      <div className="text-center">
        <h1 className="text-4xl font-bold mb-4">Agentic Web Stack</h1>
        <p className="text-lg text-muted-foreground mb-6">
          TanStack Start + Hono + tRPC + Prisma + Better-Auth
        </p>
        {isPending ? (
          <p className="text-muted-foreground">Loading...</p>
        ) : session ? (
          <Button asChild>
            <Link to="/dashboard">Go to Dashboard</Link>
          </Button>
        ) : null}
      </div>
    </main>
  );
}
