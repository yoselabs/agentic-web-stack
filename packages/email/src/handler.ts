// Worker-side handler. Receives an EmailJobData, renders the template,
// dispatches via nodemailer. Runs inside apps/worker — never called from
// HTTP request handlers.
//
// Idempotency: nodemailer.sendMail is not idempotent at the SMTP layer,
// but retries re-send; most SMTP servers de-duplicate by Message-ID. For
// Mailpit in dev, duplicates appear in the mailbox — acceptable.

import { env } from "@project/env/server";
import nodemailer from "nodemailer";
import type { EmailJobData } from "./service.js";
import { inviteCollaboratorTemplate } from "./templates/invite-collaborator.js";
import { passwordResetTemplate } from "./templates/password-reset.js";

function createTransport() {
  const url = new URL(env.SMTP_URL);
  return nodemailer.createTransport({
    host: url.hostname,
    port: Number(url.port),
    secure: false,
    auth:
      url.username || url.password
        ? { user: url.username, pass: url.password }
        : undefined,
    tls: { rejectUnauthorized: false },
  });
}

let transportInstance: ReturnType<typeof createTransport> | null = null;
function transport() {
  if (!transportInstance) transportInstance = createTransport();
  return transportInstance;
}

export async function handleEmailJob(data: EmailJobData): Promise<void> {
  const rendered =
    data.template === "password-reset"
      ? passwordResetTemplate.render(data.vars)
      : inviteCollaboratorTemplate.render(data.vars);

  await transport().sendMail({
    from: "no-reply@example.com",
    to: data.to,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
  });
}
