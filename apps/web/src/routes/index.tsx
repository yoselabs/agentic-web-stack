import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: LandingPage,
});

function LandingPage() {
  const { session } = Route.useRouteContext();
  return (
    <main style={{ padding: "2rem", maxWidth: "640px", margin: "0 auto" }}>
      <h1>Agentic Web Stack</h1>
      <p>
        Effect-TS + TanStack Start + tRPC. Phase 3 first slice — auth + todos.
      </p>
      {session ? (
        <p>
          Signed in as <strong>{session.user.email}</strong>.{" "}
          <Link to="/dashboard">Open dashboard →</Link>
        </p>
      ) : (
        <p>
          <Link to="/sign-in">Sign in</Link> or{" "}
          <Link to="/sign-up">create an account</Link> to get started.
        </p>
      )}
    </main>
  );
}
