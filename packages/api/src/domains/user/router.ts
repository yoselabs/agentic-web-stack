import { z } from "zod";
import { protectedProcedure, publicProcedure, router } from "../../trpc.js";
import { isUsernameAvailable, searchUsers } from "./service.js";

export const userRouter = router({
  search: protectedProcedure
    .input(z.object({ query: z.string() }))
    .query(({ ctx, input }) => searchUsers(ctx.db, input.query)),

  isUsernameAvailable: publicProcedure
    .input(z.object({ username: z.string().min(3).max(20) }))
    .query(({ ctx, input }) => isUsernameAvailable(ctx.db, input.username)),
});
