import { createFileRoute, redirect } from "@tanstack/react-router";
import { InvitePage } from "#/features/todo-list/invite-page";

// Public route: /invites/:token. Not-signed-in users bounce to /login with
// `next` preserved. Signed-in users hit the loader, which calls
// todoList.acceptInvite directly against the raw tRPC client and then
// throws a redirect — either to the list on success, or back to /todo-lists
// on failure. All side effects happen in the loader so there is no
// render-time mutation and no StrictMode double-fire guard to maintain.
export const Route = createFileRoute("/invites/$token")({
  beforeLoad: ({ context }) => {
    if (!context.session) {
      throw redirect({ to: "/login" });
    }
  },
  loader: async ({ context: { trpcClient }, params }) => {
    const membership = await trpcClient.todoList.acceptInvite
      .mutate({ token: params.token })
      .catch(() => null);
    if (!membership) {
      throw redirect({ to: "/todo-lists" });
    }
    throw redirect({
      to: "/todo-lists/$listId",
      params: { listId: membership.todoListId },
    });
  },
  component: InvitePage,
});
