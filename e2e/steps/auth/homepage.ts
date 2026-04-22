// Step definitions for the homepage/top-nav visibility feature.
// Reuses existing "I am not signed in", "I am signed in as",
// "I navigate to", and "I promote X to admin" primitives from
// auth/auth.ts and admin/gate.ts.

import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";

const { Then: then } = createBdd();

then(
  "I should see the {string} hero heading",
  async ({ page }, heading: string) => {
    await expect(page.getByRole("heading", { name: heading })).toBeVisible({
      timeout: 5000,
    });
  },
);

// Navigation-scoped button lookup. Scopes to <nav> so in-page CTA text
// (e.g., a "Sign In" button in the body) doesn't satisfy the assertion.
then(
  "I should see a {string} button in the navigation",
  async ({ page }, label: string) => {
    const nav = page.getByRole("navigation").first();
    // On mobile, the button is behind the hamburger menu sheet. Open if
    // the desktop locator doesn't match first.
    const visibleInNav = nav.getByRole("link", { name: label });
    if ((await visibleInNav.count()) === 0) {
      const hamburger = page.getByRole("button", { name: "Toggle menu" });
      if (await hamburger.isVisible()) {
        await hamburger.click();
        await page
          .locator('[role="dialog"]')
          .waitFor({ state: "visible", timeout: 3000 });
        await expect(page.getByRole("link", { name: label })).toBeVisible({
          timeout: 5000,
        });
        return;
      }
    }
    await expect(visibleInNav.first()).toBeVisible({ timeout: 5000 });
  },
);

then(
  "I should see a {string} link in the navigation",
  async ({ page }, label: string) => {
    const nav = page.getByRole("navigation").first();
    const visibleInNav = nav.getByRole("link", { name: label });
    if ((await visibleInNav.count()) === 0) {
      const hamburger = page.getByRole("button", { name: "Toggle menu" });
      if (await hamburger.isVisible()) {
        await hamburger.click();
        await page
          .locator('[role="dialog"]')
          .waitFor({ state: "visible", timeout: 3000 });
        await expect(page.getByRole("link", { name: label })).toBeVisible({
          timeout: 5000,
        });
        return;
      }
    }
    await expect(visibleInNav.first()).toBeVisible({ timeout: 5000 });
  },
);

then(
  "I should not see a {string} button in the navigation",
  async ({ page }, label: string) => {
    const nav = page.getByRole("navigation").first();
    await expect(nav.getByRole("link", { name: label })).toHaveCount(0);
  },
);
