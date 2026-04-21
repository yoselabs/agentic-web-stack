#!/usr/bin/env bash
# Wrapper: run lychee against markdown files.
# Gracefully no-ops if lychee is not installed (CI-optional linter).
#
# Install:
#   brew install lychee                    # macOS
#   cargo install lychee                   # from source
#
# See .lychee.toml for config.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! command -v lychee >/dev/null 2>&1; then
  echo "[lint:links] lychee not installed — skipping (brew install lychee)"
  exit 0
fi

# Pass a github-token if available, to avoid 403 rate-limits against github.com.
ARGS=(--config .lychee.toml)
if [ -n "${GITHUB_TOKEN:-}" ]; then
  ARGS+=(--github-token "$GITHUB_TOKEN")
fi

exec lychee "${ARGS[@]}" \
  --exclude-path node_modules \
  --exclude-path .output \
  --exclude-path dist \
  --exclude-path .features-gen \
  --exclude-path generated \
  --exclude-path .claude/worktrees \
  --exclude-path .turbo \
  '**/*.md'
