import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "bun:test";
import {
  acceptInvite,
  deleteTodoList,
  inviteCollaborator,
  removeCollaborator,
} from "@project/api/domains/todo-list/service";
import { createTodo } from "@project/api/domains/todo-list/todo-service";
import { db } from "@project/db";
import { MemoryChannelFactory } from "@project/realtime/memory";
import { userInboxChannelKey } from "@project/realtime/user-inbox";
import type { UserInboxEvent } from "../user-events.js";

describe("user-inbox publish assertions", () => {
  const OWNER_ID = "test-owner-inbox";
  const COLLAB_ID = "test-collab-inbox";
  const OTHER_ID = "test-other-inbox";
  let sharedListId: string;

  beforeAll(async () => {
    await db.user.deleteMany({
      where: { id: { in: [OWNER_ID, COLLAB_ID, OTHER_ID] } },
    });
    await db.user.createMany({
      data: [
        {
          id: OWNER_ID,
          name: "Owner",
          email: "owner-inbox@example.com",
          username: "owner-inbox",
          emailVerified: false,
        },
        {
          id: COLLAB_ID,
          name: "Collab",
          email: "collab-inbox@example.com",
          username: "collab-inbox",
          emailVerified: false,
        },
        {
          id: OTHER_ID,
          name: "Other",
          email: "other-inbox@example.com",
          username: "other-inbox",
          emailVerified: false,
        },
      ],
    });
  });

  beforeEach(async () => {
    const list = await db.todoList.create({
      data: { name: "Inbox Test List", userId: OWNER_ID },
    });
    sharedListId = list.id;
    await db.todoListMembership.create({
      data: {
        userId: COLLAB_ID,
        todoListId: sharedListId,
        role: "collaborator",
      },
    });
  });

  afterEach(async () => {
    await db.todoListInvite.deleteMany({ where: { todoListId: sharedListId } });
    await db.todo.deleteMany({ where: { todoListId: sharedListId } });
    await db.todoListMembership.deleteMany({
      where: { todoListId: sharedListId },
    });
    await db.todoList.deleteMany({ where: { id: sharedListId } });
  });

  afterAll(async () => {
    await db.user.deleteMany({
      where: { id: { in: [OWNER_ID, COLLAB_ID, OTHER_ID] } },
    });
    await db.$disconnect();
  });

  function subscribe(factory: MemoryChannelFactory, userId: string) {
    const received: UserInboxEvent[] = [];
    const unsubP = factory
      .channel<UserInboxEvent>(userInboxChannelKey(userId))
      .subscribe((e) => received.push(e));
    return { received, unsubP };
  }

  it("createTodo fans out todo-list-counters-changed to all members", async () => {
    const factory = new MemoryChannelFactory();
    const owner = subscribe(factory, OWNER_ID);
    const collab = subscribe(factory, COLLAB_ID);
    const other = subscribe(factory, OTHER_ID);
    const unsubs = await Promise.all([
      owner.unsubP,
      collab.unsubP,
      other.unsubP,
    ]);

    await db.$transaction((tx) =>
      createTodo(tx, OWNER_ID, "One", sharedListId, {
        channel: (k) => factory.channel(k),
        userInboxChannel: (k) => factory.channel(k),
      }),
    );

    for (const u of unsubs) u();
    await factory.closeAll();
    expect(owner.received).toEqual([
      { kind: "todo-list-counters-changed", listId: sharedListId },
    ]);
    expect(collab.received).toEqual([
      { kind: "todo-list-counters-changed", listId: sharedListId },
    ]);
    expect(other.received).toEqual([]); // non-member gets nothing
  });

  it("inviteCollaborator publishes todo-list-invites-changed to invitee only", async () => {
    const factory = new MemoryChannelFactory();
    const owner = subscribe(factory, OWNER_ID);
    const other = subscribe(factory, OTHER_ID);
    const unsubs = await Promise.all([owner.unsubP, other.unsubP]);

    // inviteCollaborator does not publish to the list channel; only
    // userInboxChannel override is required here.
    await db.$transaction((tx) =>
      inviteCollaborator(tx, OWNER_ID, sharedListId, "other-inbox", {
        userInboxChannel: (k) => factory.channel(k),
      }),
    );

    for (const u of unsubs) u();
    await factory.closeAll();
    expect(owner.received).toEqual([]);
    expect(other.received).toEqual([
      { kind: "todo-list-invites-changed", listId: sharedListId },
    ]);
  });

  it("removeCollaborator publishes todo-list-access-revoked to removed user", async () => {
    const factory = new MemoryChannelFactory();
    const owner = subscribe(factory, OWNER_ID);
    const collab = subscribe(factory, COLLAB_ID);
    const unsubs = await Promise.all([owner.unsubP, collab.unsubP]);

    await db.$transaction((tx) =>
      removeCollaborator(tx, OWNER_ID, sharedListId, COLLAB_ID, {
        channel: (k) => factory.channel(k),
        userInboxChannel: (k) => factory.channel(k),
      }),
    );

    for (const u of unsubs) u();
    await factory.closeAll();
    expect(owner.received).toEqual([]);
    expect(collab.received).toEqual([
      { kind: "todo-list-access-revoked", listId: sharedListId },
    ]);
  });

  it("deleteTodoList publishes access-revoked to every member except deleter", async () => {
    const factory = new MemoryChannelFactory();
    const owner = subscribe(factory, OWNER_ID);
    const collab = subscribe(factory, COLLAB_ID);
    const unsubs = await Promise.all([owner.unsubP, collab.unsubP]);

    await db.$transaction((tx) =>
      deleteTodoList(tx, OWNER_ID, sharedListId, {
        userInboxChannel: (k) => factory.channel(k),
      }),
    );

    for (const u of unsubs) u();
    await factory.closeAll();
    expect(owner.received).toEqual([]); // owner is the deleter
    expect(collab.received).toEqual([
      { kind: "todo-list-access-revoked", listId: sharedListId },
    ]);
  });

  it("acceptInvite publishes access-granted to all members AND invites-changed to owner", async () => {
    // Create an invite for OTHER_ID
    const invite = await db.$transaction((tx) =>
      inviteCollaborator(tx, OWNER_ID, sharedListId, "other-inbox"),
    );

    const factory = new MemoryChannelFactory();
    const owner = subscribe(factory, OWNER_ID);
    const collab = subscribe(factory, COLLAB_ID);
    const other = subscribe(factory, OTHER_ID);
    const unsubs = await Promise.all([
      owner.unsubP,
      collab.unsubP,
      other.unsubP,
    ]);

    await db.$transaction((tx) =>
      acceptInvite(tx, OTHER_ID, invite.invite.token, {
        channel: (k) => factory.channel(k),
        userInboxChannel: (k) => factory.channel(k),
      }),
    );

    for (const u of unsubs) u();
    await factory.closeAll();

    // Everyone (owner + existing collab + accepter) gets access-granted
    expect(
      owner.received.some(
        (e) =>
          e.kind === "todo-list-access-granted" && e.listId === sharedListId,
      ),
    ).toBe(true);
    expect(
      collab.received.some(
        (e) =>
          e.kind === "todo-list-access-granted" && e.listId === sharedListId,
      ),
    ).toBe(true);
    expect(
      other.received.some(
        (e) =>
          e.kind === "todo-list-access-granted" && e.listId === sharedListId,
      ),
    ).toBe(true);
    // Owner ALSO gets invites-changed (their pending-invites list changed)
    expect(
      owner.received.some(
        (e) =>
          e.kind === "todo-list-invites-changed" && e.listId === sharedListId,
      ),
    ).toBe(true);
  });
});
