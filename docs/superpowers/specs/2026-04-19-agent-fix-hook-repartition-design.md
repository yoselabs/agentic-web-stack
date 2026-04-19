# Agent Fix-Loop Hook Repartition — Design

**Status:** Draft
**Date:** 2026-04-19
**Related signals:** `~/Documents/Knowledge/Evolution/signals/2026-04-19-0554-make-fix-vs-make-lint-autofix-loop.yaml` (and four siblings in the same session)

## Context

During the Task 10–16 session on `feat/template-reference-impl`, subagent transcripts showed ~15 tool calls burned on a recurring pattern: agent writes a file, runs `make lint`, git commit fires `prek`, prek runs `agent-harness fix`, biome rewrites the file, agent's cached file content is now stale, the next Edit fails or produces drift, agent re-Reads, re-Edits. Same shape across Task 11 (7 bash calls diagnosing tab-vs-space) and Task 15 (four distinct Write → lint → re-Read → re-Edit cycles on `collaborators.ts`).

Research into how other teams handle the same collision:

- **superpowers `subagent-driven-development` skill** — tells implementers to commit but is silent on formatting. The gap that bit us.
- **Claude Code community consensus** — run formatters on `Stop` hooks, not `PostToolUse`. Rationale is a token argument: every PostToolUse reformat emits a system-reminder that eats context.
- **Aider** — sidesteps by not caching; re-reads every turn. Not an option for Claude Code.
- **Claude Code issue #28383** — pending proposal to make Edit fall back to "apply if old_string still uniquely matches" instead of hard-blocking. Not merged.
- **Claude Code issue #40117** — agents bypass pre-commit (`--no-verify`, `git stash`). Fix adopted: `permissions.deny` + pre-push verification.

## Problem

The pre-commit hook chain silently rewrites files under the agent. The agent's next tool call reads stale content and spins. Observed cost ~30% of session waste (~15 of ~150 recoverable tool calls).

Secondary problem: `superpowers:subagent-driven-development` tells subagents to commit mid-task but doesn't teach them how to handle format rewrites. Every subagent on every project re-discovers this footgun.

## Goals

1. **Zero silent file rewrites during `git commit`.** If a commit would change formatting, it fails loudly so the agent does one explicit fix+re-read cycle instead of drifting silently.
2. **Formatting still happens automatically** — the agent shouldn't have to remember to run `make fix`. A Claude Code `Stop` / `SubagentStop` hook handles it at turn boundaries, off the cache-invalidation critical path.
3. **Pre-push safety net** catches format drift from humans or tools that bypass the pre-commit gate.
4. **Close the `--no-verify` bypass route** before any agent discovers it.

## Non-goals

- Migrating from prek to Lefthook. Prek already supports everything this design needs (multi-stage hooks via `stages: [...]`). Separate decision with separate triggers.
- Fixing the broader "subagent context starvation on integration tasks" signal. Different problem, different spec.
- Changing how `agent-harness` discovers files or runs its checks. This spec only moves *when* and *where* pieces fire.
- Writing a parallel CI pipeline. CI continues to run `make lint` as-is.

## Design

### 1. Split prek hooks across git stages

Current `.pre-commit-config.yaml` runs all three checks on `pre-commit`:

```yaml
repos:
  - repo: local
    hooks:
      - id: harness-fix      # ← silently rewrites files
      - id: harness-lint
      - id: typecheck
```

New layout:

```yaml
repos:
  - repo: local
    hooks:
      # Pre-commit — read-only checks only. Fail fast, never rewrite.
      - id: harness-lint
        name: agent-harness lint
        entry: agent-harness lint
        language: system
        pass_filenames: false
        always_run: true
        stages: [pre-commit]

      - id: typecheck
        name: typecheck
        entry: pnpm -w run typecheck
        language: system
        pass_filenames: false
        always_run: true
        stages: [pre-commit]

      # Pre-push — belt-and-braces. Run fix, then re-lint, and fail
      # if fix produced any diff (someone pushed without formatting).
      - id: harness-fix-prepush
        name: agent-harness fix (pre-push)
        entry: agent-harness fix
        language: system
        pass_filenames: false
        always_run: true
        stages: [pre-push]

      - id: harness-lint-prepush
        name: agent-harness lint (pre-push)
        entry: agent-harness lint
        language: system
        pass_filenames: false
        always_run: true
        stages: [pre-push]

      - id: typecheck-prepush
        name: typecheck (pre-push)
        entry: pnpm -w run typecheck
        language: system
        pass_filenames: false
        always_run: true
        stages: [pre-push]

      - id: no-format-drift
        name: no format drift (pre-push)
        entry: git diff --exit-code
        language: system
        pass_filenames: false
        always_run: true
        stages: [pre-push]
```

One-time install: `prek install --hook-type pre-commit --hook-type pre-push`. `make setup` must add `--hook-type pre-push` to whatever prek install it currently runs.

### 2. Claude Code Stop + SubagentStop hooks

Add to `.claude/settings.json` (create if absent):

```json
{
  "hooks": {
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          { "type": "command", "command": "make fix" }
        ]
      }
    ],
    "SubagentStop": [
      {
        "matcher": "",
        "hooks": [
          { "type": "command", "command": "make fix" }
        ]
      }
    ]
  }
}
```

Both hooks run `make fix` in the repo root when a turn ends. Because they fire outside any tool-use call, no agent is mid-edit — no cache to invalidate. If fix produces changes, they appear on disk after the turn; the next turn starts with a clean Read, which the agent does anyway.

`make fix` is already idempotent (second run produces no diff), so a Stop hook that fires after a no-op turn costs one `agent-harness fix` invocation (~3s) and nothing else.

### 3. `.claude/settings.json` permissions.deny

Same file, block known bypass routes:

```json
{
  "permissions": {
    "deny": [
      "Bash(git commit*--no-verify*)",
      "Bash(git push*--no-verify*)",
      "Bash(git commit -n*)"
    ]
  }
}
```

These patterns specifically block the shortest routes an agent might discover when pre-commit fails. Not foolproof (a determined agent could `git update-ref` or shell out to another shell), but matches community practice (issue #40117) and closes the 99% case.

### 4. Update project `CLAUDE.md`

Add a short section under "Critical Rules":

```markdown
- **Never use `--no-verify` on commits or pushes.** The pre-commit hook only
  runs lint + tsc (both read-only); if it fails, fix the underlying issue —
  don't bypass. `make fix` is for formatting; if it produces changes,
  re-read affected files before continuing.
- **Don't run `make fix` mid-task unless you're fixing a commit rejection.**
  The Claude Code `Stop` hook runs it at turn end. If you do run it during
  a turn (e.g., after a failed commit), re-Read every file you plan to edit
  next before editing.
```

### 5. (Optional, out-of-project) Update `superpowers:subagent-driven-development`

The skill's implementer-prompt template tells subagents to commit but doesn't cover format rewrites. Two options, listed for the user to choose later:

- **Add a line** to the template: "Before `git commit`, if `make fix` or equivalent exists, run it and re-Read any file you just wrote. If a commit fails on formatting, run `make fix`, re-Read modified files, then re-commit."
- **Add a batching rule**: "If you make multiple edits to the same file, use a single MultiEdit, not several individual Edits. Only run verification commands (`make lint`, tests) after all edits to a file are complete." — addresses a separate signal but lives near this one naturally.

This spec does not require the skill change to land; the project-level fixes work standalone. Skill change is tracked separately.

## Trade-offs and alternatives considered

### Alternative A: Minimal — just remove fix from pre-commit

Do only step 1's pre-commit half (drop `harness-fix`). No Stop hook, no pre-push, no permissions.deny.

- (+) Smallest change, one file edited.
- (−) Commits will now fail loudly on format errors. Agent must run `make fix` manually, hitting the same cache-invalidation cycle. Doesn't reduce waste — just moves when it happens.
- Rejected: solves nothing.

### Alternative B (chosen): Hook repartition + Stop hook + pre-push + permissions.deny

As specified above.

- (+) Zero silent rewrites on commit. Mid-turn cache stays coherent.
- (+) `Stop`/`SubagentStop` runs fix at turn end, off the critical path.
- (+) Pre-push catches format drift from humans/IDEs.
- (+) `permissions.deny` closes the bypass that otherwise undoes the whole design.
- (−) Four files touched instead of one.
- (−) Stop hook leaves a dirty working tree between turns if agent's commits didn't include the formatted state. Next turn starts by seeing `git status` dirty. Agent handles this naturally (any good agent checks `git status`), but it's a behavior change.

### Alternative C: Aggressive — Stop hook formats + auto-commits

Stop hook runs `make fix`, stages changes, amends the last commit with `--no-edit` if it's recent and from this session.

- (+) Commits always end clean and formatted; no ever-dirty tree.
- (−) Amend-last-commit is magic. If the heuristic fires on the wrong commit (e.g., user amended manually between turns), it rewrites history unexpectedly.
- (−) In subagent-driven flows, `SubagentStop` would amend commits across subagent boundaries in hard-to-predict ways.
- (−) Nobody in the community has publicly documented this pattern; we'd be pioneering without a proven fallback.
- Deferred: revisit if Alternative B's dirty-tree-between-turns turns out to be more confusing than expected.

## What people actually do (research summary)

- `superpowers:subagent-driven-development` → subagent commits mid-task, silent on formatting. Gap.
- Claude Code community → Stop hook formats; commits still initiated by the agent; pre-commit is a blocking gate.
- Aider architect mode → editor model commits; architect never commits. Analogous to "orchestrator delegates commit to subagent."
- claude-code-action (GitHub Actions) → runs in CI; commits via App identity; no subagent/Stop distinction.
- CrewAI / AutoGen → no convention; VCS is out-of-band.

No one has converged on a `SubagentStop` hook that formats + commits in one shot. That's Alternative C, and it's a gap, not a best practice. We take the community-standard middle (Alternative B) and leave C as a follow-up.

## Verification

After this spec ships, the observed-waste metrics from the postmortem should drop:

- **Auto-fix loop cost** (observed: ~15 tool calls across session) → target: 0 for well-behaved turns; ~3 per commit that hits a format error (one `make fix` + two re-Reads, unavoidable).
- **T11-shape tab-vs-space diagnostic loops** (7 bash calls) → target: 0. `make fix` can no longer surprise the agent silently; any fix-induced rewrite is explicit.
- **T15-shape Write → lint → re-Read cycles** (~8 calls) → target: 0 during normal flow; explicit when a commit is rejected.

Non-metric signals:
- No one reports `--no-verify` in commits after this lands.
- Pre-push rejects one or more format-drift commits from humans within the first week — that means the net is catching real misses.
- Dirty working tree between agent turns is either a non-issue or escalates into a follow-up (triggering Alternative C).

## Implementation sketch (for the plan, not this spec)

Three files, one hook install, one doc update:

1. Edit `.pre-commit-config.yaml` — split stages as specified in §1.
2. Edit `Makefile` / `make setup` — add `prek install --hook-type pre-push` to the idempotent install step.
3. Create/edit `.claude/settings.json` — add Stop + SubagentStop hooks and permissions.deny entries.
4. Edit `CLAUDE.md` — add the two rules under "Critical Rules".
5. Run through one commit + one push manually to sanity-check each hook fires at the right stage.
6. Verify: `git commit --no-verify` from inside Claude Code is denied by the permissions guard.

No test infrastructure changes. No CI changes.

## Open questions

None that block shipping. Two to observe after it lands:

1. Does the dirty-tree-between-turns pattern feel confusing in practice? If yes, Alternative C becomes relevant.
2. Should the `superpowers:subagent-driven-development` skill update happen in the same change, or as a separate follow-up signal-to-skill loop? Currently deferred to "later, if the project-level fix proves the pattern."
