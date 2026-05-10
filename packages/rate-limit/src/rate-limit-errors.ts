// ADR-0021 — Tagged error for the RateLimiter Effect.Service. Carries
// `msBeforeNext` so router middleware can map to a 429 with a
// Retry-After header rather than just a generic failure.

import { Data } from "effect";

export class RateLimitExceededError extends Data.TaggedError(
  "RateLimitExceededError",
)<{
  readonly key: string;
  readonly msBeforeNext: number;
  readonly remainingPoints: number;
}> {}
