// MailerService — ADR-0020 (Effect.Service wrapping nodemailer).
import { env } from "@project/env/server";
import { Effect } from "effect";
import { makeMailerServiceMethods } from "./email-service.ts";

export class MailerService extends Effect.Service<MailerService>()(
  "@project/email/MailerService",
  {
    sync: () => makeMailerServiceMethods({ smtpUrl: env.SMTP_URL }),
  },
) {}
