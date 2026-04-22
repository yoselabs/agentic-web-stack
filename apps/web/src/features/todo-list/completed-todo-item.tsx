import { Button } from "@project/ui/components/button";
import type { Todo } from "./todo-types";

export function CompletedTodoItem({
  todo,
  onUncomplete,
  onDelete,
}: {
  todo: Todo;
  onUncomplete: () => void;
  onDelete: () => void;
}) {
  return (
    <li
      data-testid="todo-row"
      className="flex items-center gap-3 rounded-lg border p-3 opacity-60"
    >
      <input
        type="checkbox"
        checked={todo.completed}
        onChange={onUncomplete}
        className="h-4 w-4"
      />
      <span className="flex-1 text-muted-foreground line-through">
        {todo.title}
      </span>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onDelete()}
        className="text-destructive hover:text-destructive"
      >
        Delete
      </Button>
    </li>
  );
}
