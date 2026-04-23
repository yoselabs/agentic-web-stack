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
import {
  deleteAllMail,
  getMessageBody,
  waitForMailTo,
} from "./helpers/mailpit.js";

const TEST_EMAIL = "magic-link-user@example.com";

beforeAll(() => {
  if (!env.MAILPIT_API_URL.includes(":8")) {
    throw new Error(
      `Suspicious MAILPIT_API_URL: ${env.MAILPIT_API_URL} — check test-runner envForSubprocess wiring.`,
    );
  }
});

beforeEach(async () => {
  await db.user.deleteMany({ where: { email: TEST_EMAIL } });
  await deleteAllMail();
  // Magic-link sign-in works even without an existing user (default
  // behaviour: signs them up). Pre-create so the assertion is about the
  // email shape, not Better-Auth's signup branch.
  await auth.api.signUpEmail({
    body: {
      email: TEST_EMAIL,
      password: "initial-pw-123!",
      name: "Magic User",
      username: "magic-user",
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

describe("magic-link sign-in end-to-end", () => {
  it("enqueues, delivers, and a sign-in link appears in Mailpit", async () => {
    // biome-ignore lint/suspicious/noExplicitAny: Better-Auth plugin endpoint surface
    const api = auth.api as any;
    const fn = api.signInMagicLink;
    if (!fn) {
      throw new Error("auth.api.signInMagicLink is not registered");
    }
    await fn({
      body: {
        email: TEST_EMAIL,
        callbackURL: "http://localhost:3000/dashboard",
      },
      // signInMagicLink requires headers (rate-limit + origin checks
      // run in middleware). Empty Headers is enough for the call to
      // pass validation in a unit test.
      headers: new Headers(),
    });

    await drainEmailQueue();

    const msg = await waitForMailTo(TEST_EMAIL);
    expect(msg.Subject).toBe("Your sign-in link");
    expect(msg.To[0].Address).toBe(TEST_EMAIL);

    const body = await getMessageBody(msg.ID);
    expect(body.HTML).toMatch(/\/api\/auth\/magic-link\/verify\?token=/);
  }, 15_000);
});
