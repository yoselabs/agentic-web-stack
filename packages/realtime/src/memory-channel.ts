// In-memory Channel implementation. Used by:
//   - service-layer unit tests (no Docker needed)
//   - as reference code for agents learning the abstraction
//
// Not runtime-selectable in app code — do not import this from apps/*.
// Tests inject it directly via the service layer's DI seam.

import type { Channel, ChannelFactory, Unsubscribe } from "./types.js";

type Handler<T> = (event: T) => void;

class MemoryChannelImpl<T> implements Channel<T> {
  private handlers = new Set<Handler<T>>();

  async publish(event: T): Promise<void> {
    for (const h of this.handlers) {
      try {
        h(event);
      } catch (err) {
        // biome-ignore lint/suspicious/noConsole: intentional error logging for dropped handler exceptions
        console.error("[memory-channel] handler threw:", err);
      }
    }
  }

  async subscribe(handler: Handler<T>): Promise<Unsubscribe> {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }
}

export class MemoryChannelFactory implements ChannelFactory {
  // biome-ignore lint/suspicious/noExplicitAny: factory is generic over channel event types
  private channels = new Map<string, MemoryChannelImpl<any>>();

  channel<TEvent>(key: string): Channel<TEvent> {
    let existing = this.channels.get(key);
    if (!existing) {
      existing = new MemoryChannelImpl<TEvent>();
      this.channels.set(key, existing);
    }
    return existing as Channel<TEvent>;
  }

  async closeAll(): Promise<void> {
    this.channels.clear();
  }
}
