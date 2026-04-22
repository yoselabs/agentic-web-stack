import type { Prisma, PrismaClient } from "@project/db";
import type { Channel } from "@project/realtime/types";
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
  _db: PrismaClient,
  _input: ListEventsInput,
): Promise<{ items: ActivityEventRecord[]; nextCursor: string | null }> {
  throw new Error("not implemented");
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
