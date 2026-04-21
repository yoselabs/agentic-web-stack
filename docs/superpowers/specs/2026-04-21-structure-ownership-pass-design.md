---
title: "Structure Ownership Pass — feature colocation + package promotions + route extractions + audit fixes"
status: Approved
date: 2026-04-21
scope: pure file moves + path-string refactor across apps/web + packages/api + apps/server + e2e + docs; no behavior change
---

# Structure Ownership Pass — Design

## 1. Purpose

Front-load organizational decisions so AI agents building on this template don't pay cognitive tax per session. Every "where does this go?" becomes a lookup in `docs/package-taxonomy.md` — not a judgment call.

Scope consolidates five streams of moves derived from the project-structure audit:

- **A.** Promote 3 `apps/web/src/shared/` files to dedicated workspace packages.
- **B.** Colocate 3 misplaced files with their feature/domain owners.
- **C.** Extract 9 inlined route page-components to `features/<name>/`.
- **D.** Document unwritten conventions (server webhooks/admin, domain parent-child, package taxonomy).
- **E.** Minor repo-hygiene moves (e2e floating helpers, docs research dir).

All behavior-preserving. Each letter commits independently.

## 2. Commit plan

### Commit 1 — Package promotions (stream A)

Three new packages, one-file each, subpath-only exports (consistent with `@project/env`, `@project/api`):

**`packages/http/`** (from `apps/web/src/shared/api-client.ts`)
```
packages/http/
  package.json          # name: @project/http, private, type: module
  tsconfig.json         # extends tsconfig.base.json
  README.md             # "HTTP client + fetch wrappers. Credentials + base URL helpers. Add new generic fetch utilities here (retry, offline queue, typed errors)."
  src/
    client.ts           # moved from apps/web/src/shared/api-client.ts
  # exports: { "./client": "./src/client.ts" }
  # deps: @project/env (workspace:*)
```

**`packages/query/`** (from `apps/web/src/shared/use-optimistic-mutation.ts`)
```
packages/query/
  package.json          # name: @project/query
  tsconfig.json
  README.md             # "TanStack Query patterns — optimistic mutations, query-key builders, prefetch helpers."
  src/
    use-optimistic-mutation.ts
  # exports: { "./use-optimistic-mutation": "./src/use-optimistic-mutation.ts" }
  # peer deps: @tanstack/react-query, react
```

**`packages/media/`** (from `apps/web/src/shared/authed-image.tsx`)
```
packages/media/
  package.json          # name: @project/media
  tsconfig.json
  README.md             # "Media UI primitives with auth awareness — authed images, uploads (future), crops (future)."
  src/
    authed-image.tsx
  # exports: { "./authed-image": "./src/authed-image.tsx" }
  # peer deps: react
```

Update `apps/web/package.json` devDeps to add workspace references. Update every import in `apps/web/src/` from `./shared/api-client` → `@project/http/client`, etc. Delete moved source files from `shared/`. Run `check-no-barrel` — all three must have subpath-only exports.

### Commit 2 — Feature colocation (stream B)

Three moves, update importers:

1. `apps/web/src/shared/session.ts` → `apps/web/src/features/auth/session.ts` (auth-specific SSR helper; `shared/` rule forbids `@project/env/server` imports).
2. `apps/web/src/shared/todo-http-client.ts` → `apps/web/src/features/todo-list/todo-http-client.ts` (feature-specific; imports `TodoHttpRouter` from the todo-list domain).
3. `packages/api/src/authz/rules/todo.ts` → `packages/api/src/domains/todo-list/authz.ts`. Update `packages/api/src/authz/index.ts` to import from the new path. The `authz/rules/admin.ts` stays (it's meta — role-based, not domain-specific).

After moves, `apps/web/src/shared/` contains only `use-optimistic-mutation.ts` (if not yet promoted) — update this commit based on Commit 1's outcome. Target: `shared/` empty or contains only truly cross-cutting helpers.

### Commit 3 — Route-shell extraction (stream C)

Extract 9 inlined page components. Route files shrink to ~8 lines.

| Route | Extract to | Feature dir |
|---|---|---|
| `routes/login.tsx` | `LoginPage` → `features/auth/login-page.tsx` | existing |
| `routes/signup.tsx` | `SignupPage` → `features/auth/signup-page.tsx` | existing |
| `routes/forgot-password.tsx` | `ForgotPasswordPage` → `features/auth/forgot-password-page.tsx` | existing |
| `routes/reset-password.tsx` | `ResetPasswordPage` → `features/auth/reset-password-page.tsx` | existing |
| `routes/_authenticated/dashboard.tsx` | `DashboardPage` → `features/user/dashboard-page.tsx` OR new `features/dashboard/` | decide: if dashboard composes user + todo-list concerns, use new `dashboard/` feature dir; else fold into `user/` |
| `routes/_authenticated/todo-lists/index.tsx` | `TodoListsPage` → `features/todo-list/todo-lists-page.tsx` | existing |
| `routes/_authenticated/todo-lists/$listId.tsx` | `TodoListDetailPage` → `features/todo-list/todo-list-detail-page.tsx` | existing |
| `routes/invites/$token.tsx` | `InvitePage` → `features/todo-list/invite-page.tsx` | existing (invites are a todo-list concern) |
| `routes/index.tsx` | `LandingPage` → `features/landing/landing-page.tsx` (new feature dir) | new |

Route-file shape after extraction:
```tsx
// routes/login.tsx
import { createFileRoute, redirect } from "@tanstack/react-router";
import { LoginPage } from "#/features/auth/login-page";

export const Route = createFileRoute("/login")({
  beforeLoad: ({ context }) => {
    if (context.session) throw redirect({ to: "/dashboard" });
  },
  component: LoginPage,
});
```

**Stay as-is** (no page component to extract):
- `routes/__root.tsx` — root shell (providers, Toaster, 404/500). Framework infra.
- `routes/_authenticated.tsx` — auth guard layout. Framework infra.
- `routes/health.ts` — JSON handler, no UI.

Update `apps/web/CLAUDE.md` with a clear "Adding a new page" example showing the 8-line route + feature-page split. Move "Never inline feature components" from "Do Not" to a positive rule with before/after.

### Commit 4 — Documentation (stream D)

**New: `docs/package-taxonomy.md`** — the decision tree. Maps every kind of code to its canonical home. Includes existing packages AND named slots for anticipated future packages (`@project/forms`, `@project/uploads`, `@project/analytics`) so an agent has a name to reach for when the concern materializes. Format: table with columns `Kind of code | Home | Notes`.

**Update: root `CLAUDE.md`** — add a top-level "Where does code go?" section linking to `docs/package-taxonomy.md`.

**Update: `apps/web/CLAUDE.md`** — clarify route-shell rule with before/after (see Commit 3).

**Update: `packages/api/CLAUDE.md`** — add a section "Parent/child entities in one domain" documenting the `todo-list/` pattern (aggregate + item share a folder; prefix child files with the entity name). Reference `todo-list/` as the example.

**Update: `apps/server/CLAUDE.md`** — add sections for `webhooks/<name>/` and `admin/<name>/` extension patterns.

**Update: `packages/email/CLAUDE.md`**, **`packages/jobs/CLAUDE.md`**, **`packages/realtime/CLAUDE.md`** (or create if missing) — document the templates/queues/channels extension pattern per package. One paragraph each.

### Commit 5 — Minor hygiene (stream E)

1. Move `e2e/auth-client.ts` and `e2e/waits.ts` → `e2e/helpers/`. Update step-def imports.
2. Create `docs/research/`, move `docs/repo-organization-research.md` + `docs/storybook-ecosystem-research.md` into it. Update cross-references in the spec docs.
3. Leave `docs/conventions.md`, `docs/qa-strategy.md`, `docs/testing-guidelines.md`, `docs/upstream-watch.md` at `docs/` root (convention docs vs research docs; keeping root top-level navigation clean).

## 3. Acceptance (each commit)

1. `make lint` — 30/30 green.
2. `make test-unit` — green.
3. `make test` — existing BDD scenarios pass (no behavior change).
4. `check-no-barrel` — no regression (new packages subpath-only).
5. `check-domain-names` — no regression (folder parity preserved).
6. `check-stories-siblings` — widgets unchanged; new feature-page files are NOT widgets, so not required to have stories (document this in the check's comment if scope confusion arises).

## 4. Explicit non-goals

- **Not splitting `domains/todo-list/` into `todo-list/` + `todo/`.** The parent-child-in-one-domain pattern is documented in Commit 4 but not restructured. Splitting would cascade through every import + test + BDD scenario.
- **Not moving `shared/use-optimistic-mutation.ts` to features** — it's genuinely cross-cutting. Ships to `@project/query` instead (Commit 1).
- **Not promoting `packages/auth`, `packages/db`, etc.** to new names — they're already canonical.
- **Not creating `packages/forms/`, `packages/uploads/`, `packages/analytics/`** — taxonomy doc names them; actual package created when first consumer arrives.
- **Not restructuring `packages/ui/`** — shadcn layout is conventional.

## 5. Dispatch

One focused subagent, sequential commits 1 → 5 on branch `structure-ownership-pass`. Each commit green before proceeding. If any commit fails `make lint`, halt + report + do not proceed to next.

## 6. References

- `docs/repo-organization-research.md` — complementary (configs + scripts reorg, separate spec).
- `docs/superpowers/specs/2026-04-21-repo-reorganization-design.md` — the A+B+C reorg (runs AFTER this pass).
- `apps/web/CLAUDE.md` "Routes must be thin shells" — the violated rule this pass enforces.
