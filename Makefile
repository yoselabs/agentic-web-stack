.PHONY: setup dev db db-push db-generate db-studio db-seed check typecheck lint fix test test-ui test-unit clean routes

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
	@pnpm exec tsx scripts/generate-routes.ts

# Start both web and server
dev:
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
check: lint typecheck
lint:
	@agent-harness lint
fix:
	@agent-harness fix
typecheck:
	pnpm -w run typecheck

# Unit / integration tests (vitest, uses dev database on port 5432)
test-unit:
	pnpm --filter @project/api test

# BDD Tests (uses separate test database on port 5433)
test:
	@pnpm exec tsx scripts/kill-ports.ts 3100 3101
	cd e2e && pnpm exec bddgen && pnpm exec playwright test
test-ui:
	@pnpm exec tsx scripts/kill-ports.ts 3100 3101
	cd e2e && pnpm exec bddgen && pnpm exec playwright test --ui

# Cleanup
clean:
	docker compose down -v
	rm -rf node_modules apps/*/node_modules packages/*/node_modules
	rm -rf apps/web/.output apps/web/dist apps/server/dist
