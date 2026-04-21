# packages/db — Prisma Schema + Client

## Modify Schema Workflow

1. Edit the appropriate file in `prisma/schema/`:
   - `base.prisma` — generator + datasource (rarely changed)
   - `auth.prisma` — Better-Auth tables (User, Session, Account, Verification)
   - `todo.prisma` — Todo model
   - Create a new `<domain>.prisma` for new domains
2. Run `make db-push` (pushes schema + regenerates client)
3. Update TypeScript code that uses the changed models
4. Run `make check` to verify types

For production with migrations: `pnpm --filter @project/db migrate` instead of `db-push`.

## Schema Organization

One `.prisma` file per domain area. Models that belong together live in the same file.

| File | Owner | Contents |
|------|-------|----------|
| `base.prisma` | Infrastructure | Generator + datasource config |
| `auth.prisma` | Better-Auth | User, Session, Account, Verification |
| `todo.prisma` | Application | Todo |
| `todo-list.prisma` | Application | TodoList |

New domains get a new file (e.g., `post.prisma` for a blog feature). Never put unrelated models in the same file.

## Table Ownership

| Tables | Owner | Can modify? |
|--------|-------|-------------|
| `User`, `Session`, `Account`, `Verification` | Better-Auth | Add fields only — do not rename/remove existing columns |
| `Todo` | Application | Full control |
| New tables | Application | Full control — add relation to `User` via `userId` |

Better-Auth manages its core tables. You can ADD columns to `User` (e.g., `role`, `avatar`),
but do not rename or remove columns that Better-Auth uses (`id`, `email`, `name`, `emailVerified`, `image`, `createdAt`, `updatedAt`).

## Adding a New Model

```prisma
model Post {
  id        String   @id @default(cuid())
  title     String
  content   String?
  userId    String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
}
```

Then add the reverse relation in `User`:
```prisma
model User {
  // ... existing fields
  posts Post[]
}
```

## Load-Bearing `postinstall`

`package.json` has `"postinstall": "bun run scripts/generate.ts"` (invokes
the `prisma-client` generator that emits to `src/generated/`). This is
load-bearing:

- `make clean` wipes `node_modules`. `pnpm install` alone does NOT regenerate the Prisma client.
- Prisma 7's `db push` no longer implicitly runs generate, so no flag is needed to keep test paths fast — they simply never trigger generate.
- Without this hook, `make clean && pnpm install && make test-unit` would fail to resolve `./generated/client`.

Do not remove this hook.

## Prisma Client Export

Using the new `prisma-client` generator (output: `src/generated/client/`).
`src/index.ts` exports a singleton `db` with globalThis caching for dev
hot-reload, plus a wildcard re-export of `./generated/client` (all types,
enums, `Prisma` namespace, `PrismaClient`). `src/index.ts` is the only
barrel in the package — `noBarrelFile` is explicitly disabled for it in
`biome.json` and the file is excluded from the no-barrel-imports Grit
rule.

Import as: `import { db, Prisma, MyEnum } from "@project/db"` — consumers
never reach into `generated/` directly and never import from
`@prisma/client`.

## Do Not

- Run `prisma migrate` in production without reviewing the generated SQL
- Delete or rename Better-Auth columns (breaks auth)
- Forget to run `make db-push` after schema changes (stale types)
- Use `@default(autoincrement())` for IDs — use `@default(cuid())` for distributed-safe IDs
