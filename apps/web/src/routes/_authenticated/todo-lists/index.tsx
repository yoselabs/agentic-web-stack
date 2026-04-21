import { createFileRoute } from "@tanstack/react-router";
import { TodoListsPage } from "#/features/todo-list/todo-lists-page";

export const Route = createFileRoute("/_authenticated/todo-lists/")({
  component: RouteComponent,
});

function RouteComponent() {
  const { trpc } = Route.useRouteContext();
  return <TodoListsPage trpc={trpc} />;
}
