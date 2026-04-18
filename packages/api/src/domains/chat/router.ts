import { z } from "zod";
import { protectedProcedure, router } from "../../trpc.js";
import { roomChannel, userChannel } from "./channels.js";
import { presenceEnter, presenceLeave, presenceList } from "./presence.js";
import {
  createGroupRoom,
  dmFindOrCreate,
  getRoom,
  inviteToRoom,
  leaveRoom,
  listMessages,
  listMyRooms,
  markRead,
  messagesSince,
  requireMembership,
  sendFileMessage,
  sendTextMessage,
} from "./service.js";

const cursorSchema = z.object({ createdAt: z.date(), id: z.string() });

const roomsRouter = router({
  listMine: protectedProcedure.query(({ ctx }) =>
    listMyRooms(ctx.db, ctx.session.user.id),
  ),

  get: protectedProcedure
    .input(z.object({ roomId: z.string() }))
    .query(({ ctx, input }) =>
      getRoom(ctx.db, ctx.session.user.id, input.roomId),
    ),

  createGroup: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(80),
        memberIds: z.array(z.string()).min(1),
      }),
    )
    .mutation(({ ctx, input }) =>
      ctx.db.$transaction((tx) =>
        createGroupRoom(tx, ctx.session.user.id, input.name, input.memberIds),
      ),
    ),

  dmFindOrCreate: protectedProcedure
    .input(z.object({ otherUserId: z.string() }))
    .mutation(({ ctx, input }) =>
      ctx.db.$transaction((tx) =>
        dmFindOrCreate(tx, ctx.session.user.id, input.otherUserId),
      ),
    ),

  invite: protectedProcedure
    .input(z.object({ roomId: z.string(), userId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.$transaction((tx) =>
        inviteToRoom(tx, ctx.session.user.id, input.roomId, input.userId),
      );
      userChannel.publish(input.userId, "room:invited", {
        roomId: input.roomId,
      });
    }),

  leave: protectedProcedure
    .input(z.object({ roomId: z.string() }))
    .mutation(({ ctx, input }) =>
      ctx.db.$transaction((tx) =>
        leaveRoom(tx, ctx.session.user.id, input.roomId),
      ),
    ),
});

const messagesRouter = router({
  list: protectedProcedure
    .input(
      z.object({ roomId: z.string(), beforeCursor: cursorSchema.optional() }),
    )
    .query(({ ctx, input }) =>
      listMessages(
        ctx.db,
        ctx.session.user.id,
        input.roomId,
        input.beforeCursor,
      ),
    ),

  sinceCursor: protectedProcedure
    .input(z.object({ roomId: z.string(), afterCursor: cursorSchema }))
    .query(({ ctx, input }) =>
      messagesSince(
        ctx.db,
        ctx.session.user.id,
        input.roomId,
        input.afterCursor,
      ),
    ),

  sendText: protectedProcedure
    .input(z.object({ roomId: z.string(), text: z.string().min(1).max(4000) }))
    .mutation(({ ctx, input }) =>
      ctx.db.$transaction((tx) =>
        sendTextMessage(tx, ctx.session.user.id, input.roomId, input.text),
      ),
    ),

  sendFile: protectedProcedure
    .input(z.object({ roomId: z.string(), fileId: z.string() }))
    .mutation(({ ctx, input }) =>
      ctx.db.$transaction((tx) =>
        sendFileMessage(tx, ctx.session.user.id, input.roomId, input.fileId),
      ),
    ),

  markRead: protectedProcedure
    .input(z.object({ roomId: z.string(), lastSeenMessageId: z.string() }))
    .mutation(({ ctx, input }) =>
      ctx.db.$transaction((tx) =>
        markRead(
          tx,
          ctx.session.user.id,
          input.roomId,
          input.lastSeenMessageId,
        ),
      ),
    ),
});

const presenceRouter = router({
  list: protectedProcedure
    .input(z.object({ roomId: z.string() }))
    .query(async ({ ctx, input }) => {
      await requireMembership(ctx.db, ctx.session.user.id, input.roomId);
      return presenceList(input.roomId);
    }),
});

const typingRouter = router({
  start: protectedProcedure
    .input(z.object({ roomId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await requireMembership(ctx.db, ctx.session.user.id, input.roomId);
      roomChannel.publish(input.roomId, "typing:start", {
        roomId: input.roomId,
        userId: ctx.session.user.id,
      });
    }),
  stop: protectedProcedure
    .input(z.object({ roomId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await requireMembership(ctx.db, ctx.session.user.id, input.roomId);
      roomChannel.publish(input.roomId, "typing:stop", {
        roomId: input.roomId,
        userId: ctx.session.user.id,
      });
    }),
});

export const chatRouter = router({
  rooms: roomsRouter,
  messages: messagesRouter,
  presence: presenceRouter,
  typing: typingRouter,

  subscribeRoom: protectedProcedure
    .input(z.object({ roomId: z.string() }))
    .subscription(async function* ({ ctx, input, signal }) {
      await requireMembership(ctx.db, ctx.session.user.id, input.roomId);
      presenceEnter(input.roomId, ctx.session.user.id);
      try {
        for await (const event of roomChannel.subscribe(
          input.roomId,
          // biome-ignore lint/style/noNonNullAssertion: tRPC provides signal on subscriptions
          signal!,
        )) {
          yield event;
        }
      } finally {
        presenceLeave(input.roomId, ctx.session.user.id);
      }
    }),

  subscribeUser: protectedProcedure.subscription(async function* ({
    ctx,
    signal,
  }) {
    for await (const event of userChannel.subscribe(
      ctx.session.user.id,
      // biome-ignore lint/style/noNonNullAssertion: tRPC provides signal on subscriptions
      signal!,
    )) {
      yield event;
    }
  }),
});
