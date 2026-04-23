---
date: 2026-04-23
type: handover
status: ready
next_session: magic-link-ux-pattern-2
---

# Session B Handover — Magic-Link Auth (Pattern 2)

Prior session (0d2496bc, 2026-04-23) completed the codebase upgrade audit
and shipped the mechanical / hygiene batch. This doc is the full context
for the next session: implement Better-Auth's `magic-link` plugin as an
additional sign-in option on the existing login page (Pattern 2 —
"Sign in with link instead" secondary link below the primary password
form).

## What's already on main (this session's commits)

Scorecard against `docs/superpowers/specs/2026-04-23-codebase-upgrade-audit.md`:

| Commit | Audit item(s) |
|---|---|
| `f2f1fad` | Vitest 4 doc sweep (premise already shipped) |
| `9552eba` | The audit doc itself |
| `edad111` | Items 1, 8, 1.6 — ghost dep `@hono/node-ws`, `@casl/react` 5→6, patch bumps |
| `67e31b6` | Items 2, 5 — `@hono/node-server` 1→2 + `@bull-board` 6→7 |
| `5430041` | ADR-0008 (WS path-prefix discipline) + thin server boot (`BULL_BOARD_PATH` SSOT, Bull-Board chaining, `rawHeaders` inlining) |
| `21196ef` | Items 4, 6 — nodemailer 6→8 + realtime convention tightening (decision tree at top of realtime section) |

Everything green at session close: `make lint` 32/32 cold, `make test-unit`
122 API + 71 web, `make test` 49/49 BDD.

## The decision (why Pattern 2)

Three patterns were evaluated:

1. **Dual primary CTAs** ("or" divider between password submit and
   "email me a link") — Slack / Notion.
2. **Secondary link** below primary — Linear / Vercel. *Picked.*
3. **Tabbed method picker** — Auth0 / similar developer-tool platforms.

Rationale for Pattern 2:

- Password stays primary, which avoids destabilizing the existing BDD
  (`e2e/features/auth/*` + `e2e/steps/auth/signin-form.ts`) and the
  password-reset plumbing that works well.
- Magic-link is a discoverable secondary option, zero layout churn.
- Pattern 3 (tabs) would be the right structural bet if we expected 3+
  auth methods to accumulate, but we explicitly decided against that
  investment now.

If/when passkey + 2FA + OAuth land later and the login page becomes
cluttered, migrate Pattern 2 → Pattern 3. That's a refactor we
deliberately deferred.

## Pattern 2 — visual shape

```
┌─────────────────────────────────────┐
│  Sign in to your account            │
├─────────────────────────────────────┤
│  Email     ________________         │
│  Password  ________________         │
│                                     │
│              [      Sign in      ]  │
│  Forgot password?   ·   Sign in     │
│                         with link   │
│                         instead     │
└─────────────────────────────────────┘
```

One existing form, one submit path. A secondary link under the primary
button routes to `/sign-in/magic-link` — a separate page with its own
email-only form and submit.

## Scope — concrete file list

### Backend / auth wiring

1. **`packages/auth/src/index.ts`** — register the `magicLink` plugin.

   ```ts
   import { magicLink } from "better-auth/plugins";

   export const auth = betterAuth({
     // ... existing config ...
     plugins: [
       magicLink({
         sendMagicLink: async ({ email, url, token: _token }) => {
           await sendEmail({
             template: "magic-link",
             to: email,
             vars: { signInUrl: url },
           });
         },
         // Defaults: 5-minute expiry, single-use token. Do not lower
         // expiry without a BDD adjustment — the "expired link" BDD
         // scenario advances fake time past the default.
       }),
     ],
   });
   ```

   The callback shape matches `sendResetPassword` at
   `packages/auth/src/index.ts:15-21` — delegate straight to our email
   queue, don't inline any rendering.

2. **`packages/email/src/templates/magic-link.ts`** — new template.
   Follow the shape of `packages/email/src/templates/password-reset.ts`:
   `MagicLinkVars` type + `magicLinkTemplate = { name: "magic-link" as const, render(vars) }` returning `{ subject, html, text }`.

3. **`packages/email/src/service.ts`** — extend the `EmailJobData`
   discriminated union with `{ template: "magic-link"; to; vars:
   MagicLinkVars }`. Imports and the type alias are at lines 7-17.

4. **`packages/email/src/handler.ts`** — extend the switch in
   `handleEmailJob` (lines 35-39) with a third branch for `"magic-link"`.
   Per `packages/email/CLAUDE.md` "Adding a template" — three-step
   recipe, already documented.

### Frontend — pages + routes

- **`apps/web/src/features/auth/magic-link-page.tsx`** — the request
  form. Email-only input, submit calls `signIn.magicLink({ email })`
  from `@project/auth`'s client. On success, show "Check your email
  for a sign-in link" confirmation state in the same component (no
  redirect — matches `forgot-password-page.tsx`).
- **`apps/web/src/features/auth/magic-link-verify-page.tsx`** — the
  landing page the emailed URL points at. Better-Auth's `magicLink`
  plugin expects `/magic-link/verify?token=<token>` by default; that
  maps cleanly to the route below. The page extracts the token from
  `useSearch`, calls the verify endpoint, and on success redirects to
  `/dashboard` (or `/`). On failure shows "This sign-in link has
  expired or is invalid" with a link back to `/sign-in/magic-link`.
- **`apps/web/src/features/auth/auth-client.ts`** — register the
  `magicLinkClient` plugin so `authClient.signIn.magicLink(...)` is
  available and typed. Better-Auth client plugin registration is one
  line in the plugins array.
- **`apps/web/src/features/auth/login-page.tsx`** — add a
  "Sign in with link instead" `<Link>` under the primary `Sign in`
  button, alongside or near the existing "Forgot password?" link.
  Keep markup symmetric (both are secondary text links).

### Routes

- **`apps/web/src/routes/sign-in/magic-link.tsx`** — thin route shell:
  `createFileRoute` → `MagicLinkPage`.
- **`apps/web/src/routes/sign-in/magic-link.verify.tsx`** — thin route
  shell for `/sign-in/magic-link/verify` → `MagicLinkVerifyPage`.

Use TanStack Router's nested-filename pattern (`magic-link.verify.tsx`)
or create a `magic-link/` folder — match the existing convention in
`apps/web/src/routes/`. Run `make routes` after creating to regenerate
`routeTree.gen.ts`.

**Note:** Better-Auth may default the emailed URL to
`/api/auth/magic-link/verify` (handled by Better-Auth's own handler at
`/api/auth/**`) rather than a client-side route. Check the
`sendMagicLink` callback's `url` argument on the first dev-loop test
before committing to client-side routes. If Better-Auth handles
verification server-side and redirects via its own handler, the
`magic-link-verify-page.tsx` and its route become much lighter (or
unnecessary).

### BDD

- **`e2e/features/auth/magic-link.feature`** — two scenarios:
  - **Happy path.** Given a signed-out user, when they click "Sign in
    with link instead" on the login page, submit the magic-link form
    with a valid email, fetch the resulting email from Mailpit, and
    click the link → they end up signed in on the dashboard.
  - **Expired link.** Given a magic-link email was sent, when the user
    waits past the link's expiry and then clicks it → they see the
    "expired or invalid" error page.
- **`e2e/steps/auth/magic-link.ts`** — step definitions. Pattern-match
  against `e2e/steps/auth/*` existing step files. Use role-based
  locators + landmarks per
  `docs/conventions.md#e2e-locator-hierarchy` (hard-enforced via
  `eslint-plugin-playwright` now).

### Docs

- **`packages/auth/CLAUDE.md`** — document the magic-link plugin
  registration + which flows it enables.
- **`apps/web/CLAUDE.md`** — one paragraph under the auth section
  about the `/sign-in/magic-link` route and the request→verify split.
- **`docs/adrs/0009-magic-link-as-secondary-auth.md`** (optional but
  good hygiene) — captures the Pattern 2 decision + the future
  migration path to Pattern 3 when 3+ methods exist. The template
  ships with two auth methods now (password, magic-link) — documenting
    the decision prevents the next author from re-litigating it.

## Pre-flight checklist (do this first, per prior session's evolution signal)

Two signals this session named the failure mode "act on a TODO without
verifying the premise." Apply here:

1. **Verify Better-Auth 1.6.7 exposes the `magicLink` plugin** — docs
   said yes, but check by reading `better-auth/plugins` exports in
   `node_modules/.pnpm/better-auth@1.6.7.../dist/plugins/index.d.mts`
   or similar. If the plugin is in a sub-path (e.g.,
   `better-auth/plugins/magic-link`), adjust the import.
2. **Verify the `sendMagicLink` callback signature** — the snippet in
   step 1 above is from the Better-Auth docs; Better-Auth 1.6.7's types
   are the ground truth. The callback might accept `(data: { email, url,
   token, request })` or similar. Match the actual type.
3. **Check whether the emailed URL points at a client route
   (`/sign-in/magic-link/verify`) or a Better-Auth-handled route
   (`/api/auth/magic-link/verify`).** This determines whether steps 6
   + 10 are needed or if Better-Auth handles verification internally.
4. **Grep `e2e/` for existing Mailpit helpers** —
   `packages/api/src/__tests__/password-reset.test.ts` uses
   `waitForMailTo` + `deleteAllMail`; reuse the same helpers in the
   BDD step defs. Don't reinvent.

## Testing expectation

- `make test-unit` must stay at 122 API + 71 web, or 123 API if you
  add a `magic-link-flow.test.ts` mirroring `password-reset.test.ts`
  (recommended — direct `auth.api` call + Mailpit assertion, no
  browser).
- `make test` grows from 49 → 51 scenarios after the two BDD additions.
  Both should pass on first BDD run — the auth flow is entirely
  Better-Auth-handled, minimal custom code.
- `make lint` stays 32/32 green. The new custom words (if any) go in
  `.config/cspell/custom-words.txt`.

## Anti-patterns to avoid (learned this session)

- **Don't hand-roll token generation or expiry.** Better-Auth owns the
  token lifecycle. The `sendMagicLink` callback receives `url` already
  fully assembled; just email it.
- **Don't add an `ignoreDependencies` silencer without a paired
  reason.** The evolution signal
  `2026-04-23-0445-knip-ignore-deps-no-reason-trap.yaml` captured this.
  If knip flags something during this session, pre-flight whether it's
  a ghost dep before silencing.
- **Don't open a PR.** Per `feedback_no_prs.md`, merge branches direct
  to main + push. `main` is the working branch for this solo repo.

## Suggested branching

```
git checkout -b feat/auth-magic-link
# ... implement ...
git checkout main
git merge --ff-only feat/auth-magic-link
git push origin main
```

Parallel note: `feat/auth-username-plugin` branch exists from earlier
work. Check its state before starting — if it's mid-flight on the
`username` plugin, bundling the `magic-link` plugin registration into
the same `plugins: []` array may cause a merge conflict. Check and
decide: rebase feat/auth-username-plugin onto main first, or pick a
rebase order, or land one fully before the other.

## Related references

- Audit itself: `docs/superpowers/specs/2026-04-23-codebase-upgrade-audit.md`
- Better-Auth plugin list (source of the magic-link option): audit §2.1
- Conventions — realtime decision tree, event naming, locator hierarchy:
  `docs/conventions.md`
- Password-reset as the template for the `sendMagicLink` integration
  shape: `packages/auth/src/index.ts:15-21`, `packages/email/src/templates/password-reset.ts`,
  `packages/api/src/__tests__/password-reset.test.ts`
- BDD locator hygiene enforcement:
  `e2e/eslint.config.js` + `docs/conventions.md#e2e-locator-hierarchy`
- ADR-0008 (WS path-prefix discipline, shipped this session) — unrelated
  to magic-link but a reference for how to write a small focused ADR
  if step 15 is taken.
