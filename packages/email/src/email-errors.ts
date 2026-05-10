// Tagged errors for the Mailer service. ADR-0020.
import { Data } from "effect";

export class MailerError extends Data.TaggedError("MailerError")<{
  readonly cause: unknown;
}> {}

export class MailerTransportError extends Data.TaggedError(
  "MailerTransportError",
)<{
  readonly cause: unknown;
}> {}

export class MailerInvalidAddressError extends Data.TaggedError(
  "MailerInvalidAddressError",
)<{
  readonly address: string;
  readonly reason: string;
}> {}
