// Step definitions for the two-browser dashboard-counter realtime
// scenario. The owner sits on /dashboard (where useUserInbox subscribes
// to the user-inbox channel); when a collaborator mutates a shared list,
// the counter-changed event invalidates todoList.list + listAccessible.
// Navigating to /todo-lists then paints the refetched counter.

import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import { TEST_API_URL } from "../../test-env.ts";
import { waitForHydration } from "../../waits.ts";
import { getActor, listIdByName } from "./collaborators.ts";

const { Given, When, Then } = createBdd();

Given(
  "{string} has the dashboard open in a browser",
  // biome-ignore lint/correctness/noEmptyPattern: playwright-bdd requires object destructuring as first arg
  async ({}, actorName: string) => {
    const actor = getActor(actorName);
    await actor.page.goto("/dashboard");
    await waitForHydration(actor.page);
    await expect(
      actor.page.getByRole("heading", { name: "Dashboard", exact: true }),
    ).toBeVisible({ timeout: 10_000 });
    // Give the tRPC WS subscription a beat to establish — otherwise the
    // event from "bob" fires before alice's socket is registered on the
    // user-inbox channel and she misses the invalidation.
    await actor.page.waitForTimeout(500);
  },
);

When(
  "{string} creates the todo {string} in {string} in another browser",
  // biome-ignore lint/correctness/noEmptyPattern: playwright-bdd requires object destructuring as first arg
  async ({}, actorName: string, title: string, listName: string) => {
    const actor = getActor(actorName);
    const listId = listIdByName.get(listName);
    if (!listId) {
      throw new Error(`List "${listName}" has no known id.`);
    }
    const res = await actor.page.request.post(
      `${TEST_API_URL}/trpc/todo.create`,
      { data: { todoListId: listId, title } },
    );
    if (!res.ok()) {
      throw new Error(
        `todo.create failed: ${res.status()} ${await res.text()}`,
      );
    }
  },
);

When(
  "{string} opens the todo lists page",
  // biome-ignore lint/correctness/noEmptyPattern: playwright-bdd requires object destructuring as first arg
  async ({}, actorName: string) => {
    const actor = getActor(actorName);
    await actor.page.goto("/todo-lists");
    await waitForHydration(actor.page);
    await actor.page.waitForSelector('[data-testid="todo-lists-index"]');
  },
);

Then(
  "{string} sees {string} with {int} todos within {int} second(s)",
  async (
    // biome-ignore lint/correctness/noEmptyPattern: playwright-bdd requires object destructuring as first arg
    {},
    actorName: string,
    listName: string,
    count: number,
    seconds: number,
  ) => {
    const actor = getActor(actorName);
    const row = actor.page.locator("li", { hasText: listName }).first();
    await expect(row.getByText(`${count} todos`)).toBeVisible({
      timeout: seconds * 1000,
    });
  },
);
