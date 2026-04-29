import { z } from "zod";
import {
  DEFAULT_TODO_LIST_COLOR,
  TODO_LIST_NAME_MAX_LENGTH,
  TODO_TITLE_MAX_LENGTH,
} from "./todo-constants.ts";

// Phase 3 step 5: Zod for now. Step 6's bundle measurement decides
// whether to migrate to Effect Schema (ADR-0014).

export const createTodoListInput = z.object({
  name: z.string().trim().min(1).max(TODO_LIST_NAME_MAX_LENGTH),
  color: z.string().default(DEFAULT_TODO_LIST_COLOR),
});

export const todoListIdInput = z.object({
  id: z.cuid(),
});

export const createTodoInput = z.object({
  todoListId: z.cuid(),
  title: z.string().trim().min(1).max(TODO_TITLE_MAX_LENGTH),
});

export const todoIdInput = z.object({
  id: z.cuid(),
});

export const todosOfListInput = z.object({
  todoListId: z.cuid(),
});
