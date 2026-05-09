import { Schema } from "effect";

export const EmailAddress = Schema.String.pipe(
  Schema.pattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/),
);

export const SendEmailInput = Schema.Struct({
  to: EmailAddress,
  from: EmailAddress,
  subject: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(200)),
  html: Schema.String,
  text: Schema.optional(Schema.String),
  // Optional reply-to and headers for future expansion.
});
export type SendEmailInput = Schema.Schema.Type<typeof SendEmailInput>;

export const SendEmailReceipt = Schema.Struct({
  messageId: Schema.String,
  acceptedRecipients: Schema.Array(EmailAddress),
});
export type SendEmailReceipt = Schema.Schema.Type<typeof SendEmailReceipt>;
