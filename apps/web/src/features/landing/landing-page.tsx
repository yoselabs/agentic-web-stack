import { Button } from "@project/ui/components/button";
import { Link } from "@tanstack/react-router";
import { useAppSession } from "#/features/auth/session-context";

export function LandingPage() {
  const { data: session, isPending } = useAppSession();

  return (
    <main className="flex min-h-[calc(100vh-57px)] items-center justify-center">
      <div className="text-center">
        <h1 className="mb-4 font-bold text-4xl">Agentic Web Stack</h1>
        <p className="mb-6 text-lg text-muted-foreground">
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
