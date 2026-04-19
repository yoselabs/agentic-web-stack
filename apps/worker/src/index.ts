import { closeTransport } from "@project/email/handler";
import { startEmailWorker } from "./handlers/email.js";
import { startMaintenanceWorker } from "./handlers/maintenance.js";
import { registerSchedules } from "./schedule.js";

const workers = [startEmailWorker(), startMaintenanceWorker()];
await registerSchedules();

console.log("[worker] started email + maintenance workers");

async function shutdown(signal: NodeJS.Signals) {
  console.log(`[worker] received ${signal}, shutting down`);
  await Promise.all(workers.map((w) => w.close()));
  closeTransport();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
