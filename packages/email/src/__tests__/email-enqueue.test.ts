// Tests for the producer-side enqueue helper. We don't exercise the
// process-memoized ManagedRuntime path (that opens a real Redis
// connection); we verify the inner Effect program against a stubbed
// Queue layer.

import { describe, expect, it } from "bun:test";
import { Queue } from "@project/jobs/queue-layer";
import { EMAIL_QUEUE, SEND_EMAIL_JOB } from "@project/jobs/queues";
import { Cause, Effect, Exit, Layer } from "effect";
import { enqueueSendEmailEffect } from "../email-enqueue.ts";

const validInput = {
  to: "alice@example.com",
  from: "noreply@app.example.com",
  subject: "hi",
  html: "<p>hello</p>",
} as const;

interface EnqueueCall {
  queue: string;
  jobName: string;
  data: unknown;
}

const stubQueueLayer = (calls: EnqueueCall[]) =>
  Layer.succeed(Queue, {
    enqueue: (queue: string, jobName: string, data: unknown) =>
      Effect.sync(() => {
        calls.push({ queue, jobName, data });
      }),
    schedule: () => Effect.void,
    cancel: () => Effect.void,
    raw: () => new Map(),
  } as unknown as Queue);

describe("enqueueSendEmailEffect", () => {
  it("validates input and enqueues to the email queue with SEND_EMAIL_JOB name", async () => {
    const calls: EnqueueCall[] = [];
    await Effect.runPromise(
      enqueueSendEmailEffect(validInput).pipe(
        Effect.provide(stubQueueLayer(calls)),
      ),
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.queue).toBe(EMAIL_QUEUE);
    expect(calls[0]?.jobName).toBe(SEND_EMAIL_JOB);
    expect(calls[0]?.data).toMatchObject({
      to: "alice@example.com",
      subject: "hi",
    });
  });

  it("fails with ParseError on invalid input (missing required field)", async () => {
    const calls: EnqueueCall[] = [];
    const exit = await Effect.runPromiseExit(
      enqueueSendEmailEffect({ to: "alice@example.com" }).pipe(
        Effect.provide(stubQueueLayer(calls)),
      ),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const failure = Cause.failureOption(exit.cause);
      expect(failure._tag).toBe("Some");
    }
    expect(calls).toHaveLength(0);
  });

  it("rejects malformed email addresses", async () => {
    const calls: EnqueueCall[] = [];
    const exit = await Effect.runPromiseExit(
      enqueueSendEmailEffect({ ...validInput, to: "not-an-email" }).pipe(
        Effect.provide(stubQueueLayer(calls)),
      ),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    expect(calls).toHaveLength(0);
  });
});
