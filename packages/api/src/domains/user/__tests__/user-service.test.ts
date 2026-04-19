import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { db } from "@project/db";
import { searchUsersByUsername } from "../user-service.js";

describe("searchUsersByUsername", () => {
  const CALLER_ID = "test-search-caller";
  const IDS = ["u-alice", "u-alicia", "u-bob", "u-ali-admin"];

  beforeAll(async () => {
    await db.user.deleteMany({
      where: { id: { in: [CALLER_ID, ...IDS] } },
    });
    await db.user.createMany({
      data: [
        {
          id: CALLER_ID,
          name: "Caller",
          email: "caller-search@example.com",
          username: "caller-search",
          emailVerified: false,
        },
        {
          id: "u-alice",
          name: "Alice Smith",
          email: "alice@example.com",
          username: "alice",
          emailVerified: false,
        },
        {
          id: "u-alicia",
          name: "Alicia Jones",
          email: "alicia@example.com",
          username: "alicia",
          emailVerified: false,
        },
        {
          id: "u-bob",
          name: "Bob",
          email: "bob-search@example.com",
          username: "bob-search",
          emailVerified: false,
        },
        {
          id: "u-ali-admin",
          name: "Ali Admin",
          email: "ali-admin@example.com",
          username: "ali-admin",
          emailVerified: false,
        },
      ],
    });
  });

  afterAll(async () => {
    await db.user.deleteMany({
      where: { id: { in: [CALLER_ID, ...IDS] } },
    });
    await db.$disconnect();
  });

  it("matches users by username prefix (case-insensitive), excludes caller", async () => {
    const rows = await searchUsersByUsername(db, CALLER_ID, "ali");
    const usernames = rows.map((r) => r.username).sort();
    expect(usernames).toEqual(["ali-admin", "alice", "alicia"]);
  });

  it("matches users by display-name prefix (case-insensitive)", async () => {
    const rows = await searchUsersByUsername(db, CALLER_ID, "Bob");
    expect(rows.map((r) => r.username)).toContain("bob-search");
  });

  it("caps result count at 8", async () => {
    const rows = await searchUsersByUsername(db, CALLER_ID, "a");
    expect(rows.length).toBeLessThanOrEqual(8);
  });

  it("excludes the caller", async () => {
    const rows = await searchUsersByUsername(db, CALLER_ID, "caller");
    expect(rows.map((r) => r.id)).not.toContain(CALLER_ID);
  });
});
