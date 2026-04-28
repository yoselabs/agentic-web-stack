---
title: Effect-TS rewrite — session handover
date: 2026-04-28
status: ready-to-start
predecessor_session: stack-audit + ADR drafting
---

# Effect-TS Rewrite — Handover for Next Session

This is a fresh-session brief for whoever (you, or a follow-up Claude
Code instance) picks up the Effect-TS rewrite. Read this top-to-bottom
once. Everything you need to start Phase 1 is here or linked.

## TL;DR

- Decision is made: **full rewrite onto Effect-TS** (not "Effect at
  the leaves"). See [`ADR-0009`](../../adrs/0009-full-rewrite-onto-effect-ts.md).
- Production runtime collapses to **Node 24 only** for both server
  and worker. See [`ADR-0010`](../../adrs/0010-production-runtime-node-only.md).
- Rollback point: tag **`stable-pre-effect`** (commit `80f0684`,
  branch `stable/pre-effect`, pushed to origin).
- **Phase 1 has not been started yet.** This session ended after
  documenting decisions, not after writing code.

## Repo state at session end

```
git status:
  M  docs/capabilities.md
  M  docs/qa-strategy.md
  ?? docs/adrs/0009-full-rewrite-onto-effect-ts.md
  ?? docs/adrs/0010-production-runtime-node-only.md
  ?? docs/dev-tooling.md
  ?? docs/tech-stack.md
```

**These are uncommitted docs.** Step zero of the next session:
verify the user still wants them, then commit them as a single
"docs: stack inventory + Effect rewrite ADRs" commit before touching
code. Don't start Phase 1 with dirty doc state.

Branch: `main`. The rewrite happens here directly (per
[memory: feedback_no_prs](file:///Users/iorlas/Documents/Knowledge/Agents/Claude/feedback_no_prs.md)
— solo repo, no GitHub PRs).

## What was done this session

Worked top-down from "audit the current stack" through to "ADR the
rewrite":

1. **Tagged the freeze.** `stable-pre-effect` tag + `stable/pre-effect`
   branch, both pushed to origin. This is the rollback point.
2. **Effect-TS compatibility study.** Two parallel agents mapped repo
   seams + the 2026 Effect ecosystem. Recommended "Effect at the
   leaves" as the *partial-adoption* default; user chose full rewrite
   instead.
3. **Stack inventory** (new docs):
   - [`docs/tech-stack.md`](../../tech-stack.md) — runtime deps with
     versions + roles + which capability each enables. Cross-linked
     to capabilities.md anchors.
   - [`docs/dev-tooling.md`](../../dev-tooling.md) — pnpm/turbo/tsc/
     Biome/16 custom lint checks/test runners/prek/CI. Includes a
     "what survives a runtime swap" table.
4. **`docs/capabilities.md` refresh.** Added missing entries (sign-in
   flows, Bull Board, structured logging, graceful shutdown). Added
   a new top-level section **"Composition patterns"** with 7 entries
   for the binding stories (admin role chain, mutation flow, realtime
   stack, email enqueue chain, activity-feed gap-fill+live+dedup,
   test-DB bootstrap, dev-mode swappable transports). These chains
   are what a port must reproduce — not just the parts list.
5. **`docs/qa-strategy.md` resync.** Version drift fixes (Storybook
   9 → 10, custom check count, turbo task count), prek/agent-harness
   gate model, and a new **§4 decision tree** ("I'm about to write a
   test, which kind?") with 8 tie-breakers + the "lower layer first"
   rule.
6. **Two ADRs.** [`ADR-0009`](../../adrs/0009-full-rewrite-onto-effect-ts.md)
   (full rewrite) and [`ADR-0010`](../../adrs/0010-production-runtime-node-only.md)
   (Node 24 prod). Six follow-up ADRs (0011–0016) are deliberately
   **not** pre-written; they're decided as their phase lands.

## What's decided

| Question | Decision | ADR |
|---|---|---|
| Adopt Effect-TS? | Yes — full rewrite | 0009 |
| Scope of the rewrite | Backend only (Phase 1–6); frontend deferred to a later ADR (slot 0016) | 0009 |
| Production runtime | Node 24 for both `apps/server` and `apps/worker` | 0010 |
| Bun's role going forward | Inner loop only: `bun test`, `bun --watch` for dev, repo-glue scripts | 0010 |
| Test runner per package | Unchanged — Bun for `@project/api`, Vitest for `apps/web` | ADR-0003 (still valid) |
| Capability contract | Preserved — `docs/capabilities.md` is the cross-stack contract | 0009 |
| Gherkin specs | Preserved — `e2e/features/*.feature` is the behavioral contract | 0009 |
| Dev tooling layer | Preserved — Make/turbo/pnpm/prek/Biome/lint checks all stay | 0009 |
| Rollback path | `git reset --hard stable-pre-effect` | 0009 |

## What's open (don't pre-decide)

These are real decisions with non-obvious tradeoffs. Write each ADR
**when its phase lands**, not before. The default lean for each is
recorded in ADR-0009's punch-list table.

| ADR | Phase | Question |
|---|---|---|
| 0011 | 2 | HTTP: Hono + Effect inside, or `@effect/platform` HttpApi? |
| 0012 | 2 | RPC: tRPC v11 + `runEffect` adapter, or `@effect/rpc`? |
| 0013 | 5 | DB: Prisma wrapped, or `@effect/sql`? |
| 0014 | 6 | Schema: Zod 4, or Effect Schema? (bundle implications) |
| 0015 | 3 | Queue: BullMQ wrapped, or wait for `ClusterQueue`? |
| 0016 | 7 | Frontend: server-only Effect, or client-side too? |

## What to do first

### Step 0 — Commit the doc work

```
git status                     # confirm the 6 doc files
git add docs/                  # all changes are under docs/
git commit -m "docs: stack inventory + Effect rewrite ADRs (0009, 0010)"
git push
```

### Step 1 — Read these in this order

1. [`ADR-0009`](../../adrs/0009-full-rewrite-onto-effect-ts.md) — the
   headline decision + 7-phase plan + open ADRs.
2. [`ADR-0010`](../../adrs/0010-production-runtime-node-only.md) —
   concrete Dockerfile + CI changes for Phase 1.
3. [`docs/capabilities.md`](../../capabilities.md) — especially the
   "Composition patterns" section. These chains are what the rewrite
   must reproduce.
4. [`docs/tech-stack.md`](../../tech-stack.md) — the inventory being
   replaced.
5. Skim [`docs/dev-tooling.md`](../../dev-tooling.md) — what stays.

### Step 2 — Phase 1 implementation

Per ADR-0009 §"Implementation phases":

> Phase 1 — Runtime baseline. Land ADR-0010 (Node 24 prod), set up
> Effect at the package level, one Layer for `Db` wrapping Prisma.
> Smoke: one service rewritten, one tRPC procedure adapted, tests
> green.

Concrete file-by-file plan for Phase 1 has **not** been written yet.
Step 2 of the next session is to draft that plan (use the
`superpowers:writing-plans` skill if invoking via Claude Code), then
execute it.

Suggested order within Phase 1:

1. **Add Effect to the catalog.** `pnpm add -w effect@latest` and pin
   `@effect/platform`, `@effect/platform-node` if needed. Update
   `pnpm-workspace.yaml` catalog if it ends up referenced from
   multiple packages.
2. **Switch `apps/server` prod to Node** per ADR-0010 §Implementation
   (Dockerfile runtime stage, build step, healthcheck command).
   Verify `make test` and `make smoke` green.
3. **Define `Db` Layer.** A `Context.Tag<Db>` + `DbLive` Layer wrapping
   the Prisma client singleton. Test that a tagged service can
   `yield* Db` and get the client.
4. **Pick one domain to rewrite first.** Suggest **`todo-list`** —
   it's the canonical reference domain for transactions, realtime,
   activity-feed, and rate-limit composition. Its tests also have
   the broadest coverage, so rewriting it shakes out the most
   patterns early.
5. **Rewrite the chosen domain's services** to return `Effect`. Define
   the tagged-error hierarchy (e.g., `class NotFoundError extends
   Data.TaggedError("NotFoundError")<{...}>`). Adapt one tRPC
   procedure with a `runEffect` helper at the boundary. Update tests.
6. **Document the patterns** as you discover them. The rewrite is
   simultaneously the implementation and the source material for
   the future "best practices" doc.

Stop and write the HTTP ADR (slot 0011) and RPC ADR (slot 0012) when
Phase 2 begins, not before. They'll be informed by what you learned in
Phase 1.

## Constraints / non-negotiables

- **No `--no-verify` on commits.** Pre-commit hook is read-only; if
  it fails, fix the cause (per CLAUDE.md "Critical Rules").
- **`make lint` must stay green** at end of every commit. Per
  user feedback, run `make lint` (not just `agent-harness lint`)
  before claiming work is done.
- **No PRs.** Solo repo, merge to `main` directly + push (per
  [`feedback_no_prs`](file:///Users/iorlas/Documents/Knowledge/Agents/Claude/feedback_no_prs.md)).
- **`make` targets, not manual port juggling.** Use `make dev`,
  `make test`, `make fix`. Per
  [`feedback_use_make_commands`](file:///Users/iorlas/Documents/Knowledge/Agents/Claude/feedback_use_make_commands.md).
- **`pnpm` CLI for version bumps**, not hand-edited `package.json`
  (per [`feedback_pnpm_cli`](file:///Users/iorlas/Documents/Knowledge/Agents/Claude/feedback_pnpm_cli.md)).
- **The Gherkin specs in `e2e/features/` must keep passing.** They
  are the behavioral contract. If a spec needs to change, that's a
  spec edit + a discussion, not a silent test deletion.
- **The capability contract in `docs/capabilities.md` must keep
  holding.** If the rewrite changes a capability, update the doc in
  the same commit.
- **Bun stays for inner loop only.** Don't reintroduce Bun in
  Dockerfiles or production paths.

## Key files / paths

```
docs/adrs/0009-full-rewrite-onto-effect-ts.md   ← read first
docs/adrs/0010-production-runtime-node-only.md  ← read second
docs/capabilities.md                            ← cross-stack contract
docs/tech-stack.md                              ← inventory being replaced
docs/dev-tooling.md                             ← what survives
docs/qa-strategy.md                             ← test gate decision tree
e2e/features/                                   ← behavioral contract
packages/api/src/domains/todo-list/             ← suggested first rewrite
packages/db/                                    ← Prisma wrapped behind a Layer
apps/server/Dockerfile (=> ./Dockerfile)        ← Phase 1 runtime swap
apps/worker/Dockerfile                          ← already Node, reference shape
```

Tags / branches:
```
stable-pre-effect (tag, commit 80f0684)         ← rollback point
stable/pre-effect (branch, same commit)         ← rollback branch
main                                            ← rewrite happens here
```

## What success looks like for Phase 1

When Phase 1 ends, the repo should have:

- `docs/adrs/0009`, `0010` committed.
- `Dockerfile` runtime stage on Node 24; `make smoke` green against
  the rebuilt image.
- `effect` (and any required `@effect/*` packages) in the catalog.
- A `Db` Layer with at least one consumer.
- One domain (suggest `todo-list`) with services returning `Effect`,
  one tRPC procedure adapted via `runEffect`, all that domain's
  tests green.
- All other domains still on the pre-rewrite shape — Phase 1 is a
  smoke test, not a full migration.
- `make lint && make test && make test-unit` all green.
- A working note (this same handover doc, edited) describing what
  patterns emerged that should inform Phase 2.

If any of these items needs to be cut to fit a session, **prefer
shipping fewer domains rewritten with patterns documented**, over
"all six domains rewritten but no patterns captured." The captured
patterns are the actual deliverable.
