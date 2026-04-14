import { Badge } from "@project/ui/components/badge";
import { Button } from "@project/ui/components/button";
import { Input } from "@project/ui/components/input";
import { useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useTodoLists } from "#/features/todo-list/use-todo-lists.js";

export const Route = createFileRoute("/_authenticated/todo-lists/")({
  component: TodoListsPage,
});

function TodoListsPage() {
  const { trpc } = Route.useRouteContext();
  const queryClient = useQueryClient();
  const {
    newName,
    setNewName,
    todoLists,
    createTodoList,
    deleteTodoList,
    handleSubmit,
  } = useTodoLists(trpc, queryClient);

  return (
    <main className="max-w-2xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
      <h1 className="text-3xl font-bold mb-6">Todo Lists</h1>

      <form onSubmit={handleSubmit} className="flex gap-2 mb-6">
        <Input
          type="text"
          placeholder="New list name..."
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          className="flex-1"
        />
        <Button type="submit" disabled={createTodoList.isPending}>
          {createTodoList.isPending ? "Creating..." : "Create"}
        </Button>
      </form>

      {todoLists.isPending ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : todoLists.data?.length === 0 ? (
        <p className="text-muted-foreground">
          No lists yet. Create one to get started.
        </p>
      ) : (
        <ul className="space-y-2">
          {todoLists.data?.map((list) => (
            <li
              key={list.id}
              className="flex items-center justify-between p-3 border rounded-lg"
            >
              <Link
                to="/todo-lists/$listId"
                params={{ listId: list.id }}
                className="flex items-center gap-3 flex-1 hover:opacity-80"
              >
                <span className="font-medium">{list.name}</span>
                <Badge
                  style={{ backgroundColor: list.color }}
                  className="text-white"
                >
                  {list._count.todos} todos
                </Badge>
              </Link>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => deleteTodoList.mutate({ id: list.id })}
                aria-label={`Delete ${list.name}`}
              >
                Delete
              </Button>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
