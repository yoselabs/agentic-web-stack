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
  tx: Prisma.TransactionClient,
  userId: string,
  name: string,
  color?: string,
) {
  return tx.todoList.create({
    data: { name, userId, ...(color ? { color } : {}) },
  });
}

export async function deleteTodoList(
  tx: Prisma.TransactionClient,
  userId: string,
  id: string,
) {
  const list = await tx.todoList.findFirstOrThrow({
    where: { id, userId },
  });
  return tx.todoList.delete({ where: { id: list.id } });
}
