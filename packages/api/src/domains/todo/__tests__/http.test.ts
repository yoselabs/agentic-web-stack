import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  spyOn,
} from "bun:test";
import { auth } from "@project/auth";
import { db } from "@project/db";
import { todoHttpRouter } from "../http.js";

const TEST_USER_ID = "test-user-todo-http";
const TEST_USER = {
  id: TEST_USER_ID,
  name: "HTTP Test User",
  email: "test-todo-http@example.com",
  emailVerified: false,
  image: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const FAKE_SESSION = {
  user: TEST_USER,
  session: {
    id: "test-session-http",
    token: "test-token-http",
    userId: TEST_USER_ID,
    expiresAt: new Date(Date.now() + 1000 * 60 * 60),
    ipAddress: null,
    userAgent: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
};

let TEST_LIST_ID: string;

beforeAll(async () => {
  await db.todo.deleteMany({ where: { userId: TEST_USER_ID } });
  await db.todoList.deleteMany({ where: { userId: TEST_USER_ID } });
  await db.session.deleteMany({ where: { userId: TEST_USER_ID } });
  await db.account.deleteMany({ where: { userId: TEST_USER_ID } });
  await db.user.deleteMany({ where: { id: TEST_USER_ID } });

  await db.user.create({ data: TEST_USER });

  const list = await db.todoList.create({
    data: { userId: TEST_USER_ID, name: "HTTP test list" },
  });
  TEST_LIST_ID = list.id;
});

afterAll(async () => {
  await db.todo.deleteMany({ where: { userId: TEST_USER_ID } });
  await db.todoList.deleteMany({ where: { userId: TEST_USER_ID } });
  await db.user.deleteMany({ where: { id: TEST_USER_ID } });
});

afterEach(() => {
  // Restore any spyOn installed by a test.
  (
    auth.api.getSession as unknown as { mockRestore?: () => void }
  ).mockRestore?.();
});

function mockAuthed() {
  spyOn(auth.api, "getSession").mockResolvedValue(FAKE_SESSION as never);
}

function mockUnauthed() {
  spyOn(auth.api, "getSession").mockResolvedValue(null as never);
}

// All todoHttpRouter.request() calls below use the string-URL + init overload
// for consistency; Hono's request() accepts both (string, init) and (Request)
// shapes, but mixing them in one file obscures the test's intent.

describe("todoHttpRouter POST /import", () => {
  it("rejects unauthenticated requests with 401", async () => {
    mockUnauthed();
    const form = new FormData();
    form.set("file", new File(["title\nfoo"], "t.csv", { type: "text/csv" }));
    form.set("todoListId", TEST_LIST_ID);
    const res = await todoHttpRouter.request("/import", {
      method: "POST",
      body: form,
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Unauthorized");
  });

  it("rejects missing todoListId with 400", async () => {
    mockAuthed();
    const form = new FormData();
    form.set("file", new File(["title\nfoo"], "t.csv", { type: "text/csv" }));
    const res = await todoHttpRouter.request("/import", {
      method: "POST",
      body: form,
    });
    expect(res.status).toBe(400);
  });

  it("rejects non-CSV files with 400", async () => {
    mockAuthed();
    const form = new FormData();
    form.set("file", new File(["<html>"], "t.html", { type: "text/html" }));
    form.set("todoListId", TEST_LIST_ID);
    const res = await todoHttpRouter.request("/import", {
      method: "POST",
      body: form,
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Only CSV files are accepted");
  });

  it("accepts .CSV extension case-insensitively", async () => {
    mockAuthed();
    const form = new FormData();
    form.set(
      "file",
      new File(["title\nfoo"], "TODOS.CSV", {
        type: "application/octet-stream",
      }),
    );
    form.set("todoListId", TEST_LIST_ID);
    const res = await todoHttpRouter.request("/import", {
      method: "POST",
      body: form,
    });
    expect(res.status).toBe(201);
  });

  it("imports valid CSV and returns count", async () => {
    mockAuthed();
    await db.todo.deleteMany({ where: { userId: TEST_USER_ID } });
    const form = new FormData();
    form.set(
      "file",
      new File(["title\nalpha\nbeta\n"], "todos.csv", { type: "text/csv" }),
    );
    form.set("todoListId", TEST_LIST_ID);
    const res = await todoHttpRouter.request("/import", {
      method: "POST",
      body: form,
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { count: number };
    expect(body.count).toBe(2);
  });

  it("returns 400 with service error message for malformed CSV", async () => {
    mockAuthed();
    const form = new FormData();
    form.set(
      "file",
      new File(["name\nalpha"], "todos.csv", { type: "text/csv" }),
    );
    form.set("todoListId", TEST_LIST_ID);
    const res = await todoHttpRouter.request("/import", {
      method: "POST",
      body: form,
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("title");
  });
});

describe("todoHttpRouter GET /export", () => {
  it("rejects unauthenticated requests with 401", async () => {
    mockUnauthed();
    const res = await todoHttpRouter.request(
      `/export?todoListId=${TEST_LIST_ID}`,
    );
    expect(res.status).toBe(401);
  });

  it("rejects missing todoListId with 400", async () => {
    mockAuthed();
    const res = await todoHttpRouter.request("/export");
    expect(res.status).toBe(400);
  });

  it("returns CSV with attachment disposition", async () => {
    mockAuthed();
    const res = await todoHttpRouter.request(
      `/export?todoListId=${TEST_LIST_ID}`,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv");
    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="todos.csv"',
    );
    const body = await res.text();
    expect(body.split("\n")[0]).toContain("title");
  });
});
