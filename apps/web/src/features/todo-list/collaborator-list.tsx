import type { AppRouter } from "@project/api/router";
import { Button } from "@project/ui/components/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TRPCOptionsProxy } from "@trpc/tanstack-react-query";
import { toast } from "sonner";

export function CollaboratorList({
  listId,
  ownerId,
  currentUserId,
  trpc,
}: {
  listId: string;
  ownerId: string;
  currentUserId: string;
  trpc: TRPCOptionsProxy<AppRouter>;
}) {
  const queryClient = useQueryClient();
  const collaborators = useQuery(
    trpc.todoList.collaborators.queryOptions({ listId }),
  );

  const remove = useMutation(
    trpc.todoList.removeCollaborator.mutationOptions({
      onSuccess: () => {
        toast.success("Collaborator removed");
        queryClient.invalidateQueries(
          trpc.todoList.collaborators.queryFilter({ listId }),
        );
      },
      onError: (err) => toast.error(err.message),
    }),
  );

  const isOwner = ownerId === currentUserId;

  if (collaborators.isPending) {
    return (
      <p className="text-sm text-muted-foreground">Loading collaborators…</p>
    );
  }
  if (collaborators.isError) {
    return (
      <p className="text-sm text-destructive">Couldn't load collaborators.</p>
    );
  }

  const list = collaborators.data ?? [];

  if (list.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No collaborators yet.</p>
    );
  }

  return (
    <ul className="space-y-2">
      {list.map((m) => (
        <li
          key={m.id}
          className="flex items-center justify-between rounded border p-2"
        >
          <span>
            {m.user.name}{" "}
            <span className="text-muted-foreground">@{m.user.username}</span>
          </span>
          {isOwner && m.user.id !== ownerId && (
            <Button
              size="sm"
              variant="ghost"
              disabled={remove.isPending}
              onClick={() => remove.mutate({ listId, userId: m.user.id })}
            >
              Remove
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}
