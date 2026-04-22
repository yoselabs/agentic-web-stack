import { createFileRoute } from "@tanstack/react-router";
import { TodoListDetailPage } from "#/features/todo-list/todo-list-detail-page";

// Loader-driven data prefetch. Every navigation to this route refetches
// both the list and its todos — collaborators can mutate while the page
// is unmounted and the live-updates WS subscription is inactive, so a
// belt-and-braces refetch on entry keeps us from showing stale cache.
// Once we're on the page, `useTodoListLiveUpdates` takes over for
// freshness. See docs/superpowers/specs/2026-04-18-zero-conf-* + FSD
// route-shell rule in apps/web/CLAUDE.md.
//
// Swallow-and-cache pattern: `fetchQuery` stores errors in the query
// cache even when it rejects. Rejections that bubble out of the loader
// trigger the root error component, but for FORBIDDEN (revoked
// collaborator) + NOT_FOUND (deleted list) the page component has its
// own access-lost render path that reads `useQuery().error`. Swallowing
// the rejection here keeps that seam intact under SSR/hard-reload —
// otherwise the user hits a generic 500 on a hard refresh immediately
// after being removed. Any other error (500s, network) still surfaces
// via `useQuery().error` inside the component.
export const Route = createFileRoute("/_authenticated/todo-lists/$listId")({
  loader: ({ context: { trpc, queryClient }, params }) =>
    Promise.all([
      queryClient
        .fetchQuery(trpc.todoList.get.queryOptions({ id: params.listId }))
        .catch(() => {}),
      queryClient
        .fetchQuery(trpc.todo.list.queryOptions({ todoListId: params.listId }))
        .catch(() => {}),
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
