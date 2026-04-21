---
title: "ADR-002 — Configuration patterns"
status: Accepted
applies-to: packages/env, packages/api, packages/auth, apps/*, scripts
verified_by:
  - CLAUDE.md
---

# ADR-002 — Configuration Patterns

## Status

**Accepted.** Prescribes *how* configuration is expressed in this repo.
Supersedes no prior ADR. A downstream project tried introducing a shared
`packages/config/` package and reverted it; this ADR exists so the next
person doesn't repeat the attempt.

## Context

Configuration values in a web stack fall into four categories that each
need a different home. Without a convention, teams reach for a single
`packages/config/` grab-bag, which breaks three ways:

1. **Client bundle leaks.** A shared module imported by server and client
   drags server-only secrets (DB URL, auth secret) into the browser
   bundle via transitive imports.
2. **Frozen literals pretend to be dynamic.** Values that genuinely
   never change (dev Postgres port, local container names) get wrapped
   in an indirection layer, then `grep 5432` returns one hit — the
   constant — and the file that actually needs the number disappears
   from discoverability.
3. **Domain rules drift from their owners.** Business rules (upload
   caps, password policy, event-kind lists) end up in a neutral
   `config/` package that no domain owns; adding a rule requires a
   cross-package edit, and removing the rule leaves orphan constants.

The template's current layout already splits configuration across four
homes; this ADR makes the split explicit so new work lands in the right
place.

## Decision

Route every configuration value through **one of four** homes based on
this decision tree:

```
Does the value change across environments (dev / test / prod)?
├── YES → @project/env (runtime env, Zod-validated, subpath-scoped)
└── NO  → Is it a business rule owned by a specific domain?
         ├── YES → packages/<domain>/constants.ts (or @project/<domain>/constants)
         └── NO  → Is it test-infrastructure (ports, DB names, container names)?
                  ├── YES → packages/test-infra (SSOT for test harness)
                  └── NO  → Infra literal: duplicate across the 3-4 files that need it
                            (Makefile, docker-compose.yml, .github/workflows/ci.yml,
                             Zod default in packages/env/src/server.ts)
```

### Home 1 — `@project/env` (runtime env)

Anything the operator controls at deploy time: secrets, URLs, feature
flags, log levels. Validated by Zod with dev-friendly defaults so
zero-conf boot works.

- **Server-only:** `packages/env/src/server.ts`, imported as
  `@project/env/server`. Holds `DATABASE_URL`, `BETTER_AUTH_SECRET`, etc.
- **Client-safe:** `packages/env/src/client.ts`, imported as
  `@project/env/client`. Holds only `VITE_*` vars.
- **No barrel.** `@project/env` (bare) does not resolve. Attempting a
  barrel import would transitively pull `process.env` reads into the
  browser bundle. Enforced by the no-barrel lint.

### Home 2 — Domain constants

Business rules owned by a specific domain. Co-located with the domain:

- `packages/api/src/domains/<name>/<name>-constants.ts` (e.g., upload
  caps, status enums, event kind tuples).
- `packages/auth/src/constants.ts` (password policy, cookie names).
- Exposed via the package's subpath exports, not a barrel.

If two domains want the same constant, the value belongs to whichever
domain *owns* the rule — the other imports from it. Don't invent a
neutral "shared constants" package; that's how `packages/config/` gets
born.

### Home 3 — Test infrastructure

Dynamic-per-worktree values used only by test harnesses: DB ports,
container names, web/API ports. Single source of truth:
`packages/test-infra` exposes `testDbEnv(suite)` and
`setupTestDatabase(suite)`. Consumers (`e2e/test-env.ts`,
`packages/api/test-runner.ts`) import from there.

### Home 4 — Infra literals

Values that are **constants forever** within the project's lifetime:
development Postgres port `5432`, database name `app`, service user
`postgres`, dev ports `3000` / `3001`. These get duplicated across the
handful of infra files that reference them:

- `Makefile` (dev targets)
- `docker-compose.yml` / `docker-compose.dev.yml` (service definitions)
- `.github/workflows/*.yml` (CI)
- Zod defaults in `packages/env/src/server.ts` (for the app at runtime)

Rationale: SSOT's payoff is preventing drift, which requires change.
These values don't change. Extracting them into a shared package
introduces three test harnesses worth of resolution indirection without
removing a real drift risk, and the grep-discoverability loss is
significant.

## What NOT to do

### Do not create `packages/config/`

Explicitly forbidden. It becomes a grab-bag that spans all four homes
above, fails the client-bundle test (server vars leak), and obscures
ownership of domain rules.

### Do not read `process.env` outside `@project/env`

The env package is the only module permitted to read `process.env`. Any
other module imports the validated `env` object. Enforced by
`make lint`'s grep guard.

### Do not re-export env through a domain package

`@project/auth` does not re-export `@project/env/server`. The consumer
imports both directly. Re-exporting multiplies the blast radius when the
env schema changes.

## Consequences

- **Positive:** New contributors have an explicit decision tree; review
  comments can cite "home N of ADR-002" instead of debating taste.
- **Positive:** Client bundles stay clean by construction — there is no
  shared module that could leak server secrets.
- **Negative:** Four homes feels like more to remember than one. The
  decision tree is the remedy; in practice most values land in Home 1
  (runtime env) or Home 2 (domain constants) without ambiguity.
- **Negative:** Infra literals (Home 4) are duplicated across 3–4 files.
  If a dev port ever does change, every instance must be updated. This
  is a conscious trade: literals are grep-discoverable; shared constants
  are not.

## References

- `packages/env/src/server.ts` — Home 1 reference.
- `packages/auth/src/constants.ts` — Home 2 reference (auth-owned).
- `packages/test-infra` — Home 3 reference.
- `docker-compose.dev.yml`, `Makefile` — Home 4 reference.
- Root `CLAUDE.md` § "Critical Rules — Single source of truth (SSOT)".
