import { sendEmail } from "@project/email/service";
import { channel as defaultChannel } from "@project/realtime/channel";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../../trpc.js";
import {
  listChannelKey,
  subscribeToListEvents,
  type TodoListEvent,
} from "./events.js";
import {
  acceptInvite as acceptInviteFn,
  canReadList,
  createTodoList,
  deleteTodoList,
  getTodoList,
  inviteCollaborator as inviteCollaboratorFn,
  listAccessibleTodoLists,
  listCollaborators,
  listTodoLists,
  removeCollaborator as removeCollaboratorFn,
} from "./service.js";

export const todoListRouter = router({
  list: protectedProcedure.query(({ ctx }) => {
    return listTodoLists(ctx.db, ctx.session.user.id);
  }),
  get: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(({ ctx, input }) => {
      return getTodoList(ctx.db, ctx.session.user.id, input.id);
    }),
  create: protectedProcedure
    .input(z.object({ name: z.string().min(1), color: z.string().optional() }))
    .mutation(({ ctx, input }) => {
      return ctx.db.$transaction((tx) =>
        createTodoList(tx, ctx.session.user.id, input.name, input.color),
      );
    }),
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ ctx, input }) => {
      return ctx.db.$transaction((tx) =>
        deleteTodoList(tx, ctx.session.user.id, input.id),
      );
    }),
  listAccessible: protectedProcedure.query(({ ctx }) =>
    listAccessibleTodoLists(ctx.db, ctx.session.user.id),
  ),
  inviteCollaborator: protectedProcedure
    .input(z.object({ listId: z.string().min(1), username: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      // Service creates the invite row; email is enqueued AFTER the
      // transaction commits so a rollback never leaks an orphan email.
      const result = await ctx.db.$transaction((tx) =>
        inviteCollaboratorFn(
          tx,
          ctx.session.user.id,
          input.listId,
          input.username,
        ),
      );
      await sendEmail({
        template: "invite-collaborator",
        to: result.inviteeEmail,
        vars: {
          inviterName: result.inviterName,
          listName: result.listName,
          acceptUrl: `/invites/${result.invite.token}`,
        },
      });
      return result.invite;
    }),
  acceptInvite: protectedProcedure
    .input(z.object({ token: z.string().min(1) }))
    .mutation(({ ctx, input }) =>
      ctx.db.$transaction((tx) =>
        acceptInviteFn(tx, ctx.session.user.id, input.token),
      ),
    ),
  removeCollaborator: protectedProcedure
    .input(z.object({ listId: z.string().min(1), userId: z.string().min(1) }))
    .mutation(({ ctx, input }) =>
      ctx.db.$transaction((tx) =>
        removeCollaboratorFn(
          tx,
          ctx.session.user.id,
          input.listId,
          input.userId,
        ),
      ),
    ),
  collaborators: protectedProcedure
    .input(z.object({ listId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const allowed = await canReadList(
        ctx.db,
        ctx.session.user.id,
        input.listId,
      );
      if (!allowed) throw new TRPCError({ code: "FORBIDDEN" });
      return listCollaborators(ctx.db, input.listId);
    }),
  // Native async generator (via the subscribeToListEvents helper in
  // events.ts). Auto-closes when the viewer's own membership is revoked.
  onListEvent: protectedProcedure
    .input(z.object({ listId: z.string().min(1) }))
    .subscription(async function* ({ ctx, input, signal }) {
      const allowed = await canReadList(
        ctx.db,
        ctx.session.user.id,
        input.listId,
      );
      if (!allowed) throw new TRPCError({ code: "FORBIDDEN" });

      const ch = defaultChannel<TodoListEvent>(listChannelKey(input.listId));
      yield* subscribeToListEvents(ch, ctx.session.user.id, signal);
    }),
});
