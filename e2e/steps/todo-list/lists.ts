import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";

const { Given: given, When: when } = createBdd();

given("I have a list named {string}", async ({ page }, name: string) => {
  await page.getByPlaceholder("New list name...").fill(name);
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByText(name)).toBeVisible({ timeout: 10000 });
});

given("I am in the list {string}", async ({ page }, name: string) => {
  await page.getByText(name).first().click();
  await page.waitForLoadState("networkidle");
});

when("I create a list named {string}", async ({ page }, name: string) => {
  await page.getByPlaceholder("New list name...").fill(name);
  await page.getByRole("button", { name: "Create" }).click();
  await page.waitForLoadState("networkidle");
});

when("I delete the list {string}", async ({ page }, name: string) => {
  const row = page.locator("li", { hasText: name });
  await row.getByRole("button", { name: /Delete/i }).click();
  await row.waitFor({ state: "detached", timeout: 5000 });
});
