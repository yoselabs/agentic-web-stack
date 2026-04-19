// Production Channel implementation backed by Redis pub/sub.
//
// Each Channel<T> owns:
//   - one publisher (shared across channels from the factory — publishing
//     only needs one command connection)
//   - one subscriber (Redis requires subscriber connections be dedicated —
//     you cannot run regular commands on a SUBSCRIBE'd connection)
//
// CONCURRENCY NOTE: subscriber initialization must be race-safe. Two
// near-simultaneous subscribe() callers would both see `this.subscriber`
// as null, both call `new Redis()`, and only one of the two assignments
// would win — leaking a dangling subscriber. We guard with a Promise
// captured synchronously before the first await so concurrent callers
// share the same init promise.

import { env } from "@project/env/server";
import { Redis } from "ioredis";
import type { Channel, ChannelFactory, Unsubscribe } from "./types.js";

type Handler<T> = (event: T) => void;

class RedisChannelImpl<T> implements Channel<T> {
  private handlers = new Set<Handler<T>>();
  // Promise resolves once the subscriber exists AND has finished SUBSCRIBE.
  // Set synchronously in the first subscribe() call; all later callers
  // await the same promise.
  private subscriberReady: Promise<Redis> | null = null;

  constructor(
    private readonly key: string,
    private readonly publisher: Redis,
  ) {}

  async publish(event: T): Promise<void> {
    await this.publisher.publish(this.key, JSON.stringify(event));
  }

  async subscribe(handler: Handler<T>): Promise<Unsubscribe> {
    if (!this.subscriberReady) {
      this.subscriberReady = this.initSubscriber();
    }
    await this.subscriberReady;
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
      // Keep subscriber alive for fast re-subscribe; closeAll() drains.
    };
  }

  private async initSubscriber(): Promise<Redis> {
    const sub = new Redis(env.REDIS_URL);
    sub.on("message", (_channel, payload) => {
      let event: T;
      try {
        event = JSON.parse(payload) as T;
      } catch (err) {
        // biome-ignore lint/suspicious/noConsole: intentional error surface
        console.error(`[redis-channel:${this.key}] invalid JSON payload:`, err);
        return;
      }
      // Snapshot handlers before iterating — a handler may call
      // unsubscribe() mid-iteration and mutate the Set.
      for (const h of [...this.handlers]) {
        try {
          h(event);
        } catch (err) {
          // biome-ignore lint/suspicious/noConsole: intentional error surface
          console.error(`[redis-channel:${this.key}] handler threw:`, err);
        }
      }
    });
    await sub.subscribe(this.key);
    return sub;
  }

  async close(): Promise<void> {
    this.handlers.clear();
    const ready = this.subscriberReady;
    this.subscriberReady = null;
    if (ready) {
      const sub = await ready;
      await sub.quit();
    }
  }
}

export class RedisChannelFactory implements ChannelFactory {
  private publisher: Redis;
  // biome-ignore lint/suspicious/noExplicitAny: factory is generic over channel event types
  private channels = new Map<string, RedisChannelImpl<any>>();

  constructor() {
    this.publisher = new Redis(env.REDIS_URL);
  }

  channel<TEvent>(key: string): Channel<TEvent> {
    let existing = this.channels.get(key);
    if (!existing) {
      existing = new RedisChannelImpl<TEvent>(key, this.publisher);
      this.channels.set(key, existing);
    }
    return existing as Channel<TEvent>;
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.channels.values()].map((c) => c.close()));
    this.channels.clear();
    await this.publisher.quit();
  }
}
