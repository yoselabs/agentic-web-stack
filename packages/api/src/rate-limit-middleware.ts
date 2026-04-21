// tRPC middleware helper that applies a `@project/rate-limit` limiter
// to a procedure, keyed on the authenticated session's user id.
//
// Usage:
//   const writeLimiter = createRateLimiter({
//     name: "todo:write",
//     points: 10,
//     duration: 60,
//     redis: getSharedRedis(),
//   });
//   const rateLimitedWrite = protectedProcedure.use(
//     rateLimitByUser(writeLimiter),
//   );
//
// Throws TRPCError { code: "TOO_MANY_REQUESTS" } — the canonical tRPC
// error code for 429. We translate here so downstream tRPC clients see
// the idiomatic code, not our custom RateLimitError class.

import { RateLimitError, type RateLimiter } from "@project/rate-limit/types";
import { TRPCError } from "@trpc/server";
import { t } from "./trpc.js";

/**
 * Build a tRPC middleware that consumes one point from `limiter` per
 * call, keyed on `ctx.session.user.id`. Only safe on procedures that
 * have already passed through `protectedProcedure` — the session is
 * required.
 */
export function rateLimitByUser(limiter: RateLimiter) {
  return t.middleware(async ({ ctx, next }) => {
    if (!ctx.session) {
      // Defensive: this middleware is only meant to be chained after
      // protectedProcedure, which already guarantees a session. If
      // someone misuses it on publicProcedure, surface the mistake as
      // UNAUTHORIZED rather than silently keying on "undefined".
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }
    try {
      await limiter.consume(ctx.session.user.id);
    } catch (err) {
      if (err instanceof RateLimitError) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: err.message,
        });
      }
      throw err;
    }
    return next();
  });
}
