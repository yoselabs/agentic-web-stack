// Factory for pluggable rate limiters. Auto-picks backend:
//   - `redis` provided → RateLimiterRedis (ioredis, loaded lazily)
//   - otherwise       → RateLimiterMemory (zero-dep, for tests/dev)
//
// We lazy-import rate-limiter-flexible's submodules so memory-only
// consumers don't pull the ioredis adapter (and its transitive deps)
// into their startup path. The dynamic imports resolve at first call
// and are cheap thereafter — Node caches module resolution.

import type { Redis } from "ioredis";
import type {
  IRateLimiterOptions,
  IRateLimiterStoreOptions,
  RateLimiterAbstract,
  RateLimiterRes,
} from "rate-limiter-flexible";
import {
  RateLimitError,
  type RateLimiter,
  type RateLimiterOptions,
} from "./types.js";

interface FactoryOptions extends RateLimiterOptions {
  /**
   * Optional ioredis connection. When supplied the limiter uses the
   * Redis store — shared across processes, survives restarts. When
   * absent, an in-memory limiter is used (per-process only).
   */
  redis?: Redis;
}

/**
 * Create a rate limiter. See `RateLimiterOptions` for field docs.
 *
 * Example:
 *   const limiter = createRateLimiter({
 *     name: "todo:write",
 *     points: 10,
 *     duration: 60,
 *     redis: getSharedRedis(),
 *   });
 *   await limiter.consume(userId); // throws RateLimitError on overage
 */
export function createRateLimiter(opts: FactoryOptions): RateLimiter {
  const { name, points, duration, blockDuration, redis } = opts;

  let impl: RateLimiterAbstract | null = null;
  let pending: Promise<RateLimiterAbstract> | null = null;

  async function getImpl(): Promise<RateLimiterAbstract> {
    if (impl) return impl;
    if (pending) return pending;
    pending = (async (): Promise<RateLimiterAbstract> => {
      if (redis) {
        const mod = await import("rate-limiter-flexible");
        const storeOpts: IRateLimiterStoreOptions = {
          storeClient: redis,
          keyPrefix: name,
          points,
          duration,
          blockDuration,
        };
        return new mod.RateLimiterRedis(storeOpts);
      }
      const mod = await import("rate-limiter-flexible");
      const memOpts: IRateLimiterOptions = {
        keyPrefix: name,
        points,
        duration,
        blockDuration,
      };
      return new mod.RateLimiterMemory(memOpts);
    })();
    impl = await pending;
    pending = null;
    return impl;
  }

  return {
    async consume(key: string, p = 1): Promise<void> {
      const r = await getImpl();
      try {
        await r.consume(key, p);
      } catch (err) {
        // rate-limiter-flexible rejects with RateLimiterRes on overage
        // and with a real Error on infra failure. Differentiate:
        // RateLimiterRes has a numeric `msBeforeNext` field.
        if (isRateLimiterRes(err)) {
          throw new RateLimitError(name, err.msBeforeNext);
        }
        throw err;
      }
    },
    async reset(key: string): Promise<void> {
      const r = await getImpl();
      await r.delete(key);
    },
  };
}

function isRateLimiterRes(x: unknown): x is RateLimiterRes {
  return (
    typeof x === "object" &&
    x !== null &&
    "msBeforeNext" in x &&
    typeof (x as { msBeforeNext: unknown }).msBeforeNext === "number"
  );
}
