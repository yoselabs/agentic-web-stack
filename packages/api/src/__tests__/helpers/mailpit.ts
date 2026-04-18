// Minimal Mailpit API client for tests. Polls the inbox until a message
// to `to` appears, times out at 10s. Docs: https://mailpit.axllent.org/docs/api-v1/

import { env } from "@project/env/server";

export type MailpitMessage = {
  ID: string;
  From: { Address: string; Name: string };
  To: { Address: string; Name: string }[];
  Subject: string;
  Snippet: string;
};

export async function deleteAllMail(): Promise<void> {
  const res = await fetch(`${env.MAILPIT_API_URL}/api/v1/messages`, {
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
      `${env.MAILPIT_API_URL}/api/v1/search?query=to:${encodeURIComponent(to)}`,
    );
    if (res.ok) {
      const body = (await res.json()) as { messages: MailpitMessage[] };
      if (body.messages.length > 0) return body.messages[0];
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`timeout waiting for mail to ${to}`);
}

export async function getMessageBody(id: string): Promise<{
  HTML: string;
  Text: string;
}> {
  const res = await fetch(`${env.MAILPIT_API_URL}/api/v1/message/${id}`);
  if (!res.ok) throw new Error(`GET /message/${id} failed: ${res.status}`);
  const body = (await res.json()) as { HTML: string; Text: string };
  return body;
}
