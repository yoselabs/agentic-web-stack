// Memoized shared ioredis client for rate-limiter consumers.
//
// Kept separate from the factory so consumers that only need
// RateLimiterMemory (tests, CLI scripts) don't pay the ioredis import
// cost. `getSharedRedis()` lazily constructs a single connection per
// process, keyed on `env.REDIS_URL`.

import { env } from "@project/env/server";
import { Redis } from "ioredis";

let shared: Redis | null = null;

/**
 * Return a process-wide singleton ioredis client connected to
 * `env.REDIS_URL`. Safe to call from any server/worker entry point.
 * The connection is `lazyConnect: true` — the first command triggers
 * the TCP handshake, matching ioredis's default behavior everywhere
 * else in the repo.
 */
export function getSharedRedis(): Redis {
  if (!shared) {
    shared = new Redis(env.REDIS_URL, { lazyConnect: true });
  }
  return shared;
}

/**
 * Tear down the shared client. Intended for test teardown and graceful
 * shutdown hooks; production processes just exit.
 */
export async function closeSharedRedis(): Promise<void> {
  if (shared) {
    await shared.quit();
    shared = null;
  }
}
