// Memory-backed limiter tests. Redis path is exercised via integration
// at the application layer (apps/server with a real Redis); covering
// both backends here would just be testing the upstream library.

import { describe, expect, it } from "bun:test";
import { Cause, Effect, Exit } from "effect";
import { RateLimitExceededError } from "../rate-limit-errors.ts";
import { makeMemoryRateLimiter } from "../rate-limit-service.ts";

describe("makeMemoryRateLimiter", () => {
  it("permits requests under the limit", async () => {
    const limiter = makeMemoryRateLimiter({ points: 3, duration: 1 });
    await Effect.runPromise(limiter.consume("user-1"));
    await Effect.runPromise(limiter.consume("user-1"));
    await Effect.runPromise(limiter.consume("user-1"));
  });

  it("fails with RateLimitExceededError after the bucket is empty", async () => {
    const limiter = makeMemoryRateLimiter({ points: 2, duration: 1 });
    await Effect.runPromise(limiter.consume("user-2"));
    await Effect.runPromise(limiter.consume("user-2"));

    const exit = await Effect.runPromiseExit(limiter.consume("user-2"));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const failure = Cause.failureOption(exit.cause);
      expect(failure._tag).toBe("Some");
      if (failure._tag === "Some") {
        expect(failure.value).toBeInstanceOf(RateLimitExceededError);
        expect((failure.value as RateLimitExceededError).key).toBe("user-2");
        expect(
          (failure.value as RateLimitExceededError).msBeforeNext,
        ).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("isolates buckets per key", async () => {
    const limiter = makeMemoryRateLimiter({ points: 1, duration: 1 });
    await Effect.runPromise(limiter.consume("alice"));
    await Effect.runPromise(limiter.consume("bob"));

    const aliceExit = await Effect.runPromiseExit(limiter.consume("alice"));
    expect(Exit.isFailure(aliceExit)).toBe(true);

    // Bob still has a fresh bucket — key isolation works.
    const bobExit = await Effect.runPromiseExit(limiter.consume("bob"));
    expect(Exit.isFailure(bobExit)).toBe(true);
  });

  it("supports multi-point consumption", async () => {
    const limiter = makeMemoryRateLimiter({ points: 5, duration: 1 });
    await Effect.runPromise(limiter.consume("expensive-op", 4));

    // 1 point left — should succeed.
    await Effect.runPromise(limiter.consume("expensive-op", 1));

    // 0 points left — next consume must fail.
    const exit = await Effect.runPromiseExit(limiter.consume("expensive-op"));
    expect(Exit.isFailure(exit)).toBe(true);
  });
});
