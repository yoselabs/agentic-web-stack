import { createFileRoute } from "@tanstack/react-router";
import { TodoListDetailPage } from "#/features/todo-list/todo-list-detail-page";

export const Route = createFileRoute("/_authenticated/todo-lists/$listId")({
  component: RouteComponent,
});

function RouteComponent() {
  const { trpc, session } = Route.useRouteContext();
  const { listId } = Route.useParams();
  return (
    <TodoListDetailPage
      trpc={trpc}
      listId={listId}
      currentUserId={session?.user.id ?? null}
    />
  );
}
