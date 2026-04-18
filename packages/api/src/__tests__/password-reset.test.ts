import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "bun:test";
import { auth } from "@project/auth";
import { db } from "@project/db";
import { handleEmailJob } from "@project/email/handler";
import type { EmailJobData } from "@project/email/service";
import { env } from "@project/env/server";
import { closeQueues, emailQueue } from "@project/jobs/queues";
import { deleteAllMail, waitForMailTo } from "./helpers/mailpit.js";

const TEST_EMAIL = "reset-user@example.com";

beforeAll(() => {
  // Fail-loud: catch dev/test Mailpit cross-contamination early.
  if (!env.MAILPIT_API_URL.includes(":8")) {
    throw new Error(
      `Suspicious MAILPIT_API_URL: ${env.MAILPIT_API_URL} — check test-runner envForSubprocess wiring.`,
    );
  }
});

beforeEach(async () => {
  // Clean existing user (if any) so signUp succeeds.
  await db.user.deleteMany({ where: { email: TEST_EMAIL } });
  await deleteAllMail();

  // Create user via Better-Auth so the credential Account row exists.
  await auth.api.signUpEmail({
    body: {
      email: TEST_EMAIL,
      password: "initial-pw-123!",
      name: "Reset User",
    },
  });
});

afterAll(async () => {
  await db.user.deleteMany({ where: { email: TEST_EMAIL } });
  await closeQueues();
  await db.$disconnect();
});

async function drainEmailQueue() {
  const q = emailQueue();
  const jobs = await q.getJobs(["waiting", "active", "delayed"]);
  for (const job of jobs) {
    await handleEmailJob(job.data as EmailJobData);
    await job.remove();
  }
}

describe("password reset end-to-end", () => {
  it("enqueues, delivers, and a reset link appears in Mailpit", async () => {
    // Better-Auth 1.6.x exposes requestPasswordReset (not forgetPassword).
    // Verified via: bun -e "import('@project/auth').then(m =>
    //   console.log(Object.keys(m.auth.api).filter(k => /password|forget|reset/i.test(k))))"
    // biome-ignore lint/suspicious/noExplicitAny: Better-Auth version probing
    const api = auth.api as any;
    const fn = api.forgetPassword ?? api.requestPasswordReset;
    if (!fn) {
      throw new Error(
        "Neither auth.api.forgetPassword nor auth.api.requestPasswordReset exists",
      );
    }
    await fn({
      body: {
        email: TEST_EMAIL,
        redirectTo: "http://localhost:3000/reset-password",
      },
    });

    await drainEmailQueue();

    const msg = await waitForMailTo(TEST_EMAIL);
    expect(msg.Subject).toBe("Reset your password");
    expect(msg.To[0].Address).toBe(TEST_EMAIL);
  }, 15_000); // 15s: BullMQ enqueue + SMTP send + Mailpit poll can take >5s default
});
