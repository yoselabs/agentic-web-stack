import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import { getActor, listIdByName, resolveListIdFor } from "./collaborators.ts";

const { Given, When, Then } = createBdd();

// --- When: actor-scoped mutations ---

When(
  "{string} creates the todo {string}",
  // biome-ignore lint/correctness/noEmptyPattern: playwright-bdd requires object destructuring as first arg
  async ({}, actorName: string, title: string) => {
    const actor = getActor(actorName);
    await actor.page.getByPlaceholder("Add a todo...").fill(title);
    await actor.page.getByRole("button", { name: "Add" }).click();
    await expect(
      actor.page.getByTestId("todo-row").filter({ hasText: title }),
    ).toBeVisible({ timeout: 5000 });
  },
);

When(
  "{string} deletes the todo {string}",
  // biome-ignore lint/correctness/noEmptyPattern: playwright-bdd requires object destructuring as first arg
  async ({}, actorName: string, title: string) => {
    const actor = getActor(actorName);
    const row = actor.page.getByTestId("todo-row").filter({ hasText: title });
    await row.getByRole("button", { name: "Delete" }).click();
    await row.waitFor({ state: "detached", timeout: 5000 });
  },
);

When(
  "{string} imports a CSV with titles {string}",
  // biome-ignore lint/correctness/noEmptyPattern: playwright-bdd requires object destructuring as first arg
  async ({}, actorName: string, csvTitles: string) => {
    const actor = getActor(actorName);
    const rows = csvTitles.split(",").map((t) => t.trim());
    const csv = `title\n${rows.join("\n")}\n`;
    // See todos.ts — the hidden <input type="file"> carries
    // data-testid="todo-import-input" for direct addressability.
    const input = actor.page.getByTestId("todo-import-input");
    await input.setInputFiles({
      name: "import.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv, "utf-8"),
    });
    // Imports trigger a bulk create → invalidate → refetch; the caller's
    // subsequent "X sees Y" assertion naturally waits for the UI.
  },
);

// --- Given: actor-scoped navigation ---

Given(
  "{string} has the todo lists index open in a browser",
  // biome-ignore lint/correctness/noEmptyPattern: playwright-bdd requires object destructuring as first arg
  async ({}, actorName: string) => {
    const actor = getActor(actorName);
    await actor.page.goto("/todo-lists");
    await actor.page.waitForURL("**/todo-lists");
    // The TodoListsPage sets data-testid="todo-lists-index" once the
    // index rendered; assert visibility instead of waitForSelector so
    // the waitForHydration-style fallback isn't needed.
    await expect(actor.page.getByTestId("todo-lists-index")).toBeVisible({
      timeout: 10_000,
    });
  },
);

When(
  "{string} opens {string}",
  // biome-ignore lint/correctness/noEmptyPattern: playwright-bdd requires object destructuring as first arg
  async ({}, actorName: string, listName: string) => {
    const actor = getActor(actorName);
    const id =
      listIdByName.get(listName) ?? (await resolveListIdFor(actor, listName));
    await actor.page.goto(`/todo-lists/${id}`);
    await actor.page.waitForURL(`**/todo-lists/${id}`);
  },
);

// --- Then: actor-scoped negative / positional assertions ---

Then(
  "{string} does not see {string} within {int} second(s)",
  // biome-ignore lint/correctness/noEmptyPattern: playwright-bdd requires object destructuring as first arg
  async ({}, actorName: string, title: string, seconds: number) => {
    const actor = getActor(actorName);
    await expect(
      actor.page.getByTestId("todo-row").filter({ hasText: title }),
    ).toHaveCount(0, {
      timeout: seconds * 1000,
    });
  },
);

Then(
  "{string} appears before {string} for {string}",
  // biome-ignore lint/correctness/noEmptyPattern: playwright-bdd requires object destructuring as first arg
  async ({}, first: string, second: string, actorName: string) => {
    const actor = getActor(actorName);
    const items = actor.page.getByTestId("todo-row");
    const texts: string[] = [];
    const count = await items.count();
    for (let i = 0; i < count; i++) {
      // eslint-disable-next-line playwright/no-nth-methods -- positional assertion: this step asserts DOM order of sortable rows
      texts.push(await items.nth(i).innerText());
    }
    const firstIdx = texts.findIndex((t) => t.includes(first));
    const secondIdx = texts.findIndex((t) => t.includes(second));
    expect(firstIdx).toBeGreaterThanOrEqual(0);
    expect(secondIdx).toBeGreaterThanOrEqual(0);
    expect(firstIdx).toBeLessThan(secondIdx);
  },
);
