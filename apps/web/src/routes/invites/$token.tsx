import { useMutation } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

// Public route: /invites/:token. If not signed in, bounces to /login with
// `next` preserved. If signed in, calls todoList.acceptInvite on mount and
// redirects to the list on success, or back to /todo-lists on failure.
// Kept deliberately thin — the heavy lifting is server-side.
export const Route = createFileRoute("/invites/$token")({
  beforeLoad: ({ context }) => {
    if (!context.session) {
      throw redirect({ to: "/login" });
    }
  },
  component: AcceptInvitePage,
});

function AcceptInvitePage() {
  const { trpc } = Route.useRouteContext();
  const { token } = Route.useParams();
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
