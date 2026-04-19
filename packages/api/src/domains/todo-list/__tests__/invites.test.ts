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
import { TRPCError } from "@trpc/server";
import {
  declineInvite,
  inviteCollaborator,
  listMyPendingInvites,
  listPendingInvitesForList,
  revokeInvite,
} from "../service.js";

describe("invite service", () => {
  const OWNER_ID = "test-owner-inv";
  const INVITEE_ID = "test-invitee-inv";
  const OTHER_ID = "test-other-inv";
  let listId: string;

  beforeAll(async () => {
    await db.user.deleteMany({
      where: { id: { in: [OWNER_ID, INVITEE_ID, OTHER_ID] } },
    });
    await db.user.createMany({
      data: [
        {
          id: OWNER_ID,
          name: "Owner",
          email: "owner-inv@example.com",
          username: "owner-inv",
          emailVerified: false,
        },
        {
          id: INVITEE_ID,
          name: "Invitee",
          email: "invitee-inv@example.com",
          username: "invitee-inv",
          emailVerified: false,
        },
        {
          id: OTHER_ID,
          name: "Other",
          email: "other-inv@example.com",
          username: "other-inv",
          emailVerified: false,
        },
      ],
    });
  });

  beforeEach(async () => {
    const list = await db.todoList.create({
      data: { name: "Invite Svc", userId: OWNER_ID },
    });
    listId = list.id;
  });

  afterEach(async () => {
    await db.todoListInvite.deleteMany({ where: { todoListId: listId } });
    await db.todoListMembership.deleteMany({ where: { todoListId: listId } });
    await db.todoList.deleteMany({ where: { id: listId } });
  });

  afterAll(async () => {
    await db.user.deleteMany({
      where: { id: { in: [OWNER_ID, INVITEE_ID, OTHER_ID] } },
    });
    await db.$disconnect();
  });

  it("listMyPendingInvites returns invites addressed to the viewer, excludes expired", async () => {
    const inv = await db.$transaction((tx) =>
      inviteCollaborator(tx, OWNER_ID, listId, "invitee-inv"),
    );
    const rows = await listMyPendingInvites(db, INVITEE_ID);
    expect(rows.length).toBe(1);
    expect(rows[0]?.id).toBe(inv.invite.id);
    await db.todoListInvite.update({
      where: { id: inv.invite.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const after = await listMyPendingInvites(db, INVITEE_ID);
    expect(after).toEqual([]);
  });

  it("listPendingInvitesForList returns invites for an owned list; rejects non-owner", async () => {
    await db.$transaction((tx) =>
      inviteCollaborator(tx, OWNER_ID, listId, "invitee-inv"),
    );
    const rows = await listPendingInvitesForList(db, OWNER_ID, listId);
    expect(rows.length).toBe(1);
    await expect(
      listPendingInvitesForList(db, OTHER_ID, listId),
    ).rejects.toThrow(TRPCError);
  });

  it("declineInvite deletes the invite when called by invitee", async () => {
    const inv = await db.$transaction((tx) =>
      inviteCollaborator(tx, OWNER_ID, listId, "invitee-inv"),
    );
    await db.$transaction((tx) =>
      declineInvite(tx, INVITEE_ID, inv.invite.token),
    );
    expect(
      await db.todoListInvite.findUnique({ where: { id: inv.invite.id } }),
    ).toBeNull();
  });

  it("declineInvite rejects non-invitee", async () => {
    const inv = await db.$transaction((tx) =>
      inviteCollaborator(tx, OWNER_ID, listId, "invitee-inv"),
    );
    await expect(
      db.$transaction((tx) => declineInvite(tx, OTHER_ID, inv.invite.token)),
    ).rejects.toThrow(TRPCError);
  });

  it("revokeInvite deletes the invite when called by owner", async () => {
    const inv = await db.$transaction((tx) =>
      inviteCollaborator(tx, OWNER_ID, listId, "invitee-inv"),
    );
    await db.$transaction((tx) => revokeInvite(tx, OWNER_ID, inv.invite.id));
    expect(
      await db.todoListInvite.findUnique({ where: { id: inv.invite.id } }),
    ).toBeNull();
  });

  it("revokeInvite rejects non-owner", async () => {
    const inv = await db.$transaction((tx) =>
      inviteCollaborator(tx, OWNER_ID, listId, "invitee-inv"),
    );
    await expect(
      db.$transaction((tx) => revokeInvite(tx, INVITEE_ID, inv.invite.id)),
    ).rejects.toThrow(TRPCError);
  });

  it("accepts '@username' as invite input and normalizes it", async () => {
    const inv = await db.$transaction((tx) =>
      inviteCollaborator(tx, OWNER_ID, listId, "@invitee-inv"),
    );
    expect(inv.invite.invitedUserId).toBe(INVITEE_ID);
  });

  it("error message for missing user echoes the normalized username", async () => {
    await expect(
      db.$transaction((tx) =>
        inviteCollaborator(tx, OWNER_ID, listId, "@nobody-xyz"),
      ),
    ).rejects.toThrow('No user with username "nobody-xyz"');
  });
});
