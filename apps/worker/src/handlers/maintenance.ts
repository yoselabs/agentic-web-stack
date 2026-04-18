// Maintenance queue handlers. Plan A ships the worker wiring only —
// actual maintenance jobs (expire-invites) are added in Plan C.
// This file exists so the worker boots a consumer for the queue,
// which prevents enqueued maintenance jobs from sitting forever.

import { MAINTENANCE_QUEUE_NAME } from "@project/jobs/queues";
import { createRedis } from "@project/jobs/redis";
import { Worker } from "bullmq";

export function startMaintenanceWorker(): Worker {
  const worker = new Worker(
    MAINTENANCE_QUEUE_NAME,
    async (job) => {
      // Handlers added in Plan C: expire-invites
      console.warn(
        `[maintenance-worker] received job "${job.name}" but no handler registered yet`,
      );
    },
    { connection: createRedis("worker") },
  );

  worker.on("failed", (job, err) => {
    console.error(`[maintenance-worker] job ${job?.id} failed:`, err.message);
  });

  return worker;
}
