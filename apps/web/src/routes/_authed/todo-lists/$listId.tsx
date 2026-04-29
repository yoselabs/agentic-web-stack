import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTodos } from "../../../features/todo-list/use-todos.ts";

export const Route = createFileRoute("/_authed/todo-lists/$listId")({
  component: TodoListDetailPage,
});

function TodoListDetailPage() {
  const queryClient = useQueryClient();
  const { trpc } = Route.useRouteContext();
  const { listId } = Route.useParams();
  const { todos, createTodo, toggleTodo, deleteTodo } = useTodos(
    trpc,
    queryClient,
    listId,
  );
  const [title, setTitle] = useState("");

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    createTodo.mutate(
      { todoListId: listId, title: title.trim() },
      { onSuccess: () => setTitle("") },
    );
  }

  return (
    <main style={{ padding: "2rem", maxWidth: "640px", margin: "0 auto" }}>
      <p>
        <Link to="/dashboard">← All lists</Link>
      </p>
      <h1>Todos</h1>

      <form onSubmit={handleCreate} aria-label="Create a todo">
        <input
          aria-label="Todo title"
          placeholder="Add a todo..."
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <button type="submit" disabled={createTodo.isPending}>
          {createTodo.isPending ? "Adding…" : "Add"}
        </button>
      </form>

      {todos.isLoading && <p>Loading…</p>}
      {todos.data && todos.data.length === 0 && <p>No todos yet</p>}
      {todos.data && todos.data.length > 0 && (
        <ul style={{ marginTop: "1rem", listStyle: "none", padding: 0 }}>
          {todos.data.map((todo) => (
            <li
              key={todo.id}
              style={{
                display: "flex",
                gap: "0.5rem",
                alignItems: "center",
                padding: "0.25rem 0",
              }}
            >
              <input
                type="checkbox"
                aria-label={`Toggle ${todo.title}`}
                checked={todo.completed}
                onChange={() => toggleTodo.mutate({ id: todo.id })}
              />
              <span
                style={{
                  textDecoration: todo.completed ? "line-through" : "none",
                  flex: 1,
                }}
              >
                {todo.title}
              </span>
              <button
                type="button"
                aria-label={`Delete ${todo.title}`}
                onClick={() => deleteTodo.mutate({ id: todo.id })}
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
