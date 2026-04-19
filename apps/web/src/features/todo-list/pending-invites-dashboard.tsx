import type { AppRouter } from "@project/api/router";
import { Button } from "@project/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@project/ui/components/card";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TRPCOptionsProxy } from "@trpc/tanstack-react-query";
import { toast } from "sonner";

export function PendingInvitesDashboard({
  trpc,
}: {
  trpc: TRPCOptionsProxy<AppRouter>;
}) {
  const queryClient = useQueryClient();
  const invites = useQuery(trpc.todoList.myPendingInvites.queryOptions());

  const accept = useMutation(
    trpc.todoList.acceptInvite.mutationOptions({
      onSuccess: () => {
        toast.success("Invite accepted");
        queryClient.invalidateQueries(
          trpc.todoList.myPendingInvites.queryFilter(),
        );
        queryClient.invalidateQueries(
          trpc.todoList.listAccessible.queryFilter(),
        );
      },
      onError: (err) => toast.error(err.message),
    }),
  );
  const decline = useMutation(
    trpc.todoList.declineInvite.mutationOptions({
      onSuccess: () => {
        toast.success("Invite declined");
        queryClient.invalidateQueries(
          trpc.todoList.myPendingInvites.queryFilter(),
        );
      },
      onError: (err) => toast.error(err.message),
    }),
  );

  if (invites.isPending) return null;
  if (!invites.data || invites.data.length === 0) return null;

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>Pending invitations</CardTitle>
        <CardDescription>
          You've been invited to collaborate on these lists.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {invites.data.map((inv) => (
            <li
              key={inv.id}
              className="flex items-center justify-between rounded border p-2"
            >
              <span className="flex items-center gap-2">
                <span
                  className="inline-block h-3 w-3 rounded-full"
                  style={{ backgroundColor: inv.todoList.color }}
                />
                <span>
                  <span className="font-medium">{inv.todoList.name}</span>{" "}
                  <span className="text-muted-foreground">
                    (from @{inv.todoList.user.username})
                  </span>
                </span>
              </span>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => accept.mutate({ token: inv.token })}
                  disabled={accept.isPending || decline.isPending}
                >
                  Accept
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => decline.mutate({ token: inv.token })}
                  disabled={accept.isPending || decline.isPending}
                >
                  Decline
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
