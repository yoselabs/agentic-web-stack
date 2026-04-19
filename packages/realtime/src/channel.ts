// Production default factory — one process-wide RedisChannelFactory.
// App code calls channel<T>(key); tests bypass this and construct
// MemoryChannelFactory directly.

import { RedisChannelFactory } from "./redis-channel.js";
import type { Channel } from "./types.js";

let defaultFactory: RedisChannelFactory | null = null;

function factory(): RedisChannelFactory {
  if (!defaultFactory) defaultFactory = new RedisChannelFactory();
  return defaultFactory;
}

export function channel<TEvent>(key: string): Channel<TEvent> {
  return factory().channel<TEvent>(key);
}

export async function closeAllChannels(): Promise<void> {
  await defaultFactory?.closeAll();
  defaultFactory = null;
}
