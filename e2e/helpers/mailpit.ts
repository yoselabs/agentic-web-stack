// Minimal Mailpit API client for e2e scenarios. Polls the inbox until a
// message to `to` appears, times out at 10s. Mirrors
// packages/api/src/__tests__/helpers/mailpit.ts but resolves the URL
// from @project/test-infra (which reads the dynamic TEST_MAILPIT_API_URL
// per worktree). Docs: https://mailpit.axllent.org/docs/api-v1/

import { testDbEnv } from "@project/test-infra";

const MAILPIT_API_URL = testDbEnv("e2e").TEST_MAILPIT_API_URL;

export type MailpitMessage = {
  ID: string;
  From: { Address: string; Name: string };
  To: { Address: string; Name: string }[];
  Subject: string;
  Snippet: string;
};

export async function deleteAllMail(): Promise<void> {
  const res = await fetch(`${MAILPIT_API_URL}/api/v1/messages`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`DELETE /messages failed: ${res.status}`);
}

export async function waitForMailTo(
  to: string,
  timeoutMs = 10_000,
): Promise<MailpitMessage> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(
      `${MAILPIT_API_URL}/api/v1/search?query=to:${encodeURIComponent(to)}`,
    );
    if (res.ok) {
      const body = (await res.json()) as { messages: MailpitMessage[] };
      if (body.messages.length > 0) return body.messages[0];
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`timeout waiting for mail to ${to}`);
}

export async function getMessageBody(
  id: string,
): Promise<{ HTML: string; Text: string }> {
  const res = await fetch(`${MAILPIT_API_URL}/api/v1/message/${id}`);
  if (!res.ok) throw new Error(`GET /message/${id} failed: ${res.status}`);
  return (await res.json()) as { HTML: string; Text: string };
}
