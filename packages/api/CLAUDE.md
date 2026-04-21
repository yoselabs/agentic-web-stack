# packages/api — tRPC Router + Context

> **Cross-layer naming:** each domain's folder name mirrors `apps/web/src/features/<same-name>/` and `e2e/features/<same-name>/`. See root `CLAUDE.md` § "Cross-Layer Naming".

## Architecture: Router → Service → Prisma

```
domains/todo/
  constants.ts               ← Primitives (client-safe)
  service.ts                 ← Business logic; mutations typed Prisma.TransactionClient, reads typed DbClient
  router.ts                  ← Thin: Zod validation + protectedProcedure + $transaction → service
  __tests__/
    service.test.ts          ← Service unit tests (direct function calls)
    router.test.ts           ← Router integration tests (createCaller, auth guards)
```

**Routers** are wiring only — input validation (Zod), auth (`protectedProcedure`), and transaction boundaries.

**Services** are pure functions that accept `PrismaClient | Prisma.TransactionClient` as first argument. They never receive tRPC context (`ctx`), never start transactions, and never import from tRPC.

## Adding a New Feature

1. Create `src/domains/<name>/constants.ts` if the feature has client-safe primitives
2. Create `src/domains/<name>/service.ts` — business logic; mutations typed `Prisma.TransactionClient`, reads typed `DbClient`
3. Create `src/domains/<name>/__tests__/service.test.ts` — service unit tests (TDD)
4. Create `src/domains/<name>/router.ts` — thin router wiring, wrap every mutation in `ctx.db.$transaction((tx) => ...)`. The wrap is not type-enforced (see Transaction Rules below) — discipline and code review catch the miss.
5. Register in `src/router.ts` at the alphabetical position (see "Append-Alpha Router Registration" below)
6. Create `src/domains/<name>/__tests__/router.test.ts` for router-level tests (auth, validation)
7. If the web app needs constants or schemas, add the subpath to `@project/api` exports and import via `@project/api/domains/<name>/constants`
8. Run `make check` — types propagate to apps/web automatically
- **Realtime fan-out.** If the mutation should fan out to collaborators
  in real time, follow the payload-event pattern in
  `packages/api/src/domains/todo-list/todo-service.ts` (see `createTodo`,
  `completeTodo`). Each event kind goes into the `TODO_LIST_EVENT_KINDS`
  tuple in `events.ts` (convention:
  [`docs/conventions.md#event-kinds-ssot`](../../docs/conventions.md#event-kinds-ssot)).
  Backend unit tests inject `MemoryChannelFactory` and assert publish
  (see `todo-service-publishes.test.ts`). Cross-feature notifications
  (sidebar counters, access grants) publish to the user-inbox channel —
  see `domains/todo-list/user-inbox-publishers.ts` and [ADR-001](../../docs/adrs/0001-realtime-architecture.md).
- **Rate limiting.** Sensitive mutations can be gated with the middleware
  in `src/rate-limit-middleware.ts`. Reference consumer: `todo-list`
  create. The limiter is constructed via `@project/rate-limit/factory`.

### Example: Add a posts feature

Create service `src/domains/post/service.ts`:

```typescript
import { Prisma, type PrismaClient } from "@project/db";

type DbClient = PrismaClient | Prisma.TransactionClient;

// Reads — accept either.
export async function listPosts(db: DbClient, userId: string) {
  return db.post.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
}

// Writes — Prisma.TransactionClient only. Router MUST wrap in $transaction.
export async function createPost(
  tx: Prisma.TransactionClient,
  userId: string,
  title: string,
) {
  return tx.post.create({
    data: { title, userId },
  });
}
```

Create router `src/domains/post/router.ts`:

```typescript
import { z } from "zod";
import { createPost, listPosts } from "./service.js";
import { protectedProcedure, router } from "../../trpc.js";

export const postRouter = router({
  list: protectedProcedure.query(({ ctx }) => {
    return listPosts(ctx.db, ctx.session.user.id);
  }),
  create: protectedProcedure
    .input(z.object({ title: z.string().min(1) }))
    .mutation(({ ctx, input }) => {
      return ctx.db.$transaction((tx) =>
        createPost(tx, ctx.session.user.id, input.title),
      );
    }),
});
```

Mount in `src/router.ts`:

```typescript
import { postRouter } from "./domains/post/router.js";

export const appRouter = router({
  // ... existing routes
  post: postRouter,
});
```

### Include Pattern (Prisma relations)

When a service uses `include` (e.g., `listTodoLists` with `_count`), the type flows correctly through `inferRouterOutputs`. The issue arises in `setQueryData` callbacks — see `apps/web/CLAUDE.md` for the workaround.

## Parent/Child Entities in One Domain

When a user-facing capability owns an aggregate + child entities (list + items,
board + cards), keep both under one `domains/<name>/` folder and prefix each
file with its entity name. Splitting into two domain folders fragments imports
and cascades through every test and BDD scenario.

Canonical example — `domains/todo-list/`:

```
domains/todo-list/
  todo-list-router.ts        todo-router.ts        events.ts
  todo-list-service.ts       todo-service.ts       authz.ts
  todo-list-constants.ts     todo-constants.ts     user-inbox-publishers.ts
  todo-list-http.ts          __tests__/
```

Rules:
- Folder name matches the user-visible feature (the aggregate).
- Prefix each file with the entity name (`todo-list-*` for the aggregate,
  `todo-*` for children) so path + filename uniquely identify the entity.
- Register the aggregate router in `src/router.ts` (`todoList`); child procedures
  either live on the aggregate router or get their own (`todo: todoRouter`)
  depending on URL shape. Append-alpha applies either way.
- Cross-entity authz, events, user-inbox publishers live at the folder root —
  they span both entities.

This pattern stays cleanly expressible in one domain until the child entity
grows its own lifecycle (separate CRUD UI, separate authz surface). When that
happens, promote the child to its own `domains/<child>/` and add it to
`check-domain-names.ts` — not before.

## Transaction Rules

- **All mutations (including read-then-write):** service function is typed `Prisma.TransactionClient`. Router wraps in `db.$transaction((tx) => ...)`. The tx type documents the requirement and surfaces it in hover tooltips + code review, but **it is NOT a compile-time guarantee** — TypeScript's structural subtyping makes `PrismaClient` assignable to `Prisma.TransactionClient` (since `TransactionClient = Omit<PrismaClient, ...>`, PrismaClient has a superset of its methods). So `createTodo(ctx.db, ...)` without a `$transaction` wrap compiles. Enforcement is by convention + code review, same as before the narrow.
- **All reads (no writes):** service is typed `DbClient` (`PrismaClient | Prisma.TransactionClient`). Router calls service with `ctx.db` directly.
- **Cross-service:** router wraps multiple service calls in one `$transaction`.
- **Race conditions:** service uses `SELECT ... FOR NO KEY UPDATE` inside the `tx` it receives.
- **Why narrow mutations anyway?** Prisma has no native `FOR UPDATE`: if the root `PrismaClient` runs a `$queryRaw` for a lock outside a transaction, the lock releases immediately — silently, with no error. The `Prisma.TransactionClient` parameter type is the idiomatic Prisma signature for lock-participating code. A narrow signature makes the intent explicit at every call site; it is not self-enforcing.

```typescript
// Race-safe pattern inside a service function
async function lockActiveTodos(
  tx: Prisma.TransactionClient,  // ← never the DbClient union
  userId: string,
  todoListId: string,
): Promise<void> {
  // ORDER BY <pk>: deterministic lock order prevents deadlocks between callers.
  //   Rule: all lockers whose row sets can overlap must ORDER BY the same column,
  //   even if their WHERE predicates differ.
  // FOR NO KEY UPDATE: weaker lock, use when mutating non-key/non-FK columns only.
  //   Use plain FOR UPDATE only when deleting or mutating the primary key.
  await tx.$queryRaw`
    SELECT id FROM "Todo"
    WHERE "userId" = ${userId} AND "todoListId" = ${todoListId}
    -- Real lockActiveTodos also filters "completed" = false; omitted here
    -- to focus on the locking pattern. Add whatever WHERE you need.
    ORDER BY id
    FOR NO KEY UPDATE
  `;
}
```

See `packages/api/src/domains/todo/service.ts` for the canonical example.

## N+1 Prevention

- **Reads:** always use `include`/`select` for related data, never loop queries
- **Bulk writes:** use VALUES + UPDATE join pattern:

```typescript
const pairs = ids.map((id, i) => Prisma.sql`(${id}::text, ${i}::integer)`);
await db.$executeRaw`
  UPDATE "Todo" AS t
  SET "position" = d.new_position
  FROM (VALUES ${Prisma.join(pairs, ",")}) AS d(id, new_position)
  WHERE t.id = d.id
`;
```

Authorization is enforced by a gate check (e.g., `canReadList`) at the top of the service function — per the Transaction Rules above — not by scoping the SQL `WHERE`. Mixing authz into the bulk-write predicate silently drops rows instead of rejecting the request.

## Frontend Type Contracts

`@project/api` exposes the router via the `/router` subpath; tRPC's type-inference utilities come directly from `@trpc/server`. No barrel re-exports (see root CLAUDE.md's no-barrel rule):

```typescript
// Shared types for component props
import type { AppRouter } from "@project/api/router";
import type { inferRouterOutputs } from "@trpc/server";
type RouterOutput = inferRouterOutputs<AppRouter>;
export type Todo = RouterOutput["todo"]["list"][number];

// Proxy-level types inside components (v11 — from @trpc/tanstack-react-query)
import type { inferInput, inferOutput } from "@trpc/tanstack-react-query";
type CreateInput = inferInput<typeof trpc.todo.create>;
type ListOutput = inferOutput<typeof trpc.todo.list>;
```

Never define frontend types manually — derive them from the router so they stay in sync with schema changes.

## File Structure

- `src/trpc.ts` — single `initTRPC.create()`, exports `router`, `publicProcedure`, `protectedProcedure`
- `src/context.ts` — `createContext()` receives session from Hono, exports `Context` type
- `src/router.ts` — `appRouter` merging sub-routers (append-alpha), exports `AppRouter` type
- `src/domains/<name>/service.ts` — business logic; mutations typed `Prisma.TransactionClient`, reads typed `DbClient`
- `src/domains/<name>/router.ts` — thin router wiring (Zod, auth, `$transaction`)
- `src/domains/<name>/constants.ts` — client-safe primitives (optional)
- `src/domains/<name>/__tests__/service.test.ts` — service unit tests
- `src/domains/<name>/__tests__/router.test.ts` — router integration tests
- `src/index.ts` — re-exports everything
- `scripts/test-runner.ts` — invoked by `pnpm test`. Calls `setupTestDatabase("unit")` (docker boot + `prisma db push --force-reset`), then spawns `bun test` with `DATABASE_URL` + auth env vars injected. Forwards CLI args so `pnpm --filter @project/api test todo/service` filters by path. Bun's test runner replaces the old `vitest.config.ts` + `test-setup.ts` split — one file, one process model.

## Testing

`make test-unit` boots an isolated unit-suite Postgres container (dynamic port per worktree) and runs `bun test` against it. Tests import from `bun:test` (identical surface to vitest for `describe`/`it`/`expect`/`beforeAll`/etc). Tests use the real `db` client from `@project/db`; no mocking. Schema is force-reset at the start of every run. Tests are still responsible for their own per-test cleanup (unique IDs, `afterAll` deletion). See `docs/superpowers/specs/2026-04-17-test-db-shared-setup-design.md` for the full test infrastructure design.

## Context

`protectedProcedure` narrows `ctx.session` to non-null. Inside a protected procedure:
- `ctx.session.user` — authenticated user (id, email, name, etc.)
- `ctx.db` — Prisma client

## Append-Alpha Router Registration

The root `src/router.ts` lists every domain router alphabetically by key, one
per line, trailing comma always. New domains INSERT at the alpha position —
never append to the bottom.

Rationale: two agents adding features in parallel (e.g., "blog" and "comment")
edit different lines under alpha order — "blog" goes between `auth` and `todo`,
"comment" between `blog` and `todo`. Git's 3-way merge resolves these cleanly.
With append-to-bottom, both agents edit the last line — merge conflict.

```ts
export const appRouter = router({
  blog: blogRouter,
  comment: commentRouter,
  todo: todoRouter,
  todoList: todoListRouter,
});
```

## Do Not

- Create a second `initTRPC.create()` — all routers must use the one from `src/trpc.ts`
- Import `appRouter` value in client code — only import `type AppRouter`
- Skip input validation — always use `.input(z.object({...}))` for mutations
- Access `ctx.session.user` in `publicProcedure` — it's nullable, use `protectedProcedure`
- Name procedures `then`, `call`, or `apply` — reserved by JavaScript Proxy
- Put business logic in routers — delegate to service functions
- Call `db.$transaction` inside a service — the router owns transaction boundaries
- Pass tRPC `ctx` to services — extract fields and pass as plain arguments
