import type { Prisma, PrismaClient } from "@project/db";
import type { Channel } from "@project/realtime/types";
import {
  ACTIVITY_LIST_PAGE_SIZE,
  ACTIVITY_REPLAY_GAP_MAX,
  ACTIVITY_REPLAY_MAX_AGE_MS,
} from "./constants";
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
    include: { actor: { select: { id: true, name: true } } },
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
    include: { actor: { select: { id: true, name: true } } },
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
  db: PrismaClient,
  input: StreamEventsInput,
): AsyncGenerator<ActivityEventEnvelope> {
  const buffered: ActivityEventRecord[] = [];
  let bufferResolve: (() => void) | null = null;

  // Subscribe FIRST so live events during gap-fill are captured in the buffer.
  const unsub = await input.channel.subscribe((event) => {
    buffered.push(event);
    bufferResolve?.();
  });

  const onAbort = () => {
    bufferResolve?.();
  };
  input.signal?.addEventListener("abort", onAbort);

  try {
    let lastYieldedId: string | null = input.lastEventId ?? null;

    // Phase 1: gap-fill.
    if (input.lastEventId) {
      const gapCount = await db.activityEvent.count({
        where: {
          todoListId: input.todoListId,
          id: { gt: input.lastEventId },
        },
      });

      if (gapCount > ACTIVITY_REPLAY_GAP_MAX) {
        yield { kind: "resync", reason: "gap-too-large" };
      } else if (gapCount > 0) {
        const oldest = await db.activityEvent.findFirst({
          where: {
            todoListId: input.todoListId,
            id: { gt: input.lastEventId },
          },
          orderBy: { id: "asc" },
          select: { createdAt: true },
        });
        if (
          oldest &&
          Date.now() - oldest.createdAt.getTime() > ACTIVITY_REPLAY_MAX_AGE_MS
        ) {
          yield { kind: "resync", reason: "event-expired" };
        } else {
          const gap = await db.activityEvent.findMany({
            where: {
              todoListId: input.todoListId,
              id: { gt: input.lastEventId },
            },
            orderBy: { id: "asc" },
            take: ACTIVITY_REPLAY_GAP_MAX,
            include: { actor: { select: { id: true, name: true } } },
          });
          for (const row of gap) {
            const rec: ActivityEventRecord = {
              ...row,
              payload: row.payload as ActivityEventPayload,
            };
            yield { kind: "event", event: rec };
            lastYieldedId = rec.id;
          }
        }
      }
    }

    // Phase 2: drain buffer + tail live, dedup anything <= lastYieldedId.
    while (!input.signal?.aborted) {
      while (buffered.length > 0) {
        const ev = buffered.shift();
        if (!ev) break;
        if (lastYieldedId && ev.id <= lastYieldedId) continue;
        yield { kind: "event", event: ev };
        lastYieldedId = ev.id;
      }
      if (input.signal?.aborted) break;
      await new Promise<void>((resolve) => {
        bufferResolve = resolve;
      });
      bufferResolve = null;
    }
  } finally {
    input.signal?.removeEventListener("abort", onAbort);
    unsub();
  }
}
