import type { AppRouter } from "@project/api/router";
import { Badge } from "@project/ui/components/badge";
import { Button } from "@project/ui/components/button";
import { Input } from "@project/ui/components/input";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { TRPCOptionsProxy } from "@trpc/tanstack-react-query";
import { PendingInvitesDashboard } from "#/features/todo-list/pending-invites-dashboard";
import { useTodoLists } from "#/features/todo-list/use-todo-lists.js";

export function TodoListsPage({ trpc }: { trpc: TRPCOptionsProxy<AppRouter> }) {
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
    <main
      data-testid="todo-lists-index"
      className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-10"
    >
      <PendingInvitesDashboard trpc={trpc} />

      <h1 className="mb-6 font-bold text-3xl">Todo Lists</h1>

      <form onSubmit={handleSubmit} className="mb-6 flex gap-2">
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
              className="flex items-center justify-between rounded-lg border p-3"
            >
              <Link
                to="/todo-lists/$listId"
                params={{ listId: list.id }}
                className="flex flex-1 items-center gap-3 hover:opacity-80"
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
