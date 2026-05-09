# Effect Contract-First Rewrite — Design Spec

**Date:** 2026-05-07
**Status:** Ready for review (pre-`writing-plans`)
**Branch (planned):** `rewrite/contract-first`
**Soft rollback:** `0131caf` (current `main`).
**Hard rollback:** `stable-pre-effect` tag (created day 0).
**Supersedes (partially):** ADR-0014 (closed by D1 here); amends ADR-0015 (D5 here).
**Related researches:** R023 (Black-Box Module Contracts & Completeness Invariants),
R073 (GRACE / LDD / AI code markup).

## Context

Phase 4 capability #1 (queue + worker) shipped on `main` (`0131caf`). A
post-ship audit surfaced that the codebase is **Effect-flavored, not
maximally idiomatic**:

- Domain functions use inferred return types — the `Effect<A, E, R>`
  channel is a derived shape, not a declared contract.
- Infrastructure services use the older `Context.Tag`+`Layer` pattern;
  the modern `Effect.Service` form (which collapses tag + layer + class
  into one declaration) is unused.
- `Effect.Schedule` retry composition is unused; the worker's retry
  policy is hand-rolled.
- Schema validation is split: server uses Zod for some routes, raw
  parse for others; ADR-0014 was left open precisely because no
  decision had been forced.

The user reframed the goal during brainstorm: the reason for adopting
Effect is **AI-driven delivery with contract-level verification**, not
just runtime safety. Effect's three-channel `Effect<A, E, R>` is meant
to be the *compile-time tunnel* for AI agents — declared types rule out
untracked errors, undeclared services, and surprise return shapes
*before* the AI ever runs `bun test`. Inferred types defeat this.

This spec rewrites the project so 100% of the code is idiomatic Effect,
contract-first per capability, with custom lint enforcing the
discipline. Timeline: ~1 week, ~25 commits on `rewrite/contract-first`.

## Principles

1. **Contract-first per capability, just-in-time.** Strong contracts at
   capability boundaries (the AI's surface); free-form Effect inside
   private helpers. Schemas land in the same commit as the contract,
   before any Live implementation.
2. **Hardness engineering.** Per R073, the lint surface is part of the
   deliverable, not afterthought (LangChain's harness work alone gave
   +13.7pp). The five checks below ARE the rewrite's deliverable as
   much as the code is.
3. **Compile-time over documented convention.** If the type system or
   a lint rule can make a discipline a build error, do that instead of
   writing it in CLAUDE.md. Re-affirms zero-conf spec's principle 4.
4. **R023 totality is opt-in, not blanket.** Per-record accountability
   (processed / skipped-with-reason / errored) is the load-bearing
   intellectual frame, but applying it to *every* method causes
   ceremony bloat. Methods that need it tag themselves `@totality` and
   the lint check fires.
5. **Effect Schema on server, derived types on client.** Closes
   ADR-0014. Zod survives only for form input (resolver compatibility),
   not as a parallel schema language.

## Decisions

### D1 — Six-file capability layout

Each capability owns six files under `packages/api/src/domains/<name>/`:

```
<name>-contract.ts   ← Service Tag (Effect.Service modern form), method signatures
<name>-schema.ts     ← Effect Schema for IO (parsers + derived types)
<name>-errors.ts     ← Data.TaggedError types for the capability's failure modes
<name>-service.ts    ← Live implementation (the AI-generated file)
<name>-router.ts     ← tRPC adapter — calls into the Service via runEffect
__tests__/           ← bun test, pins behavior the type system can't
```

**Why six.** Brainstorm Q1 / Q3. The split serves two goals: (a)
contract files freeze under a separate review path from impl files
(see D3 — frozen contract on AI handoff), and (b) the AI's edit
surface is exactly one file (`<name>-service.ts`).

**Constants** (`<name>-constants.ts`) remain a seventh optional file
where domain rules apply (see existing `todo-constants.ts`). Not
mandatory — only added when a domain has constants.

**Cross-layer naming** is unchanged from CLAUDE.md: `<name>` reuses
across `apps/web/src/features/<name>/`, `e2e/features/<name>/`,
`e2e/steps/<name>/`. Enforced by existing `check-domain-names.ts`.

**Example — todo-list after retrofit:**

```ts
// todo-contract.ts
import { Effect, Schema } from "effect";
import * as TodoSchema from "./todo-schema.ts";
import * as TodoErrors from "./todo-errors.ts";
import { Db } from "@project/db/effect";
import { CurrentSession } from "@project/auth/effect";

export class TodoListService extends Effect.Service<TodoListService>()(
  "TodoListService",
  {
    succeed: {
      list: (input: TodoSchema.ListInput) =>
        Effect.Effect<readonly TodoSchema.Todo[], TodoErrors.TodoListError, Db | CurrentSession>,
      create: (input: TodoSchema.CreateInput) =>
        Effect.Effect<TodoSchema.Todo, TodoErrors.TodoListError | TodoErrors.TodoQuotaError, Db | CurrentSession>,
      // ...
    },
  },
) {}
```

```ts
// todo-errors.ts
import { Data } from "effect";

export class TodoListError extends Data.TaggedError("TodoListError")<{
  readonly cause: unknown;
}> {}

export class TodoQuotaError extends Data.TaggedError("TodoQuotaError")<{
  readonly current: number;
  readonly max: number;
}> {}

/** @totality */
export class TodoSkippedError extends Data.TaggedError("TodoSkippedError")<{
  readonly reason: "deleted" | "archived";
  readonly id: string;
}> {}
```

```ts
// todo-schema.ts
import { Schema } from "effect";

export const Todo = Schema.Struct({
  id: Schema.String,
  title: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(280)),
  completed: Schema.Boolean,
  // ...
});
export type Todo = Schema.Schema.Type<typeof Todo>;

export const CreateInput = Schema.Struct({
  title: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(280)),
});
export type CreateInput = Schema.Schema.Type<typeof CreateInput>;

export const ListInput = Schema.Struct({ /* ... */ });
export type ListInput = Schema.Schema.Type<typeof ListInput>;
```

### D2 — Six-commit capability cadence

Each capability lands as exactly six commits in strict order:

| # | Commit | Author | Gate |
|---|---|---|---|
| 1 | **Brief** — Gherkin scenarios + 1-line goal in `e2e/features/<name>/` | Human | Reviewed by user |
| 2 | **Contract** — `<name>-{contract,schema,errors}.ts`. Service body = `Effect.die("not implemented")`. | Human | `tsc -b` green; `make lint` green |
| 3 | **Behavioral tests** — `bun test` against the contract; tests fail at `Effect.die`. | Human or AI under review | Tests fail with the expected error tag |
| 4 | **Service implementation** — `<name>-service.ts` Live. AI-generated under frozen contract. | AI (canonical prompt — see D3) | `bun test packages/api/src/domains/<name>` green; `tsc -b` green |
| 5 | **Router + frontend** — tRPC procedures + `apps/web/src/features/<name>/` + step defs | AI | `make test` green for that feature's BDD scenarios |
| 6 | **ADR promotion + lint tightening** — move ADR draft → accepted, fill `verified_by:`, add `// ADR-NNNN` cites | Human | ADR ledger updated; `make lint` green |

**Why exactly six.** Q1 follow-up. Brief separates spec authorship from
contract authorship (different cognitive modes). Contract before tests
makes tests bind to the surface, not to an implementation memory.
Tests before impl gives the AI a green/red signal it can hill-climb on.
Router after impl prevents accidental contract changes via "but tRPC
needed this shape." ADR last because the implementation forces final
nuance into the decision text.

**Why this beats classic red-green TDD here.** Pure red-green leaks
implementation choices into the test (mock `Db`, mock `Auth`, etc.).
Contract-first means the test binds to declared behavior; the AI fills
the gap.

### D3 — Frozen-contract AI handoff

The canonical prompt for commit #4:

> *"Implement `<name>-service.ts` so that all methods return real
> Effects (no `Effect.die`) and `bun test packages/api/src/domains/<name>`
> passes. You may consume any service in `R`. You may add helpers in
> this file. You may NOT modify `<name>-contract.ts`,
> `<name>-schema.ts`, or `<name>-errors.ts` — surface needed contract
> changes back as a question. You may NOT introduce new errors not
> declared in `<name>-errors.ts`. You may NOT add services to `R` not
> already declared in the contract."*

The **frozen** files (contract, schema, errors) are reviewed by a human
in commit #2. The AI never touches them in commit #4. If the AI thinks
the contract is wrong, it stops and asks — that question is the
artifact, and the answer is a separate human-authored commit on top
of commit #2 before commit #4 retries.

**Why this matters.** R073's "targeted unknowable info" finding
(+47pp): the contract is exactly that — information the AI cannot
derive from the codebase, encoded as a shape it cannot change. The
contract is the AI's hardness engineering.

### D4 — Effect Schema everywhere on the server; closes ADR-0014

Server: Effect Schema (`Schema.Struct(...)`) is the only schema
language. It produces both runtime parsers and derived TS types from
one declaration. tRPC `input(...)` receives an Effect-Schema-derived
parser via a small adapter (`schemaParser(MySchema)` returning a
`(raw: unknown) => MySchema.Type`).

Client: types come from `inferRouterOutputs<AppRouter>` and the
schema modules' exported types. Zod survives **only** for form
input — react-hook-form's resolver story for Effect Schema is
immature, and forms run in the browser where bundle weight matters.
A single client-side adapter in `apps/web/src/lib/forms.ts` derives
a Zod schema from the Effect schema's runtime parser via a generated
mirror; the mirror is generated at build time, not runtime.

**Why.** Q3. ADR-0014 was the last open schema decision. Effect Schema
inside the Effect runtime ecosystem removes the impedance mismatch
between schema parse and the `Effect<A, E, R>` channels — parse
errors live in the E channel automatically. Two schema languages for
two execution contexts (server runtime; browser form) is honest; one
schema language with two adapter shapes is a fiction.

**Closes ADR-0014.** Promote draft → accepted on day 6 with status
`Accepted, supersedes earlier "use Zod everywhere" hypothesis`. The
date is filled in at promotion time, not pre-baked into this spec.

### D5 — `Effect.Service` modern form everywhere; amends ADR-0015

All infrastructure services migrate from `Context.Tag` + manual
`Layer.effect` to the `Effect.Service` modern form:

```ts
// Before (current main)
export interface DbShape { /* ... */ }
export const Db = Context.GenericTag<DbShape>("Db");
export const DbLive = Layer.effect(Db, Effect.gen(function* () { /* ... */ }));

// After
export class Db extends Effect.Service<Db>()("Db", {
  effect: Effect.gen(function* () { /* ... */ }),
}) {}
// `Db` is the tag, the service shape, AND `Db.Default` is the layer.
```

Same migration for `Auth`, `Logger`, `QueueTag` → `Queue`,
`CurrentSession`. Public API: `Db.Default`, `Auth.Default`, etc.
Composition uses `Layer.merge(Db.Default, Auth.Default, ...)`.

**ADR-0015 amendment.** Add a §"Service shape" subsection: queue
service uses `Effect.Service` form; the `Queue` class IS the tag.
Replace the existing `Context.GenericTag` snippets in the ADR.

**Why this is non-cosmetic.** `Effect.Service` collapses the tag/layer
duplication. The class IS the tag, the static method `.Default` IS the
layer, the instance methods ARE the contract. One declaration, three
roles. AI-generated code with the older form has three places to drift;
the new form has one.

### D6 — `Effect.Schedule` for retry composition

The worker's retry policy moves from a hand-rolled BullMQ retry config
to `Effect.Schedule` composition:

```ts
const retryPolicy = Schedule.exponential("100 millis", 2.0).pipe(
  Schedule.intersect(Schedule.recurs(5)),
  Schedule.jittered,
);
const handler = todoPurgeEffect.pipe(Effect.retry(retryPolicy));
```

BullMQ's job-level retry stays as the outer envelope (worker crash,
process restart). `Effect.Schedule` handles in-process transient
failure (DB connection blip, etc.) before BullMQ's counter advances.

**Why.** Two-layer retry is honest about two failure modes: in-process
(retry the Effect cheaply) vs. out-of-process (BullMQ re-enqueues to
a fresh worker). Hand-rolled retry inside the handler conflates them.

### D7 — Five lint checks (the hardness surface)

Each plugs into the existing `make lint` turbo registry per CLAUDE.md
"Adding a new custom check" recipe. Each ships with a Vitest fixture
covering pass + fail cases.

| # | Check | Enforces | Mandatory? |
|---|---|---|---|
| 1 | `check-explicit-return-types` | Every `export` from `packages/api/src/domains/**/*-{contract,service}.ts` declares `: Effect.Effect<A, E, R>` (no inferred returns on the AI's surface) | Yes |
| 2 | `check-tagged-errors` | Every `export class` in `packages/api/src/domains/**/*-errors.ts` extends `Data.TaggedError(...)` | Yes |
| 3 | `check-effect-service-form` | No `Context.Tag` / `Context.GenericTag` calls outside an allowlist; services use `extends Effect.Service<Self>()(...)` form | Yes |
| 4 | `check-contract-before-impl` | If `<name>-service.ts` exists in a domain folder, sibling `<name>-contract.ts`, `<name>-schema.ts`, `<name>-errors.ts` MUST exist | Yes |
| 5 | `check-totality` | For every method tagged `@totality` in a JSDoc, the method's E channel must include a `*SkippedError` variant | Opt-in (per-method) |

**Pseudocode — `check-explicit-return-types`:**

```ts
// Walk packages/api/src/domains/**/*-{contract,service}.ts.
// For each `export function` / `export const` / class method:
//   - Parse with TS compiler API.
//   - If the declared return type's symbol is not `Effect.Effect`,
//     error: "<file>:<line>: <name> must declare Effect.Effect<A, E, R>".
//   - Inferred returns (no annotation) are ALWAYS an error here, even
//     if inference resolves to Effect.Effect — explicit > inferred.
```

**Pseudocode — `check-tagged-errors`:**

```ts
// Walk packages/api/src/domains/**/*-errors.ts.
// For each `export class X extends Y`:
//   - Y must be a CallExpression `Data.TaggedError("...")`.
//   - The string literal must equal the class name.
//   - Otherwise error.
```

**Pseudocode — `check-effect-service-form`:**

```ts
// Walk packages/{api,db,auth,jobs,realtime}/src/**/*.ts (excluding tests).
// Forbid `Context.Tag(` and `Context.GenericTag(` calls except in:
//   - packages/lint/** (this check's own fixtures)
//   - any file matching ALLOWLIST (currently empty; reserved for
//     genuine non-service tags if any emerge)
// Suggest: "use class X extends Effect.Service<X>()(...) instead"
```

**Pseudocode — `check-contract-before-impl`:**

```ts
// For each packages/api/src/domains/<name>/<name>-service.ts:
//   - Check sibling <name>-contract.ts exists. Else error.
//   - Check sibling <name>-schema.ts exists. Else error.
//   - Check sibling <name>-errors.ts exists. Else error.
// (Inverse direction is fine — a contract with no impl is the post-#2
// pre-#4 state, which is a legitimate intermediate.)
```

**Pseudocode — `check-totality` (opt-in):**

```ts
// For each method whose JSDoc contains @totality in
// packages/api/src/domains/**/*-contract.ts:
//   - Parse the method's return type.
//   - Walk the E channel union.
//   - Require at least one variant matching /Skipped[A-Z]\w*Error$/.
//   - Otherwise error: "@totality method <name> must declare a
//     *SkippedError variant in its E channel (R023 record-level
//     accountability)".
```

**Why these five.** Q3 / brainstorm Section 3. Mandatory four catch
the classes of drift the brainstorm identified (inferred returns,
non-tagged errors, old service form, AI deletes contract). Opt-in
fifth is R023's totality principle, which the user named as
load-bearing but which doesn't apply to all methods.

### D8 — Conventions doc

Single file `docs/conventions/effect-contract-first.md` (≤200 lines),
imperative ALWAYS/NEVER markers per R023's checklist-format finding.
Linked from root `CLAUDE.md` under a new "Effect contract-first"
section. Skeleton:

```
# Effect Contract-First Conventions

## ALWAYS
- ALWAYS declare `Effect.Effect<A, E, R>` return types on domain exports.
- ALWAYS define errors with `Data.TaggedError("X")<{...}>`.
- ALWAYS write the contract+schema+errors commit BEFORE the service commit.
- ...

## NEVER
- NEVER modify `<name>-{contract,schema,errors}.ts` while implementing `<name>-service.ts`.
- NEVER use `Context.Tag` for new services. Use `Effect.Service` form.
- NEVER use Zod on the server. Use Effect Schema. (Forms in apps/web are the only Zod-allowed surface.)
- ...

## When the AI hits a wall
- If the contract feels wrong, STOP and ask. The contract is frozen
  during impl; changing it is a separate human commit.
- ...

## Cross-references
- ADR-0009 (full rewrite onto Effect)
- ADR-0014 (schema validation — closed by this rewrite)
- ADR-0015 (queue — amended)
- R023 (totality)
- R073 (hardness engineering)
```

## Sequencing — 7 days, ~25 commits

Branch `rewrite/contract-first` cuts from `main@0131caf`. Tag
`stable-pre-effect` at `0131caf` first (hard rollback). Branch merges
to `main` after day 4 lint+test green; days 5–7 merge incrementally.

| Day | Work | Commits | Merge gate |
|---|---|---|---|
| 1 | Lint checks (5) + conventions doc + retrofit `Db` / `Auth` / `Logger` / `QueueTag→Queue` / `CurrentSession` to `Effect.Service` form | 6 | All checks have passing fixtures; retrofitted services compile; `make lint` + `make test` green |
| 2 | Retrofit `auth` domain to contract-first split (`auth-contract.ts`, `auth-schema.ts`, `auth-errors.ts`, `auth-service.ts`) | 4 | `make test` green; `make lint` green incl. all 5 checks |
| 3 | Retrofit `todo-list` domain to contract-first split | 5 | Same |
| 4 | Retrofit `@project/jobs` + `apps/worker` (capability #1) to contract-first; add `Effect.Schedule` retry; ADR-0015 amended | 4 | Worker integration test green; ADR-0015 amendment merged |
| — | **Merge to `main`.** Soft rollback point established. | — | — |
| 5 | **Capability #2 (Email)** — first capability built from scratch under new rules. Canonical example. ADR-0020 promoted accepted. | 6 | Capability #2 BDD scenarios green |
| 6 | Buffer — lint false-positive triage, ADR-0014 closure commit, conventions doc tweaks based on day 1–5 friction | 3 | `make lint` clean across repo; ADR ledger 7+/11 accepted |
| 7 | Retrospective + Phase 4 plan rev2 for capabilities 3–9 (cards, realtime, etc.) — *no code*, just plan updates | 1 | Plan committed |

**Day 1 commit breakdown (concrete):**

1. `feat(lint): add check-explicit-return-types`
2. `feat(lint): add check-tagged-errors`
3. `feat(lint): add check-effect-service-form + check-contract-before-impl`
4. `feat(lint): add check-totality (opt-in)`
5. `docs: add docs/conventions/effect-contract-first.md + link from CLAUDE.md`
6. `refactor: migrate Db/Auth/Logger/Queue/CurrentSession to Effect.Service form`

**Days 2–4 per-domain commit breakdown** follows D2's six-commit
cadence, except commit #1 (Brief) is replaced by "scenarios already
exist" — the retrofitted domains have Gherkin specs already. So days
2–4 are 5 commits each (skip #1), totaling 15. The handover's "4 / 5
/ 4" on those days reflects per-domain content density, not commit
count drift; treat the table above as authoritative for *commit count
upper bound* and let the actual count fall out of the cadence.

**Day 5 (capability #2 Email)** runs the full six-commit cadence
including #1 Brief. This is the validating run — first capability
from scratch under the new rules.

## What stays / what gets rewritten

**Stays (sunk-cost-protected):**

- BDD scenarios in `e2e/features/**/*.feature` — pure spec, no Effect
  coupling.
- `packages/test-infra/` — port allocation, docker helpers, harness.
- `packages/db/prisma/schema.prisma` — schema content; only the
  generator wrapper changes.
- All existing custom lint checks in `packages/lint/src/check-*.ts`.
- `docs/capabilities.md`, `docs/conventions.md` (extended, not
  rewritten).
- ADR-accepted decisions (0011, 0012, 0013, 0017, 0019). 0015 is
  amended (D5); 0014 is closed (D4).

**Gets rewritten:**

- `packages/api/src/domains/auth/**` — split into 6 files.
- `packages/api/src/domains/todo-list/**` — split into 6 files
  (the existing 5 collapse + 1 new = 6 plus optional constants).
- `packages/jobs/src/**` + `apps/worker/src/**` — service-form +
  contract split + Schedule retry.
- All `Context.GenericTag` declarations across infra packages.
- Server-side Zod usages (replaced by Effect Schema).
- `apps/web/src/lib/forms.ts` (new file): Effect→Zod adapter for
  forms only.

## Risks + mitigations

| Risk | Mitigation |
|---|---|
| Lint check false positives block real work on days 2–5 | Day 6 is dedicated buffer; each check has a documented escape hatch (`// lint-disable-next-line check-X — reason`); checks emit warnings (not errors) for the first 24h after introduction, escalating to errors before the corresponding retrofit day starts |
| AI generates impl that "almost compiles" by widening contract types | Frozen contract files + `check-explicit-return-types` makes any contract widening a separate human-reviewed commit; the AI's commit-#4 diff is mechanically scoped to `<name>-service.ts` |
| Effect Schema → Zod forms adapter blows up bundle | Forms adapter is a generated mirror, not a runtime cross-import; Effect Schema is in server bundle only. Verified by `apps/web` size budget in turbo build output |
| `Effect.Service` modern form has subtle migration gotchas (e.g., `.Default` vs old layer composition order) | Day 1 commit 6 is the canary; if it fails, rollback that one commit and reconsider before day 2 starts |
| Capability #2 (Email) reveals the cadence is wrong | Day 5 is the validating run, day 6+7 absorb the lesson; if cadence is wrong, days 6–7 become "revise cadence" instead of buffer + plan |
| Worker retry layering (Effect.Schedule + BullMQ) double-counts retries | Integration test in day 4 commits explicitly verifies BullMQ counter advances once per *outer* failure, not per inner Schedule iteration |

## Out of scope

- **Capability #2 frontend integration.** Email has no UI; ADR-0020
  promotion + service-side proof is enough. Frontend deferred to its
  own capability.
- **Effect-rewriting `apps/web` business logic.** The web app stays
  TanStack Query + tRPC client; only the forms adapter is new. A
  full client-side Effect rewrite is *not* this spec (would be a
  separate ADR + pitch — likely rejected, see ADR-0016 draft).
- **Rewriting capabilities 3–9 (cards, realtime mid-tier, admin/CASL,
  etc.).** Day 7 produces the rev2 plan; execution is a separate week.
- **Migrating BDD step defs to Effect.** Step defs stay
  Playwright-native; the Effect surface is API-internal.

## Validation — how we know it worked

Acceptance criteria for the `rewrite/contract-first` branch merge to
`main`:

1. `make lint` green, all 5 new checks active and mandatory (#5
   active opt-in).
2. `make test` + `make test-unit` green.
3. ADR ledger: 0014 closed, 0015 amended, 0020 accepted (after day 5),
   ADR ledger ≥ 7/11 accepted.
4. `grep -r "Context.GenericTag" packages/{api,db,auth,jobs,realtime}/src`
   returns zero matches outside the lint allowlist.
5. `grep -r "Effect.die" packages/api/src/domains` returns zero
   matches (no contract stubs leaked into impl).
6. Capability #2 (Email) BDD scenarios green from a *clean* checkout
   of the branch — proves the cadence is repeatable.
7. Day 7 commit lands `Phase 4 plan rev2` with capability #3+
   sequencing under the new rules.

## Open questions (deferred, not blocking)

- **Form schema generation mechanism** (D4). Build-time mirror vs.
  hand-written Zod twins per form. Day 1 spike if it blocks; otherwise
  decide during day 5 capability #2 work (Email has no forms — the
  forced decision is in the *next* capability with a form, likely
  cards or admin).
- **Pre-existing `Effect.runPromise` boundary in tRPC adapter.** Stays
  on day 1; whether to wrap it in a more idiomatic
  `runFork`+`Exit.match` adapter is a day-6 nice-to-have, not a hard
  requirement.
- **`apps/web` route-loader Effect adoption.** Out of scope per above;
  re-evaluate after capability #9.

## Next steps (after this spec is approved)

1. **User reviews this spec.** Pause for explicit "go" before
   `writing-plans`.
2. **Invoke `superpowers:writing-plans`** with this file as the seed
   to produce the implementation plan (per-commit task list with
   file paths, diff sketches, verification commands).
3. **Execute via `superpowers:executing-plans`** in a separate session
   per the standard handover.

## References

- `HANDOVER.md` (this rewrite's brainstorm trail; can be deleted after
  this spec lands).
- `~/Documents/Knowledge/researches/023-black-box-module-contracts/readme.md`
  (R023 — totality / record-level accountability).
- `~/Documents/Knowledge/researches/073-grace-ldd-ai-code-markup/readme.md`
  (R073 — external context files, hardness engineering).
- `docs/adrs/0009-full-rewrite-onto-effect-ts.md` (the parent rewrite
  ADR — this spec is the contract-first execution of 0009's intent).
- `docs/adrs/draft/0014-schema-validation.md` (closed by D4).
- `docs/adrs/0015-queue.md` (amended by D5).
- `docs/superpowers/specs/2026-04-18-zero-conf-architecture-design.md`
  (precedent for the Decisions/Principles/Rollback structure used
  here).
