// Typed queue declarations — single source of truth for queue names and
// payload shapes. Queue names are stable strings: callers in
// @project/email, the worker, and the Bull Board mount all reference
// these constants. Do not rename without updating every site.
//
// Adding a queue:
//   1. Add the name to QUEUE_NAMES (so the Queue Layer creates the
//      BullMQ instance at boot)
//   2. Declare its payload types under the queue's namespace below
//   3. Re-run `make lint` so tsc binds the new entry across the
//      workspace

export const EMAIL_QUEUE = "email" as const;
export const MAINTENANCE_QUEUE = "maintenance" as const;

export const QUEUE_NAMES = [EMAIL_QUEUE, MAINTENANCE_QUEUE] as const;
export type QueueName = (typeof QUEUE_NAMES)[number];

// --- Maintenance queue payloads ---

export const PURGE_STALE_TODOS_JOB = "purge-stale-todos" as const;

export interface PurgeStaleTodosPayload {
  readonly olderThanDays: number;
}

// --- Email queue payloads ---
//
// The full SendEmailInput Effect Schema lives in @project/email/schema —
// this file declares only the job NAME constant. Handlers receive
// `unknown` at the BullMQ layer (per process-job's contract) and refine
// inside their own typed wrapper using the Effect Schema.

export const SEND_EMAIL_JOB = "send-email" as const;
