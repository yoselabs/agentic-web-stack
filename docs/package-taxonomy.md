# Package Taxonomy — Where Does Code Go?

A decision tree for placing new code. Front-loaded so agents don't re-derive
this each session. If your concern is here, import from the listed home;
if it isn't, pick the closest match and extend that package's README growth
path.

Existing packages on the left, anticipated-but-not-yet-created on the right
(with a named slot so an agent has a concrete target). Create a new package
only when the first real consumer arrives — slots exist to reserve the name,
not to create empty folders.

## Runtime & cross-cutting primitives

| Kind of code | Home | Notes |
|---|---|---|
| Env vars (server-side, reads `process.env`) | `@project/env/server` | Only module allowed to read `process.env`. Zod-validated. |
| Env vars (client-safe, `VITE_*`) | `@project/env/client` | Separate subpath — never import `/server` from browser code. |
| HTTP fetch wrapper, base-URL helper | `@project/http/client` | Cookie-aware `apiClient`. Grow retry / offline queue / typed errors here. |
| TanStack Query helpers, optimistic patterns | `@project/query/use-optimistic-mutation` | Snapshot/rollback wrapper. Add query-key builders + prefetch helpers here. |
| Authed media primitives (`<AuthedImage>`, future `<Upload>`, `<Crop>`) | `@project/media/authed-image` | Grow into `@project/media/upload`, `@project/media/crop`. |
| Rate-limiting (memory + Redis) | `@project/rate-limit/*` | Factory + types + Redis handle. |
| Realtime channel abstraction | `@project/realtime/channel` | MemoryChannel dev, RedisChannel prod. `derived.ts` is the computed-signal primitive. |
| BullMQ queues, Redis connection | `@project/jobs/queues`, `@project/jobs/redis` | One file per queue under `queues/`. |
| Email templates + send adapter | `@project/email/handler`, `@project/email/service`, `@project/email/templates/<name>` | One file per template. Nodemailer via handler. |
| Prisma client, generated types | `@project/db` | Barrel OK here (re-exports generated PrismaClient). |
| Better-Auth instance, auth constants | `@project/auth`, `@project/auth/constants` | Barrel OK for the auth instance. |
| Session user / auth subject / ability types | `@project/api/authz` | Owned by the API package because policies live there. |
| shadcn/ui primitives | `@project/ui/components/<name>` | Add with shadcn's CLI; keep vanilla. |
| Test infra (ports, DB containers) | `@project/test-infra` | Node-only. Consumers: every package's test runner. |

## Domain code (user-facing capabilities)

| Kind of code | Home | Notes |
|---|---|---|
| Page component | `apps/web/src/features/<name>/<name>-page.tsx` | Route file stays ~8 lines. |
| Feature hooks (orchestration, live-updates) | `apps/web/src/features/<name>/use-*.ts` | Must have sibling `.test.ts`; enforced by `check-test-siblings`. |
| Feature widgets / sub-components | `apps/web/src/features/<name>/<component>.tsx` | Local to one feature. |
| Cross-feature widgets | `apps/web/src/widgets/<name>.tsx` | Used by 2+ features / routes (Navbar, AppShell). |
| tRPC router for a domain | `packages/api/src/domains/<name>/<name>-router.ts` | Append-alpha in `src/router.ts`. |
| Service / business logic | `packages/api/src/domains/<name>/<name>-service.ts` | Pure function; takes `PrismaClient` or `Prisma.TransactionClient`. |
| Domain constants (client-safe) | `packages/api/src/domains/<name>/<name>-constants.ts` | Exported via `@project/api/domains/<name>/<name>-constants`. |
| Domain CASL rules | `packages/api/src/domains/<name>/authz.ts` | Registered in `packages/api/src/authz/index.ts`. |
| Realtime event tuples + types | `packages/api/src/domains/<name>/events.ts` | SSOT const tuple; derive type, never the reverse. |
| Direct HTTP (non-tRPC) endpoint — webhook | `apps/server/src/webhooks/<name>.ts` | Rate-limit via `@project/rate-limit/factory`. |
| Admin-only HTTP mount | `apps/server/src/admin/<name>.ts` + gate with `requireAdmin` middleware | Bull Board is the reference. |
| Worker cron handler | `apps/worker/src/handlers/<name>.ts` | Scheduled in `apps/worker/src/schedule.ts`. |
| Gherkin feature | `e2e/features/<name>/*.feature` | Same `<name>` as web feature + api domain. |
| BDD step definitions | `e2e/steps/<name>/*.ts` | Paired with feature folder. |

## Anticipated future packages (named slots)

Create when the first consumer arrives; name is reserved to prevent drift.

| Slot | Growth trigger | Likely exports |
|---|---|---|
| `@project/forms` | 2+ features need the same form primitives (form-field wrapper, error summaries, zod-resolver helpers) that aren't shadcn-generic. | `/form-field`, `/use-zod-form`, `/error-summary` |
| `@project/uploads` | First real attachment feature lands; pairs with `@project/http` retry + `@project/media/crop`. | `/upload-button`, `/use-upload-progress`, `/signed-url-client` |
| `@project/analytics` | Adding a product analytics SDK (PostHog, Segment) — wrap it to swap providers. | `/track`, `/identify`, `/use-page-view` |

## When in doubt

- Value lives in exactly one file: own domain if domain-owned, owning package if cross-cutting.
- Value literally never changes (dev port `3000`, `app` DB name): hardcoded literal in 3–4 infra files is fine — SSOT only pays off when the value changes. See [ADR-002](adrs/0002-configuration-patterns.md).
- Need a new package? Mimic `packages/http/` (subpath-only exports, README growth path, tsconfig extends base). Add to root `tsconfig.json` references.
