// Channel contract. Both RedisChannel and MemoryChannel satisfy this.
// Events are JSON-serializable application payloads — the transport
// handles encoding. Consumers define their own event union per domain.

export type Unsubscribe = () => void;

export interface Channel<TEvent> {
  publish(event: TEvent): Promise<void>;
  subscribe(handler: (event: TEvent) => void): Promise<Unsubscribe>;
}

export interface ChannelFactory {
  channel<TEvent>(key: string): Channel<TEvent>;
  closeAll(): Promise<void>;
}
