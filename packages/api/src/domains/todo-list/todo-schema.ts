// Effect Schema replaces Zod here per ADR-0014 (closed by Day 2 commit 5).
// Forms in apps/web continue to use Zod via react-hook-form resolvers —
// that is the only Zod-allowed surface (spec D4).

import { Schema } from "effect";
import {
  DEFAULT_TODO_LIST_COLOR,
  TODO_LIST_NAME_MAX_LENGTH,
  TODO_TITLE_MAX_LENGTH,
} from "./todo-constants.ts";

// ── Domain row types (shapes returned by Prisma / service layer) ──────────

export const TodoList = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  color: Schema.String,
  userId: Schema.String,
  createdAt: Schema.DateFromSelf,
  updatedAt: Schema.DateFromSelf,
});
export type TodoList = Schema.Schema.Type<typeof TodoList>;

export const Todo = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  completed: Schema.Boolean,
  position: Schema.Number,
  userId: Schema.String,
  todoListId: Schema.String,
  createdAt: Schema.DateFromSelf,
  updatedAt: Schema.DateFromSelf,
});
export type Todo = Schema.Schema.Type<typeof Todo>;

// ── Input schemas ─────────────────────────────────────────────────────────

// Zod's .cuid() accepts standard CUIDs (lowercase alphanumeric, ~25 chars).
// Prisma's @default(cuid()) generates the same format.
// The pattern is a reasonable approximation; DB FK constraints catch anything
// structurally valid but referencing a non-existent record.
const CuidString = Schema.String.pipe(Schema.pattern(/^c[a-z0-9]{20,30}$/));

export const ListTodoListsInput = Schema.Struct({});
export type ListTodoListsInput = Schema.Schema.Type<typeof ListTodoListsInput>;

export const CreateTodoListInput = Schema.Struct({
  name: Schema.String.pipe(
    Schema.trimmed(),
    Schema.minLength(1),
    Schema.maxLength(TODO_LIST_NAME_MAX_LENGTH),
  ),
  color: Schema.optionalWith(Schema.String, {
    default: () => DEFAULT_TODO_LIST_COLOR,
  }),
});
export type CreateTodoListInput = Schema.Schema.Type<
  typeof CreateTodoListInput
>;

export const TodoListIdInput = Schema.Struct({
  id: CuidString,
});
export type TodoListIdInput = Schema.Schema.Type<typeof TodoListIdInput>;

export const CreateTodoInput = Schema.Struct({
  todoListId: CuidString,
  title: Schema.String.pipe(
    Schema.trimmed(),
    Schema.minLength(1),
    Schema.maxLength(TODO_TITLE_MAX_LENGTH),
  ),
});
export type CreateTodoInput = Schema.Schema.Type<typeof CreateTodoInput>;

export const TodoIdInput = Schema.Struct({
  id: CuidString,
});
export type TodoIdInput = Schema.Schema.Type<typeof TodoIdInput>;

export const TodosOfListInput = Schema.Struct({
  todoListId: CuidString,
});
export type TodosOfListInput = Schema.Schema.Type<typeof TodosOfListInput>;

export const PurgeInput = Schema.Struct({
  olderThanDays: Schema.Number.pipe(
    Schema.int(),
    Schema.greaterThanOrEqualTo(1),
  ),
});
export type PurgeInput = Schema.Schema.Type<typeof PurgeInput>;

export const PurgeReport = Schema.Struct({
  deleted: Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(0)),
});
export type PurgeReport = Schema.Schema.Type<typeof PurgeReport>;

export const DeleteResult = Schema.Struct({
  id: Schema.String,
});
export type DeleteResult = Schema.Schema.Type<typeof DeleteResult>;
