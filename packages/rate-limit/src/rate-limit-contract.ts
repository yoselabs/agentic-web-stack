// ADR-0021 — RateLimiter Effect.Service. The Default layer constructs
// an in-memory limiter — adequate for dev/test and as a fallback for
// single-process deployments. Prod layer composition should override
// this with a Redis-backed limiter via Layer.succeed against
// makeRedisRateLimiter from ./rate-limit-service.
//
// Default policy: 30 points per 60 seconds, no key prefix. Consumers
// override at Layer composition time when they need stricter or
// per-procedure buckets.

import { Effect } from "effect";
import {
  makeMemoryRateLimiter,
  type RateLimiterMethods,
} from "./rate-limit-service.ts";

const DEFAULT_POINTS = 30;
const DEFAULT_DURATION_SEC = 60;

export class RateLimiter extends Effect.Service<RateLimiter>()(
  "@project/rate-limit/RateLimiter",
  {
    sync: (): RateLimiterMethods =>
      makeMemoryRateLimiter({
        points: DEFAULT_POINTS,
        duration: DEFAULT_DURATION_SEC,
      }),
  },
) {}
