import type { AppRouter } from "@project/api/router";
import { Badge } from "@project/ui/components/badge";
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

  const data = collaborators.data;
  if (!data) return null;
  const { owner, collaborators: members } = data;

  return (
    <ul className="space-y-2">
      <li className="flex items-center justify-between rounded border p-2">
        <span className="flex items-center gap-2">
          <span>{owner.name}</span>
          <span className="text-muted-foreground">@{owner.username}</span>
          {owner.id === currentUserId && (
            <span className="text-muted-foreground">(You)</span>
          )}
          <Badge variant="secondary">Owner</Badge>
        </span>
      </li>
      {members.map((m) => (
        <li
          key={m.id}
          className="flex items-center justify-between rounded border p-2"
        >
          <span className="flex items-center gap-2">
            <span>{m.user.name}</span>
            <span className="text-muted-foreground">@{m.user.username}</span>
            {m.user.id === currentUserId && (
              <span className="text-muted-foreground">(You)</span>
            )}
            <Badge variant="outline">Collaborator</Badge>
          </span>
          {isOwner && m.user.id !== currentUserId && (
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
      {members.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No other collaborators yet.
        </p>
      )}
    </ul>
  );
}
