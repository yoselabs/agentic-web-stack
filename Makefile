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

# Regenerate route tree without full dev server
# Uses port 4173 (not 0) so we can pre-kill stale processes and clean up reliably via lsof
routes:
	@echo "Generating route tree..."
	@lsof -ti :4173 | xargs kill 2>/dev/null || true
	@rm -f apps/web/src/routeTree.gen.ts; \
		pnpm --filter @project/web exec vite dev --port 4173 &; \
		TRIES=0; \
		while [ ! -f apps/web/src/routeTree.gen.ts ]; do \
			sleep 0.5; TRIES=$$((TRIES+1)); \
			if [ $$TRIES -ge 30 ]; then echo "ERROR: Route tree generation timed out after 15s"; lsof -ti :4173 | xargs kill 2>/dev/null; exit 1; fi; \
		done; \
		sleep 1; \
		lsof -ti :4173 | xargs kill 2>/dev/null || true

# Start both web and server
dev:
	@lsof -ti :3000,:3001 | xargs kill 2>/dev/null || true
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
	@lsof -ti :3100,:3101 | xargs kill 2>/dev/null || true
	cd e2e && pnpm exec bddgen && pnpm exec playwright test
test-ui:
	@lsof -ti :3100,:3101 | xargs kill 2>/dev/null || true
	cd e2e && pnpm exec bddgen && pnpm exec playwright test --ui

# Cleanup
clean:
	docker compose down -v
	rm -rf node_modules apps/*/node_modules packages/*/node_modules
	rm -rf apps/web/.output apps/web/dist apps/server/dist
