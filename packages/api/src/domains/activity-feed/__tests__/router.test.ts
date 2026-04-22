import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { db } from "@project/db";
import { createContext } from "../../../context.js";
import { appRouter } from "../../../router.js";
import type { ActivityEventPayload } from "../events.js";

const ALICE_ID = "test-user-activity-router-alice";
const BOB_ID = "test-user-activity-router-bob";

function buildSession(userId: string, email: string, username: string) {
  const user = {
    id: userId,
    name: username,
    email,
    username,
    role: "user",
    emailVerified: false,
    image: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  return {
    user,
    session: {
      id: `test-session-${userId}`,
      token: `test-token-${userId}`,
      userId,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      ipAddress: null,
      userAgent: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  };
}

async function callerFor(userId: string, email: string, username: string) {
  const ctx = await createContext({
    session: buildSession(userId, email, username),
  });
  return appRouter.createCaller(ctx);
}

let LIST_ID: string;

beforeAll(async () => {
  await db.activityEvent.deleteMany({
    where: { actorId: { in: [ALICE_ID, BOB_ID] } },
  });
  await db.todoList.deleteMany({
    where: { userId: { in: [ALICE_ID, BOB_ID] } },
  });
  await db.user.deleteMany({ where: { id: { in: [ALICE_ID, BOB_ID] } } });
  await db.user.createMany({
    data: [
      {
        id: ALICE_ID,
        name: "Alice",
        email: "activity-router-alice@example.com",
        username: "activity-router-alice",
        emailVerified: false,
      },
      {
        id: BOB_ID,
        name: "Bob",
        email: "activity-router-bob@example.com",
        username: "activity-router-bob",
        emailVerified: false,
      },
    ],
  });
  const list = await db.todoList.create({
    data: { name: "Activity Router List", userId: ALICE_ID },
  });
  LIST_ID = list.id;

  // Seed 3 activity events (newest last).
  for (let i = 0; i < 3; i++) {
    const payload: ActivityEventPayload = {
      kind: "todo-created",
      todoId: `t-${i}`,
      title: `todo ${i}`,
    };
    await db.activityEvent.create({
      data: {
        todoListId: LIST_ID,
        actorId: ALICE_ID,
        kind: "todo-created",
        payload,
      },
    });
  }
});

afterAll(async () => {
  await db.activityEvent.deleteMany({ where: { todoListId: LIST_ID } });
  await db.todoList.deleteMany({
    where: { userId: { in: [ALICE_ID, BOB_ID] } },
  });
  await db.user.deleteMany({ where: { id: { in: [ALICE_ID, BOB_ID] } } });
  await db.$disconnect();
});

describe("activity router (integration)", () => {
  it("activity.list returns events newest-first for a member", async () => {
    const caller = await callerFor(
      ALICE_ID,
      "activity-router-alice@example.com",
      "activity-router-alice",
    );
    const result = await caller.activity.list({ todoListId: LIST_ID });
    expect(result.items).toHaveLength(3);
    // Newest-first: ids sorted desc.
    const ids = result.items.map((e) => e.id);
    const sorted = [...ids].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
    expect(ids).toEqual(sorted);
  });

  it("activity.list throws FORBIDDEN for non-member", async () => {
    const caller = await callerFor(
      BOB_ID,
      "activity-router-bob@example.com",
      "activity-router-bob",
    );
    await expect(caller.activity.list({ todoListId: LIST_ID })).rejects.toThrow(
      "FORBIDDEN",
    );
  });
});
