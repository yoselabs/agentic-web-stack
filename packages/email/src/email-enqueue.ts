// Producer-side helper: Better-Auth (and other Promise-shaped call-sites)
// hand off email send via the BullMQ queue. The worker handler — see
// apps/worker/src/handlers/email.ts — drives the actual send through
// MailerService with Effect.Schedule retry.
//
// ADR-0020 §Decision A — Mailer is the consumer; producers enqueue.
//
// Runtime is process-memoized: the first call lazily constructs a
// ManagedRuntime around Queue.Default (which acquires one BullMQ Queue
// + Redis connection per QUEUE_NAMES entry). Subsequent calls reuse it.
// `disposeEmailRuntime` is a process-exit hook for graceful shutdown.

import { Queue, type QueueError } from "@project/jobs/queue-layer";
import { EMAIL_QUEUE, SEND_EMAIL_JOB } from "@project/jobs/queues";
import type { ParseResult } from "effect";
import { Effect, ManagedRuntime, Schema } from "effect";
import { SendEmailInput } from "./email-schema.ts";

let runtime: ManagedRuntime.ManagedRuntime<Queue, never> | null = null;

const getRuntime = (): ManagedRuntime.ManagedRuntime<Queue, never> => {
  if (runtime === null) runtime = ManagedRuntime.make(Queue.Default);
  return runtime;
};

// Pure Effect program, exported for tests. Tests provide a stub Queue
// via Layer.succeed(Queue, …) to verify enqueue is called with the
// validated payload.
export const enqueueSendEmailEffect = (
  input: unknown,
): Effect.Effect<void, ParseResult.ParseError | QueueError, Queue> =>
  Effect.gen(function* () {
    const validated = yield* Schema.decodeUnknown(SendEmailInput)(input);
    const queue = yield* Queue;
    yield* queue.enqueue(EMAIL_QUEUE, SEND_EMAIL_JOB, validated);
  });

export const enqueueSendEmail = (
  input: Schema.Schema.Type<typeof SendEmailInput>,
): Promise<void> => getRuntime().runPromise(enqueueSendEmailEffect(input));

export const disposeEmailRuntime = (): Promise<void> => {
  if (runtime === null) return Promise.resolve();
  const r = runtime;
  runtime = null;
  return r.dispose();
};
