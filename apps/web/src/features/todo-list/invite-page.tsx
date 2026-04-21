import type { AppRouter } from "@project/api/router";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { TRPCOptionsProxy } from "@trpc/tanstack-react-query";
import { useEffect, useRef } from "react";

export function InvitePage({
  trpc,
  token,
}: {
  trpc: TRPCOptionsProxy<AppRouter>;
  token: string;
}) {
  const navigate = useNavigate();
  const firedRef = useRef(false);

  const accept = useMutation(
    trpc.todoList.acceptInvite.mutationOptions({
      onSuccess: (membership) => {
        void navigate({
          to: "/todo-lists/$listId",
          params: { listId: membership.todoListId },
        });
      },
      onError: () => {
        void navigate({ to: "/todo-lists" });
      },
    }),
  );

  // Fire once per mount. StrictMode double-invokes effects in dev; the ref
  // guards against a duplicate mutation.
  useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    accept.mutate({ token });
  }, [accept, token]);

  return (
    <main className="max-w-2xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
      <p className="text-muted-foreground">Accepting invite…</p>
    </main>
  );
}
