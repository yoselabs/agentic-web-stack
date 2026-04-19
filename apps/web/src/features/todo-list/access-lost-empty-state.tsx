import { Button } from "@project/ui/components/button";
import { Link } from "@tanstack/react-router";

export function AccessLostEmptyState() {
  return (
    <div className="rounded-lg border p-8 text-center">
      <h2 className="text-xl font-semibold">
        You no longer have access to this list
      </h2>
      <p className="text-muted-foreground mt-2">
        The owner removed you as a collaborator.
      </p>
      <Button asChild className="mt-4">
        <Link to={"/todo-lists" as string}>Back to your lists</Link>
      </Button>
    </div>
  );
}
