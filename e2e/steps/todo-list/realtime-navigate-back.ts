// Step definitions for the navigate-back realtime scenario. The list
// detail route's on-mount effect invalidates todoList.get + todo.list,
// so a todo that was added while the viewer was off-page appears when
// they return. Reuses the "creates the todo X in Y in another browser"
// step defined in ./realtime-dashboard.ts.

import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import { waitForHydration } from "../../helpers/waits.ts";
import { getActor, listIdByName } from "./collaborators.ts";

const { When, Then } = createBdd();

When(
  "{string} navigates to the dashboard",
  // biome-ignore lint/correctness/noEmptyPattern: playwright-bdd requires object destructuring as first arg
  async ({}, actorName: string) => {
    const actor = getActor(actorName);
    await actor.page.goto("/dashboard");
    await waitForHydration(actor.page);
    await expect(
      actor.page.getByRole("heading", { name: "Dashboard", exact: true }),
    ).toBeVisible({ timeout: 10_000 });
  },
);

When(
  "{string} navigates back to {string}",
  // biome-ignore lint/correctness/noEmptyPattern: playwright-bdd requires object destructuring as first arg
  async ({}, actorName: string, listName: string) => {
    const actor = getActor(actorName);
    const listId = listIdByName.get(listName);
    if (!listId) {
      throw new Error(`List "${listName}" has no known id.`);
    }
    await actor.page.goto(`/todo-lists/${listId}`);
    await waitForHydration(actor.page);
    await expect(
      actor.page.getByRole("heading", { name: listName }),
    ).toBeVisible({ timeout: 10_000 });
  },
);

Then(
  "{string} sees {string} in the list",
  // biome-ignore lint/correctness/noEmptyPattern: playwright-bdd requires object destructuring as first arg
  async ({}, actorName: string, title: string) => {
    const actor = getActor(actorName);
    await expect(
      actor.page.getByTestId("todo-row").filter({ hasText: title }).first(),
    ).toBeVisible({ timeout: 10_000 });
  },
);
