// Maintenance: delete completed todos older than N days. Called by the
// repeatable `purge-stale-todos` cron registered on the maintenance
// queue (apps/worker/src/schedule.ts).
//
// Staleness signal: `completed = true` AND `updatedAt < now - olderThanDays`.
// `updatedAt` is bumped whenever the row changes (Prisma `@updatedAt`),
// so a completed todo that hasn't been touched in N days is the target
// — toggling completion on/off resets the clock, which is the desired
// UX (intentional re-engagement keeps the row alive).

import { Effect } from "effect";
import { tryDb, withTransaction } from "../../runtime/db-layer.ts";

export interface PurgeStaleTodosInput {
  readonly olderThanDays: number;
}

export const purgeStaleCompletedTodos = (input: PurgeStaleTodosInput) =>
  withTransaction(
    Effect.gen(function* () {
      const cutoff = new Date(
        Date.now() - input.olderThanDays * 24 * 60 * 60 * 1000,
      );
      const result = yield* tryDb((db) =>
        db.todo.deleteMany({
          where: {
            completed: true,
            updatedAt: { lt: cutoff },
          },
        }),
      );
      return result.count;
    }),
  );
