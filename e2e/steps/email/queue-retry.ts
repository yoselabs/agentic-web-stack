// Step definitions for the email retry + dead-letter scenario. Stops
// Mailpit to force nodemailer ECONNREFUSED, waits for BullMQ to exhaust
// its 3-attempt backoff and land the job in the failed set, then retries
// via Bull Board's JSON API once Mailpit is back up.
//
// Failsafe: if the scenario dies between `stopMailpit()` and
// `startMailpit()` (crashed assertion, killed runner), Mailpit stays down
// and pollutes every later test run. The After hook below always starts
// Mailpit back up — idempotent `docker compose start` is a no-op if the
// container is already running.
//
// Bull Board API shape (verified against @bull-board/api routes.js):
//   GET  /admin/queues/api/queues?activeQueue=<name>&status=failed
//     → { queues: [{ name, counts, jobs: [{ id, failedReason, ... }] }] }
//   PUT  /admin/queues/api/queues/<name>/<jobId>/retry
//     → 204 on success

import { execSync } from "node:child_process";
import { expect } from "@playwright/test";
import { testDbEnv } from "@project/test-infra";
import { createBdd } from "playwright-bdd";
import { SHARED_PASSWORD } from "../../fixtures/credentials.ts";
import { TEST_API_URL } from "../../test-env.ts";

const { Given, When, Then, After } = createBdd();

const MAILPIT_CONTAINER = testDbEnv("e2e").TEST_MAILPIT_CONTAINER;

// Stop/start Mailpit by container name — avoids having to reproduce the
// docker compose project name, which is per-suite (`agentic-web-stack-e2e`).
// `|| true` swallows "already stopped / already running" so the operation
// stays idempotent under the After-hook failsafe.
function stopMailpit(): void {
  execSync(`docker stop ${MAILPIT_CONTAINER} >/dev/null 2>&1 || true`, {
    stdio: "inherit",
  });
}

function startMailpit(): void {
  execSync(`docker start ${MAILPIT_CONTAINER} >/dev/null 2>&1 || true`, {
    stdio: "inherit",
  });
  // Mailpit needs a beat to bind port 8025 after `docker start`. Poll the
  // API until it responds rather than guessing with a timeout.
  waitForMailpitReady();
}

function waitForMailpitReady(timeoutMs = 10_000): void {
  const url = `${testDbEnv("e2e").TEST_MAILPIT_API_URL}/api/v1/info`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      execSync(`curl -fsS "${url}" >/dev/null 2>&1`, { stdio: "ignore" });
      return;
    } catch {
      // Sleep 250ms between polls. Using execSync with `sleep 0.25`
      // avoids pulling in node:timers/promises async machinery into a
      // sync helper.
      execSync("sleep 0.25", { stdio: "ignore" });
    }
  }
  throw new Error(`Mailpit did not become ready within ${timeoutMs}ms`);
}

// Failsafe: always restore Mailpit after every scenario in THIS file.
// Idempotent — if it's already running, docker start is a no-op.
After(async () => {
  try {
    startMailpit();
  } catch {
    // best-effort — the next global-setup warm-path check handles it
  }
});

Given("Mailpit is stopped", () => {
  stopMailpit();
});

When("Mailpit is started again", () => {
  startMailpit();
});

// Poll Bull Board's API until the named queue reports `count` failed jobs
// or the deadline elapses. Caches the most recent response body so a
// follow-up Then step can inspect the failedReason without re-fetching.
let lastFailedJobs: Array<{ id: string; failedReason?: string }> = [];

Then(
  "the {string} queue has {int} failed job(s) within {int} second(s)",
  // biome-ignore lint/correctness/noEmptyPattern: playwright-bdd requires object destructuring as first arg
  async ({ browser }, queueName: string, expected: number, seconds: number) => {
    // Bull Board is admin-gated. Reuse the admin actor's page.request so
    // the session cookie flows through. Alice was promoted to admin in an
    // earlier Given step; we need her cookie jar to hit /admin/queues/*.
    // Since collaborators.ts owns the `actors` map as module state, we
    // can't reach into it here without creating a circular import. The
    // simplest approach: spawn a fresh admin-cookie'd context for the
    // API calls we need. Alice's email was set via the earlier step, so
    // we mirror that sign-in here via Better-Auth.
    const adminEmail = "alice-retry@example.com";
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      const signIn = await page.request.post(
        `${TEST_API_URL}/api/auth/sign-in/email`,
        { data: { email: adminEmail, password: SHARED_PASSWORD } },
      );
      if (!signIn.ok()) {
        throw new Error(
          `sign-in as ${adminEmail} failed: ${signIn.status()} ${await signIn.text()}`,
        );
      }
      const deadline = Date.now() + seconds * 1000;
      let lastCount = -1;
      while (Date.now() < deadline) {
        const res = await page.request.get(
          `${TEST_API_URL}/admin/queues/api/queues?activeQueue=${encodeURIComponent(queueName)}&status=failed`,
          { failOnStatusCode: false },
        );
        if (res.ok()) {
          const body = (await res.json()) as {
            queues: Array<{
              name: string;
              counts: Record<string, number>;
              jobs: Array<{ id: string; failedReason?: string }>;
            }>;
          };
          const q = body.queues.find((x) => x.name === queueName);
          if (q) {
            lastCount = q.counts.failed ?? 0;
            if (lastCount >= expected) {
              lastFailedJobs = q.jobs;
              expect(lastCount).toBe(expected);
              return;
            }
          }
        }
        await new Promise((r) => setTimeout(r, 500));
      }
      throw new Error(
        `queue "${queueName}" failed count never reached ${expected} (last=${lastCount})`,
      );
    } finally {
      await context.close().catch(() => {});
    }
  },
);

// biome-ignore lint/correctness/noEmptyPattern: playwright-bdd requires object destructuring as first arg
Then("the failed job's error contains {string}", async ({}, needle: string) => {
  if (lastFailedJobs.length === 0) {
    throw new Error(
      "No failed jobs captured — the queue-count Then step must run first",
    );
  }
  const reasons = lastFailedJobs
    .map((j) => j.failedReason ?? "")
    .join("\n---\n");
  expect(reasons).toContain(needle);
});

When(
  "{string} retries the failed email job",
  // biome-ignore lint/correctness/noEmptyPattern: playwright-bdd requires object destructuring as first arg
  async ({ browser }, _actorName: string) => {
    if (lastFailedJobs.length === 0) {
      throw new Error(
        "No failed jobs captured — the queue-count Then step must run first",
      );
    }
    const jobId = lastFailedJobs[0]?.id;
    if (!jobId) throw new Error("First failed job has no id");
    // Same admin-session dance as the queue-count step. A shared helper
    // would collapse these two, but the duplication is bounded (one
    // feature file) and keeping each step self-contained is easier to
    // read when triaging failures.
    const adminEmail = "alice-retry@example.com";
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      const signIn = await page.request.post(
        `${TEST_API_URL}/api/auth/sign-in/email`,
        { data: { email: adminEmail, password: SHARED_PASSWORD } },
      );
      if (!signIn.ok()) {
        throw new Error(
          `sign-in as ${adminEmail} failed: ${signIn.status()} ${await signIn.text()}`,
        );
      }
      const res = await page.request.put(
        `${TEST_API_URL}/admin/queues/api/queues/email/${jobId}/retry`,
        { failOnStatusCode: false },
      );
      if (!res.ok()) {
        throw new Error(`retry failed: ${res.status()} ${await res.text()}`);
      }
    } finally {
      await context.close().catch(() => {});
    }
  },
);

Then(
  "{string} receives the invite email",
  // biome-ignore lint/correctness/noEmptyPattern: playwright-bdd requires object destructuring as first arg
  async ({}, toAddress: string) => {
    // Inlined minimal poll rather than reusing helpers/mailpit.ts —
    // waitForMailTo uses a 10s timeout and we need to be generous here
    // since the retry enqueues a FRESH job that must be picked up by the
    // worker. Worker poll interval + nodemailer handshake can add a few
    // seconds on cold cache.
    const base = testDbEnv("e2e").TEST_MAILPIT_API_URL;
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const res = await fetch(
        `${base}/api/v1/search?query=to:${encodeURIComponent(toAddress)}`,
      );
      if (res.ok) {
        const body = (await res.json()) as { messages: unknown[] };
        if (body.messages.length > 0) return;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(`timeout waiting for mail to ${toAddress}`);
  },
);
