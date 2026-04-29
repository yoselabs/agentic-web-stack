import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { useTodoLists } from "../../features/todo-list/use-todo-lists.ts";
import { signOut } from "../../lib/auth-client.ts";

export const Route = createFileRoute("/_authed/dashboard")({
  component: DashboardPage,
});

function DashboardPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { trpc, session } = Route.useRouteContext();
  const { lists, createList, deleteList } = useTodoLists(trpc, queryClient);
  const [name, setName] = useState("");

  if (!session) return null;

  async function handleSignOut() {
    await signOut();
    await router.invalidate();
    router.navigate({ to: "/" });
  }

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    createList.mutate(
      { name: name.trim(), color: "#6366f1" },
      { onSuccess: () => setName("") },
    );
  }

  return (
    <main style={{ padding: "2rem", maxWidth: "640px", margin: "0 auto" }}>
      <h1>Todo lists</h1>
      <p>
        Signed in as <strong>{session.user.name}</strong>.{" "}
        <button type="button" onClick={handleSignOut}>
          Sign out
        </button>
      </p>

      <form onSubmit={handleCreate} aria-label="Create a list">
        <input
          aria-label="List name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Add a list…"
        />
        <button type="submit" disabled={createList.isPending}>
          {createList.isPending ? "Creating…" : "Create list"}
        </button>
      </form>

      {lists.isLoading && <p>Loading…</p>}
      {lists.data && lists.data.length === 0 && <p>No lists yet</p>}
      {lists.data && lists.data.length > 0 && (
        <ul style={{ marginTop: "1rem" }}>
          {lists.data.map((list) => (
            <li key={list.id}>
              <Link to="/todo-lists/$listId" params={{ listId: list.id }}>
                {list.name}
              </Link>{" "}
              <button
                type="button"
                aria-label={`Delete ${list.name}`}
                onClick={() => deleteList.mutate({ id: list.id })}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
