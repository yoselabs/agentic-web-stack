import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { defineChannel } from "../channel.js";

describe("defineChannel", () => {
  afterEach(() => vi.useRealTimers());

  it("delivers a published event to a concurrent subscriber", async () => {
    const ch = defineChannel({
      name: (id: string) => `test:${id}`,
      events: { ping: z.object({ n: z.number() }) },
    });
    const ac = new AbortController();
    const received: Array<{ type: "ping"; data: { n: number } }> = [];

    const consumer = (async () => {
      for await (const ev of ch.subscribe("room1", ac.signal)) {
        received.push(ev);
        if (received.length >= 1) ac.abort();
      }
    })();

    await new Promise((r) => setTimeout(r, 10)); // let subscribe attach
    ch.publish("room1", "ping", { n: 42 });
    await consumer;

    expect(received).toEqual([{ type: "ping", data: { n: 42 } }]);
  });

  it("does not deliver events from a different room key", async () => {
    const ch = defineChannel({
      name: (id: string) => `test:${id}`,
      events: { ping: z.object({ n: z.number() }) },
    });
    const ac = new AbortController();
    const received: unknown[] = [];

    const consumer = (async () => {
      for await (const ev of ch.subscribe("A", ac.signal)) {
        received.push(ev);
      }
    })();

    await new Promise((r) => setTimeout(r, 10));
    ch.publish("B", "ping", { n: 1 });
    await new Promise((r) => setTimeout(r, 10));
    ac.abort();
    await consumer;

    expect(received).toEqual([]);
  });

  it("hasSubscribers reflects local subscriber count", async () => {
    const ch = defineChannel({
      name: (id: string) => `test:${id}`,
      events: { ping: z.object({}) },
    });
    expect(ch.hasSubscribers("room1")).toBe(false);

    const ac = new AbortController();
    const consumer = (async () => {
      for await (const _ of ch.subscribe("room1", ac.signal)) {
        /* noop */
      }
    })();

    await new Promise((r) => setTimeout(r, 10));
    expect(ch.hasSubscribers("room1")).toBe(true);
    ac.abort();
    await consumer;
    expect(ch.hasSubscribers("room1")).toBe(false);
  });

  it("validates payload shape in dev (throws on bad publish)", () => {
    const ch = defineChannel({
      name: (id: string) => `test:${id}`,
      events: { ping: z.object({ n: z.number() }) },
    });
    // @ts-expect-error — intentionally wrong shape
    expect(() => ch.publish("room1", "ping", { n: "not-a-number" })).toThrow();
  });
});
