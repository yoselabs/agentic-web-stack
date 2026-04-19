import type { AppRouter } from "@project/api/router";
import { Button } from "@project/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@project/ui/components/dialog";
import { Input } from "@project/ui/components/input";
import { useMutation } from "@tanstack/react-query";
import type { TRPCOptionsProxy } from "@trpc/tanstack-react-query";
import { useState } from "react";
import { toast } from "sonner";

export function ShareListDialog({
  listId,
  trpc,
}: {
  listId: string;
  trpc: TRPCOptionsProxy<AppRouter>;
}) {
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState("");

  const invite = useMutation(
    trpc.todoList.inviteCollaborator.mutationOptions({
      onSuccess: () => {
        toast.success(`Invite sent to ${username}`);
        setUsername("");
        setOpen(false);
      },
      onError: (err) => {
        toast.error(err.message);
      },
    }),
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">Share</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite a collaborator</DialogTitle>
          <DialogDescription>
            Invite someone by their @username. They'll receive an email to
            accept.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const trimmed = username.trim();
            if (!trimmed) return;
            invite.mutate({ listId, username: trimmed });
          }}
        >
          <Input
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={invite.isPending}
            autoFocus
          />
          <Button type="submit" disabled={invite.isPending}>
            Invite
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
