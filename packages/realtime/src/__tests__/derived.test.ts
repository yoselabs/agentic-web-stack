// Tests for the client-derived state primitive.
//
// Strategy:
//   - MockDerivedSource is the deterministic surface — covers the semantic
//     contract (initial, activity, ticks, subscribe/notify) with virtual time.
//   - The real `createDerivedSource` is exercised for its SSR short-circuit
//     (no window). Browser-path behavior (BroadcastChannel + navigator.locks)
//     is out of scope for bun:test — it belongs in a Vitest browser-mode
//     test when a consumer lands.
//   - "Multi-instance leader election" is simulated by constructing two
//     MockDerivedSource instances sharing a `key`-scoped registry; only the
//     first registered becomes the leader (others are passive followers).

import { describe, expect, it } from "bun:test";
import {
  type DerivedCompute,
  MockDerivedSource,
  createDerivedSource,
} from "../derived.js";

type Status = "online" | "afk" | "offline";

const presenceCompute: DerivedCompute<Status> = (lastActivityAt, now) => {
  const idleMs = now - lastActivityAt;
  if (idleMs < 60_000) return "online";
  if (idleMs < 300_000) return "afk";
  return "offline";
};

describe("MockDerivedSource — initial value", () => {
  it("exposes the initial value before any activity or tick", () => {
    const src = new MockDerivedSource<Status>({
      initial: "offline",
      compute: presenceCompute,
      tickMs: 1000,
    });
    expect(src.get()).toBe("offline");
  });
});

describe("MockDerivedSource — activity events", () => {
  it("recomputes to 'online' after activity is signaled", () => {
    const src = new MockDerivedSource<Status>({
      initial: "offline",
      compute: presenceCompute,
      tickMs: 1000,
    });
    src.activity();
    expect(src.get()).toBe("online");
  });

  it("notifies subscribers when activity changes the derived value", () => {
    const src = new MockDerivedSource<Status>({
      initial: "offline",
      compute: presenceCompute,
      tickMs: 1000,
    });
    let notifyCount = 0;
    src.subscribe(() => notifyCount++);
    src.activity();
    expect(notifyCount).toBe(1);
    expect(src.get()).toBe("online");
  });
});

describe("MockDerivedSource — tick interval", () => {
  it("re-evaluates compute every tickMs and transitions online → afk → offline", () => {
    const src = new MockDerivedSource<Status>({
      initial: "online",
      compute: presenceCompute,
      tickMs: 1000,
    });
    src.activity(); // lastActivityAt = 0, now = 0
    expect(src.get()).toBe("online");

    src.advanceTime(30_000);
    expect(src.get()).toBe("online"); // still <60s idle

    src.advanceTime(40_000); // total 70s idle → afk
    expect(src.get()).toBe("afk");

    src.advanceTime(240_000); // total 310s idle → offline
    expect(src.get()).toBe("offline");
  });

  it("fires compute at each tick boundary (not only on activity)", () => {
    let computeCalls = 0;
    const src = new MockDerivedSource<number>({
      initial: 0,
      compute: () => {
        computeCalls++;
        return computeCalls;
      },
      tickMs: 1000,
    });
    src.advanceTime(5000);
    // Five tick boundaries crossed → five computes.
    expect(computeCalls).toBe(5);
    expect(src.get()).toBe(5);
  });
});

describe("MockDerivedSource — set()", () => {
  it("set() directly pushes a value and notifies", () => {
    const src = new MockDerivedSource<Status>({
      initial: "offline" as Status,
    });
    const received: Status[] = [];
    src.subscribe(() => {
      received.push(src.get());
    });
    src.set("online");
    expect(received).toEqual(["online"]);
  });
});

describe("Multi-instance leader election (simulated)", () => {
  // Simulate two tabs on the same `key`. Only the first registered drives
  // compute; the second is a follower that receives pushed values.
  class FakeLeaderRegistry {
    private leaders = new Map<string, MockDerivedSource<unknown>>();

    register<T>(key: string, src: MockDerivedSource<T>): boolean {
      if (this.leaders.has(key)) return false;
      this.leaders.set(key, src as MockDerivedSource<unknown>);
      return true;
    }
  }

  it("only the leader source drives recomputes", () => {
    const registry = new FakeLeaderRegistry();
    const a = new MockDerivedSource<Status>({
      initial: "offline",
      compute: presenceCompute,
      tickMs: 1000,
    });
    const b = new MockDerivedSource<Status>({
      initial: "offline",
      compute: presenceCompute,
      tickMs: 1000,
    });

    const aIsLeader = registry.register("presence:u1", a);
    const bIsLeader = registry.register("presence:u1", b);

    expect(aIsLeader).toBe(true);
    expect(bIsLeader).toBe(false);

    // Leader drives compute on activity; follower only receives pushed values.
    a.activity();
    expect(a.get()).toBe("online");
    expect(b.get()).toBe("offline");

    // Simulated broadcast: leader pushes its value to the follower.
    b.set(a.get());
    expect(b.get()).toBe("online");
  });
});

describe("createDerivedSource — SSR safety", () => {
  it("does not throw when constructed without a window", () => {
    // `window` is not defined in the bun:test Node environment by default.
    // This call exercises the `typeof window === "undefined"` branch.
    const source = createDerivedSource<Status>({
      key: "presence:u-ssr",
      initial: "offline",
      activityEvents: ["mousemove"],
      compute: presenceCompute,
      tickMs: 1000,
    });
    expect(source.mock.get()).toBe("offline");
    expect(typeof source.hook).toBe("function");
  });
});
