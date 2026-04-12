# Development Cycle Process — Brainstorming Handover

## Status: In Progress (brainstorming phase, not yet a spec)

## Problem

The demo project (Retro Board) used horizontal slicing:
```
All backend → All UI → All BDD (at the end)
```

This violates BDD-first, delays feedback to the very end, and means BDD catches issues only after everything is built. The template's CLAUDE.md now says "write Gherkin first" but the plan structure doesn't enforce it.

## Proposed Solution: Vertical Feature Slices

Each feature is a self-contained slice with its own BDD feedback loop:

```
Feature 1: Board CRUD
  1. Gherkin scenarios (behavior contract)
  2. Prisma schema (if needed)
  3. tRPC router + Vitest integration tests (TDD)
  4. Step definitions
  5. Frontend (routes + feature components)
  6. BDD green → commit

Feature 2: Cards
  7. Gherkin scenarios
  8. Schema + API + tests
  9. Steps + UI
  10. BDD green → commit
```

No feature starts until the previous one is green.

## Open Design Question

**When to write BDD step definitions — before or after the UI?**

Strict BDD says: steps first, accept temporary failures, then build UI to make them pass.

But there are real tech constraints with subagent-driven development:

1. **Selector guessing** — step defs written before UI have to guess at HTML structure, locators, class names. When the UI is built by a different subagent, the actual HTML rarely matches the guess. This means step defs need rewriting anyway.

2. **Type dependencies** — TanStack Router types routes from `routeTree.gen.ts`. Link `to` props reject routes that don't exist yet. Frontend subagents need `as string` casts that must be cleaned up later.

3. **Dependency chain** — API types flow to frontend via tRPC's `AppRouter` type. Frontend components depend on API response shapes. Step defs depend on actual rendered HTML. The dependency arrow is: Schema → API → Frontend → Step defs → BDD.

4. **Subagent context isolation** — each subagent starts fresh. A subagent writing step defs before the UI exists has no knowledge of what the UI will actually look like. A subagent writing step defs AFTER the UI can read the actual HTML structure.

### Options to resolve

**A) Strict BDD: Steps before UI**
- Write Gherkin + step defs with best-guess locators
- Build UI
- Fix step defs to match actual UI
- Run BDD green
- Risk: extra fix cycle, wasted tokens on wrong locators

**B) Pragmatic BDD: Gherkin first, steps after UI**
- Write Gherkin scenarios (behavior contract exists)
- Build schema + API + integration tests
- Build UI
- Write step defs against real HTML
- Run BDD green
- Risk: "steps after" feels like cheating on BDD, but Gherkin contract still drives the design

**C) Hybrid: Gherkin + skeleton steps, then UI, then fix steps**
- Write Gherkin + step def skeletons (function signatures, no implementation)
- Build everything
- Implement step defs against real HTML
- Run BDD green
- Risk: skeleton steps add busywork without value

**Leaning toward B** — the Gherkin file IS the behavior contract. Step definitions are implementation details of the test, not the spec. Writing them against real HTML is just good engineering.

## Additional Process Concerns

### Log-Driven Development for AI Agents

From K research (073-grace-ldd-ai-code-markup): LDD in the AI agent context means **structured belief-state logging** — agents emit logs capturing what they believe is happening at each step, enabling verification without re-running. GRACE format: `ts, level, module, block, belief, ctx`.

The template already has pino structured logging, but it's not prescribed as part of the development cycle. Consider:
- Should subagents be required to verify their work by checking server logs after API changes?
- Should the development cycle include a "verify via logs" step between API implementation and UI?
- How does this connect to the existing integration tests (which verify behavior) vs logs (which verify runtime state)?

Note: K research found LDD has **weak evidence** (idea #10 in key-ideas.md) — "conceptually appealing, no empirical validation. ODD (Observability-Driven Development) is the established version." Don't over-invest without validation.

Reference: `~/Documents/Knowledge/Researches/073-grace-ldd-ai-code-markup/key-ideas.md` and `examples.md`.

### Consistency & Naming Conventions Audit

Before validating the process with a real feature, the template needs a consistency scan:
- **Orthogonality** — are concerns properly separated? Do modules have single responsibilities? Are there hidden couplings?
- **Idiomatic patterns** — does code follow TypeScript/React/Hono/Prisma community conventions? Are anti-patterns present?
- **Naming conventions** — Makefile targets (e.g., `db-push` vs `db:push` vs `dbPush`), file names (kebab-case vs camelCase), export styles, component names
- **Architecture consistency** — does every layer follow the same patterns? Are there exceptions that should be standardized?

This audit should happen BEFORE prescribing the development cycle, since the cycle should enforce the conventions it discovers.

## What Needs To Happen Next

1. **Consistency & naming audit** — scan for orthogonality, idioms, naming conventions
2. **Decide on the step definition timing** (A, B, or C above)
3. **Decide on LDD integration** — whether/how structured logging fits the development cycle
4. **Write the process as a prescription** — document in CLAUDE.md or as a skill
5. **Define plan structure template** — how writing-plans should structure vertical slices
6. **Validate by building a real feature** — run a multi-feature project using the prescribed process
7. **Capture lessons** — update the process based on what breaks

## Observations from Round 2 (Retro Board)

- **Batching tRPC routers into one subagent was 3x more efficient** — Tasks 2-4 (board, card, column routers) were batched into a single subagent instead of 3 separate ones. The shared context (Prisma schema, router conventions, tRPC patterns) meant the agent didn't re-discover the same things 3 times. Consider this when defining plan structure: group tasks that share domain context.
- Spec reviewer found zero issues — high plan specificity paid off
- BDD tests passed on 2nd run (vs Round 1's ~10 iterations) thanks to fixed test ports documentation
- Mobile test suite validated responsive behavior automatically

## Context for Next Session

- This repo is `/Users/iorlas/Workspaces/agentic-web-stack`
- Template has: FSD, multi-file Prisma schema, routers/ convention, BDD on desktop+mobile, drag-and-drop, 25 BDD scenarios, 9 integration tests
- CLAUDE.md already has "Development Workflow (BDD-first)" section but it's generic
- The writing-plans skill needs to be updated to enforce vertical slicing
- Feedback memory `feedback_bdd_first.md` exists but is about ordering, not the full cycle
- The user plans to validate by implementing a larger feature after the process is prescribed
