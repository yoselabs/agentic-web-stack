// ADR-0020 (Mailer service consumer) + ADR-0015 (worker handler retry).
// Handler registry for the `email` queue. The job payload is an
// Effect-Schema-validated SendEmailInput from @project/email/schema —
// the wire-level value arrives as `unknown` (BullMQ doesn't know the
// shape) and is decoded inside the handler before MailerService.send.
//
// Adding an email job:
//   1. Define the email's render function in @project/email
//   2. Add a handler entry below mapping the job name to that render
//      → MailerService.send pipeline
//   3. Enqueue from the producer (Better-Auth callback, todo invitation
//      flow, etc.) using the matching job name + SendEmailInput payload

import type { Db } from "@project/api/runtime/db-layer";
import { MailerService } from "@project/email/contract";
import * as EmailSchema from "@project/email/schema";
import type { JobHandler } from "@project/jobs/process-job";
import { SEND_EMAIL_JOB } from "@project/jobs/queues";
import { Effect, Schedule, Schema } from "effect";

// In-process retry for transient SMTP transport failures (network blip,
// auth challenge race, etc.). Layered with BullMQ: Effect.Schedule retries
// cheaply in-process before BullMQ's outer counter advances. Per ADR-0015
// §Decision A — handler-level Schedule is the load-bearing retry.
const sendRetryPolicy = Schedule.exponential("200 millis", 2.0).pipe(
  Schedule.intersect(Schedule.recurs(3)),
  Schedule.jittered,
);

const sendEmail: JobHandler<Db> = (data, job) =>
  Effect.gen(function* () {
    const input = yield* Schema.decodeUnknown(EmailSchema.SendEmailInput)(data);
    const mailer = yield* MailerService;
    const receipt = yield* mailer.send(input);
    yield* Effect.logInfo(
      `[email/${job.name}] sent to=${input.to} messageId=${receipt.messageId}`,
    );
    return { messageId: receipt.messageId };
  }).pipe(Effect.retry(sendRetryPolicy), Effect.provide(MailerService.Default));

export const emailHandlers: Record<string, JobHandler<Db>> = {
  [SEND_EMAIL_JOB]: sendEmail,
};
