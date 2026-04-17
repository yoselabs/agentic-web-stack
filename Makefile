.PHONY: setup dev db db-push db-generate db-studio db-seed check lint fix test test-ui test-unit clean routes

# Zero-conf setup: clone → make setup → make dev
setup:
	cp -n .env.example .env 2>/dev/null || true
	cp -n packages/db/.env.example packages/db/.env 2>/dev/null || true
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
# Depends on db-generate so edits to schema.prisma propagate to types without
# a manual `make db-push`. `prisma generate` is ~100ms and idempotent.
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
# lint/fix depend on db-generate: `tsc -b` type-checks @project/db which imports
# the generated Prisma client. Edit schema → `make lint` without fresh client =
# stale type errors. Same rationale as dev/test targets below.
check: lint
lint: db-generate
	@agent-harness lint
	pnpm -w run typecheck
fix: db-generate
	@agent-harness fix
	pnpm -w run typecheck

# Unit / integration tests (vitest, uses isolated unit-suite Postgres, dynamic port per worktree — see scripts/test-db.ts)
# db-generate prerequisite: keeps Prisma client in sync with schema.prisma without
# requiring a manual `make db-push` before every test run.
test-unit: db-generate
	pnpm --filter @project/api test

# BDD Tests (uses separate test database, dynamic port per suite — see scripts/test-db.ts)
test: db-generate
	@pnpm exec tsx scripts/kill-ports.ts 3100 3101
	cd e2e && pnpm exec bddgen && pnpm exec playwright test
test-ui: db-generate
	@pnpm exec tsx scripts/kill-ports.ts 3100 3101
	cd e2e && pnpm exec bddgen && pnpm exec playwright test --ui

# Cleanup
clean:
	docker compose down -v
	@ids=$$(docker ps -aq --filter "name=agentic-postgres-test-" --filter "name=agentic-postgres-e2e-" --filter "name=agentic-postgres-unit-"); \
	  [ -n "$$ids" ] && docker rm -f $$ids || true
	rm -rf node_modules apps/*/node_modules packages/*/node_modules
	rm -rf apps/web/.output apps/web/dist apps/server/dist
