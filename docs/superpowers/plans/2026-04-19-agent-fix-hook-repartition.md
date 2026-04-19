# Agent Fix-Loop Hook Repartition — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Task-shape note:** This is trivial glue (5 files, no tests, no logic). The spec-author tagged it as eligible for inline execution without the full implementer+spec+code-quality three-stage ritual per task. One pass, one reviewer at the end, done.

**Goal:** Move `agent-harness fix` out of the pre-commit stage so commits never silently rewrite files under the agent's cache. Fix runs at turn end (Claude Code Stop/SubagentStop hook) and on pre-push as a safety net. Pre-commit becomes read-only (lint + tsc).

**Architecture:** Single-project configuration change across three hook surfaces: prek (`.pre-commit-config.yaml`, split across `pre-commit` / `pre-push` stages), Claude Code (`.claude/settings.json` with Stop/SubagentStop + permissions.deny), and the Makefile's `setup` target (teach it to install both hook types). No code changes. No tests. Verification is manual.

**Tech Stack:** prek 0.3.x (already installed via homebrew), Claude Code hooks v1, YAML + JSON config only.

**Spec:** `docs/superpowers/specs/2026-04-19-agent-fix-hook-repartition-design.md`

---

### Task 1: Split `.pre-commit-config.yaml` into pre-commit + pre-push stages

**Files:**
- Modify: `.pre-commit-config.yaml` (full rewrite — only 3 hooks today; becomes 6 hooks across 2 stages)

Current state puts all three checks on the default stage (pre-commit), and `harness-fix` silently rewrites files during commit — the root cause of the cache-invalidation waste the spec eliminates.

- [ ] **Step 1: Rewrite the file**

Replace the entire contents of `.pre-commit-config.yaml` with:

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

- [ ] **Step 2: Sanity-check the YAML parses**

Run: `prek validate-config`
Expected: no output (success) or an error that points at a specific line.

If the repo's prek version doesn't have `validate-config`, substitute:

```bash
python3 -c "import yaml; yaml.safe_load(open('.pre-commit-config.yaml'))" && echo "OK"
```

Expected: `OK`.

- [ ] **Step 3: Commit**

```bash
git add .pre-commit-config.yaml
git commit -m "chore(hooks): split prek into read-only pre-commit + belt-and-braces pre-push"
```

The commit itself exercises the new config: pre-commit will now run only `harness-lint` + `typecheck`. Both are read-only, so the commit either succeeds unchanged or fails loudly with a lint message — no silent rewrites.

---

### Task 2: Teach `make setup` to install the pre-push hook

**Files:**
- Modify: `Makefile:22` (change `prek install` to also register the pre-push hook)

Prek installs the `pre-commit` git hook by default. For our pre-push stage to actually fire, prek needs to ALSO write `.git/hooks/pre-push`. Without this, Task 1's pre-push hooks sit inert in the YAML and nothing validates format-drift before pushes.

- [ ] **Step 1: Update the Makefile**

Find line 22 (inside the `setup:` target):

```makefile
	prek install
```

Replace with:

```makefile
	prek install --hook-type pre-commit --hook-type pre-push
```

- [ ] **Step 2: Run the updated setup step to install the hook now**

Run: `prek install --hook-type pre-commit --hook-type pre-push`
Expected: `prek installed at .git/hooks/pre-commit` and `prek installed at .git/hooks/pre-push` (two lines).

Verify: `ls -la .git/hooks/pre-commit .git/hooks/pre-push`
Expected: both files exist; both are the prek shim script.

- [ ] **Step 3: Commit**

```bash
git add Makefile
git commit -m "chore(setup): install prek pre-push hook alongside pre-commit"
```

---

### Task 3: Create `.claude/settings.json` with Stop hooks + permissions.deny

**Files:**
- Create: `.claude/settings.json` (new file; `.claude/settings.local.json` already exists but is per-developer and untouched)

`.claude/settings.json` is version-controlled repo-wide Claude Code config. This is where we wire:
- **Stop + SubagentStop hooks**: run `agent-harness fix` at turn boundaries (off the agent's cache-invalidation critical path).
- **permissions.deny**: block the `--no-verify` and `-n` bypass routes an agent might discover if pre-commit fails.

- [ ] **Step 1: Create the file**

Write `.claude/settings.json` with exactly this content:

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

- [ ] **Step 2: Validate JSON parses**

Run: `python3 -c "import json; json.load(open('.claude/settings.json'))" && echo "OK"`
Expected: `OK`.

- [ ] **Step 3: Commit**

```bash
git add .claude/settings.json
git commit -m "feat(claude): Stop/SubagentStop fix hooks + deny --no-verify bypasses"
```

---

### Task 4: Add two rules to `CLAUDE.md`

**Files:**
- Modify: `CLAUDE.md` (add to the "Critical Rules" section)

Put the behavioral contract in writing so the agent picks it up from project context on every session.

- [ ] **Step 1: Find the "Critical Rules" section**

Run: `grep -n "^## Critical Rules" CLAUDE.md`
Expected: one match, giving the line number of the section heading.

- [ ] **Step 2: Add two bullets**

Find the last bullet in the "Critical Rules" section (typically the "Run `make lint` before claiming work is done" bullet). Add the following two bullets after it, before the next `##` section:

```markdown
- **Never use `--no-verify` on commits or pushes.** The pre-commit hook is now read-only (lint + tsc, no fix) — if it fails, fix the underlying issue. Bypassing it is blocked by `.claude/settings.json` permissions.deny and will surface as a tool-call rejection.
- **Don't run `make fix` mid-task unless you're recovering from a commit rejection.** The Claude Code `Stop` / `SubagentStop` hooks run `agent-harness fix` at turn end automatically. If you do run fix during a turn (e.g., after a commit failed on formatting), re-Read every file you plan to edit next before editing — the fixer may have rewritten content.
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: CLAUDE.md — never --no-verify; don't run make fix mid-task"
```

---

### Task 5: End-to-end verification

**No file changes — purely verification.** Each step exercises one new behavior. If any fails, STOP and debug before declaring done.

- [ ] **Step 1: Verify read-only pre-commit accepts a no-op commit**

```bash
git commit --allow-empty -m "test: empty commit to exercise pre-commit"
```

Expected output includes:
- `agent-harness lint........Passed`
- `typecheck.................Passed`
- Commit succeeds.
- Does NOT include `auto-fix........Passed` (we removed it from pre-commit).

If `auto-fix` still appears, check that Task 1 Step 1's rewrite actually removed the `harness-fix` entry at the pre-commit stage.

- [ ] **Step 2: Verify pre-commit surfaces lint failures loudly (without rewriting)**

Introduce a deliberate lint error to trigger the check:

```bash
mkdir -p /tmp/hook-test && echo "const x=1" > /tmp/hook-test/probe.ts
# Pick any tracked TS file and temporarily break it:
cp apps/web/src/shared/api-client.ts apps/web/src/shared/api-client.ts.bak
printf '\n  const unused_var    =   1  ;\n' >> apps/web/src/shared/api-client.ts
git add apps/web/src/shared/api-client.ts
git commit -m "test: deliberate lint fail" || true
```

Expected: commit FAILS with biome/agent-harness reporting the style error. Critically, `apps/web/src/shared/api-client.ts` is UNCHANGED by the failed commit (this is the cache-coherence property the spec preserves).

Verify no silent rewrite:

```bash
diff apps/web/src/shared/api-client.ts apps/web/src/shared/api-client.ts.bak
```

Expected: diff shows ONLY the deliberate 2-line change we added. No formatting mutations.

Restore:

```bash
mv apps/web/src/shared/api-client.ts.bak apps/web/src/shared/api-client.ts
git reset HEAD apps/web/src/shared/api-client.ts
```

- [ ] **Step 3: Verify permissions.deny blocks `--no-verify` from inside Claude Code**

This step cannot be fully automated from inside this plan execution (Claude Code applies the deny rules when the agent tries to invoke Bash). Instead, document the expected behavior in the plan so a reviewer can confirm:

Attempt from inside Claude Code: `git commit --no-verify -m "test"`

Expected: Claude Code refuses to execute the Bash command and surfaces a permission-denied message matching one of the deny patterns (`Bash(git commit*--no-verify*)`). The commit does NOT land.

If the user runs this plan from a shell directly (not through Claude Code), the deny rule has no effect and the commit succeeds — that is correct: deny rules bind the agent, not the human.

- [ ] **Step 4: Verify the pre-push hook fires (no format-drift path)**

Pre-push hooks run only on `git push`. To verify locally without actually pushing to origin, push to a scratch remote:

```bash
# Ensure there's something to push (any commit made earlier in this plan counts)
git push --dry-run origin feat/template-reference-impl 2>&1 | head -20
```

Expected: prek fires the 4 pre-push hooks in order (`agent-harness fix (pre-push)`, `agent-harness lint (pre-push)`, `typecheck (pre-push)`, `no format drift (pre-push)`), all Pass, and then `--dry-run` short-circuits the actual network push.

If `agent-harness fix (pre-push)` produces any changes (it shouldn't, since all recent commits ran through the same fix at turn boundaries via the Stop hook), the `no format drift` step will fail with the remediation message from Task 1. That is the correct behavior.

- [ ] **Step 5: Mark plan complete**

Verify:
- [ ] `make lint` passes (same as before the change)
- [ ] `make test-unit` passes (unchanged — no code changes)
- [ ] All commits from Tasks 1–4 are on the branch
- [ ] `.git/hooks/pre-push` exists and is prek

Nothing else to commit.

---

## Verification checklist (mirrors spec's Verification section)

- [ ] `make lint` passes on a clean tree
- [ ] Pre-commit rejects format errors without mutating files (Task 5 Step 2)
- [ ] Pre-push runs fix + lint + drift check (Task 5 Step 4)
- [ ] `--no-verify` is denied inside Claude Code (Task 5 Step 3 — manual)
- [ ] Stop hook / SubagentStop hook is configured in `.claude/settings.json` (Task 3)
- [ ] `make setup` on a fresh clone installs both hooks (Task 2 — not re-tested here since this repo is not a fresh clone)

## Out-of-scope (deferred)

- Updating `superpowers:subagent-driven-development` skill to teach subagents the new commit protocol (spec §5, tracked as a separate signal-driven skill evolution).
- Wrapping `PreToolUse(Bash)` to scrub hook-disabling envs (spec §3 "Out of scope" — follow-up if env bypass becomes a real failure mode).
- Alternative C: `SubagentStop` hook that auto-amends format changes into the last commit (spec's Alternative C, deferred until dirty-tree-between-turns proves too confusing in practice).
