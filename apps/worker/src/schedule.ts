// Registers the repeatable maintenance crons with BullMQ on worker boot.
// BullMQ's repeatable-job registration is idempotent.

import { maintenanceQueue } from "@project/jobs/queues";
import { EXPIRE_INVITES_JOB } from "./handlers/maintenance.js";

export async function registerSchedules(): Promise<void> {
  await maintenanceQueue().add(
    EXPIRE_INVITES_JOB,
    {},
    {
      repeat: { pattern: "0 3 * * *" },
      jobId: `cron:${EXPIRE_INVITES_JOB}`,
      removeOnComplete: { count: 30 },
      removeOnFail: { count: 100 },
    },
  );
  console.log(
    `[worker] registered repeatable job "${EXPIRE_INVITES_JOB}" (0 3 * * *)`,
  );
}
