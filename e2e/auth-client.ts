// Programmatic auth for e2e tests. Hits Better-Auth's HTTP API directly and
// lands the session cookie on `page.context()` — Playwright's `page.request`
// shares its cookie jar with the page, so subsequent navigations are already
// authenticated. ~20× faster than clicking through the UI, and immune to
// sign-up form changes (new fields, validation rules, async checks).
//
// RULE: use these for precondition auth ("Given I am signed in as X",
// "Given a user exists with email X"). Do NOT use them in scenarios that
// are testing the auth UI itself — auth.feature's Sign Up / Sign In /
// Wrong Password scenarios MUST click the real form, that's what they
// exist to verify.

import type { Page } from "@playwright/test";
import { TEST_API_PORT } from "./test-env.ts";

const API_URL = `http://localhost:${TEST_API_PORT}`;

// Idempotent — "user already exists" is not a failure for test setup.
export async function createUserViaApi(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  const res = await page.request.post(`${API_URL}/api/auth/sign-up/email`, {
    data: {
      email,
      password,
      name: email.split("@")[0],
      username: email.split("@")[0],
    },
    failOnStatusCode: false,
  });
  if (res.ok()) return;
  // Better-Auth returns 422 for "user already exists". Fall back to text
  // pattern matching in case the status code changes in a future upgrade.
  if (res.status() === 422) return;
  const body = await res.text();
  if (/already\s*exists|user_already/i.test(body)) return;
  throw new Error(`createUserViaApi(${email}) failed: ${res.status()} ${body}`);
}

// Establishes a signed-in session on the page's browser context. Clears any
// prior cookies first so sign-up auto-login doesn't collide with the fresh
// sign-in cookie.
export async function signInViaApi(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  await createUserViaApi(page, email, password);
  await page.context().clearCookies();
  const res = await page.request.post(`${API_URL}/api/auth/sign-in/email`, {
    data: { email, password },
  });
  if (!res.ok()) {
    throw new Error(
      `signInViaApi(${email}) failed: ${res.status()} ${await res.text()}`,
    );
  }
}
