import { closestCenter, DndContext } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import type { AppRouter } from "@project/api/router";
import { Button } from "@project/ui/components/button";
import { Input } from "@project/ui/components/input";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { TRPCOptionsProxy } from "@trpc/tanstack-react-query";
import { useRef } from "react";
import { AccessLostEmptyState } from "#/features/todo-list/access-lost-empty-state.js";
import { CollaboratorList } from "#/features/todo-list/collaborator-list.js";
import { CompletedTodoItem } from "#/features/todo-list/completed-todo-item.js";
import { ShareListDialog } from "#/features/todo-list/share-list-dialog.js";
import { SortableTodoItem } from "#/features/todo-list/sortable-todo-item.js";
import { useTodoListLiveUpdates } from "#/features/todo-list/use-todo-list-live-updates.js";
import { useTodos } from "#/features/todo-list/use-todos.js";

export function TodoListDetailPage({
  trpc,
  listId,
  currentUserId,
}: {
  trpc: TRPCOptionsProxy<AppRouter>;
  listId: string;
  currentUserId: string | null;
}) {
  const queryClient = useQueryClient();

  useTodoListLiveUpdates(trpc, listId, currentUserId);

  // Data for these queries is pre-fetched by the route loader (see
  // routes/_authenticated/todo-lists/$listId.tsx), which force-refetches
  // both on every navigation. `useQuery` here just reads from the cache.
  // `useTodoListLiveUpdates` keeps the cache fresh while the page is
  // mounted.
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

  // FORBIDDEN surface: collaborator-removed flips this query to 403 on
  // the next refetch. The `data` field on TRPCClientError carries the
  // typed error shape (code === "FORBIDDEN"). Accept any shape whose
  // `data.code` is FORBIDDEN so the render works regardless of how tRPC
  // wraps the error across link boundaries.
  const errData = (listQuery.error as { data?: { code?: string } } | null)
    ?.data;
  if (errData?.code === "FORBIDDEN") {
    return <AccessLostEmptyState />;
  }

  return (
    <main className="max-w-2xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
      <div className="mb-6">
        <Link
          to="/todo-lists"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          {"<-"} Back to lists
        </Link>
        <div className="flex items-center justify-between mt-2 gap-4">
          <h1 className="text-3xl font-bold">
            {listQuery.data?.name ?? "Loading..."}
          </h1>
          <ShareListDialog listId={listId} trpc={trpc} />
        </div>
      </div>

      {listQuery.data && currentUserId && (
        <section className="mb-6">
          <h2 className="text-sm font-semibold text-muted-foreground mb-2">
            Collaborators
          </h2>
          <CollaboratorList
            listId={listId}
            ownerId={listQuery.data.userId}
            currentUserId={currentUserId}
            trpc={trpc}
          />
        </section>
      )}

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
