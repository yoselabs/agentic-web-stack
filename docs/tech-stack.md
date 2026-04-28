# Tech Stack — Runtime Components

Snapshot of the **runtime** dependencies powering this template, grouped by
the role each fills. Versions are exact at tag
[`stable-pre-effect`](../README.md) — this is the inventory we'd compare
against when evaluating a swap (e.g., Effect-TS per ADR-0009, a Java/Kotlin port).

Companion docs:
- [`capabilities.md`](./capabilities.md) — *what those picks give us* (cross-linked from each entry below).
- [`dev-tooling.md`](./dev-tooling.md) — build/test/lint tooling. Largely stack-agnostic; survives runtime swaps.
- [`package-taxonomy.md`](./package-taxonomy.md) — *where new code goes* in the workspace layout.

Entry shape:
`<name> <exact-version> — <role>. Used in: <packages>. Enables: <capability>.`

The **Enables** column links to the [`capabilities.md`](./capabilities.md)
entry that names this dependency as part of its implementation. If a runtime
dep has no capability documented, that's a gap — flag it.

---

## 1. Runtime / language platform

- **Node.js** `>=22` — JS runtime for `apps/server`, `apps/worker`, and `apps/web` SSR. Pinned via root `package.json#engines.node`.
- **TypeScript** `6.0.3` — primary language. Compiled via `tsc -b` (project references); not transpiled at runtime (Node runs `.ts` via Vite/tsx where needed, otherwise built output).

## 2. Database & ORM

- **prisma** `7.8.0` — ORM + migration tool. Used in: `@project/db`. Enables: [Transactions + race-safe locking](./capabilities.md#transactions--race-safe-locking).
- **@prisma/client** `7.8.0` — generated client. Used in: `@project/db`, `@project/auth`. Schema is the canonical type source for the rest of the stack.
- **@prisma/adapter-pg** `7.8.0` — driver adapter for PostgreSQL. Used in: `@project/db`.
- **pg** `8.20.0` — PostgreSQL client (transitive runtime via the adapter, but pinned in `@project/db`).

## 3. HTTP / RPC / API surface

- **hono** `4.12.14` — HTTP server + routing. Used in: `apps/server`, `packages/api` (sub-routers). Enables: [Direct HTTP (non-tRPC) routes](./capabilities.md#direct-http-non-trpc-routes).
- **@hono/node-server** `2.0.0` — Node adapter. Used in: `apps/server`.
- **@hono/trpc-server** `0.3.4` — mounts tRPC inside Hono. Used in: `apps/server`.
- **@hono/zod-validator** `0.7.6` — Zod-backed request validation for direct Hono routes. Used in: `packages/api`. Enables: [Input validation (strict)](./capabilities.md#input-validation-strict), [Direct HTTP (non-tRPC) routes](./capabilities.md#direct-http-non-trpc-routes).
- **@trpc/server** `11.16.0` — RPC framework (procedures, routers, context). Used in: `packages/api`. Enables: [Auth session + guarded procedures](./capabilities.md#auth-session--guarded-procedures), [Activity feed — resumable stream](./capabilities.md#activity-feed--resumable-append-only-event-stream).
- **@trpc/client** `11.16.0` — typed RPC caller. Used in: `apps/web`.
- **@trpc/tanstack-react-query** `11.16.0` — React Query bindings for tRPC. Used in: `apps/web`. Enables: [Optimistic mutations](./capabilities.md#optimistic-mutations), [Route-loader data prefetch](./capabilities.md#route-loader-data-prefetch).
- **ws** `8.20.0` — WebSocket server (powers tRPC subscriptions and direct WS routes). Used in: `apps/server`. Enables: [Realtime fan-out](./capabilities.md#realtime-fan-out-per-entity--user-inbox), [Live-update hooks](./capabilities.md#live-update-hooks-leader-tab--relay). See also ADR-0008 (WebSocket path-prefix discipline).

## 4. Auth

- **better-auth** `1.6.7` — sessions, email/password, magic link, password reset, role/admin gating, plugin system. Used in: `packages/auth`, mounted via Hono in `apps/server`. Enables: [Auth session + guarded procedures](./capabilities.md#auth-session--guarded-procedures), magic-link sign-in, password reset.

## 5. Validation

- **zod** `4.3.6` — schema validation for tRPC inputs, Hono request bodies, and `@project/env`. Used everywhere that crosses a boundary. Enables: [Input validation (strict)](./capabilities.md#input-validation-strict).
- **@t3-oss/env-core** `0.13.11` — typed env vars with Zod defaults. Used in: `@project/env`. Enables: [Env access](./capabilities.md#env-access).

## 6. Authorization

- **@casl/ability** `6.8.1` — declarative ability/rule engine. Used in: `packages/api`. Enables: [CASL-style authorization](./capabilities.md#casl-style-authorization).
- **@casl/prisma** `1.6.2` — generates Prisma `where` filters from CASL rules (query scoping). Used in: `packages/api`.
- **@casl/react** `6.0.0` — `<Can />` component + ability context. Used in: `apps/web`.

## 7. Realtime

- **ioredis** `5.10.1` — Redis client (also reused by jobs and rate-limit). Used in: `packages/realtime`, `packages/jobs`, `packages/rate-limit`. Enables: [Realtime fan-out](./capabilities.md#realtime-fan-out-per-entity--user-inbox).

  *Realtime is a code-level abstraction (`Channel` interface with `MemoryChannel` for dev/test, `RedisChannel` for prod) — Redis is one of two implementations, not the only one. See `packages/realtime/` and ADR-0001.*

## 8. Jobs / queues / scheduling

- **bullmq** `5.76.1` — Redis-backed job queue + cron scheduling. Used in: `packages/jobs`, `apps/worker`. Enables: [Background jobs + crons](./capabilities.md#background-jobs--crons), [Email](./capabilities.md#email).
- **@bull-board/api** `7.0.0` — Bull Board core. Used in: `apps/server`. Enables: Bull Board admin dashboard.
- **@bull-board/hono** `7.0.0` — mounts Bull Board UI under Hono. Used in: `apps/server`.

## 9. Email

- **nodemailer** `8.0.5` — SMTP transport (Mailpit in dev, SES/Postmark in prod). Used in: `packages/email`. Enables: [Email](./capabilities.md#email).

## 10. Rate limiting

- **rate-limiter-flexible** `11.0.1` — token-bucket limiter with memory + Redis stores. Used in: `packages/rate-limit`. Enables: [Rate limiting](./capabilities.md#rate-limiting).

## 11. Frontend framework + SSR

- **react** `19.2.5` — UI framework. Used in: `apps/web`, `packages/ui`.
- **react-dom** `19.2.5` — DOM renderer.
- **@tanstack/react-start** `1.167.42` — full-stack meta-framework (Vite + Router + SSR). Used in: `apps/web`. Enables: [Route-loader data prefetch](./capabilities.md#route-loader-data-prefetch).
- **nitropack** `3.0.1-20260422` *(nightly)* — SSR HTTP server underlying TanStack Start.
- **vite** *(via TanStack Start)* — dev server + build tool.
- **tailwindcss** `4.2.4` + **@tailwindcss/vite** `4.2.4` — utility CSS, Vite-integrated.

## 12. Routing

- **@tanstack/react-router** `1.168.23` — typed file-based router with loader prefetch + search-param schemas. Used in: `apps/web`. Enables: [Route-loader data prefetch](./capabilities.md#route-loader-data-prefetch).

## 13. Data fetching / state

- **@tanstack/react-query** `5.99.2` — async cache + mutations. Used in: `apps/web`, `packages/query`. Enables: [Optimistic mutations](./capabilities.md#optimistic-mutations), [Live-update hooks](./capabilities.md#live-update-hooks-leader-tab--relay), [tRPC cache seeding](./capabilities.md#trpc-cache-seeding-in-stories--tests).

## 14. Forms

- **@tanstack/react-form** `1.29.1` — headless form state + validation. Used in: `apps/web`.

## 15. UI primitives & styling

- **@radix-ui/react-dialog** `1.1.15` — unstyled accessible dialog. Used in: `packages/ui`.
- **@radix-ui/react-slot** `1.2.4` — composition primitive (powers `<Button asChild>`). Used in: `packages/ui`.
- **@radix-ui/react-visually-hidden** `1.2.4` — a11y helper. Used in: `packages/ui`.
- **lucide-react** `1.8.0` — icon set. Used in: `apps/web`, `packages/ui`.
- **sonner** `2.0.7` — toast notifications. Used in: `apps/web`, `packages/query`.
- **class-variance-authority** `0.7.1` — typed variant API. Used in: `packages/ui`.
- **clsx** `2.1.1` — conditional class composition. Used in: `packages/ui`.
- **tailwind-merge** `3.5.0` — Tailwind class deduplication. Used in: `packages/ui`.

## 16. Drag-and-drop

- **@dnd-kit/core** `6.3.1` — DnD primitives. Used in: `apps/web` (todo reordering).
- **@dnd-kit/sortable** `10.0.0` — sortable lists.
- **@dnd-kit/utilities** `3.2.2` — helpers.

  *Sensors: `MouseSensor` + `TouchSensor` (NOT `PointerSensor` — see CLAUDE.md "Common Mistakes").*

## 17. Observability / logging

- **pino** `10.3.1` — structured logger. Used in: `apps/server`. **(Capability undocumented in `capabilities.md` — gap.)**

## 18. Content / parsing

- **papaparse** `5.5.3` — CSV parser. Used in: `packages/api` (todo-list import via the direct-HTTP route).
- **gray-matter** `4.0.3` — YAML frontmatter parser. Used in: `packages/lint` (Gherkin & ADR scanning).

---

## Notable absences (intentional or future-fill)

These slots are **not filled** by this template. A reimplementation should
either fill them deliberately or document the same omission:

- **APM / metrics** — no Datadog, New Relic, OTel exporter.
- **Distributed tracing** — no OpenTelemetry SDK; only Pino logs.
- **Error tracking** — no Sentry / Rollbar.
- **Analytics** — no Segment / Mixpanel / GA / PostHog.
- **Feature flags** — no LaunchDarkly / OpenFeature / GrowthBook.
- **Object storage** — no S3 / GCS / Cloudinary; uploads stay in-process.
- **Search** — no Elasticsearch / Meilisearch / Typesense.
- **Push / SMS** — no FCM / APNs / Twilio.
- **Payments** — no Stripe.

These are deliberate scope cuts to keep the template demo-able without
external accounts. Any capability that needs them should be added through
the same "code-level abstraction with prod swap" pattern used for
`Channel` and email transport (see ADR-0001 and `packages/email/`).

---

## How to use this doc when porting to another stack

For each row above:

1. Identify the **role** (column 2 of the header line — the phrase after the em-dash).
2. Pick the equivalent in the target stack (e.g., role "ORM" → JOOQ in Java, sqlx in Rust, Drizzle/Effect-SQL in alt-TS).
3. Verify the **capabilities** linked still hold under the substitute. If not, that capability needs redesign or replacement.
4. Update the corresponding `capabilities.md` entry with the new import path + library name once the substitute lands.

The `capabilities.md` doc is the contract; this doc is the implementation
register that satisfies it.
