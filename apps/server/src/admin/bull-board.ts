// Bull Board mount. Exposes a read/retry UI for BullMQ queues.
// WARNING: job.data is visible to anyone who can reach this surface.
// Password-reset jobs contain single-use secret URLs. Mount this ONLY
// behind requireAdmin().

import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { HonoAdapter } from "@bull-board/hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { emailQueue, maintenanceQueue } from "@project/jobs/queues";

export function createBullBoardAdapter() {
  const serverAdapter = new HonoAdapter(serveStatic);
  createBullBoard({
    queues: [
      new BullMQAdapter(emailQueue()),
      new BullMQAdapter(maintenanceQueue()),
    ],
    serverAdapter,
  });
  serverAdapter.setBasePath("/admin/queues");
  return serverAdapter;
}
