// Handler registry for the `maintenance` queue. Each entry is a
// `JobHandler<R>` — the Effect runs with the runtimeLayer provided by
// `processJob` (AppLayer here, supplying Db / Logger / Auth).
//
// Adding a maintenance job:
//   1. Declare its name + payload in @project/jobs/queues
//   2. Register a repeatable schedule in ../schedule.ts
//   3. Add the handler entry below

import { TodoListService } from "@project/api/domains/todo-list/todo-contract";
import type { Db } from "@project/api/runtime/db-layer";
import type { JobHandler } from "@project/jobs/process-job";
import {
  PURGE_STALE_TODOS_JOB,
  type PurgeStaleTodosPayload,
} from "@project/jobs/queues";
import { Effect } from "effect";

const purgeStaleTodos: JobHandler<Db> = (data, job) =>
  Effect.gen(function* () {
    const payload = data as PurgeStaleTodosPayload;
    const svc = yield* TodoListService;
    const report = yield* svc.purge({ olderThanDays: payload.olderThanDays });
    yield* Effect.logInfo(
      `[maintenance/${job.name}] removed ${report.deleted} stale completed todos (olderThanDays=${payload.olderThanDays})`,
    );
    return { deleted: report.deleted };
  }).pipe(Effect.provide(TodoListService.Default));

export const maintenanceHandlers: Record<string, JobHandler<Db>> = {
  [PURGE_STALE_TODOS_JOB]: purgeStaleTodos,
};
