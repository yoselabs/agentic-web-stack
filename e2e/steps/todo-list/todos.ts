import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";

const { Given: given, When: when, Then: then } = createBdd();

// --- Given ---

given("I have a todo {string}", async ({ page }, title: string) => {
  await page.getByPlaceholder("Add a todo...").fill(title);
  await page.getByRole("button", { name: "Add" }).click();
  await expect(page.getByText(title, { exact: false })).toBeVisible({
    timeout: 5000,
  });
});

// --- When ---

when("I toggle the todo {string}", async ({ page }, title: string) => {
  await page.getByRole("checkbox", { name: `Toggle ${title}` }).click();
});

when("I delete the todo {string}", async ({ page }, title: string) => {
  await page.getByRole("button", { name: `Delete ${title}` }).click();
});

// --- Then ---

then(
  "the todo {string} should be completed",
  async ({ page }, title: string) => {
    const checkbox = page.getByRole("checkbox", { name: `Toggle ${title}` });
    await expect(checkbox).toBeChecked();
  },
);
