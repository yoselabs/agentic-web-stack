# Project Conventions

Canonical cross-cutting conventions. Read the relevant section before
writing code that touches the area. CLAUDE.md files link back to specific
sections here.

## Realtime event naming

Every realtime event kind MUST start with its owning domain — the domain
whose service emits it. Examples:

- `todo-created`, `todo-updated`, `todo-deleted` (todo domain, single-item)
- `todos-reordered`, `todos-imported` (todo domain, bulk)
- `todo-list-updated`, `todo-list-collaborator-added` (todo-list domain)

**Pluralization rule.** Single-item mutations use singular
(`todo-created`); bulk mutations that span multiple items atomically use
plural (`todos-reordered`, `todos-imported`). This mirrors the server's
payload shape — singular events carry one entity, plural events carry an
array.

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

## Realtime event naming — pluralization (addendum)

The existing pluralization rule (singular for single-item payloads,
plural for bulk payloads) governs **payload-shape** events.
**Notification-shape** events carry no entity; pluralize when the event
describes change to an aggregate collection (`todo-list-counters-changed`,
`todo-list-invites-changed`), singular when it describes a single
conceptual event (`todo-list-access-granted`).

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
domain via `.perspective-boundary.json` — see the next section.

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
// .perspective-boundary.json
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
