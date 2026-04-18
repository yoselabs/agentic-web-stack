import { Prisma, type PrismaClient } from "@project/db";
import Papa from "papaparse";

type DbClient = PrismaClient | Prisma.TransactionClient;

// Row-lock helpers require Prisma.TransactionClient (not the root PrismaClient union).
// Prisma has no native FOR UPDATE: if the root client is passed, Prisma runs each
// $queryRaw in its own implicit transaction and releases the lock immediately —
// silently, with no error. Every function that participates in the lock below
// must therefore accept Prisma.TransactionClient only, and routers wrap calls in
// ctx.db.$transaction((tx) => ...). See packages/api/CLAUDE.md.
async function lockActiveTodos(
  tx: Prisma.TransactionClient,
  userId: string,
  todoListId: string,
): Promise<void> {
  // ORDER BY id: deterministic lock order across concurrent callers — avoids
  //   deadlocks if the planner ever picks different scan orders.
  // FOR NO KEY UPDATE: we only mutate `position` (non-key, non-FK), so the weaker
  //   lock is sufficient and allows concurrent FK references to these rows.
  await tx.$queryRaw`
    SELECT id FROM "Todo"
    WHERE "userId" = ${userId} AND "completed" = false AND "todoListId" = ${todoListId}
    ORDER BY id
    FOR NO KEY UPDATE
  `;
}

async function shiftActivePositions(
  tx: Prisma.TransactionClient,
  userId: string,
  todoListId: string,
): Promise<void> {
  await tx.todo.updateMany({
    where: { userId, completed: false, todoListId },
    data: { position: { increment: 1 } },
  });
}

export async function listTodos(
  db: DbClient,
  userId: string,
  todoListId: string,
) {
  return db.todo.findMany({
    where: { userId, todoListId },
    orderBy: [{ completed: "asc" }, { position: "asc" }],
    include: { todoList: true },
  });
}

// Narrowed to Prisma.TransactionClient because they call lockActiveTodos.
// Router must always wrap: ctx.db.$transaction((tx) => createTodo(tx, ...)).
export async function createTodo(
  tx: Prisma.TransactionClient,
  userId: string,
  title: string,
  todoListId: string,
) {
  await lockActiveTodos(tx, userId, todoListId);
  await shiftActivePositions(tx, userId, todoListId);
  return tx.todo.create({
    data: { title, userId, todoListId, position: 0 },
  });
}

export async function completeTodo(
  tx: Prisma.TransactionClient,
  userId: string,
  id: string,
  completed: boolean,
) {
  if (!completed) {
    const todo = await tx.todo.findUniqueOrThrow({ where: { id, userId } });
    await lockActiveTodos(tx, userId, todo.todoListId);
    await shiftActivePositions(tx, userId, todo.todoListId);
    return tx.todo.update({
      where: { id, userId },
      data: { completed: false, position: 0 },
    });
  }
  return tx.todo.update({
    where: { id, userId },
    data: { completed },
  });
}

export async function reorderTodos(
  tx: Prisma.TransactionClient,
  userId: string,
  ids: string[],
) {
  const pairs = ids.map((id, i) => Prisma.sql`(${id}::text, ${i}::integer)`);
  await tx.$executeRaw`
    UPDATE "Todo" AS t
    SET "position" = d.new_position
    FROM (VALUES ${Prisma.join(pairs, ",")}) AS d(id, new_position)
    WHERE t.id = d.id AND t."userId" = ${userId}
  `;
}

export async function deleteTodo(
  tx: Prisma.TransactionClient,
  userId: string,
  id: string,
) {
  return tx.todo.delete({
    where: { id, userId },
  });
}

// Narrowed to Prisma.TransactionClient: calls lockActiveTodos.
export async function importTodosFromCSV(
  tx: Prisma.TransactionClient,
  userId: string,
  csvData: Buffer,
  todoListId: string,
): Promise<{ count: number }> {
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

  await lockActiveTodos(tx, userId, todoListId);
  await tx.todo.updateMany({
    where: { userId, completed: false, todoListId },
    data: { position: { increment: titles.length } },
  });
  await tx.todo.createMany({
    data: titles.map((title, i) => ({
      title,
      userId,
      todoListId,
      position: i,
    })),
  });

  return { count: titles.length };
}

export async function exportTodosAsCSV(
  db: DbClient,
  userId: string,
  todoListId: string,
): Promise<string> {
  const todos = await db.todo.findMany({
    where: { userId, todoListId },
    orderBy: [{ completed: "asc" }, { position: "asc" }],
  });
  if (todos.length === 0) {
    return "title,completed";
  }
  return Papa.unparse(
    todos.map((t) => ({ title: t.title, completed: t.completed })),
  );
}
