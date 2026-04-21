// Email retry + dead-letter integration test.
//
// Replaces the e2e/features/email/queue-retry.feature BDD scenario, which
// stopped/started the Mailpit container globally and flaked under parallel
// load (e2e/CLAUDE.md table: "Error recovery (retry, fallback) | Rarely
// BDD | Yes Vitest"). This test uses a real Redis + a real BullMQ worker
// against a test-only queue, with a controllable processor — same wiring
// the production worker uses, no docker-stop side effects, ~1s instead of
// ~30s.
//
// What this verifies:
//   1. EMAIL_JOB_DEFAULTS constants — retry policy is set as designed.
//   2. End-to-end: a job that fails until attempts exhaust lands in the
//      failed set with the thrown error, and Job.retry() (the operation
//      Bull Board's PUT /admin/queues/api/queues/<name>/<id>/retry calls
//      under the hood) re-runs it to completion.
//
// What this does NOT verify (out of scope, lower-value):
//   - The Bull Board HTTP shell. Bull Board's UI/API is a third-party
//     concern; the admin gate around it is covered by e2e admin/gate.
//   - nodemailer wire format. handler.ts is a thin nodemailer call; the
//     happy-path send is covered by every other email-touching scenario.

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { EMAIL_JOB_DEFAULTS } from "@project/jobs/queues";
import { createRedis } from "@project/jobs/redis";
import { type Job, Queue, Worker } from "bullmq";

// BullMQ types `Job.id` as `string | undefined` because the field only
// materializes once Redis has assigned an ID. For jobs returned by
// `queue.add()` the ID is always set; this helper narrows the type
// without a non-null assertion.
function requireJobId(job: Job): string {
  if (!job.id) throw new Error("BullMQ did not assign a job id");
  return job.id;
}

const TEST_QUEUE = `email-retry-test-${process.pid}-${Date.now()}`;

describe("EMAIL_JOB_DEFAULTS", () => {
  it("retries 3 times with exponential backoff", () => {
    expect(EMAIL_JOB_DEFAULTS.attempts).toBe(3);
    expect(EMAIL_JOB_DEFAULTS.backoff).toEqual({
      type: "exponential",
      delay: 1000,
    });
  });

  it("keeps a bounded history of completed + failed jobs", () => {
    expect(EMAIL_JOB_DEFAULTS.removeOnComplete).toEqual({ count: 100 });
    expect(EMAIL_JOB_DEFAULTS.removeOnFail).toEqual({ count: 500 });
  });
});

describe("BullMQ retry wiring", () => {
  let queue: Queue;
  let worker: Worker;
  // Per-job counters keyed by job.name. The processor reads `failUntil`
  // from the job's data and throws while `calls[name] <= failUntil`.
  // Keying on job.name keeps each test case isolated even though the
  // worker is shared across the describe block.
  const calls: Record<string, number> = {};

  beforeAll(() => {
    queue = new Queue(TEST_QUEUE, { connection: createRedis("queue") });
    worker = new Worker<{ failUntil: number }>(
      TEST_QUEUE,
      async (job) => {
        calls[job.name] = (calls[job.name] ?? 0) + 1;
        if (calls[job.name] <= job.data.failUntil) {
          // Match the failure surface BullMQ stores in `failedReason`
          // — the e2e scenario asserted on the literal "ECONNREFUSED"
          // substring that nodemailer emits when SMTP is down.
          throw new Error(`connect ECONNREFUSED 127.0.0.1:2525`);
        }
        return { ok: true };
      },
      { connection: createRedis("worker") },
    );
    // Surface processor-side errors that aren't part of a job execution
    // (connection drops, bad config). Without this, Bun's unhandled
    // promise rejection trips the whole suite.
    worker.on("error", () => {});
  });

  afterAll(async () => {
    await worker.close();
    await queue.obliterate({ force: true }).catch(() => {});
    await queue.close();
  });

  it("lands in failed set after all attempts exhaust, with the thrown error", async () => {
    // Override the production exponential backoff to keep the test fast
    // — the policy itself is verified separately above. attempts: 2 +
    // 50ms backoff exhausts in <200ms total.
    const job = await queue.add(
      "test-fail",
      // Large finite count — Infinity round-trips through JSON as null,
      // which would silently let the processor succeed.
      { failUntil: 9999 },
      { attempts: 2, backoff: { type: "fixed", delay: 50 } },
    );

    const failed = await waitForJobState(requireJobId(job), "failed", 5000);
    expect(failed.attemptsMade).toBe(2);
    expect(failed.failedReason).toContain("ECONNREFUSED");
  });

  it("Job.retry() re-runs a failed job to completion", async () => {
    const job = await queue.add(
      "test-retry",
      { failUntil: 1 }, // fail once, then succeed on retry
      { attempts: 1, backoff: { type: "fixed", delay: 0 } },
    );

    const jobId = requireJobId(job);
    const failed = await waitForJobState(jobId, "failed", 5000);
    expect(failed.failedReason).toContain("ECONNREFUSED");

    // This is the operation Bull Board's "Retry" button performs — same
    // BullMQ method, same effect. We're verifying the contract Bull Board
    // depends on, not Bull Board itself.
    await failed.retry();

    const completed = await waitForJobState(jobId, "completed", 5000);
    expect(completed.returnvalue).toEqual({ ok: true });
    expect(calls["test-retry"]).toBe(2);
  });

  // Poll the queue for a job in the target state. We wait for
  // `failedReason` (resp. `returnvalue`) to be populated, not just for
  // getState() to flip — BullMQ writes the state field a hair before
  // the reason/returnvalue field, and reading between the two yields a
  // Job with failedReason === undefined.
  async function waitForJobState(
    jobId: string,
    target: "failed" | "completed",
    timeoutMs: number,
  ) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const job = await queue.getJob(jobId);
      if (job) {
        const state = await job.getState();
        if (state === target) {
          if (target === "failed" && job.failedReason) return job;
          if (target === "completed" && job.returnvalue !== undefined)
            return job;
        }
      }
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(
      `job ${jobId} did not reach state "${target}" in ${timeoutMs}ms`,
    );
  }
});
