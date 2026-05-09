# Effect Contract-First — Day 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retrofit `packages/api/src/domains/todo-list/` to the contract-first six-file layout — adds `todo-contract.ts` + `todo-errors.ts`, migrates `todo-schema.ts` from Zod to Effect Schema, refactors `todo-service.ts` + `todo-purge-service.ts` into `TodoListService` (modern `Effect.Service` form) with explicit `Effect.Effect<A, E, R>` returns and `@totality`-tagged purge. Removes the Day-1 escape hatches (`.lint-pending`, `lint-disable-file` directives) — `check-explicit-return-types`, `check-contract-before-impl`, and `check-tagged-errors` then enforce uncompromised.

**Why now (and why this isn't "auth").** Original Day 2 was "retrofit auth domain" but the API has no auth domain — auth is asymmetric-by-design (`packages/auth/` + `packages/api/src/runtime/auth-layer.ts`). The only existing API domain is `todo-list`. Renumbering: this is now Day 2.

**Tech Stack:** Effect 3.x (`Schema`, `Effect.Service`, `Data.TaggedError`), tRPC, Prisma. No new deps.

**Source spec:** `docs/superpowers/specs/2026-05-07-effect-contract-first-design.md`.

**Branch:** `rewrite/contract-first` (current HEAD: `7d635ab`, Day 1 done).

**Roll-forward gate:** Day 4 capability merge to main per the spec.

---

## File Structure (end state)

`packages/api/src/domains/todo-list/`:
- `todo-constants.ts` — unchanged (5 lines)
- `todo-contract.ts` — NEW. `TodoListService` class extends `Effect.Service<TodoListService>()(...)` with method signatures.
- `todo-errors.ts` — NEW. Domain-specific `TaggedError` types: `TodoListNotFoundError`, `TodoNotFoundError`, `TodoNotOwnedError`, `TodoSkippedError` (`@totality` variant for `purge`).
- `todo-schema.ts` — REWRITTEN. Effect Schema (`Schema.Struct`) replacing Zod. Keep parser adapter for tRPC.
- `todo-service.ts` — REFACTORED. Implements `TodoListService` Live; explicit `Effect.Effect<A, E, R>` per method; consumes `Db | CurrentSession`; `purge` method tagged `@totality`. Absorbs current `todo-purge-service.ts`.
- `todo-purge-service.ts` — DELETED. Folded into `todo-service.ts` as the `purge` method.
- `todo-router.ts` — REFACTORED. tRPC adapter calling `TodoListService` methods via `runEffect`.
- `__tests__/todo-purge-service.test.ts` — RENAMED → `__tests__/todo-list-service.test.ts`. Tests now exercise `TodoListService` directly.
- `.lint-pending` — DELETED (Day 1 escape hatch lifted).

**Files outside the domain that change:**
- `packages/api/src/runtime/run-effect.ts` — may need a small extension for the new error types' tRPC mapping (extend the existing `mapErrorToTRPC` switch).
- `apps/worker/src/schedule.ts` — currently imports from `todo-purge-service.ts`; update import to consume `TodoListService.purge` via the runtime.
- `docs/adrs/draft/0014-schema-validation.md` → `docs/adrs/0014-schema-validation.md` (promote draft → accepted in commit 5).

---

## Cadence — 5 commits

The 6-commit cadence (spec D2) is for *new* capabilities. For retrofits, Brief (1) and behavioral tests (3) already exist; the work is contract authoring + impl refactor + router refactor + ADR closure. Five commits keep each step build-green and reviewable.

| # | Commit | What changes | Build/test gate |
|---|---|---|---|
| 1 | Contract + errors scaffolding | Add `todo-contract.ts` (TodoListService class, methods declared `Effect.die("not implemented")`) + `todo-errors.ts` (5 TaggedError types) | `tsc -b` green; `make lint` green (`check-tagged-errors` now scans the new file; `check-explicit-return-types` and `check-contract-before-impl` still suppressed by Day-1 escape hatches) |
| 2 | Schema migration to Effect Schema | Rewrite `todo-schema.ts` from Zod → `Schema.Struct(...)`. Keep tRPC's `input(...)` happy via a small `effectSchemaInput(schema)` adapter (pattern below). Update `todo-service.ts` + `todo-router.ts` imports to consume new types. | `tsc -b` green; `make lint` green; `make test-unit` green |
| 3 | Service refactor to Effect.Service Live | Rewrite `todo-service.ts` to implement `TodoListService` per the contract — explicit `Effect.Effect<A, E, R>` on every method; map current `NotFoundError`/`ForbiddenError` calls to domain-specific `TodoListNotFoundError`/`TodoNotOwnedError`. Delete `todo-purge-service.ts`; fold its body into `purge` method (with `@totality` JSDoc + `TodoSkippedError` declared in the E channel — even if zero records skip today, the variant must exist). Remove `lint-disable-file check-explicit-return-types` directive from both files. Update `apps/worker/src/schedule.ts` to call via `TodoListService.purge` from the runtime. | `tsc -b` green; `make lint` green (`check-explicit-return-types` and `check-totality` now active without escape hatch); `make test-unit` green |
| 4 | Router refactor + escape-hatch removal | Rewrite `todo-router.ts` to call `TodoListService.list/create/etc.` via `runEffect`. Delete `packages/api/src/domains/todo-list/.lint-pending` (Day 1 escape hatch). Update `mapErrorToTRPC` in `run-effect.ts` to handle the new domain errors (or compose via the shared `errors.ts` superset — pick the smaller delta). | `tsc -b` green; `make lint` green (`check-contract-before-impl` now enforced); `make test-unit` green; `make test` 8/8 |
| 5 | ADR-0014 promotion | Move `docs/adrs/draft/0014-schema-validation.md` → `docs/adrs/0014-schema-validation.md`; update front-matter status to `accepted`; fill `verified_by` with capabilities now using Effect Schema (`todo-list`). Update `docs/adrs/README.md` ledger. | `make lint` green; `check-adrs` green |

Each commit's post-state must satisfy:
- `pnpm exec tsc -b` zero errors
- `make lint` zero errors
- `make test-unit` (api 9/9, web 2/2 or matching the post-refactor count) green
- `make test` (BDD 8/8 in-slice) green where applicable (commits 3, 4)

---

## Reusable patterns

### tRPC `input()` adapter for Effect Schema

tRPC's `input()` accepts a function `(raw: unknown) => parsedValue` (or a Zod-like `.parse()` shape). Provide:

```ts
// packages/api/src/runtime/effect-schema-input.ts (new — small)
import { Schema } from "effect";
import { Effect } from "effect";

export const effectSchemaInput = <A, I>(schema: Schema.Schema<A, I, never>) => {
  const decode = Schema.decodeUnknownEither(schema);
  return (raw: unknown): A => {
    const result = decode(raw);
    if (result._tag === "Left") {
      throw new Error(`schema parse failed: ${result.left.message}`);
    }
    return result.right;
  };
};
```

(Throws on parse failure — tRPC catches and surfaces as `BAD_REQUEST`. A future commit can replace the throw with a typed `TRPCError`, but for D2 keep it minimal.)

### `Effect.Service` shape for TodoListService

```ts
// todo-contract.ts
import { Effect } from "effect";
import type { Db } from "../../runtime/db-layer.ts";
import type { CurrentSession } from "../../runtime/auth-layer.ts";
import type * as TodoSchema from "./todo-schema.ts";
import type * as TodoErrors from "./todo-errors.ts";

export class TodoListService extends Effect.Service<TodoListService>()(
  "@project/api/TodoListService",
  {
    effect: Effect.succeed({
      // Method signatures only — implementation lives in todo-service.ts.
      // Bodies are Effect.die("not implemented") here in commit 1.
      list: (input: TodoSchema.ListTodoListsInput): Effect.Effect<
        ReadonlyArray<TodoSchema.TodoList>,
        TodoErrors.TodoListError,
        Db | CurrentSession
      > => Effect.die("not implemented"),
      // ... (similar for createTodoList, getTodoList, deleteTodoList,
      // listTodos, createTodo, deleteTodo, toggleTodoCompleted, purge)
    }),
  },
) {}
```

In commit 3 the `effect: Effect.succeed({...})` body is replaced with the real implementation — same surface, real Effects.

### `@totality` on `purge`

```ts
// In todo-contract.ts (commit 1 declares; commit 3 implements)
/**
 * Purge stale completed todos older than the cutoff.
 * @totality
 */
purge: (input: TodoSchema.PurgeInput): Effect.Effect<
  TodoSchema.PurgeReport,
  TodoErrors.TodoSkippedError | TodoErrors.TodoListError,
  Db
> => Effect.die("not implemented"),
```

The `TodoSkippedError` variant is required by `check-totality`. Implementation in commit 3 may never actually raise it (today's purge is unconditional), but the declaration ensures future skip-with-reason behavior is type-tracked from day one. Per R023's compile-time accountability principle.

---

## Execution

Dispatch one implementer subagent per commit with the commit's full diff scope as the brief. Two-stage review (spec compliance + code quality) after each, per `superpowers:subagent-driven-development`. Verify gates after each commit.

**Why one-subagent-per-commit, not one-per-task:** the cadence's whole point is reviewable commits. Bundling commits inside one subagent loses the review checkpoint.

---

## Risks + mitigations

| Risk | Mitigation |
|---|---|
| Effect Schema's tRPC `input()` adapter mishandles edge cases (defaults, transforms) | Commit 2 keeps the existing Zod tests in place during migration; if a test breaks, the Effect Schema definition is wrong, not the adapter. Diagnose via the failing test's input. |
| Folding `todo-purge-service.ts` into `TodoListService.purge` breaks `apps/worker/src/schedule.ts`'s import path | Commit 3 includes the schedule.ts update in the same diff. Verified by `tsc -b` + worker boot smoke. |
| `check-totality` rejects the `purge` method because the regex needs tweaking from Day-1 implementer's broadened pattern | Sanity-check the regex against `TodoSkippedError` literally before committing. If the Day-1 implementer's pattern (`/Skipped\w*Error/`) accepts it, fine. |
| Post-retrofit `make test-unit` regression | Each commit is gated by `make test-unit`. If commit 3's service refactor regresses, fix before commit 4. |
| ADR-0014 promotion (commit 5) reveals other consumers still use Zod | The repo's only domain is `todo-list`; auth and forms are explicitly out-of-scope (auth is asymmetric, forms use Zod by D4 spec). `verified_by:` lists `todo-list` and notes "forms (apps/web) intentionally retain Zod per D4". |

---

## Done When

- All 5 commits land on `rewrite/contract-first`.
- `make lint` green with all 5 Day-1 lint checks active and unsuppressed (no `lint-disable-file`, no `.lint-pending`).
- `make test-unit` and `make test` green.
- `docs/adrs/draft/0014-schema-validation.md` is moved to accepted.
- `git grep "lint-disable-file check-explicit-return-types" packages/api/src/domains` returns zero matches.
- `git grep "lint-disable-file check-effect-service-form" packages/api/src/runtime packages/jobs/src` already returned zero in Day 1; remains zero.

## Next (Day 3)

Original spec's Day 3 was "todo-list retrofit." This plan absorbed that into Day 2. The follow-on plan should pick up the spec's original Day 4 scope: retrofit `@project/jobs` + `apps/worker` (capability #1) — adds `Effect.Schedule` retry composition, amends ADR-0015. Then Day 4 = original Day 5 (Email capability from scratch under the new rules).

In short, Day 2 absorbed Day 3's planned content; everything downstream shifts left by one day. Day 7 (retro) is no longer needed since we'll have the data after one merge cycle.
