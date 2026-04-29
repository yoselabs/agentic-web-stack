# packages/api — tRPC + Effect Runtime

The Effect-aware backend layer. tRPC v11 owns the wire format
(ADR-0012); inside every procedure body, services return `Effect`. The
`runEffect` adapter is the only Promise↔Effect boundary on the server.

## Layers

| Layer | File | Role |
|---|---|---|
| `Db` | `src/runtime/db-layer.ts` | Wraps the `PrismaClient` singleton from `@project/db`. Use `tryDb((client) => client.todo.findMany(...))` from inside services. ADR-0013. |
| `Auth` | `src/runtime/auth-layer.ts` | Wraps Better-Auth. Exposes `handler` (request → response, mounted at `/api/auth/*`) and `getSession`. |
| `CurrentSession` | `src/runtime/auth-layer.ts` | Per-request `Option<Session>`. Provided by `runEffect` from the tRPC context. Use `requireSession` inside services that need a logged-in user. |
| `Logger` | `src/runtime/logger-layer.ts` | Effect's built-in `Logger`. JSON in prod, pretty in dev. ADR-0017. |

`AppLayer` (`src/runtime/app-layer.ts`) merges Db + Auth + Logger. It is
provided by `runEffect`, so service code never wires it up manually.

## tRPC ↔ Effect adapter

```ts
// Inside a procedure
.query(({ ctx }) => runEffect(myService(input), { session: ctx.session }))
```

`runEffect`:
1. Provides `CurrentSession` from the procedure's ctx and `AppLayer` for
   the rest.
2. Maps tagged errors (`DbError`, `NotFoundError`, `UnauthorizedError`,
   `ForbiddenError`, `ValidationError` — all from `./errors.ts`) to the
   matching `TRPCError` codes.
3. Surfaces unexpected defects as `INTERNAL_SERVER_ERROR`.

## Conventions

- Service functions return `Effect.Effect<A, E, Db | CurrentSession>`.
  Never call `Effect.runPromise` inside a service — only `runEffect` does.
- New tagged errors go in `src/errors.ts`. Add a case to `tagToCode` in
  `runEffect` so the wire response is meaningful.
- Each domain lives at `src/domains/<name>/` with at minimum
  `<name>-service.ts`, `<name>-router.ts`, `<name>-schema.ts`,
  `<name>-constants.ts`. The first slice (todo-list) is the canonical
  example.
- No barrel from `@project/api/.`. Always import via subpath
  (`@project/api/runtime/run-effect`,
  `@project/api/domains/todo-list/todo-service`). Enforced by
  `packages/lint/src/check-no-barrel.ts`.

## Testing (ADR-0019)

`bun test` for the api package. Per-package `test-helpers.ts` will
provide a TestDb Layer + `runTestEffect` helper. Lands with the
todo-list service tests.
