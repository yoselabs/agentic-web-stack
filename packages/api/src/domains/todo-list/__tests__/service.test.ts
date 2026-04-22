import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "bun:test";
import { db } from "@project/db";
import { MemoryChannelFactory } from "@project/realtime/memory";
import { TRPCError } from "@trpc/server";
import { listChannelKey } from "../events.js";
import {
  acceptInvite,
  createTodoList,
  deleteExpiredInvites,
  deleteTodoList,
  getTodoList,
  inviteCollaborator,
  listAccessibleTodoLists,
  listTodoLists,
  removeCollaborator,
} from "../service.js";

const TEST_USER_ID = "test-user-todolist-service";
const createdListIds: string[] = [];

beforeAll(async () => {
  await db.todoList.deleteMany({ where: { userId: TEST_USER_ID } });
  await db.todo.deleteMany({ where: { userId: TEST_USER_ID } });
  await db.user.deleteMany({ where: { id: TEST_USER_ID } });
  await db.user.create({
    data: {
      id: TEST_USER_ID,
      name: "TodoList Test User",
      email: "test-todolist-service@example.com",
      username: "test-todolist-service",
      emailVerified: false,
    },
  });
});

afterEach(async () => {
  if (createdListIds.length > 0) {
    await db.todoList.deleteMany({
      where: { id: { in: createdListIds } },
    });
    createdListIds.length = 0;
  }
});

afterAll(async () => {
  await db.todoList.deleteMany({ where: { userId: TEST_USER_ID } });
  await db.user.delete({ where: { id: TEST_USER_ID } }).catch(() => {});
  await db.$disconnect();
});

describe("todo-list service", () => {
  it("lists todo lists (empty)", async () => {
    const lists = await listTodoLists(db, TEST_USER_ID);
    expect(lists).toEqual([]);
  });

  it("creates a todo list", async () => {
    const list = await createTodoList(db, TEST_USER_ID, "Groceries");
    createdListIds.push(list.id);
    expect(list.name).toBe("Groceries");
    expect(list.color).toBe("#6366f1");
    expect(list.userId).toBe(TEST_USER_ID);
  });

  it("creates a todo list with custom color", async () => {
    const list = await createTodoList(db, TEST_USER_ID, "Work", "#ef4444");
    createdListIds.push(list.id);
    expect(list.color).toBe("#ef4444");
  });

  it("gets a todo list by id", async () => {
    const created = await createTodoList(db, TEST_USER_ID, "Get Test");
    createdListIds.push(created.id);
    const found = await getTodoList(db, TEST_USER_ID, created.id);
    expect(found.name).toBe("Get Test");
  });

  it("deletes a todo list", async () => {
    const list = await createTodoList(db, TEST_USER_ID, "To Delete");
    await deleteTodoList(db, TEST_USER_ID, list.id);
    const lists = await listTodoLists(db, TEST_USER_ID);
    expect(lists.find((l) => l.id === list.id)).toBeUndefined();
  });

  it("includes todo count in list", async () => {
    const list = await createTodoList(db, TEST_USER_ID, "With Todos");
    createdListIds.push(list.id);
    await db.todo.create({
      data: { title: "Task 1", userId: TEST_USER_ID, todoListId: list.id },
    });
    await db.todo.create({
      data: { title: "Task 2", userId: TEST_USER_ID, todoListId: list.id },
    });

    const lists = await listTodoLists(db, TEST_USER_ID);
    const found = lists.find((l) => l.id === list.id);
    expect(found?._count.todos).toBe(2);
  });
});

describe("collaborator lifecycle", () => {
  const OWNER_ID = "test-owner-collab";
  const INVITEE_ID = "test-invitee-collab";
  let listId: string;

  beforeAll(async () => {
    await db.user.deleteMany({
      where: { id: { in: [OWNER_ID, INVITEE_ID] } },
    });
    await db.user.createMany({
      data: [
        {
          id: OWNER_ID,
          name: "Owner",
          email: "owner-collab@example.com",
          username: "owner-collab",
          emailVerified: true,
        },
        {
          id: INVITEE_ID,
          name: "Invitee",
          email: "invitee-collab@example.com",
          username: "invitee-collab",
          emailVerified: true,
        },
      ],
    });
  });

  beforeEach(async () => {
    const list = await db.todoList.create({
      data: { name: "Shared", userId: OWNER_ID },
    });
    listId = list.id;
  });

  afterEach(async () => {
    await db.todoListInvite.deleteMany({ where: { todoListId: listId } });
    await db.todoListMembership.deleteMany({
      where: { todoListId: listId },
    });
    await db.todoList.deleteMany({ where: { id: listId } });
  });

  afterAll(async () => {
    await db.user.deleteMany({
      where: { id: { in: [OWNER_ID, INVITEE_ID] } },
    });
  });

  it("invite creates TodoListInvite with 7-day expiry", async () => {
    await db.$transaction(async (tx) => {
      const result = await inviteCollaborator(
        tx,
        OWNER_ID,
        listId,
        "invitee-collab",
      );
      expect(result.invite.invitedUserId).toBe(INVITEE_ID);
      expect(result.invite.todoListId).toBe(listId);
      expect(result.invite.expiresAt.getTime()).toBeGreaterThan(Date.now());
      expect(result.inviteeEmail).toBe("invitee-collab@example.com");
      expect(result.inviterName).toBe("Owner");
      expect(result.listName).toBe("Shared");
    });
  });

  it("invite with unknown username throws", async () => {
    await expect(
      db.$transaction((tx) =>
        inviteCollaborator(tx, OWNER_ID, listId, "ghost"),
      ),
    ).rejects.toThrow(/ghost/);
  });

  it("accept consumes invite and creates membership; publishes event", async () => {
    const factory = new MemoryChannelFactory();
    let received: unknown = null;
    const unsub = await factory
      .channel(listChannelKey(listId))
      .subscribe((e) => {
        received = e;
      });

    const result = await db.$transaction((tx) =>
      inviteCollaborator(tx, OWNER_ID, listId, "invitee-collab"),
    );
    await db.$transaction((tx) =>
      acceptInvite(tx, INVITEE_ID, result.invite.token, {
        channel: (k) => factory.channel(k),
      }),
    );

    const membership = await db.todoListMembership.findUnique({
      where: {
        userId_todoListId: { userId: INVITEE_ID, todoListId: listId },
      },
    });
    expect(membership).not.toBeNull();

    const remaining = await db.todoListInvite.findUnique({
      where: { id: result.invite.id },
    });
    expect(remaining).toBeNull();

    expect(received).toEqual({
      kind: "todo-list-collaborator-added",
      listId,
      userId: INVITEE_ID,
    });
    unsub();
    await factory.closeAll();
  });

  it("accept fails when invite is expired", async () => {
    const result = await db.$transaction((tx) =>
      inviteCollaborator(tx, OWNER_ID, listId, "invitee-collab", {
        nowMs: Date.now() - 10 * 86_400_000,
      }),
    );
    await expect(
      db.$transaction((tx) =>
        acceptInvite(tx, INVITEE_ID, result.invite.token),
      ),
    ).rejects.toThrow();
  });

  it("remove deletes membership and publishes event", async () => {
    const result = await db.$transaction((tx) =>
      inviteCollaborator(tx, OWNER_ID, listId, "invitee-collab"),
    );
    await db.$transaction((tx) =>
      acceptInvite(tx, INVITEE_ID, result.invite.token),
    );

    const factory = new MemoryChannelFactory();
    let received: unknown = null;
    const unsub = await factory
      .channel(listChannelKey(listId))
      .subscribe((e) => {
        received = e;
      });

    await db.$transaction((tx) =>
      removeCollaborator(tx, OWNER_ID, listId, INVITEE_ID, {
        channel: (k) => factory.channel(k),
      }),
    );

    const membership = await db.todoListMembership.findUnique({
      where: {
        userId_todoListId: { userId: INVITEE_ID, todoListId: listId },
      },
    });
    expect(membership).toBeNull();
    expect(received).toEqual({
      kind: "todo-list-collaborator-removed",
      listId,
      userId: INVITEE_ID,
    });
    unsub();
    await factory.closeAll();
  });

  it("acceptInvite emits a member-added activity event", async () => {
    const result = await db.$transaction((tx) =>
      inviteCollaborator(tx, OWNER_ID, listId, "invitee-collab"),
    );
    await db.$transaction((tx) =>
      acceptInvite(tx, INVITEE_ID, result.invite.token),
    );

    const events = await db.activityEvent.findMany({
      where: { todoListId: listId, kind: "member-added" },
      orderBy: { id: "desc" },
      take: 1,
    });
    expect(events[0]?.kind).toBe("member-added");
    expect(events[0]?.actorId).toBe(INVITEE_ID);
    expect(events[0]?.payload).toMatchObject({
      memberId: INVITEE_ID,
      memberName: "Invitee",
    });
  });

  it("removeCollaborator emits a member-removed activity event", async () => {
    const result = await db.$transaction((tx) =>
      inviteCollaborator(tx, OWNER_ID, listId, "invitee-collab"),
    );
    await db.$transaction((tx) =>
      acceptInvite(tx, INVITEE_ID, result.invite.token),
    );

    await db.$transaction((tx) =>
      removeCollaborator(tx, OWNER_ID, listId, INVITEE_ID),
    );

    const events = await db.activityEvent.findMany({
      where: { todoListId: listId, kind: "member-removed" },
      orderBy: { id: "desc" },
      take: 1,
    });
    expect(events[0]?.kind).toBe("member-removed");
    expect(events[0]?.actorId).toBe(OWNER_ID);
    expect(events[0]?.payload).toMatchObject({
      memberId: INVITEE_ID,
      memberName: "Invitee",
    });
  });

  it("listAccessibleTodoLists returns owner's + collaborator's lists", async () => {
    const result = await db.$transaction((tx) =>
      inviteCollaborator(tx, OWNER_ID, listId, "invitee-collab"),
    );
    await db.$transaction((tx) =>
      acceptInvite(tx, INVITEE_ID, result.invite.token),
    );

    const ownerLists = await listAccessibleTodoLists(db, OWNER_ID);
    expect(ownerLists.find((l) => l.id === listId)).toBeTruthy();

    const inviteeLists = await listAccessibleTodoLists(db, INVITEE_ID);
    expect(inviteeLists.find((l) => l.id === listId)).toBeTruthy();
  });

  it("collaborator with accepted membership can getTodoList", async () => {
    await db.todoListMembership.create({
      data: {
        userId: INVITEE_ID,
        todoListId: listId,
        role: "collaborator",
      },
    });

    const found = await getTodoList(db, INVITEE_ID, listId);
    expect(found.id).toBe(listId);
    expect(found.name).toBe("Shared");
  });

  it("unrelated user calling getTodoList throws FORBIDDEN", async () => {
    const UNRELATED_ID = "test-unrelated-collab";
    await db.user.deleteMany({ where: { id: UNRELATED_ID } });
    await db.user.create({
      data: {
        id: UNRELATED_ID,
        name: "Unrelated",
        email: "unrelated-collab@example.com",
        username: "unrelated-collab",
        emailVerified: true,
      },
    });

    try {
      await expect(getTodoList(db, UNRELATED_ID, listId)).rejects.toThrow(
        TRPCError,
      );
      let caught: unknown;
      try {
        await getTodoList(db, UNRELATED_ID, listId);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(TRPCError);
      expect((caught as TRPCError).code).toBe("FORBIDDEN");
    } finally {
      await db.user.delete({ where: { id: UNRELATED_ID } }).catch(() => {});
    }
  });

  it("deleteExpiredInvites removes rows past retention window", async () => {
    await db.todoListInvite.create({
      data: {
        token: "old-invite-token",
        invitedUserId: INVITEE_ID,
        todoListId: listId,
        expiresAt: new Date(Date.now() - 31 * 86_400_000),
      },
    });

    await db.todoListInvite.create({
      data: {
        token: "recent-invite-token",
        invitedUserId: INVITEE_ID,
        todoListId: listId,
        expiresAt: new Date(Date.now() - 1 * 86_400_000),
      },
    });

    const deleted = await db.$transaction((tx) => deleteExpiredInvites(tx));
    expect(deleted).toBe(1);

    const remaining = await db.todoListInvite.findMany({
      where: { todoListId: listId },
    });
    expect(remaining.map((i) => i.token)).toEqual(["recent-invite-token"]);
  });
});
