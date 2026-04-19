import { channel as defaultChannel } from "@project/realtime/channel";
import { userInboxChannelKey } from "@project/realtime/user-inbox";
import { z } from "zod";
import { protectedProcedure, router } from "../../trpc.js";
import { subscribeToUserInbox } from "./subscribe-to-user-inbox.js";
import type { UserInboxEvent } from "./user-events.js";
import { searchUsersByUsername } from "./user-service.js";

export const userRouter = router({
  searchByUsername: protectedProcedure
    .input(z.object({ prefix: z.string().min(1).max(64) }))
    .query(({ ctx, input }) =>
      searchUsersByUsername(ctx.db, ctx.session.user.id, input.prefix),
    ),
  // Viewer-scoped: a session may only subscribe to its own inbox.
  // Channel key is derived from ctx.session.user.id, not from input —
  // there is no "subscribe to somebody else's inbox" surface.
  onInboxEvent: protectedProcedure.subscription(async function* ({
    ctx,
    signal,
  }) {
    const ch = defaultChannel<UserInboxEvent>(
      userInboxChannelKey(ctx.session.user.id),
    );
    yield* subscribeToUserInbox(ch, signal);
  }),
});
