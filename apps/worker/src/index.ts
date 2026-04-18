import { closeQueues } from "@project/jobs/queues";
import { startEmailWorker } from "./handlers/email.js";
import { startMaintenanceWorker } from "./handlers/maintenance.js";

const workers = [startEmailWorker(), startMaintenanceWorker()];

console.log("[worker] started email + maintenance workers");

async function shutdown(signal: NodeJS.Signals) {
  console.log(`[worker] received ${signal}, shutting down`);
  await Promise.all(workers.map((w) => w.close()));
  await closeQueues();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
