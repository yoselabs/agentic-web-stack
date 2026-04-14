import type { Prisma, PrismaClient } from "@project/db";

type DbClient = PrismaClient | Prisma.TransactionClient;

export async function listTodoLists(db: DbClient, userId: string) {
  return db.todoList.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { todos: true } },
    },
  });
}

export async function getTodoList(db: DbClient, userId: string, id: string) {
  return db.todoList.findFirstOrThrow({
    where: { id, userId },
  });
}

export async function createTodoList(
  db: DbClient,
  userId: string,
  name: string,
  color?: string,
) {
  return db.todoList.create({
    data: { name, userId, ...(color ? { color } : {}) },
  });
}

export async function deleteTodoList(
  db: DbClient,
  userId: string,
  id: string,
) {
  const list = await db.todoList.findFirstOrThrow({
    where: { id, userId },
  });
  return db.todoList.delete({ where: { id: list.id } });
}
