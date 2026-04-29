.PHONY: help setup dev db db-push db-generate db-studio db-seed check lint lint-verbose lint-force lint-deep fix test test-all test-ui test-unit test-browser test-checks smoke similar clean routes storybook build-storybook visual-regression

.DEFAULT_GOAL := help

# Print a self-generated help listing. Annotate any target you want listed
# with `## description` at the end of the target line.
help: ## Show this help
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

# Zero-conf setup: clone → make setup → make dev
# .env file is NOT required — @project/env has Zod defaults for every dev var.
# .env.example is only a reference for prod deployments.
setup: ## Zero-conf: deps + Postgres + schema + hooks (runs prereq checks)
	@command -v bun >/dev/null 2>&1 || { echo "✗ bun is required — install via 'brew install bun' or 'curl -fsSL https://bun.sh/install | bash'"; exit 1; }
	@command -v docker >/dev/null 2>&1 || { echo "✗ docker is required — install Docker Desktop or OrbStack"; exit 1; }
	pnpm install
	docker compose -f docker-compose.dev.yml up -d
	@echo "Waiting for Postgres..."
	@until docker compose -f docker-compose.dev.yml exec -T postgres pg_isready -U postgres > /dev/null 2>&1; do sleep 1; done
	pnpm -w run db:push
	$(MAKE) routes
	prek install --hook-type pre-commit --hook-type pre-push
	@echo "✓ Ready. Run 'make dev' to start."

# Regenerate route tree (no dev server needed)
routes: ## Regenerate TanStack router route tree
	@echo "Generating route tree..."
	@bun scripts/dev/generate-routes.ts

# Start dev processes (web + API server in parallel).
dev: db-generate ## Start web (3000) + server (3001) in watch mode
	@bun scripts/dev/kill-ports.ts 3000 3001
	pnpm -w run dev

# Database
db:
	docker compose -f docker-compose.dev.yml up -d
db-push:
	pnpm -w run db:push
db-generate:
	pnpm -w run db:generate
db-studio:
	pnpm -w run db:studio
db-seed:
	pnpm -w run db:seed

# Quality gates
#
# `make lint` → turbo orchestrator. Parallel by default, per-task input-hash
# caching (subsequent runs on unchanged files = instant). Silent on success
# to keep AI/CI logs tight; full logs only on failure.
#
# Root-only tasks (no per-package lint scripts — adding a new package
# requires zero lint setup; adding a new linter = one task in turbo.json
# + one root script in package.json).
#
# Escape hatches:
#   make lint-verbose — full output even for cached/successful tasks
#   make lint-force   — bypass cache, force fresh run
#
# `make fix` is SEPARATE — lint is read-only (reports what's wrong);
# fix is the explicit transform step (auto-formatters, import sorters).
# Never run auto-fix as part of lint.
TURBO_LINT_TASKS = lint:biome lint:tsc lint:prisma lint:knip lint:jscpd lint:sherif lint:publint lint:depcruise lint:eslint-e2e lint:gherkin lint:secretlint lint:actionlint lint:markdown lint:links lint:spell lint:shell lint:check:no-barrel lint:check:server-bind lint:check:domain-names lint:check:trpc-patterns lint:check:test-infra-integrity lint:check:feature-emails lint:check:duplicate-names lint:check:no-cwd lint:check:test-siblings lint:check:stories-siblings lint:check:env-example lint:check:adrs lint:check:state-machines lint:check:pitch-coverage lint:check:scoped-landmarks lint:check:perspective-boundary

check: lint ## Alias for lint — full quality gate
lint: db-generate ## Full lint gate (turbo-cached; silent on success, errors only)
	@set -a; . .config/lint.env; set +a; pnpm exec turbo run $(TURBO_LINT_TASKS) --output-logs=errors-only --log-order=grouped
lint-verbose: db-generate ## Lint with full output (for debugging)
	@set -a; . .config/lint.env; set +a; pnpm exec turbo run $(TURBO_LINT_TASKS) --log-order=grouped
lint-force: db-generate ## Bypass turbo cache, force a fresh run
	@set -a; . .config/lint.env; set +a; pnpm exec turbo run $(TURBO_LINT_TASKS) --output-logs=errors-only --log-order=grouped --force

# Deep-scan lint — typed-linting rules from ESLint / typescript-eslint that
# Biome doesn't have parity for yet. Runs on-demand (not in make lint, not in
# pre-commit); typed linting needs an 8GB heap and 15-20s on our tree.
# Today's rule set:
# - @typescript-eslint/no-deprecated — full coverage of deprecated call /
#   member-access usage (Biome's noDeprecatedImports catches import sites only).
# Add more cherry-picked typed rules in eslint.config.ts as future gaps
# appear — this target is the carrier.
lint-deep: db-generate ## Deep-scan lint (typed-linting; slower, on-demand)
	@NODE_OPTIONS="--max-old-space-size=8192" pnpm exec eslint .

fix: db-generate ## Auto-fix lint issues + typecheck
	@agent-harness fix
	pnpm -w run typecheck

# Unit / integration tests — heterogeneous:
# - @project/api uses `bun test` (Prisma-heavy, native DB speed)
# - @project/web uses Vitest (Vite plugin reuse + React 19 + RTL interop)
# See docs/adrs/0003-web-test-runner.md.
test-unit: db-generate ## Unit tests: @project/web (Vitest) + @project/lint (Bun) in parallel
# Phase 1 of the Effect-TS rewrite (per design doc) deleted @project/api;
# Phase 3 reintroduces it (or its Effect-native replacement) and re-adds
# the filter here.
	pnpm exec turbo run test --filter=@project/web --filter=@project/lint --log-order=grouped

# Real-Chromium component tests. Opt-in per component via the
# `*.browser.test.tsx` suffix. Separate from `make test-unit` — real
# Chromium is seconds-per-test, too slow for the edit loop. Runs
# alongside BDD in the pre-merge lane. See ADR-0007 +
# docs/qa-strategy.md §3.4.
test-browser: db-generate ## Real-Chromium component tests (*.browser.test.tsx)
	pnpm --filter @project/web exec vitest run --project browser

# Unit tests for the custom-check modules themselves (bun test).
test-checks: ## Unit tests for @project/lint fixture tests
	pnpm --filter @project/lint test

# Run all test suites sequentially. Useful for pre-merge confidence runs.
test-all: test-unit test-browser test-checks test ## Run unit + browser + checks + BDD suites (pre-merge confidence check)

# BDD Tests (separate test database, dynamic port per suite via scripts/test-db.ts)
#
# Full suite:     make test
# Filtered run:   make test ARGS="--grep 'Create a todo'"
#                 make test ARGS="--project desktop"
#                 make test ARGS="--headed"
# ARGS forwarded to `playwright test` verbatim. See `playwright test --help`.
# Phase 1 of the Effect-TS rewrite gates `make test` and `make test-ui`
# under WIPE_IN_PROGRESS=1 because:
#   - e2e/steps/ has been deleted, so bddgen errors on "missing step
#     bindings" (Task 1 finding B in the Phase 1 design doc)
#   - e2e/playwright.config.ts launches @project/server + @project/web
#     for the webServer config; @project/server is gone (Task 5)
# Both gates are removed in Phase 3 once the first vertical slice
# restores step defs + a runnable apps/server.
test: db-generate ## BDD tests (isolated test DB, builds web app). ARGS forwarded to playwright.
	@set -a; . .config/lint.env; set +a; \
	  if [ "$$WIPE_IN_PROGRESS" = "1" ]; then \
	    echo "[make test] skipped — wipe in progress (Phase 1 design doc)"; \
	    exit 0; \
	  fi; \
	  bun scripts/dev/kill-ports.ts --suite=e2e && \
	  cd e2e && pnpm exec bddgen && pnpm exec playwright test $(ARGS)
test-ui: db-generate ## BDD tests in Playwright interactive UI mode
	@set -a; . .config/lint.env; set +a; \
	  if [ "$$WIPE_IN_PROGRESS" = "1" ]; then \
	    echo "[make test-ui] skipped — wipe in progress (Phase 1 design doc)"; \
	    exit 0; \
	  fi; \
	  bun scripts/dev/kill-ports.ts --suite=e2e && \
	  cd e2e && pnpm exec bddgen && pnpm exec playwright test --ui $(ARGS)

# Smoke subset — scenarios tagged @smoke in Gherkin. Runs against whatever
# target BASE_URL points at (local dev by default, deployed env when set in
# CI). Not hermetic — expects a populated target — so it does NOT spin up
# the test DB harness. Use `make test` for the hermetic full suite.
#
# Usage:
#   make smoke                                    # local target, default BASE_URL
#   BASE_URL=https://staging.example.com make smoke
smoke: ## Run @smoke-tagged BDD scenarios against BASE_URL (local by default)
	cd e2e && pnpm exec bddgen && pnpm exec playwright test --grep @smoke $(ARGS)

# Advisory reuse-finder. Writes markdown to stdout + .similar-report.json.
# Before creating a new function/component, check for existing reuse options.
similar: ## Report similarly-named functions/components/hooks/types (advisory)
	@bun scripts/dev/find-similar.ts

# Storybook + visual regression
#
# `make test-unit` already runs the addon-vitest suite alongside the
# jsdom unit tests (both are projects in `apps/web/vitest.config.ts`),
# so no separate story-test target is needed for the edit loop.
#
# Visual regression is out of the edit loop — see docs/qa-strategy.md
# §3.6 and ADR-0006.
storybook: ## Start Storybook dev server on :6006
	pnpm --filter @project/web run storybook
build-storybook: ## Build the static Storybook bundle (apps/web/storybook-static)
	pnpm --filter @project/web run build-storybook
visual-regression: build-storybook ## Visual regression via Lost Pixel against the static Storybook build
	pnpm --filter @project/web exec lost-pixel --config-file lostpixel.config.ts

# Cleanup
clean:
	docker compose down -v                                    # demo stack
	docker compose -f docker-compose.dev.yml down -v          # dev postgres
	@ids=$$(docker ps -aq --filter "name=agentic-postgres-test-" --filter "name=agentic-postgres-e2e-" --filter "name=agentic-postgres-unit-"); \
	  [ -n "$$ids" ] && docker rm -f $$ids || true
	rm -rf node_modules apps/*/node_modules packages/*/node_modules
	rm -rf apps/web/.output apps/web/dist
