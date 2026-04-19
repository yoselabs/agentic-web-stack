# Realtime Push Semantics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every todo mutation publish a payload-shaped realtime event so collaborator clients patch cache via `setQueryData` without refetching; derive event-kinds list from a const-tuple SSOT; merge `todo` domain into `todo-list`.

**Architecture:** Two phases. Phase 0 is a pure-refactor folder move (`todo/` → `todo-list/`) with package-export and cross-app import updates. Phase 1 redesigns `TodoListEvent` to carry full entities, wires publishers in all 5 todo mutations, and introduces a typed per-kind handler map in the web layer. Events stay published inside the DB transaction (post-commit refactor is a separate follow-up).

**Tech Stack:** TanStack Start (Vite SSR) + Hono API + tRPC v11 + Prisma + PostgreSQL + Better-Auth. Realtime via `@project/realtime` (Redis pub/sub + MemoryChannel for tests). BDD via playwright-bdd (Gherkin + Cucumber).

**Reference spec:** `docs/superpowers/specs/2026-04-19-realtime-push-semantics-design.md` (commit `bb77e69`).

---

## File Structure

### Files moving (Phase 0, pure rename — `git mv`)

| From | To |
|---|---|
| `packages/api/src/domains/todo/service.ts` | `packages/api/src/domains/todo-list/todo-service.ts` |
| `packages/api/src/domains/todo/router.ts` | `packages/api/src/domains/todo-list/todo-router.ts` |
| `packages/api/src/domains/todo/constants.ts` | `packages/api/src/domains/todo-list/todo-constants.ts` |
| `packages/api/src/domains/todo/http.ts` | `packages/api/src/domains/todo-list/todo-http.ts` |
| `packages/api/src/domains/todo/__tests__/service.test.ts` | `packages/api/src/domains/todo-list/__tests__/todo-service.test.ts` |
| `packages/api/src/domains/todo/__tests__/router.test.ts` | `packages/api/src/domains/todo-list/__tests__/todo-router.test.ts` |
| `packages/api/src/domains/todo/__tests__/http.test.ts` | `packages/api/src/domains/todo-list/__tests__/todo-http.test.ts` |
| `apps/web/src/features/todo/*` | `apps/web/src/features/todo-list/` (merge into existing folder) |
| `e2e/features/todo/*.feature` | `e2e/features/todo-list/` (merge into existing folder) |
| `e2e/steps/todo/*.ts` | `e2e/steps/todo-list/` (merge into existing folder) |

### Files modified in Phase 0

- `packages/api/package.json` — rename 3 subpath exports (`./domains/todo/service`, `./constants`, `./http`) to `./domains/todo-list/todo-service`, etc. The `./domains/todo-list/service` export that already exists stays.
- `apps/server/src/index.ts` line 5 — import path change.
- `apps/web/src/shared/todo-http-client.ts` line 1 — import path change.
- `apps/web/` — internal imports referring to `features/todo/` need folder-path updates after the move (caught by typecheck).
- `scripts/check-domain-names.ts` line 71 — delete the `todo` ALLOWLIST entry.

### Files modified/created in Phase 1

**Backend:**
- `packages/api/src/domains/todo-list/events.ts` — extend event union, add `TODO_LIST_EVENT_KINDS` const tuple, add `TodoWithList` type.
- `packages/api/src/domains/todo-list/todo-service.ts` (post-Phase-0 path) — update `completeTodo` payload; add `options: { channel?: ChannelProvider }` + publish in `createTodo`, `deleteTodo`, `reorderTodos`, `importTodosFromCSV`.
- `packages/api/src/domains/todo-list/__tests__/todo-service.test.ts` (post-Phase-0 path) — 4 new publish-assertion tests + update `completeTodo` publish test.
- `packages/api/src/domains/todo-list/__tests__/events.test.ts` — rename 3 event kinds in test fixtures.

**Frontend:**
- `apps/web/src/features/todo-list/event-handlers.ts` — **NEW**. Per-kind handler map with `sortTodos` helper.
- `apps/web/src/features/todo-list/__tests__/event-handlers.test.ts` — **NEW**. 8 unit tests (one per kind) + cold-cache no-op checks.
- `apps/web/src/features/todo-list/use-todo-list-live-updates.ts` — refactor `applyEvent` inline → delegate to handler map; import `TODO_LIST_EVENT_KINDS` instead of hand-duplicating.

**E2E:**
- `e2e/helpers/collaborator-actors.ts` — **NEW**. Extracted helpers from `e2e/steps/todo-list/collaborators.ts` (reduces 498/500-line file).
- `e2e/features/todo-list/collaborator-realtime-todos.feature` — **NEW**. 4 scenarios.
- `e2e/steps/todo-list/collaborator-realtime-todos.ts` — **NEW**. Step definitions.

**Docs:**
- `docs/conventions.md` — **NEW**. Seeded with realtime-event-naming + payload-vs-notification + kinds-SSOT conventions.
- `CLAUDE.md` — new top-level "Conventions" section pointing at `docs/conventions.md`.
- `packages/api/CLAUDE.md` — note on realtime-publish pattern under "Adding a New Feature".

---

# Phase 0 — Domain merge

Phase 0 is a pure refactor. Everything must stay behaviorally identical — `make lint` + `make test-unit` + `make test` all green at the end. **Land as one commit.**

Note on order: git renames land first, then the package-export + consumer-import edits are atomic (either side half-done = build breaks). Prefer to stage everything and commit once at the end of Phase 0.

---

### Task 0.1: Verify clean working tree and baseline green

**Files:** none (verification only)

- [ ] **Step 1: Verify clean working tree**

Run: `git status`
Expected: `packages/api/src/domains/todo/__tests__/service.test.ts` may show as modified (pre-existing); nothing else. If other unstaged changes exist, stash them before proceeding.

- [ ] **Step 2: Verify baseline is green**

Run: `make lint && make test-unit`
Expected: both PASS.

- [ ] **Step 3: Verify BDD baseline (desktop project only, keeps it fast)**

Run: `make test ARGS="--project desktop --grep 'Todo list collaborators'"`
Expected: 4/4 PASS. (The 5 pre-existing e2e failures mentioned in the Plan-C handover are outside this scope.)

---

### Task 0.2: Rename backend todo/ files to todo-list/

**Files:** `packages/api/src/domains/todo/**` → `packages/api/src/domains/todo-list/`

- [ ] **Step 1: Rename service.ts**

```bash
git mv packages/api/src/domains/todo/service.ts \
       packages/api/src/domains/todo-list/todo-service.ts
```

- [ ] **Step 2: Rename router.ts**

```bash
git mv packages/api/src/domains/todo/router.ts \
       packages/api/src/domains/todo-list/todo-router.ts
```

- [ ] **Step 3: Rename constants.ts**

```bash
git mv packages/api/src/domains/todo/constants.ts \
       packages/api/src/domains/todo-list/todo-constants.ts
```

- [ ] **Step 4: Rename http.ts**

```bash
git mv packages/api/src/domains/todo/http.ts \
       packages/api/src/domains/todo-list/todo-http.ts
```

- [ ] **Step 5: Rename all 3 test files in `todo/__tests__/`**

Verified contents: `http.test.ts`, `router.test.ts`, `service.test.ts`.

```bash
git mv packages/api/src/domains/todo/__tests__/service.test.ts \
       packages/api/src/domains/todo-list/__tests__/todo-service.test.ts
git mv packages/api/src/domains/todo/__tests__/router.test.ts \
       packages/api/src/domains/todo-list/__tests__/todo-router.test.ts
git mv packages/api/src/domains/todo/__tests__/http.test.ts \
       packages/api/src/domains/todo-list/__tests__/todo-http.test.ts
```

- [ ] **Step 6: Remove now-empty `todo/` directory**

```bash
rmdir packages/api/src/domains/todo/__tests__
rmdir packages/api/src/domains/todo
```

- [ ] **Step 7: Verify rename**

Run: `ls packages/api/src/domains/todo-list/`
Expected: `todo-service.ts`, `todo-router.ts`, `todo-constants.ts`, `todo-http.ts`, plus existing `service.ts`, `router.ts`, `constants.ts`, `events.ts`, `__tests__/`.

Run: `ls packages/api/src/domains/ | grep '^todo'`
Expected: only `todo-list` — no bare `todo/` dir.

---

### Task 0.3: Update internal imports inside merged backend files

**Files:** `packages/api/src/domains/todo-list/*.ts` — only the just-renamed files; relative imports need path audit.

- [ ] **Step 1: Open `todo-service.ts`, check its `./todo-list/` or `../todo-list/` imports**

Run: `grep -n "from \"\\.\\./todo-list\\|from \"\\./todo-list" packages/api/src/domains/todo-list/todo-service.ts`

Before Phase 0 these imported as `from "../todo-list/service.js"` and `from "../todo-list/events.js"`. After the move, both files are SIBLINGS in the same folder, so change to `from "./service.js"` and `from "./events.js"`.

- [ ] **Step 2: Apply the sibling-path rewrite**

Edit `packages/api/src/domains/todo-list/todo-service.ts`:

Old:
```ts
import { listChannelKey, type TodoListEvent } from "../todo-list/events.js";
import { canReadList } from "../todo-list/service.js";
```

New:
```ts
import { listChannelKey, type TodoListEvent } from "./events.js";
import { canReadList } from "./service.js";
```

- [ ] **Step 3: Check `todo-router.ts` for relative imports**

Run: `grep -n "\\.\\./" packages/api/src/domains/todo-list/todo-router.ts`

Typical pattern was `from "../../trpc.js"` (up two levels to `src/trpc.ts`). That's still `../../trpc.js` from the new location — no change needed. Relative imports to `./service.js` (i.e., `./todo-service.js`'s public API) need updating if they went via `../todo-list/service.js` before — but the router imports its own siblings now: `./todo-service.js`.

Edit `packages/api/src/domains/todo-list/todo-router.ts`:

Old imports of its own service:
```ts
import { ... } from "./service.js";
```

Now must NOT collide with the existing `service.ts` (which is list-service). Change to:
```ts
import { ... } from "./todo-service.js";
```

Audit exports for any clash — both `service.ts` and `todo-service.ts` coexist; they must not re-export conflicting names. If `todo-service.ts` re-exports `canReadList` from `service.ts`, remove that re-export — importers of `todo-service` should not get it.

- [ ] **Step 4: Check `todo-http.ts` for relative imports**

Run: `grep -n "\\.\\./" packages/api/src/domains/todo-list/todo-http.ts`

Adjust relative paths similarly. If it imports `./service.js` (former todo service), update to `./todo-service.js`. If it imports `./constants.js`, update to `./todo-constants.js`.

- [ ] **Step 5: Check `todo-constants.ts`**

Likely has no relative imports (primitive constants). Verify:
Run: `grep -n "^import" packages/api/src/domains/todo-list/todo-constants.ts`
Expected: only type-import of Prisma types or nothing. No changes.

- [ ] **Step 6: Update import paths in all 3 renamed test files**

Each test file imports its subject as `"../X.js"` where X is `service`, `router`, `http` respectively. After rename the subject is `todo-service`, `todo-router`, `todo-http`.

- `packages/api/src/domains/todo-list/__tests__/todo-service.test.ts` — replace `"../service.js"` → `"../todo-service.js"`.
- `packages/api/src/domains/todo-list/__tests__/todo-router.test.ts` — replace `"../router.js"` → `"../todo-router.js"`.
- `packages/api/src/domains/todo-list/__tests__/todo-http.test.ts` — replace `"../http.js"` → `"../todo-http.js"`.

Run to verify no stale paths remain:
```bash
grep -nE 'from "\\.\\./service\\.js"|from "\\.\\./router\\.js"|from "\\.\\./http\\.js"' \
  packages/api/src/domains/todo-list/__tests__/todo-*.test.ts
```
Expected: zero matches.

- [ ] **Step 7: Typecheck backend**

Run: `pnpm --filter @project/api exec tsc --noEmit`
Expected: PASS. If failures, they'll be import-path mismatches — fix, re-run.

---

### Task 0.4: Update packages/api/package.json exports

**Files:** `packages/api/package.json`

- [ ] **Step 1: Open package.json and locate the `exports` object**

Current `exports` (confirmed via Read earlier):
```json
{
  "./authz": {"default": "./src/authz/index.ts"},
  "./context": {"default": "./src/context.ts"},
  "./domains/todo/service":   {"default": "./src/domains/todo/service.ts"},
  "./domains/todo/constants": {"default": "./src/domains/todo/constants.ts"},
  "./domains/todo/http":      {"default": "./src/domains/todo/http.ts"},
  "./domains/todo-list/service":   {"default": "./src/domains/todo-list/service.ts"},
  "./domains/todo-list/events":    {"default": "./src/domains/todo-list/events.ts"},
  "./domains/todo-list/constants": {"default": "./src/domains/todo-list/constants.ts"},
  "./router": {"default": "./src/router.ts"}
}
```

- [ ] **Step 2: Apply the diff**

Replace 3 entries:
```diff
-  "./domains/todo/service":   {"default": "./src/domains/todo/service.ts"},
-  "./domains/todo/constants": {"default": "./src/domains/todo/constants.ts"},
-  "./domains/todo/http":      {"default": "./src/domains/todo/http.ts"},
+  "./domains/todo-list/todo-service":   {"default": "./src/domains/todo-list/todo-service.ts"},
+  "./domains/todo-list/todo-constants": {"default": "./src/domains/todo-list/todo-constants.ts"},
+  "./domains/todo-list/todo-http":      {"default": "./src/domains/todo-list/todo-http.ts"},
```

- [ ] **Step 3: Verify file paths exist**

Run:
```bash
for f in todo-service.ts todo-constants.ts todo-http.ts; do
  test -f packages/api/src/domains/todo-list/$f && echo "OK: $f" || echo "MISSING: $f"
done
```
Expected: three `OK:` lines.

---

### Task 0.5: Update cross-package consumer imports

**Files:** `apps/server/src/index.ts`, `apps/web/src/shared/todo-http-client.ts`

- [ ] **Step 1: Update `apps/server/src/index.ts` line 5**

Old:
```ts
import { todoHttpRouter } from "@project/api/domains/todo/http";
```

New:
```ts
import { todoHttpRouter } from "@project/api/domains/todo-list/todo-http";
```

- [ ] **Step 2: Update `apps/web/src/shared/todo-http-client.ts` line 1**

Old:
```ts
import type { TodoHttpRouter } from "@project/api/domains/todo/http";
```

New:
```ts
import type { TodoHttpRouter } from "@project/api/domains/todo-list/todo-http";
```

- [ ] **Step 3: Grep sweep for any other consumers**

Run: `rg '"@project/api/domains/todo/' --glob '!docs/**' --glob '!**/*.md'`
Expected: zero matches (all `@project/api/domains/todo/*` imports gone from code; `docs/` mentions are illustrative and stay).

If matches exist, update each to the `todo-list/todo-*` equivalent.

---

### Task 0.6: Move web features/todo/ into features/todo-list/

**Files:** `apps/web/src/features/todo/` → `apps/web/src/features/todo-list/`

- [ ] **Step 1: List current contents of both folders**

Run: `ls apps/web/src/features/todo/ apps/web/src/features/todo-list/ 2>&1`
Note the overlap risk (e.g., both may have `index.ts`, both may have `use-*.ts`). Typical contents: `todo/` has `use-todos.ts` + component files; `todo-list/` has `use-todo-lists.ts`, `use-todo-list-live-updates.ts`, `use-leader-tab.ts`, etc.

- [ ] **Step 2: git mv each file from `todo/` into `todo-list/`**

```bash
for f in apps/web/src/features/todo/*; do
  name=$(basename "$f")
  if [ -e "apps/web/src/features/todo-list/$name" ]; then
    echo "COLLISION: $name (manual merge needed)"
  else
    git mv "$f" "apps/web/src/features/todo-list/$name"
  fi
done
```

If there are subdirectories (e.g., `todo/components/`), repeat for each with `git mv -r`-equivalent (git has no `-r`; use `git mv` per file, or `git mv subdir/ target/subdir/`).

For any COLLISION: inspect manually and merge content, then `git rm` the old and `git add` the new. At the time of writing, no collision is expected.

- [ ] **Step 3: Remove now-empty `todo/` directory**

Run: `rmdir apps/web/src/features/todo/`

- [ ] **Step 4: Update imports that pointed at `features/todo/*`**

Run: `rg 'features/todo[/"]' apps/web --glob '!**/*.md'`
Every match should be updated from `features/todo/` → `features/todo-list/`.

Typical sites: `apps/web/src/routes/_authenticated/todo-lists/$listId.tsx` (imports `useTodos`), `apps/web/src/routes/__root.tsx` (probably none).

Edit each file, replace `features/todo/` → `features/todo-list/` in imports.

Run: `rg 'features/todo[/"]' apps/web --glob '!**/*.md' | wc -l`
Expected: 0 after all edits.

- [ ] **Step 5: Typecheck web app**

Run: `pnpm --filter web exec tsc --noEmit`
Expected: PASS.

---

### Task 0.7: Move e2e feature files + step defs into todo-list/

**Files:** `e2e/features/todo/*.feature`, `e2e/steps/todo/*.ts`

- [ ] **Step 1: List e2e folders**

Run: `ls e2e/features/todo/ e2e/steps/todo/ 2>&1`

- [ ] **Step 2: Move features**

```bash
for f in e2e/features/todo/*.feature; do
  name=$(basename "$f")
  if [ -e "e2e/features/todo-list/$name" ]; then
    echo "COLLISION: $name"
  else
    git mv "$f" "e2e/features/todo-list/$name"
  fi
done
rmdir e2e/features/todo/
```

- [ ] **Step 3: Move step defs**

```bash
for f in e2e/steps/todo/*.ts; do
  name=$(basename "$f")
  if [ -e "e2e/steps/todo-list/$name" ]; then
    echo "COLLISION: $name"
  else
    git mv "$f" "e2e/steps/todo-list/$name"
  fi
done
rmdir e2e/steps/todo/
```

- [ ] **Step 4: Update e2e relative imports within moved files**

Step-def imports typically go `../../helpers/*`. If any file moved from `e2e/steps/todo/` to `e2e/steps/todo-list/`, the relative depth is the same (both are at `e2e/steps/<dir>/`), so no update needed.

But verify:
Run: `rg "from \"\\.\\./" e2e/steps/todo-list/`
Confirm each path still resolves to the target file (e.g., `../../helpers/...`).

- [ ] **Step 5: Regenerate playwright-bdd generated tests**

Run: `cd e2e && pnpm exec bddgen`
Expected: no errors. Regenerates `.features-gen/` from the new layout.

- [ ] **Step 6: Verify e2e typecheck**

Run: `pnpm --filter e2e exec tsc --noEmit`
Expected: PASS.

---

### Task 0.8: Delete `todo` entry from check-domain-names.ts

**Files:** `scripts/check-domain-names.ts`

- [ ] **Step 1: Open the file and locate the ALLOWLIST**

Run: `rg -n "todo: new Set|ALLOWLIST" scripts/check-domain-names.ts`

- [ ] **Step 2: Delete the `todo` entry**

The entry looks like:
```ts
todo: new Set(["e2e-feat", "e2e-steps"]),
```

Remove that line. Leave the rest of the ALLOWLIST object untouched.

- [ ] **Step 3: Run the script manually to verify**

Run: `pnpm tsx scripts/check-domain-names.ts`
Expected: PASS (no "domain name parallelism" errors). The `todo` name no longer exists in any layer, so it's not checked.

---

### Task 0.9: Phase 0 green-bar verification

**Files:** none (verification only)

- [ ] **Step 1: Grep-sweep final verification**

Run: `rg '"@project/api/domains/todo/' --glob '!docs/**' --glob '!**/*.md'`
Expected: zero matches.

Run: `rg 'features/todo[/"]' apps/web --glob '!**/*.md'`
Expected: zero matches.

Run: `ls packages/api/src/domains/ | grep '^todo'`
Expected: only `todo-list`.

- [ ] **Step 2: Full lint**

Run: `make lint`
Expected: PASS.

- [ ] **Step 3: Unit tests**

Run: `make test-unit`
Expected: PASS (test count unchanged).

- [ ] **Step 4: BDD (desktop only, fast check)**

Run: `make test ARGS="--project desktop --grep 'Todo list collaborators'"`
Expected: 4/4 PASS.

- [ ] **Step 5: Commit Phase 0 as a single commit**

```bash
git add -A
git status  # sanity-check the diff
git commit -m "$(cat <<'EOF'
refactor: merge todo domain into todo-list (aggregate-root naming)

Pure refactor, no behavior change. Todo lives only inside a TodoList;
authz flows through canReadList; realtime channel is list-keyed. The
prior todo/ vs todo-list/ split had no semantic meaning.

Changes:
- Rename packages/api/src/domains/todo/* -> todo-list/todo-*
- Merge apps/web/src/features/todo/* -> features/todo-list/
- Merge e2e/{features,steps}/todo/* -> todo-list/
- Update packages/api/package.json exports (3 subpath renames)
- Rewrite 2 cross-app imports (apps/server/, apps/web/shared/)
- Delete `todo` entry from scripts/check-domain-names.ts ALLOWLIST

tRPC router namespaces stay split (appRouter.todo + appRouter.todoList)
to keep the frontend API surface stable.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: pre-commit hooks (lint + tsc) PASS, commit succeeds.

---

# Phase 1 — Event redesign

Phase 1 lands in multiple commits. The key constraint: **step 2 is atomic** (union rename + completeTodo publisher update + events.test.ts fixtures must ship in one commit, or `make lint` breaks in intermediate states). All other steps commit independently.

---

### Task 1.1: Export helpers from collaborators.ts (no extraction)

**Rationale adjustment:** the original plan extracted helpers into `e2e/helpers/collaborator-actors.ts` to keep `collaborators.ts` under the 500-line cap. On verification, the cap concern is about *adding* to that file. We're writing new scenarios in a NEW file (`collaborator-realtime-todos.ts`), so `collaborators.ts` does NOT grow. The simpler fix: add `export` keywords to the helpers the new file needs, so it can import them as siblings.

This keeps the helpers co-located with the actor model, avoids a churn-heavy move, and stays under the line-cap by 2 lines.

**Files:**
- Modify: `e2e/steps/todo-list/collaborators.ts` — add `export` to 7 identifiers.

- [ ] **Step 1: Add `export` to the 7 identifiers needed by the new step file**

Edit `e2e/steps/todo-list/collaborators.ts`. For each identifier below, prepend `export` to its declaration. Verified signatures (do NOT change bodies):

At line ~16: `type Actor = {...}` → `export type Actor = {...}`
At line ~25: `const actors = new Map<string, Actor>();` → `export const actors = new Map<string, Actor>();`
At line ~30: `const listIdByName = new Map<string, string>();` → `export const listIdByName = new Map<string, string>();`
At line ~47: `function getActor(name: string): Actor {...}` → `export function getActor(name: string): Actor {...}`
At line ~102: `async function spawnActor(browser, name, email, username): Promise<Actor> {...}` → `export async function spawnActor(...): Promise<Actor> {...}`
At line ~117: `async function fetchUserId(page): Promise<string> {...}` → `export async function fetchUserId(...): Promise<string> {...}`
At line ~134: `async function heldLeaderLocksOn(page, userId): Promise<number> {...}` → `export async function heldLeaderLocksOn(...): Promise<number> {...}`

Also find `resolveListIdFor` and add `export`. Find via:
Run: `grep -n '^function resolveListIdFor\|^async function resolveListIdFor' e2e/steps/todo-list/collaborators.ts`
Prepend `export`.

Do NOT export `signUpWithUsername` or `signInOnPage` — they're internal to collaborators.ts.

- [ ] **Step 2: Verify line count stays under 500**

Run: `wc -l e2e/steps/todo-list/collaborators.ts`
Expected: 498 + ~8 whitespace-neutral changes = still 498. (Adding `export` to existing declarations doesn't add lines.)

- [ ] **Step 3: Typecheck + BDD smoke**

Run: `pnpm --filter e2e exec tsc --noEmit`
Expected: PASS.

Run: `make test ARGS="--project desktop --grep 'Todo list collaborators'"`
Expected: 4/4 PASS (identical behavior).

- [ ] **Step 4: Commit**

```bash
git add e2e/steps/todo-list/collaborators.ts
git commit -m "$(cat <<'EOF'
refactor(e2e): export collaborators.ts helpers for sibling-file reuse

Upcoming realtime-collaborator BDD scenarios need access to the actor
model (Actor type, actors map, spawnActor, etc.) from a new sibling
step-def file. Simplest path: export the existing helpers. No code
movement, no behavior change.

Alternative considered: extract to e2e/helpers/collaborator-actors.ts.
Rejected because the file-length-cap concern (handover §56) is about
adding to collaborators.ts — we're adding to a new file instead, so
collaborators.ts does not grow.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 1.2: Atomic commit — event union + completeTodo publisher + events.test.ts

**Files (all in ONE commit):**
- Modify: `packages/api/src/domains/todo-list/events.ts`
- Modify: `packages/api/src/domains/todo-list/todo-service.ts`
- Modify: `packages/api/src/domains/todo-list/__tests__/events.test.ts`
- Modify: `packages/api/src/domains/todo-list/service.ts` (list-level publishers: rename kinds)
- Modify: `packages/api/src/domains/todo-list/__tests__/todo-service.test.ts` (rename in existing completeTodo publish test)

**Constraint:** renaming the union kinds without updating all publishers in the same commit breaks `make lint`. Do all the edits, then one commit.

- [ ] **Step 1: Write failing test — update events.test.ts fixtures FIRST (red)**

Reading current state (confirmed via Read):
- `events.test.ts:34` has `{ kind: "list-updated", listId: "L" }`.
- `events.test.ts:41` has `{ kind: "todo-updated", listId: "L", todoId: "T1" }`.
- `events.test.ts:44, 46` expectation matches same kind + payload.
- `events.test.ts:63-67, 70-74` use `kind: "collaborator-removed"`.
- `events.test.ts:80-84, 86-90` use `kind: "collaborator-removed"`.

Rewrite the fixtures to the new kinds:
- `list-updated` → `todo-list-updated`
- `collaborator-removed` → `todo-list-collaborator-removed`
- `todo-updated` payload goes from `{kind, listId, todoId}` to `{kind, listId, todo}` where `todo` is a minimal `TodoWithList` stub.

Exact edits to `packages/api/src/domains/todo-list/__tests__/events.test.ts`:

At line 34:
```ts
await ch.publish({ kind: "todo-list-updated", listId: "L" });
```

At line 37:
```ts
expect(first.value).toEqual({ kind: "todo-list-updated", listId: "L" });
```

At line 41 — change the publish:
```ts
const stubTodo = {
  id: "T1",
  title: "x",
  completed: false,
  position: 0,
  userId: "u1",
  todoListId: "L",
  createdAt: new Date(0),
  updatedAt: new Date(0),
  todoList: {
    id: "L",
    name: "list",
    userId: "u1",
    color: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  },
};
await ch.publish({ kind: "todo-updated", listId: "L", todo: stubTodo });
```

At lines 43–47 — update the expectation:
```ts
expect(second.value).toEqual({
  kind: "todo-updated",
  listId: "L",
  todo: stubTodo,
});
```

At lines 63–74 — rename `collaborator-removed` → `todo-list-collaborator-removed` (both publish and expectation).

At lines 79–90 — same rename.

- [ ] **Step 2: Run typecheck — verify it FAILS (red) on the renamed fixtures**

Run: `pnpm --filter @project/api exec tsc --noEmit`

Expected: FAIL with TS errors like `Type '"todo-list-updated"' is not assignable to type '"list-updated" | "todo-updated" | ...'`. The test file references kinds the union doesn't have yet.

This is the TDD red signal — a compile-time assertion that the union must change to match. Note: bun test may still attempt to run and fail at module load with the same TS error; that's equivalent signal.

- [ ] **Step 3: Update `events.ts` — add types, rename kinds, add const tuple**

Replace the entire body of `packages/api/src/domains/todo-list/events.ts` with:

```ts
// Event union published to per-list realtime channels.
// Consumed by: the tRPC subscription on the server (fan-out to WS clients),
// the service's own unit tests (via MemoryChannel assertion).

import type { Todo, TodoList } from "@project/db";
import type { Channel } from "@project/realtime/types";

// Matches the `todo.list` query shape (todo-service.ts: include: { todoList: true }).
// Payloads MUST match this shape exactly — the client cache stores rows of this
// shape, and patching with a narrower shape would corrupt downstream consumers
// that read `t.todoList.name` etc.
export type TodoWithList = Todo & { todoList: TodoList };

export const TODO_LIST_EVENT_KINDS = [
  "todo-list-updated",
  "todo-list-collaborator-added",
  "todo-list-collaborator-removed",
  "todo-created",
  "todo-updated",
  "todo-deleted",
  "todos-reordered",
  "todos-imported",
] as const;

export type TodoListEventKind = (typeof TODO_LIST_EVENT_KINDS)[number];

export type TodoListEvent =
  | { kind: "todo-list-updated"; listId: string }
  | { kind: "todo-list-collaborator-added"; listId: string; userId: string }
  | { kind: "todo-list-collaborator-removed"; listId: string; userId: string }
  | { kind: "todo-created"; listId: string; todo: TodoWithList }
  | { kind: "todo-updated"; listId: string; todo: TodoWithList }
  | { kind: "todo-deleted"; listId: string; todoId: string }
  | { kind: "todos-reordered"; listId: string; positions: Array<{ id: string; position: number }> }
  | { kind: "todos-imported"; listId: string; todos: TodoWithList[] };

export function listChannelKey(listId: string): string {
  return `todo-list:${listId}`;
}

// Consumed by the tRPC onListEvent subscription. Extracted so unit tests
// can drive the auto-close path (viewer-revoked-while-subscribed) without
// spinning up a tRPC caller.
//
// The generator:
//   - yields every event received on the channel
//   - auto-closes when a `todo-list-collaborator-removed` event names the viewer
//     (authz cascade — subscription MUST NOT outlive viewer access)
//   - honors AbortSignal for client-initiated cancellation
//   - always unsubscribes on exit via the try/finally
export async function* subscribeToListEvents(
  ch: Channel<TodoListEvent>,
  viewerId: string,
  signal?: AbortSignal,
): AsyncGenerator<TodoListEvent> {
  const buffer: TodoListEvent[] = [];
  let resolveNext: (() => void) | null = null;

  const unsub = await ch.subscribe((event) => {
    buffer.push(event);
    resolveNext?.();
    resolveNext = null;
  });

  try {
    while (true) {
      while (buffer.length > 0) {
        // biome-ignore lint/style/noNonNullAssertion: length guard above
        const event = buffer.shift()!;
        yield event;
        // Authz cascade: viewer removed → close their own stream.
        // Owner never receives this about themselves (they're not in
        // the membership table), so the check is safe for both roles.
        if (
          event.kind === "todo-list-collaborator-removed" &&
          event.userId === viewerId
        ) {
          return;
        }
      }
      if (signal?.aborted) return;
      await new Promise<void>((resolve) => {
        resolveNext = resolve;
        signal?.addEventListener("abort", () => resolve(), { once: true });
      });
    }
  } finally {
    unsub();
  }
}
```

Key changes:
- New `TodoWithList` type exported.
- New `TODO_LIST_EVENT_KINDS` const tuple (SSOT).
- New `TodoListEventKind` derived type.
- Union expanded to 8 kinds, 5 of them payload-shaped.
- `subscribeToListEvents` authz-cascade check updated to `todo-list-collaborator-removed`.

- [ ] **Step 4: Update the two list-level publishers in `service.ts`**

Edit `packages/api/src/domains/todo-list/service.ts`:

At line 207: change `kind: "collaborator-added"` → `kind: "todo-list-collaborator-added"`.

At line 251: change `kind: "collaborator-removed"` → `kind: "todo-list-collaborator-removed"`.

These are the only inline publish-kind strings in this file.

- [ ] **Step 5: Update `completeTodo` publisher in `todo-service.ts`**

Edit `packages/api/src/domains/todo-list/todo-service.ts`:

Current `completeTodo` ends (lines ~119–125 of the old `todo/service.ts`) with:
```ts
await provider(listChannelKey(todo.todoListId)).publish({
  kind: "todo-updated",
  listId: todo.todoListId,
  todoId: id,
});
return updated;
```

Change to:
```ts
// Re-read with the todoList relation so the payload matches TodoWithList.
// The cache-consuming clients store todos with this relation.
const updatedWithList = await tx.todo.findUniqueOrThrow({
  where: { id },
  include: { todoList: true },
});
await provider(listChannelKey(todo.todoListId)).publish({
  kind: "todo-updated",
  listId: todo.todoListId,
  todo: updatedWithList,
});
return updatedWithList;
```

The function's return type now matches `TodoWithList` — `updated` is the narrower shape from the bare `tx.todo.update`, and we want to return the richer shape so the router's tRPC response also carries `todoList` (prevents a separate drift).

- [ ] **Step 6: Update the existing `completeTodo publishes` test fixture**

Edit `packages/api/src/domains/todo-list/__tests__/todo-service.test.ts`.

Find the test at line 459 (`"completeTodo publishes todo-updated event on the list channel"`).

Current assertion (lines 477–479):
```ts
expect(published).toEqual([
  { kind: "todo-updated", listId: sharedListId, todoId: ownerTodo.id },
]);
```

Change to (asserting the relevant fields, leaving full payload check to the handler tests):
```ts
expect(published.length).toBe(1);
const event = published[0];
expect(event?.kind).toBe("todo-updated");
expect(event?.kind === "todo-updated" && event.listId).toBe(sharedListId);
expect(event?.kind === "todo-updated" && event.todo.id).toBe(ownerTodo.id);
expect(event?.kind === "todo-updated" && event.todo.todoList?.id).toBe(sharedListId);
```

(The `event?.kind === "todo-updated" && ...` incantation narrows the union so TS lets us access `event.todo`. Alternatively, use a discriminant helper.)

- [ ] **Step 7: Typecheck + unit test run**

Run: `pnpm --filter @project/api exec tsc --noEmit`
Expected: PASS. If fail: inspect for any lingering `todoId:` payload references in service code, or kind-string mismatches.

Run: `pnpm --filter @project/api test events.test`
Expected: 3 tests PASS (the renamed fixtures now match the renamed union).

Run: `pnpm --filter @project/api test todo-service.test`
Expected: all PASS; the updated completeTodo-publish test asserts the new payload shape.

- [ ] **Step 8: Frontend + full-repo typecheck**

Running the full typecheck catches any frontend consumers reading `TodoListEvent` that assumed `todoId` on `todo-updated`.

Run: `make lint`
Expected: PASS. If fail — `use-todo-list-live-updates.ts`'s `applyEvent` may reference `event.todoId` for `todo-updated`; that code is rewritten in task 1.5 but must compile now. Quick fix: in `applyEvent`, remove any branch that reads `event.todoId` on `todo-updated`, or guard with `"todoId" in event` — but cleaner is to let the handler-map refactor replace `applyEvent` wholesale (task 1.5). If `make lint` fails here because of `applyEvent` reading removed fields, the minimal fix is to patch `applyEvent` with the new `kind` strings WITHOUT expanding capability — then task 1.5 does the real refactor.

Minimal patch to `apps/web/src/features/todo-list/use-todo-list-live-updates.ts` to unblock `make lint`:

Hand-duplicated array at lines 47–52:
```ts
const TODO_LIST_EVENT_KINDS = [
  "list-updated",
  "todo-updated",
  "collaborator-added",
  "collaborator-removed",
] as const;
```

Change to:
```ts
import { TODO_LIST_EVENT_KINDS } from "@project/api/domains/todo-list/events";
```

(Delete the local const. This unblocks TS because relay's `ev.kind` now matches the union's 8 kinds, not the old 4.)

If `applyEvent` (lines 65–81) doesn't read any kind-specific fields, it should still compile. Verify — the current body just invalidates 4 queries by `listId`, not by kind. If so, no further patch needed.

- [ ] **Step 9: Commit — atomic**

```bash
git add packages/api/src/domains/todo-list/events.ts \
        packages/api/src/domains/todo-list/service.ts \
        packages/api/src/domains/todo-list/todo-service.ts \
        packages/api/src/domains/todo-list/__tests__/events.test.ts \
        packages/api/src/domains/todo-list/__tests__/todo-service.test.ts \
        apps/web/src/features/todo-list/use-todo-list-live-updates.ts

git commit -m "$(cat <<'EOF'
feat(events): domain-prefixed kinds + TodoWithList payload + SSOT tuple

Rename list-level event kinds to domain-prefixed form and add 4 payload-
shaped todo-level kinds, with TodoWithList as the canonical payload type
matching the `todo.list` query shape (include: { todoList: true }).

- events.ts: add TODO_LIST_EVENT_KINDS const tuple as SSOT; derive
  TodoListEventKind from it; expand the union to 8 kinds.
- service.ts: publishers switch to "todo-list-collaborator-*" kinds.
- todo-service.ts: completeTodo payload carries the full updated todo
  with todoList relation (client cache shape).
- events.test.ts: rename fixtures to the new kinds; add stub TodoWithList
  payload for the todo-updated case.
- todo-service.test.ts: completeTodo publish assertion now checks full
  payload shape including todoList.
- use-todo-list-live-updates.ts: drop hand-duplicated kinds array; import
  TODO_LIST_EVENT_KINDS from events.ts. (Full handler-map refactor lands
  in a later commit.)

Atomic commit: intermediate states are type-broken.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Pre-commit hooks must PASS. If `tsc -b` fails: re-read hook output; typical culprit is a `kind` mismatch somewhere not covered above. Fix, re-commit (new commit, not `--amend`).

---

### Task 1.3: Wire four new publishers in todo-service.ts

**Files:**
- Modify: `packages/api/src/domains/todo-list/todo-service.ts`

Four functions gain the `options: { channel?: ChannelProvider }` parameter mirroring `completeTodo`, and each publishes its corresponding event after the DB write inside the `$transaction`.

- [ ] **Step 1: Wire `createTodo`**

Current signature/body of `createTodo` (reading from todo-service.ts at ~line 69–87):
```ts
export async function createTodo(
  tx: Prisma.TransactionClient,
  creatorId: string,
  title: string,
  todoListId: string,
) {
  const allowed = await canReadList(tx, creatorId, todoListId);
  if (!allowed) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You do not have access to this list.",
    });
  }
  await lockActiveTodos(tx, todoListId);
  await shiftActivePositions(tx, todoListId);
  return tx.todo.create({
    data: { title, userId: creatorId, todoListId, position: 0 },
  });
}
```

Replace with:
```ts
export async function createTodo(
  tx: Prisma.TransactionClient,
  creatorId: string,
  title: string,
  todoListId: string,
  options: { channel?: ChannelProvider } = {},
) {
  const provider = options.channel ?? defaultProvider;
  const allowed = await canReadList(tx, creatorId, todoListId);
  if (!allowed) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You do not have access to this list.",
    });
  }
  await lockActiveTodos(tx, todoListId);
  await shiftActivePositions(tx, todoListId);
  const created = await tx.todo.create({
    data: { title, userId: creatorId, todoListId, position: 0 },
    include: { todoList: true },
  });
  await provider(listChannelKey(todoListId)).publish({
    kind: "todo-created",
    listId: todoListId,
    todo: created,
  });
  return created;
}
```

- [ ] **Step 2: Wire `deleteTodo`**

Current body (`deleteTodo`):
```ts
export async function deleteTodo(
  tx: Prisma.TransactionClient,
  viewerId: string,
  id: string,
) {
  const todo = await tx.todo.findUniqueOrThrow({ where: { id } });
  const allowed = await canReadList(tx, viewerId, todo.todoListId);
  if (!allowed) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You do not have access to this list.",
    });
  }
  return tx.todo.delete({ where: { id } });
}
```

Replace with:
```ts
export async function deleteTodo(
  tx: Prisma.TransactionClient,
  viewerId: string,
  id: string,
  options: { channel?: ChannelProvider } = {},
) {
  const provider = options.channel ?? defaultProvider;
  const todo = await tx.todo.findUniqueOrThrow({ where: { id } });
  const allowed = await canReadList(tx, viewerId, todo.todoListId);
  if (!allowed) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You do not have access to this list.",
    });
  }
  const deleted = await tx.todo.delete({ where: { id } });
  await provider(listChannelKey(todo.todoListId)).publish({
    kind: "todo-deleted",
    listId: todo.todoListId,
    todoId: id,
  });
  return deleted;
}
```

- [ ] **Step 3: Wire `reorderTodos`**

Current body:
```ts
export async function reorderTodos(
  tx: Prisma.TransactionClient,
  viewerId: string,
  todoListId: string,
  ids: string[],
) {
  const allowed = await canReadList(tx, viewerId, todoListId);
  if (!allowed) {
    throw new TRPCError({ code: "FORBIDDEN", message: "You do not have access to this list." });
  }
  const pairs = ids.map((id, i) => Prisma.sql`(${id}::text, ${i}::integer)`);
  await tx.$executeRaw`
    UPDATE "Todo" AS t
    SET "position" = d.new_position
    FROM (VALUES ${Prisma.join(pairs, ",")}) AS d(id, new_position)
    WHERE t.id = d.id
  `;
}
```

Replace the function body with:
```ts
export async function reorderTodos(
  tx: Prisma.TransactionClient,
  viewerId: string,
  todoListId: string,
  ids: string[],
  options: { channel?: ChannelProvider } = {},
) {
  const provider = options.channel ?? defaultProvider;
  const allowed = await canReadList(tx, viewerId, todoListId);
  if (!allowed) {
    throw new TRPCError({ code: "FORBIDDEN", message: "You do not have access to this list." });
  }
  const pairs = ids.map((id, i) => Prisma.sql`(${id}::text, ${i}::integer)`);
  await tx.$executeRaw`
    UPDATE "Todo" AS t
    SET "position" = d.new_position
    FROM (VALUES ${Prisma.join(pairs, ",")}) AS d(id, new_position)
    WHERE t.id = d.id
  `;
  await provider(listChannelKey(todoListId)).publish({
    kind: "todos-reordered",
    listId: todoListId,
    positions: ids.map((id, i) => ({ id, position: i })),
  });
}
```

- [ ] **Step 4: Wire `importTodosFromCSV`**

Current body ends with the `tx.todo.createMany(...)` call returning a count object:
```ts
  await tx.todo.createMany({
    data: titles.map((title, i) => ({
      title,
      userId: creatorId,
      todoListId,
      position: i,
    })),
  });
  return { count: titles.length };
```

Replace with:
```ts
  const createdRows = await tx.todo.createManyAndReturn({
    data: titles.map((title, i) => ({
      title,
      userId: creatorId,
      todoListId,
      position: i,
    })),
    include: { todoList: true },
  });
  await provider(listChannelKey(todoListId)).publish({
    kind: "todos-imported",
    listId: todoListId,
    todos: createdRows,
  });
  return { count: titles.length };
```

Also add `options` parameter to the signature:
```ts
export async function importTodosFromCSV(
  tx: Prisma.TransactionClient,
  creatorId: string,
  csvData: Buffer,
  todoListId: string,
  options: { channel?: ChannelProvider } = {},
): Promise<{ count: number }> {
  const provider = options.channel ?? defaultProvider;
  // ... rest of existing body, ending with the replacement above.
```

Note: `createManyAndReturn` is a Prisma 5+ API that returns the inserted rows. If this codebase's Prisma version doesn't support it, fall back to:
```ts
  await tx.todo.createMany({ data: [...] });
  const createdRows = await tx.todo.findMany({
    where: { todoListId, title: { in: titles }, userId: creatorId },
    orderBy: { position: "asc" },
    take: titles.length,
    include: { todoList: true },
  });
```
(The `take` + order matches the just-inserted rows as long as this runs inside the same `$transaction` and no other inserts raced — safe given row locking.)

- [ ] **Step 5: Update routers to pass channel through (if needed)**

Check the router at `packages/api/src/domains/todo-list/todo-router.ts` — it wraps each service call in `$transaction`. Typical pattern:
```ts
ctx.db.$transaction((tx) => createTodo(tx, ctx.session.user.id, input.title, input.todoListId))
```

Since `options.channel` defaults to the Redis provider, routers need no changes. Tests inject the channel; production uses the default.

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @project/api exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Run existing tests to make sure nothing regressed**

Run: `pnpm --filter @project/api test todo-service.test`
Expected: all existing tests PASS. The new publishers don't break existing behavior (they run inside the existing `$transaction` and existing tests don't inject a channel, so they hit the default Redis provider — which MAY fail in unit tests if Redis isn't running).

If existing tests fail because the default provider tries to connect to Redis: test environment already includes Redis (see `docker-compose.yml` + `scripts/test-db.ts`). Confirm `REDIS_URL` is set. If tests still fail due to publish errors, the workaround is the new tests inject a `MemoryChannelFactory` — but that's task 1.4.

Actually, simpler: the existing `completeTodo` test already injects a `MemoryChannelFactory` for the `published.toEqual([...])` assertion — the other existing tests don't care about events. They call the service without `options`, which means the default Redis provider is hit. In the test environment the publish CAN succeed (Redis is up) but it's noise.

Acceptable. Move on.

- [ ] **Step 8: Commit**

```bash
git add packages/api/src/domains/todo-list/todo-service.ts
git commit -m "$(cat <<'EOF'
feat(api): wire payload publishers in 4 todo mutations

createTodo, deleteTodo, reorderTodos, importTodosFromCSV now fan out
realtime events to collaborator clients. Previously only completeTodo
published — half-shipped collaborator fan-out (handover §43).

Each function follows the completeTodo pattern:
- options: { channel?: ChannelProvider } parameter (defaults to Redis)
- publish inside the $transaction after the last DB write
- payload includes the todoList relation (matches client cache shape)

reorderTodos constructs the positions map from its input ids array
(positions 0..N-1 match today's dense server behavior).

importTodosFromCSV uses createManyAndReturn so the inserted rows'
todoList relation is available for the payload without a separate
query.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 1.4: Add 4 new backend publish-assertion tests

**Files:**
- Modify: `packages/api/src/domains/todo-list/__tests__/todo-service.test.ts`

Add tests for the 4 new publishers, mirroring the existing `completeTodo publishes` test's pattern (`MemoryChannelFactory` injection, `published.push`).

- [ ] **Step 1: Write failing test — `createTodo publishes todo-created`**

Append to the `describe("todo CRUD by collaborators", ...)` block (after the existing `completeTodo publishes` test):

```ts
it("createTodo publishes todo-created with the full created row including todoList", async () => {
  const factory = new MemoryChannelFactory();
  const published: TodoListEvent[] = [];
  const unsub = await factory
    .channel<TodoListEvent>(listChannelKey(sharedListId))
    .subscribe((e) => {
      published.push(e);
    });
  const created = await db.$transaction((tx) =>
    createTodo(tx, COLLAB_ID, "Bob's bread", sharedListId, {
      channel: (k) => factory.channel(k),
    }),
  );
  unsub();
  await factory.closeAll();

  expect(published.length).toBe(1);
  const ev = published[0];
  expect(ev?.kind).toBe("todo-created");
  expect(ev?.kind === "todo-created" && ev.listId).toBe(sharedListId);
  expect(ev?.kind === "todo-created" && ev.todo.id).toBe(created.id);
  expect(ev?.kind === "todo-created" && ev.todo.title).toBe("Bob's bread");
  expect(ev?.kind === "todo-created" && ev.todo.todoList?.id).toBe(sharedListId);
});
```

- [ ] **Step 2: Run test — verify it fails first**

Run: `pnpm --filter @project/api test todo-service.test --grep "createTodo publishes"`
If task 1.3 is already committed, this test should PASS (the publisher is wired). If so, note it and move on.

If it fails with "expected 1, got 0": the publisher isn't firing — verify channel injection works.

- [ ] **Step 3: Add `deleteTodo publishes todo-deleted`**

Append:
```ts
it("deleteTodo publishes todo-deleted with the deleted id", async () => {
  const ownerTodo = await db.todo.create({
    data: {
      title: "Doomed",
      userId: OWNER_ID,
      todoListId: sharedListId,
      position: 0,
    },
  });
  const factory = new MemoryChannelFactory();
  const published: TodoListEvent[] = [];
  const unsub = await factory
    .channel<TodoListEvent>(listChannelKey(sharedListId))
    .subscribe((e) => {
      published.push(e);
    });
  await db.$transaction((tx) =>
    deleteTodo(tx, COLLAB_ID, ownerTodo.id, {
      channel: (k) => factory.channel(k),
    }),
  );
  unsub();
  await factory.closeAll();

  expect(published).toEqual([
    { kind: "todo-deleted", listId: sharedListId, todoId: ownerTodo.id },
  ]);
});
```

- [ ] **Step 4: Add `reorderTodos publishes todos-reordered`**

Append:
```ts
it("reorderTodos publishes todos-reordered with the full positions map", async () => {
  const first = await db.todo.create({
    data: { title: "F", userId: OWNER_ID, todoListId: sharedListId, position: 0 },
  });
  const second = await db.todo.create({
    data: { title: "S", userId: OWNER_ID, todoListId: sharedListId, position: 1 },
  });
  const factory = new MemoryChannelFactory();
  const published: TodoListEvent[] = [];
  const unsub = await factory
    .channel<TodoListEvent>(listChannelKey(sharedListId))
    .subscribe((e) => {
      published.push(e);
    });
  await db.$transaction((tx) =>
    reorderTodos(tx, COLLAB_ID, sharedListId, [second.id, first.id], {
      channel: (k) => factory.channel(k),
    }),
  );
  unsub();
  await factory.closeAll();

  expect(published).toEqual([
    {
      kind: "todos-reordered",
      listId: sharedListId,
      positions: [
        { id: second.id, position: 0 },
        { id: first.id, position: 1 },
      ],
    },
  ]);
});
```

- [ ] **Step 5: Add `importTodosFromCSV publishes todos-imported`**

Append:
```ts
it("importTodosFromCSV publishes todos-imported with each imported row including todoList", async () => {
  const csv = Buffer.from("title\nRow A\nRow B\n", "utf-8");
  const factory = new MemoryChannelFactory();
  const published: TodoListEvent[] = [];
  const unsub = await factory
    .channel<TodoListEvent>(listChannelKey(sharedListId))
    .subscribe((e) => {
      published.push(e);
    });
  const result = await db.$transaction((tx) =>
    importTodosFromCSV(tx, COLLAB_ID, csv, sharedListId, {
      channel: (k) => factory.channel(k),
    }),
  );
  unsub();
  await factory.closeAll();

  expect(result.count).toBe(2);
  expect(published.length).toBe(1);
  const ev = published[0];
  expect(ev?.kind).toBe("todos-imported");
  expect(ev?.kind === "todos-imported" && ev.listId).toBe(sharedListId);
  expect(ev?.kind === "todos-imported" && ev.todos.length).toBe(2);
  expect(
    ev?.kind === "todos-imported" && ev.todos.map((t) => t.title).sort(),
  ).toEqual(["Row A", "Row B"]);
  expect(
    ev?.kind === "todos-imported" && ev.todos.every((t) => t.todoList?.id === sharedListId),
  ).toBe(true);
});
```

- [ ] **Step 6: Run all 4 new tests**

Run: `pnpm --filter @project/api test todo-service.test`
Expected: all PASS, including the 4 new + existing completeTodo + all pre-existing tests.

If any new test fails on "received 0 published": verify the publisher in task 1.3 was committed.

If import test fails on `createManyAndReturn`: fall back to the findMany approach from task 1.3 step 4. Re-run.

- [ ] **Step 7: Commit**

```bash
git add packages/api/src/domains/todo-list/__tests__/todo-service.test.ts
git commit -m "$(cat <<'EOF'
test(api): publish-assertion tests for 4 new todo-service publishers

Mirrors the existing completeTodo publish test pattern
(MemoryChannelFactory injection, published.push, toEqual assertion).

Four new tests:
- createTodo publishes todo-created with full TodoWithList
- deleteTodo publishes todo-deleted with deleted id
- reorderTodos publishes todos-reordered with positions map
- importTodosFromCSV publishes todos-imported with full rows

Each asserts the todoList relation on the payload where applicable.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 1.5: Create event-handlers.ts with typed handler map

**Files:**
- Create: `apps/web/src/features/todo-list/event-handlers.ts`

- [ ] **Step 1: Write the handler-map file**

Create `apps/web/src/features/todo-list/event-handlers.ts`:

```ts
// Per-kind realtime-event handler map. Each handler applies a cache patch
// (or invalidation) in response to a TodoListEvent.
//
// Payload-shaped kinds (todo-*, todos-*) use setQueryData — no refetch on
// the hot path. Notification-shaped kinds (todo-list-*) use invalidateQueries.

import type {
  TodoListEvent,
  TodoListEventKind,
  TodoWithList,
} from "@project/api/domains/todo-list/events";
import type { AppRouter } from "@project/api/router";
import type { QueryClient } from "@tanstack/react-query";
import type { TRPCOptionsProxy } from "@trpc/tanstack-react-query";

type Handler<K extends TodoListEventKind> = (
  trpc: TRPCOptionsProxy<AppRouter>,
  qc: QueryClient,
  event: Extract<TodoListEvent, { kind: K }>,
) => void;

// Re-sort to match the server's `orderBy: [{ completed: "asc" }, { position: "asc" }]`.
// The cache stores a pre-sorted array; consumers (use-todos.ts) filter by
// `completed` and rely on array order for display. Any patch that changes
// completed-status or position MUST re-sort, or the UI stays in the
// pre-patch order until the next refetch.
function sortTodos(arr: TodoWithList[]): TodoWithList[] {
  return [...arr].sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    return a.position - b.position;
  });
}

export const eventHandlers: { [K in TodoListEventKind]: Handler<K> } = {
  "todo-created": (trpc, qc, ev) => {
    qc.setQueryData<TodoWithList[]>(
      trpc.todo.list.queryFilter({ todoListId: ev.listId }).queryKey,
      (old) => (old ? sortTodos([...old, ev.todo]) : old),
    );
  },
  "todo-updated": (trpc, qc, ev) => {
    qc.setQueryData<TodoWithList[]>(
      trpc.todo.list.queryFilter({ todoListId: ev.listId }).queryKey,
      (old) =>
        old ? sortTodos(old.map((t) => (t.id === ev.todo.id ? ev.todo : t))) : old,
    );
  },
  "todo-deleted": (trpc, qc, ev) => {
    qc.setQueryData<TodoWithList[]>(
      trpc.todo.list.queryFilter({ todoListId: ev.listId }).queryKey,
      (old) => old?.filter((t) => t.id !== ev.todoId),
    );
  },
  "todos-reordered": (trpc, qc, ev) => {
    const byId = new Map(ev.positions.map((p) => [p.id, p.position]));
    qc.setQueryData<TodoWithList[]>(
      trpc.todo.list.queryFilter({ todoListId: ev.listId }).queryKey,
      (old) => {
        if (!old) return old;
        const patched = old.map((t) =>
          byId.has(t.id) ? { ...t, position: byId.get(t.id) ?? t.position } : t,
        );
        return sortTodos(patched);
      },
    );
  },
  "todos-imported": (trpc, qc, ev) => {
    // Server semantics (importTodosFromCSV): existing active rows get
    // position += N, imported rows occupy positions [0..N). Mirror that
    // in the cache: prepend imported rows, shift existing active rows'
    // positions, then resort. Without this shift, a refetch shows imports
    // at the TOP and the cache-patched view shows them at the BOTTOM —
    // visible UX drift.
    const n = ev.todos.length;
    qc.setQueryData<TodoWithList[]>(
      trpc.todo.list.queryFilter({ todoListId: ev.listId }).queryKey,
      (old) => {
        if (!old) return old;
        const shifted = old.map((t) =>
          t.completed ? t : { ...t, position: t.position + n },
        );
        return sortTodos([...ev.todos, ...shifted]);
      },
    );
  },
  "todo-list-updated": (trpc, qc, ev) => {
    qc.invalidateQueries(trpc.todoList.get.queryFilter({ id: ev.listId }));
    qc.invalidateQueries(trpc.todoList.listAccessible.queryFilter());
  },
  "todo-list-collaborator-added": (trpc, qc, ev) => {
    qc.invalidateQueries(trpc.todoList.collaborators.queryFilter({ listId: ev.listId }));
  },
  "todo-list-collaborator-removed": (trpc, qc, ev) => {
    qc.invalidateQueries(trpc.todoList.collaborators.queryFilter({ listId: ev.listId }));
    qc.invalidateQueries(trpc.todoList.listAccessible.queryFilter());
  },
};
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter web exec tsc --noEmit`
Expected: PASS. If fail:
- "Property 'queryFilter' does not exist" → check that tRPC v11 + `@trpc/tanstack-react-query` is the version in use. This file imports types that rely on `.queryFilter()` being on the trpc proxy.
- Collaborators / listAccessible query keys missing → verify the todoList router has procedures named `get`, `collaborators`, `listAccessible`.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/features/todo-list/event-handlers.ts
git commit -m "$(cat <<'EOF'
feat(web): per-kind TodoListEvent handler map

Payload-shaped kinds (todo-*, todos-*) patch the React Query cache via
setQueryData — no refetch on the hot path. Notification-shaped list-level
kinds invalidate targeted queries.

sortTodos helper mirrors the server's orderBy after every mutating patch
so the cache stays in the same order a refetch would produce.

todos-imported handler mirrors the server's prepend-with-shift semantics
from importTodosFromCSV (existing active rows += N, imports at [0..N)).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 1.6: Defer handler unit tests — rationale

**Files:** none (documentation-only)

The original plan called for `apps/web/src/features/todo-list/__tests__/event-handlers.test.ts` unit tests. Blocker discovered during plan review: `apps/web` has no test runner configured (no `vitest` dep, no `"test"` script in `apps/web/package.json`, and `Makefile`'s `test-unit` target runs only `pnpm --filter @project/api test`).

**Decision: defer the unit tests.** Coverage in this plan comes from:
- **Backend publish-assertion tests** (Task 1.4) — verify every event kind is emitted with the correct payload shape.
- **BDD scenarios** (Task 1.8) — exercise the full push path end-to-end: create, delete, import, cold-cache peer.
- **TypeScript** — the `Extract<TodoListEvent, {kind: K}>` handler signature gives compile-time shape safety; a publisher emitting a malformed payload fails `make lint`.

The handlers are pure functions over `(trpc, QueryClient, event)` with no branching beyond the `setQueryData` / `invalidateQueries` split. BDD exercises each handler end-to-end for the 5 payload kinds; the 3 notification kinds already have existing BDD coverage (invite-accept, collaborator-removed). The unit-test layer would add regression safety for fine-grained cache shape, but isn't blocking correctness.

**Added to Follow-up work (handover doc):** "Set up vitest (or bun test with `@types/bun`) in `apps/web`; port the handler unit-test file sketched in the spec at `/apps/web/src/features/todo-list/__tests__/event-handlers.test.ts`; wire into `make test-unit`."

- [ ] **Step 1: Confirm the deferral is documented in the handover**

When Task 1.10 Step 6 writes the handover doc, ensure the "Deferred follow-ups" section includes the vitest-setup + handler-unit-tests item. No action required this task beyond this commitment.

--- REMOVED — handler unit tests deferred to follow-up work. Proceed to Task 1.7.

<!-- stale template below left as reference for the future FU ticket. do not execute. -->

<details>
<summary>Future-FU test sketch (do NOT run as part of this plan)</summary>

```ts
import type { TodoWithList } from "@project/api/domains/todo-list/events";
import type { AppRouter } from "@project/api/router";
import { QueryClient } from "@tanstack/react-query";
import type { TRPCOptionsProxy } from "@trpc/tanstack-react-query";
import { createTRPCOptionsProxy } from "@trpc/tanstack-react-query";
import { describe, expect, it } from "vitest";
import { eventHandlers } from "../event-handlers";

// Minimal trpc proxy for queryKey construction. We don't need a real
// tRPC client — setQueryData / getQueryData only care about the queryKey,
// and createTRPCOptionsProxy with a no-op client is sufficient.
function makeTrpc(): TRPCOptionsProxy<AppRouter> {
  return createTRPCOptionsProxy<AppRouter>({
    queryClient: new QueryClient(),
    // biome-ignore lint/suspicious/noExplicitAny: stub client for key computation only
    client: {} as any,
  });
}

function todo(
  id: string,
  overrides: Partial<TodoWithList> = {},
): TodoWithList {
  return {
    id,
    title: `todo-${id}`,
    completed: false,
    position: 0,
    userId: "u1",
    todoListId: "L1",
    createdAt: new Date(0),
    updatedAt: new Date(0),
    todoList: {
      id: "L1",
      name: "List 1",
      userId: "u1",
      color: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    },
    ...overrides,
  };
}

function seed(qc: QueryClient, trpc: TRPCOptionsProxy<AppRouter>, rows: TodoWithList[]) {
  qc.setQueryData(
    trpc.todo.list.queryFilter({ todoListId: "L1" }).queryKey,
    rows,
  );
}

function read(qc: QueryClient, trpc: TRPCOptionsProxy<AppRouter>): TodoWithList[] | undefined {
  return qc.getQueryData(trpc.todo.list.queryFilter({ todoListId: "L1" }).queryKey);
}

describe("eventHandlers.todo-created", () => {
  it("appends the created row and resorts", () => {
    const qc = new QueryClient();
    const trpc = makeTrpc();
    seed(qc, trpc, [todo("A", { position: 0 })]);

    eventHandlers["todo-created"](trpc, qc, {
      kind: "todo-created",
      listId: "L1",
      todo: todo("B", { position: 0 }), // server assigns 0; existing A was shifted to 1 by server
    });

    const after = read(qc, trpc);
    expect(after).toBeDefined();
    // Both at position 0 (pre-shift cache + new row at 0). Tie broken by stable sort = insertion order.
    // Test just confirms the new row is present and array is sorted by (completed, position).
    expect(after?.map((t) => t.id)).toContain("B");
    expect(after?.length).toBe(2);
  });

  it("is a no-op when cache is cold", () => {
    const qc = new QueryClient();
    const trpc = makeTrpc();
    // No seed.

    eventHandlers["todo-created"](trpc, qc, {
      kind: "todo-created",
      listId: "L1",
      todo: todo("B"),
    });

    expect(read(qc, trpc)).toBeUndefined();
  });
});

describe("eventHandlers.todo-updated", () => {
  it("replaces the row and resorts", () => {
    const qc = new QueryClient();
    const trpc = makeTrpc();
    seed(qc, trpc, [
      todo("A", { completed: false, position: 0 }),
      todo("B", { completed: false, position: 1 }),
    ]);

    eventHandlers["todo-updated"](trpc, qc, {
      kind: "todo-updated",
      listId: "L1",
      todo: todo("A", { completed: true, position: 1 }),
    });

    const after = read(qc, trpc);
    // A is now completed → sorts after B.
    expect(after?.map((t) => t.id)).toEqual(["B", "A"]);
  });
});

describe("eventHandlers.todo-deleted", () => {
  it("filters the row out", () => {
    const qc = new QueryClient();
    const trpc = makeTrpc();
    seed(qc, trpc, [todo("A"), todo("B"), todo("C")]);

    eventHandlers["todo-deleted"](trpc, qc, {
      kind: "todo-deleted",
      listId: "L1",
      todoId: "B",
    });

    const after = read(qc, trpc);
    expect(after?.map((t) => t.id)).toEqual(["A", "C"]);
  });

  it("is a no-op when cache is cold", () => {
    const qc = new QueryClient();
    const trpc = makeTrpc();
    eventHandlers["todo-deleted"](trpc, qc, {
      kind: "todo-deleted",
      listId: "L1",
      todoId: "X",
    });
    expect(read(qc, trpc)).toBeUndefined();
  });
});

describe("eventHandlers.todos-reordered", () => {
  it("remaps positions and resorts", () => {
    const qc = new QueryClient();
    const trpc = makeTrpc();
    seed(qc, trpc, [
      todo("A", { position: 0 }),
      todo("B", { position: 1 }),
      todo("C", { position: 2 }),
    ]);

    eventHandlers["todos-reordered"](trpc, qc, {
      kind: "todos-reordered",
      listId: "L1",
      positions: [
        { id: "C", position: 0 },
        { id: "A", position: 1 },
        { id: "B", position: 2 },
      ],
    });

    const after = read(qc, trpc);
    expect(after?.map((t) => t.id)).toEqual(["C", "A", "B"]);
  });
});

describe("eventHandlers.todos-imported", () => {
  it("prepends imports and shifts existing active rows", () => {
    const qc = new QueryClient();
    const trpc = makeTrpc();
    seed(qc, trpc, [
      todo("E1", { completed: false, position: 0, title: "Existing" }),
      todo("D1", { completed: true, position: 0, title: "Done" }),
    ]);

    eventHandlers["todos-imported"](trpc, qc, {
      kind: "todos-imported",
      listId: "L1",
      todos: [
        todo("I1", { position: 0, title: "Imported 1" }),
        todo("I2", { position: 1, title: "Imported 2" }),
      ],
    });

    const after = read(qc, trpc);
    // Imports at positions 0,1; existing E1 shifted to 2. Completed D1 unchanged, sorts last.
    expect(after?.map((t) => t.id)).toEqual(["I1", "I2", "E1", "D1"]);
    expect(after?.find((t) => t.id === "E1")?.position).toBe(2);
  });
});

describe("eventHandlers.todo-list-updated (notification)", () => {
  it("invalidates listAccessible and the specific get query", () => {
    const qc = new QueryClient();
    const trpc = makeTrpc();
    // Seed queries in 'fresh' state; invalidation marks them stale.
    qc.setQueryData(trpc.todoList.listAccessible.queryFilter().queryKey, []);
    qc.setQueryData(trpc.todoList.get.queryFilter({ id: "L1" }).queryKey, null);

    eventHandlers["todo-list-updated"](trpc, qc, {
      kind: "todo-list-updated",
      listId: "L1",
    });

    // Both queries should now be marked stale.
    const stateA = qc.getQueryState(trpc.todoList.listAccessible.queryFilter().queryKey);
    const stateB = qc.getQueryState(trpc.todoList.get.queryFilter({ id: "L1" }).queryKey);
    expect(stateA?.isInvalidated).toBe(true);
    expect(stateB?.isInvalidated).toBe(true);
  });
});

describe("eventHandlers.todo-list-collaborator-added (notification)", () => {
  it("invalidates the collaborators query", () => {
    const qc = new QueryClient();
    const trpc = makeTrpc();
    qc.setQueryData(trpc.todoList.collaborators.queryFilter({ listId: "L1" }).queryKey, []);

    eventHandlers["todo-list-collaborator-added"](trpc, qc, {
      kind: "todo-list-collaborator-added",
      listId: "L1",
      userId: "u2",
    });

    const state = qc.getQueryState(trpc.todoList.collaborators.queryFilter({ listId: "L1" }).queryKey);
    expect(state?.isInvalidated).toBe(true);
  });
});

describe("eventHandlers.todo-list-collaborator-removed (notification)", () => {
  it("invalidates collaborators and listAccessible", () => {
    const qc = new QueryClient();
    const trpc = makeTrpc();
    qc.setQueryData(trpc.todoList.collaborators.queryFilter({ listId: "L1" }).queryKey, []);
    qc.setQueryData(trpc.todoList.listAccessible.queryFilter().queryKey, []);

    eventHandlers["todo-list-collaborator-removed"](trpc, qc, {
      kind: "todo-list-collaborator-removed",
      listId: "L1",
      userId: "u2",
    });

    const s1 = qc.getQueryState(trpc.todoList.collaborators.queryFilter({ listId: "L1" }).queryKey);
    const s2 = qc.getQueryState(trpc.todoList.listAccessible.queryFilter().queryKey);
    expect(s1?.isInvalidated).toBe(true);
    expect(s2?.isInvalidated).toBe(true);
  });
});
```

```

</details>

Nothing to commit this task. Proceed to Task 1.7.

---

### Task 1.7: Refactor use-todo-list-live-updates.ts to use the handler map

**Files:**
- Modify: `apps/web/src/features/todo-list/use-todo-list-live-updates.ts`

Replace the inline `applyEvent` function with a call into `eventHandlers[event.kind]`. Keep the leader-tab + BroadcastChannel relay plumbing unchanged.

- [ ] **Step 1: Read current file**

Run: `cat apps/web/src/features/todo-list/use-todo-list-live-updates.ts`

- [ ] **Step 2: Rewrite the file**

Replace the entire content of `apps/web/src/features/todo-list/use-todo-list-live-updates.ts`:

```ts
// Subscribes to a list's realtime events. Leader tab opens the WS; peers
// receive events via BroadcastChannel relay.

import type {
  TodoListEvent,
  TodoListEventKind,
} from "@project/api/domains/todo-list/events";
import { TODO_LIST_EVENT_KINDS } from "@project/api/domains/todo-list/events";
import type { AppRouter } from "@project/api/router";
import { useQueryClient } from "@tanstack/react-query";
import type { TRPCOptionsProxy } from "@trpc/tanstack-react-query";
import { useSubscription } from "@trpc/tanstack-react-query";
import { useEffect } from "react";
import { eventHandlers } from "./event-handlers.js";
import { useLeaderTab } from "./use-leader-tab.js";

export function useTodoListLiveUpdates(
  trpc: TRPCOptionsProxy<AppRouter>,
  listId: string | null,
  userId: string | null,
) {
  const queryClient = useQueryClient();
  const { isLeader, broadcast, onMessage } = useLeaderTab(userId);

  // Leader path: subscribe to the tRPC WS, relay to peers, apply locally.
  useSubscription(
    trpc.todoList.onListEvent.subscriptionOptions(
      { listId: listId ?? "" },
      {
        enabled: isLeader && listId !== null,
        onData: (event: TodoListEvent) => {
          broadcast({ __relay: true, event });
          dispatchEvent(trpc, queryClient, event);
        },
      },
    ),
  );

  // Peer path: listen for relayed events.
  useEffect(() => {
    return onMessage((data) => {
      if (isTodoListRelay(data)) {
        dispatchEvent(trpc, queryClient, data.event);
      }
    });
  }, [trpc, queryClient, onMessage]);
}

// Dispatch by kind to the typed handler map. The `event as never` cast is
// necessary because TS cannot narrow `event` across the index lookup —
// each handler expects its narrow Extract<TodoListEvent, {kind: K}> type,
// not the full union. Do NOT change to `event as TodoListEvent` — that
// widens the arg and breaks the narrow handler signatures.
function dispatchEvent(
  trpc: TRPCOptionsProxy<AppRouter>,
  qc: ReturnType<typeof useQueryClient>,
  event: TodoListEvent,
): void {
  eventHandlers[event.kind](trpc, qc, event as never);
}

// Kind-only validation — BroadcastChannel is same-origin trusted, so payload
// shape is not validated here. The leader tab publishes the exact shape it
// received from the server (type-narrowed). A malformed relay implies a
// same-origin logic bug, not hostile input.
function isTodoListRelay(
  d: unknown,
): d is { __relay: true; event: TodoListEvent } {
  if (!d || typeof d !== "object") return false;
  const rec = d as Record<string, unknown>;
  if (rec.__relay !== true) return false;
  const ev = rec.event as { kind?: unknown } | undefined;
  if (!ev || typeof ev.kind !== "string") return false;
  return (TODO_LIST_EVENT_KINDS as readonly string[]).includes(
    ev.kind as TodoListEventKind,
  );
}
```

Note the changes:
- `applyEvent` (broad 4-invalidate) is gone.
- `dispatchEvent` delegates to the handler map with the correct `as never` cast.
- `isTodoListRelay` imports `TODO_LIST_EVENT_KINDS` from events.ts (SSOT).
- Trust-boundary comment added at the guard site.

- [ ] **Step 3: Typecheck + lint**

Run: `pnpm --filter web exec tsc --noEmit`
Expected: PASS.

Run: `make lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/features/todo-list/use-todo-list-live-updates.ts
git commit -m "$(cat <<'EOF'
refactor(web): delegate TodoListEvent dispatch to handler map

Replace inline applyEvent (broad 4-query invalidate) with a typed
dispatch via eventHandlers[event.kind]. The relay type-guard now
imports TODO_LIST_EVENT_KINDS from events.ts (SSOT) instead of a
hand-duplicated array.

Payload-shaped events (todo-*) now patch the cache via setQueryData
on the hot path; notification-shaped events (todo-list-*) retain
the invalidate-and-refetch pattern.

Same-origin trust-boundary comment added at the guard site per
spec §"BroadcastChannel trust boundary".

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 1.8: Write BDD step definitions for new realtime scenarios

**Files:**
- Create: `e2e/features/todo-list/collaborator-realtime-todos.feature`
- Create: `e2e/steps/todo-list/collaborator-realtime-todos.ts`

Four scenarios — create, delete, CSV import, cold-cache peer. Gherkin uses the existing declarative actor-scoped phrasings from `e2e/steps/todo-list/collaborators.ts`; the new step file adds only the missing multi-actor verbs (create/delete/import/positional-assertion) and imports actor helpers from `collaborators.ts` (exported in Task 1.1).

**Existing phrasings reused from `collaborators.ts`** (verified via grep):
- `{string} is signed up and signed in as {string} with email {string}`
- `{string} has a list named {string}`
- `{string} is a collaborator on {string}`
- `{string} has a todo {string}`
- `{string} has {string} open in a browser`
- `{string} sees {string} within {int} second(s)`

**New phrasings** added in `collaborator-realtime-todos.ts`:
- `{string} creates the todo {string}` — actor-scoped create via placeholder-fill + Add button (mirrors `todos.ts` line 14–20 but actor-parameterized).
- `{string} deletes the todo {string}` — actor-scoped delete.
- `{string} imports a CSV with titles {string}` — builds CSV inline from comma-separated list, uploads via file input.
- `{string} does not see {string} within {int} second(s)` — negative-visibility assertion.
- `{string} opens {string}` — navigates an already-spawned actor to a named list (resolved via `listIdByName`).
- `{string} has the todo lists index open in a browser` — navigates to `/todo-lists` (peer setup for cold-cache scenario).
- `{string} appears before {string} for {string}` — actor-scoped DOM-order assertion.

- [ ] **Step 1: Verify UI selectors exist or add `data-testid` attributes**

New step-def code uses three stable selectors. Current codebase uses role-based + CSS `li` selectors only (per `todos.ts`). Add:

1. **`data-testid="todo-row"`** to `apps/web/src/features/todo-list/sortable-todo-item.tsx` (after Phase 0 rename; formerly `features/todo/sortable-todo-item.tsx`). Target: the outermost `<li>` element.
2. **`data-testid="todo-row"`** to `apps/web/src/features/todo-list/completed-todo-item.tsx` — same attribute on the `<li>`.
3. **`data-testid="todo-lists-index"`** to `apps/web/src/routes/_authenticated/todo-lists/index.tsx` — on the `<main>` container.

`todo-list-detail` is NOT required — the existing `{string} has {string} open in a browser` step already waits for the list content implicitly via `resolveListIdFor` + `page.goto`.

Run: `rg 'data-testid' apps/web/src/features/todo-list/ apps/web/src/routes/_authenticated/todo-lists/`
Expected after edits: 3+ matches (may be more if existing components already have them).

- [ ] **Step 2: Write the feature file**

Create `e2e/features/todo-list/collaborator-realtime-todos.feature`:

```gherkin
Feature: Realtime todo sync across collaborators

  Payload-shaped events push todo CRUD to peer tabs. Receiving tab patches
  cache via setQueryData — no refetch on the hot path. Tolerance is 3s
  (handover §24 — the realistic floor given WS round-trip + React Query
  retry backoff).

  Scenario: Alice creates a todo, Bob sees it in real time
    Given "alice" is signed up and signed in as "alice-rt-create" with email "alice-rt-create@example.com"
    And "bob" is signed up and signed in as "bob-rt-create" with email "bob-rt-create@example.com"
    And "alice" has a list named "Groceries"
    And "bob" is a collaborator on "Groceries"
    And "alice" has "Groceries" open in a browser
    And "bob" has "Groceries" open in a browser
    When "alice" creates the todo "Milk"
    Then "bob" sees "Milk" within 3 seconds

  Scenario: Alice deletes a todo, Bob sees it disappear in real time
    Given "alice" is signed up and signed in as "alice-rt-delete" with email "alice-rt-delete@example.com"
    And "bob" is signed up and signed in as "bob-rt-delete" with email "bob-rt-delete@example.com"
    And "alice" has a list named "Groceries"
    And "bob" is a collaborator on "Groceries"
    And "alice" has a todo "Milk"
    And "alice" has "Groceries" open in a browser
    And "bob" has "Groceries" open in a browser
    When "alice" deletes the todo "Milk"
    Then "bob" does not see "Milk" within 3 seconds

  Scenario: Alice imports todos from CSV, Bob sees them at the top in real time
    Given "alice" is signed up and signed in as "alice-rt-import" with email "alice-rt-import@example.com"
    And "bob" is signed up and signed in as "bob-rt-import" with email "bob-rt-import@example.com"
    And "alice" has a list named "Groceries"
    And "bob" is a collaborator on "Groceries"
    And "alice" has a todo "Existing item"
    And "alice" has "Groceries" open in a browser
    And "bob" has "Groceries" open in a browser
    When "alice" imports a CSV with titles "Bread,Cheese,Eggs"
    Then "bob" sees "Bread" within 3 seconds
    And "Bread" appears before "Existing item" for "bob"

  Scenario: Bob on index page sees Alice's new todo on first navigation
    Given "alice" is signed up and signed in as "alice-rt-cold" with email "alice-rt-cold@example.com"
    And "bob" is signed up and signed in as "bob-rt-cold" with email "bob-rt-cold@example.com"
    And "alice" has a list named "Groceries"
    And "bob" is a collaborator on "Groceries"
    And "alice" has "Groceries" open in a browser
    And "bob" has the todo lists index open in a browser
    When "alice" creates the todo "Milk"
    And "bob" opens "Groceries"
    Then "bob" sees "Milk" within 3 seconds
```

Emails are scenario-scoped (handover §37). The `check-feature-emails` guard enforces uniqueness — four distinct emails per actor × 4 scenarios = 8 emails total in this feature.

- [ ] **Step 3: Write the step-definitions file**

Create `e2e/steps/todo-list/collaborator-realtime-todos.ts`:

```ts
import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import {
  getActor,
  listIdByName,
  resolveListIdFor,
} from "./collaborators.ts";

const { Given, When, Then } = createBdd();

// --- When: actor-scoped mutations ---

When(
  "{string} creates the todo {string}",
  async ({}, actorName: string, title: string) => {
    const actor = getActor(actorName);
    await actor.page.getByPlaceholder("Add a todo...").fill(title);
    await actor.page.getByRole("button", { name: "Add" }).click();
    // Wait for the actor's own optimistic UI to reflect the new row
    // before proceeding — prevents test-ordering flakes where the
    // next step runs before Alice's add mutation round-trips.
    await expect(
      actor.page.locator("li", { hasText: title }).first(),
    ).toBeVisible({ timeout: 5000 });
  },
);

When(
  "{string} deletes the todo {string}",
  async ({}, actorName: string, title: string) => {
    const actor = getActor(actorName);
    const row = actor.page.locator("li", { hasText: title });
    await row.getByRole("button", { name: "Delete" }).click();
    await row.waitFor({ state: "detached", timeout: 5000 });
  },
);

When(
  "{string} imports a CSV with titles {string}",
  async ({}, actorName: string, csvTitles: string) => {
    const actor = getActor(actorName);
    const rows = csvTitles.split(",").map((t) => t.trim());
    const csv = `title\n${rows.join("\n")}\n`;
    const input = actor.page.locator('input[type="file"]');
    await input.setInputFiles({
      name: "import.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv, "utf-8"),
    });
    await actor.page.waitForLoadState("networkidle");
  },
);

// --- Given: actor-scoped navigation ---

Given(
  "{string} has the todo lists index open in a browser",
  async ({}, actorName: string) => {
    const actor = getActor(actorName);
    await actor.page.goto("/todo-lists");
    await actor.page.waitForURL("**/todo-lists");
    await actor.page.waitForSelector('[data-testid="todo-lists-index"]');
  },
);

When(
  "{string} opens {string}",
  async ({}, actorName: string, listName: string) => {
    const actor = getActor(actorName);
    const id = listIdByName.get(listName) ?? (await resolveListIdFor(actor, listName));
    await actor.page.goto(`/todo-lists/${id}`);
    await actor.page.waitForURL(`**/todo-lists/${id}`);
  },
);

// --- Then: actor-scoped negative / positional assertions ---

Then(
  "{string} does not see {string} within {int} second(s)",
  async ({}, actorName: string, title: string, seconds: number) => {
    const actor = getActor(actorName);
    await expect(
      actor.page.locator("li", { hasText: title }),
    ).toHaveCount(0, { timeout: seconds * 1000 });
  },
);

Then(
  "{string} appears before {string} for {string}",
  async ({}, first: string, second: string, actorName: string) => {
    const actor = getActor(actorName);
    const items = actor.page.locator('[data-testid="todo-row"]');
    const texts: string[] = [];
    const count = await items.count();
    for (let i = 0; i < count; i++) {
      texts.push(await items.nth(i).innerText());
    }
    const firstIdx = texts.findIndex((t) => t.includes(first));
    const secondIdx = texts.findIndex((t) => t.includes(second));
    expect(firstIdx).toBeGreaterThanOrEqual(0);
    expect(secondIdx).toBeGreaterThanOrEqual(0);
    expect(firstIdx).toBeLessThan(secondIdx);
  },
);
```

Notes on decisions:
- `({}, actorName, ...)` first-arg destructure matches the codebase's `createBdd()` convention (see `collaborators.ts:144`).
- `getActor()` + `resolveListIdFor()` are imported from `./collaborators.ts` (exports added in Task 1.1).
- Delete step waits for `state: "detached"` to avoid race with Bob's assertion.
- CSV import uses inline `setInputFiles` with a Buffer (no fixture file) — keeps scenarios self-contained.
- `{string} does not see {string} within {int} second(s)` uses `toHaveCount(0)` which retries up to timeout — works even when the row is present at step start and disappears mid-timeout.

- [ ] **Step 4: Regenerate bddgen**

Run: `cd e2e && pnpm exec bddgen`
Expected: no errors. If a step phrasing is unknown, bddgen will report the unmatched step — cross-check against the "New phrasings" list above.

- [ ] **Step 5: Run the new feature**

Run: `make test ARGS="--project desktop --grep 'Realtime todo sync'"`
Expected: 4/4 PASS.

Common flakes:
- 3-second tolerance too tight: verify the WS subscription established (check browser devtools). If a scenario fails at "bob sees X within 3 seconds" but the todo IS in the DOM at a higher timeout, the issue is elsewhere — don't raise the tolerance, investigate.
- Step-def selector mismatch: grep rendered HTML with `await actor.page.content()` temporarily; make sure `data-testid="todo-row"` landed on both sortable + completed items.
- `check-feature-emails` lint guard fails: extend emails (e.g., `alice-rt-create2`) if any conflict with pre-existing usage.

- [ ] **Step 6: Run full BDD to confirm no regressions**

Run: `make test ARGS="--project desktop"`
Expected: all PASS except pre-existing failures in handover §68. These are outside scope.

- [ ] **Step 7: Commit**

```bash
git add e2e/features/todo-list/collaborator-realtime-todos.feature \
        e2e/steps/todo-list/collaborator-realtime-todos.ts \
        apps/web/src/features/todo-list/sortable-todo-item.tsx \
        apps/web/src/features/todo-list/completed-todo-item.tsx \
        apps/web/src/routes/_authenticated/todo-lists/index.tsx

git commit -m "$(cat <<'EOF'
test(e2e): realtime collaborator sync scenarios — create, delete, import, cold-cache

Four new Gherkin scenarios exercising the payload-event push path:

- Alice creates a todo, Bob sees it within 3s (canonical push case).
- Alice deletes a todo, Bob sees it disappear (filter-out path).
- Alice imports CSV with 3 rows, Bob sees them prepended above existing
  row (validates the todos-imported handler's shift+prepend semantics).
- Cold-cache peer navigates to a list with pending realtime mutations,
  sees fresh state (validates useQuery-on-mount for unsubscribed tabs).

Step defs reuse existing Given phrasings from collaborators.ts for
auth / list-setup / collab-membership / list-open. Adds 7 new
multi-actor verbs (create/delete/import/opens/index-open/does-not-see/
appears-before) in collaborator-realtime-todos.ts. Imports getActor,
listIdByName, resolveListIdFor from collaborators.ts (exported in
prior commit).

Adds data-testid="todo-row" to sortable + completed todo items, and
data-testid="todo-lists-index" to the lists index route, for stable
step-def selection.

Reorder realtime BDD intentionally skipped (DnD across two browser
contexts is flaky; existing single-user reorder covers DOM rendering).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 1.9: Documentation — conventions.md + CLAUDE.md updates

**Files:**
- Create: `docs/conventions.md`
- Modify: `CLAUDE.md` (add "Conventions" section)
- Modify: `packages/api/CLAUDE.md` (note on realtime publish pattern)

- [ ] **Step 1: Create `docs/conventions.md`**

```markdown
# Project Conventions

Canonical cross-cutting conventions. Read the relevant section before
writing code that touches the area. CLAUDE.md files link back to specific
sections here.

## Realtime event naming

Every realtime event kind MUST start with its owning domain — the domain
whose service emits it. Examples:

- `todo-created`, `todo-updated`, `todo-deleted` (todo domain, single-item)
- `todos-reordered`, `todos-imported` (todo domain, bulk)
- `todo-list-updated`, `todo-list-collaborator-added` (todo-list domain)

**Pluralization rule.** Single-item mutations use singular
(`todo-created`); bulk mutations that span multiple items atomically use
plural (`todos-reordered`, `todos-imported`). This mirrors the server's
payload shape — singular events carry one entity, plural events carry an
array.

Events may ride on a channel owned by a *different* domain (e.g.,
`todo-created` publishes on `todo-list:{listId}`); the prefix refers to
the emitter, not the transport. This keeps log lines, subscription
inspection, and grep output self-describing when multiple domains
multiplex over one WebSocket.

The channel-key namespace already disambiguates at the wire level (each
tRPC subscription has a typed return union). The prefix is a
code-readability convention — nice-to-have, not architecturally
load-bearing.

## Event shape — payload vs notification

**Payload-shaped events** carry the full post-commit entity (or the delta
needed to patch client cache). Client handlers use `setQueryData`, no
refetch on the hot path. Use for high-frequency, cache-patchable
mutations.

**Notification-shaped events** carry only identifiers; client handlers
`invalidateQueries` and refetch. Use when payload isn't trustworthy for
the consumer's decision (authz-cascading events like
`collaborator-removed`) or when the mutation is rare (metadata updates).

Each event kind picks one shape at design time and commits to it. Mixing
shapes within one kind (sometimes payload, sometimes id-only) breaks the
handler contract.

## Event kinds SSOT

For each domain's event union, the list of kinds lives as a `const` tuple
with the event type derived from it:

```ts
export const DOMAIN_EVENT_KINDS = ["kind-a", "kind-b"] as const;
export type DomainEventKind = (typeof DOMAIN_EVENT_KINDS)[number];
export type DomainEvent =
  | { kind: "kind-a"; listId: string }
  | { kind: "kind-b"; listId: string; itemId: string };
```

Reasoning: a runtime array is needed for relay type-guards and dispatch
maps; deriving the type from the array (not the other way around) means
adding a kind without updating the tuple produces a compile error at
every exhaustive consumer.

Reference implementation: `packages/api/src/domains/todo-list/events.ts`.
```

- [ ] **Step 2: Update root `CLAUDE.md` — add "Conventions" section**

Insert a new section at the appropriate place in `CLAUDE.md` (after the top-level intro, before "Structure" or similar). Exact placement: after the `## Structure` section, before `## Commands`.

Add:
```markdown
## Conventions

Canonical cross-cutting conventions live in `docs/conventions.md`. Read
the relevant section before writing code that touches the area.

- **Realtime event naming** — domain-prefixed event kinds. See [docs/conventions.md#realtime-event-naming](docs/conventions.md#realtime-event-naming).
- **Event shape — payload vs notification** — pick one shape per kind; don't mix. See [docs/conventions.md#event-shape--payload-vs-notification](docs/conventions.md#event-shape--payload-vs-notification).
- **Event kinds SSOT** — const tuple → derived type, never the reverse. See [docs/conventions.md#event-kinds-ssot](docs/conventions.md#event-kinds-ssot).
```

- [ ] **Step 3: Update `packages/api/CLAUDE.md` — realtime publish note**

In the "Adding a New Feature" section of `packages/api/CLAUDE.md` (around step 6 "router.ts" wiring), add a bullet:

```markdown
- **Realtime fan-out.** If the mutation should fan out to collaborators
  in real time, follow the payload-event pattern in
  `packages/api/src/domains/todo-list/todo-service.ts` (see `createTodo`,
  `completeTodo`). Each event kind goes into the `TODO_LIST_EVENT_KINDS`
  tuple in `events.ts` (convention:
  [docs/conventions.md#event-kinds-ssot](../../docs/conventions.md#event-kinds-ssot)).
  Backend unit tests inject `MemoryChannelFactory` and assert publish
  (see the 5 `publishes` tests in `todo-service.test.ts`).
```

- [ ] **Step 4: Lint**

Run: `make lint`
Expected: PASS. Markdown lint may not be active — if it is, fix any trailing-whitespace / heading-level issues.

- [ ] **Step 5: Commit**

```bash
git add docs/conventions.md CLAUDE.md packages/api/CLAUDE.md
git commit -m "$(cat <<'EOF'
docs: seed docs/conventions.md with realtime-event conventions

First entry in a canonical conventions document. Three realtime rules:
- Naming: domain-prefixed event kinds (emitter-based).
- Shape: payload-shaped vs notification-shaped, one per kind.
- SSOT: const tuple → derived type for the kind-list.

Root CLAUDE.md gains a top-level "Conventions" section with anchored
pointers. packages/api/CLAUDE.md gains a realtime-fan-out bullet in
"Adding a New Feature."

Migrating the rest of the inline CLAUDE.md conventions into
docs/conventions.md is tracked as a separate follow-up (see spec
§"Follow-up work").

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 1.10: Final verification — full lint + test + BDD

**Files:** none (verification)

- [ ] **Step 1: Full lint + typecheck**

Run: `make lint`
Expected: PASS.

- [ ] **Step 2: Unit tests**

Run: `make test-unit`
Expected: PASS. Test count = prior count + 4 new publish tests + 10 new handler-unit tests. Existing completeTodo-publish test count unchanged (assertion updated in place).

- [ ] **Step 3: BDD — desktop only, full suite**

Run: `make test ARGS="--project desktop"`
Expected: 4 new realtime scenarios PASS + existing 4 "Todo list collaborators" scenarios PASS. The 5 pre-existing failures (handover §68) may still be present — they're out of scope.

- [ ] **Step 4: Sanity — grep for chat-related leftovers that shouldn't exist**

The spec explicitly has no chat references. As a sanity check that nothing leaked in:

Run: `rg -i 'chat' docs/superpowers/specs/2026-04-19-realtime-push-semantics-design.md docs/superpowers/plans/2026-04-19-realtime-push-semantics.md docs/conventions.md`
Expected: zero matches.

- [ ] **Step 5: Verify all Phase-1 commits are present and ordered**

Run: `git log --oneline bb77e69..HEAD`

Expected list (in order, modulo commit titles):
1. `refactor: merge todo domain into todo-list (aggregate-root naming)` (Phase 0)
2. `refactor(e2e): extract collaborator-actors helpers`
3. `feat(events): domain-prefixed kinds + TodoWithList payload + SSOT tuple`
4. `feat(api): wire payload publishers in 4 todo mutations`
5. `test(api): publish-assertion tests for 4 new todo-service publishers`
6. `feat(web): per-kind TodoListEvent handler map`
7. `test(web): unit tests for event-handlers map`
8. `refactor(web): delegate TodoListEvent dispatch to handler map`
9. `test(e2e): realtime collaborator sync scenarios`
10. `docs: seed docs/conventions.md with realtime-event conventions`

- [ ] **Step 6: Write handover doc**

Create `docs/superpowers/specs/2026-04-19-realtime-push-semantics-handover.md` — pattern copied from `2026-04-19-plan-c-followups-handover.md`. It should:
- List what shipped (10 commits above)
- Copy the "Follow-up work" section from the spec verbatim (conventions-consolidation, post-commit-publish refactor, reconnect gap-fill, membership-role enforcement, envelope versioning)
- Name starting points for likely next-session tasks (add new kind, add new realtime domain, etc.)

Template:
```markdown
# Realtime Push Semantics — Handover

**Branch:** `feat/template-reference-impl`
**Status:** Shipped.
**Spec:** `docs/superpowers/specs/2026-04-19-realtime-push-semantics-design.md`
**Plan:** `docs/superpowers/plans/2026-04-19-realtime-push-semantics.md`

## What shipped

[copy the 10 commit subjects + 1-sentence description each]

## Starting points for common next-session tasks

- **Adding a new event kind:** extend `TodoListEvent` in `packages/api/src/domains/todo-list/events.ts` + add to `TODO_LIST_EVENT_KINDS` tuple (TS errors cascade to every consumer) + add handler in `apps/web/src/features/todo-list/event-handlers.ts` + backend publish test + frontend handler unit test.
- **Adding a new realtime-event domain:** follow `todo-list/events.ts` as reference; see `docs/conventions.md#event-kinds-ssot`.
- **Migrating a notification-shaped event to payload-shaped:** rename is wire-incompatible (same-kind, different payload). Today it's safe because single-deploy; revisit before production blue/green deploys.

## Deferred follow-ups

### Consolidate project conventions into `docs/conventions.md`
[... copy from spec §"Follow-up work" verbatim]

### Publish-after-commit refactor
[... copy]

### Reconnect gap-fill
[... copy]

### `TodoListMembership.role` write-tier enforcement
[... copy]

### Envelope versioning
[... copy]
```

- [ ] **Step 7: Commit the handover**

```bash
git add docs/superpowers/specs/2026-04-19-realtime-push-semantics-handover.md
git commit -m "$(cat <<'EOF'
docs: realtime push-semantics handover

Wraps up the implementation of the realtime push-semantics spec.
Copies follow-up items forward for next-session discoverability.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-review checklist (completed during plan authoring)

**Spec coverage:**
- Phase 0 steps 0a–0f → Tasks 0.2–0.9.
- Phase 1 step 1 (helper extraction) → Task 1.1.
- Phase 1 step 2 (atomic commit) → Task 1.2.
- Phase 1 step 3 (4 new publishers) → Task 1.3.
- Phase 1 step 4 (backend tests) → Task 1.4.
- Phase 1 step 5 (handler map + unit tests) → Tasks 1.5 + 1.6.
- Phase 1 step 6 (hook refactor) → Task 1.7.
- Phase 1 step 7 (relay type-guard SSOT import) → folded into Task 1.7 (happens together naturally).
- Phase 1 step 8 (BDD scenarios) → Task 1.8.
- Phase 1 step 9 (docs/conventions.md + CLAUDE.md) → Task 1.9.
- Phase 1 step 10 (make lint + full test run) → Task 1.10.

**Type consistency across tasks:**
- `TodoWithList` used identically in tasks 1.2 (events.ts), 1.3 (publishers), 1.4 (backend tests), 1.5 (event-handlers.ts), 1.6 (unit tests).
- Event-kind strings (`todo-list-updated`, `todo-created`, etc.) used identically everywhere.
- `options: { channel?: ChannelProvider }` parameter shape identical across all 4 new publishers and matches the existing `completeTodo` / `acceptInvite` / `removeCollaborator` pattern.
- `eventHandlers[event.kind](trpc, qc, event as never)` dispatch identical in task 1.5 (handler map) and task 1.7 (hook refactor).

**No placeholders:**
- Every step has either exact code to paste, exact command to run, or an exact edit instruction.
- No "TBD", "implement later", "add appropriate error handling."
- Test code is fully specified (not "write tests for the above").
