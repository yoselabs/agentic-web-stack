import { db } from "@project/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createGroupRoom,
  dmFindOrCreate,
  getRoom,
  inviteToRoom,
  leaveRoom,
  listMessages,
  listMyRooms,
  markRead,
  messagesSince,
  requireMembership,
  sendTextMessage,
} from "../service.js";

const U1 = "chat-test-u1";
const U2 = "chat-test-u2";
const U3 = "chat-test-u3";

beforeAll(async () => {
  await db.chatMembership.deleteMany({
    where: { userId: { in: [U1, U2, U3] } },
  });
  await db.chatRoom.deleteMany({
    where: { memberships: { some: { userId: { in: [U1, U2, U3] } } } },
  });
  await db.user.deleteMany({ where: { id: { in: [U1, U2, U3] } } });
  await db.user.createMany({
    data: [
      {
        id: U1,
        name: "U1",
        email: "u1@test.com",
        username: "u1",
        emailVerified: false,
      },
      {
        id: U2,
        name: "U2",
        email: "u2@test.com",
        username: "u2",
        emailVerified: false,
      },
      {
        id: U3,
        name: "U3",
        email: "u3@test.com",
        username: "u3",
        emailVerified: false,
      },
    ],
  });
});

afterAll(async () => {
  await db.chatMembership.deleteMany({
    where: { userId: { in: [U1, U2, U3] } },
  });
  await db.chatMessage.deleteMany({ where: { userId: { in: [U1, U2, U3] } } });
  await db.chatRoom.deleteMany({
    where: { memberships: { some: { userId: { in: [U1, U2, U3] } } } },
  });
  await db.user.deleteMany({ where: { id: { in: [U1, U2, U3] } } });
  await db.$disconnect();
});

describe("createGroupRoom", () => {
  it("creates room with creator + members, name present", async () => {
    const room = await db.$transaction((tx) =>
      createGroupRoom(tx, U1, "my-group", [U2, U3]),
    );
    expect(room.name).toBe("my-group");
    const memberIds = await db.chatMembership.findMany({
      where: { roomId: room.id },
      select: { userId: true },
    });
    expect(memberIds.map((m) => m.userId).sort()).toEqual([U1, U2, U3].sort());
  });

  it("rejects empty memberIds", async () => {
    await expect(
      db.$transaction((tx) => createGroupRoom(tx, U1, "x", [])),
    ).rejects.toThrow();
  });
});

describe("dmFindOrCreate", () => {
  it("creates a DM with both members and a sorted dmKey", async () => {
    const room = await db.$transaction((tx) => dmFindOrCreate(tx, U1, U2));
    expect(room.name).toBeNull();
    expect(room.dmKey).toBe([U1, U2].sort().join(":"));
    const members = await db.chatMembership.findMany({
      where: { roomId: room.id },
    });
    expect(members.map((m) => m.userId).sort()).toEqual([U1, U2].sort());
  });

  it("returns the same room for both call directions", async () => {
    const a = await db.$transaction((tx) => dmFindOrCreate(tx, U1, U2));
    const b = await db.$transaction((tx) => dmFindOrCreate(tx, U2, U1));
    expect(a.id).toBe(b.id);
  });
});

describe("requireMembership", () => {
  it("throws when user is not a member", async () => {
    const room = await db.$transaction((tx) =>
      createGroupRoom(tx, U1, "g2", [U2]),
    );
    await expect(requireMembership(db, U3, room.id)).rejects.toThrow();
  });

  it("resolves when user is a member", async () => {
    const room = await db.$transaction((tx) =>
      createGroupRoom(tx, U1, "g3", [U2]),
    );
    await expect(requireMembership(db, U1, room.id)).resolves.toBeUndefined();
  });
});

describe("inviteToRoom", () => {
  it("adds a member when caller is a member", async () => {
    const room = await db.$transaction((tx) =>
      createGroupRoom(tx, U1, "g4", [U2]),
    );
    await db.$transaction((tx) => inviteToRoom(tx, U1, room.id, U3));
    const members = await db.chatMembership.findMany({
      where: { roomId: room.id },
    });
    expect(members.some((m) => m.userId === U3)).toBe(true);
  });

  it("rejects when caller is not a member", async () => {
    const room = await db.$transaction((tx) =>
      createGroupRoom(tx, U1, "g5", [U2]),
    );
    await expect(
      db.$transaction((tx) => inviteToRoom(tx, U3, room.id, U1)),
    ).rejects.toThrow();
  });
});

describe("leaveRoom", () => {
  it("removes caller's membership", async () => {
    const room = await db.$transaction((tx) =>
      createGroupRoom(tx, U1, "g6", [U2]),
    );
    await db.$transaction((tx) => leaveRoom(tx, U2, room.id));
    const members = await db.chatMembership.findMany({
      where: { roomId: room.id },
    });
    expect(members.map((m) => m.userId)).toEqual([U1]);
  });
});

describe("listMyRooms + getRoom", () => {
  it("listMyRooms returns only rooms the user belongs to", async () => {
    const r1 = await db.$transaction((tx) =>
      createGroupRoom(tx, U1, "mine-1", [U2]),
    );
    const r2 = await db.$transaction((tx) =>
      createGroupRoom(tx, U2, "not-mine", [U3]),
    );
    const mine = await listMyRooms(db, U1);
    expect(mine.some((r) => r.id === r1.id)).toBe(true);
    expect(mine.some((r) => r.id === r2.id)).toBe(false);
  });

  it("getRoom returns room + members for a member", async () => {
    const room = await db.$transaction((tx) =>
      createGroupRoom(tx, U1, "deet", [U2]),
    );
    const got = await getRoom(db, U1, room.id);
    expect(got?.id).toBe(room.id);
    expect(got?.memberships.length).toBe(2);
  });
});

describe("sendTextMessage + listMessages", () => {
  it("persists and returns messages newest-first", async () => {
    const room = await db.$transaction((tx) =>
      createGroupRoom(tx, U1, "m1", [U2]),
    );
    const a = await db.$transaction((tx) =>
      sendTextMessage(tx, U1, room.id, "one"),
    );
    const b = await db.$transaction((tx) =>
      sendTextMessage(tx, U1, room.id, "two"),
    );
    const msgs = await listMessages(db, U1, room.id);
    expect(msgs.map((m) => m.id)).toEqual([b.id, a.id]);
  });

  it("rejects text send from non-member", async () => {
    const room = await db.$transaction((tx) =>
      createGroupRoom(tx, U1, "m2", [U2]),
    );
    await expect(
      db.$transaction((tx) => sendTextMessage(tx, U3, room.id, "hi")),
    ).rejects.toThrow();
  });
});

describe("messagesSince cursor", () => {
  it("returns only messages strictly after the cursor, ASC", async () => {
    const room = await db.$transaction((tx) =>
      createGroupRoom(tx, U1, "m3", [U2]),
    );
    const a = await db.$transaction((tx) =>
      sendTextMessage(tx, U1, room.id, "a"),
    );
    const b = await db.$transaction((tx) =>
      sendTextMessage(tx, U1, room.id, "b"),
    );
    const c = await db.$transaction((tx) =>
      sendTextMessage(tx, U1, room.id, "c"),
    );
    const since = await messagesSince(db, U1, room.id, {
      createdAt: a.createdAt,
      id: a.id,
    });
    expect(since.map((m) => m.id)).toEqual([b.id, c.id]);
  });
});

describe("markRead", () => {
  it("updates lastReadAt for the membership", async () => {
    const room = await db.$transaction((tx) =>
      createGroupRoom(tx, U1, "m4", [U2]),
    );
    const m = await db.$transaction((tx) =>
      sendTextMessage(tx, U2, room.id, "hello"),
    );
    await db.$transaction((tx) => markRead(tx, U1, room.id, m.id));
    const updated = await db.chatMembership.findUnique({
      where: { roomId_userId: { roomId: room.id, userId: U1 } },
    });
    expect(updated?.lastReadAt?.getTime()).toBeGreaterThanOrEqual(
      m.createdAt.getTime(),
    );
  });
});
