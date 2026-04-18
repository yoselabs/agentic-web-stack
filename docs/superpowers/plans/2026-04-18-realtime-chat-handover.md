# Real-Time Chat Reference — Handover

## Context (read first)

Hackathon prep. The organizer's call on 2026-04-17 confirmed:

- Test subject: **ADLC** — can a developer ship a web app by prompting AI, not by writing code. Template library explicitly endorsed.
- App shape: simple web app, doable in a day, non-tight NFRs.
- **Hint: "read about WebSockets" — a little bit.** Downplayed.
- Past challenge precedent: **Skype clone with file sharing** (strong signal that chat is the most likely real-time shape).

Strategy decided:
- Build a complete real-time **chat reference** (DMs, groups, presence, typing, file sharing, username handles) as a disabled-by-default pattern library.
- At hackathon: disable the reference, scaffold a fresh chat module using the reference's patterns via an agent skill. Avoids "used pre-built chat" disqualification risk.
- Also build the agent skill that cites the reference — so the fresh hackathon build is agent-driven, not hand-coded.

## State at handover

**Committed on `main` branch:**

| Commit | What |
|---|---|
| `c94817c` | Design spec + testing guidelines + CLAUDE.md pointer + superseded banner on old 2026-04-13 chat spec |
| `abc2fe9` | Design spec revisions from code review (WS adapter snippet, createContext coercion, unread:nudge clarifications, username migration, realtime exports, etc.) |
| `2b707a7` | Implementation plan: 19 tasks across 9 phases |

**Source docs:**

- **Spec:** `docs/superpowers/specs/2026-04-18-realtime-chat-reference-design.md`
- **Plan:** `docs/superpowers/plans/2026-04-18-realtime-chat-reference.md`
- **Testing guide:** `docs/testing-guidelines.md` (multi-user Playwright BDD pattern; explicitly excludes Node-to-Node WS integration tests)

**Nothing implemented yet.** Zero code changes toward the plan — no new tasks, no new packages, no migrations. `main` is clean from the plan's perspective.

## Pick up here

**Execute the plan.** Two execution modes; choose when you start:

### Option A — Subagent-Driven Development (recommended)
- Skill: `superpowers:subagent-driven-development`
- Fresh subagent per task; review between tasks
- Best for this plan — tasks are well-scoped and each makes a committable chunk

### Option B — Inline Execution
- Skill: `superpowers:executing-plans`
- Batch execution with checkpoints in the same session
- Use only if you want the full context from this handover in one head

## Critical decisions baked into the plan (do not re-litigate)

| Decision | Rationale |
|---|---|
| Single-instance only (no Redis) | Hackathon is one Node process. Redis swap is documented in `packages/api/src/realtime/` as a future boundary. |
| `packages/api/src/realtime/` (not a separate package) | Less ceremony; still respects no-barrel subpath-exports rule via `@project/api/realtime/channel`. |
| WS via `ws` + `@trpc/server/adapters/ws`, attached to same http.Server | `@hono/trpc-server` is HTTP only. `noServer: true` + upgrade routing is the only viable pattern. |
| tRPC client uses `splitLink` (WS for subs, HTTP for queries/mutations) | Standard tRPC v11 pattern. `createWSClient` reconnects with backoff automatically. |
| Username nullable first, backfilled + tightened in Task 17 | Existing dev DB rows would fail non-null migration. Seed script backfills before the tighten. |
| DM race: `dmKey String? @unique` + P2002 catch | Simpler than advisory locks. Works because DMs are `name = null + exactly 2 members` + deterministic `{min}:{max}` key. |
| No Node-to-Node WS integration tests | 1-2h flake surface. BDD through a real browser is the real coverage. |
| Multi-user BDD via `test.extend` `Map<string, Page>` | `createBdd` takes no generic. Fixtures are the correct extension point. |
| Presence state in chat domain, not in realtime | Keeps realtime transport-only; chat owns the 3s debounce + membership semantics. |
| No MIME whitelist on uploads | Forced `Content-Disposition: attachment` + `X-Content-Type-Options: nosniff` is the real XSS defense. |
| Feature flag disabled by default (both server + client) | Reference ships off; judges see it disabled + a fresh hackathon module. |

## What to verify before starting

```bash
cd /Users/iorlas/Workspaces/agentic-web-stack
git status                              # main should be clean (ignore untracked .claude/ and a2sdlc-demo3 files)
git log --oneline -5                    # confirm 2b707a7 is HEAD (or descendants)
make lint                               # baseline should pass
make test-unit                          # baseline should pass
ls docs/superpowers/plans/              # 2026-04-18-realtime-chat-reference.md present
```

## First concrete steps in the next session

1. Load the skill: `superpowers:subagent-driven-development` (or `:executing-plans`).
2. Point it at `docs/superpowers/plans/2026-04-18-realtime-chat-reference.md`.
3. Start with **Task 1** (schema). Each task ends with a commit; don't skip.
4. **After Task 12** (WS attachment) — run manual smoke: `ENABLE_CHAT=true make dev`, hit `ws://localhost:3001/trpc-ws` with any WS client, confirm the upgrade succeeds.
5. **Task 17 order matters:** backfill (`make db-seed`) before tightening schema. Plan is explicit about this.
6. **Final check:** `make lint && make test-unit && make test` — the BDD scenario is the only live-WS proof point.

## Likely gotchas (from the review cycles)

- **WS context type coercion.** `IncomingMessage.headers` is not a Fetch `Headers`. Plan Task 12 shows the coercion — don't skip it.
- **`setQueryData` type breakage in tRPC.** Explicit types required on the callback parameter. Already shown in `apps/web/CLAUDE.md` + in the `use-live-room` hook.
- **`Link` with dynamic route.** `Link to="/chat/$roomId" as string` is how we sidestep router types before the route tree regenerates. Confirmed pattern in root CLAUDE.md's "Common Mistakes" table.
- **CSP for WebSocket.** `apps/server/src/index.ts`'s `secureHeaders` currently sets `connectSrc: ["'self'", frontendOrigin]`. WS to same origin usually works via `'self'`, but if the BDD test blocks on a CSP violation, add `ws:` / `wss:` to `connectSrc` explicitly.
- **Seed script runs Better-Auth signup**, which needs `additionalFields.username` on both server + client. Task 3 wires server + client; seed works after that.
- **BDD scenario requires `ENABLE_CHAT=true` + `VITE_ENABLE_CHAT=true` in `e2e/playwright.config.ts`'s `webServer.env`.** Task 18, Step 4 covers this — verify the env is actually set on both server and web entries.

## Budget

Spec estimate: 6–8h with +25% buffer for WS/additionalFields/first-BDD friction.

Realistic: **8–10h** for a clean pass; leave a ~1h buffer before the hackathon for the agent skill doc (Task 19) and manual smoke. If under time pressure, skip Task 19 — the skill can be written at the hackathon if chat turns out to be the challenge.

## Out-of-scope reminders (do NOT implement)

- Read receipts, message edit/delete, reactions, reply threads, search
- Image thumbnails/previews
- S3/object storage (local disk only)
- Rate limiting on send/upload
- Friend/contact requests
- Email invitations
- Orphan file cleanup (requires job queue)
- Multi-instance scaling
- Group admin roles

All listed in the spec's "Out of Scope" section. If the hackathon prompt requires one, an agent skill retrofit is the pattern — don't slip it into the reference.

## If the hackathon challenge turns out NOT to be chat

Then the reference serves a different purpose: it's the WS primitive (`packages/api/src/realtime/channel.ts`), the WS server attachment pattern (`apps/server/src/index.ts`), the splitLink client wiring, and the multi-user BDD fixture. All of those compose onto any real-time feature — the agent skill in Task 19 is deliberately domain-agnostic.

Go.
