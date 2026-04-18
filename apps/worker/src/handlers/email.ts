import { handleEmailJob } from "@project/email/handler";
import type { EmailJobData } from "@project/email/service";
import { EMAIL_QUEUE_NAME } from "@project/jobs/queues";
import { createRedis } from "@project/jobs/redis";
import { Worker } from "bullmq";

export function startEmailWorker(): Worker {
  const worker = new Worker<EmailJobData>(
    EMAIL_QUEUE_NAME,
    async (job) => {
      await handleEmailJob(job.data);
    },
    { connection: createRedis("worker") },
  );

  worker.on("failed", (job, err) => {
    console.error(
      `[email-worker] job ${job?.id} (${job?.name}) failed:`,
      err.message,
    );
  });

  worker.on("completed", (job) => {
    console.log(`[email-worker] job ${job.id} (${job.name}) completed`);
  });

  return worker;
}
