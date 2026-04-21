import { createFileRoute } from "@tanstack/react-router";
import { TodoListDetailPage } from "#/features/todo-list/todo-list-detail-page";

// Loader-driven data prefetch. Every navigation to this route refetches
// both the list and its todos — collaborators can mutate while the page
// is unmounted and the live-updates WS subscription is inactive, so a
// belt-and-braces refetch on entry keeps us from showing stale cache.
// Once we're on the page, `useTodoListLiveUpdates` takes over for
// freshness. See docs/superpowers/specs/2026-04-18-zero-conf-* + FSD
// route-shell rule in apps/web/CLAUDE.md.
export const Route = createFileRoute("/_authenticated/todo-lists/$listId")({
  loader: ({ context: { trpc, queryClient }, params }) =>
    Promise.all([
      queryClient.fetchQuery(
        trpc.todoList.get.queryOptions({ id: params.listId }),
      ),
      queryClient.fetchQuery(
        trpc.todo.list.queryOptions({ todoListId: params.listId }),
      ),
    ]),
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
