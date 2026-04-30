// Redis connection factory shared by BullMQ Queue and Worker instances.
//
// BullMQ requires `maxRetriesPerRequest: null` on the **worker** connection
// — the queue side runs with defaults. We expose one factory keyed by role
// to keep call sites self-documenting and the only knowledge of BullMQ's
// connection requirements in one place.
//
// This is a plain factory rather than an Effect Layer because BullMQ owns
// the connection lifetime internally (Queue/Worker `close()` shuts the
// connection down). Wrapping in a Layer would invert that ownership.

import { env } from "@project/env/server";
import { Redis, type RedisOptions } from "ioredis";

export type RedisRole = "queue" | "worker";

export function createRedis(role: RedisRole): Redis {
  const options: RedisOptions =
    role === "worker" ? { maxRetriesPerRequest: null } : {};
  return new Redis(env.REDIS_URL, options);
}
