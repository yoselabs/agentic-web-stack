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

### Core insight

Pre-commit today does two distinct things: (a) checks code for correctness (read-only), and (b) rewrites files to fix formatting (mutating). Only (b) causes the cache-invalidation waste — a read-only check that *rejects* a commit leaves the file on disk identical to what the agent wrote, so no re-Read is needed to recover. A mutating check that *accepts* the commit silently changes the file, invalidating the agent's cached content for the next Edit.

This design separates those two concerns by git stage:
- **Pre-commit becomes strictly read-only.** Lint failures are loud, visible in the agent's bash output, and leave the file untouched. The agent fixes the reported issue and re-commits — no re-Read round-trip because nothing mutated.
- **Fix mutations happen only at turn boundaries** (Claude Code `Stop` / `SubagentStop` hooks) or on `pre-push` (safety net). In both cases, no agent is mid-edit, so no cache to invalidate.

Everything below is a mechanical application of that split.

### 1. Split prek hooks across git stages

**Prerequisite:** prek 0.3.x or newer (for `stages: [pre-commit]` / `stages: [pre-push]` naming; older versions used `commit` / `push`). Current repo uses prek 0.3.6 via homebrew.

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
        entry: |
          bash -c 'git diff --exit-code || {
            echo;
            echo "⚠ Format drift detected — agent-harness fix made changes that were not committed.";
            echo "  Remediation:";
            echo "    make fix && git add -u && git commit -m style-format-fixes && git push";
            exit 1;
          }'
        language: system
        pass_filenames: false
        always_run: true
        stages: [pre-push]
```

One-time install: `prek install --hook-type pre-commit --hook-type pre-push`. `make setup` must add `--hook-type pre-push` to whatever prek install it currently runs.

### 2. Claude Code Stop + SubagentStop hooks

Add to `.claude/settings.json`. Use `agent-harness fix` directly, **not** `make fix`, because `make fix` also runs `pnpm typecheck` (10–30s on this monorepo) — that's already covered by pre-commit and pre-push, so running it on every turn end would bloat latency without benefit. The fix step alone is what we need at the turn boundary.

```json
{
  "hooks": {
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          { "type": "command", "command": "agent-harness fix" }
        ]
      }
    ],
    "SubagentStop": [
      {
        "matcher": "",
        "hooks": [
          { "type": "command", "command": "agent-harness fix" }
        ]
      }
    ]
  }
}
```

Both hooks run `agent-harness fix` in the repo root when a turn (or subagent turn) ends. Because they fire outside any tool-use call, no agent is mid-edit — no cache to invalidate. If fix produces changes, they appear on disk after the turn; the next turn starts with a clean Read, which the agent does anyway.

`agent-harness fix` is idempotent (second run on already-fixed files is a no-op, ~1–3s).

**PATH requirement:** `agent-harness` must be on `PATH` when the Stop hook runs. Claude Code inherits the login shell's environment, so `make setup` (which installs `agent-harness` via the project's harness bootstrap) is sufficient. If a contributor cloned the repo without running `make setup`, the Stop hook fails silently — callable from `make fix` as a manual fallback.

**Timing caveat for subagent-driven flows.** `SubagentStop` fires after the subagent's final message — including after any commits the subagent already made. If a subagent commits unformatted code mid-task and pre-commit was configured with the old `harness-fix` rewriting, that's exactly the pattern this spec eliminates. Under the new design, pre-commit is read-only: the subagent's commit either (a) passes lint (file was already well-formatted, nothing to fix) or (b) fails lint loudly (file stays on disk unchanged, subagent sees the failure, fixes the specific issue, re-commits — no re-Read forced by a silent rewrite). The `SubagentStop` hook then runs fix at turn end as final polish, which may produce a dirty working tree the next turn picks up naturally.

The key property: no commit in the new design silently mutates files. The ~3-call "commit-rejection → fix → re-Read" cycle the spec counts as "unavoidable" only kicks in when the *agent itself* chooses to run `agent-harness fix` mid-turn in response to a lint failure — which is rare, and the count is bounded.

### 3. `.claude/settings.json` permissions.deny

Same `.claude/settings.json` as §2 (merged together in §3a below), block known bypass routes:

```json
{
  "permissions": {
    "deny": [
      "Bash(git commit*--no-verify*)",
      "Bash(git push*--no-verify*)",
      "Bash(git commit -n)",
      "Bash(git commit -n *)"
    ]
  }
}
```

These patterns specifically block the shortest routes an agent might discover when pre-commit fails. The two `-n` entries together cover `git commit -n` and `git commit -n -m "..."` without the overly-greedy `-n*` form matching things like `-nasty-flag`.

**Out of scope:** environment-variable bypasses (`HUSKY=0 git commit`, `PREK_DISABLE=1 git commit`, `git -c core.hooksPath=/dev/null commit`). A determined agent could also shell out to a sub-shell to dodge the matcher. This design follows community practice (CC issue #40117) and closes the 99% case — not the 100% case. If env-var bypass becomes a real failure mode, wrap with a `PreToolUse(Bash)` hook that scrubs hook-disabling envs; tracked as a follow-up.

### 3a. Final merged `.claude/settings.json`

Both the hook config (§2) and the permissions config (§3) land in the same file:

```json
{
  "hooks": {
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          { "type": "command", "command": "agent-harness fix" }
        ]
      }
    ],
    "SubagentStop": [
      {
        "matcher": "",
        "hooks": [
          { "type": "command", "command": "agent-harness fix" }
        ]
      }
    ]
  },
  "permissions": {
    "deny": [
      "Bash(git commit*--no-verify*)",
      "Bash(git push*--no-verify*)",
      "Bash(git commit -n)",
      "Bash(git commit -n *)"
    ]
  }
}
```

Repo currently has only `.claude/settings.local.json` (a small allowlist). The new `.claude/settings.json` is created fresh and committed; `settings.local.json` stays as-is for per-developer overrides.

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
