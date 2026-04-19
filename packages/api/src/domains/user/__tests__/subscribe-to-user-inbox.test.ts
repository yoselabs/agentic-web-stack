import { describe, expect, it } from "bun:test";
import { MemoryChannelFactory } from "@project/realtime/memory";
import { userInboxChannelKey } from "@project/realtime/user-inbox";
import { subscribeToUserInbox } from "../subscribe-to-user-inbox.js";
import type { UserInboxEvent } from "../user-events.js";

describe("subscribeToUserInbox", () => {
  it("yields events published on the user channel", async () => {
    const factory = new MemoryChannelFactory();
    const ch = factory.channel<UserInboxEvent>(userInboxChannelKey("alice"));
    const controller = new AbortController();
    const gen = subscribeToUserInbox(ch, controller.signal);

    queueMicrotask(() => {
      void ch.publish({ kind: "todo-list-counters-changed", listId: "L1" });
    });

    const first = await gen.next();
    expect(first.done).toBe(false);
    expect(first.value).toEqual({
      kind: "todo-list-counters-changed",
      listId: "L1",
    });

    controller.abort();
    await gen.return(undefined);
    await factory.closeAll();
  });

  it("honors AbortSignal — generator returns when aborted", async () => {
    const factory = new MemoryChannelFactory();
    const ch = factory.channel<UserInboxEvent>(userInboxChannelKey("bob"));
    const controller = new AbortController();
    const gen = subscribeToUserInbox(ch, controller.signal);

    const nextP = gen.next();
    controller.abort();
    const result = await nextP;
    expect(result.done).toBe(true);

    await factory.closeAll();
  });
});
