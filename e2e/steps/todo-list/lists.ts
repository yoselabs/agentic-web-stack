import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";

const { Given: given, When: when } = createBdd();

given("I have a list named {string}", async ({ page }, name: string) => {
  await page.getByPlaceholder("New list name...").fill(name);
  await page.getByRole("button", { name: "Create" }).click();
  // Newly-created list renders as a link — scope to <main> to avoid
  // collision with nav / activity feed.
  await expect(page.getByRole("main").getByRole("link", { name })).toBeVisible({
    timeout: 10000,
  });
});

given("I am in the list {string}", async ({ page }, name: string) => {
  // Click the list link in the main region; waitForURL asserts the
  // navigation landed (replaces networkidle, which raced with WS
  // keep-alive pings).
  await page.getByRole("main").getByRole("link", { name }).click();
  await page.waitForURL(/\/todo-lists\/[^/]+/, { timeout: 10_000 });
});

when("I create a list named {string}", async ({ page }, name: string) => {
  await page.getByPlaceholder("New list name...").fill(name);
  await page.getByRole("button", { name: "Create" }).click();
  // Invalidation + refetch surfaces the new list as a link in <main>.
  await expect(page.getByRole("main").getByRole("link", { name })).toBeVisible({
    timeout: 10_000,
  });
});

when("I delete the list {string}", async ({ page }, name: string) => {
  // The delete-list button's accessible name is `Delete ${list.name}`
  // (see todo-lists-page.tsx aria-label). Targeting by that name picks
  // exactly one row without needing to locate the parent <li>.
  const deleteBtn = page.getByRole("button", { name: `Delete ${name}` });
  await deleteBtn.click();
  await expect(deleteBtn).toBeHidden({ timeout: 5000 });
});
