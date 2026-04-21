#!/usr/bin/env bash
# Wrapper: run actionlint against .github/workflows/.
# Preference order:
#   1. local `actionlint` binary (brew install actionlint / go install)
#   2. docker run rhysd/actionlint (no Go required)
#
# Exits 0 with a noop message if no .github/workflows/ exists yet.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORKFLOWS="$ROOT/.github/workflows"

if [ ! -d "$WORKFLOWS" ]; then
  echo "[actionlint] no .github/workflows/ — skipping"
  exit 0
fi

if command -v actionlint >/dev/null 2>&1; then
  exec actionlint -color "$WORKFLOWS"/*.yml "$WORKFLOWS"/*.yaml 2>/dev/null || exec actionlint -color
fi

if command -v docker >/dev/null 2>&1; then
  exec docker run --rm -v "$ROOT:/repo" -w /repo rhysd/actionlint:latest -color
fi

echo "[actionlint] neither 'actionlint' binary nor 'docker' available — install one of:" >&2
echo "  brew install actionlint       # macOS" >&2
echo "  go install github.com/rhysd/actionlint/cmd/actionlint@latest" >&2
echo "  (or install Docker)" >&2
exit 1
