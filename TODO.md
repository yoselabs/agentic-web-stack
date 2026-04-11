# TODO

Decisions and tasks deferred during initial build (Phases 1-6).

Items marked **[template]** should be added to the template itself.
Items marked **[recipe]** should be documented as patterns — added per-project when needed.

## Architecture — Scaling to Medium Projects

- [x] **[template]** Feature-Sliced Design (FSD) — `features/`, `widgets/`, `shared/` layers with TanStack Router file-based routes as thin shells
- [ ] **[recipe]** API versioning — namespace tRPC routers by version when breaking changes needed
- [ ] **[recipe]** Module boundaries — enforce import rules between packages (no circular deps)
- [x] **[template]** Database seeding — `scripts/seed.ts` + `make db-seed` (demo user + sample todos via Better-Auth API)

## Auth

- [ ] **[recipe]** Google OAuth provider — add `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` to env schema and Better-Auth config
- [ ] **[recipe]** GitHub OAuth provider — same pattern, requires `user:email` scope
- [ ] **[template]** Email verification flow — Better-Auth `requireEmailVerification: true` + `sendVerificationEmail`
- [ ] **[template]** Password reset flow — Better-Auth `sendResetPassword`
- [ ] **[recipe]** 2FA / TOTP — Better-Auth `twoFactor()` plugin
- [ ] **[recipe]** Passkeys / WebAuthn — Better-Auth built-in support
- [ ] **[recipe]** Multi-tenancy — Better-Auth `organization()` plugin for row-level org isolation
- [ ] **[recipe]** RBAC — Better-Auth `createAccessControl()` + `newRole()` for custom roles

## Payments

- [ ] **[recipe]** Stripe integration — `stripe` npm package, webhook handler on Hono
- [ ] **[recipe]** Subscription model — link Stripe customer to Better-Auth user, sync via webhooks
- [ ] **[recipe]** Billing portal — Stripe Customer Portal for self-service plan management
- [ ] **[recipe]** Usage metering — track usage per org/user for metered billing

## Email

- [ ] **[recipe]** Transactional email — Resend (recommended), SendGrid, or AWS SES
- [ ] **[recipe]** Email templates — React Email for type-safe templates
- [ ] **[recipe]** Email preview — dev mode preview route for email templates

## File Storage

- [ ] **[template]** File upload endpoint — Hono multipart/form-data with `bodyLimit` middleware
- [ ] **[template]** S3-compatible storage — `@aws-sdk/client-s3` with presigned URLs
- [ ] **[recipe]** Image processing — Sharp for thumbnails/resizing on upload
- [ ] **[recipe]** Local dev storage — MinIO in docker-compose for S3-compatible local dev

## Real-time

- [ ] **[recipe]** tRPC subscriptions — SSE via `httpSubscriptionLink` (preferred over WebSocket)
- [ ] **[recipe]** WebSocket support — Hono `upgradeWebSocket()` + `@hono/node-ws`
- [ ] **[recipe]** Live cache invalidation — server events → React Query invalidation
- [ ] **[template]** Agent skill: "add real-time updates to a tRPC feature" — SKILL.md with pattern for wiring WS events to mutations + React Query cache merge (deferred from 2026-04-17 hackathon prep; Track 2 of ADLC prep)
- [ ] **[template]** Plan template: "add WS to feature X" — skeleton plan file that agents can fill in when retrofitting a feature with real-time updates
- [ ] **[template]** Reference examples for agents — annotated code snippets (room subscription, user-targeted unicast, replay-on-connect) that agent skills can cite

## Background Jobs

- [ ] **[recipe]** Job queue — BullMQ + Redis, or Trigger.dev
- [ ] **[recipe]** Scheduled tasks — cron-style recurring jobs
- [ ] **[recipe]** Email queue — async email sending via job queue

## Monitoring & Observability

- [x] **[template]** Structured logging — `pino` for JSON logs in production, pretty in dev
- [x] **[template]** Health check endpoint — `/health` returning DB connectivity + uptime
- [ ] **[recipe]** Error tracking — Sentry (has Hono SDK)
- [ ] **[recipe]** Analytics — PostHog or Plausible
- [ ] **[recipe]** OpenTelemetry — distributed tracing across Hono + tRPC
- [ ] **[recipe]** Audit logging — who changed what, stored in DB

## Infrastructure

- [x] **[template]** CI pipeline (GitHub Actions) — lint + typecheck + BDD tests on PRs
- [ ] **[recipe]** Docker app containers — Dockerfiles for apps/web and apps/server
- [ ] **[recipe]** Production docker-compose — full stack with app containers + Postgres + Traefik
- [ ] **[recipe]** Multi-environment config — dev/staging/prod env var management
- [ ] **[recipe]** CDN — static asset caching with cache-busting

## Security

- [x] ~~Security audit history~~ — `agent-harness security-audit-history` clean, no leaked secrets
- [ ] **[recipe]** Rate limiting — in-memory rate limiter causes test flakiness, real apps need Redis-backed solutions (`@upstash/ratelimit`)
- [x] **[template]** Security headers — CSP, X-Frame-Options, HSTS via Hono secureHeaders middleware
- [ ] **[recipe]** CSRF protection — for custom forms beyond Better-Auth
- [ ] **[recipe]** Input sanitization — sanitize HTML in user-generated content (DOMPurify)
- [ ] **[recipe]** Row-level security — Prisma middleware to enforce user/org data isolation

## Quality & Testing

- [x] **[template]** Integration tests — Vitest with tRPC callerFactory for direct procedure testing
- [x] **[template]** Worktree-compatible testing — container name + port derived from directory MD5 hash (range 5400-5499)
- [x] **[template]** Add `packageManager` field for strict pnpm version
- [ ] **[recipe]** Parallel viewport testing — separate DB + server per viewport project for concurrent desktop/mobile runs (~6s savings at 50+ scenarios)
- [ ] **[recipe]** Visual regression testing — Playwright screenshot comparison
- [ ] **[recipe]** Load testing — k6 or Artillery for API performance baseline
- [ ] **[recipe]** Contract testing — ensure tRPC client/server stay in sync across deploys

## UI / UX

- [x] **[template]** shadcn/ui base components — Button, Input, Card, Label + CSS theme variables (Tailwind v4)
- [x] **[template]** Error pages — 404, 500 with TanStack Router `notFoundComponent` / `errorComponent`
- [x] **[template]** Loading states — `defaultPendingMs`/`defaultPendingMinMs` on router (routes use React Query, not loaders)
- [x] **[template]** Toast notifications — Sonner for success/error feedback on mutations
- [x] **[template]** Layout components — Logo, Navbar (desktop + mobile Sheet hamburger), UserBlock extracted from `_authenticated` layout
- [ ] **[recipe]** Dark mode — Tailwind dark mode with theme toggle + localStorage persistence
- [ ] **[recipe]** Form library — TanStack Form or react-hook-form for complex forms with validation
- [x] **[template]** Responsive design — mobile viewport (390×844) BDD tests, hamburger-aware step helpers, DB reset between viewports, `@mobile` tag for mobile-only scenarios
- [x] **[recipe]** Drag and drop — @dnd-kit/sortable with position-based ordering on todo list

## AI Features

- [ ] **[recipe]** `@tanstack/ai` — provider-agnostic AI SDK with streaming, tool calling, agent loops
- [ ] **[recipe]** AI chat component — streaming responses with tool use approval
- [ ] **[recipe]** Server functions for AI — `createServerFn` for secure API key usage

## Internationalization

- [ ] **[recipe]** i18n — `next-intl` or `react-i18next` for multi-language support
- [ ] **[recipe]** RTL support — Tailwind RTL plugin for right-to-left languages
- [ ] **[recipe]** Date/number formatting — `Intl` API with locale-aware formatting

## Search

- [ ] **[recipe]** Full-text search — PostgreSQL `tsvector` + `tsquery` via Prisma raw queries
- [ ] **[recipe]** Search UI — debounced input with React Query + search params
- [ ] **[recipe]** External search — Meilisearch or Typesense for advanced search needs

## Developer Experience

- [x] **[template]** Route tree generation fix — wait for routeTree.gen.ts instead of fixed sleep
- [ ] **[recipe]** API documentation — auto-generated from tRPC router types (trpc-openapi)
- [ ] **[recipe]** `@tanstack/intent` — deeper investigation of AI skills system
- [ ] **[recipe]** Database GUI — Prisma Studio alternative: Drizzle Studio, pgAdmin in docker-compose
- [ ] **[recipe]** Git hooks — commitlint for conventional commits

---

## Demo mode: `docker compose up` runs the whole app

Current `docker-compose.yml` only runs Postgres (dev DB). For demo purposes, `docker compose up` should start a fully working instance — no `make dev`, no local toolchain — so people can clone + run + click around.

### What's needed
- **`apps/web/Dockerfile`** — multi-stage: `pnpm install` → `vite build` → runtime image serving `.output/server/index.mjs`. Single-runtime image (bun only — see below).
- **`apps/server/Dockerfile`** — multi-stage: `pnpm install` → `tsc` → runtime image running the compiled server. Single-runtime image (bun only).
- **`docker-compose.yml`** gains two services (`web`, `server`) wired to Postgres. Existing `postgres` service stays as-is.
- **Env wiring** for inter-container comms: `DATABASE_URL=postgresql://postgres:postgres@postgres:5432/app`, `CORS_ORIGIN=http://localhost:3000`, `VITE_API_URL=http://localhost:3001` (baked into web build), `BETTER_AUTH_URL=http://localhost:3001`, `BETTER_AUTH_SECRET` from `.env` or compose env.
- **Schema provisioning**: `prisma db push` on server container boot (or a one-shot `migrate` sidecar service).
- **Optional**: `make db-seed` equivalent runs automatically on first boot so a demo user exists.

### Runtime: bun only, not bun + node
Images should install bun only, not both. Justification:
- `bun` runs TS natively (`src/index.ts`) — no `tsc` build step needed for the server in the image.
- `bun` runs the Nitro `.output/server/index.mjs` produced by `vite build` — confirmed in dev.
- Dropping node + pnpm from runtime images cuts image size ~300MB.
- Caveat: `vite build` itself (in the build stage) still needs node. So the **build stage** uses `node + pnpm + bun`; the **runtime stage** uses bun only. Multi-stage builds ship only the runtime layer.

### Trigger
- When we want to hand someone "try this locally in 1 minute" or put this on a demo server without the dev toolchain.
- Before any public release or conference demo.

### Est effort
2–3 hours. Not cleanup — a real feature, deserves its own branch.

---

## `spike/bun-test-migration` — deferred ideas

Surfaced during the bun-test + build-for-test + e2e-hardening spike (branch `spike/bun-test-migration`). Each item: what it is, why we didn't do it, what would make it worth picking up.

### Web-build hash-gate (skip `vite build` when inputs unchanged)
Same pattern as `packages/db/scripts/generate.ts`. Hash `apps/web/src/**`, workspace deps, `vite.config.ts`, `pnpm-lock.yaml`. Save ~5s per `make test`.
- **Why not**: 5s is marginal, and adds a new cache surface to debug.
- **Trigger**: rebuild time grows past 10s, or agent loops accumulate >30s/day of rebuild wait.

### `make test-server` background daemon
`vite build --watch` + persistent Nitro server. `make test` reuses via `reuseExistingServer`. Near-zero rebuild per run.
- **Why not**: requires lifecycle management; overkill vs. current 5s incremental.
- **Trigger**: inner-loop test runs become painful.

### Auth fixture for `I sign out and sign in as` (`e2e/steps/todos.ts:32`)
That step still does UI-based sign-up mid-scenario. Migrate to `signInViaApi` (helper already exists in `auth.ts`) after the UI sign-out.
- **Why not**: low traffic (2–3 scenarios), scope creep.
- **Trigger**: those scenarios flake, or the signup form gains more fields.

### Runtime-derived unique emails (email-uniqueness option B)
Playwright fixture auto-generating `${scenarioTitleHash}@example.com`. We shipped option A (lint check) instead.
- **Why not**: lint catches it at commit time, zero runtime cost.
- **Trigger**: someone bypasses the lint, or feature files exceed ~50 scenarios.

### `apps/server` local dev under bun (not just tests)
Currently `dev = tsx watch`. Tests already use `bun src/index.ts`. Local dev could match.
- **Why not**: hot dev path, untested with Better-Auth + HMR.
- **Trigger**: dev restart time becomes painful, or we drop tsx as a dep.

### Reverse proxy for `VITE_API_URL`
`/api/*` proxied from web to API, eliminating the build-time env-var bake. Research's "option 3".
- **Why not**: refactor of `apps/web/src/shared/api-client.ts` + Better-Auth URL handling.
- **Trigger**: VITE_API_URL drift causes a bug, or we add more VITE_* build-time vars.

### Runtime config via `window.__ENV`
Alternative to build-time VITE_* vars — server injects config at HTML render. Build-once-deploy-many.
- **Why not**: reverse-proxy (above) is the cleaner answer to the same problem.
- **Trigger**: single-artifact-multiple-environments becomes a requirement.

### `__extends` stderr noise in Nitro SSR (~17/run)
Root cause: `react-remove-scroll-bar` + `react-style-singleton` (transitive via Radix) are CJS-only with tslib imports; Nitro's bundler mis-handles interop. Tests pass — error caught by TanStack Router per-match boundary.
- **Workaround available** in `apps/web/vite.config.ts`:
  ```ts
  resolve: { alias: { tslib: 'tslib/tslib.es6.js' } },
  ssr: { noExternal: ['react-remove-scroll-bar', 'react-style-singleton', 'react-remove-scroll', 'tslib'] },
  ```
- **Why not now**: we're on `nitro-nightly` + Vite 8 rolldown (both moving targets); upstream churn likely fixes it.
- **Trigger**: stderr blocks debugging, or Nitro stabilizes and error persists → file upstream.
- **Refs**: [vite#19032](https://github.com/vitejs/vite/issues/19032), [TanStack/router#6151](https://github.com/TanStack/router/issues/6151).

### `data-hydrated` placement risk
Currently in `RootDocument`'s `useEffect` at `apps/web/src/routes/__root.tsx:42`. If a suspense boundary resolves before children mount, the attribute could lie. Not observed.
- **Trigger**: `waitForHydration` passes while page is still visually unhydrated → move the effect into a leaf component.

### `BETTER_AUTH_SECRET` zero-conf default vs. prod safety (out of spike scope)
`packages/env/src/server.ts` ships a `change-me-to-a-random-32-char-secret-key` default that's 32 chars (passes the min). In prod, an unset `BETTER_AUTH_SECRET` silently boots with a publicly-known signing key — anyone who reads the source can forge sessions. Spec §D6 claims "defaults never fire in prod" but the code doesn't enforce it.
- **Fix**: add a `.refine()` that rejects the literal default when `NODE_ENV === "production"`.
- **Not done here**: out of this spike's scope, but worth a follow-up ticket before any prod deploy.

### Source maps on prod build
`build.sourcemap: true` for debugging test failures against the built Nitro bundle.
- **Why not**: tests pass, no current failure needs it.

### CI config review for build-for-test
`.github/workflows/*` untouched. CI pays the ~15s cold vite build every run. Likely fine; worth reading through when this branch nears merge.

### Dead-ends (not todos, just remembered)
- **Vitest under Bun runtime** (`bun --bun vitest`): blocked by Vite SSR transform losing Zod's named export. Moved to `bun test` instead. Not revisitable until [bun#4145](https://github.com/oven-sh/bun/issues/4145) closes.
- **Prisma `--skip-if-unchanged`**: no native flag. We built `packages/db/scripts/generate.ts` (content-hash). Open request: [prisma/prisma#29308](https://github.com/prisma/prisma/issues/29308).

---

## Rejected

| Tool | Why not |
|------|---------|
| **Storybook** | AI agents can't visually verify rendered components — they'd write stories mechanically without visual review, producing tautological tests. Humans open it a few times then rarely again. BDD tests already verify components work in real pages. shadcn/ui components are pre-tested upstream. Overhead without payoff for an AI-agent-driven workflow. Add per-project if a human designer joins. |
