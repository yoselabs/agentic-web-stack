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

// Navigation-scoped button lookup. Scopes to the primary (desktop) <nav>
// so in-page CTA text (e.g., a "Sign In" button in the body) doesn't
// satisfy the assertion. On mobile, the desktop nav's inner links are
// hidden via CSS — we fall back to opening the hamburger sheet and
// asserting inside its <nav aria-label="Mobile">.
then(
  "I should see a {string} button in the navigation",
  async ({ page }, label: string) => {
    const primaryNav = page.getByRole("navigation", { name: "Primary" });
    const visibleInNav = primaryNav.getByRole("link", { name: label });
    if ((await visibleInNav.count()) === 0) {
      const hamburger = page.getByRole("button", { name: "Toggle menu" });
      if (await hamburger.isVisible()) {
        await hamburger.click();
        await page
          .getByRole("dialog")
          .waitFor({ state: "visible", timeout: 3000 });
        const mobileNav = page.getByRole("navigation", { name: "Mobile" });
        await expect(mobileNav.getByRole("link", { name: label })).toBeVisible({
          timeout: 5000,
        });
        return;
      }
    }
    await expect(visibleInNav).toBeVisible({ timeout: 5000 });
  },
);

then(
  "I should see a {string} link in the navigation",
  async ({ page }, label: string) => {
    const primaryNav = page.getByRole("navigation", { name: "Primary" });
    const visibleInNav = primaryNav.getByRole("link", { name: label });
    if ((await visibleInNav.count()) === 0) {
      const hamburger = page.getByRole("button", { name: "Toggle menu" });
      if (await hamburger.isVisible()) {
        await hamburger.click();
        await page
          .getByRole("dialog")
          .waitFor({ state: "visible", timeout: 3000 });
        const mobileNav = page.getByRole("navigation", { name: "Mobile" });
        await expect(mobileNav.getByRole("link", { name: label })).toBeVisible({
          timeout: 5000,
        });
        return;
      }
    }
    await expect(visibleInNav).toBeVisible({ timeout: 5000 });
  },
);

then(
  "I should not see a {string} button in the navigation",
  async ({ page }, label: string) => {
    const primaryNav = page.getByRole("navigation", { name: "Primary" });
    await expect(primaryNav.getByRole("link", { name: label })).toHaveCount(0);
  },
);
