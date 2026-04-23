# Project Conventions

Canonical cross-cutting conventions. Read the relevant section before
writing code that touches the area. CLAUDE.md files link back to specific
sections here.

## Realtime — which primitive?

Before reaching for a realtime channel, walk this tree. It routes a
mutation that "needs to reach other clients" to the cheapest correct
primitive — the rest of the realtime sections below cover each branch
in detail.

```
Mutation happened on the server; other clients need to see it.
│
├─ Is a network round-trip acceptable on the client's next read?
│   └─ yes → `queryClient.invalidateQueries()` after the mutation.
│            No event, no channel. Cheapest, correct for most cases.
│
├─ Would missing events have user-visible consequences that don't
│  self-heal on reconnect? (ordered history: messages, activity, feed)
│   └─ yes → `tracked()` subscription + durable replay buffer (the
│            domain table itself — not Redis Streams). See
│            "When to use `tracked()`" below.
│
├─ Ephemeral state where fresh snapshot on reconnect is the right
│  semantic? (presence, typing, live cursors)
│   └─ yes → fire-and-forget publish, no persistence, no `tracked()`.
│
└─ Live state change + missing events self-heal on reconnect (list
   mutations, authz cascades, counter bumps).
   └─ fire-and-forget publish on a realtime channel. Shape:
      ├─ Payload — carries post-commit entity/delta; client
      │            patches cache via `setQueryData`. High-frequency,
      │            cache-patchable mutations.
      └─ Notification — carries identifiers only; client
                        `invalidateQueries`. Authz cascades, rare
                        mutations, anything where the payload isn't
                        trustworthy for the consumer's decision.
```

## Realtime event naming

Every realtime event kind MUST start with its owning domain — the domain
whose service emits it. Examples:

- `todo-created`, `todo-updated`, `todo-deleted` (todo domain, single-item)
- `todos-reordered`, `todos-imported` (todo domain, bulk)
- `todo-list-updated`, `todo-list-collaborator-added` (todo-list domain)

**Pluralization rule.**

- **Payload-shape events** — singular for single-item mutations
  (`todo-created`); plural for bulk mutations that span multiple items
  atomically (`todos-reordered`, `todos-imported`). Mirrors the server's
  payload: singular carries one entity, plural carries an array.
- **Notification-shape events** — carry no entity. Plural when the
  event describes change to an aggregate collection
  (`todo-list-counters-changed`, `todo-list-invites-changed`). Singular
  when it describes a single conceptual event
  (`todo-list-access-granted`).

Events may ride on a channel owned by a *different* domain (e.g.,
`todo-created` publishes on `todo-list:{listId}`); the prefix refers to
the emitter, not the transport. This keeps log lines, subscription
inspection, and grep output self-describing when multiple domains
multiplex over one WebSocket.

The channel-key namespace already disambiguates at the wire level (each
tRPC subscription has a typed return union). The prefix is a
code-readability convention — nice-to-have, not architecturally
load-bearing.

## Event shape — payload vs notification

**Payload-shaped events** carry the full post-commit entity (or the delta
needed to patch client cache). Client handlers use `setQueryData`, no
refetch on the hot path. Use for high-frequency, cache-patchable
mutations.

**Notification-shaped events** carry only identifiers; client handlers
`invalidateQueries` and refetch. Use when payload isn't trustworthy for
the consumer's decision (authz-cascading events like
`collaborator-removed`) or when the mutation is rare (metadata updates).

Each event kind picks one shape at design time and commits to it. Mixing
shapes within one kind (sometimes payload, sometimes id-only) breaks the
handler contract.

## Event kinds SSOT

For each domain's event union, the list of kinds lives as a `const` tuple
with the event type derived from it:

```ts
export const DOMAIN_EVENT_KINDS = ["kind-a", "kind-b"] as const;
export type DomainEventKind = (typeof DOMAIN_EVENT_KINDS)[number];
export type DomainEvent =
  | { kind: "kind-a"; listId: string }
  | { kind: "kind-b"; listId: string; itemId: string };
```

Reasoning: a runtime array is needed for relay type-guards and dispatch
maps; deriving the type from the array (not the other way around) means
adding a kind without updating the tuple produces a compile error at
every exhaustive consumer.

Reference implementation: `packages/api/src/domains/todo-list/events.ts`.

## When to use `tracked()` (resumable subscriptions)

tRPC's `tracked(id, payload)` enables resumable subscriptions: on reconnect,
the client's last-seen event id is threaded back to the server, which replays
missed events before tailing live.

**Prescribe `tracked()` when:** missed events have user-visible consequences
that don't self-heal on reconnect — ordered deltas where "apply event N then
N+1" matters to the user (activity feeds, chat, collaborative cursors with
history). The event kind is durable domain data persisted in its own table.

**Do NOT use `tracked()` when:** the event is an "invalidate this query"
notification (todo-list mutation events, revoke cascade) — refetch on
reconnect is already correct and cheaper. Or when the event is ephemeral
state (presence, typing indicators, live cursors) — fresh snapshot on
reconnect is the right semantic.

**Storage rule — reuse the domain table as the replay buffer.** Do not
introduce Redis Streams or separate ring buffers as a replay layer unless the
event kind has no durable form. The activity_event / messages / orders table
already satisfies gap-fill via `WHERE id > lastEventId ORDER BY id ASC
LIMIT ?`. Transport is still plain Redis pub/sub (via
`packages/realtime/RedisChannel`) — transport and replay are orthogonal.

**Ordering rule — INSERT then PUBLISH.** Insert the event row inside the
mutation's transaction, then publish to the realtime channel after commit.
Never publish before commit: the gap query would miss an event the client
already received via pub/sub, breaking dedup.

**Replay bounds.** Cap the gap query (500 events or 24h, per
`packages/api/src/domains/activity-feed/constants.ts`). On overflow, yield a
`resync` sentinel envelope; the client falls back to a full fetch.

**Client hook discipline.** The subscription hook must NOT auto-invalidate on
`onStarted` — the whole point of `tracked()` is that reconnect resumes from
`lastEventId` without a full refetch. Only the `resync` sentinel triggers
invalidation.

**Exhibit:** `packages/api/src/domains/activity-feed/` implements this
pattern end-to-end — schema, service (with gap-fill + resync), router,
web hook, panel, and BDD spec.

## Realtime channel granularity

Two channel patterns in this codebase:

- **Per-entity channel** (`<entity>:<id>`) — focused single-entity
  collab with low event rates and static authz. Subscribers open/close
  on mount/unmount of the entity view. Reference:
  `packages/api/src/domains/todo-list/` (channel `todo-list:<listId>`).

- **User-inbox channel** (`user:<userId>`) — persistent cross-feature
  UI surfaces (dashboard counters, sidebar unread, access revocations,
  presence). One subscription per user; server fans out on publish;
  authz enforced at publish time. Reference:
  `packages/api/src/domains/user/`.

Default to per-entity. Add user-inbox alongside it when a domain needs
a cross-feature UI surface that outlives any single entity view.

Rationale, Live+Snapshot reconciliation, watermark-based gap detection
for ordered payload events — see [ADR-001](adrs/0001-realtime-architecture.md).

## Timestamps on models

Every application-owned model has:

- `createdAt DateTime @default(now())`
- `updatedAt DateTime @updatedAt`

Join/link tables included (they represent edges that can be updated).
Better-Auth-owned tables follow Better-Auth's schema.

## Aggregation modules (integration surfaces)

Some modules aggregate contributions from every feature in the codebase.
When you ship a new feature or capability, walk this list and ensure
every applicable surface is updated — the type system does not catch
every omission.

| Surface | File | Update when … |
|---|---|---|
| Top-level navigation | `apps/web/src/widgets/navbar.tsx` | Feature adds a user-facing route |
| tRPC router registry | `packages/api/src/router.ts` | New domain router added (insert alphabetically) |
| User-inbox event SSOT | `packages/api/src/domains/user/user-events.ts` | Domain emits cross-feature realtime events |
| Per-domain event SSOT | `packages/api/src/domains/<name>/events.ts` | New event kind within a domain |
| Package subpath exports | `packages/<pkg>/package.json` `"exports"` | New file meant to be imported from another package |
| Prisma schema split | `packages/db/prisma/schema/<domain>.prisma` | New domain with its own models |
| Cross-layer naming allowlist (lint) | `scripts/check-domain-names.ts` | New asymmetric-by-design domain (backend-only or frontend-only) |
| Auth-gated layout | `apps/web/src/routes/_authenticated/` | Route requires sign-in |

Enforcement ladder: rows marked "(lint)" are caught by `make lint`; the
rest are discipline + code review.

**Meta-rule.** If you introduce a new aggregation module — any file or
registry other features will plug into — add a row to this table in the
same commit that introduces it. This keeps the list authoritative and
prevents silent plug-in points from accumulating.

## API perspective shape — `{ self, others }` at tRPC boundaries

When a domain exposes a list where the current user's row carries
structurally different data than everyone else's row — presence, typing
indicator, draft state, unread counters for self — the tRPC boundary
MUST split the response into `{ self, others }` rather than a uniform
`Member[]` with a `currentUserId` hint.

```ts
// packages/api/src/domains/chat/chat-router.ts
roomMembers: protectedProcedure
  .input(z.object({ roomId: z.string() }))
  .query(async ({ ctx, input }) => ({
    // Self row intentionally lacks `presence` — it's client-derived.
    self: await memberFor(ctx.db, input.roomId, ctx.session.user.id),
    // Server owns presence for everyone else.
    others: await membersExcept(ctx.db, input.roomId, ctx.session.user.id),
  })),
```

**Why the split.** The self row has a different type than other rows.
The compiler now forces every consumer to branch — `self.presence`
literally does not exist, so copy-paste from the `others` render path
fails `tsc -b`. A uniform array cannot encode "self's presence lives
on the client, everyone else's lives on the server" — drift is only a
matter of time.

**Naming.** Prefer `self` (symmetric with `others`). `viewer` is
acceptable if the domain already uses GraphQL-native naming. Pick one
per domain and commit.

**Opt-in lint.** The domain-specific "self-varying" field (the one
clients compute locally and the server must not return for self) is
guarded by a Grit rule / `check-perspective-boundary.ts` fallback that
flags `$row.$field` accesses outside the owning hook. Configure per
domain via `.config/allowlists/perspective-boundary.json` — see the next section.

**Tradeoff.** List-rendering code must merge `self` back in for sorted
display. Do it once per domain.

Prior art: Relay's `viewer`, Slack `self`, Discord gateway
`READY.user`, GitHub / Shopify / Linear GraphQL.

## Client-derived state via `@project/realtime/derived`

For state the client authoritatively computes from its own activity
signals — presence, typing indicator, cursor, focus state, draft
— use `createDerivedSource<T>` from `@project/realtime/derived`. Built
on `useSyncExternalStore` + `BroadcastChannel` + `navigator.locks` so
one tab (the lock leader) drives `compute()` and broadcasts; the
others follow. SSR-safe. Full API lives in
[`packages/realtime/src/derived.ts`](../packages/realtime/src/derived.ts).

```ts
// apps/web/src/features/chat/use-self-presence.ts (sketch)
import { createDerivedSource } from "@project/realtime/derived";

const source = createDerivedSource<"online" | "afk" | "offline">({
  key: "self-presence",
  initial: "offline",
  activityEvents: ["mousemove", "keydown", "visibilitychange"],
  tickMs: 1_000,
  compute: (lastActivityAt, now) => {
    const idleMs = now - lastActivityAt;
    if (idleMs < 60_000) return "online";
    if (idleMs < 300_000) return "afk";
    return "offline";
  },
});

export const useSelfPresence = source.hook;
export const presenceMock = source.mock; // DI for unit tests
```

**Configuring the `perspective-boundary` rule.** When a domain opts
into the `{ self, others }` split above, register the self-varying
field in the repo-root config so the lint rule flags cross-boundary
access:

```json
// .config/allowlists/perspective-boundary.json
{
  "rules": [
    {
      "field": "presence",
      "allowedFiles": ["apps/web/src/features/chat/use-self-presence.ts"]
    }
  ]
}
```

Every non-allowed file that writes `x.presence` fails `make lint`.
The rule ships unconfigured (empty `rules: []`) in this template — no
domain has opted in yet.

**Why a primitive instead of Liveblocks / Yjs.** Template scale does
not justify a SaaS dependency or Yjs runtime. `derived.ts` is ~300 LOC
including the mock. Leader-tab coordination is the only thing you
own — everything else is browser primitives.

## Cross-origin media — signed short-TTL URLs, never cookie `<img>`

Authenticated media (user-uploaded attachments, private avatars) MUST
be delivered via short-TTL HMAC-signed URLs and consumed by dumb
`<img src>` tags. Never set `crossOrigin="use-credentials"` on
`<img>` / `<video>` / `<audio>` elements in user-facing code.

```ts
// packages/api/src/domains/<name>/attachment-sign.ts (sketch)
import { createHmac } from "node:crypto";
import { env } from "@project/env/server";

export function signAttachmentUrl(id: string, ttlSec = 600): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const sig = createHmac("sha256", env.ATTACHMENT_SIGNING_KEY)
    .update(`${id}.${exp}`)
    .digest("base64url");
  return `${env.BETTER_AUTH_URL}/api/attachments/${id}?exp=${exp}&sig=${sig}`;
}
```

```tsx
// Consumer — boringly plain, no CORS, no credentials, CDN-cacheable.
<img src={attachment.signedUrl} alt={attachment.originalName} />
```

**Why not `crossOrigin="use-credentials"`.** It forces
`Access-Control-Allow-Credentials: true` paired with a specific
(non-`*`) origin, which breaks CDN caching — each response becomes
per-cookie. It also silently fails the moment a third origin joins the
deployment (CDN, preview env, review app). Signed URLs work
identically in every environment.

**Same-origin proxying** (Vite `server.proxy`) is acceptable **in dev
only** and must never ship to prod — edge rewrites conflate app and
API routing domains and complicate multi-region deploys. Pick one
pattern per deployment, never mix.

Prior art: Cal.com, Dub (R2 presign), Linear, Midday. `next/image`
defaults to a same-origin loader for the same reason.

Deployment-side rationale and env-var wiring live in
[`DEPLOYMENT.md`](../DEPLOYMENT.md#signed-url-media-pattern).

## BDD placement scoping — scope to landmark, not bare `page.getBy*`

Step definitions under `e2e/steps/**/*.ts` that assert the **placement**
of a UI element MUST scope the query to an accessibility landmark
(`getByRole('navigation' | 'main' | 'complementary' | 'contentinfo')`)
or a named container. Bare top-level `page.getByTestId(...)` /
`page.getByText(...)` / `page.getByRole(...)` passes whether the
element lives in the intended container or the wrong one — that class
of bug has shipped silently before.

```ts
// Bad — passes whether the badge lives in the navbar or a random header strip.
const badge = page.getByTestId("notifications-badge");
await expect(badge).toBeVisible();

// Good — fails loudly if the badge is rendered outside <nav>.
const nav = page.getByRole("navigation", { name: "Primary" });
await expect(nav.getByTestId("notifications-badge")).toBeVisible();
```

**Escape hatch.** A step that asserts "this element exists *somewhere*
on the page" (rare — usually a bug smell) MUST precede the query with
a `// placement-agnostic:` comment on the line immediately above. The
lint rule allows unscoped queries only when that comment is present.

**Enforcement.** A Grit plugin
(`scripts/grit-plugins/scoped-landmark-queries.grit`) flags unscoped
top-level queries in step files. A fallback
`scripts/check-scoped-landmarks.ts` ships for patterns Grit cannot
express (e.g., "preceding-line comment" context). Both wire into
`make lint`.

## E2E locator hierarchy (Playwright + playwright-bdd)

Bare tag/CSS locators (`page.locator("li", { hasText: title })`) don't
compose — the moment two regions render the same shape, every unscoped
query collides. Use this 4-tier hierarchy, in order of preference:

1. **Role + name, scoped under a landmark.**
   `page.getByRole("main").getByRole("listitem", { name: title })`.
   Always the first choice — semantic, a11y-aligned, automatically scoped.
2. **Label / placeholder** for form fields.
   `page.getByLabel("Email")`, `page.getByPlaceholder("Add a todo...")`.
3. **Scoped text** under a landmark.
   `page.getByRole("main").getByText(title)`.
4. **`getByTestId`** only as an escape hatch for components whose
   semantics don't map cleanly to roles (charts, composite widgets,
   dialog wrappers where ARIA is awkward).

**Scope every query under a landmark** unless it's unambiguously
page-global (`main`, `complementary`, `navigation`, `banner`). Landmarks
are required for accessibility anyway — using them in tests makes the
a11y tree load-bearing, which is the point.

Rule of thumb: if a step def starts with bare `page.locator(...)`, there
is almost always a role-based alternative. Reach for `data-testid` only
after exhausting (1)–(3).

**Enforcement.** `eslint-plugin-playwright` (scoped to `e2e/` via
`e2e/eslint.config.js`) enforces this hierarchy via `no-raw-locators` and
`no-nth-methods` (opt-ins), plus `prefer-web-first-assertions`,
`missing-playwright-await`, `no-wait-for-timeout`, `no-networkidle`,
`no-useless-not`, `no-wait-for-selector` from the recommended preset.
`no-standalone-expect` is disabled — playwright-bdd's step defs
legitimately call `expect` outside `test()` blocks. Run via `make lint`.

Feature files (`e2e/features/*.feature`) are linted by `gherkin-lint` with
structural rules (duplicate scenarios, empty files, indentation). Config:
`.gherkin-lintrc`.

When the hierarchy must be broken (negative-proof settle windows, true
positional assertions in reorder tests), use
`// eslint-disable-next-line playwright/<rule> -- <reason>` with a concrete
reason. See existing suppressions in `e2e/steps/activity-feed/activity-feed.ts`
and `e2e/steps/todo-list/realtime-reorder.ts`.

## Web app Vitest project selection

The web app has three Vitest projects in `apps/web/vitest.config.ts`.
Each test file lands in exactly one of them based on its filename
suffix — picking the wrong one either slows the edit loop
(happy-dom test promoted to browser mode unnecessarily) or hides
bugs the suffix should expose.

| Filename | Project | Environment | Purpose |
|---|---|---|---|
| `*.test.tsx` | `unit` | happy-dom | Default — pure logic + component rendering + hook tests |
| `*.stories.tsx` | `storybook` | chromium (`@vitest/browser` + playwright) | State enumeration + a11y via axe |
| `*.browser.test.tsx` | `browser` | chromium (same provider) | Real-browser invariants — `<img>` load / `naturalWidth`, CSS layout, clipboard, CORS |

**Use `*.browser.test.tsx` only for bugs jsdom cannot see.** Typical
triggers: cross-origin `<img>` credential mode, `naturalWidth === 0`
image-load failures, `IntersectionObserver` / `ResizeObserver` /
`getBoundingClientRect` assertions, clipboard, drag-and-drop with
real pointer events. Everything else stays in the `unit` project —
happy-dom is 10× faster per test.

Run with `make test-browser`. Excluded from `make test-unit` because
chromium cold-start is seconds, not milliseconds; runs alongside BDD
in the pre-merge lane (see `make test-all`).

Reference: exemplar at `apps/web/src/shared/authed-image.browser.test.tsx`,
helper at `apps/web/test/browser-render.tsx`, rationale in
`docs/adrs/0007-browser-mode-component-tests.md`. Pyramid placement:
`docs/qa-strategy.md` §3.4.
