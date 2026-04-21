# packages/email — Transactional Email

Templates + send adapter. Mail is sent asynchronously through the
`@project/jobs` email queue; the worker (`apps/worker`) consumes jobs and
calls the nodemailer handler.

## Exports

- `@project/email/service` — `sendEmail({ template, to, vars })` enqueues the
  send. This is the API every caller should use.
- `@project/email/handler` — nodemailer transport + renderer. Only the worker
  imports this directly.

Templates are internal to the package (not subpath-exported) — callers pass
the template by name + typed vars via `sendEmail`.

## Adding a template — `src/templates/<name>.ts`

One file per template. Each exports a `name` constant + `render(vars)` that
returns `{ subject, html, text }`. Typed `Vars` is the SSOT for what the
caller must pass.

```typescript
// src/templates/welcome.ts
export type WelcomeVars = { userName: string; ctaUrl: string };

export const welcomeTemplate = {
  name: "welcome" as const,
  render(vars: WelcomeVars) {
    return {
      subject: "Welcome!",
      html: `<p>Hi ${vars.userName}, <a href="${vars.ctaUrl}">get started</a></p>`,
      text: `Hi ${vars.userName}, get started: ${vars.ctaUrl}`,
    };
  },
};
```

1. Create `src/templates/<name>.ts` with the pattern above.
2. Register in the template registry (see `src/handler.ts` / `service.ts`
   for the existing wiring — the registry maps `name` → render fn so the
   worker can look it up from the job payload).
3. Caller: `sendEmail({ template: "welcome", to, vars: { userName, ctaUrl } })`.

## Rules

- Never call nodemailer directly from app code — always go through the
  queue. This isolates SMTP latency/flakiness from request paths.
- `vars` typing is the contract — render functions must accept the exact
  shape the caller sends (no untyped `Record<string, unknown>`).
- Subject/html/text all come out of one render call — never build them
  piecewise in the caller.
