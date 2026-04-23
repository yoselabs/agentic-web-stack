// Step definitions for the magic-link sign-in flow. Reuses the Mailpit
// helpers (e2e/helpers/mailpit.ts) and exercises Better-Auth's own
// /api/auth/magic-link/verify handler, which redirects to callbackURL on
// success or errorCallbackURL on failure.

import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import {
  deleteAllMail,
  getMessageBody,
  waitForMailTo,
} from "../../helpers/mailpit.ts";
import { waitForHydration } from "../../helpers/waits.ts";
import { TEST_API_URL, TEST_WEB_URL } from "../../test-env.ts";

const { When: when, Then: then } = createBdd();

when("I follow the {string} link", async ({ page }, name: string) => {
  // Mailpit is shared across the parallel suite — clear before the
  // request so waitForMailTo picks up THIS scenario's email, not a
  // stale one.
  await deleteAllMail();
  await page.getByRole("link", { name }).click();
  await page.waitForURL(/\/sign-in\/magic-link/, { timeout: 5000 });
  await waitForHydration(page);
});

when("I request a magic link for {string}", async ({ page }, email: string) => {
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send sign-in link" }).click();
});

when(
  "I open the magic link from the email to {string}",
  async ({ page }, email: string) => {
    const msg = await waitForMailTo(email);
    expect(msg.Subject).toBe("Your sign-in link");
    const body = await getMessageBody(msg.ID);
    // The signInUrl is the only http(s) link in the template — the
    // "Back to sign in" link is in-app HTML, not in the email.
    const match = body.HTML.match(/href="(https?:\/\/[^"]+)"/);
    if (!match) {
      throw new Error(`No magic link in email body: ${body.HTML}`);
    }
    await page.goto(match[1]);
    // Better-Auth verify → 302 → callbackURL (/dashboard). Wait on URL,
    // not networkidle (WS keep-alive pings race networkidle).
    await page.waitForURL(/\/dashboard/, { timeout: 10_000 });
  },
);

when("I open an invalid magic link", async ({ page }) => {
  // Hit Better-Auth's verify endpoint directly with a bogus token.
  // The plugin treats invalid/expired/consumed tokens identically and
  // 302-redirects to errorCallbackURL — no time-travel needed.
  const verifyUrl =
    `${TEST_API_URL}/api/auth/magic-link/verify` +
    `?token=invalid-token-for-bdd` +
    `&errorCallbackURL=${encodeURIComponent(`${TEST_WEB_URL}/sign-in/magic-link?error=expired`)}`;
  await page.goto(verifyUrl);
  await page.waitForURL(/\/sign-in\/magic-link\?error=/, { timeout: 5000 });
});

then(
  "I should see a {string} confirmation",
  async ({ page }, heading: string) => {
    await expect(page.getByRole("heading", { name: heading })).toBeVisible({
      timeout: 5000,
    });
  },
);

then("I should see a magic-link expired error", async ({ page }) => {
  await expect(page.getByRole("alert")).toContainText(
    /expired or is invalid/i,
    {
      timeout: 5000,
    },
  );
});
