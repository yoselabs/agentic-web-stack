<p align="center">
  <h1 align="center">Agentic Web Stack</h1>
  <p align="center">
    <em>AI-Agent-Ready Product Platform</em>
  </p>
  <p align="center">
    <strong>A fullstack TypeScript template designed for AI agents to build real products. BDD-first, quality-gated, everything type-safe.</strong>
  </p>
  <p align="center">
    TanStack Start · Hono · tRPC · Prisma · Better-Auth · Tailwind · playwright-bdd
  </p>
  <p align="center">
    <a href="https://github.com/yoselabs/agentic-web-stack/actions"><img src="https://github.com/yoselabs/agentic-web-stack/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
    <a href="https://github.com/yoselabs/agentic-web-stack/blob/main/LICENSE"><img src="https://img.shields.io/github/license/yoselabs/agentic-web-stack.svg" alt="License"></a>
  </p>
  <p align="center">
    <a href="#quick-start">Quick Start</a> · <a href="#stack">Stack</a> · <a href="#architecture">Architecture</a> · <a href="#bdd-workflow">BDD Workflow</a> · <a href="#ai-agent-features">AI Agent Features</a>
  </p>
</p>

---

```
You:    "Add a todo list feature"
  ↓
Agent:  writes Gherkin spec → implements tRPC routes → builds UI → make check → make test
  ↓
Result: 5 BDD scenarios green, types checked, lint clean, feature shipped
```

## Why This Template?

AI agents write better code when the stack is mainstream, type-safe, and quality-gated. Most templates optimize for humans — this one optimizes for agents:

- **Mainstream libraries** — AI already knows the patterns, fewer hallucinations
- **End-to-end type safety** — tRPC catches errors at compile time, not runtime
- **BDD-first** — Gherkin specs define behavior, agent implements until specs pass
- **Quality gates** — `make check` runs 13 lint checks + typecheck before any commit
- **Progressive CLAUDE.md** — per-directory AI guidance loaded only when relevant
- **Library skills** — `@tanstack/intent` ships SKILL.md files with common mistakes

## Quick Start

```bash
# Clone the template
gh repo create my-app --template yoselabs/agentic-web-stack
cd my-app

# One command setup (installs deps, starts Postgres, pushes schema, installs hooks)
make setup

# Start developing
make dev
```

Open http://localhost:3000 — sign up, create todos, explore.

### Prerequisites

- Node.js >= 22
- pnpm
- Docker (for PostgreSQL)

## Stack

| Layer | Choice | Why |
|-------|--------|-----|
| **Frontend** | TanStack Start (Vite SSR) | Vite-based, SSR for SEO, server functions, v1.0 stable |
| **Backend API** | Hono | 29K stars, Web Standards, 4-10x faster than Express |
| **API Layer** | tRPC | End-to-end type safety, zero codegen |
| **ORM** | Prisma | AI produces fewer bugs, migration safety critical |
| **Auth** | Better-Auth | Self-hosted, multi-tenancy + RBAC + 2FA built-in |
| **Database** | PostgreSQL | Industry standard, Docker-friendly |
| **Styling** | Tailwind v4 + shadcn/ui | Industry standard, AI knows it deeply |
| **BDD/E2E** | playwright-bdd | Gherkin specs → Playwright tests |
| **Quality** | agent-harness + Biome | 13 automated checks per commit |

Every component is replaceable — alternatives documented in the [ADR](https://github.com/yoselabs/agentic-web-stack/wiki/ADR).

## Architecture

```
apps/
  web/            # TanStack Start (SSR + SPA) — port 3000
  server/         # Hono (API + auth + tRPC) — port 3001
packages/
  api/            # tRPC router + context (shared types)
  auth/           # Better-Auth config
  db/             # Prisma schema + client
  env/            # Validated environment variables
  ui/             # shadcn/ui components
e2e/              # playwright-bdd (Gherkin + step definitions)
```

### Data Flow

```
Browser → TanStack Start (SSR) → tRPC client
                                    ↓
                              httpBatchLink (credentials: include)
                                    ↓
                          Hono server (port 3001)
                           ├── /api/auth/** → Better-Auth
                           └── /trpc/*     → tRPC router
                                              ↓
                                         protectedProcedure
                                              ↓
                                      Prisma → PostgreSQL
```

## BDD Workflow

The template is BDD-first: write specs, then implement until they pass.

### 1. Write the Gherkin spec

```gherkin
# e2e/features/posts.feature
Feature: Blog Posts

  Scenario: Create a post
    Given I am signed in as "author@example.com"
    And I navigate to "/posts"
    When I fill in "Title" with "My First Post"
    And I click "Publish"
    Then I should see "My First Post"
```

### 2. Write step definitions

```typescript
// e2e/steps/posts.ts
given("I have a post {string}", async ({ page }, title: string) => {
  // ...
});
```

### 3. Implement until green

```bash
make test   # runs Gherkin → Playwright, clean DB each time
```

Tests run in parallel (7 workers, ~24 seconds for 10 scenarios) with a dedicated test database on a hash-derived port per worktree (tmpfs — wiped each run, isolated per suite — see `scripts/test-db.ts`).

## AI Agent Features

### Progressive CLAUDE.md

AI guidance is split across directories — loaded only when relevant:

| File | When loaded | What it covers |
|------|-------------|----------------|
| `CLAUDE.md` | Always | Structure, commands, critical rules, common mistakes |
| `e2e/CLAUDE.md` | Writing tests | BDD workflow, step patterns, test isolation |
| `packages/db/CLAUDE.md` | Schema changes | Migration safety, Better-Auth table ownership |
| `packages/api/CLAUDE.md` | API routes | tRPC patterns, adding procedures |
| `apps/server/CLAUDE.md` | Server changes | Hono patterns, auth flow |
| `apps/web/CLAUDE.md` | Frontend changes | Pages, routing, tRPC client |

### Library Skills (@tanstack/intent)

Installed libraries ship SKILL.md files with setup guides and common mistakes:

```bash
pnpm exec @tanstack/intent list   # discovers 41 skills from 9 packages
```

The agent reads the relevant SKILL.md before modifying library integrations.

### Quality Gates

Every commit runs through 13 automated checks:

```
agent-harness lint
├── biome:lint + biome:format
├── yamllint
├── conftest (gitignore, package.json, Dockerfile, docker-compose)
├── hadolint (Dockerfiles)
├── file-length
├── gitignore-tracked
└── precommit-hooks

tsc -b (cross-package type checking)
```

Pre-commit hooks run `agent-harness fix` then `agent-harness lint` automatically.

## Commands

| Command | What it does |
|---------|-------------|
| `make setup` | Zero-conf: deps + Postgres + schema + hooks |
| `make dev` | Start web (3000) + server (3001) |
| `make check` | Full quality gate (13 checks + typecheck) |
| `make fix` | Auto-fix lint issues |
| `make test` | BDD tests (clean test DB each run) |
| `make test-unit` | Vitest unit/integration tests (isolated unit-suite DB) |
| `make test-ui` | Playwright UI mode |
| `make db-push` | Push Prisma schema to database |
| `make db-generate` | Regenerate Prisma client |
| `make db-studio` | Open Prisma Studio |
| `make clean` | Tear down containers + node_modules |

## What's Included

- **Auth** — email/password sign-up/sign-in, session management, protected routes
- **Todo app** — full CRUD example with auth gating and user isolation
- **10 BDD scenarios** — auth flows (5) + todo CRUD (5), all passing
- **Nav bar** — authenticated layout with Dashboard + Todos links
- **Docker Compose** — PostgreSQL 17 for dev, separate test DB on tmpfs

## What's NOT Included (by design)

- Google/GitHub OAuth — add client ID/secret to Better-Auth config when ready
- Email sending — plug in Resend/SendGrid when needed
- File uploads — add when a feature requires it
- CI pipeline — bring your own (GitHub Actions, etc.)
- Deployment config — bring your own (Docker, Cloudflare, etc.)

The template gives you the foundation. Add features as you need them.

## Development

```bash
make setup    # First time
make dev      # Daily development
make check    # Before committing (also runs via pre-commit hook)
make test     # After implementing features
```

## License

MIT

---

<sub>Built for AI agents, by AI agents, with human supervision.</sub>

<sub>Created by [Denis Tomilin](https://github.com/iorlas) · [yoselabs](https://github.com/yoselabs)</sub>
