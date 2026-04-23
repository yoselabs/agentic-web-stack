---
date: 2026-04-23
type: audit
status: draft
---

# Codebase Upgrade Audit

**Lens:** reduce complexity, delete hand-rolled abstractions, enable AI-first
delivery, simplify the stack. This is not an exhaustive version-bump list —
patches and minor bumps below threshold are omitted. Every item justifies
itself by either (a) deleting code, (b) collapsing a concept, or (c)
tightening types so agents make fewer mistakes.

Verified findings are marked **[V]** (read in this repo or in an upstream
changelog during the audit). Inferred / needs-verification items are marked
**[I]** and should be confirmed before acting.

---

## TL;DR — Top 8 wins ranked by leverage

| # | Action | Lens | Effort | Unlocks |
|---|---|---|---|---|
| 1 | **Delete `@hono/node-ws`** (ghost dep in `apps/server/package.json`) | Fewer deps, close a knip gap | 5 min | One less "which WS package do I reach for?" for agents |
| 2 | **Upgrade `@hono/node-server` v1 → v2** and adopt its first-class WebSocket API; retire the hand-rolled `WebSocketServer` + `applyWSSHandler` wiring in `apps/server/src/index.ts:145-200` | Delete ~60 lines of boot + a weak concept ("piggyback WS on the node server") | 1–2h | Simpler boot, no stray `ws` import, first-class Hono primitive |
| 3 | **Adopt Better-Auth `magic-link`, `organization`, `passkey`, `username` plugins** where matching flows exist (password-reset → magic-link, invites → organization, username branch in flight) | Delete hand-rolled flows; one canonical auth lib owns these concerns | 4–8h per plugin | Fewer domain-specific tests; fewer "how do I do X in this codebase?" paths for agents |
| 4 | **`nodemailer` 6 → 8** and collapse `packages/email` to a thinner adapter | Built-in DKIM, OAuth2, native Promise API; zero transitive deps in v8 | 30–60 min | Smaller wrapper, simpler types |
| 5 | **`@bull-board/api` + `@bull-board/hono` 6 → 7** | Major version hygiene + likely Hono v2 compat for #2 | 20 min | Unblocks #2 if v7 requires node-server v2 |
| 6 | **Tighten realtime convention** — one sentence per kind says "payload vs notification vs subscription (tracked)", enforced by a lint check if feasible | AI-first: single decision tree instead of three | 2–4h | Agents pick the right primitive on the first try |
| 7 | **Extract `apps/server/src/index.ts` into a `createServer({ slots })`** factory in a new `@project/server-kit` or inline in `apps/server/src/bootstrap.ts` | One of the highest-bug-density files for boot-order correctness; `requireAdmin` ordering is already a lint check, the rest is convention | 3–4h | Predictable boot; agents edit one slot, not the whole file |
| 8 | **`@casl/react` 5 → 6** (React 18+ baseline via `useSyncExternalStore`) | Version hygiene; no API change | 5 min | Cleaner React state subscription internally |

Items 1, 5, 8 are mechanical — do in a batch PR this week.
Item 2 is the single biggest deletion opportunity — recommend doing it next.
Items 3, 6, 7 are pitch-shaped; each deserves its own session.

---

## 1. Outdated majors with real leverage

### 1.1 `@hono/node-server` v1 → v2 [V]

Upstream v2 release notes:

- **Drops Node 18** (repo is already on Node 22 via `tsx` / `@types/node@^25`).
- **Removes `@hono/node-server/vercel`** — not used here.
- **First-class WebSocket support** (PR #328). This is the headline.
- **~2.3× faster body-parsing throughput** — incidental, not the reason to move.

Current WS wiring in `apps/server/src/index.ts` (lines 17, 145-200):

```ts
import { WebSocketServer } from "ws";
import { applyWSSHandler } from "@trpc/server/adapters/ws";

const httpServer = serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, ...);
const wss = new WebSocketServer({ server: httpServer as Server, path: "/trpc-ws" });
function incomingMessageToHeaders(req): Headers { /* 10 lines */ }
const wsHandler = applyWSSHandler({ wss, router, createContext: ... });
process.on("SIGTERM", () => { wsHandler.broadcastReconnectNotification(); wss.close(); ... });
```

That's ~60 lines of boot that exists because in Hono v1 we had to bolt WS
onto the underlying `http.Server`. With v2 the Hono app owns WS directly.

**Verification needed before acting:**
- Does `@trpc/server/adapters/ws`'s `applyWSSHandler` accept Hono v2's WS
  primitive (likely a `WebSocketServer`-compatible object)? The tRPC
  adapter expects a `ws`-package-shaped `WebSocketServer`; Hono v2 may
  wrap `ws` under the hood or expose its own shape. If tRPC still needs
  `ws.WebSocketServer`, keep `ws` + get v2 for the body-parse speedup;
  the deletion opportunity shrinks.

**If the adapter doesn't bridge cleanly,** the fallback is still a win:
keep tRPC-WS on the `ws` package but shed `@hono/node-ws` (item #1.2)
and get Hono v2's faster body parser.

### 1.2 `@hono/node-ws` — ghost dep [V]

```
apps/server/package.json:    "@hono/node-ws": "catalog:",
```

No `import` of this package exists anywhere in `apps/` or `packages/` —
verified by `rg '@hono/node-ws' apps/ packages/`. The server uses
`ws` directly. Either the package was swapped out for `ws` mid-build
and this line stayed, or knip's `ignoreDependencies` silences it.

**Action:** remove the line, delete from the catalog if no other package
imports it, run `make lint`.

**Root cause of the knip miss:** `apps/server` has
`"ignoreDependencies": ["@hono/node-ws", "ws"]` in `knip.json`. Both
were silenced in commit `489ec7a8` (2026-04-21 turbo migration) —
likely because at the time the WS wiring was mid-refactor between
`@hono/node-ws` (Hono-idiomatic path) and raw `ws` +
`@trpc/server/adapters/ws/applyWSSHandler` (what the tRPC adapter
requires). Someone pre-silenced both so the in-flight state didn't
block knip, and the `@hono/node-ws` entry was never cleaned up after
the code settled on `ws`.

Verified by a 10-second experiment: setting
`apps/server.ignoreDependencies: []` and re-running
`pnpm exec knip --workspace apps/server` flags exactly `@hono/node-ws`
and nothing else — `ws` is detected correctly via its static import at
`apps/server/src/index.ts:17`. **`ws` didn't need to be silenced.**

**Process fix:** `ignoreDependencies` entries should require a comment
explaining *why* the entry is there (peer dep, dynamic import, types-only
use, etc.). Without that convention, a defensive silence becomes
permanent. Two options:
1. Move `ignoreDependencies` into per-package `knip.json` files where a
   header comment is natural, and require a reason above each entry.
2. Add a lint check (`packages/lint/src/check-knip-ignores.ts`) that
   fails CI if an `ignoreDependencies` entry isn't paired with a comment
   in a sibling `.knip-reasons.md` or YAML file. Heavier, but
   self-enforcing.

Option 1 is enough for now. Option 2 only worth it if more instances
surface.

**Meta-question to carry forward:** audit the other `ignoreDependencies`
entries in `knip.json`:

- `apps/web`: `@testing-library/user-event`, `@project/query`
- `apps/worker`: `@project/env`, `ioredis`
- `packages/api`: `@project/jobs`, `bullmq`
- `packages/db`: `@prisma/client`, `pg`, `@types/pg`
- root-level: 16 entries including `@casl/ability`, `@casl/react`,
  `tailwindcss`, `nitro`, `dependency-cruiser`, `pino-pretty`, `turbo`

Not all are suspect — many are real peer-dep or types-only cases. But
a 30-minute audit of that list likely finds 1-2 more ghost deps
silenced by stale rules. Pairs naturally with adopting the
comment-each-entry convention above.

### 1.3 `nodemailer` 6 → 8 [V]

v7/v8 consolidated features that v6 pushed to plugins:

- **Native DKIM signing** — no external module.
- **Integrated OAuth2** (user + service account) — no `nodemailer-oauth2`.
- **iCalendar / DSN support** — built-in.
- **Zero dependencies** — installs are smaller; supply-chain surface shrinks.
- **Promise-returning `sendMail()`** when called without a callback — the
  Promise wrapper some apps add becomes unnecessary.

`packages/email` is a thin wrapper over `sendMail`. With v8 the wrapper
likely shrinks to a transport factory + a `send(to, subject, html)`
function — no callback/Promise adapter, no DKIM bolt-on when we need it.

Only breaking change between v6 and v8 that could affect this repo:
error code rename (v6 `NoAuth` → v8 `E`-prefixed form). Grep the
codebase for the old string before bumping (expected: none; the
project's email retry test uses the `E`-prefixed variant already).

### 1.4 `@bull-board/api` + `@bull-board/hono` 6 → 7 [I]

Major bump. Most likely aligns with Hono v2 (see item 1.1) — the
`@bull-board/hono` adapter's peer deps probably require node-server v2
for the new WS plumbing. Read the v7 release notes before acting; if
peer-deps force Hono v2, do this as part of the same PR.

### 1.5 `@casl/react` 5 → 6 [V]

Only breaking change: drops React 17 (uses `useSyncExternalStore`). We
are on React 19. Zero risk, zero API change. Bump.

### 1.6 Everything else outdated

`@casl/ability` 6.8.0 → 6.8.1, `better-auth` 1.6.6 → 1.6.7, `bullmq` 5.75
→ 5.76, `prisma` 7.7 → 7.8, `vite` 8.0.8 → 8.0.9, `knip` 6.6.0 → 6.6.1,
`markdownlint-cli2` 0.22.0 → 0.22.1, `nitro-nightly` (rolling).

Patch/minor bumps — batch into a `chore(deps): minor bumps` PR. Not
called out as a "leverage" item because none unlock anything that
wasn't already there.

---

## 2. Already-current packages with unused new capabilities

This is the "wide audit" angle — packages whose majors are current but
whose newer APIs we aren't using.

### 2.1 Better-Auth plugins — the biggest simplification pot [V]

Better-Auth's plugin catalog covers a lot of what most apps hand-roll.
Current adoption vs what's available:

| Plugin | Replaces | Status here |
|---|---|---|
| `magic-link` | Password-reset email token flow | Hand-rolled in `packages/api/src/__tests__/password-reset.test.ts` et al. **Strong candidate** |
| `organization` | Team / membership / invite system | Hand-rolled todo-list invites; partial overlap. **Medium candidate** — depends on whether the todo-list "invite" is a team membership or a per-list ACL (likely the latter, so only partial fit) |
| `passkey` | WebAuthn flows | Not implemented. **Green-field add**, not a deletion |
| `username` | Username-based auth | In flight on branch `feat/auth-username-plugin`. **Already scoped** |
| `two-factor` | TOTP / recovery codes | Not implemented. **Green-field add** |
| `admin` | Admin-role gating | Currently via CASL + `requireAdmin` middleware in `apps/server/src/admin/middleware.ts`. **Evaluate** — probably keep CASL since it's used for row-level authz too, but the plugin might subsume the middleware |

**Specific call:** do `magic-link` next. Password-reset is the single
most-tested hand-rolled auth flow in the repo (email-retry, rate-limit,
token expiry, single-use semantics) — all of that is table stakes in
`magic-link`. Likely deletes 200-400 lines of code and N tests.

### 2.2 tRPC subscriptions + Redis Streams [I]

The repo now uses `tracked()` subscriptions with DB-as-replay-buffer
(shipped this session for activity-feed). An alternative primitive is
**Redis Streams** — natively ordered, native gap-fill, native consumer
groups. The Channel abstraction in `packages/realtime/` could add a
`StreamChannel` implementation alongside `MemoryChannel` + `RedisChannel`.

**Why it matters for AI-first:** today we have three conventions to pick
from (payload emit, notification emit, `tracked()` with DB replay). A
fourth primitive isn't obviously simpler. Flag as a *possible* future
consolidation; not a current win. **Don't act on this without a
brainstorm session first** — it risks being a sideways move.

### 2.3 TanStack Start `createServerFn` vs `apiClient` [I]

`packages/http/client` wraps `fetch` to prepend a base URL + cookie
credentials. This is the "right" shape for web→API calls that must go
through CORS. TanStack Start also offers `createServerFn` for
same-origin server logic; currently used only implicitly (the route
loaders). Not a deletion candidate — the API server is deliberately
cross-origin to the web server. Noted for completeness.

### 2.4 Prisma 7 TypedSQL [I]

Prisma 7 can generate types for raw SQL fragments. One place this could
pay off: `packages/api/src/domains/activity-feed/` gap-replay queries
(ordered cursor pagination). Currently typed via Prisma client methods —
fine today. If a gap-replay query grows complex enough to need raw SQL,
reach for TypedSQL instead of `$queryRaw` with a hand-written type.
**Not a refactor target; a convention to add to `apps/web/CLAUDE.md`
and `packages/api/CLAUDE.md`.**

### 2.5 `@tanstack/react-form` — field-array / nested object helpers [I]

Haven't checked current usage depth vs. latest helpers. Possible
boilerplate-reduction win in forms with nested data (e.g. an invite
form with multiple emails). Worth a 15-min pass after items 1-5 ship.

### 2.6 Biome 2 → unused rules [I]

Biome 2.4.12 is current. Nursery rules `useExhaustiveSwitchCases` +
`useSortedClasses` were promoted `warn`→`error` on 2026-04-21.
**Action:** in a follow-up, grep `biome.json` vs Biome 2's full rule
catalog and promote more nursery rules that are high-signal here
(`noUnusedImports` — probably already on; `useImportType` — fits with
the project's strict type-import discipline; `noExportsInTest` —
defensive). One hour, pays back in fewer review comments forever.

---

## 3. Candidates to eliminate entirely

### 3.1 `@hono/node-ws` — see 1.2 [V]

### 3.2 `@types/nodemailer` after nodemailer 8 [I]

Nodemailer 8 ships its own types (zero-deps philosophy). If true,
`@types/nodemailer` from DefinitelyTyped becomes dead weight. Verify
by reading the v8 README after bumping.

### 3.3 `gray-matter` — possibly replaceable [I]

Used in `packages/lint` for frontmatter parsing. Bun ships a YAML
parser. A tiny hand-rolled `split on first '---'` + `Bun.YAML.parse`
would drop the dep. ~30 lines of code. Marginal — keep unless doing a
broader lint-deps sweep.

---

## 4. AI-first infrastructure opportunities

These aren't version bumps; they're patterns an agent would write more
robust code under.

### 4.1 Consolidate `apps/server/src/index.ts` into slotted factory [I]

Today `apps/server/src/index.ts` contains, in order:

1. Logger setup
2. Hono app creation + global middleware (CORS, secureHeaders)
3. Auth handler mount (`/api/auth/**`)
4. tRPC HTTP handler mount (`/trpc/**`)
5. Webhook sub-app mounts
6. Admin middleware + Bull-Board mount (order-critical; lint-enforced)
7. HTTP server `serve()`
8. WebSocket server + tRPC WS handler
9. SIGTERM handler

Nine concerns, one file, ~200 lines. An agent adding a tenth (new
webhook, new admin mount, new middleware) must read all nine to avoid
breaking ordering. Proposal:

```ts
// apps/server/src/bootstrap.ts
export async function bootstrap() {
  const app = createApp();
  mountAuth(app);
  mountTrpc(app);
  mountWebhooks(app, [stripeWebhook, exampleWebhook]);
  mountAdmin(app, [bullBoardApp]); // ← requireAdmin registered inside
  return serveWithShutdown(app);
}
```

Each mount fn lives in its own file. Ordering invariants become local to
`mountAdmin`. Lint check already enforces one invariant; more can be
added per mount fn without scattering.

**Dissent:** this is abstraction for its own sake if `index.ts` doesn't
grow. Current 9 concerns × 200 lines is fine for a human. The win is
**AI-first**: each mount fn has a single-purpose prompt surface. Trade-off
worth a brainstorm.

### 4.2 Realtime SSOT — single decision tree [I]

Today a feature author picks between:

- `MemoryChannel`/`RedisChannel` publish (fire-and-forget notification)
- `tracked()` subscription with DB replay (ordered, gap-fillable)
- tRPC mutation → invalidate query (trust the server round-trip)

The conventions doc describes when to use each. An **AI-first** win: a
decision-tree diagram + a lint rule ("if the domain emits events from N
call sites, must use `tracked()`"). Probably not worth the lint complexity;
the conventions doc is enough if kept tight.

### 4.3 Turbo `gen` for domain scaffolding [I]

Branch `ws3-turbo-gen-feature` exists — suggests someone started this.
The Cross-Layer Naming rule (`<name>` under `apps/web/src/features/`,
`packages/api/src/domains/`, `e2e/features/`, `e2e/steps/`) is perfect
for `turbo gen`: one prompt, four file trees. **AI-first jackpot** — an
agent asked to "add a new domain `X`" runs one command and gets the
canonical layout. Finish that branch.

---

## 5. Out of scope

- Runtime swap (Node → Bun for apps): **still blocked** by
  [bun#4145](https://github.com/oven-sh/bun/issues/4145) (Vite SSR
  transform + Zod named export). Revisit when closed. Nothing to do
  today.
- ESM-only migrations: the repo is already ESM-first; no CJS interop
  hot spots except the `tslib` shim in `apps/web/vite.config.ts`, which
  is intentional and documented.
- Replace CASL with Prisma row-level security: the Prisma RLS feature
  is still behind a preview flag and doesn't give us the client-side
  `Can` component. Keep CASL.

---

## 6. Recommended sequencing

1. **This session or next (mechanical):** items 1.2 (delete node-ws),
   1.5 (CASL react 6), 1.6 (batch minor bumps). Single PR, ~1h total.
2. **Next session (real leverage):** item 1.1 (Hono v2 + retire hand-rolled
   WS boot), bundled with 1.4 (Bull-Board 7) since they're likely co-dependent.
3. **After that (pitch-shaped):**
   - Better-Auth `magic-link` adoption → delete hand-rolled password reset.
   - `createServer({ slots })` refactor of `apps/server/src/index.ts`.
   - Finish `turbo gen` domain scaffolding.
4. **Backlog (don't commit yet):**
   - nodemailer 8 + `packages/email` slim-down.
   - Redis Streams for realtime — gated on a brainstorm about whether
     three primitives is already one too many.

---

## 7. What this audit did NOT cover

- **Runtime perf baselines.** No benchmarks run; all "faster" claims are
  from upstream notes. If a bump is sold on speed, measure first.
- **Security advisories.** `pnpm audit` not included here. Run separately.
- **Supply-chain review.** Not doing a license audit or transitive-dep
  policy check; outside the "simplification" lens.
- **Spec/doc drift from code.** Covered implicitly by the pending
  `check-spec-acceptance.ts` (separate TODO item).
