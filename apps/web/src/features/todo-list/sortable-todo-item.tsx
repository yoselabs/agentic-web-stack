import { defaultAnimateLayoutChanges, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@project/ui/components/button";
import type { Todo } from "./todo-types";

export function SortableTodoItem({
  todo,
  onComplete,
  onDelete,
}: {
  todo: Todo;
  onComplete: () => void;
  onDelete: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: todo.id,
    // Don't animate the dropped item — DOM order is already updated via setQueryData
    animateLayoutChanges: (args) =>
      args.wasDragging ? false : defaultAnimateLayoutChanges(args),
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    touchAction: "none" as const,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      data-testid="todo-row"
      aria-label={todo.title}
      className="flex cursor-grab items-center gap-3 rounded-lg border bg-background p-3 active:cursor-grabbing"
      {...attributes}
      {...listeners}
    >
      <input
        type="checkbox"
        checked={todo.completed}
        onChange={onComplete}
        onClick={(e) => e.stopPropagation()}
        className="h-4 w-4"
      />
      <span className="flex-1">{todo.title}</span>
      <Button
        variant="ghost"
        size="sm"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        className="text-destructive hover:text-destructive"
      >
        Delete
      </Button>
    </li>
  );
}
