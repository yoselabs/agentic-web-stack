import { createFileRoute, redirect } from "@tanstack/react-router";
import { InvitePage } from "#/features/todo-list/invite-page";

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
  component: RouteComponent,
});

function RouteComponent() {
  const { trpc } = Route.useRouteContext();
  const { token } = Route.useParams();
  return <InvitePage trpc={trpc} token={token} />;
}
