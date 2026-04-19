import { describe, expect, it } from "bun:test";
import { MemoryChannelFactory } from "../memory-channel.js";
import {
  fanOutToMembers,
  publishToUserInbox,
  userInboxChannelKey,
} from "../user-inbox.js";

describe("userInboxChannelKey", () => {
  it("returns user:<id> form", () => {
    expect(userInboxChannelKey("u_123")).toBe("user:u_123");
  });
});

describe("publishToUserInbox", () => {
  it("publishes the event to exactly one user channel", async () => {
    type Ev = { kind: "x"; v: number };
    const factory = new MemoryChannelFactory();
    const received: Ev[] = [];
    const unsub = await factory
      .channel<Ev>(userInboxChannelKey("alice"))
      .subscribe((e) => received.push(e));

    await publishToUserInbox(factory, "alice", { kind: "x", v: 1 });

    unsub();
    await factory.closeAll();
    expect(received).toEqual([{ kind: "x", v: 1 }]);
  });
});

describe("fanOutToMembers", () => {
  it("publishes to each user's inbox, deduplicates", async () => {
    type Ev = { kind: "y"; v: number };
    const factory = new MemoryChannelFactory();
    const a: Ev[] = [];
    const b: Ev[] = [];
    const unsubA = await factory
      .channel<Ev>(userInboxChannelKey("alice"))
      .subscribe((e) => a.push(e));
    const unsubB = await factory
      .channel<Ev>(userInboxChannelKey("bob"))
      .subscribe((e) => b.push(e));

    await fanOutToMembers(factory, ["alice", "bob", "alice"], {
      kind: "y",
      v: 42,
    });

    unsubA();
    unsubB();
    await factory.closeAll();
    expect(a).toEqual([{ kind: "y", v: 42 }]);
    expect(b).toEqual([{ kind: "y", v: 42 }]);
  });

  it("is a no-op for empty recipient list", async () => {
    const factory = new MemoryChannelFactory();
    await fanOutToMembers(factory, [], { kind: "y", v: 0 });
    await factory.closeAll();
    // No throw = pass
  });
});
