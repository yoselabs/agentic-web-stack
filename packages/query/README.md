# @project/query

TanStack Query patterns — optimistic mutations, query-key builders, prefetch helpers.

## Exports

- `@project/query/use-optimistic-mutation` — `useOptimisticMutation(mutation, { queryFilter, applyOptimistic, errorMessage })` wrapper that snapshots cache, applies an optimistic patch, rolls back on error, and invalidates on settle.

## Growth path

- Query-key builders: `qk.todoList(id)` to keep keys consistent across features.
- Prefetch helpers for route loaders.
- Typed `useMutation` factories that wire in toasts + invalidations in one call.

## Rules

- Subpath-only exports (enforced by `check-no-barrel`).
- Client-only — no server imports.
