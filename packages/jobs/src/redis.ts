// Shared ioredis connection config for BullMQ queues and workers.
// Single connection URL keeps test-infra + dev + prod aligned through @project/env.
//
// BullMQ requires `maxRetriesPerRequest: null` on the shared connection
// (worker-side); the queue-side can use defaults. We expose a single factory
// keyed by role to make the call sites self-documenting.

import { env } from "@project/env/server";
import { Redis, type RedisOptions } from "ioredis";

export type RedisRole = "queue" | "worker";

export function createRedis(role: RedisRole): Redis {
  const options: RedisOptions =
    role === "worker" ? { maxRetriesPerRequest: null } : {};
  return new Redis(env.REDIS_URL, options);
}
