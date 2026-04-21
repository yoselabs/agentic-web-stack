// Pure fallback UI — the route loader awaits the accept-invite mutation
// and throws a redirect before this ever renders in the success path.
// This component only appears during the in-flight `pendingComponent`
// window (TanStack Router shows it while the loader resolves).
export function InvitePage() {
  return (
    <main className="max-w-2xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
      <p className="text-muted-foreground">Accepting invite…</p>
    </main>
  );
}
