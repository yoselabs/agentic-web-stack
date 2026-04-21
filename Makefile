.PHONY: help setup dev db db-push db-generate db-studio db-seed check lint lint-verbose lint-force fix test test-all test-ui test-unit test-checks smoke similar clean routes

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
	@bun scripts/generate-routes.ts

# Start both web and server
dev: db-generate ## Start web (3000) + server (3001) in watch mode
	@bun scripts/kill-ports.ts 3000 3001
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
TURBO_LINT_TASKS = lint:biome lint:tsc lint:prisma lint:knip lint:jscpd lint:sherif lint:publint lint:depcruise lint:secretlint lint:actionlint lint:check:no-barrel lint:check:server-bind lint:check:domain-names lint:check:trpc-patterns lint:check:test-infra-integrity lint:check:feature-emails lint:check:duplicate-names

check: lint ## Alias for lint — full quality gate
lint: db-generate ## Full lint gate (turbo-cached; silent on success, errors only)
	@pnpm exec turbo run $(TURBO_LINT_TASKS) --output-logs=errors-only --log-order=grouped
lint-verbose: db-generate ## Lint with full output (for debugging)
	@pnpm exec turbo run $(TURBO_LINT_TASKS) --log-order=grouped
lint-force: db-generate ## Bypass turbo cache, force a fresh run
	@pnpm exec turbo run $(TURBO_LINT_TASKS) --output-logs=errors-only --log-order=grouped --force

fix: db-generate ## Auto-fix lint issues + typecheck
	@agent-harness fix
	pnpm -w run typecheck

# Unit / integration tests — heterogeneous:
# - @project/api uses `bun test` (Prisma-heavy, native DB speed)
# - @project/web uses Vitest (Vite plugin reuse + React 19 + RTL interop)
# See docs/adrs/0003-web-test-runner.md.
test-unit: db-generate ## Unit tests: @project/api (Bun) + @project/web (Vitest) in parallel
	pnpm exec turbo run test --filter=@project/api --filter=@project/web --log-order=grouped

# Unit tests for the custom-check modules themselves (bun test).
test-checks: ## Unit tests for scripts/check-*.ts modules
	@bun test scripts/__tests__/

# Run both test suites sequentially. Useful for pre-merge confidence runs.
test-all: test-unit test-checks test ## Run unit + checks + BDD suites (pre-merge confidence check)

# BDD Tests (separate test database, dynamic port per suite via scripts/test-db.ts)
#
# Full suite:     make test
# Filtered run:   make test ARGS="--grep 'Create a todo'"
#                 make test ARGS="--project desktop"
#                 make test ARGS="--headed"
# ARGS forwarded to `playwright test` verbatim. See `playwright test --help`.
test: db-generate ## BDD tests (isolated test DB, builds web app). ARGS forwarded to playwright.
	@bun scripts/kill-ports.ts --suite=e2e
	cd e2e && pnpm exec bddgen && pnpm exec playwright test $(ARGS)
test-ui: db-generate ## BDD tests in Playwright interactive UI mode
	@bun scripts/kill-ports.ts --suite=e2e
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
	@bun scripts/find-similar.ts

# Cleanup
clean:
	docker compose down -v                                    # demo stack
	docker compose -f docker-compose.dev.yml down -v          # dev postgres
	@ids=$$(docker ps -aq --filter "name=agentic-postgres-test-" --filter "name=agentic-postgres-e2e-" --filter "name=agentic-postgres-unit-"); \
	  [ -n "$$ids" ] && docker rm -f $$ids || true
	rm -rf node_modules apps/*/node_modules packages/*/node_modules
	rm -rf apps/web/.output apps/web/dist apps/server/dist
