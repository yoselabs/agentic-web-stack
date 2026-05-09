import { Effect } from "effect";
import * as nodemailer from "nodemailer";
import type * as EmailErrors from "./email-errors.ts";
import {
  MailerError,
  MailerInvalidAddressError,
  MailerTransportError,
} from "./email-errors.ts";
import type * as EmailSchema from "./email-schema.ts";

export interface MailerConfig {
  readonly smtpUrl: string;
}

const mapNodemailerError = (
  cause: unknown,
):
  | EmailErrors.MailerError
  | EmailErrors.MailerTransportError
  | EmailErrors.MailerInvalidAddressError => {
  if (cause != null && typeof cause === "object" && "code" in cause) {
    const code = (cause as { code: string }).code;
    // EENVELOPE family covers invalid/rejected addresses per nodemailer docs.
    if (code === "EENVELOPE" || code === "EADDRESS") {
      const address =
        "response" in cause && typeof cause.response === "string"
          ? cause.response
          : "unknown";
      return new MailerInvalidAddressError({ address, reason: code });
    }
    // Other E* codes (ECONNECTION, EAUTH, ETIMEOUT, etc.) are transport-level.
    if (code.startsWith("E") && code !== "EMESSAGE") {
      return new MailerTransportError({ cause });
    }
  }
  return new MailerError({ cause });
};

export const makeMailerServiceMethods = (
  config: MailerConfig,
  // Test escape hatch — production wires nodemailer.createTransport(smtpUrl).
  transportOverride?: nodemailer.Transporter,
) => {
  // One transport per Mailer instance. createTransport is synchronous.
  const transport =
    transportOverride ?? nodemailer.createTransport(config.smtpUrl);

  return {
    send: (
      input: EmailSchema.SendEmailInput,
    ): Effect.Effect<
      EmailSchema.SendEmailReceipt,
      | EmailErrors.MailerError
      | EmailErrors.MailerTransportError
      | EmailErrors.MailerInvalidAddressError,
      never
    > =>
      Effect.tryPromise({
        try: () =>
          transport.sendMail({
            to: input.to,
            from: input.from,
            subject: input.subject,
            html: input.html,
            ...(input.text !== undefined ? { text: input.text } : {}),
          }),
        catch: (cause) => mapNodemailerError(cause),
      }).pipe(
        Effect.map((info) => ({
          messageId: info.messageId,
          // info.accepted is string[] for SMTP transports; stream/json transports
          // omit it — fall back to the input `to` address in that case.
          acceptedRecipients: (
            (info.accepted ?? [input.to]) as ReadonlyArray<
              string | { address: string }
            >
          ).map((a) => (typeof a === "string" ? a : a.address)),
        })),
      ),
  };
};
