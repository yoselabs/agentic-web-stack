// Step definitions for the admin-gate feature. Tests the /admin/queues
// endpoint on the API server (not the web server) for auth gating.
//
// The endpoint lives at TEST_API_URL/admin/queues (Hono, not TanStack Start).
// Requests use page.request so the cookie jar is shared with the page
// context — meaning signInViaApi's session cookie flows through.

import { execSync } from "node:child_process";
import { expect } from "@playwright/test";
import { envForSubprocess, PROJECT_ROOT } from "@project/test-infra";
import { createBdd } from "playwright-bdd";
import { TEST_API_URL } from "../test-env.ts";

const { Given: given, When: when, Then: then } = createBdd();

// Per-scenario response capture. playwright-bdd runs each scenario
// sequentially within a worker, so module-level state is safe here.
// Both status and body are cached so multiple Then steps can assert on
// the same response without re-fetching.
let lastAdminStatus: number | null = null;
let lastAdminBody: string | null = null;

async function captureAdminResponse(
  page: import("@playwright/test").Page,
): Promise<void> {
  const res = await page.request.get(`${TEST_API_URL}/admin/queues`, {
    maxRedirects: 0,
    failOnStatusCode: false,
  });
  lastAdminStatus = res.status();
  lastAdminBody = await res.text();
}

when(
  "I request the admin queues endpoint without a session",
  async ({ page }) => {
    // Cookies already cleared by "I am not signed in" step; belt-and-suspenders.
    await page.context().clearCookies();
    await captureAdminResponse(page);
  },
);

when("I request the admin queues endpoint", async ({ page }) => {
  await captureAdminResponse(page);
});

// Hits /admin/queues/api/queues — the Bull Board JSON API that lists queues
// by name. The SPA dashboard at /admin/queues renders via React after the HTML
// shell loads, so queue names ("email", "maintenance") only appear in the API
// response, not in the initial HTML.
when("I request the admin queues API endpoint", async ({ page }) => {
  const res = await page.request.get(
    `${TEST_API_URL}/admin/queues/api/queues`,
    {
      maxRedirects: 0,
      failOnStatusCode: false,
    },
  );
  lastAdminStatus = res.status();
  lastAdminBody = await res.text();
});

// playwright-bdd requires the first arg to use object destructuring even when
// no fixtures are needed. The empty pattern {} is intentional here.
// biome-ignore lint/correctness/noEmptyPattern: playwright-bdd requires object destructuring as first arg
given("I promote {string} to admin", async ({}, email: string) => {
  const subEnv = envForSubprocess("e2e");
  execSync(`bun run scripts/seed-admin.ts ${email}`, {
    stdio: "inherit",
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      ...subEnv,
    },
  });
});

// biome-ignore lint/correctness/noEmptyPattern: playwright-bdd requires object destructuring as first arg
then("the admin response status is {int}", async ({}, status: number) => {
  if (lastAdminStatus === null) {
    throw new Error("No admin response captured — run a request step first");
  }
  expect(lastAdminStatus).toBe(status);
});

// biome-ignore lint/correctness/noEmptyPattern: playwright-bdd requires object destructuring as first arg
then("the admin page contains {string}", async ({}, text: string) => {
  if (lastAdminBody === null) {
    throw new Error("No admin response captured — run a request step first");
  }
  expect(lastAdminBody).toContain(text);
});
