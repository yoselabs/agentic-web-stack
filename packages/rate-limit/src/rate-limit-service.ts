// ADR-0021 — RateLimiter implementations wrapping rate-limiter-flexible.
//
// Two backends:
//   - RateLimiterMemory: in-process bucket. Fast, no network. Used by
//     dev/test layers (single process, lossy across restarts).
//   - RateLimiterRedis: distributed bucket via Redis Lua script. Used
//     by prod (horizontally-scaled API processes share one limit).
//
// Both expose the same `consume(key, points): Effect<void, …, never>`
// shape. The choice happens at Layer composition time (Live vs Test) —
// this file only defines the building blocks.

import { Effect } from "effect";
import type Redis from "ioredis";
import {
  type IRateLimiterOptions,
  RateLimiterMemory,
  RateLimiterRedis,
  type RateLimiterRes,
} from "rate-limiter-flexible";
import { RateLimitExceededError } from "./rate-limit-errors.ts";

export interface RateLimiterMethods {
  readonly consume: (
    key: string,
    points?: number,
  ) => Effect.Effect<void, RateLimitExceededError>;
}

const wrapConsume =
  (
    limiter: RateLimiterMemory | RateLimiterRedis,
  ): RateLimiterMethods["consume"] =>
  (key, points = 1) =>
    Effect.tryPromise({
      try: () => limiter.consume(key, points),
      catch: (cause) => {
        // rate-limiter-flexible rejects with a RateLimiterRes when the
        // bucket is exhausted. Other rejections (e.g. Redis transport
        // errors) come through with a different shape — we still
        // surface them as RateLimitExceeded with msBeforeNext=0 to
        // keep the error channel monomorphic. Transport-level
        // diagnostics belong in a future RateLimiterTransportError
        // variant; ADR-0021 intentionally keeps the surface narrow.
        const res = cause as Partial<RateLimiterRes>;
        return new RateLimitExceededError({
          key,
          msBeforeNext:
            typeof res.msBeforeNext === "number" ? res.msBeforeNext : 0,
          remainingPoints:
            typeof res.remainingPoints === "number" ? res.remainingPoints : 0,
        });
      },
    }).pipe(Effect.asVoid);

export interface RateLimiterMemoryConfig
  extends Pick<IRateLimiterOptions, "points" | "duration"> {
  readonly keyPrefix?: string;
}

export const makeMemoryRateLimiter = (
  config: RateLimiterMemoryConfig,
): RateLimiterMethods => {
  const limiter = new RateLimiterMemory({
    points: config.points,
    duration: config.duration,
    ...(config.keyPrefix !== undefined ? { keyPrefix: config.keyPrefix } : {}),
  });
  return { consume: wrapConsume(limiter) };
};

export interface RateLimiterRedisConfig extends RateLimiterMemoryConfig {
  readonly storeClient: Redis;
}

export const makeRedisRateLimiter = (
  config: RateLimiterRedisConfig,
): RateLimiterMethods => {
  const limiter = new RateLimiterRedis({
    storeClient: config.storeClient,
    points: config.points,
    duration: config.duration,
    ...(config.keyPrefix !== undefined ? { keyPrefix: config.keyPrefix } : {}),
  });
  return { consume: wrapConsume(limiter) };
};
