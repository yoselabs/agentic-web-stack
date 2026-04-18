import { db } from "@project/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isUsernameAvailable, searchUsers } from "../service.js";

const TEST_USERS = [
  {
    id: "user-search-alice",
    name: "Alice Anderson",
    email: "alice@test.com",
    username: "alice_a",
  },
  {
    id: "user-search-bob",
    name: "Bob Brown",
    email: "bob@test.com",
    username: "bob_b",
  },
  {
    id: "user-search-alex",
    name: "Alex Alvarez",
    email: "alex@test.com",
    username: "alex_a",
  },
];

beforeAll(async () => {
  await db.user.deleteMany({
    where: { id: { in: TEST_USERS.map((u) => u.id) } },
  });
  await db.user.createMany({
    data: TEST_USERS.map((u) => ({ ...u, emailVerified: false })),
  });
});

afterAll(async () => {
  await db.user.deleteMany({
    where: { id: { in: TEST_USERS.map((u) => u.id) } },
  });
  await db.$disconnect();
});

describe("searchUsers", () => {
  it("matches username prefix (case-insensitive)", async () => {
    const r = await searchUsers(db, "ALEX");
    expect(r.some((u) => u.userId === "user-search-alex")).toBe(true);
  });

  it("matches name substring when no username match", async () => {
    const r = await searchUsers(db, "brown");
    expect(r.some((u) => u.userId === "user-search-bob")).toBe(true);
  });

  it("never returns email", async () => {
    const r = await searchUsers(db, "alex");
    for (const row of r) {
      expect(row).not.toHaveProperty("email");
    }
  });

  it("returns empty for queries shorter than 2 chars", async () => {
    expect(await searchUsers(db, "a")).toEqual([]);
    expect(await searchUsers(db, "")).toEqual([]);
  });

  it("ranks exact username match first", async () => {
    const r = await searchUsers(db, "alice_a");
    expect(r[0]?.userId).toBe("user-search-alice");
  });
});

describe("isUsernameAvailable", () => {
  it("returns false when taken", async () => {
    expect(await isUsernameAvailable(db, "alice_a")).toBe(false);
  });

  it("returns true when free", async () => {
    expect(await isUsernameAvailable(db, "never_used_name")).toBe(true);
  });
});
