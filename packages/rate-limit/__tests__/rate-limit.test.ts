import { describe, expect, it } from "bun:test";
import { createRateLimiter } from "../src/factory.js";
import { RateLimitError } from "../src/types.js";

describe("createRateLimiter — memory adapter", () => {
  it("exhausts quota and throws RateLimitError", async () => {
    const limiter = createRateLimiter({
      name: `test:memory:exhaust:${Date.now()}`,
      points: 3,
      duration: 60,
    });

    await limiter.consume("user-a");
    await limiter.consume("user-a");
    await limiter.consume("user-a");

    let caught: unknown;
    try {
      await limiter.consume("user-a");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(RateLimitError);
    const err = caught as RateLimitError;
    expect(err.limiterName).toContain("test:memory:exhaust:");
    expect(err.retryAfterMs).toBeGreaterThan(0);
  });

  it("resets the counter for a key after reset()", async () => {
    const limiter = createRateLimiter({
      name: `test:memory:reset:${Date.now()}`,
      points: 2,
      duration: 60,
    });
    await limiter.consume("k");
    await limiter.consume("k");
    await expect(limiter.consume("k")).rejects.toBeInstanceOf(RateLimitError);

    await limiter.reset("k");
    await expect(limiter.consume("k")).resolves.toBeUndefined();
  });

  it("releases after `duration` elapses", async () => {
    // Use a short real duration rather than faking timers — the memory
    // adapter reads Date.now() internally; faking Bun timers doesn't
    // move monotonic wall-clock state it depends on.
    const limiter = createRateLimiter({
      name: `test:memory:window:${Date.now()}`,
      points: 1,
      duration: 1, // 1 second window
    });
    await limiter.consume("u");
    await expect(limiter.consume("u")).rejects.toBeInstanceOf(RateLimitError);

    await new Promise((r) => setTimeout(r, 1100));
    await expect(limiter.consume("u")).resolves.toBeUndefined();
  });

  it("different `name` values do not share counters", async () => {
    const a = createRateLimiter({
      name: `test:iso:a:${Date.now()}`,
      points: 1,
      duration: 60,
    });
    const b = createRateLimiter({
      name: `test:iso:b:${Date.now()}`,
      points: 1,
      duration: 60,
    });

    await a.consume("shared-key");
    // Same key on a different limiter must succeed — proves the
    // keyPrefix (name) isolates counters.
    await expect(b.consume("shared-key")).resolves.toBeUndefined();
    await expect(a.consume("shared-key")).rejects.toBeInstanceOf(
      RateLimitError,
    );
  });
});

describe("createRateLimiter — redis adapter selection", () => {
  it("uses the Redis backend when `redis` is provided", async () => {
    // We don't need a live Redis — just verify the code path picks
    // RateLimiterRedis. We fake an ioredis-compatible client with the
    // minimum surface `rate-limiter-flexible` touches at construction.
    // Construction itself is synchronous; an actual consume() call would
    // hit the fake and fail, which is fine — we only assert selection.
    const fakeRedis = {
      // rate-limiter-flexible inspects constructor/prototype for the
      // ioredis-vs-node-redis client detection. Give it an ioredis-ish
      // shape: the `defineCommand` method is ioredis-specific and is
      // called during RateLimiterRedis construction.
      defineCommand: () => {},
      options: {},
      status: "ready",
      call: async () => null,
    };

    const limiter = createRateLimiter({
      name: `test:redis-select:${Date.now()}`,
      points: 5,
      duration: 60,
      // biome-ignore lint/suspicious/noExplicitAny: test-only fake
      redis: fakeRedis as any,
    });

    // The first consume() triggers lazy construction of the adapter.
    // We only care that it doesn't silently fall through to memory.
    // With the fake, `consume` will reject with an infra-error (not a
    // RateLimitError). That asymmetry proves the Redis path was taken.
    let err: unknown;
    try {
      await limiter.consume("x");
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    expect(err).not.toBeInstanceOf(RateLimitError);
  });
});
