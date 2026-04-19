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
import { useMutation } from "@tanstack/react-query";
import type { TRPCOptionsProxy } from "@trpc/tanstack-react-query";
import { useState } from "react";
import { toast } from "sonner";
import { InviteAutocomplete } from "./invite-autocomplete";
import { PendingInvitesOwner } from "./pending-invites-owner";

type Candidate = { id: string; username: string; name: string };

export function ShareListDialog({
  listId,
  trpc,
}: {
  listId: string;
  trpc: TRPCOptionsProxy<AppRouter>;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Candidate | null>(null);

  const invite = useMutation(
    trpc.todoList.inviteCollaborator.mutationOptions({
      onSuccess: () => {
        toast.success(
          selected ? `Invite sent to @${selected.username}` : "Invite sent",
        );
        setSelected(null);
        setOpen(false);
      },
      onError: (err) => toast.error(err.message),
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
            Search by username. They'll receive an email to accept.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!selected) return;
            invite.mutate({ listId, username: selected.username });
          }}
        >
          <InviteAutocomplete
            trpc={trpc}
            onSelect={setSelected}
            disabled={invite.isPending}
          />
          <Button type="submit" disabled={!selected || invite.isPending}>
            Invite
          </Button>
        </form>
        <PendingInvitesOwner listId={listId} trpc={trpc} />
      </DialogContent>
    </Dialog>
  );
}
