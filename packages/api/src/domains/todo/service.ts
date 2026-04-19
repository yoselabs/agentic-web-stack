import { Prisma, type PrismaClient } from "@project/db";
import { TRPCError } from "@trpc/server";
import Papa from "papaparse";
import { canReadList } from "../todo-list/service.js";

type DbClient = PrismaClient | Prisma.TransactionClient;

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
) {
  const allowed = await canReadList(tx, creatorId, todoListId);
  if (!allowed) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You do not have access to this list.",
    });
  }
  await lockActiveTodos(tx, todoListId);
  await shiftActivePositions(tx, todoListId);
  return tx.todo.create({
    data: { title, userId: creatorId, todoListId, position: 0 },
  });
}

export async function completeTodo(
  tx: Prisma.TransactionClient,
  viewerId: string,
  id: string,
  completed: boolean,
) {
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
    return tx.todo.update({
      where: { id },
      data: { completed: false, position: 0 },
    });
  }
  return tx.todo.update({
    where: { id },
    data: { completed },
  });
}

export async function reorderTodos(
  tx: Prisma.TransactionClient,
  viewerId: string,
  todoListId: string,
  ids: string[],
) {
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
}

export async function deleteTodo(
  tx: Prisma.TransactionClient,
  viewerId: string,
  id: string,
) {
  const todo = await tx.todo.findUniqueOrThrow({ where: { id } });
  const allowed = await canReadList(tx, viewerId, todo.todoListId);
  if (!allowed) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You do not have access to this list.",
    });
  }
  return tx.todo.delete({ where: { id } });
}

// Narrowed to Prisma.TransactionClient: calls lockActiveTodos.
export async function importTodosFromCSV(
  tx: Prisma.TransactionClient,
  creatorId: string,
  csvData: Buffer,
  todoListId: string,
): Promise<{ count: number }> {
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
  await tx.todo.createMany({
    data: titles.map((title, i) => ({
      title,
      userId: creatorId,
      todoListId,
      position: i,
    })),
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
