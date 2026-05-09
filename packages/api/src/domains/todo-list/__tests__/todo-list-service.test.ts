// ADR-0015 — todo-purge cron (system task; no session required).
// ADR-0019 — bun test as the @project/api test runner.

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { db } from "@project/db";
import { Effect } from "effect";
import { AppLayer } from "../../../runtime/app-layer.ts";
import { makeTestUser, resetDb } from "../../../test-helpers.ts";
import { TodoListService } from "../todo-contract.ts";

const runWithApp = <A, E>(eff: Effect.Effect<A, E, never>): Promise<A> =>
  Effect.runPromise(eff);

const runPurge = (input: {
  olderThanDays: number;
}): Promise<{ deleted: number }> =>
  runWithApp(
    Effect.gen(function* () {
      const svc = yield* TodoListService;
      return yield* svc.purge(input);
    }).pipe(Effect.provide(TodoListService.Default), Effect.provide(AppLayer)),
  );

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await db.$disconnect();
});

describe("TodoListService.purge", () => {
  test("deletes completed todos whose updatedAt is older than the cutoff", async () => {
    const session = await makeTestUser();
    const list = await db.todoList.create({
      data: { name: "Test", color: "#000", userId: session.user.id },
    });

    const oldDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000); // 60d ago
    await db.todo.create({
      data: {
        title: "stale-completed",
        completed: true,
        userId: session.user.id,
        todoListId: list.id,
        updatedAt: oldDate,
      },
    });
    await db.todo.create({
      data: {
        title: "fresh-completed",
        completed: true,
        userId: session.user.id,
        todoListId: list.id,
        // updatedAt defaults to now
      },
    });
    await db.todo.create({
      data: {
        title: "stale-incomplete",
        completed: false,
        userId: session.user.id,
        todoListId: list.id,
        updatedAt: oldDate,
      },
    });

    const report = await runPurge({ olderThanDays: 30 });

    expect(report.deleted).toBe(1);
    const remaining = await db.todo.findMany({
      where: { todoListId: list.id },
      orderBy: { title: "asc" },
    });
    expect(remaining.map((t) => t.title)).toEqual([
      "fresh-completed",
      "stale-incomplete",
    ]);
  });

  test("returns 0 when nothing matches", async () => {
    const session = await makeTestUser();
    const list = await db.todoList.create({
      data: { name: "Test", color: "#000", userId: session.user.id },
    });
    await db.todo.create({
      data: {
        title: "fresh",
        completed: true,
        userId: session.user.id,
        todoListId: list.id,
      },
    });

    const report = await runPurge({ olderThanDays: 30 });

    expect(report.deleted).toBe(0);
  });
});
