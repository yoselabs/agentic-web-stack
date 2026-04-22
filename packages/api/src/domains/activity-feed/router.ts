import { channel as defaultChannel } from "@project/realtime/channel";
import { TRPCError, type TrackedEnvelope, tracked } from "@trpc/server";
// biome-ignore lint/correctness/noUnusedImports: Importing TrackedData from
// its canonical public path keeps the inferred router type portable in the
// emitted `.d.ts`. Without this side-effect import, tsc reports TS2883
// because the internal dist file name is unstable across tRPC versions.
import type { TrackedData as _TrackedData } from "@trpc/server/unstable-core-do-not-import";
import { z } from "zod";
import { protectedProcedure, router } from "../../trpc.js";
import { canReadList } from "../todo-list/service.js";
import { ACTIVITY_LIST_PAGE_SIZE } from "./constants.js";
import {
  type ActivityEventEnvelope,
  type ActivityEventRecord,
  activityChannelKey,
} from "./events.js";
import { listActivityEvents, streamActivityEvents } from "./service.js";

export const activityFeedRouter = router({
  list: protectedProcedure
    .input(
      z.strictObject({
        todoListId: z.string().min(1),
        cursor: z.string().min(1).optional(),
        limit: z.number().int().min(1).max(ACTIVITY_LIST_PAGE_SIZE).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const allowed = await canReadList(
        ctx.db,
        ctx.session.user.id,
        input.todoListId,
      );
      if (!allowed) throw new TRPCError({ code: "FORBIDDEN" });
      return listActivityEvents(ctx.db, input);
    }),

  onListEvents: protectedProcedure
    .input(
      z.strictObject({
        todoListId: z.string().min(1),
        // Populated by tRPC from the `Last-Event-Id` header / query param
        // on reconnect. Clients do not pass this themselves.
        lastEventId: z.string().optional(),
      }),
    )
    .subscription(async function* ({
      ctx,
      input,
      signal,
    }): AsyncGenerator<
      TrackedEnvelope<ActivityEventEnvelope> | ActivityEventEnvelope
    > {
      const allowed = await canReadList(
        ctx.db,
        ctx.session.user.id,
        input.todoListId,
      );
      if (!allowed) throw new TRPCError({ code: "FORBIDDEN" });

      const ch = defaultChannel<ActivityEventRecord>(
        activityChannelKey(input.todoListId),
      );
      for await (const envelope of streamActivityEvents(ctx.db, {
        todoListId: input.todoListId,
        lastEventId: input.lastEventId,
        channel: ch,
        signal,
      })) {
        if (envelope.kind === "event") {
          yield tracked(envelope.event.id, envelope);
        } else {
          // resync sentinel — no useful id to track. Emit without tracking.
          yield envelope;
        }
      }
    }),
});
