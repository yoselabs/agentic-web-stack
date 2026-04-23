import type { AppRouter } from "@project/api/router";
import { Button } from "@project/ui/components/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TRPCOptionsProxy } from "@trpc/tanstack-react-query";
import { toast } from "sonner";

export function PendingInvitesOwner({
  listId,
  trpc,
}: {
  listId: string;
  trpc: TRPCOptionsProxy<AppRouter>;
}) {
  const queryClient = useQueryClient();
  const invites = useQuery(
    trpc.todoList.pendingInvites.queryOptions({ listId }),
  );
  const revoke = useMutation(
    trpc.todoList.revokeInvite.mutationOptions({
      onSuccess: () => {
        toast.success("Invite revoked");
        queryClient.invalidateQueries(
          trpc.todoList.pendingInvites.queryFilter({ listId }),
        );
      },
      onError: (err) => toast.error(err.message),
    }),
  );

  if (invites.isPending) return null;
  if (!invites.data || invites.data.length === 0) return null;

  return (
    <section
      aria-labelledby="pending-invites-heading"
      className="mt-4 space-y-2"
    >
      <h4 id="pending-invites-heading" className="font-semibold text-sm">
        Pending invites
      </h4>
      <ul className="space-y-2">
        {invites.data.map((inv) => (
          <li
            key={inv.id}
            className="flex items-center justify-between rounded border p-2"
          >
            <span>
              {inv.invitedUser.name}{" "}
              <span className="text-muted-foreground">
                @{inv.invitedUser.username}
              </span>
            </span>
            <Button
              size="sm"
              variant="ghost"
              disabled={revoke.isPending}
              onClick={() => revoke.mutate({ inviteId: inv.id })}
            >
              Revoke
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
