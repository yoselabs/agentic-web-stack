.PHONY: setup dev db db-push db-generate db-studio db-seed check lint fix test test-ui test-unit clean routes

# Zero-conf setup: clone → make setup → make dev
# .env file is NOT required — @project/env has Zod defaults for every dev var.
# .env.example is only a reference for prod deployments.
setup:
	pnpm install
	docker compose up -d
	@echo "Waiting for Postgres..."
	@until docker compose exec -T postgres pg_isready -U postgres > /dev/null 2>&1; do sleep 1; done
	pnpm -w run db:push
	$(MAKE) routes
	prek install
	@echo "✓ Ready. Run 'make dev' to start."

# Regenerate route tree (no dev server needed)
routes:
	@echo "Generating route tree..."
	@pnpm exec tsx scripts/generate-routes.ts

# Start both web and server
dev: db-generate
	@pnpm exec tsx scripts/kill-ports.ts 3000 3001
	pnpm -w run dev

# Database
db:
	docker compose up -d
db-push:
	pnpm -w run db:push
db-generate:
	pnpm -w run db:generate
db-studio:
	pnpm -w run db:studio
db-seed:
	pnpm -w run db:seed

# Quality gates
check: lint
lint: db-generate
	@agent-harness lint
	pnpm -w run typecheck
	@! rg 'process\.env\.' --type ts \
	    -g '!packages/env/**' -g '!scripts/**' \
	    -g '!**/vite.config.ts' -g '!**/vitest.config.ts' -g '!**/test-setup.ts' \
	    -g '!**/playwright.config.ts' \
	    -g '!packages/db/prisma.config.ts' \
	    -g '!node_modules' -g '!**/*.gen.*' \
	  || (echo "FAIL: process.env.X read outside @project/env — use env from @project/env/server or /client" && exit 1)
fix: db-generate
	@agent-harness fix
	pnpm -w run typecheck

# Unit / integration tests (vitest, isolated unit-suite Postgres via scripts/test-db.ts)
test-unit: db-generate
	pnpm --filter @project/api test

# BDD Tests (separate test database, dynamic port per suite via scripts/test-db.ts)
#
# Full suite:     make test
# Filtered run:   make test ARGS="--grep 'Create a todo'"
#                 make test ARGS="--project desktop"
#                 make test ARGS="--headed"
# ARGS forwarded to `playwright test` verbatim. See `playwright test --help`.
test: db-generate
	@eval "$$(pnpm exec tsx scripts/print-test-env.ts e2e)" && \
	  pnpm exec tsx scripts/kill-ports.ts $$TEST_WEB_PORT $$TEST_API_PORT
	cd e2e && pnpm exec bddgen && pnpm exec playwright test $(ARGS)
test-ui: db-generate
	@eval "$$(pnpm exec tsx scripts/print-test-env.ts e2e)" && \
	  pnpm exec tsx scripts/kill-ports.ts $$TEST_WEB_PORT $$TEST_API_PORT
	cd e2e && pnpm exec bddgen && pnpm exec playwright test --ui $(ARGS)

# Cleanup
clean:
	docker compose down -v
	@ids=$$(docker ps -aq --filter "name=agentic-postgres-test-" --filter "name=agentic-postgres-e2e-" --filter "name=agentic-postgres-unit-"); \
	  [ -n "$$ids" ] && docker rm -f $$ids || true
	rm -rf node_modules apps/*/node_modules packages/*/node_modules
	rm -rf apps/web/.output apps/web/dist apps/server/dist
