import { Effect } from "effect";
import type * as EmailErrors from "./email-errors.ts";
import type * as EmailSchema from "./email-schema.ts";

export class MailerService extends Effect.Service<MailerService>()(
  "@project/email/MailerService",
  {
    succeed: {
      send: (
        _input: EmailSchema.SendEmailInput,
      ): Effect.Effect<
        EmailSchema.SendEmailReceipt,
        | EmailErrors.MailerError
        | EmailErrors.MailerTransportError
        | EmailErrors.MailerInvalidAddressError,
        never
      > => Effect.die("not implemented"),
    },
  },
) {}
