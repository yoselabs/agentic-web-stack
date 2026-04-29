import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import { waitForHydration } from "../../helpers/waits.ts";

const { Given: given, When: when } = createBdd();

// --- Given ---

given("I have a list named {string}", async ({ page }, name: string) => {
  if (!page.url().includes("/dashboard")) {
    await page.goto("/dashboard");
    await waitForHydration(page);
  }
  await page.getByLabel("List name").fill(name);
  await page.getByRole("button", { name: "Create list" }).click();
  await expect(page.getByRole("link", { name, exact: true })).toBeVisible({
    timeout: 5000,
  });
});

given("I am in the list {string}", async ({ page }, name: string) => {
  await page.getByRole("link", { name, exact: true }).click();
  await waitForHydration(page);
  await expect(page.getByRole("heading", { name: "Todos" })).toBeVisible({
    timeout: 5000,
  });
});

// --- When ---

when("I create a list named {string}", async ({ page }, name: string) => {
  await page.getByLabel("List name").fill(name);
  await page.getByRole("button", { name: "Create list" }).click();
  await expect(page.getByRole("link", { name, exact: true })).toBeVisible({
    timeout: 5000,
  });
});

when("I delete the list {string}", async ({ page }, name: string) => {
  await page.getByRole("button", { name: `Delete ${name}` }).click();
});
