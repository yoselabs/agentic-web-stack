# packages/api — tRPC Router + Context

## Architecture: Router → Service → Prisma

```
routers/todo.ts              ← Thin: Zod validation + protectedProcedure + $transaction → service
services/todo.ts             ← Business logic: accepts db|tx, owns domain rules
services/__tests__/todo.test.ts  ← Service unit tests (direct function calls)
__tests__/todo.test.ts       ← Router integration tests (createCaller, auth guards)
```

**Routers** are wiring only — input validation (Zod), auth (`protectedProcedure`), and transaction boundaries.

**Services** are pure functions that accept `PrismaClient | Prisma.TransactionClient` as first argument. They never receive tRPC context (`ctx`), never start transactions, and never import from tRPC.

## Adding a New Feature

1. Create `src/services/<name>.ts` with business logic functions
2. Create `src/services/__tests__/<name>.test.ts` with service unit tests (TDD)
3. Create `src/routers/<name>.ts` with thin router wiring
4. Mount in `src/router.ts`
5. Create/update `src/__tests__/<name>.test.ts` for router-level tests (auth, validation)
6. Run `make check` — types propagate to apps/web automatically

### Example: Add a posts feature

Create service `src/services/post.ts`:

```typescript
import { Prisma, type PrismaClient } from "@project/db";

type DbClient = PrismaClient | Prisma.TransactionClient;

export async function listPosts(db: DbClient, userId: string) {
  return db.post.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
}

export async function createPost(db: DbClient, userId: string, title: string) {
  return db.post.create({
    data: { title, userId },
  });
}
```

Create router `src/routers/post.ts`:

```typescript
import { z } from "zod";
import { createPost, listPosts } from "../services/post.js";
import { protectedProcedure, router } from "../trpc.js";

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
import { postRouter } from "./routers/post.js";

export const appRouter = router({
  // ... existing routes
  post: postRouter,
});
```

### Include Pattern (Prisma relations)

When a service uses `include` (e.g., `listTodoLists` with `_count`), the type flows correctly through `inferRouterOutputs`. The issue arises in `setQueryData` callbacks — see `apps/web/CLAUDE.md` for the workaround.

## Transaction Rules

- **All mutations:** router wraps in `db.$transaction((tx) => ...)` — even single-write ops, so you never forget when the service grows
- **All reads:** router calls service with `db` directly (no transaction)
- **Cross-service:** router wraps multiple service calls in one `$transaction`
- **Race conditions:** service uses `SELECT ... FOR NO KEY UPDATE` inside the tx it receives
- **Lock helpers must be typed `Prisma.TransactionClient`, never the `DbClient` union.** Prisma has no native `FOR UPDATE`: if the root `PrismaClient` is passed, each `$queryRaw` runs in its own implicit transaction and the lock releases immediately — silently, with no error. Type-level narrowing is the only guard.
- Any service function that calls a lock helper must also be typed `Prisma.TransactionClient` so the invariant propagates to the caller.

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

See `packages/api/src/services/todo.ts` for the canonical example.

## N+1 Prevention

- **Reads:** always use `include`/`select` for related data, never loop queries
- **Bulk writes:** use VALUES + UPDATE join pattern:

```typescript
const pairs = ids.map((id, i) => Prisma.sql`(${id}::text, ${i}::integer)`);
await db.$executeRaw`
  UPDATE "Todo" AS t
  SET "position" = d.new_position
  FROM (VALUES ${Prisma.join(pairs, ",")}) AS d(id, new_position)
  WHERE t.id = d.id AND t."userId" = ${userId}
`;
```

## Frontend Type Contracts

`@project/api` re-exports type inference utilities so the frontend derives types from the server:

```typescript
// Shared types for component props (from @project/api)
import type { AppRouter, inferRouterOutputs } from "@project/api";
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
- `src/router.ts` — `appRouter` merging sub-routers, exports `AppRouter` type
- `src/routers/` — one file per domain sub-router (thin wiring only)
- `src/services/` — one file per domain service (business logic)
- `src/services/__tests__/` — service unit tests
- `src/__tests__/` — router integration tests
- `src/index.ts` — re-exports everything

## Context

`protectedProcedure` narrows `ctx.session` to non-null. Inside a protected procedure:
- `ctx.session.user` — authenticated user (id, email, name, etc.)
- `ctx.db` — Prisma client

## Do Not

- Create a second `initTRPC.create()` — all routers must use the one from `src/trpc.ts`
- Import `appRouter` value in client code — only import `type AppRouter`
- Skip input validation — always use `.input(z.object({...}))` for mutations
- Access `ctx.session.user` in `publicProcedure` — it's nullable, use `protectedProcedure`
- Name procedures `then`, `call`, or `apply` — reserved by JavaScript Proxy
- Put business logic in routers — delegate to service functions
- Call `db.$transaction` inside a service — the router owns transaction boundaries
- Pass tRPC `ctx` to services — extract fields and pass as plain arguments
