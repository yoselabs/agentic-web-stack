#!/usr/bin/env bash
# Wrapper: run shellcheck over all tracked shell scripts.
# Gracefully no-ops if shellcheck is not installed (CI-optional linter).
#
# Install:
#   brew install shellcheck                # macOS
#   apt-get install shellcheck             # Debian/Ubuntu

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! command -v shellcheck >/dev/null 2>&1; then
  echo "[lint:shell] shellcheck not installed — skipping (brew install shellcheck)"
  exit 0
fi

# Collect tracked .sh files (git ls-files respects .gitignore).
mapfile -t FILES < <(git ls-files '*.sh')
if [ "${#FILES[@]}" -eq 0 ]; then
  echo "[lint:shell] no shell scripts found — skipping"
  exit 0
fi

exec shellcheck "${FILES[@]}"
