import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import { createUserViaApi, signInViaApi } from "../auth-client.ts";
import { SHARED_PASSWORD } from "../fixtures/credentials.ts";
import { waitForHydration } from "../waits.ts";

const { Given: given, When: when, Then: then } = createBdd();

// --- Given ---

given("I am on the login page", async ({ page }) => {
  await page.goto("/login");
  await waitForHydration(page);
});

given(
  "a user exists with email {string} and password {string}",
  async ({ page }, email: string, password: string) => {
    await createUserViaApi(page, email, password);
    await page.context().clearCookies();
  },
);

given("I am not signed in", async ({ page }) => {
  await page.context().clearCookies();
});

given("I am signed in as {string}", async ({ page }, email: string) => {
  await signInViaApi(page, email, SHARED_PASSWORD);
});

given("I am on the dashboard", async ({ page }) => {
  if (!page.url().includes("/dashboard")) {
    await page.goto("/dashboard");
    await waitForHydration(page);
  }
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({
    timeout: 5000,
  });
});

given("I am on the todo lists page", async ({ page }) => {
  await page.goto("/todo-lists");
  await waitForHydration(page);
});

// --- When ---

when(
  "I sign up as {string} with email {string}",
  async ({ page }, name: string, email: string) => {
    await page.getByRole("button", { name: "Sign Up" }).click();
    await page.getByLabel("Name").fill(name);
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(SHARED_PASSWORD);
    await page.locator('button[type="submit"]').click();
    await page.waitForLoadState("networkidle");
  },
);

when(
  "I sign in with email {string} and password {string}",
  async ({ page }, email: string, password: string) => {
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.locator('button[type="submit"]').click();
    await page.waitForLoadState("networkidle");
  },
);

when("I navigate to {string}", async ({ page }, path: string) => {
  await page.goto(path);
  await waitForHydration(page);
});

when(
  "I fill in {string} with {string}",
  async ({ page }, field: string, value: string) => {
    // Try label first (form fields with <Label>), fall back to placeholder (e.g. todo input)
    const byLabel = page.getByLabel(field);
    if (await byLabel.count()) {
      await byLabel.fill(value);
    } else {
      await page.getByPlaceholder(field).fill(value);
    }
  },
);

when("I click {string}", async ({ page }, text: string) => {
  const btn = page.getByRole("button", { name: text });
  // On mobile, buttons in the navbar may be hidden behind the hamburger menu
  if (!(await btn.isVisible())) {
    const hamburger = page.getByRole("button", { name: "Toggle menu" });
    if (await hamburger.isVisible()) {
      await hamburger.click();
      await btn.waitFor({ state: "visible", timeout: 3000 });
    }
  }
  await btn.click();
  await page.waitForLoadState("networkidle");
});

// --- Then ---

then("I should be on the dashboard", async ({ page }) => {
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 });
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
});

then("I should be on the login page", async ({ page }) => {
  await expect(page).toHaveURL(/\/login/, { timeout: 5000 });
});

then("I should be signed out", async ({ page }) => {
  // After sign-out, user lands on either / or /login (race between explicit nav and auth guard)
  await page.waitForURL(/\/(login)?$/, {
    timeout: 5000,
  });
  // Verify not on an authenticated page
  await expect(page).not.toHaveURL(/\/dashboard/);
});

then("I should see {string}", async ({ page }, text: string) => {
  // On mobile, text in the navbar is hidden behind the hamburger menu.
  // Check if any visible instance exists; if not, try opening the menu.
  const visible = page
    .getByText(text, { exact: false })
    .locator("visible=true");
  if ((await visible.count()) === 0) {
    const hamburger = page.getByRole("button", { name: "Toggle menu" });
    if (await hamburger.isVisible()) {
      await hamburger.click();
      await page
        .locator('[role="dialog"]')
        .waitFor({ state: "visible", timeout: 3000 });
    }
  }
  await expect(
    page.getByText(text, { exact: false }).locator("visible=true").first(),
  ).toBeVisible({ timeout: 5000 });
});

then("I should see an error message", async ({ page }) => {
  await expect(
    page.locator("text=/fail|error|invalid|incorrect/i"),
  ).toBeVisible({ timeout: 5000 });
});
