---
title: "ADR 0020 — Email send"
status: accepted
date: 2026-04-29
accepted_date: 2026-05-09
deciders: [denis]
verified_by:
  - packages/email/src/email-contract.ts
  - packages/email/src/email-service.ts
  - packages/email/src/email-schema.ts
  - packages/email/src/email-errors.ts
  - apps/worker/src/handlers/email.ts
---

> **Status: accepted** as Option A (Mailer Layer wrapping nodemailer).
> Promoted on 2026-05-09 as part of Day 4 of the contract-first rewrite
> — capability #2 (Email), the canonical from-scratch run validating
> the spec D2 cadence on a non-retrofit capability. MailerService uses
> the modern Effect.Service form. Tagged errors: MailerError (catch-all),
> MailerTransportError (connection / auth / timeout), MailerInvalidAddressError
> (envelope rejection). In-process retry composed via Effect.Schedule
> at the worker handler level per ADR-0015 §Decision A.

# ADR 0020 — Email Send

## Context

The pre-rewrite `packages/email/` exposed a `sendEmail()` adapter over
nodemailer (SMTP transport in prod, Mailpit in dev/test). The
Effect-TS rewrite needs a `Mailer` Layer.

This slot was not in ADR-0009's original deferred list — nodemailer was
assumed to survive — but the Phase 1 design doc surfaced it as worth a
brief explicit ADR for completeness.

## Options considered

### A — Wrap nodemailer behind a `Mailer` Layer

A `Mailer` `Context.Tag` exposes `send(message)`. The `Live`
implementation calls `nodemailer.createTransport().sendMail()` inside
`Effect.tryPromise` with a tagged-error wrapper. Templates (the
existing `magic-link.ts`, `password-reset.ts`,
`invite-collaborator.ts`) return Effect-typed render functions.

Pros: nodemailer is the de-facto Node SMTP client; transports include
SMTP, SES, sendmail, and stream (for tests); existing template shape
survives; Mailpit dev integration is unchanged.

Cons: standard wrap-a-Promise-library pattern, nothing exotic.

### B — Replace with an Effect-native mailer

There is no Effect-native mailer in the ecosystem as of 2026-04. The
`@effect/platform` package provides HttpClient primitives that you
could use to call a transactional email API (Resend, Postmark) but
that's not really "replacing nodemailer" — it's choosing an HTTP API
provider over SMTP.

If we wanted to switch from SMTP to a transactional API, that's a
separate decision (provider choice, billing implications) and
shouldn't be folded into a Layer-architecture ADR.

## Decision (proposed)

**Pick A — wrap nodemailer behind a `Mailer` Layer.**

The wrap pattern is the same shape as ADR slot 0021 (rate limiter)
and ADR slot 0013 (DB) — for any well-trodden Node library with no
Effect-native equivalent, the right answer is a thin Layer adapter
inside the rewrite.

Open follow-up (deferred, not blocking): if/when the team wants to
move from SMTP to a transactional API (Resend, Postmark, SES API),
that's a provider-choice decision that swaps out the Layer's `Live`
implementation without changing handler call sites.

## Consequences

### Positive
- Existing email templates port over with minimal changes (return
  type changes from `Promise<EmailMessage>` to
  `Effect<EmailMessage, never, never>`)
- Mailpit dev/test integration unchanged
- Worker job handlers consume the `Mailer` Layer like any other
  service dependency

### Negative
- Yet another wrap-a-Promise Layer (acceptable — it's bounded)
- nodemailer's callback-style API for streams may need additional
  wrapping if streaming attachments become a concern (not currently)

### Neutral
- SMTP credentials still come from `@project/env/server`
- Email-enqueue composition (capabilities.md) unchanged in shape

## Promotion checklist (Phase 3)

- [ ] Move file to `docs/adrs/0020-email-send.md`
- [ ] Flip `status: proposed` → `status: accepted`
- [ ] Fill `verified_by:` with `packages/email/src/mailer-layer.ts` (or
      whatever the Layer module is named)
- [ ] Add `// ADR-0020` cite in that file

## References

- ADR-0009 — full rewrite onto Effect-TS (parent ADR)
- nodemailer docs: https://nodemailer.com
- `docs/capabilities.md` §"Email enqueue chain" — contract preserved
- Mailpit (dev/test SMTP catcher): https://mailpit.axllent.org
