import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import { SHARED_PASSWORD } from "../../fixtures/credentials.ts";
import { createUserViaApi, signInViaApi } from "../../helpers/auth-client.ts";
import { waitForHydration } from "../../helpers/waits.ts";

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
    // Sign-up lives at /signup now; /login only renders the sign-in form.
    // Navigate via the cross-link to exercise it end-to-end.
    await page.getByRole("link", { name: "Sign Up" }).click();
    await page.waitForURL(/\/signup/, { timeout: 5000 });
    await waitForHydration(page);
    await page.getByLabel("Name", { exact: true }).fill(name);
    await page.getByLabel("Username").fill(email.split("@")[0]);
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(SHARED_PASSWORD);
    await page.getByRole("button", { name: "Sign Up" }).click();
    // Successful sign-up lands on /dashboard; failure keeps us on /signup
    // with an error. Either way wait for a settled URL instead of network
    // idle (which also races WS keep-alive pings).
    await page.waitForURL(/\/(dashboard|signup)/, { timeout: 10_000 });
  },
);

when(
  "I sign in with email {string} and password {string}",
  async ({ page }, email: string, password: string) => {
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign In" }).click();
    // Sign-in either lands on /dashboard or stays on /login with an error.
    await page.waitForURL(/\/(dashboard|login)/, { timeout: 10_000 });
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
  // Nav-triggered clicks navigate; user-action clicks invalidate queries.
  // Either way the UI settles when React has no in-flight work — we rely
  // on the subsequent step's web-first assertion to prove the new state.
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
    .filter({ visible: true });
  if ((await visible.count()) === 0) {
    const hamburger = page.getByRole("button", { name: "Toggle menu" });
    if (await hamburger.isVisible()) {
      await hamburger.click();
      await page
        .getByRole("dialog")
        .waitFor({ state: "visible", timeout: 3000 });
    }
  }
  // `toHaveCount({ gte: 1 })` isn't exposed; assert ≥1 visible match via
  // count instead of picking a specific index (satisfies no-nth-methods).
  await expect
    .poll(
      () =>
        page
          .getByText(text, { exact: false })
          .filter({ visible: true })
          .count(),
      { timeout: 5000 },
    )
    .toBeGreaterThanOrEqual(1);
});

then("I should see an error message", async ({ page }) => {
  await expect(page.getByText(/fail|error|invalid|incorrect/i)).toBeVisible({
    timeout: 5000,
  });
});
