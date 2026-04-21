// Public types for @project/rate-limit. Subpath-exported; there is no
// barrel (`.`) export — see root CLAUDE.md "No barrel files".

export interface RateLimiterOptions {
  /**
   * Prefix for all keys — prevents different limiters in the same
   * backend from colliding. Required; pick a stable, descriptive name
   * (e.g. "todo:write", "webhook:ip").
   */
  name: string;
  /** Max points consumed within `duration` before blocking. */
  points: number;
  /** Rolling window length, in seconds. */
  duration: number;
  /**
   * Optional block duration in seconds once the quota is exceeded.
   * When unset, the limiter unblocks as soon as the rolling window
   * drops back below `points`.
   */
  blockDuration?: number;
}

export interface RateLimiter {
  /**
   * Consume `points` (default 1) for `key`. Throws `RateLimitError`
   * when the quota is exceeded. Resolves with no value on success.
   */
  consume(key: string, points?: number): Promise<void>;
  /** Reset the counter for `key`. No-op if the key is unknown. */
  reset(key: string): Promise<void>;
}

export class RateLimitError extends Error {
  readonly name = "RateLimitError";
  /** Milliseconds until the caller may retry. */
  readonly retryAfterMs: number;
  /** The limiter's `name` from its options — useful in logs. */
  readonly limiterName: string;

  constructor(limiterName: string, retryAfterMs: number) {
    super(
      `Rate limit exceeded for "${limiterName}" — retry in ${retryAfterMs}ms`,
    );
    this.limiterName = limiterName;
    this.retryAfterMs = retryAfterMs;
  }
}
