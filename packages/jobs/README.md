# @project/jobs

BullMQ queue factories. Two named queues:

- `email` — retryable with exponential backoff (3 attempts: 1s, 4s, 16s), dead-letter on final failure
- `maintenance` — repeatable cron jobs (no default retry policy)

## Usage

```ts
import { emailQueue } from "@project/jobs/queues";

await emailQueue().add("invite-collaborator", { listId, invitedUserId });
```

## Idempotency

BullMQ retries re-run the handler. Handlers must be idempotent or use a
dedup key in job data. For pure "send email" jobs this is naturally safe
modulo SMTP-server dedup. For handlers with DB side effects, use a unique
`jobId` option or check for prior completion inside the handler.

## Primitives not demonstrated here

**Delayed jobs** — BullMQ supports `queue.add(name, data, { delay: ms })`
to schedule a job N milliseconds in the future. Not used by any job in
this template; see [BullMQ docs](https://docs.bullmq.io/guide/jobs/delayed).
