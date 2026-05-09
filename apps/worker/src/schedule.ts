// Repeatable cron registration. Runs once at worker boot via the
// `Queue` Layer. BullMQ's repeatable-job registration is idempotent —
// calling `add` with the same `jobId` and `repeat.pattern` is safe to
// re-run on every boot.
//
// Cron schedule:
//   - 03:00 daily — purge-stale-todos (delete completed todos
//     untouched for 30 days)
//
// Add a new cron:
//   1. Declare the job name + payload type in @project/jobs/queues
//   2. Add a handler entry in handlers/<queue>.ts
//   3. Append a `Queue.schedule(...)` call below

import { Queue } from "@project/jobs/queue-layer";
import {
  MAINTENANCE_QUEUE,
  PURGE_STALE_TODOS_JOB,
  type PurgeStaleTodosPayload,
} from "@project/jobs/queues";
import { Effect } from "effect";

const PURGE_STALE_TODOS_PAYLOAD: PurgeStaleTodosPayload = {
  olderThanDays: 30,
};

export const registerSchedules = Effect.gen(function* () {
  const queue = yield* Queue;

  yield* queue.schedule(
    MAINTENANCE_QUEUE,
    PURGE_STALE_TODOS_JOB,
    PURGE_STALE_TODOS_PAYLOAD,
    {
      repeat: { pattern: "0 3 * * *" },
      removeOnComplete: { count: 30 },
      removeOnFail: { count: 100 },
    },
  );
  yield* Effect.logInfo(
    `[worker] registered cron "${PURGE_STALE_TODOS_JOB}" (0 3 * * *)`,
  );
});
