# TODO

Decisions and tasks deferred during initial build (Phases 1-6).

Items marked **[template]** should be added to the template itself.
Items marked **[recipe]** should be documented as patterns — added per-project when needed.

## Immediate TODO

Next-up work surfaced in the 2026-04-21 handover. Not yet started — pick up one at a time.

- [ ] **Session decorator for Storybook** — add `withSession(user)` decorator (mocked auth context + MSW tRPC handler; no backend). Removes the last `!test` tag on `apps/web/src/widgets/app-navbar.stories.tsx`, enables a11y coverage on AppNavbar.
- [ ] **Close `.config/allowlists/test-siblings.json` ratchet** — write the 9 missing `use-*.test.ts` siblings one feature at a time, shrinking the allowlist to empty. Current misses: `auth/use-forgot-password`, `auth/use-reset-password`, `todo-list/use-leader-tab`, `todo-list/use-todo-list-live-updates`, `todo-list/use-todo-lists`, `todo-list/use-todos`, `user/use-debounced-value`, `user/use-user-inbox`, `shared/use-optimistic-mutation`.
- [ ] **Promote nursery rules `warn` → `error`** — fix incidental hits first, then flip in `biome.json`: `useExhaustiveSwitchCases`, `useExplicitType`, `useSortedClasses` (nursery section).
- [ ] **Vitest 4 upgrade pass** — unlocks `vitest-browser-react@2.x`, may simplify the storybook-project wiring. *(May be absorbed or reordered by the pending upgrade audit — see below.)*
- [ ] **`check-spec-acceptance.ts`** — walk `docs/superpowers/specs/*` acceptance criteria and fail CI if any text assertion doesn't resolve. Monitors whether merged spec acceptance criteria actually fired. Spec docs are a great handover surface but currently unverified post-merge.
- [ ] **Codebase upgrade audit** — in flight (2026-04-21). Will produce a prioritized list of major-version upgrades and opportunities to leverage new features. Expected to reframe the Vitest 4 item above.
- [ ] **E2E locator strategy upgrade — role + landmark-scoped locators** — bare `page.locator("li", { hasText: ... })` doesn't compose. Proof: the activity-feed branch added a second `<ul>` (activity entries) with shared text as todo rows, which broke 12 pre-existing `$listId` scenarios; we retreated to `data-testid="todo-row"` scoping as the fix. Migrate step defs to a 4-tier hierarchy: (1) role + name scoped under a landmark — `getByRole("main").getByRole("listitem", { name })` — always first choice, (2) label / placeholder for form fields, (3) scoped text within a landmark, (4) `getByTestId` only as an escape hatch for components whose semantics don't map cleanly. Add `aria-label`s to `<li>` todo rows and activity entries so role+name works. Document the hierarchy in `docs/conventions.md` alongside the `tracked()` convention section. Cross-cutting — own PR, not bundled with feature work.
- [ ] **Capabilities / patterns index (parked)** — agents struggle to discover what exists in the template when implementing features (auth flows, real-time, background jobs, rate limiting, ratchets, lint checks, etc.). Idea: describe capabilities + cross-linked pattern docs (e.g., "background job pattern") so agents can navigate by intent. *Deferred — revisit after the items above land.*

> **Note:** the "Rejected" table at the bottom of this file still lists Storybook as rejected, but Storybook has since been adopted (see `apps/web/src/widgets/app-navbar.stories.tsx` and `docs/adrs/0006-storybook-and-visual-regression.md`). The Rejected entry should be removed or updated next time this file is touched.

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
- [x] **[template]** Docker app container — single root `Dockerfile` (5-stage multi-stage build) reused across migrate/server/web via YAML anchors. See `spike/demo-mode`.
- [x] **[template]** Demo-mode docker-compose — `docker compose up` boots full stack (postgres + migrate + server + web) with seeded user. See `docker-compose.yml`.
- [ ] **[recipe]** Production docker-compose — Traefik + TLS + external Postgres, derived from demo-mode
- [ ] **[recipe]** CI smoke test for `docker compose up` — bring stack up in CI, hit `/health`, tear down. Guards against demo-mode rot.
- [ ] **[recipe]** Real migrations via `prisma migrate deploy` — demo-mode uses `prisma db push`; swap in once migrations land in `packages/db/prisma/migrations/`
- [ ] **[recipe]** Multi-environment config — dev/staging/prod env var management
- [ ] **[recipe]** CDN — static asset caching with cache-busting

## Security

- [x] ~~Security audit history~~ — `agent-harness security-audit-history` clean, no leaked secrets
- [ ] **[recipe]** Rate limiting — in-memory rate limiter causes test flakiness, real apps need Redis-backed solutions (`@upstash/ratelimit`)
- [x] **[template]** Security headers — CSP, X-Frame-Options, HSTS via Hono secureHeaders middleware
- [ ] **[recipe]** CSRF protection — for custom forms beyond Better-Auth
- [ ] **[recipe]** Input sanitization — sanitize HTML in user-generated content (DOMPurify)
- [ ] **[recipe]** Row-level security — Prisma middleware to enforce user/org data isolation
- [ ] **[template]** Server-bundle import hygiene — lint gate + bundle analyzer (see §Bundle Hygiene Guardrails below)

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

## `spike/demo-mode` — process lessons

Reflection from the demo-mode spike. Patterns observed across the two review rounds + the Task 9 fixup — captured here so the next spike avoids the same traps.

### Pattern: Confidently wrong about paths (the big one)
Asserted filesystem paths from memory or from a sibling project without grepping. Instances:
- `@project/auth/server` import (didn't exist — was supposed to be `@project/auth`)
- `/app/node_modules/.bin/prisma` (doesn't exist in pnpm-hoisted layout; correct is `./node_modules/.bin/prisma` after `cd /app/packages/db`)
- `scripts/` missing from runtime COPY list
- `@project/auth` + `@project/db` not resolvable under `--prod` for the root-level seed script
- **Fix**: add a "path audit" step to spec review. Every filesystem path or import path mentioned in a spec gets a one-liner verification (`git grep`, `ls`, `jq '.exports' package.json`). Cost: ~30s per path.

### Pattern: Reference drift between similar projects
Mixed up details between `agentic-web-stack` and the sibling `a2sdlc-demo3`. Instances:
- Claimed `${DEV_DB_*}` interpolation existed in our `docker-compose.yml` (it was in a2sdlc-demo3, not here — our file already had literals)
- Alpine vs Debian user-creation syntax (`addgroup --system` works on a2sdlc-demo3's Alpine base; our `oven/bun:1-slim` is Debian and needs `groupadd`/`useradd`)
- **Fix**: when citing "pattern borrowed from X," quote the exact lines from X in the spec, don't paraphrase from memory.

### Pattern: Runtime-flag assumptions
Assumed CLI flags port across runtimes without verifying. Instances:
- `bun --env-file-if-exists=<path>` — tsx has it, bun does not (silently accepts unknown flags, `.env` never loaded)
- **Fix**: for any CLI swap (tsx→bun, node→bun, etc.), run the exact command with a trivial proof (`echo FOO=bar > /tmp/t && bun --env-file=/tmp/t -e 'console.log(process.env.FOO)'`) before trusting flag parity.

### Pattern: Cross-spec coherence
Missed the `@project/auth` barrel-rule carve-out in `2026-04-18-zero-conf-architecture-handover.md` and proposed reversing it in the demo-mode spec. The reviewer caught it.
- **Fix**: `ls docs/superpowers/specs/` + `grep -l <topic>` before writing new specs that touch shared rules. Read related docs first.

### Pattern: Sloppy strings
`BETTER_AUTH_SECRET` labeled "32-chars" was actually 36. Caught in final code review, amended.
- **Fix**: when a string encodes a length/hash/count in its own value, sanity-check it (`echo -n "..." | wc -c`). Cheap, embarrassing to miss.

### Pattern: Stale cross-references
`TODO.md` still had the "Demo mode: docker compose up runs the whole app" section as pending after we shipped it. Caught in the final full-branch review.
- **Fix**: before merge, `grep -l "<spec-filename-or-topic>" TODO.md docs/ README.md` and update anything still pointing to the old state.

### Concrete follow-ups (files + cadence)
- [ ] **[recipe]** `make lint-docker` target — runs `docker buildx build --target prod-deps` + `--target runtime` in a throwaway container + `ls /app/packages/*/src`. Adds ~2 min to `make lint` when Dockerfile/compose/workspace files change. Catches Alpine-vs-Debian, COPY omissions, workspace-file mismatches at lint time rather than at integration time. Only run when those files changed (conditional on `git diff --name-only` against base).
- [ ] **[habit]** Spec-review checklist addition: "Path audit — every filesystem/import path mentioned in this spec has been verified to exist in the current repo." One-line reviewer prompt.
- [ ] **[habit]** Cross-spec search before writing new specs — `ls docs/superpowers/specs/` and read any related handover docs. Add to brainstorming skill prompt.

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

### ~~`apps/server` local dev under bun (not just tests)~~ — done in `spike/demo-mode`
`apps/server/package.json` now uses `bun --watch` with a POSIX-sh conditional to preserve `--env-file-if-exists` semantics. `tsx` dropped from apps/server devDeps. Verified: hot-reload works, Better-Auth survives reload, `.env` override still wins.

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

## Bundle Hygiene Guardrails

Defense-in-depth against server code leaking into the web bundle. Both should ship together; each catches what the other misses. Referenced from the "Security" section.

### Gate 1: Lint rule (primary enforcement) — `scripts/check-server-imports.ts`

**Goal:** fail `make lint` when `apps/web/src/**` contains a value-import from a server-only module. Allow `import type { ... }` from the same paths (elides at compile time).

**Why not Biome's `noRestrictedImports`:** on Biome 1.9 (installed), the rule doesn't distinguish value imports from type-only imports — would forbid `import type { AppRouter }` too, breaking the intended pattern.

**Why not Biome 2.x GritQL plugins:** would require upgrading Biome (major-version bump), learning GritQL, and a known bug (biome#5801) is that GritQL patterns don't match different import-statement kinds reliably. Not mature enough.

**Why not Rego/conftest:** not currently used in the repo. Adding OPA + conftest as a new tool in the lint pipeline for one rule is overkill, and Rego isn't well-suited to JS AST/substring matching.

**The idiomatic fit:** extend the existing `scripts/check-env-boundary.ts` + `e2e/scripts/check-feature-emails.ts` pattern — a short TS script using ripgrep, wired into `make lint`. Zero new deps.

**Spec:**

- File: `scripts/check-server-imports.ts`.
- Scope: `.ts` / `.tsx` under `apps/web/src/**`.
- Forbid value imports (`^import\s+\{`) from:
  - `@project/api/router`
  - `@project/api/domains/*/http`
  - `@project/api/domains/*/service`
  - `@project/auth` (the root — not the `/constants` subpath)
  - `@project/db`
- Allow `^import\s+type\s+\{` from those same paths (and bare `import type {}` augmentation loads).
- Allowlist escape hatch: hardcoded list of paths that may legitimately break the rule (should stay empty initially; each addition reviewed).
- Fail message: cite the file, the offending line, and "Use `import type` — value imports leak the server bundle into the client. See root CLAUDE.md."
- Wire into `Makefile`'s `lint` target right after `check-env-boundary.ts`.

**Estimated effort:** 30-60 min (script + test that it fires on a crafted violation + hook into Makefile).

### Gate 2: Bundle analyzer (diagnostic) — `scripts/check-bundle-hygiene.ts`

**Goal:** catch escapes the lint rule can't see. Examples:

- A package re-exports something server-only transitively (e.g., `hono` in a future minor version starts re-exporting a Node built-in).
- A dynamic `import()` with a computed path bypasses the static lint rule.
- A helper file accidentally pulls a server module via a deep import chain the reviewer missed.

**What it is:** `rollup-plugin-visualizer` (most common) emits a JSON stats file + HTML treemap of the final bundle's module graph. Unlike the grep preflight from Task 5, it reads the **pre-minification** module graph, so `@project/auth` vs `better-auth/react` is unambiguous. Identifier minification + string-literal matching + Nitro's multiple output paths (`.output/` vs `apps/web/dist/`) make grep fragile and high-false-positive (`better-auth/react` matches the forbidden `better-auth` regex too).

**Spec:**

- Add `rollup-plugin-visualizer` to `apps/web` devDeps.
- In `apps/web/vite.config.ts`, gate it on `ANALYZE=1`:
  ```ts
  process.env.ANALYZE && visualizer({
    filename: ".stats/bundle.json",
    template: "raw-data",
    gzipSize: true,
  })
  ```
- New Makefile target `make check-bundle`:
  ```make
  check-bundle:
      ANALYZE=1 pnpm --filter @project/web build
      bun scripts/check-bundle-hygiene.ts
  ```
- `scripts/check-bundle-hygiene.ts` (~30 lines): parse `.stats/bundle.json`, fail if any module ID matches:
  - `/^better-auth($|\/(?!react|client))/` — matches bare `better-auth` and `better-auth/api`; allows `/react` + `/client`
  - `/^@prisma\/client/`
  - `/^papaparse/`
  - `/^@project\/auth(?!\/constants)/`
  - `/^@project\/db/`
- Wire into CI (`.github/workflows/ci.yml`) as a separate job — doesn't need to run in the inner dev loop.
- Optional: write one deliberate-leak test fixture to confirm the analyzer actually fails when it should.

**Estimated effort:** 60-90 min (plugin install, vite config, check script, make target, CI job). Worth adding a "canary" test that introduces a known leak and confirms the analyzer catches it.

### Why both (can't one replace the other?)

- Lint alone misses transitive leaks through packages you don't control. The server can change underneath you; the import site stays clean while the graph silently grows.
- Analyzer alone is slow (requires a full build), runs late (after CI), and if someone ignores the failure they're blocked on a fix they could've caught at `make lint`.
- Grep alone (today's preflight) is unreliable.

Lint fails in seconds on typos. Analyzer catches the weird stuff in minutes on CI. Defense in depth.

---

## Rejected

| Tool | Why not |
|------|---------|
| **Storybook** | AI agents can't visually verify rendered components — they'd write stories mechanically without visual review, producing tautological tests. Humans open it a few times then rarely again. BDD tests already verify components work in real pages. shadcn/ui components are pre-tested upstream. Overhead without payoff for an AI-agent-driven workflow. Add per-project if a human designer joins. |
