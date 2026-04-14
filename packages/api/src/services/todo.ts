import { Prisma, type PrismaClient } from "@project/db";
import Papa from "papaparse";

type DbClient = PrismaClient | Prisma.TransactionClient;

async function lockActiveTodos(
  db: DbClient,
  userId: string,
  todoListId: string,
): Promise<void> {
  await db.$queryRaw`
    SELECT id FROM "Todo"
    WHERE "userId" = ${userId} AND "completed" = false AND "todoListId" = ${todoListId}
    FOR UPDATE
  `;
}

async function shiftActivePositions(
  db: DbClient,
  userId: string,
  todoListId: string,
): Promise<void> {
  await db.todo.updateMany({
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

export async function createTodo(
  db: DbClient,
  userId: string,
  title: string,
  todoListId: string,
) {
  await lockActiveTodos(db, userId, todoListId);
  await shiftActivePositions(db, userId, todoListId);
  return db.todo.create({
    data: { title, userId, todoListId, position: 0 },
  });
}

export async function completeTodo(
  db: DbClient,
  userId: string,
  id: string,
  completed: boolean,
) {
  if (!completed) {
    const todo = await db.todo.findUniqueOrThrow({ where: { id, userId } });
    await lockActiveTodos(db, userId, todo.todoListId);
    await shiftActivePositions(db, userId, todo.todoListId);
    return db.todo.update({
      where: { id, userId },
      data: { completed: false, position: 0 },
    });
  }
  return db.todo.update({
    where: { id, userId },
    data: { completed },
  });
}

export async function reorderTodos(
  db: DbClient,
  userId: string,
  ids: string[],
) {
  const pairs = ids.map((id, i) => Prisma.sql`(${id}::text, ${i}::integer)`);
  await db.$executeRaw`
    UPDATE "Todo" AS t
    SET "position" = d.new_position
    FROM (VALUES ${Prisma.join(pairs, ",")}) AS d(id, new_position)
    WHERE t.id = d.id AND t."userId" = ${userId}
  `;
}

export async function deleteTodo(db: DbClient, userId: string, id: string) {
  return db.todo.delete({
    where: { id, userId },
  });
}

export async function importTodosFromCSV(
  db: DbClient,
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

  await lockActiveTodos(db, userId, todoListId);
  await db.todo.updateMany({
    where: { userId, completed: false, todoListId },
    data: { position: { increment: titles.length } },
  });
  await db.todo.createMany({
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
