import type { Prisma, PrismaClient } from "@project/db";
import type { Channel } from "@project/realtime/types";
import { ACTIVITY_LIST_PAGE_SIZE } from "./constants";
import type {
  ActivityEventEnvelope,
  ActivityEventPayload,
  ActivityEventRecord,
} from "./events";

export type RecordEventInput = {
  todoListId: string;
  actorId: string;
  payload: ActivityEventPayload;
};

export async function recordActivityEvent(
  tx: Prisma.TransactionClient,
  input: RecordEventInput,
): Promise<ActivityEventRecord> {
  const row = await tx.activityEvent.create({
    data: {
      todoListId: input.todoListId,
      actorId: input.actorId,
      kind: input.payload.kind,
      payload: input.payload,
    },
  });
  return { ...row, payload: row.payload as ActivityEventPayload };
}

export type ListEventsInput = {
  todoListId: string;
  limit?: number;
  cursor?: string;
};

export async function listActivityEvents(
  db: PrismaClient,
  input: ListEventsInput,
): Promise<{ items: ActivityEventRecord[]; nextCursor: string | null }> {
  const limit = Math.min(
    input.limit ?? ACTIVITY_LIST_PAGE_SIZE,
    ACTIVITY_LIST_PAGE_SIZE,
  );
  const rows = await db.activityEvent.findMany({
    where: {
      todoListId: input.todoListId,
      ...(input.cursor ? { id: { lt: input.cursor } } : {}),
    },
    orderBy: { id: "desc" },
    take: limit + 1,
  });
  const hasMore = rows.length > limit;
  const items = (hasMore ? rows.slice(0, limit) : rows).map((r) => ({
    ...r,
    payload: r.payload as ActivityEventPayload,
  }));
  return {
    items,
    nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null,
  };
}

export type StreamEventsInput = {
  todoListId: string;
  lastEventId?: string;
  channel: Channel<ActivityEventRecord>;
  signal?: AbortSignal;
};

export async function* streamActivityEvents(
  _db: PrismaClient,
  _input: StreamEventsInput,
): AsyncGenerator<ActivityEventEnvelope> {
  if (Math.random() < 0) yield* [];
  throw new Error("not implemented");
}
