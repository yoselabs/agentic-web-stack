import { deleteExpiredInvites } from "@project/api/domains/todo-list/service";
import { db } from "@project/db";
import { MAINTENANCE_QUEUE_NAME } from "@project/jobs/queues";
import { createRedis } from "@project/jobs/redis";
import { Worker } from "bullmq";

export const EXPIRE_INVITES_JOB = "expire-invites" as const;

export function startMaintenanceWorker(): Worker {
  const worker = new Worker(
    MAINTENANCE_QUEUE_NAME,
    async (job) => {
      if (job.name === EXPIRE_INVITES_JOB) {
        const count = await db.$transaction((tx) => deleteExpiredInvites(tx));
        console.log(`[maintenance] expire-invites removed ${count} rows`);
        return;
      }
      console.warn(`[maintenance-worker] unknown job "${job.name}"`);
    },
    { connection: createRedis("worker") },
  );

  worker.on("failed", (job, err) => {
    console.error(`[maintenance-worker] job ${job?.id} failed:`, err.message);
  });

  return worker;
}
