import { afterAll, describe, expect, it } from "bun:test";
import { MemoryChannelFactory } from "../src/memory-channel.js";
import { RedisChannelFactory } from "../src/redis-channel.js";
import type { ChannelFactory } from "../src/types.js";

type TestEvent = { kind: "created"; id: string };

async function runContract(name: string, makeFactory: () => ChannelFactory) {
  describe(`${name} — Channel contract`, () => {
    const factory = makeFactory();
    afterAll(async () => {
      await factory.closeAll();
    });

    it("delivers published events to subscribers", async () => {
      const ch = factory.channel<TestEvent>(`contract-${name}-${Date.now()}-1`);
      const received: TestEvent[] = [];
      const unsub = await ch.subscribe((e) => received.push(e));

      await ch.publish({ kind: "created", id: "a" });
      // Redis round-trip needs a moment; memory is synchronous.
      await new Promise((r) => setTimeout(r, 50));

      expect(received).toEqual([{ kind: "created", id: "a" }]);
      unsub();
    });

    it("stops delivery after unsubscribe", async () => {
      const ch = factory.channel<TestEvent>(`contract-${name}-${Date.now()}-2`);
      const received: TestEvent[] = [];
      const unsub = await ch.subscribe((e) => received.push(e));
      unsub();

      await ch.publish({ kind: "created", id: "a" });
      await new Promise((r) => setTimeout(r, 50));

      expect(received).toEqual([]);
    });

    it("delivers to multiple subscribers", async () => {
      const ch = factory.channel<TestEvent>(`contract-${name}-${Date.now()}-3`);
      const a: TestEvent[] = [];
      const b: TestEvent[] = [];
      await ch.subscribe((e) => a.push(e));
      await ch.subscribe((e) => b.push(e));

      await ch.publish({ kind: "created", id: "x" });
      await new Promise((r) => setTimeout(r, 50));

      expect(a).toEqual([{ kind: "created", id: "x" }]);
      expect(b).toEqual([{ kind: "created", id: "x" }]);
    });
  });
}

await runContract("MemoryChannel", () => new MemoryChannelFactory());
await runContract("RedisChannel", () => new RedisChannelFactory());
