import { DndContext, closestCenter } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { Button } from "@project/ui/components/button";
import { Input } from "@project/ui/components/input";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useRef } from "react";
import { CompletedTodoItem } from "#/features/todo/completed-todo-item.js";
import { SortableTodoItem } from "#/features/todo/sortable-todo-item.js";
import { useTodos } from "#/features/todo/use-todos.js";

export const Route = createFileRoute("/_authenticated/todo-lists/$listId")({
  component: TodoListDetailPage,
});

function TodoListDetailPage() {
  const { trpc } = Route.useRouteContext();
  const { listId } = Route.useParams();
  const queryClient = useQueryClient();

  const listQuery = useQuery(trpc.todoList.get.queryOptions({ id: listId }));
  const {
    newTitle,
    setNewTitle,
    todos,
    activeTodos,
    completedTodos,
    sensors,
    createTodo,
    completeTodo,
    deleteTodo,
    handleSubmit,
    handleDragEnd,
    importTodos,
    exportTodos,
  } = useTodos(trpc, queryClient, listId);

  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <main className="max-w-2xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
      <div className="mb-6">
        <Link
          to="/todo-lists"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          {"<-"} Back to lists
        </Link>
        <h1 className="text-3xl font-bold mt-2">
          {listQuery.data?.name ?? "Loading..."}
        </h1>
      </div>

      <div className="flex gap-2 mb-4">
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              importTodos.mutate(file);
              e.target.value = "";
            }
          }}
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
          disabled={importTodos.isPending}
        >
          {importTodos.isPending ? "Importing..." : "Import CSV"}
        </Button>
        <Button variant="outline" size="sm" onClick={exportTodos}>
          Export CSV
        </Button>
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2 mb-6">
        <Input
          type="text"
          placeholder="Add a todo..."
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          className="flex-1"
        />
        <Button type="submit" disabled={createTodo.isPending}>
          {createTodo.isPending ? "Adding..." : "Add"}
        </Button>
      </form>

      {todos.isPending ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : todos.data?.length === 0 ? (
        <p className="text-muted-foreground">No todos yet</p>
      ) : (
        <>
          {activeTodos.length > 0 && (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={activeTodos.map((t) => t.id)}
                strategy={verticalListSortingStrategy}
              >
                <ul className="space-y-2">
                  {activeTodos.map((todo) => (
                    <SortableTodoItem
                      key={todo.id}
                      todo={todo}
                      onComplete={() =>
                        completeTodo.mutate({
                          id: todo.id,
                          completed: !todo.completed,
                        })
                      }
                      onDelete={() => deleteTodo.mutate({ id: todo.id })}
                    />
                  ))}
                </ul>
              </SortableContext>
            </DndContext>
          )}

          {completedTodos.length > 0 && (
            <>
              {activeTodos.length > 0 && <div className="border-t my-4" />}
              <ul className="space-y-2">
                {completedTodos.map((todo) => (
                  <CompletedTodoItem
                    key={todo.id}
                    todo={todo}
                    onUncomplete={() =>
                      completeTodo.mutate({
                        id: todo.id,
                        completed: !todo.completed,
                      })
                    }
                    onDelete={() => deleteTodo.mutate({ id: todo.id })}
                  />
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </main>
  );
}
