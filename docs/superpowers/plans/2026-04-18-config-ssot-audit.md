# Configuration Single-Source-of-Truth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate duplicated configuration (ports, URLs, credentials, limits, mount paths, dependency versions) across the monorepo so every value lives in exactly one place.

**Architecture:** Introduce two mechanisms working together: `@project/config` for static compile-time constants (ports, limits, DB name, API mount paths), and `@project/env` (split into `/server` and `/client` subpaths, no barrel) for runtime-validated env vars. A `scripts/export-config.ts` bridge prints `@project/config` values as shell exports so `docker-compose.yml` and CI workflows can consume them without duplicating literals. Dependency versions go through the pnpm workspace catalog.

**Tech Stack:** TypeScript, pnpm workspaces, `@t3-oss/env-core` (Zod), Hono, TanStack Start (Vite), tRPC, Better-Auth, Prisma, Playwright, Vitest, Docker Compose, Biome / agent-harness.

**Spec:** `docs/superpowers/specs/2026-04-18-config-ssot-audit-design.md` (commit `1bca424`).

---

## Rollout Structure

Each task corresponds to one bucket from the spec and produces one PR. Ordered by dependency and risk (lowest first):

| Task | Bucket | Depends on | Risk |
|------|--------|------------|------|
| 1 | F — pnpm catalog | — | Low (pure lockfile refactor) |
| 2 | E1 — test credentials fixture | — | Low (test-only) |
| 3 | D — domain limits (creates `@project/config`) | — | Low (behavior-preserving) |
| 4 | A + B + E2 — infra config, env boundary, CI env vars | Task 3 | Medium (touches env, Makefile, compose, CI) |
| 5 | C — `apiClient` wrapper | Task 4 (needs `@project/env/client`) | Medium (touches every web fetch site) |

**Why A + B + E2 combine:** A's compose parametrization requires B's env consumers to read from validated env; B's fallback deletions require A's `@project/config` to supply defaults. E2 reuses A4's `scripts/export-config.ts` mechanism, so it naturally ships in the same PR.

---

## Task 1: F — pnpm Catalog for Shared Versions

**Goal:** Eliminate version drift for `@prisma/client` (6.5.0 vs 6.19.3) and `zod` (3.24.0 vs 3.25.76) by centralizing in `pnpm-workspace.yaml`. Also catalog `prisma`, `@t3-oss/env-core`, `@types/node`, `typescript` — the shared deps where drift risk is real.

**Files:**
- Modify: `pnpm-workspace.yaml`
- Modify: `package.json` (root)
- Modify: `apps/web/package.json`
- Modify: `apps/server/package.json`
- Modify: `packages/api/package.json`
- Modify: `packages/auth/package.json`
- Modify: `packages/db/package.json`
- Modify: `packages/env/package.json`
- Modify: `pnpm-lock.yaml` (regenerated)

**Context:** pnpm 9.5+ supports `catalog:` in `pnpm-workspace.yaml`. `packageManager: pnpm@10.32.1` in root `package.json` confirms we're on a compatible version. Consumers reference `"catalog:"` (or `"catalog:<name>"` for named catalogs) in their `package.json`; pnpm resolves to the catalog value at install time.

- [ ] **Step 1: Add `catalog:` block to `pnpm-workspace.yaml`**

Replace the contents of `pnpm-workspace.yaml` with:

```yaml
packages:
  - "apps/*"
  - "packages/*"
  - "e2e"

catalog:
  "@prisma/client": ^6.19.3
  prisma: ^6.19.3
  zod: ^3.25.76
  "@t3-oss/env-core": ^0.12.0
  "@types/node": ^25.6.0
  typescript: ^5.7.2
```

Rationale for version choices (from the spec): `@prisma/client` and `prisma` bumped to the newer `6.19.3` (matches `packages/auth`). `zod` bumped to `3.25.76` (matches `packages/api`). Others already consistent at those values, just centralizing.

- [ ] **Step 2: Update `packages/db/package.json` to use catalog**

Replace the file's dependency blocks:

```json
{
  "name": "@project/db",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "default": "./src/index.ts"
    }
  },
  "scripts": {
    "generate": "prisma generate",
    "push": "prisma db push",
    "studio": "prisma studio",
    "migrate": "prisma migrate dev",
    "postinstall": "prisma generate"
  },
  "dependencies": {
    "@prisma/client": "catalog:"
  },
  "devDependencies": {
    "@types/node": "catalog:",
    "prisma": "catalog:",
    "tsx": "^4.21.0"
  }
}
```

- [ ] **Step 3: Update `packages/auth/package.json` to use catalog**

```json
{
  "name": "@project/auth",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "default": "./src/index.ts"
    }
  },
  "dependencies": {
    "@prisma/client": "catalog:",
    "@project/db": "workspace:*",
    "better-auth": "^1.6.2"
  },
  "devDependencies": {
    "@types/node": "catalog:"
  }
}
```

- [ ] **Step 4: Update `packages/api/package.json` to use catalog**

```json
{
  "name": "@project/api",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "default": "./src/index.ts"
    }
  },
  "scripts": {
    "test": "vitest run"
  },
  "dependencies": {
    "@project/auth": "workspace:*",
    "@project/db": "workspace:*",
    "@trpc/server": "^11.0.0",
    "papaparse": "^5.5.3",
    "zod": "catalog:"
  },
  "devDependencies": {
    "@types/node": "catalog:",
    "@types/papaparse": "^5.5.2",
    "vitest": "^4.1.4"
  }
}
```

- [ ] **Step 5: Update `packages/env/package.json` to use catalog**

```json
{
  "name": "@project/env",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "default": "./src/index.ts"
    },
    "./server": {
      "default": "./src/server.ts"
    }
  },
  "dependencies": {
    "@t3-oss/env-core": "catalog:",
    "zod": "catalog:"
  },
  "devDependencies": {
    "@types/node": "catalog:"
  }
}
```

Note: package exports remain unchanged here — the `./client` subpath + barrel removal lands in Task 4. This task is lockfile-only.

- [ ] **Step 6: Update `apps/server/package.json` to use catalog**

```json
{
  "name": "@project/server",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch --env-file=../../.env src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "@hono/node-server": "^1.13.0",
    "@hono/trpc-server": "^0.3.0",
    "@project/api": "workspace:*",
    "@project/auth": "workspace:*",
    "@project/db": "workspace:*",
    "@project/env": "workspace:*",
    "hono": "^4.7.0",
    "pino": "^10.3.1"
  },
  "devDependencies": {
    "@types/node": "catalog:",
    "pino-pretty": "^13.1.3",
    "tsx": "^4.19.0"
  }
}
```

- [ ] **Step 7: Update `apps/web/package.json` to use catalog**

Only `typescript` (devDep) needs updating here — web's other deps aren't in the catalog. Replace just the relevant line:

```json
  "devDependencies": {
    "@types/react": "^19.2.0",
    "@types/react-dom": "^19.2.0",
    "@vitejs/plugin-react": "^6.0.1",
    "typescript": "catalog:",
    "vite": "^8.0.0"
  }
```

Keep all `dependencies` unchanged.

- [ ] **Step 8: Update root `package.json` to use catalog for `typescript`**

```json
  "devDependencies": {
    "@biomejs/biome": "^1.9.0",
    "@project/auth": "workspace:*",
    "@project/db": "workspace:*",
    "@tanstack/router-generator": "^1.166.29",
    "tsx": "^4.21.0",
    "typescript": "catalog:"
  },
```

Keep the rest of root `package.json` unchanged.

- [ ] **Step 9: Regenerate lockfile**

Run: `pnpm install`

Expected: `pnpm-lock.yaml` updates, no errors. Output should show dependency resolution completing successfully.

- [ ] **Step 10: Verify single version tree for catalogued deps**

Run: `pnpm why zod`

Expected: All consumers resolve to `^3.25.76` (single version in the tree, not a fan-out). Output shows `@project/api` and `@project/env` both pointing at the same resolved version.

Run: `pnpm why @prisma/client`

Expected: All consumers resolve to `^6.19.3`.

- [ ] **Step 11: Run lint and typecheck**

Run: `make lint`

Expected: PASS. All TypeScript source still compiles against the upgraded versions. No runtime change, so behavior unchanged.

- [ ] **Step 12: Run unit tests**

Run: `make test-unit`

Expected: PASS. Verifies Prisma client upgrade (6.5.0 → 6.19.3) doesn't break any existing queries.

- [ ] **Step 13: Run E2E tests**

Run: `make test`

Expected: PASS. Confirms the version bumps don't break the integration flow.

- [ ] **Step 14: Commit**

```bash
git add pnpm-workspace.yaml pnpm-lock.yaml package.json apps/web/package.json apps/server/package.json packages/api/package.json packages/auth/package.json packages/db/package.json packages/env/package.json
git commit -m "$(cat <<'EOF'
refactor(deps): centralize shared versions via pnpm workspace catalog

Eliminates drift: @prisma/client (6.5.0 → 6.19.3), zod (3.24.0 → 3.25.76).
Also catalogs prisma, @t3-oss/env-core, @types/node, typescript.

Part of SSOT audit (bucket F). See docs/superpowers/specs/2026-04-18-config-ssot-audit-design.md.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: E1 — Test Credentials Fixture

**Goal:** Eliminate duplicate test passwords/emails across `scripts/seed.ts`, `e2e/steps/auth.ts`, and `e2e/steps/todos.ts`. Share from a single fixture.

**Files:**
- Create: `e2e/fixtures/credentials.ts`
- Modify: `scripts/seed.ts:20,21,66,67`
- Modify: `e2e/steps/auth.ts:61`
- Modify: `e2e/steps/todos.ts:50`

**Context:** Spec E1 resolves the credentials split:
- `scripts/seed.ts` → uses `SEED_USER = { email: "demo@example.com", password: "testpassword123" }` (the seeded demo account).
- `e2e/steps/auth.ts` → uses `TEST_USER = { email: "test@example.com", password: "testpassword123" }` for tests that don't take email as a parameter.
- Steps that take `email` as a scenario parameter keep using the parameter; only the shared `password` becomes a single constant.

The `SEED_USER` keeps `demo@example.com` (pre-existing in demo seed; renaming would break any external demo instructions) but adopts the `testpassword123` value so E2E tests can sign into the seeded account if needed.

- [ ] **Step 1: Create `e2e/fixtures/credentials.ts`**

Write the file:

```typescript
// Shared test credentials. Import from this fixture instead of hardcoding
// passwords in step definitions or seed scripts.
//
// Two accounts:
// - SEED_USER: the demo account written by scripts/seed.ts. Stable across runs.
// - TEST_USER: a stable identity for E2E scenarios that don't parameterize the
//   email. Scenarios that take {string} emails parametrically use those
//   directly — this is only for steps that need a default.
//
// Both accounts share the same password so developers have one value to
// remember when debugging locally.

export const SHARED_PASSWORD = "testpassword123";

export const SEED_USER = {
  email: "demo@example.com",
  password: SHARED_PASSWORD,
} as const;

export const TEST_USER = {
  email: "test@example.com",
  password: SHARED_PASSWORD,
} as const;
```

- [ ] **Step 2: Update `scripts/seed.ts` to import `SEED_USER`**

Replace lines 1-3 and the usages. Full updated file:

```typescript
import { auth } from "@project/auth";
import { db } from "@project/db";
import { SEED_USER } from "../e2e/fixtures/credentials.ts";

async function main() {
  console.log("Seeding database...");

  // Check if already seeded
  const existing = await db.user.findFirst({
    where: { email: SEED_USER.email },
  });

  if (existing) {
    console.log(`Already seeded (${SEED_USER.email} exists), skipping.`);
    return;
  }

  // Create demo user via Better-Auth (handles password hashing)
  const { user } = await auth.api.signUpEmail({
    body: {
      email: SEED_USER.email,
      password: SEED_USER.password,
      name: "Demo User",
    },
  });

  console.log(`Created user: ${user.email}`);

  // Create sample todos
  await db.todo.createMany({
    data: [
      {
        title: "Set up the project",
        completed: true,
        position: 0,
        userId: user.id,
      },
      {
        title: "Add authentication",
        completed: true,
        position: 1,
        userId: user.id,
      },
      {
        title: "Build the dashboard",
        completed: false,
        position: 0,
        userId: user.id,
      },
      {
        title: "Write BDD tests",
        completed: false,
        position: 1,
        userId: user.id,
      },
      {
        title: "Deploy to production",
        completed: false,
        position: 2,
        userId: user.id,
      },
    ],
  });

  console.log("Created 5 sample todos");
  console.log("\nDemo credentials:");
  console.log(`  Email:    ${SEED_USER.email}`);
  console.log(`  Password: ${SEED_USER.password}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
```

Note: the import path `../e2e/fixtures/credentials.ts` is relative from `scripts/`. This is valid for `tsx` (which handles `.ts` imports) and for Node's loader when running under `tsx`. The project's existing `scripts/test-db.ts` is imported from `e2e/test-env.ts` across the same boundary, so the precedent exists.

- [ ] **Step 3: Update `e2e/steps/auth.ts` to import `SHARED_PASSWORD`**

At the top, add the import:

```typescript
import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import { SHARED_PASSWORD } from "../fixtures/credentials.ts";

const { Given: given, When: when, Then: then } = createBdd();
```

Then replace line 61 (inside `given("I am signed in as {string}", ...)`):

Change:
```typescript
given("I am signed in as {string}", async ({ page }, email: string) => {
  await signUpOrSignIn(page, email, "testpassword123");
});
```

To:
```typescript
given("I am signed in as {string}", async ({ page }, email: string) => {
  await signUpOrSignIn(page, email, SHARED_PASSWORD);
});
```

Also replace line 87 (inside the sign-up `when` step):

Change:
```typescript
    await page.getByLabel("Password").fill("testpassword123");
```

To:
```typescript
    await page.getByLabel("Password").fill(SHARED_PASSWORD);
```

- [ ] **Step 4: Update `e2e/steps/todos.ts` to import `SHARED_PASSWORD`**

At the top, add the import:

```typescript
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import { SHARED_PASSWORD } from "../fixtures/credentials.ts";
```

Replace line 50:

Change:
```typescript
  await page.getByLabel("Password").fill("testpassword123");
```

To:
```typescript
  await page.getByLabel("Password").fill(SHARED_PASSWORD);
```

- [ ] **Step 5: Verify no literal passwords remain in step defs or seed**

Run:
```bash
rg '"testpassword123"|"password123"' scripts/seed.ts e2e/steps/
```

Expected: zero matches. Every previous occurrence now goes through the fixture.

- [ ] **Step 6: Run lint and typecheck**

Run: `make lint`

Expected: PASS. The new imports resolve, no type errors from the `.ts` import path.

- [ ] **Step 7: Run E2E tests**

Run: `make test`

Expected: PASS. Auth scenarios still sign up/in successfully with the shared password.

- [ ] **Step 8: Run the seed (optional sanity)**

In a fresh dev DB (or manually), verify:
```bash
pnpm db:seed
```

Expected: Seeds a user `demo@example.com` with password `testpassword123`. Output confirms credentials shown match fixture values.

- [ ] **Step 9: Commit**

```bash
git add e2e/fixtures/credentials.ts scripts/seed.ts e2e/steps/auth.ts e2e/steps/todos.ts
git commit -m "$(cat <<'EOF'
refactor(test): single source of truth for test credentials

Extract TEST_USER and SEED_USER into e2e/fixtures/credentials.ts. Share
SHARED_PASSWORD between seed script and step definitions so a password
policy change is one edit, not three.

Part of SSOT audit (bucket E1). See docs/superpowers/specs/2026-04-18-config-ssot-audit-design.md.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: D — Domain Limits (Creates `@project/config`)

**Goal:** Move the file-upload size limit (currently server-only) and the password-min-length (currently client-only) into a new `@project/config` package. Wire both sides of each limit so client guards match server enforcement.

**Files:**
- Create: `packages/config/package.json`
- Create: `packages/config/tsconfig.json`
- Create: `packages/config/src/limits.ts`
- Create: `packages/config/src/index.ts`
- Modify: `apps/server/package.json` (add `@project/config` dep)
- Modify: `apps/web/package.json` (add `@project/config` dep)
- Modify: `packages/auth/package.json` (add `@project/config` dep)
- Modify: `apps/server/src/index.ts:99-102` (import `MAX_UPLOAD_BYTES`)
- Modify: `apps/web/src/features/todo/use-todos.ts` (pre-flight file size check)
- Modify: `apps/web/src/routes/login.tsx:109` (import `MIN_PASSWORD_LENGTH`)
- Modify: `packages/auth/src/index.ts:9-10` (add password policy matching `MIN_PASSWORD_LENGTH`)
- Modify: `tsconfig.base.json` or root `tsconfig.json` (if needed for new package)

**Context:** `@project/config` is a new workspace package for static compile-time constants. Unlike `@project/env` which validates runtime env vars, this package has no runtime — just `export const` declarations. Per the spec, it starts with only `limits.ts` in this task; Task 4 adds `ports.ts`, `db.ts`, `api-paths.ts`.

Better-Auth supports `emailAndPassword.minPasswordLength` in its config (per Better-Auth docs). The current config at `packages/auth/src/index.ts:9-11` has `emailAndPassword: { enabled: true }` with no length constraint, meaning the server silently accepts any password — the `minLength={8}` at `apps/web/src/routes/login.tsx:109` is the only gate. This task makes the server enforce the limit too.

The file upload pre-flight check in the web app: currently users can select a >10MB file, upload for 30 seconds, and hit a 413. After this task, the client rejects immediately with a toast.

- [ ] **Step 1: Create `packages/config/package.json`**

Write the file:

```json
{
  "name": "@project/config",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "default": "./src/index.ts"
    },
    "./limits": {
      "default": "./src/limits.ts"
    }
  },
  "devDependencies": {
    "@types/node": "catalog:"
  }
}
```

- [ ] **Step 2: Create `packages/config/tsconfig.json`**

Write the file. It extends the workspace base — check the root `tsconfig.base.json` to confirm the path; it's referenced by other packages like `packages/env`.

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "composite": true,
    "declaration": true
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Create `packages/config/src/limits.ts`**

Write the file:

```typescript
// Domain limits shared between client and server. Changing any value here
// must automatically propagate to every consumer (UI validation, server
// enforcement, error messages).

// Maximum file size for CSV todo imports. Enforced server-side at
// apps/server/src/index.ts upload handler, and also client-side in
// apps/web/src/features/todo/use-todos.ts so users get immediate
// feedback instead of a 413 after a long upload.
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

// Minimum length for Better-Auth passwords. Enforced in both the
// HTML <input minLength> attribute (apps/web/src/routes/login.tsx) and
// in Better-Auth's emailAndPassword.minPasswordLength option
// (packages/auth/src/index.ts).
export const MIN_PASSWORD_LENGTH = 8;
```

- [ ] **Step 4: Create `packages/config/src/index.ts`**

Write the file:

```typescript
export * from "./limits.js";
```

Note: `.js` extension in import paths is mandatory for ESM + TypeScript's `NodeNext` module resolution (the pattern used elsewhere in this repo — see `packages/env/src/index.ts`).

- [ ] **Step 5: Install the new package**

Run: `pnpm install`

Expected: pnpm detects the new workspace package, symlinks it. Output includes `@project/config` in the resolved packages.

- [ ] **Step 6: Add `@project/config` dep to `apps/server/package.json`**

Update the `dependencies` block:

```json
  "dependencies": {
    "@hono/node-server": "^1.13.0",
    "@hono/trpc-server": "^0.3.0",
    "@project/api": "workspace:*",
    "@project/auth": "workspace:*",
    "@project/config": "workspace:*",
    "@project/db": "workspace:*",
    "@project/env": "workspace:*",
    "hono": "^4.7.0",
    "pino": "^10.3.1"
  },
```

- [ ] **Step 7: Add `@project/config` dep to `apps/web/package.json`**

Insert `"@project/config": "workspace:*",` alphabetically in the `dependencies` block (between `@project/api` and `@project/ui`):

```json
  "dependencies": {
    "@dnd-kit/core": "^6.3.1",
    "@dnd-kit/sortable": "^10.0.0",
    "@dnd-kit/utilities": "^3.2.2",
    "@project/api": "workspace:*",
    "@project/config": "workspace:*",
    "@project/ui": "workspace:*",
    "@tailwindcss/vite": "^4.1.18",
    ...
  },
```

Keep all other deps unchanged.

- [ ] **Step 8: Add `@project/config` dep to `packages/auth/package.json`**

```json
{
  "name": "@project/auth",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "default": "./src/index.ts"
    }
  },
  "dependencies": {
    "@prisma/client": "catalog:",
    "@project/config": "workspace:*",
    "@project/db": "workspace:*",
    "better-auth": "^1.6.2"
  },
  "devDependencies": {
    "@types/node": "catalog:"
  }
}
```

- [ ] **Step 9: Install workspace deps**

Run: `pnpm install`

Expected: `@project/config` appears as a symlinked workspace dep in the consumers' `node_modules`.

- [ ] **Step 10: Update `apps/server/src/index.ts` to use `MAX_UPLOAD_BYTES`**

Find the block starting at line 99 and replace:

```typescript
  const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
  if (file.size > MAX_FILE_SIZE) {
    return c.json({ error: "File too large (max 10 MB)" }, 413);
  }
```

With:

```typescript
  if (file.size > MAX_UPLOAD_BYTES) {
    return c.json({ error: "File too large (max 10 MB)" }, 413);
  }
```

Add the import near the top (with the other `@project/*` imports, alphabetically):

```typescript
import { MAX_UPLOAD_BYTES } from "@project/config";
```

Keep the error message string as-is for now — the spec explicitly marks error-message SSOT as out of scope for this pass.

- [ ] **Step 11: Update `apps/web/src/features/todo/use-todos.ts` to pre-flight check size**

Add the import near the top (with the other `@project/*` imports):

```typescript
import { MAX_UPLOAD_BYTES } from "@project/config";
```

Then modify the `importTodos` mutation. Find the block starting at line 124:

```typescript
  const importTodos = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("todoListId", todoListId);
      const res = await fetch(`${API_URL}/api/todos/import`, {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Import failed");
      }
      return res.json() as Promise<{ count: number }>;
    },
    ...
```

Replace with (note: only the `mutationFn` body changes; the `onSuccess`/`onError` below stay the same):

```typescript
  const importTodos = useMutation({
    mutationFn: async (file: File) => {
      if (file.size > MAX_UPLOAD_BYTES) {
        throw new Error("File too large (max 10 MB)");
      }
      const formData = new FormData();
      formData.append("file", file);
      formData.append("todoListId", todoListId);
      const res = await fetch(`${API_URL}/api/todos/import`, {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Import failed");
      }
      return res.json() as Promise<{ count: number }>;
    },
    ...
```

The thrown error lands in the existing `onError: (err: Error) => toast.error(err.message)` handler, so users see the message as a toast immediately (before the upload starts).

- [ ] **Step 12: Update `apps/web/src/routes/login.tsx` to use `MIN_PASSWORD_LENGTH`**

Add the import near the top, alongside the other `@project/*` imports. After:

```typescript
import { Input } from "@project/ui/components/input";
import { Label } from "@project/ui/components/label";
```

Add:

```typescript
import { MIN_PASSWORD_LENGTH } from "@project/config";
```

Then replace line 109 inside the password `<Input>` element:

Change:
```tsx
                <Input
                  id="password"
                  type="password"
                  placeholder="Min 8 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                />
```

To:
```tsx
                <Input
                  id="password"
                  type="password"
                  placeholder={`Min ${MIN_PASSWORD_LENGTH} characters`}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={MIN_PASSWORD_LENGTH}
                />
```

- [ ] **Step 13: Update `packages/auth/src/index.ts` to enforce password min length server-side**

Replace the current `emailAndPassword` block to include `minPasswordLength`:

```typescript
import { MIN_PASSWORD_LENGTH } from "@project/config";
import { db } from "@project/db";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";

export const auth = betterAuth({
  database: prismaAdapter(db, {
    provider: "postgresql",
  }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: MIN_PASSWORD_LENGTH,
  },
  trustedOrigins: [process.env.CORS_ORIGIN ?? "http://localhost:3000"],
});

export type Session = typeof auth.$Infer.Session;
```

Note: the `trustedOrigins` fallback is left unchanged here — it's Task 4's B1 fix. Keep scope tight per task.

- [ ] **Step 14: Run lint and typecheck**

Run: `make lint`

Expected: PASS. All new imports resolve, `MIN_PASSWORD_LENGTH` and `MAX_UPLOAD_BYTES` are recognized types.

- [ ] **Step 15: Run unit tests**

Run: `make test-unit`

Expected: PASS. Existing tests are unaffected by the constant extraction.

- [ ] **Step 16: Run E2E tests**

Run: `make test`

Expected: PASS. Auth scenarios still sign up with `testpassword123` (>= 8 chars), todo import still works for valid files.

- [ ] **Step 17: Manual smoke test — password min length on server**

Start dev env (`make dev`), then try signing up via the UI with a 7-char password. The `<input minLength>` blocks submission client-side. To prove server enforcement:

```bash
curl -X POST http://localhost:3001/api/auth/sign-up/email \
  -H "Content-Type: application/json" \
  -d '{"email": "shorttest@example.com", "password": "1234567", "name": "Test"}'
```

Expected: HTTP 400 with a Better-Auth error indicating password is too short. Before this task, the server would have accepted it silently.

- [ ] **Step 18: Manual smoke test — client-side file size pre-flight**

With dev env running and signed in, navigate to a todo list page. Attempt to import a file > 10 MB (create one with `dd if=/dev/zero of=/tmp/big.csv bs=1M count=11`).

Expected: A toast appears **immediately** ("File too large (max 10 MB)") without a network request. Check the browser network tab: no POST to `/api/todos/import`.

- [ ] **Step 19: Commit**

```bash
git add packages/config apps/server/package.json apps/server/src/index.ts apps/web/package.json apps/web/src/features/todo/use-todos.ts apps/web/src/routes/login.tsx packages/auth/package.json packages/auth/src/index.ts pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
refactor(config): extract domain limits to @project/config

Adds @project/config package for static compile-time constants. Moves
MAX_UPLOAD_BYTES and MIN_PASSWORD_LENGTH into a single declaration,
wires both client and server to use them. Side effects:

- Client pre-flights file size before upload (instant feedback, no 413).
- Server enforces password min length via Better-Auth config (was
  client-only before).

Part of SSOT audit (bucket D). See docs/superpowers/specs/2026-04-18-config-ssot-audit-design.md.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: A + B + E2 — Infra Config + Env Boundary + CI Env Vars

**Goal:** Consolidate every infrastructure config value (dev/test ports, DB name, DB creds, tRPC/auth mount paths) into `@project/config`. Split `@project/env` into `/server` and `/client` subpaths with no barrel. Delete every `process.env.X` read outside the env package. Make `docker-compose.yml`, CI, Makefile, and `playwright.config.ts` all derive from the single source via `scripts/export-config.ts`.

**This is the largest task — split into 11 steps with multiple commits allowed as the work proceeds.** Final commit rolls up the whole bucket at the end, but feel free to create interim `wip:` commits if an LLM agent needs checkpoints.

**Files:**
- Create: `packages/config/src/ports.ts`
- Create: `packages/config/src/db.ts`
- Create: `packages/config/src/api-paths.ts`
- Create: `packages/env/src/client.ts`
- Create: `scripts/export-config.ts`
- Create: `scripts/generate-env-example.ts`
- Modify: `packages/config/src/index.ts` (re-export new files)
- Modify: `packages/config/package.json` (exports map)
- Modify: `packages/env/package.json` (exports map — no barrel)
- Modify: `packages/env/src/server.ts` (add PORT, LOG_LEVEL; import defaults from config)
- Modify: `packages/env/src/index.ts` (delete — barrel removal; OR convert to error-thrower, see step)
- Modify: `packages/auth/src/index.ts` (B1 — use `env.CORS_ORIGIN`)
- Modify: `packages/db/src/index.ts` (B2 — use `env.NODE_ENV`)
- Modify: `packages/db/package.json` (add `@project/env` dep)
- Modify: `apps/server/src/index.ts` (B3 — use `env.PORT`; A6 — use `TRPC_MOUNT`, `AUTH_MOUNT`; update `@project/env` → `@project/env/server`)
- Modify: `apps/server/src/logger.ts` (B4 — use `env.NODE_ENV`, `env.LOG_LEVEL`)
- Modify: `docker-compose.yml` (A1, A2 — parametrize)
- Modify: `docker-compose.test.yml` (A5 — parametrize DB name)
- Modify: `scripts/test-db.ts` (A5 — use `TEST_DB_NAME` from config)
- Modify: `e2e/test-env.ts` (pass through `TEST_DB_NAME`)
- Modify: `Makefile` (A3, A4 — source `export-config.ts` for ports; setup, dev, test, test-ui targets)
- Modify: `e2e/playwright.config.ts` (A4, E2 — import from config)
- Modify: `.github/workflows/ci.yml` (A4, E2 — source `export-config.ts`)
- Modify: `.env.example` (regenerated)
- Modify: `packages/db/.env.example` (regenerated)
- Modify: `apps/web/CLAUDE.md` (document `@project/env/client` rule)
- Modify: `apps/web/package.json` (add `@project/env` dep — web now imports `@project/env/client`)
- Modify: `apps/web/src/router.tsx:33` (use `env.VITE_API_URL` from `@project/env/client`)
- Modify: `apps/web/src/features/auth/auth-client.ts:4` (use `env.VITE_API_URL` from `@project/env/client`)
- Modify: `apps/web/src/features/todo/use-todos.ts:17` (use `env.VITE_API_URL` from `@project/env/client`)

Note: the three web call sites will be further refactored in Task 5 (the `apiClient` wrapper). Task 4 only updates them to read from `env.VITE_API_URL` via the new client subpath; Task 5 funnels them through `apiClient`.

### 4.1 — Extend `@project/config` with ports, db, api-paths

- [ ] **Step 1: Create `packages/config/src/ports.ts`**

```typescript
// Port numbers for dev and test environments. Dev values are stable
// (hardcoded on purpose so bookmarks, OAuth callbacks, and browser
// storage scopes don't break between worktrees). Test values are also
// stable but separate from dev so both can run simultaneously.
//
// The TEST DB port is hash-derived per worktree — that lives in
// scripts/test-db.ts, not here. This file covers app-level ports only.

export const DEV_DB_PORT = 5432;
export const DEV_WEB_PORT = 3000;
export const DEV_API_PORT = 3001;

export const TEST_WEB_PORT = 3100;
export const TEST_API_PORT = 3101;
```

- [ ] **Step 2: Create `packages/config/src/db.ts`**

```typescript
// DEV-ONLY database defaults. Production credentials come from env
// (DATABASE_URL) and are never duplicated here. Do not put prod
// secrets in this file.
//
// These values are consumed by:
// - docker-compose.yml (via scripts/export-config.ts)
// - scripts/generate-env-example.ts (builds .env.example)

export const DEV_DB_NAME = "agentic_web_stack";
export const DEV_DB_USER = "postgres";
export const DEV_DB_PASSWORD = "postgres";

// Test DB name — referenced by docker-compose.test.yml via
// scripts/test-db.ts (which already owns test-suite port derivation).
export const TEST_DB_NAME = "agentic_web_stack_test";
```

- [ ] **Step 3: Create `packages/config/src/api-paths.ts`**

```typescript
// Hono mount paths. Both server and client must agree:
// - Server registers handlers at these paths (apps/server/src/index.ts)
// - Client builds base URLs using these paths (apps/web/src/shared/api-client.ts — added in Task 5)

export const TRPC_MOUNT = "/trpc";
export const AUTH_MOUNT = "/api/auth";
```

- [ ] **Step 4: Update `packages/config/src/index.ts` to re-export new files**

```typescript
export * from "./api-paths.js";
export * from "./db.js";
export * from "./limits.js";
export * from "./ports.js";
```

- [ ] **Step 5: Update `packages/config/package.json` with subpath exports**

```json
{
  "name": "@project/config",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "default": "./src/index.ts"
    },
    "./api-paths": {
      "default": "./src/api-paths.ts"
    },
    "./db": {
      "default": "./src/db.ts"
    },
    "./limits": {
      "default": "./src/limits.ts"
    },
    "./ports": {
      "default": "./src/ports.ts"
    }
  },
  "devDependencies": {
    "@types/node": "catalog:"
  }
}
```

### 4.2 — Split `@project/env` into `/server` and `/client` (no barrel)

- [ ] **Step 6: Create `packages/env/src/client.ts`**

```typescript
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

// Client-side env vars. Only vars prefixed with VITE_ are safe to
// ship to the browser. `@t3-oss/env-core` validates at module load;
// if a required VITE_* is missing at build time, the app fails to
// start rather than silently shipping `undefined` to the client.
//
// Never add server-only secrets (DATABASE_URL, BETTER_AUTH_SECRET)
// to this file. Those belong in server.ts.

export const env = createEnv({
  clientPrefix: "VITE_",
  client: {
    VITE_API_URL: z.string().url(),
  },
  // Vite replaces import.meta.env.* at build time. For SSR/node
  // consumers, process.env is also available — the spread covers
  // both paths without forcing a conditional.
  runtimeEnv: {
    VITE_API_URL:
      typeof import.meta !== "undefined" && import.meta.env
        ? import.meta.env.VITE_API_URL
        : process.env.VITE_API_URL,
  },
  emptyStringAsUndefined: true,
});
```

- [ ] **Step 7: Update `packages/env/src/server.ts` with `PORT`, `LOG_LEVEL`, and config-imported defaults**

```typescript
import { DEV_API_PORT } from "@project/config/ports";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    DATABASE_URL: z.string().url(),
    CORS_ORIGIN: z.string().url().default("http://localhost:3000"),
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.string().url().default("http://localhost:3001"),
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),
    PORT: z.coerce.number().default(DEV_API_PORT),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).optional(),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
```

Why `LOG_LEVEL` is `.optional()`: the logger chooses `info` or `debug` as the default based on `NODE_ENV`. Setting an `.optional()` string lets the logger do `env.LOG_LEVEL ?? (isProduction ? "info" : "debug")` — the same behavior as before, just without reading `process.env` directly.

Why we keep `CORS_ORIGIN` / `BETTER_AUTH_URL` as `localhost:*` defaults rather than importing from `@project/config/ports`: the *values* they default to happen to equal `http://localhost:${DEV_WEB_PORT}` / `http://localhost:${DEV_API_PORT}`, but the *purpose* is different (URL allow-list vs. HTTP port). Keeping them as Zod defaults here means `scripts/export-config.ts` doesn't need to know about them — they auto-resolve from the env schema. If we ever need port drift between the server's listen port and the URL it announces itself as, the defaults are independent. Low-cost duplication, justifiable.

- [ ] **Step 8: Update `packages/env/src/index.ts` — remove barrel**

The barrel currently at `packages/env/src/index.ts` was `export { env } from "./server.js";`. Replace the entire file contents so importing from the top-level fails loudly:

```typescript
// Intentionally empty. @project/env has two entry points:
// - @project/env/server  (server-only env: DATABASE_URL, BETTER_AUTH_SECRET, ...)
// - @project/env/client  (client-safe env: VITE_API_URL)
//
// Do NOT add a barrel export here. The split-brain design prevents
// server-only env vars from leaking into the client bundle. Importing
// from "@project/env" (the barrel) without a subpath is a lint error.
//
// See docs/superpowers/specs/2026-04-18-config-ssot-audit-design.md
// and root CLAUDE.md "Single source of truth (SSOT)" rule.
export {};
```

- [ ] **Step 9: Update `packages/env/package.json` exports — remove `"."` entry**

```json
{
  "name": "@project/env",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    "./server": {
      "default": "./src/server.ts"
    },
    "./client": {
      "default": "./src/client.ts"
    }
  },
  "dependencies": {
    "@project/config": "workspace:*",
    "@t3-oss/env-core": "catalog:",
    "zod": "catalog:"
  },
  "devDependencies": {
    "@types/node": "catalog:"
  }
}
```

Added `@project/config` as a workspace dep (needed for the `DEV_API_PORT` import in `server.ts`). Removed `"."` from exports map — any import `from "@project/env"` without a subpath now errors at module resolution time.

### 4.3 — Update all consumers to use the new env subpaths

- [ ] **Step 10: Update `packages/auth/src/index.ts` — B1 fix + new env subpath**

Full replacement (builds on Task 3's edit):

```typescript
import { MIN_PASSWORD_LENGTH } from "@project/config";
import { db } from "@project/db";
import { env } from "@project/env/server";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";

export const auth = betterAuth({
  database: prismaAdapter(db, {
    provider: "postgresql",
  }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: MIN_PASSWORD_LENGTH,
  },
  trustedOrigins: [env.CORS_ORIGIN],
});

export type Session = typeof auth.$Infer.Session;
```

The `process.env.CORS_ORIGIN ?? ...` fallback is gone. `env.CORS_ORIGIN` is validated at startup by the Zod schema with the default `"http://localhost:3000"` baked in.

- [ ] **Step 11: Update `packages/db/package.json` — add `@project/env` dep**

```json
{
  "name": "@project/db",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "default": "./src/index.ts"
    }
  },
  "scripts": {
    "generate": "prisma generate",
    "push": "prisma db push",
    "studio": "prisma studio",
    "migrate": "prisma migrate dev",
    "postinstall": "prisma generate"
  },
  "dependencies": {
    "@prisma/client": "catalog:",
    "@project/env": "workspace:*"
  },
  "devDependencies": {
    "@types/node": "catalog:",
    "prisma": "catalog:",
    "tsx": "^4.21.0"
  }
}
```

- [ ] **Step 12: Update `packages/db/src/index.ts` — B2 fix**

```typescript
import { env } from "@project/env/server";
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const db = globalForPrisma.prisma ?? new PrismaClient();

if (env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}

// Re-export all generated types (enums, input types, Prisma namespace, PrismaClient, etc.)
// so consumers can `import { Prisma, MyEnum } from "@project/db"` without reaching into @prisma/client
export * from "@prisma/client";
```

- [ ] **Step 13: Update `apps/server/src/index.ts` — B3, A6 fixes + new env subpath**

Find the existing imports at the top:

```typescript
import { env } from "@project/env";
```

Replace with:

```typescript
import { AUTH_MOUNT, TRPC_MOUNT } from "@project/config";
import { env } from "@project/env/server";
```

Find the mount lines:

Line ~85:
```typescript
app.on(["POST", "GET"], "/api/auth/**", (c) => {
```

Replace with:
```typescript
app.on(["POST", "GET"], `${AUTH_MOUNT}/**`, (c) => {
```

Line ~148-149:
```typescript
app.use(
  "/trpc/*",
  trpcServer({
```

Replace with:
```typescript
app.use(
  `${TRPC_MOUNT}/*`,
  trpcServer({
```

Line 161 — the server listen call. Replace:

```typescript
serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 3001) }, (info) => {
  logger.info(`Server running at http://localhost:${info.port}`);
});
```

With:

```typescript
serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  logger.info(`Server running at http://localhost:${info.port}`);
});
```

- [ ] **Step 14: Update `apps/server/src/logger.ts` — B4 fix**

Full replacement:

```typescript
import { env } from "@project/env/server";
import pino from "pino";

const isProduction = env.NODE_ENV === "production";

export const logger = pino({
  level: env.LOG_LEVEL ?? (isProduction ? "info" : "debug"),
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
          },
        },
      }),
});
```

- [ ] **Step 15: Add `@project/env` dep to `apps/web/package.json`**

Insert `"@project/env": "workspace:*",` alphabetically in the `dependencies` block:

```json
  "dependencies": {
    "@dnd-kit/core": "^6.3.1",
    "@dnd-kit/sortable": "^10.0.0",
    "@dnd-kit/utilities": "^3.2.2",
    "@project/api": "workspace:*",
    "@project/config": "workspace:*",
    "@project/env": "workspace:*",
    "@project/ui": "workspace:*",
    ...
  }
```

- [ ] **Step 16: Update `apps/web/src/router.tsx` to use `@project/env/client`**

Find the block at line 33:

```typescript
const trpcClient = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: `${import.meta.env.VITE_API_URL ?? "http://localhost:3001"}/trpc`,
      fetch(url, options) {
        return fetch(url, { ...options, credentials: "include" });
      },
    }),
  ],
});
```

Replace with (also add the import at the top):

```typescript
// (add to imports at top)
import { TRPC_MOUNT } from "@project/config";
import { env } from "@project/env/client";

// ...

const trpcClient = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: `${env.VITE_API_URL}${TRPC_MOUNT}`,
      fetch(url, options) {
        return fetch(url, { ...options, credentials: "include" });
      },
    }),
  ],
});
```

Note: Task 5 will further refactor this to use `apiClient`. For now, the direct `env.VITE_API_URL` read via the validated client env satisfies B's boundary requirement and Task 5's dependency.

- [ ] **Step 17: Update `apps/web/src/features/auth/auth-client.ts` to use `@project/env/client`**

Full replacement:

```typescript
import { env } from "@project/env/client";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  baseURL: env.VITE_API_URL,
});

export const { signIn, signUp, signOut, useSession } = authClient;
```

Note: `AUTH_MOUNT` is NOT imported here — Better-Auth assumes `/api/auth` as its internal convention and appends its own routes to `baseURL`. The `/api/auth` path is a constraint enforced by Better-Auth's internals, not controlled by our config. The SSOT for the mount path lives in `@project/config/api-paths.ts` for the *server side* only (Hono registration); the client-side path is Better-Auth's hidden constant. This two-place constraint is called out in the follow-ups section at the bottom of this plan — fixing it requires a Better-Auth `basePath` override, out of scope here.

- [ ] **Step 18: Update `apps/web/src/features/todo/use-todos.ts` to use `@project/env/client`**

At the top, change the line:

```typescript
const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";
```

To (also add the import at the top with the other `@project/*` imports):

```typescript
import { env } from "@project/env/client";

// ... then near the API_URL usage, replace the const declaration:
const API_URL = env.VITE_API_URL;
```

Or more idiomatically — delete the `API_URL` constant entirely and inline `env.VITE_API_URL` at the two fetch sites (lines 129 and 148). Task 5 will replace these fetches with `apiClient`, so the simpler version is fine here:

```typescript
const API_URL = env.VITE_API_URL;
```

Keep `MAX_UPLOAD_BYTES` import from Task 3 unchanged.

- [ ] **Step 19: Run lint and typecheck (sanity check after env boundary edits)**

Run: `make lint`

Expected: PASS. All `@project/env/server` and `@project/env/client` imports resolve. `env.PORT`, `env.LOG_LEVEL`, `env.NODE_ENV` are typed correctly.

If lint fails due to biome not knowing about new imports, it's a transient issue — the next step (install) resolves workspace wiring. But the test below should catch any real errors.

- [ ] **Step 20: Run install to link new workspace deps**

Run: `pnpm install`

Expected: pnpm re-resolves the graph with the new `@project/env` → `@project/config` dep and `packages/db` → `@project/env` dep. No errors.

### 4.4 — Add scripts for config export and env-example generation

- [ ] **Step 20b: Add `@project/config` as a devDep of root `package.json`**

The root `package.json` currently lists `@project/auth` and `@project/db` as devDeps (consumed by `scripts/seed.ts`). `scripts/export-config.ts` and `scripts/generate-env-example.ts` (created in next steps) both import from `@project/config`, so root needs it declared too. Update the `devDependencies` block:

```json
  "devDependencies": {
    "@biomejs/biome": "^1.9.0",
    "@project/auth": "workspace:*",
    "@project/config": "workspace:*",
    "@project/db": "workspace:*",
    "@tanstack/router-generator": "^1.166.29",
    "tsx": "^4.21.0",
    "typescript": "catalog:"
  },
```

Run `pnpm install` after editing.

- [ ] **Step 21: Create `scripts/export-config.ts`**

```typescript
// Emits @project/config values as shell exports. Consumers:
// - Makefile (dev, setup, test, test-ui targets) — sources the
//   output to set env vars before `docker compose up` and
//   `scripts/kill-ports.ts` invocations.
// - GitHub Actions CI (.github/workflows/ci.yml) — pipes output
//   into $GITHUB_ENV so workflow steps see the values.
//
// Deliberately simple: no args, prints all relevant values. If this
// grows (e.g., per-environment selection), split into
// scripts/export-dev-config.ts and scripts/export-test-config.ts.

import {
  DEV_API_PORT,
  DEV_DB_NAME,
  DEV_DB_PASSWORD,
  DEV_DB_PORT,
  DEV_DB_USER,
  DEV_WEB_PORT,
  TEST_API_PORT,
  TEST_DB_NAME,
  TEST_WEB_PORT,
} from "@project/config";

const exports: Record<string, string | number> = {
  DEV_DB_PORT,
  DEV_DB_NAME,
  DEV_DB_USER,
  DEV_DB_PASSWORD,
  DEV_WEB_PORT,
  DEV_API_PORT,
  TEST_WEB_PORT,
  TEST_API_PORT,
  TEST_DB_NAME,
  // URLs derived from ports so CI + playwright + Makefile can
  // consume them as a single value without re-concatenating.
  TEST_CORS_ORIGIN: `http://localhost:${TEST_WEB_PORT}`,
  TEST_BETTER_AUTH_URL: `http://localhost:${TEST_API_PORT}`,
};

for (const [key, value] of Object.entries(exports)) {
  console.log(`${key}=${value}`);
}
```

Root `package.json` doesn't yet list `@project/config` as a dep of the root, but the script runs via `pnpm exec tsx` which resolves workspace packages from the whole monorepo. Verify in step 26.

- [ ] **Step 22: Create `scripts/generate-env-example.ts`**

```typescript
// Regenerates .env.example files from @project/config. Run manually
// when dev DB creds/port change in @project/config — the files are
// committed, but only as user-facing examples.

import { writeFileSync } from "node:fs";
import path from "node:path";
import {
  DEV_API_PORT,
  DEV_DB_NAME,
  DEV_DB_PASSWORD,
  DEV_DB_PORT,
  DEV_DB_USER,
} from "@project/config";

const PROJECT_ROOT = path.resolve(import.meta.dirname, "..");

const databaseUrl = `postgresql://${DEV_DB_USER}:${DEV_DB_PASSWORD}@localhost:${DEV_DB_PORT}/${DEV_DB_NAME}`;
const betterAuthUrl = `http://localhost:${DEV_API_PORT}`;

const rootEnv = `DATABASE_URL="${databaseUrl}"
BETTER_AUTH_SECRET="change-me-to-a-random-32-char-secret-key"
BETTER_AUTH_URL="${betterAuthUrl}"
`;

const dbEnv = `DATABASE_URL="${databaseUrl}"
`;

writeFileSync(path.join(PROJECT_ROOT, ".env.example"), rootEnv);
writeFileSync(path.join(PROJECT_ROOT, "packages/db/.env.example"), dbEnv);

console.log("Regenerated .env.example files from @project/config.");
```

- [ ] **Step 23: Run the env-example generator**

Run: `pnpm exec tsx scripts/generate-env-example.ts`

Expected: `.env.example` and `packages/db/.env.example` rewritten. The contents should match the current files exactly (the config values match the existing literals), so `git diff` shows no change. If `git diff` shows changes, verify the config values match the prior literals — a mismatch is a bug in the config file.

### 4.5 — Update docker-compose.yml, docker-compose.test.yml, test-db.ts

- [ ] **Step 24: Update `docker-compose.yml` to parametrize dev DB**

Replace the file contents:

```yaml
name: agentic-web-stack

services:
  postgres:
    image: postgres:17
    container_name: agentic-postgres
    environment:
      POSTGRES_DB: ${DEV_DB_NAME}
      POSTGRES_USER: ${DEV_DB_USER}
      POSTGRES_PASSWORD: ${DEV_DB_PASSWORD}
    ports:
      - "${DEV_DB_PORT}:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${DEV_DB_USER}"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped

volumes:
  postgres_data:
```

The port binding is `"${DEV_DB_PORT}:5432"` — host side from config, container side is Postgres's internal `5432` (never changes).

- [ ] **Step 25: Update `docker-compose.test.yml` to parametrize test DB name**

Replace:

```yaml
      POSTGRES_DB: agentic_web_stack_test
```

With:

```yaml
      POSTGRES_DB: ${TEST_DB_NAME}
```

Full file:

```yaml
name: agentic-web-stack-test

services:
  postgres:
    image: postgres:17
    # TEST_CONTAINER, TEST_PORT, TEST_DB_NAME are supplied by
    # scripts/test-db.ts — not optional. Do not add `:-default`
    # fallbacks: they would mask missing env with silent collisions.
    # Compose will fail loudly if any is unset, which is the correct
    # behavior.
    container_name: ${TEST_CONTAINER}
    environment:
      POSTGRES_DB: ${TEST_DB_NAME}
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    ports:
      - "${TEST_PORT}:5432"
    tmpfs:
      - /var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 1s
      timeout: 1s
      retries: 15
```

Note: POSTGRES_USER/PASSWORD in the test compose stay hardcoded `postgres` — these are test-container-internal creds, never crossed with dev. Keeping them literal here avoids adding more env propagation to `scripts/test-db.ts` for no benefit.

- [ ] **Step 26: Update `scripts/test-db.ts` to use `TEST_DB_NAME`**

Replace the `testDbEnv` function:

```typescript
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { TEST_DB_NAME } from "@project/config";

export type TestSuite = "e2e" | "unit";

export const PROJECT_ROOT = path.resolve(import.meta.dirname, "..");

export function testDbEnv(suite: TestSuite) {
  const hash = createHash("md5").update(PROJECT_ROOT).digest("hex");
  const hash8 = hash.slice(0, 8);
  // 100-slot modulo → birthday-paradox collision between worktrees becomes
  // likely past ~12 checkouts of this repo on one host. Container names
  // (hash8) don't collide, but the host port bind will — docker fails loudly
  // with "port already allocated", which is acceptable and rare in practice.
  const portOffset = Number.parseInt(hash.slice(0, 4), 16) % 100;
  const portBase = suite === "e2e" ? 5400 : 5500;
  const port = portBase + portOffset;
  const container = `agentic-postgres-${suite}-${hash8}`;
  return {
    TEST_PORT: port,
    TEST_CONTAINER: container,
    TEST_DB_NAME,
    TEST_DATABASE_URL: `postgresql://postgres:postgres@localhost:${port}/${TEST_DB_NAME}`,
    PROJECT_ROOT,
  };
}
```

Then update `setupTestDatabase` to pass `TEST_DB_NAME` in the compose env:

```typescript
export function setupTestDatabase(suite: TestSuite): void {
  assertDockerRunning();
  const { TEST_PORT, TEST_CONTAINER, TEST_DB_NAME, TEST_DATABASE_URL } = testDbEnv(suite);
  const composeEnv = {
    ...process.env,
    TEST_PORT: String(TEST_PORT),
    TEST_CONTAINER,
    TEST_DB_NAME,
  };
  const prismaCwd = path.join(PROJECT_ROOT, "packages/db");
  const pushEnv = {
    ...process.env,
    DATABASE_URL: TEST_DATABASE_URL,
    PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION: "yes",
  };

  if (isContainerHealthy(TEST_CONTAINER)) {
    try {
      execSync("pnpm exec prisma db push --force-reset --skip-generate", {
        cwd: prismaCwd,
        stdio: "inherit",
        env: pushEnv,
      });
      return;
    } catch {
      // Container died between health check and push (e.g. laptop sleep).
      // Fall through to cold boot — the next run auto-recovers.
    }
  }

  const composeProject = `agentic-web-stack-${suite}`;
  const composeBase = `docker compose -p ${composeProject} -f docker-compose.test.yml`;
  execSync(`${composeBase} down -v || true`, {
    cwd: PROJECT_ROOT,
    stdio: "inherit",
    env: composeEnv,
  });
  execSync(`${composeBase} up -d --wait`, {
    cwd: PROJECT_ROOT,
    stdio: "inherit",
    env: composeEnv,
  });
  execSync("pnpm exec prisma db push --skip-generate", {
    cwd: prismaCwd,
    stdio: "inherit",
    env: pushEnv,
  });
}
```

The `isContainerHealthy` and `assertDockerRunning` functions remain unchanged.

- [ ] **Step 27: Update `e2e/test-env.ts` to re-export `TEST_DB_NAME`**

```typescript
import { testDbEnv } from "../scripts/test-db.ts";

const env = testDbEnv("e2e");
export const TEST_PORT = env.TEST_PORT;
export const TEST_CONTAINER = env.TEST_CONTAINER;
export const TEST_DB_NAME = env.TEST_DB_NAME;
export const TEST_DATABASE_URL = env.TEST_DATABASE_URL;
export const PROJECT_ROOT = env.PROJECT_ROOT;
```

### 4.6 — Update Makefile to source config

- [ ] **Step 28: Update `Makefile` to source `export-config.ts` for dev/test targets**

Replace the Makefile:

```makefile
.PHONY: setup dev db db-push db-generate db-studio db-seed check lint fix test test-ui test-unit clean routes

# `config` is a sourceable shell fragment produced by scripts/export-config.ts.
# Every target that needs a port or dev DB cred value sources it, so the
# single source of truth is @project/config (via the script). Re-evaluated
# per target rather than cached in a file to avoid stale state when config
# changes between runs.
CONFIG_SH := $$(pnpm exec tsx scripts/export-config.ts)

# Zero-conf setup: clone → make setup → make dev
setup:
	cp -n .env.example .env 2>/dev/null || true
	cp -n packages/db/.env.example packages/db/.env 2>/dev/null || true
	pnpm install
	export $(CONFIG_SH) && docker compose up -d
	@echo "Waiting for Postgres..."
	@until docker compose exec -T postgres pg_isready -U postgres > /dev/null 2>&1; do sleep 1; done
	pnpm -w run db:push
	$(MAKE) routes
	prek install
	@echo "✓ Ready. Run 'make dev' to start."

# Regenerate route tree (no dev server needed)
routes:
	@echo "Generating route tree..."
	@pnpm exec tsx scripts/generate-routes.ts

# Start both web and server
# Depends on db-generate so edits to schema.prisma propagate to types without
# a manual `make db-push`. `prisma generate` is ~100ms and idempotent.
dev: db-generate
	@export $(CONFIG_SH) && pnpm exec tsx scripts/kill-ports.ts $$DEV_WEB_PORT $$DEV_API_PORT
	export $(CONFIG_SH) && pnpm -w run dev

# Database
db:
	export $(CONFIG_SH) && docker compose up -d
db-push:
	pnpm -w run db:push
db-generate:
	pnpm -w run db:generate
db-studio:
	pnpm -w run db:studio
db-seed:
	pnpm -w run db:seed

# Quality gates
# lint/fix depend on db-generate: `tsc -b` type-checks @project/db which imports
# the generated Prisma client. Edit schema → `make lint` without fresh client =
# stale type errors. Same rationale as dev/test targets below.
check: lint
lint: db-generate
	@agent-harness lint
	pnpm -w run typecheck
fix: db-generate
	@agent-harness fix
	pnpm -w run typecheck

# Unit / integration tests (vitest, uses isolated unit-suite Postgres, dynamic port per worktree — see scripts/test-db.ts)
test-unit: db-generate
	pnpm --filter @project/api test

# BDD Tests (uses separate test database, dynamic port per suite — see scripts/test-db.ts)
test: db-generate
	@export $(CONFIG_SH) && pnpm exec tsx scripts/kill-ports.ts $$TEST_WEB_PORT $$TEST_API_PORT
	cd e2e && pnpm exec bddgen && pnpm exec playwright test
test-ui: db-generate
	@export $(CONFIG_SH) && pnpm exec tsx scripts/kill-ports.ts $$TEST_WEB_PORT $$TEST_API_PORT
	cd e2e && pnpm exec bddgen && pnpm exec playwright test --ui

# Cleanup
clean:
	docker compose down -v
	@ids=$$(docker ps -aq --filter "name=agentic-postgres-test-" --filter "name=agentic-postgres-e2e-" --filter "name=agentic-postgres-unit-"); \
	  [ -n "$$ids" ] && docker rm -f $$ids || true
	rm -rf node_modules apps/*/node_modules packages/*/node_modules
	rm -rf apps/web/.output apps/web/dist apps/server/dist
```

Why `export $(CONFIG_SH) && ...` per-target rather than setting Makefile-level vars: Makefiles can't easily ingest stdout as shell vars. The `export $$(...)` pattern expands per-recipe, runs as one shell invocation, and keeps each target self-contained. The `$(CONFIG_SH) := $$(...)` declaration defers execution — `tsx` only runs when a target that uses it fires.

### 4.7 — Update playwright.config.ts and CI

- [ ] **Step 29: Update `e2e/playwright.config.ts` to import from `@project/config`**

Replace the full file:

```typescript
import {
  TEST_API_PORT,
  TEST_WEB_PORT,
} from "@project/config";
import { defineConfig } from "@playwright/test";
import { defineBddConfig } from "playwright-bdd";

import { TEST_DATABASE_URL } from "./test-env.js";

// Desktop runs all features except @mobile-tagged ones
const desktopTestDir = defineBddConfig({
  features: "features/**/*.feature",
  steps: "steps/**/*.ts",
  outputDir: ".features-gen/desktop",
  tags: "not @mobile",
});

// Mobile runs all features (including @mobile-specific ones)
const mobileTestDir = defineBddConfig({
  features: "features/**/*.feature",
  steps: "steps/**/*.ts",
  outputDir: ".features-gen/mobile",
});

const WEB_URL = `http://localhost:${TEST_WEB_PORT}`;
const API_URL = `http://localhost:${TEST_API_PORT}`;

export default defineConfig({
  globalSetup: "./global-setup.ts",
  timeout: 30_000,
  retries: 0,
  fullyParallel: true,
  use: {
    baseURL: WEB_URL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "desktop",
      testDir: desktopTestDir,
      use: { browserName: "chromium" },
    },
    {
      name: "mobile-setup",
      testMatch: /db-reset\.setup\.ts/,
      dependencies: ["desktop"],
    },
    {
      name: "mobile",
      testDir: mobileTestDir,
      use: {
        browserName: "chromium",
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
      dependencies: ["mobile-setup"],
    },
  ],
  webServer: [
    {
      command: "pnpm --filter @project/server dev",
      port: TEST_API_PORT,
      reuseExistingServer: !process.env.CI,
      env: {
        PORT: String(TEST_API_PORT),
        DATABASE_URL: TEST_DATABASE_URL,
        BETTER_AUTH_SECRET: "test-secret-key-for-e2e-tests-only-32chars",
        BETTER_AUTH_URL: API_URL,
        CORS_ORIGIN: WEB_URL,
      },
    },
    {
      command: `pnpm --filter @project/web exec vite dev --port ${TEST_WEB_PORT}`,
      port: TEST_WEB_PORT,
      reuseExistingServer: !process.env.CI,
      env: {
        VITE_API_URL: API_URL,
      },
    },
  ],
});
```

Add `@project/config` to `e2e/package.json` as a workspace dep:

```json
{
  "name": "@project/e2e",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "playwright test",
    "test:ui": "playwright test --ui",
    "generate": "bddgen"
  },
  "dependencies": {
    "@project/config": "workspace:*"
  },
  "devDependencies": {
    "@playwright/test": "^1.52.0",
    "playwright-bdd": "^8.0.0"
  }
}
```

- [ ] **Step 30: Update `.github/workflows/ci.yml` — source `export-config.ts` via `$GITHUB_ENV`**

Replace the `env:` block and add a prep step:

```yaml
name: CI

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  check:
    name: Lint & Typecheck
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm -w run lint
      - run: pnpm -w run typecheck

  test:
    name: Integration & BDD Tests
    runs-on: ubuntu-latest
    needs: check
    # No Postgres service container: both test suites provision their own
    # per-suite containers via scripts/test-db.ts (setupTestDatabase). The
    # ubuntu-latest runner has Docker + Compose available out of the box.
    env:
      BETTER_AUTH_SECRET: test-secret-key-for-ci-tests-only-32chars
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      # Promote @project/config values to workflow env so downstream steps
      # see TEST_CORS_ORIGIN, TEST_BETTER_AUTH_URL, etc. without hardcoding.
      - name: Export config to GITHUB_ENV
        run: pnpm exec tsx scripts/export-config.ts >> "$GITHUB_ENV"
      - run: pnpm --filter @project/api test
        env:
          CORS_ORIGIN: ${{ env.TEST_CORS_ORIGIN }}
          BETTER_AUTH_URL: ${{ env.TEST_BETTER_AUTH_URL }}
      - run: pnpm exec playwright install chromium --with-deps
      - run: cd e2e && pnpm exec bddgen && pnpm exec playwright test
        env:
          CORS_ORIGIN: ${{ env.TEST_CORS_ORIGIN }}
          BETTER_AUTH_URL: ${{ env.TEST_BETTER_AUTH_URL }}
```

Why `CORS_ORIGIN` / `BETTER_AUTH_URL` moved from job-level `env:` to step-level `env:`: the `Export config to GITHUB_ENV` step populates workflow-level `env` vars only after it runs, so they can't be referenced in the `env:` block of the `test` job declaration (that's evaluated before any step runs). Per-step reference is fine and keeps the CI aligned with `scripts/export-config.ts` as the single source.

### 4.8 — Document the env boundary rule in apps/web/CLAUDE.md

- [ ] **Step 31: Add env-import rule to `apps/web/CLAUDE.md`**

Open `apps/web/CLAUDE.md`. Find the "Do Not" list at the bottom. Add a new bullet:

```markdown
- **Never import from `@project/env` without a subpath.** The env package exposes `/server` and `/client` only; there is no barrel. Web code imports from `@project/env/client` exclusively. A barrel import would transitively pull server-only vars (DATABASE_URL, BETTER_AUTH_SECRET) into the client bundle. Same class of bug as `import { appRouter }` — see root CLAUDE.md.
```

Insert it after the existing bullet:

```markdown
- Import `appRouter` value (only `import type { AppRouter }`)
```

(So the new bullet is grouped with other import-boundary rules.)

### 4.9 — Verification

- [ ] **Step 32: Install & refresh workspace**

Run: `pnpm install`

Expected: `@project/config` now a transitive dep of `packages/env`, `apps/web`, `apps/server`, `packages/auth`, `e2e`. No errors.

- [ ] **Step 33: Verify no `process.env` reads outside the boundary**

Run:
```bash
rg 'process\.env\.\w+(?!\s*=)' --type ts --type tsx \
  -g '!packages/env/**' -g '!scripts/**' \
  -g '!**/vite.config.ts' -g '!**/vitest.config.ts' -g '!**/test-setup.ts' \
  -g '!node_modules' -g '!**/*.gen.*'
```

Expected: zero matches. Every previous `process.env.X` read in `packages/auth/`, `packages/db/`, `apps/server/` now goes through `env.X` from `@project/env/server`.

Remaining legitimate `process.env` uses (allowed by whitelist): `packages/api/vitest.config.ts` (writes), `playwright.config.ts` (`process.env.CI` check, which is a read but CI is a GitHub-runner convention).

Note: `process.env.CI` in `playwright.config.ts:72` is a boundary violation by the strict rule. Option A: leave it (narrow exception for CI detection). Option B: add `CI` to `packages/env/src/server.ts`. Recommend **A** — `CI` is a runner-managed flag, not app config; adding it to the env schema would require every local test invocation to set `CI=false` or accept its absence. Add `-g '!**/playwright.config.ts'` to the whitelist grep.

Actually re-examining: our updated `playwright.config.ts` still has `reuseExistingServer: !process.env.CI`. Add this file to the whitelist. Update the command:

```bash
rg 'process\.env\.\w+(?!\s*=)' --type ts --type tsx \
  -g '!packages/env/**' -g '!scripts/**' \
  -g '!**/vite.config.ts' -g '!**/vitest.config.ts' -g '!**/test-setup.ts' \
  -g '!**/playwright.config.ts' \
  -g '!node_modules' -g '!**/*.gen.*'
```

Expected: zero matches.

- [ ] **Step 34: Verify env barrel does not exist**

Run:
```bash
cat packages/env/package.json | python -c 'import json,sys; print(json.load(sys.stdin).get("exports", {}).keys())'
```

Expected: `dict_keys(['./server', './client'])` — no `"."` entry.

Run:
```bash
rg 'from "@project/env"[^/]' --type ts --type tsx
```

Expected: zero matches. Every import specifies `/server` or `/client`.

- [ ] **Step 35: Verify ports appear only in config or consumers of config**

Run the tightened port grep from the spec's verification check #1:

```bash
rg '(:3000|:3001|:3100|:3101|:5432|"3000"|"3001"|"3100"|"3101"|"5432"|localhost:3000|localhost:3001|localhost:3100|localhost:3101|localhost:5432|PORT:\s*3|POSTGRES.*5432|"5432:5432")' \
  --type ts --type tsx --type json --type yaml --type md \
  -g '!node_modules' -g '!dist' -g '!.output' -g '!*.gen.*' -g '!pnpm-lock.yaml' -g '!docs/superpowers/plans/**' -g '!docs/superpowers/specs/**'
```

Expected matches (acceptable):
- `packages/config/src/ports.ts` — declarations
- `packages/config/src/db.ts` — declarations
- `docker-compose.yml` — uses `${DEV_DB_PORT}:5432` (the `5432` is container-internal, acceptable per spec A1)
- `docker-compose.test.yml` — uses `${TEST_PORT}:5432` (same rationale)
- `apps/web/package.json` — `"dev": "vite dev --port 3000"` — **violation**. Fix by referencing config via a prep script, or accept as a low-cost duplication since it's only used by the dev wrapper.
- `CLAUDE.md`, README prose — documentation of port numbers, acceptable (not load-bearing)

For the `apps/web/package.json` dev script: leave as-is. The Makefile's `dev` target (not `pnpm dev`) is the supported entry point per `make dev` / CLAUDE.md conventions; the raw `pnpm --filter @project/web dev` invocation matters only when a dev explicitly bypasses the Makefile. Changing it to read from config would require a script wrapper, not worth the indirection. Add a comment in `apps/web/package.json`? Not in JSON — but spec already notes dev ports are stable non-goals.

Zero unexpected violations. If grep finds a literal outside the above list, it's a regression — fix before commit.

- [ ] **Step 36: Generate env-example files and verify no drift**

Run: `pnpm exec tsx scripts/generate-env-example.ts`

Then:
```bash
git diff .env.example packages/db/.env.example
```

Expected: no diff (the config values match the existing literals exactly).

- [ ] **Step 36b: Add env-boundary lint check to `Makefile`**

Per spec B "Enforcement", add a permanent grep check so a future `process.env.X` read outside the boundary fails `make lint`. Update the `lint:` target:

```makefile
lint: db-generate
	@agent-harness lint
	pnpm -w run typecheck
	@! rg 'process\.env\.\w+(?!\s*=)' --type ts --type tsx \
	    -g '!packages/env/**' -g '!scripts/**' \
	    -g '!**/vite.config.ts' -g '!**/vitest.config.ts' -g '!**/test-setup.ts' \
	    -g '!**/playwright.config.ts' \
	    -g '!node_modules' -g '!**/*.gen.*' \
	  || (echo "FAIL: process.env.X read outside @project/env — use env from @project/env/server or /client" && exit 1)
```

How the idiom works: `!` inverts rg's exit code. rg returns 0 on matches found, 1 on no matches. `! rg ...` swaps: no matches → success (lint passes); matches → failure (lint fails with the error). POSIX-portable; works with `/bin/sh`.

- [ ] **Step 37: Run lint and typecheck**

Run: `make lint`

Expected: PASS. The new env-boundary grep check finds zero violations (verified in step 33). `agent-harness lint` and `tsc -b` also pass.

- [ ] **Step 38: Run unit tests**

Run: `make test-unit`

Expected: PASS. The test DB setup via `scripts/test-db.ts` still provisions containers with the new `TEST_DB_NAME` env propagation. Database comes up with the correct name.

- [ ] **Step 39: Run E2E tests**

Run: `make test`

Expected: PASS. Server boots on `TEST_API_PORT=3101`, web on `TEST_WEB_PORT=3100`. Auth, todos, imports all pass.

- [ ] **Step 40: Smoke test: change `DEV_API_PORT` and verify one-edit-only**

Edit `packages/config/src/ports.ts`:
```typescript
export const DEV_API_PORT = 3005;  // temporary — will revert
```

Run: `make dev`

Expected: Server boots on `3005`, web on `3000` connects correctly (tRPC + auth work). Confirm in the browser console that API calls go to `http://localhost:3005/trpc/...`.

Revert:
```typescript
export const DEV_API_PORT = 3001;
```

- [ ] **Step 41: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
refactor(config): infra SSOT — split @project/env, extend @project/config

Adds @project/config/ports.ts, db.ts, api-paths.ts. Splits @project/env
into /server and /client entry points with no barrel export. Every
process.env.X read outside packages/env/ now goes through the validated
boundary. docker-compose.yml, Makefile, playwright.config.ts, CI
workflow all source values from scripts/export-config.ts — changing a
port is now a one-file edit.

Also:
- Adds env-boundary grep check to make lint.
- Adds apps/web/CLAUDE.md rule forbidding barrel @project/env imports.
- Documents error-message SSOT as follow-up (not fixed here).

Part of SSOT audit (buckets A, B, E2). See docs/superpowers/specs/2026-04-18-config-ssot-audit-design.md.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: C — `apiClient` Wrapper

**Goal:** Eliminate the three independent `fetch(${env.VITE_API_URL}/...)` patterns in the web app by funneling every HTTP call through a single `apiClient` module. The tRPC and Better-Auth clients continue using their specialized entry points but read the base URL from the same source.

**Depends on Task 4** (needs `@project/env/client` and `@project/config/api-paths`).

**Files:**
- Create: `apps/web/src/shared/api-client.ts`
- Modify: `apps/web/src/router.tsx` (use `apiClient` base URL)
- Modify: `apps/web/src/features/auth/auth-client.ts` (use `apiClient` base URL)
- Modify: `apps/web/src/features/todo/use-todos.ts` (use `apiClient.fetch` instead of `fetch`)
- Modify: `apps/web/CLAUDE.md` (document the rule)

**Context:** After Task 4, all three files read `env.VITE_API_URL` from `@project/env/client`. This task centralizes the read into `apiClient` and changes the call sites to use `apiClient.fetch(path, init)` (which prepends the base URL and sets `credentials: "include"`).

tRPC and Better-Auth have specialized clients (`createTRPCClient`, `createAuthClient`) — they don't use `apiClient.fetch` directly. But they read the base URL from `apiClient.baseUrl` (or an exported constant), so there's one source.

- [ ] **Step 1: Create `apps/web/src/shared/api-client.ts`**

```typescript
import { env } from "@project/env/client";

// Single source of truth for the API base URL and all HTTP calls from
// the web app. Every fetch to the server MUST go through this module
// — direct `fetch(url, ...)` with a hardcoded or inlined URL is a
// lint error.
//
// This module imports env.VITE_API_URL from @project/env/client ONLY
// — never from @project/env/server. Any file under apps/web/ that
// imports from @project/env/server is a build-breaking mistake (see
// root CLAUDE.md: SSOT + split-brain env).

export const API_BASE_URL = env.VITE_API_URL;

// Thin fetch wrapper: prepends base URL, sets cookie-auth credentials,
// preserves caller-provided init options. Returns the raw Response —
// callers check res.ok and parse the body as needed.
export async function apiFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const url = path.startsWith("http") ? path : `${API_BASE_URL}${path}`;
  return fetch(url, {
    credentials: "include",
    ...init,
  });
}

// Namespaced export so call sites read `apiClient.fetch(...)` rather
// than `apiFetch(...)` — matches the "all HTTP via apiClient" mental
// model established in apps/web/CLAUDE.md.
export const apiClient = {
  baseUrl: API_BASE_URL,
  fetch: apiFetch,
};
```

- [ ] **Step 2: Update `apps/web/src/router.tsx` to use `apiClient.baseUrl`**

Find the tRPC client setup:

```typescript
import { TRPC_MOUNT } from "@project/config";
import { env } from "@project/env/client";

// ...

const trpcClient = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: `${env.VITE_API_URL}${TRPC_MOUNT}`,
      fetch(url, options) {
        return fetch(url, { ...options, credentials: "include" });
      },
    }),
  ],
});
```

Replace with:

```typescript
import { TRPC_MOUNT } from "@project/config";
import { apiClient } from "#/shared/api-client";

// ...

const trpcClient = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: `${apiClient.baseUrl}${TRPC_MOUNT}`,
      fetch: apiClient.fetch,
    }),
  ],
});
```

Remove the `import { env } from "@project/env/client";` line from this file — `apiClient` owns that read now.

Note: the `httpBatchLink` fetch option must match `typeof fetch` signature. `apiClient.fetch` has signature `(path, init) => Promise<Response>` but treats `path` as an API path. When tRPC calls `fetch(url, options)`, `url` will already be the full URL (`apiClient.baseUrl + TRPC_MOUNT`). The `path.startsWith("http")` check inside `apiFetch` handles this: full URLs pass through unchanged, with `credentials: "include"` merged in. Good — no duplication of base URL logic.

- [ ] **Step 3: Update `apps/web/src/features/auth/auth-client.ts` to use `apiClient.baseUrl`**

```typescript
import { createAuthClient } from "better-auth/react";
import { apiClient } from "#/shared/api-client";

export const authClient = createAuthClient({
  baseURL: apiClient.baseUrl,
});

export const { signIn, signUp, signOut, useSession } = authClient;
```

Remove `import { env } from "@project/env/client";` — no longer needed.

- [ ] **Step 4: Update `apps/web/src/features/todo/use-todos.ts` to use `apiClient.fetch`**

Replace the top-of-file imports and API URL constant. The file currently has (from Task 3 + Task 4):

```typescript
import { env } from "@project/env/client";
import { MAX_UPLOAD_BYTES } from "@project/config";
// ... other imports

const API_URL = env.VITE_API_URL;
```

Replace with:

```typescript
import { MAX_UPLOAD_BYTES } from "@project/config";
import { apiClient } from "#/shared/api-client";
// ... other imports
```

Remove the `API_URL` constant entirely.

Then update the two fetch sites. Find the `importTodos` mutation:

```typescript
      const res = await fetch(`${API_URL}/api/todos/import`, {
        method: "POST",
        body: formData,
        credentials: "include",
      });
```

Replace with:

```typescript
      const res = await apiClient.fetch("/api/todos/import", {
        method: "POST",
        body: formData,
      });
```

(`credentials: "include"` is already set inside `apiClient.fetch`, no need to duplicate.)

Then find the `exportTodos` function:

```typescript
    const res = await fetch(
      `${API_URL}/api/todos/export?todoListId=${todoListId}`,
      {
        credentials: "include",
      },
    );
```

Replace with:

```typescript
    const res = await apiClient.fetch(
      `/api/todos/export?todoListId=${todoListId}`,
    );
```

- [ ] **Step 5: Add the `apiClient` rule to `apps/web/CLAUDE.md`**

Find the "Do Not" list at the bottom. Add this bullet (near the env-boundary rule added in Task 4):

```markdown
- **Make HTTP calls directly with `fetch()`**. All server calls from the web app MUST go through `apiClient` (`apps/web/src/shared/api-client.ts`). `apiClient.fetch(path, init)` prepends the base URL and sets cookie-auth credentials. This keeps the base URL in a single place and prevents scattered `fetch(\`http://...\`)` calls.
```

Also add a positive-example section near the existing "tRPC Data" usage in the CLAUDE.md:

Find the `## Using tRPC Data` heading. After its last example, add:

```markdown
## Non-tRPC HTTP Calls

For endpoints that aren't tRPC procedures (file upload/download, webhooks), use `apiClient`:

\`\`\`typescript
import { apiClient } from "#/shared/api-client";

// POST with FormData
const res = await apiClient.fetch("/api/upload", {
  method: "POST",
  body: formData,
});

// GET with query string
const res = await apiClient.fetch(`/api/export?id=${id}`);
\`\`\`

Never write `fetch("http://localhost:3001/...")` or `fetch(\`${import.meta.env.VITE_API_URL}/...\`)` — both duplicate the base URL and bypass the `@project/env/client` validation boundary.
```

- [ ] **Step 6: Verify no direct `fetch()` of an http URL remains in web**

Run:
```bash
rg $'fetch\\([\\\'"]http' apps/web/src
```

Expected: zero matches.

Run:
```bash
rg 'fetch\(' apps/web/src
```

Expected: every match is either inside `api-client.ts` (the one implementation) or a call on `apiClient.fetch`. Visually inspect — no free-standing `fetch(...)` calls.

- [ ] **Step 7: Verify `VITE_API_URL` is read exactly once**

Run:
```bash
rg 'VITE_API_URL' apps/web/src
```

Expected: exactly one match, in `apps/web/src/shared/api-client.ts` (the line `import { env } from "@project/env/client";` uses it via `env.VITE_API_URL`, but the string literal `VITE_API_URL` appears only there).

Also check:
```bash
rg 'env\.VITE_API_URL' apps/web/src
```

Expected: exactly one match, in `api-client.ts`.

- [ ] **Step 8: Run lint and typecheck**

Run: `make lint`

Expected: PASS. The `apiClient.fetch` signature matches `fetch` well enough for tRPC's `httpBatchLink`.

- [ ] **Step 9: Run E2E tests**

Run: `make test`

Expected: PASS. All integration flows (auth, tRPC queries/mutations, file import, file export) work through `apiClient`.

- [ ] **Step 10: Manual smoke test — confirm import/export still work**

Start dev env (`make dev`). Sign in. Navigate to a todo list. Export CSV (file downloads). Import a valid CSV (todos appear). Attempt a too-large CSV (immediate toast, no network request per Task 3's check). Attempt with dev tools offline (toast showing network error, via `apiClient.fetch` throw).

- [ ] **Step 11: Commit**

```bash
git add apps/web/src/shared/api-client.ts apps/web/src/router.tsx apps/web/src/features/auth/auth-client.ts apps/web/src/features/todo/use-todos.ts apps/web/CLAUDE.md
git commit -m "$(cat <<'EOF'
refactor(web): centralize all HTTP calls through apiClient

Every fetch from the web app now goes through apps/web/src/shared/
api-client.ts. Removes triplicated VITE_API_URL reads in router.tsx,
auth-client.ts, use-todos.ts. tRPC + Better-Auth clients read the base
URL from apiClient.baseUrl; file upload/download use apiClient.fetch.

apps/web/CLAUDE.md updated with the "all HTTP via apiClient" rule and
a positive-example section for non-tRPC calls.

Part of SSOT audit (bucket C). See docs/superpowers/specs/2026-04-18-config-ssot-audit-design.md.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Final Verification (after all 5 tasks land)

After all 5 tasks are merged to main, run the full verification suite from the spec's "Verification" section:

- [ ] **Check 1: Ports appear only in port contexts, only in config or consumers**

```bash
rg '(:3000|:3001|:3100|:3101|:5432|"3000"|"3001"|"3100"|"3101"|"5432"|localhost:3000|localhost:3001|localhost:3100|localhost:3101|localhost:5432|PORT:\s*3|POSTGRES.*5432|"5432:5432")' \
  --type ts --type tsx --type json --type yaml --type md \
  -g '!node_modules' -g '!dist' -g '!.output' -g '!*.gen.*' -g '!pnpm-lock.yaml' -g '!docs/superpowers/plans/**' -g '!docs/superpowers/specs/**'
```

Expected: every match is in `packages/config/src/`, `docker-compose*.yml` (via `${VAR}:5432`), `apps/web/package.json` (dev-script convenience — spec-accepted), or documentation prose.

- [ ] **Check 2: No `process.env` reads outside the boundary**

```bash
rg 'process\.env\.\w+(?!\s*=)' --type ts --type tsx \
  -g '!packages/env/**' -g '!scripts/**' \
  -g '!**/vite.config.ts' -g '!**/vitest.config.ts' -g '!**/test-setup.ts' \
  -g '!**/playwright.config.ts' \
  -g '!node_modules' -g '!**/*.gen.*'
```

Expected: zero matches.

- [ ] **Check 3: No raw `fetch(` with http URL in web**

```bash
rg $'fetch\\([\\\'"]http' apps/web/src
```

Expected: zero matches.

- [ ] **Check 4: `make lint`, `make test`, `make test-unit` pass**

Run all three. Expected: PASS each.

- [ ] **Check 5: Single version tree**

```bash
pnpm why zod
pnpm why @prisma/client
```

Expected: single resolved version per dep, not a fan-out.

- [ ] **Check 6: Dev port change smoke test**

Edit `packages/config/src/ports.ts`:
```typescript
export const DEV_API_PORT = 3005;
```

Run `make dev`. Confirm web app loads and functions fully on the new port. No other file edited. Revert.

- [ ] **Check 7: Env barrel does not exist**

```bash
cat packages/env/package.json | python -c 'import json,sys; print(list(json.load(sys.stdin)["exports"].keys()))'
```

Expected: `['./server', './client']` only — no `"."`.

```bash
rg 'from "@project/env"[^/]' --type ts --type tsx
```

Expected: zero matches.

---

## Follow-ups (explicitly out of scope)

- **Error-message SSOT.** Strings like `"File too large (max 10 MB)"` appear in server error responses AND in BDD step files. Unifying requires either exporting from server code (and importing in steps) or regex-matching in `.feature` files. Create a new spec after this plan lands.
- **Better-Auth `/api/auth` path duplication.** The auth mount is SSOT'd in `@project/config/api-paths.ts` (A6), but Better-Auth internally assumes `/api/auth`. Any rename requires a Better-Auth `basePath` override — not attempted here.
- **CI `act` smoke test for port change.** Spec verification check #8 suggested this; left to a follow-up because `act` requires local setup. For now, the dev port change test in check #6 gives us sufficient confidence.
- **Agent-harness custom lint rule.** If agent-harness supports a `no-process-env-outside-packages-env` rule, migrate from the `make lint` grep to that rule for faster feedback. Research task.
