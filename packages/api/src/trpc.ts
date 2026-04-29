import { initTRPC, TRPCError } from "@trpc/server";
import { Option } from "effect";
import type { Context } from "./context.js";

// ADR-0012 — RPC layer: tRPC v11 + runEffect adapter. Single
// `initTRPC.create()` call for the whole server; adding more would
// shatter type identity between routers.

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const publicProcedure = t.procedure;

// `protectedProcedure` narrows ctx.session from Option<Session> to
// Session for downstream handlers. Effect-returning service code that
// also needs the session reads it via `requireSession` against
// `CurrentSession` (provided by runEffect), so the two sources stay in
// sync — both originate in the createContext call.
export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (Option.isNone(ctx.session)) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({
    ctx: {
      ...ctx,
      session: ctx.session.value,
    },
  });
});
