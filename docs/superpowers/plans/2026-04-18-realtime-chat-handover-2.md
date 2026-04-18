# Real-Time Chat Reference — Handover 2 (mid-plan)

Supersedes `2026-04-18-realtime-chat-handover.md` at the point of resumption. Same goal, same plan, same spec — this doc is just "where we are now and how to pick up."

## State at handover

**Branch:** `feat/realtime-chat` (16 commits ahead of `origin/main`, not pushed).
**HEAD:** `33a6801 feat(web): chat routes (/chat + /chat/$roomId)`
**Working tree:** clean.
**`main`:** untouched, matches `origin/main` at `abe0b1f`.

**Tasks 1–16 done (16/19).** Tasks 17–19 not started.

### Completed commits (oldest first)

| # | SHA | Subject |
|---|---|---|
| 1 | `7e2a90f` | feat(db): add chat schema + nullable username on User |
| 2 | `45cddec` | feat(env): add ENABLE_CHAT + VITE_ENABLE_CHAT + VITE_WS_URL |
| 3 | `a2bbee5` | feat(auth): add username additionalField on server + client |
| 4 | `5308d59` | feat(api): add realtime channel primitive with typed pub/sub |
| 5 | `fbc3bef` | feat(api): add user search + isUsernameAvailable |
| 6 | `2dfea95` | feat(web): username field with async availability on signup |
| 7 | `a5ee723` | feat(chat): constants + typed channel instances |
| 8 | `b377743` | feat(chat): room service (create, DM, invite, leave, list, get) |
| 9 | `1953659` | feat(chat): message service (send text/file, list, cursor, markRead) |
| 10 | `60e7330` | feat(chat): router — rooms/messages/presence/typing/subscriptions |
| 11 | `49baa0b` | feat(server): chat file upload/download endpoints (flag-gated) |
| 12 | `bb1ff0a` | feat(server): WS server attachment for tRPC subscriptions |
| 13 | `53fddf9` | feat(web): tRPC splitLink + wsClient for subscriptions |
| 14 | `2153428` | feat(web): chat hooks + upload helper + types |
| 15 | `9d5c029` | feat(web): chat UI components (list, composer, sidebar, search) |
| 16 | `33a6801` | feat(web): chat routes (/chat + /chat/$roomId) |

Last verified baseline: `make check` PASS (13/13), `make test-unit` = **57 tests passing** (22 chat + user + realtime + prior 31).

### Remaining tasks

- **Task 17** — Seed usernames + tighten `User.username` to non-null. Plan lines 2887–3026.
- **Task 18** — Multi-user Playwright fixture + `e2e/features/chat.feature` + steps. **Only live-WS proof.** Plan lines 3032–3199.
- **Task 19** — `docs/skills/add-realtime.md` agent skill doc. Plan lines 3200+. Optional if time-pressed.

## Environment setup (one-time, already done in this sandbox)

The repo's `make lint` target requires tooling not installed by `pnpm install`. The previous handover didn't mention this — it was the first real friction point on resumption. Setup commands:

```bash
# 1. agent-harness (Python tool, pypi package `agentic-harness`, binary `agent-harness`)
uv tool install agentic-harness

# 2. prek (pre-commit hook runner used by .pre-commit-config.yaml)
uv tool install prek
prek install   # installs .git/hooks/pre-commit

# 3. conftest (OPA policy checker, no apt/brew package available)
curl -sL -o /tmp/conftest.tgz \
  "https://github.com/open-policy-agent/conftest/releases/download/v0.68.2/conftest_0.68.2_Linux_x86_64.tar.gz"
tar -xzf /tmp/conftest.tgz -C /tmp conftest
mv /tmp/conftest ~/.local/bin/conftest
chmod +x ~/.local/bin/conftest
```

After these three, `make lint` runs the full 13-check suite (biome, yamllint, conftest × N, hadolint, precommit-hooks, typecheck).

## Port 5432 conflict workaround (local-only)

Port 5432 was already held by another project's docker container on this host (Fox dev environment). Created two **gitignored** files so this repo uses port 5433 without touching any committed infrastructure (preserves the SSOT literal-port rule):

**`docker-compose.override.yml`** (gitignored — entry added to `.gitignore` in the infra step):
```yaml
services:
  postgres:
    ports: !override
      - "5433:5432"
```
Note the `!override` tag — without it docker-compose merges lists, leaving both 5432 and 5433 active and re-triggering the bind conflict.

**`.env`** (gitignored by default):
```
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/app
```

The `.gitignore` now contains `docker-compose.override.yml` under a `# Local compose overrides` section. That change is the only modification to a committed file done outside the 16 task commits. If you start fresh on a host where 5432 is free, skip both files and the default config works.

## How to pick up

Stay on `feat/realtime-chat`:

```bash
cd /home/fox/Workspaces/agentic-web-stack
git checkout feat/realtime-chat
make lint && make test-unit   # confirm baseline (13 checks + 57 tests)
```

Then load either skill and point at the plan:

```
superpowers:subagent-driven-development    # recommended; one subagent per task
  # or
superpowers:executing-plans                # inline execution
```

Plan: `docs/superpowers/plans/2026-04-18-realtime-chat-reference.md`. Start at **Task 17**.

## Pattern for TDD tasks (used for tasks 4, 5, 8, 9, 10)

Each of those subagents:
1. Wrote the test file first (exact snippet from plan).
2. Ran `make test-unit` to confirm RED (module-not-found or TRPCError on missing procedure).
3. Implemented the production file(s).
4. Re-ran `make test-unit`; confirmed GREEN with the expected new-test count.
5. Ran `make check` before committing.
6. Committed with the exact message from the plan, staging only the explicit paths in the plan's `git add` line (never `-A`).

The RED confirmation step is the one that's easiest to skip; don't. It's the check that the test actually exercises the new code path.

## Known deviations from the plan

Listed in order of potential impact. Each is committed; change only if you have a reason.

1. **Task 4 — `channel.ts` uses `env.NODE_ENV`, not `process.env.NODE_ENV`.** The plan's snippet hit the SSOT grep check in `make lint` (forbids `process.env.*` outside `@project/env`). Fixed by importing `env` from `@project/env/server` and adding `@project/env` to `packages/api`'s deps. `pnpm-lock.yaml` was staged in that commit too.

2. **Task 6 — auth-client TS2742 workaround, localized cast in login.tsx.** `apps/web/src/features/auth/auth-client.ts` casts `createAuthClient(...)` return to `BaseAuthClient` (a type without plugins) to satisfy the project-references compiler. The cast erases `inferAdditionalFields` typing, so `signUp.email({ username })` fails tsc. Task 6 worked around this with a localized signature-widening cast on the one call site in `login.tsx`. **This is technical debt.** The clean fix is in `auth-client.ts` — swap the cast approach so plugin-augmented types survive. Doing so also unblocks any future client code that needs `signUp.email({ username })` or similar.

3. **Task 6 — BDD auth flake in parallel only.** `make test ARGS="--grep Authentication --project desktop"` fails 1/4 (or 4/5) scenarios under default parallelism. Subagent verified the failure reproduces at the pre-Task-6 HEAD with identical fail pattern — it's pre-existing. Single-worker (`--workers=1`) or individual scenarios pass. Root cause not diagnosed; looks like a dashboard-guard redirect race or React re-render timing, not a Task 6 regression. Worth a look before shipping.

4. **Task 8 — `presence.ts` replaced `rooms.get(roomId)!.add(userId)`** with a local `let set = ...; if (!set) { set = new Set(); rooms.set(...); }` because biome rejects non-null assertions. Same runtime behavior.

5. **Task 10 — `signal!` lines in subscribeRoom / subscribeUser have `biome-ignore lint/style/noNonNullAssertion` comments.** The plan explicitly said `signal!` is acceptable; biome still flags it.

6. **Task 12 — `apps/server/package.json` got a direct `@trpc/server` pin** (not catalog). Transitive resolution via `@project/api` left TS unable to resolve `@trpc/server/adapters/ws`. Pinned to `^11.0.0` matching `@project/api`. The catalog in `pnpm-workspace.yaml` would be a cleaner home, but that expands scope.

7. **Task 14 — `useSubscription` imported from `@trpc/tanstack-react-query`, not `@tanstack/react-query`.** The plan snippet had the wrong module path; verified against the installed package exports.

8. **Task 15 — `UserSearchDialog.tsx` has one `biome-ignore lint/a11y/useSemanticElements`** on the `<div role="dialog">`. The semantic `<dialog>` element needs imperative `showModal/close()` which doesn't fit the `open` prop flow. Override is minimal.

9. **Task 15 — `RoomListSidebar.tsx` has `as never` on `params={{ roomId: r.id }}`** on top of the documented `to={"/chat/$roomId" as string}` cast. Task 16 created the actual routes, so `make routes` regenerated `routeTree.gen.ts` — both casts should now be safely removable in a cleanup pass. Not done yet; the plan doesn't call for it.

10. **Task 16 — `routeTree.gen.ts` is gitignored in this repo** (see `.gitignore` line for it). The Task 16 plan snippet expected it staged; the subagent honored the existing gitignore convention. Result: route types regenerate on `vite dev` / `make routes` and don't need to travel in the commit.

## Task 17 notes (what you'll hit first)

Plan lines 2887–3026. Order matters (plan calls it out):

1. Rewrite `scripts/seed.ts` (adds `backfillUsernames()` + second demo user + `FIRST_USERNAME` for existing user).
2. **Run `make db-seed` FIRST, before tightening the schema.** Existing rows (including any from prior unit-test runs) get usernames.
3. Then flip `auth.prisma` `username String?` → `username String`.
4. Then flip Better-Auth `required: false` → `required: true`.
5. `make db-push` — applies the NOT NULL constraint after rows are backfilled.
6. `make check && make test-unit` — must pass.
7. Commit `chore(seed): backfill usernames + tighten to non-null`, staging `scripts/seed.ts`, `packages/db/prisma/schema/auth.prisma`, `packages/auth/src/index.ts`.

**Note for this sandbox:** the Task 17 subagent was mid-edit when the user redirected to "prep up for handover." WIP edits to all three files were reverted to `git restore` state. Nothing on disk from Task 17; re-run from the plan.

## Task 18 notes (the real proof point)

Plan lines 3032–3199. Creates:
- `e2e/fixtures/multi-user.ts` — `test.extend` with `pages: Map<string, Page>`. This is the fixture extension point; `createBdd` takes no generic.
- `e2e/features/chat.feature` + `e2e/steps/chat.ts`.
- Modifies `e2e/playwright.config.ts`'s `webServer.env` to set **both** `ENABLE_CHAT=true` and `VITE_ENABLE_CHAT=true`. Handover-1 explicitly flagged this — verify both are present on both web and API entries.

This is the only live-WS test. If Tasks 17 or the BDD scenario expose real-time bugs, the likely culprits are listed in the first handover's "Likely gotchas" section — re-read those before diving in. In particular: CSP `connectSrc` for WS, the WS context header coercion (already done in Task 12), and `setQueryData` type breakage (already handled in Task 14 with explicit `ChatMessage[]`).

## Task 19 notes

Plan lines 3200+. Writes `docs/skills/add-realtime.md` — the agent skill that lets a future agent scaffold a realtime feature by citing this reference. If time-pressed at a hackathon, skip; the skill can be written from the committed code after the hackathon challenge is known.

## Final check before calling it done

```bash
make lint && make test-unit && make test
```

`make test` (the BDD suite) is the only thing that proves the whole stack — WS attachment, splitLink, tRPC subscription, cache merge, the multi-user fixture — actually works end-to-end. Don't skip it.

## Out-of-scope reminders

Same as Handover 1 — read `Out-of-scope reminders` section of `2026-04-18-realtime-chat-handover.md`. Nothing on that list has been re-scoped.
