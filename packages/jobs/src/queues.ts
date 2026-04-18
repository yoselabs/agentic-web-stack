// Queue factories. Both queues share the same Redis connection (role: "queue").
//
// Queue names are stable strings — consumers in @project/email, the worker,
// and the future Bull Board mount reference them by name. Do not rename
// without updating all call sites.

import { type JobsOptions, Queue } from "bullmq";
import { createRedis } from "./redis.js";

export const EMAIL_QUEUE_NAME = "email" as const;
export const MAINTENANCE_QUEUE_NAME = "maintenance" as const;

// Retry policy for email jobs: 3 attempts with exponential backoff (1s, 4s, 16s).
// Failed jobs go to dead-letter (visible in Bull Board Failed tab).
export const EMAIL_JOB_DEFAULTS: JobsOptions = {
  attempts: 3,
  backoff: { type: "exponential", delay: 1000 },
  removeOnComplete: { count: 100 },
  removeOnFail: { count: 500 },
};

let emailQueueInstance: Queue | null = null;
let maintenanceQueueInstance: Queue | null = null;

export function emailQueue(): Queue {
  if (!emailQueueInstance) {
    emailQueueInstance = new Queue(EMAIL_QUEUE_NAME, {
      connection: createRedis("queue"),
      defaultJobOptions: EMAIL_JOB_DEFAULTS,
    });
  }
  return emailQueueInstance;
}

export function maintenanceQueue(): Queue {
  if (!maintenanceQueueInstance) {
    maintenanceQueueInstance = new Queue(MAINTENANCE_QUEUE_NAME, {
      connection: createRedis("queue"),
    });
  }
  return maintenanceQueueInstance;
}

export async function closeQueues(): Promise<void> {
  await Promise.all([
    emailQueueInstance?.close(),
    maintenanceQueueInstance?.close(),
  ]);
  emailQueueInstance = null;
  maintenanceQueueInstance = null;
}
