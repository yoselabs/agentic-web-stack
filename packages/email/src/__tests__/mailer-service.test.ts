import { describe, expect, it } from "bun:test";
import { Cause, Effect, Exit } from "effect";
import * as nodemailer from "nodemailer";
import {
  MailerInvalidAddressError,
  MailerTransportError,
} from "../email-errors.ts";
import { makeMailerServiceMethods } from "../email-service.ts";

const validInput = {
  to: "alice@example.com",
  from: "noreply@app.example.com",
  subject: "hi",
  html: "<p>hello</p>",
  text: "hello",
} as const;

describe("MailerService.send", () => {
  it("delivers a valid email via stream transport", async () => {
    const transport = nodemailer.createTransport({
      streamTransport: true,
      buffer: true,
    });
    const svc = makeMailerServiceMethods({ smtpUrl: "" }, transport);

    const result = await Effect.runPromise(svc.send(validInput));

    expect(result.messageId).toBeTruthy();
    expect(result.acceptedRecipients).toContain("alice@example.com");
  });

  it("returns MailerTransportError when transport fails with ECONNECTION", async () => {
    const err = Object.assign(new Error("connection refused"), {
      code: "ECONNECTION",
    });
    const transport = {
      sendMail: () => Promise.reject(err),
    } as unknown as nodemailer.Transporter;
    const svc = makeMailerServiceMethods({ smtpUrl: "" }, transport);

    const exit = await Effect.runPromiseExit(svc.send(validInput));

    expect(exit._tag).toBe("Failure");
    if (Exit.isFailure(exit)) {
      const maybeError = Cause.failureOption(exit.cause);
      expect(maybeError._tag).toBe("Some");
      if (maybeError._tag === "Some") {
        expect(maybeError.value).toBeInstanceOf(MailerTransportError);
      }
    }
  });

  it("returns MailerInvalidAddressError on EENVELOPE / bad address response", async () => {
    const err = Object.assign(new Error("bad address"), {
      code: "EENVELOPE",
      response: "550 5.1.1 user unknown",
    });
    const transport = {
      sendMail: () => Promise.reject(err),
    } as unknown as nodemailer.Transporter;
    const svc = makeMailerServiceMethods({ smtpUrl: "" }, transport);

    const exit = await Effect.runPromiseExit(svc.send(validInput));

    expect(exit._tag).toBe("Failure");
    if (Exit.isFailure(exit)) {
      const maybeError = Cause.failureOption(exit.cause);
      expect(maybeError._tag).toBe("Some");
      if (maybeError._tag === "Some") {
        expect(maybeError.value).toBeInstanceOf(MailerInvalidAddressError);
        expect((maybeError.value as MailerInvalidAddressError).address).toBe(
          "550 5.1.1 user unknown",
        );
        expect((maybeError.value as MailerInvalidAddressError).reason).toBe(
          "EENVELOPE",
        );
      }
    }
  });
});
