.PHONY: help setup dev db db-push db-generate db-studio db-seed check lint fix test test-all test-ui test-unit clean routes

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
check: lint ## Alias for lint — full quality gate
lint: db-generate ## Run agent-harness + tsc + email-uniqueness + test-infra integrity + tRPC pattern guard
	@agent-harness lint
	pnpm -w run typecheck
	@bun e2e/scripts/check-feature-emails.ts
	@bun scripts/check-test-infra-integrity.ts
	@bun scripts/check-trpc-patterns.ts
fix: db-generate ## Auto-fix lint issues + typecheck
	@agent-harness fix
	pnpm -w run typecheck

# Unit / integration tests (bun test, isolated unit-suite Postgres via scripts/test-db.ts)
test-unit: db-generate ## Unit / integration tests via bun test (isolated unit-suite DB)
	pnpm --filter @project/api test

# Run both test suites sequentially. Useful for pre-merge confidence runs.
test-all: test-unit test ## Run unit + BDD suites (pre-merge confidence check)

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

# Cleanup
clean:
	docker compose down -v                                    # demo stack
	docker compose -f docker-compose.dev.yml down -v          # dev postgres
	@ids=$$(docker ps -aq --filter "name=agentic-postgres-test-" --filter "name=agentic-postgres-e2e-" --filter "name=agentic-postgres-unit-"); \
	  [ -n "$$ids" ] && docker rm -f $$ids || true
	rm -rf node_modules apps/*/node_modules packages/*/node_modules
	rm -rf apps/web/.output apps/web/dist apps/server/dist
