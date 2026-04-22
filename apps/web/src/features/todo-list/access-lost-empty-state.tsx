import { Button } from "@project/ui/components/button";
import { Link } from "@tanstack/react-router";

export function AccessLostEmptyState() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-10">
      <div className="rounded-lg border p-8 text-center">
        <h1 className="font-semibold text-xl">
          You no longer have access to this list
        </h1>
        <p className="mt-2 text-muted-foreground">
          The owner removed you as a collaborator.
        </p>
        <Button asChild className="mt-4">
          <Link to="/todo-lists">Back to your lists</Link>
        </Button>
      </div>
    </main>
  );
}
