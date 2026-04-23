// Step definitions for the sign-in form blur/submit validation behavior.
// The form uses TanStack Form with validators on onBlur and onSubmit —
// field-level errors only surface AFTER blur or submit, not on change.

import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";

const { When: when, Then: then } = createBdd();

when("I type {string} in the email field", async ({ page }, text: string) => {
  // Fill without blurring — we assert that the password field is clean.
  await page.getByLabel("Email").fill(text);
});

when("I focus then blur the email field leaving it empty", async ({ page }) => {
  const email = page.getByLabel("Email");
  await email.focus();
  // Move focus elsewhere to trigger onBlur with an empty value.
  await page.getByLabel("Password").focus();
});

when("I toggle to the sign-up mode", async ({ page }) => {
  // /login and /signup are now separate routes. The cross-link in the
  // sign-in card navigates to /signup where the SignUpForm renders with
  // its own placeholders.
  await page.getByRole("link", { name: "Sign Up", exact: true }).click();
  await page.waitForURL(/\/signup/, { timeout: 5000 });
});

// Field-level error messages render with role="alert". The "no error"
// scenarios only touch the email field without blurring either field —
// so asserting zero alerts exist is equivalent to "no password error"
// (if a password error were present, some alert would be too).
then("the password field shows no error", async ({ page }) => {
  await expect(page.getByRole("alert")).toHaveCount(0);
});

then("I should see an email error", async ({ page }) => {
  // Blurring empty email surfaces ≥1 alert (email + possibly password).
  // Assert at least one alert is visible — prove the validation fired.
  await expect
    .poll(() => page.getByRole("alert").count(), { timeout: 5000 })
    .toBeGreaterThanOrEqual(1);
});

then(
  "the password placeholder is {string}",
  async ({ page }, placeholder: string) => {
    await expect(page.getByLabel("Password")).toHaveAttribute(
      "placeholder",
      placeholder,
    );
  },
);

then(
  "the password placeholder contains {string}",
  async ({ page }, substring: string) => {
    await expect(page.getByLabel("Password")).toHaveAttribute(
      "placeholder",
      new RegExp(substring.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  },
);
