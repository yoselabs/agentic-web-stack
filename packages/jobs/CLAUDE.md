# packages/jobs — BullMQ Queues + Redis

Queue factories and the shared Redis connection. Consumers: `@project/email`
(enqueues), `@project/api` (domain publishers), `apps/worker` (consumes),
`apps/server` (Bull Board admin mount).

## Exports

- `@project/jobs/queues` — queue factories (`emailQueue()`, `maintenanceQueue()`)
  + queue names (`EMAIL_QUEUE_NAME`, `MAINTENANCE_QUEUE_NAME`) + default
  `JobsOptions`.
- `@project/jobs/redis` — `createRedis(role)` — shared ioredis factory
  (BullMQ + rate-limit + realtime share the same URL, distinct roles).

## Adding a queue — `src/queues.ts`

Queues live in one file (`queues.ts`) because there's rarely more than a
handful and they cross-reference each other's retry policies. File-per-queue
becomes worth it past ~5 queues — until then, one file keeps policy
consistent.

1. Add a `<NAME>_QUEUE_NAME` const at the top (stable string — consumers
   reference it).
2. Add a `<NAME>_JOB_DEFAULTS: JobsOptions` block (attempts, backoff,
   retention).
3. Add a lazy factory (`let <name>QueueInstance: Queue | null = null` +
   `export function <name>Queue()`).
4. Wire a handler in `apps/worker/src/handlers/<name>.ts` and schedule in
   `apps/worker/src/schedule.ts` if cron-driven.

## Rules

- Queue names are stable strings — renames cascade through Bull Board,
  worker, and every publisher. Never rename without updating all three.
- One `createRedis("queue")` per queue — BullMQ expects per-queue clients.
- Retry + retention policy lives in the queue factory, not the publisher.
  Publishers pass only job-specific options (delay, priority).
- Failed jobs visible in Bull Board `Failed` tab; admin-only
  (`/admin/queues` gated by `requireAdmin` in `apps/server`).
