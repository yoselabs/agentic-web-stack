// Queue Effect Layer — wraps BullMQ behind a `Queue` Context.Tag.
// ADR-0015 §Decision A. The Live implementation maintains one BullMQ
// `Queue` instance per name in QUEUE_NAMES, opened at scope-acquisition
// and closed at scope-release. Tests can swap `Queue` for an in-memory
// implementation by providing a different Layer.
//
// Retry policy intentionally lives at the **handler** level via
// `Effect.Schedule` — not in the BullMQ JobsOptions passed here. This
// is the ergonomic win the wrapper enables: composable retry policies
// inside the handler Effect rather than declarative attempts/backoff
// configuration on the queue.

import { Queue as BullQueue, type JobsOptions } from "bullmq";
import { Context, Data, Effect, Layer } from "effect";
import { QUEUE_NAMES, type QueueName } from "./queues.ts";
import { createRedis } from "./redis-layer.ts";

export class QueueError extends Data.TaggedError("QueueError")<{
  readonly queue: QueueName;
  readonly op: "enqueue" | "schedule" | "cancel" | "close";
  readonly cause: unknown;
}> {}

export interface QueueService {
  readonly enqueue: (
    queue: QueueName,
    jobName: string,
    data: unknown,
    opts?: JobsOptions,
  ) => Effect.Effect<void, QueueError>;

  readonly schedule: (
    queue: QueueName,
    jobName: string,
    data: unknown,
    opts: JobsOptions & { repeat: { pattern: string } },
  ) => Effect.Effect<void, QueueError>;

  readonly cancel: (
    queue: QueueName,
    jobId: string,
  ) => Effect.Effect<void, QueueError>;

  // Escape hatch for Bull Board mount — yields the underlying BullMQ
  // Queue instances so the admin UI can introspect them. Domain code
  // should NOT use this; it's an interop boundary only.
  readonly raw: () => ReadonlyMap<QueueName, BullQueue>;
}

export class QueueTag extends Context.Tag("@project/jobs/Queue")<
  QueueTag,
  QueueService
>() {}

// Build a Map<QueueName, BullQueue> with one BullMQ Queue per declared
// name. Uses a single shared Redis connection on the queue side per
// BullMQ's recommendation (queues are cheap; workers need separate
// connections — that's redis-layer's `worker` role).
const buildQueues = (): Map<QueueName, BullQueue> => {
  const connection = createRedis("queue");
  const map = new Map<QueueName, BullQueue>();
  for (const name of QUEUE_NAMES) {
    map.set(name, new BullQueue(name, { connection }));
  }
  return map;
};

const closeAll = (queues: Map<QueueName, BullQueue>) =>
  Effect.tryPromise({
    try: () => Promise.all(Array.from(queues.values(), (q) => q.close())),
    catch: (cause) =>
      new QueueError({ queue: QUEUE_NAMES[0], op: "close", cause }),
  }).pipe(Effect.asVoid);

export const QueueLive = Layer.scoped(
  QueueTag,
  Effect.gen(function* () {
    const queues = yield* Effect.acquireRelease(Effect.sync(buildQueues), (q) =>
      Effect.orDie(closeAll(q)),
    );

    const requireQueue = (name: QueueName): BullQueue => {
      const q = queues.get(name);
      if (!q) {
        // Cannot happen at runtime — QUEUE_NAMES is the SSOT — but the
        // type system can't prove the Map.get is total without a non-
        // null assertion, and we prefer an explicit throw to a `!`.
        throw new Error(`Queue "${name}" missing from registry`);
      }
      return q;
    };

    const enqueue: QueueService["enqueue"] = (queue, jobName, data, opts) =>
      Effect.tryPromise({
        try: () => requireQueue(queue).add(jobName, data, opts),
        catch: (cause) => new QueueError({ queue, op: "enqueue", cause }),
      }).pipe(Effect.asVoid);

    const schedule: QueueService["schedule"] = (queue, jobName, data, opts) =>
      Effect.tryPromise({
        try: () =>
          requireQueue(queue).add(jobName, data, {
            ...opts,
            jobId: opts.jobId ?? `cron:${jobName}`,
          }),
        catch: (cause) => new QueueError({ queue, op: "schedule", cause }),
      }).pipe(Effect.asVoid);

    const cancel: QueueService["cancel"] = (queue, jobId) =>
      Effect.tryPromise({
        try: async () => {
          const job = await requireQueue(queue).getJob(jobId);
          if (job) await job.remove();
        },
        catch: (cause) => new QueueError({ queue, op: "cancel", cause }),
      }).pipe(Effect.asVoid);

    const raw: QueueService["raw"] = () => queues;

    return { enqueue, schedule, cancel, raw };
  }),
);
