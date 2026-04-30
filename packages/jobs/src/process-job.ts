// Effect → BullMQ Worker adapter. ADR-0015 §Decision A.
//
// `processJob` builds a BullMQ Worker for a queue, dispatching each job
// to a per-job-name Effect handler. The adapter:
//   1. Looks up the handler for `job.name` in the registry
//   2. Provides the supplied `runtimeLayer` (Db, Logger, etc.) and runs
//      the handler with the job's data as `unknown` (handlers refine via
//      their own typed wrappers)
//   3. Resolves on Exit.Success, rejects on Exit.Failure so BullMQ's
//      retry/dead-letter machinery still fires
//
// Retry policy lives **inside** each handler's Effect (via
// `Effect.Schedule`), not in BullMQ JobsOptions on the registration
// side. The handler decides its own retry composition; BullMQ only
// re-enqueues on uncaught failure (dead-letter signaling).

import { type Job, Worker, type WorkerOptions } from "bullmq";
import { Cause, Effect, Exit, type Layer } from "effect";
import type { QueueName } from "./queues.ts";
import { createRedis } from "./redis-layer.ts";

export type JobHandler<R> = (
  data: unknown,
  job: Job,
) => Effect.Effect<unknown, unknown, R>;

export interface ProcessJobOptions<R> {
  readonly queue: QueueName;
  readonly handlers: Readonly<Record<string, JobHandler<R>>>;
  readonly runtimeLayer: Layer.Layer<R>;
  readonly workerOptions?: Omit<WorkerOptions, "connection">;
}

export function processJob<R>({
  queue,
  handlers,
  runtimeLayer,
  workerOptions,
}: ProcessJobOptions<R>): Worker {
  const worker = new Worker(
    queue,
    async (job: Job): Promise<unknown> => {
      const handler = handlers[job.name];
      if (!handler) {
        // Unknown job name on this queue. Throw so BullMQ marks the
        // job failed; surfaces in Bull Board's Failed tab.
        throw new Error(
          `[${queue}] no handler registered for job "${job.name}"`,
        );
      }

      const program = handler(job.data, job).pipe(Effect.provide(runtimeLayer));
      const exit = await Effect.runPromiseExit(program);

      if (Exit.isSuccess(exit)) return exit.value;

      // Failure — surface a useful message and rethrow so BullMQ
      // dead-letters / retries per its own policy. `Cause.pretty`
      // handles tagged failures, defects, and interrupts uniformly.
      throw new Error(`[${queue}/${job.name}] ${Cause.pretty(exit.cause)}`);
    },
    {
      connection: createRedis("worker"),
      ...workerOptions,
    },
  );

  return worker;
}
