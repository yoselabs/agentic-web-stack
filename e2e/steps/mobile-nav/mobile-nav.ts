import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";

const { When: when, Then: then } = createBdd();

when("I open the mobile menu", async ({ page }) => {
  await page.getByRole("button", { name: "Toggle menu" }).click();
  // Wait for the sheet animation to complete
  await page
    .locator('[role="dialog"]')
    .waitFor({ state: "visible", timeout: 3000 });
});

then("I should see {string} in the menu", async ({ page }, text: string) => {
  // The menu sheet contains navigation links
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByText(text)).toBeVisible({ timeout: 3000 });
});

when("I tap {string} in the menu", async ({ page }, text: string) => {
  const sheet = page.getByRole("dialog");
  await sheet.getByText(text).click();
});

then("I should be on the todo lists page", async ({ page }) => {
  await expect(page).toHaveURL(/\/todo-lists/, { timeout: 5000 });
});

then("the mobile menu should be closed", async ({ page }) => {
  // Sheet should no longer be visible after navigation
  await expect(page.getByRole("dialog")).not.toBeVisible({
    timeout: 3000,
  });
});
