// Unit tests for the subscribeToListEvents generator — specifically the
// authz-cascade auto-close branch (C2 in the code review). Uses
// MemoryChannelFactory so no Redis round-trip is involved.

import { describe, expect, it } from "bun:test";
import { MemoryChannelFactory } from "@project/realtime/memory";
import {
  listChannelKey,
  subscribeToListEvents,
  type TodoListEvent,
  type TodoWithList,
} from "../events.js";

// Helper: let the event loop run enough iterations for the generator's
// internal `await ch.subscribe(...)` to complete before we publish.
// Bun's microtasks resolve before a 0-ms setTimeout, so this is a safe
// way to drain pending microtasks without guessing a timeout.
function tick(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

const stubTodo: TodoWithList = {
  id: "T1",
  title: "x",
  completed: false,
  position: 0,
  userId: "u1",
  todoListId: "L",
  createdAt: new Date(0),
  updatedAt: new Date(0),
  todoList: {
    id: "L",
    name: "list",
    color: "#6366f1",
    userId: "u1",
    createdAt: new Date(0),
    updatedAt: new Date(0),
  },
};

describe("subscribeToListEvents", () => {
  it("yields published events in order", async () => {
    const factory = new MemoryChannelFactory();
    const ch = factory.channel<TodoListEvent>(
      listChannelKey(`t-${Date.now()}`),
    );
    const gen = subscribeToListEvents(ch, "viewer-1");

    // Start first pull — subscribes and awaits. Drain microtasks so the
    // `await ch.subscribe(...)` resolves before we publish.
    const firstPromise = gen.next();
    await tick();

    await ch.publish({ kind: "todo-list-updated", listId: "L" });
    const first = await firstPromise;
    expect(first.done).toBe(false);
    expect(first.value).toEqual({ kind: "todo-list-updated", listId: "L" });

    const secondPromise = gen.next();
    await tick();
    await ch.publish({ kind: "todo-updated", listId: "L", todo: stubTodo });
    const second = await secondPromise;
    expect(second.value).toEqual({
      kind: "todo-updated",
      listId: "L",
      todo: stubTodo,
    });

    await gen.return(undefined);
    await factory.closeAll();
  });

  it("auto-closes when collaborator-removed names the viewer", async () => {
    const factory = new MemoryChannelFactory();
    const ch = factory.channel<TodoListEvent>(
      listChannelKey(`t-${Date.now()}-cascade`),
    );
    const gen = subscribeToListEvents(ch, "viewer-2");

    // Irrelevant removal (different user) should NOT close the stream.
    const firstPromise = gen.next();
    await tick();
    await ch.publish({
      kind: "todo-list-collaborator-removed",
      listId: "L",
      userId: "someone-else",
    });
    const first = await firstPromise;
    expect(first.done).toBe(false);
    expect(first.value).toEqual({
      kind: "todo-list-collaborator-removed",
      listId: "L",
      userId: "someone-else",
    });

    // Viewer's own removal — stream yields the event, THEN closes.
    const secondPromise = gen.next();
    await tick();
    await ch.publish({
      kind: "todo-list-collaborator-removed",
      listId: "L",
      userId: "viewer-2",
    });
    const second = await secondPromise;
    expect(second.done).toBe(false);
    expect(second.value).toEqual({
      kind: "todo-list-collaborator-removed",
      listId: "L",
      userId: "viewer-2",
    });

    const third = await gen.next();
    expect(third.done).toBe(true);

    await factory.closeAll();
  });

  it("closes when abort signal fires", async () => {
    const factory = new MemoryChannelFactory();
    const ch = factory.channel<TodoListEvent>(
      listChannelKey(`t-${Date.now()}-abort`),
    );
    const controller = new AbortController();
    const gen = subscribeToListEvents(ch, "viewer-3", controller.signal);

    // Start a pull, then abort before any event arrives.
    const pending = gen.next();
    await tick();
    controller.abort();
    const result = await pending;
    expect(result.done).toBe(true);

    await factory.closeAll();
  });
});
