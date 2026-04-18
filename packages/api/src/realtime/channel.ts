import { EventEmitter } from "node:events";
import { env } from "@project/env/server";
import type { ZodType, z } from "zod";

type EventMap = Record<string, ZodType>;

export type ChannelDefinition<K, E extends EventMap> = {
  name: (key: K) => string;
  events: E;
};

type EventFor<E extends EventMap> = {
  [K in keyof E]: { type: K; data: z.infer<E[K]> };
}[keyof E];

// Single process-wide emitter. Channel name strings scope delivery.
const bus = new EventEmitter();
bus.setMaxListeners(0);

export type Channel<K, E extends EventMap> = {
  publish<T extends keyof E>(key: K, type: T, data: z.infer<E[T]>): void;
  subscribe(key: K, signal: AbortSignal): AsyncIterable<EventFor<E>>;
  hasSubscribers(key: K): boolean;
};

const IS_DEV = env.NODE_ENV !== "production";

export function defineChannel<K, E extends EventMap>(
  def: ChannelDefinition<K, E>,
): Channel<K, E> {
  return {
    publish(key, type, data) {
      const name = def.name(key);
      if (IS_DEV) {
        def.events[type].parse(data);
      }
      bus.emit(name, { type, data });
    },

    hasSubscribers(key) {
      return bus.listenerCount(def.name(key)) > 0;
    },

    subscribe(key, signal) {
      const name = def.name(key);
      const queue: EventFor<E>[] = [];
      let resolve: ((v: IteratorResult<EventFor<E>>) => void) | null = null;
      let done = false;

      const handler = (ev: EventFor<E>) => {
        if (resolve) {
          resolve({ value: ev, done: false });
          resolve = null;
        } else {
          queue.push(ev);
        }
      };

      bus.on(name, handler);

      const close = () => {
        if (done) return;
        done = true;
        bus.off(name, handler);
        if (resolve) {
          resolve({ value: undefined as never, done: true });
          resolve = null;
        }
      };
      signal.addEventListener("abort", close, { once: true });

      return {
        [Symbol.asyncIterator]() {
          return {
            next(): Promise<IteratorResult<EventFor<E>>> {
              if (done)
                return Promise.resolve({
                  value: undefined as never,
                  done: true,
                });
              const next = queue.shift();
              if (next) return Promise.resolve({ value: next, done: false });
              return new Promise((r) => {
                resolve = r;
              });
            },
            return(): Promise<IteratorResult<EventFor<E>>> {
              close();
              return Promise.resolve({ value: undefined as never, done: true });
            },
          };
        },
      };
    },
  };
}
