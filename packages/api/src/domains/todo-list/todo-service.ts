import { Prisma, type PrismaClient } from "@project/db";
import { channel as defaultChannel } from "@project/realtime/channel";
import type { Channel } from "@project/realtime/types";
import { TRPCError } from "@trpc/server";
import Papa from "papaparse";
import {
  type ActivityChannelProvider,
  emitActivity,
  publishActivity,
} from "./activity-publishers.js";
import { listChannelKey, type TodoListEvent } from "./events.js";
import { canReadList } from "./service.js";
import {
  defaultUserInboxProvider,
  listMemberIdsForList,
  publishCountersChanged,
  type UserInboxChannelProvider,
} from "./user-inbox-publishers.js";

type DbClient = PrismaClient | Prisma.TransactionClient;
type ChannelProvider = (key: string) => Channel<TodoListEvent>;

const defaultProvider: ChannelProvider = (k) => defaultChannel(k);

// Row-lock helpers require Prisma.TransactionClient (not the root PrismaClient union).
// Prisma has no native FOR UPDATE: if the root client is passed, Prisma runs each
// $queryRaw in its own implicit transaction and releases the lock immediately —
// silently, with no error. Every function that participates in the lock below
// must therefore accept Prisma.TransactionClient only, and routers wrap calls in
// ctx.db.$transaction((tx) => ...). See packages/api/CLAUDE.md.
async function lockActiveTodos(
  tx: Prisma.TransactionClient,
  todoListId: string,
): Promise<void> {
  // ORDER BY id: deterministic lock order across concurrent callers — avoids
  //   deadlocks if the planner ever picks different scan orders.
  // FOR NO KEY UPDATE: we only mutate `position` (non-key, non-FK), so the weaker
  //   lock is sufficient and allows concurrent FK references to these rows.
  // Widened from {userId, todoListId} to {todoListId} so collaborators contend on
  //   the same position-space as the owner — correct: they ARE racing.
  await tx.$queryRaw`
    SELECT id FROM "Todo"
    WHERE "todoListId" = ${todoListId} AND "completed" = false
    ORDER BY id
    FOR NO KEY UPDATE
  `;
}

async function shiftActivePositions(
  tx: Prisma.TransactionClient,
  todoListId: string,
): Promise<void> {
  await tx.todo.updateMany({
    where: { completed: false, todoListId },
    data: { position: { increment: 1 } },
  });
}

export async function listTodos(
  db: DbClient,
  viewerId: string,
  todoListId: string,
) {
  const allowed = await canReadList(db, viewerId, todoListId);
  if (!allowed) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You do not have access to this list.",
    });
  }
  return db.todo.findMany({
    where: { todoListId },
    orderBy: [{ completed: "asc" }, { position: "asc" }],
    include: { todoList: true },
  });
}

// Narrowed to Prisma.TransactionClient because they call lockActiveTodos.
// Router must always wrap: ctx.db.$transaction((tx) => createTodo(tx, ...)).
export async function createTodo(
  tx: Prisma.TransactionClient,
  creatorId: string,
  title: string,
  todoListId: string,
  options: {
    channel?: ChannelProvider;
    userInboxChannel?: UserInboxChannelProvider;
    activityChannel?: ActivityChannelProvider;
  } = {},
) {
  const provider = options.channel ?? defaultProvider;
  const allowed = await canReadList(tx, creatorId, todoListId);
  if (!allowed) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You do not have access to this list.",
    });
  }
  await lockActiveTodos(tx, todoListId);
  await shiftActivePositions(tx, todoListId);
  const created = await tx.todo.create({
    data: { title, userId: creatorId, todoListId, position: 0 },
    include: { todoList: true },
  });
  const activityEvent = await emitActivity(tx, {
    todoListId,
    actorId: creatorId,
    payload: { kind: "todo-created", todoId: created.id, title: created.title },
  });
  await provider(listChannelKey(todoListId)).publish({
    kind: "todo-created",
    listId: todoListId,
    todo: created,
  });
  await publishActivity(activityEvent, options.activityChannel);
  const inboxProvider = options.userInboxChannel ?? defaultUserInboxProvider;
  const recipients = await listMemberIdsForList(tx, todoListId);
  await publishCountersChanged(inboxProvider, recipients, todoListId);
  return created;
}

export async function completeTodo(
  tx: Prisma.TransactionClient,
  viewerId: string,
  id: string,
  completed: boolean,
  options: {
    channel?: ChannelProvider;
    userInboxChannel?: UserInboxChannelProvider;
    activityChannel?: ActivityChannelProvider;
  } = {},
) {
  const provider = options.channel ?? defaultProvider;
  const todo = await tx.todo.findUniqueOrThrow({ where: { id } });
  const allowed = await canReadList(tx, viewerId, todo.todoListId);
  if (!allowed) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You do not have access to this list.",
    });
  }
  if (!completed) {
    await lockActiveTodos(tx, todo.todoListId);
    await shiftActivePositions(tx, todo.todoListId);
    await tx.todo.update({
      where: { id },
      data: { completed: false, position: 0 },
    });
  } else {
    await tx.todo.update({
      where: { id },
      data: { completed },
    });
  }
  // Re-read with the todoList relation so the payload matches TodoWithList
  // (matches the shape consumed by client cache — see events.ts).
  const updatedWithList = await tx.todo.findUniqueOrThrow({
    where: { id },
    include: { todoList: true },
  });
  const activityEvent = await emitActivity(tx, {
    todoListId: todo.todoListId,
    actorId: viewerId,
    payload: {
      kind: completed ? "todo-completed" : "todo-uncompleted",
      todoId: updatedWithList.id,
      title: updatedWithList.title,
    },
  });
  // Fan out to collaborators so they see the completion state flip in realtime.
  await provider(listChannelKey(todo.todoListId)).publish({
    kind: "todo-updated",
    listId: todo.todoListId,
    todo: updatedWithList,
  });
  await publishActivity(activityEvent, options.activityChannel);
  const inboxProvider = options.userInboxChannel ?? defaultUserInboxProvider;
  const recipients = await listMemberIdsForList(tx, todo.todoListId);
  await publishCountersChanged(inboxProvider, recipients, todo.todoListId);
  return updatedWithList;
}

export async function reorderTodos(
  tx: Prisma.TransactionClient,
  viewerId: string,
  todoListId: string,
  ids: string[],
  options: { channel?: ChannelProvider } = {},
) {
  const provider = options.channel ?? defaultProvider;
  const allowed = await canReadList(tx, viewerId, todoListId);
  if (!allowed) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You do not have access to this list.",
    });
  }
  const pairs = ids.map((id, i) => Prisma.sql`(${id}::text, ${i}::integer)`);
  await tx.$executeRaw`
    UPDATE "Todo" AS t
    SET "position" = d.new_position
    FROM (VALUES ${Prisma.join(pairs, ",")}) AS d(id, new_position)
    WHERE t.id = d.id
  `;
  await provider(listChannelKey(todoListId)).publish({
    kind: "todos-reordered",
    listId: todoListId,
    positions: ids.map((id, i) => ({ id, position: i })),
  });
}

export async function deleteTodo(
  tx: Prisma.TransactionClient,
  viewerId: string,
  id: string,
  options: {
    channel?: ChannelProvider;
    userInboxChannel?: UserInboxChannelProvider;
    activityChannel?: ActivityChannelProvider;
  } = {},
) {
  const provider = options.channel ?? defaultProvider;
  const todo = await tx.todo.findUniqueOrThrow({ where: { id } });
  const allowed = await canReadList(tx, viewerId, todo.todoListId);
  if (!allowed) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You do not have access to this list.",
    });
  }
  const deleted = await tx.todo.delete({ where: { id } });
  const activityEvent = await emitActivity(tx, {
    todoListId: todo.todoListId,
    actorId: viewerId,
    payload: {
      kind: "todo-deleted",
      todoId: deleted.id,
      title: deleted.title,
    },
  });
  await provider(listChannelKey(todo.todoListId)).publish({
    kind: "todo-deleted",
    listId: todo.todoListId,
    todoId: id,
  });
  await publishActivity(activityEvent, options.activityChannel);
  const inboxProvider = options.userInboxChannel ?? defaultUserInboxProvider;
  const recipients = await listMemberIdsForList(tx, todo.todoListId);
  await publishCountersChanged(inboxProvider, recipients, todo.todoListId);
  return deleted;
}

// Narrowed to Prisma.TransactionClient: calls lockActiveTodos.
export async function importTodosFromCSV(
  tx: Prisma.TransactionClient,
  creatorId: string,
  csvData: Buffer,
  todoListId: string,
  options: { channel?: ChannelProvider } = {},
): Promise<{ count: number }> {
  const provider = options.channel ?? defaultProvider;
  const allowed = await canReadList(tx, creatorId, todoListId);
  if (!allowed) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You do not have access to this list.",
    });
  }
  const text = csvData.toString("utf-8");
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
  });

  if (!parsed.meta.fields?.includes("title")) {
    throw new Error("CSV must have a 'title' column");
  }

  const titles = parsed.data.map((row) => row.title).filter(Boolean);
  if (titles.length === 0) {
    throw new Error("CSV must have a 'title' column with at least one value");
  }

  await lockActiveTodos(tx, todoListId);
  await tx.todo.updateMany({
    where: { completed: false, todoListId },
    data: { position: { increment: titles.length } },
  });
  const createdRows = await tx.todo.createManyAndReturn({
    data: titles.map((title, i) => ({
      title,
      userId: creatorId,
      todoListId,
      position: i,
    })),
    include: { todoList: true },
  });
  await provider(listChannelKey(todoListId)).publish({
    kind: "todos-imported",
    listId: todoListId,
    todos: createdRows,
  });

  return { count: titles.length };
}

export async function exportTodosAsCSV(
  db: DbClient,
  viewerId: string,
  todoListId: string,
): Promise<string> {
  const allowed = await canReadList(db, viewerId, todoListId);
  if (!allowed) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You do not have access to this list.",
    });
  }
  const todos = await db.todo.findMany({
    where: { todoListId },
    orderBy: [{ completed: "asc" }, { position: "asc" }],
  });
  if (todos.length === 0) {
    return "title,completed";
  }
  return Papa.unparse(
    todos.map((t) => ({ title: t.title, completed: t.completed })),
  );
}

// Purges Todos that have been completed and untouched for at least
// `olderThanDays` days. `updatedAt` is Prisma-managed and changes whenever
// the row is toggled/edited, so it is a reasonable proxy for "long completed".
// Mirrors deleteExpiredInvites (service.ts) — cutoff window, transactional,
// returns row count.
export async function purgeStaleCompletedTodos(
  tx: Prisma.TransactionClient,
  options: { olderThanDays: number; nowMs?: number },
) {
  const now = new Date(options.nowMs ?? Date.now());
  const cutoff = new Date(now.getTime() - options.olderThanDays * 86_400_000);
  const result = await tx.todo.deleteMany({
    where: { completed: true, updatedAt: { lt: cutoff } },
  });
  return result.count;
}
