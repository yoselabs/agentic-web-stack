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

## Prisma Client Export

`src/index.ts` exports a singleton `db` with globalThis caching for dev hot-reload, plus a wildcard re-export of `@prisma/client` (all generated types, enums, `Prisma` namespace, `PrismaClient`).

Import as: `import { db, Prisma, MyEnum } from "@project/db"` — never import directly from `@prisma/client`

## Do Not

- Run `prisma migrate` in production without reviewing the generated SQL
- Delete or rename Better-Auth columns (breaks auth)
- Forget to run `make db-push` after schema changes (stale types)
- Use `@default(autoincrement())` for IDs — use `@default(cuid())` for distributed-safe IDs
