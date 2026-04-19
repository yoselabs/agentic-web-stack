import { Button } from "@project/ui/components/button";
import { Link } from "@tanstack/react-router";

export function AccessLostEmptyState() {
  return (
    <main className="max-w-2xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
      <div className="rounded-lg border p-8 text-center">
        <h1 className="text-xl font-semibold">
          You no longer have access to this list
        </h1>
        <p className="text-muted-foreground mt-2">
          The owner removed you as a collaborator.
        </p>
        <Button asChild className="mt-4">
          <Link to="/todo-lists">Back to your lists</Link>
        </Button>
      </div>
    </main>
  );
}
