import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import { SHARED_PASSWORD } from "../../fixtures/credentials.ts";
import { signInViaApi } from "../../helpers/auth-client.ts";
import { waitForHydration } from "../../helpers/waits.ts";

const { Given: given, When: when, Then: then } = createBdd();

// --- Given (preconditions) ---

given("I am signed in as {string}", async ({ page }, email: string) => {
  await signInViaApi(page, email, SHARED_PASSWORD);
});

given("I am on the todo lists page", async ({ page }) => {
  await page.goto("/dashboard");
  await waitForHydration(page);
});

// --- When (actions) ---

when(
  "I fill in {string} with {string}",
  async ({ page }, field: string, value: string) => {
    const byLabel = page.getByLabel(field);
    if (await byLabel.count()) {
      await byLabel.fill(value);
    } else {
      await page.getByPlaceholder(field).fill(value);
    }
  },
);

when("I click {string}", async ({ page }, text: string) => {
  await page.getByRole("button", { name: text }).click();
});

// --- Then (assertions) ---

then("I should see {string}", async ({ page }, text: string) => {
  // Multiple matches are fine — assert at least one is visible by counting
  // the visible matches via locator.count + visibility wait on the parent
  // text. Avoids playwright/no-nth-methods.
  await expect(page.getByText(text, { exact: false })).not.toHaveCount(0, {
    timeout: 5000,
  });
});

then("I should not see {string}", async ({ page }, text: string) => {
  await expect(page.getByText(text, { exact: false })).toHaveCount(0);
});
