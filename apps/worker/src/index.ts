// Worker process entrypoint. Boots the BullMQ workers + repeatable
// cron registry under an Effect runtime. ADR-0015 (accepted).
//
// Lifecycle (managed by NodeRuntime.runMain — handles SIGTERM/SIGINT):
//   1. Acquire QueueLive scope (opens BullMQ Queue instances)
//   2. Run registerSchedules (registers repeatable cron jobs)
//   3. Start each queue's BullMQ Worker via processJob
//   4. Effect.never — keep the process alive
//   5. On signal: workers close, QueueLive scope releases, process exits
//
// Email worker registration is intentionally absent — @project/email
// lands in Phase 4 capability #2 alongside its handler. Enqueueing
// without a consumer is fine (jobs queue up; nobody enqueues yet).

import { NodeRuntime } from "@effect/platform-node";
import { AppLayer } from "@project/api/runtime/app-layer";
import { processJob } from "@project/jobs/process-job";
import { QueueLive } from "@project/jobs/queue-layer";
import { MAINTENANCE_QUEUE } from "@project/jobs/queues";
import { Effect, Layer } from "effect";
import { maintenanceHandlers } from "./handlers/maintenance.ts";
import { registerSchedules } from "./schedule.ts";

const main = Effect.gen(function* () {
  yield* registerSchedules;

  yield* Effect.acquireRelease(
    Effect.sync(() =>
      processJob({
        queue: MAINTENANCE_QUEUE,
        handlers: maintenanceHandlers,
        runtimeLayer: AppLayer,
      }),
    ),
    (worker) => Effect.promise(() => worker.close()).pipe(Effect.asVoid),
  );

  yield* Effect.logInfo(`[worker] started (queues: ${MAINTENANCE_QUEUE})`);
  yield* Effect.never;
});

NodeRuntime.runMain(
  main.pipe(Effect.scoped, Effect.provide(Layer.mergeAll(QueueLive, AppLayer))),
);
