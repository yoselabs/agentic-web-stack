import { db } from "@project/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createContext } from "../../../context.js";
import { appRouter } from "../../../router.js";

const U = "chat-router-test-u1";
const U2 = "chat-router-test-u2";

beforeAll(async () => {
  await db.user.deleteMany({ where: { id: { in: [U, U2] } } });
  await db.user.createMany({
    data: [
      {
        id: U,
        name: "U",
        email: "cru1@test.com",
        username: "cru1",
        emailVerified: false,
      },
      {
        id: U2,
        name: "U2",
        email: "cru2@test.com",
        username: "cru2",
        emailVerified: false,
      },
    ],
  });
});

afterAll(async () => {
  await db.chatMembership.deleteMany({ where: { userId: { in: [U, U2] } } });
  await db.chatRoom.deleteMany({
    where: { memberships: { some: { userId: { in: [U, U2] } } } },
  });
  await db.user.deleteMany({ where: { id: { in: [U, U2] } } });
  await db.$disconnect();
});

function callerFor(userId: string) {
  return appRouter.createCaller(
    // Minimal session shape — protectedProcedure only needs session.user.id.
    { db, session: { user: { id: userId } } } as never,
  );
}

describe("chat router — auth", () => {
  it("unauthenticated listMine throws UNAUTHORIZED", async () => {
    const caller = appRouter.createCaller({ db, session: null } as never);
    await expect(caller.chat.rooms.listMine()).rejects.toThrow();
  });
});

describe("chat router — rooms", () => {
  it("createGroup + listMine round-trip", async () => {
    const c = callerFor(U);
    const room = await c.chat.rooms.createGroup({
      name: "rt-g",
      memberIds: [U2],
    });
    const mine = await c.chat.rooms.listMine();
    expect(mine.some((r) => r.id === room.id)).toBe(true);
  });

  it("dmFindOrCreate is idempotent across callers", async () => {
    const a = await callerFor(U).chat.rooms.dmFindOrCreate({ otherUserId: U2 });
    const b = await callerFor(U2).chat.rooms.dmFindOrCreate({ otherUserId: U });
    expect(a.id).toBe(b.id);
  });
});

describe("chat router — messages", () => {
  it("sendText then list returns the new message", async () => {
    const c = callerFor(U);
    const room = await c.chat.rooms.createGroup({
      name: "rt-m",
      memberIds: [U2],
    });
    await c.chat.messages.sendText({ roomId: room.id, text: "hi" });
    const msgs = await c.chat.messages.list({ roomId: room.id });
    expect(msgs[0]?.text).toBe("hi");
  });
});
