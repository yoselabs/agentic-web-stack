// Enqueue-only send() API. Never blocks on SMTP — the worker handles delivery.
//
// `template` + `vars` form a discriminated union indexed by template name.
// Adding a new template: create a file in ./templates/, add its name+vars
// to the TemplateMap, extend the switch in handler.ts.

import { emailQueue } from "@project/jobs/queues";
import type { InviteCollaboratorVars } from "./templates/invite-collaborator.js";
import type { PasswordResetVars } from "./templates/password-reset.js";

export type EmailJobData =
  | { template: "password-reset"; to: string; vars: PasswordResetVars }
  | {
      template: "invite-collaborator";
      to: string;
      vars: InviteCollaboratorVars;
    };

export async function sendEmail(data: EmailJobData): Promise<void> {
  await emailQueue().add(data.template, data);
}
