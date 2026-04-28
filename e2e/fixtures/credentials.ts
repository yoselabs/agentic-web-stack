// Shared test credentials. Phase-1 stub of the Effect-TS rewrite: the
// canonical seed source `scripts/seed/seed.ts` was deleted with the
// service packages (api/auth/email/...). Phase 3 restores a seed module
// (likely under `packages/db/scripts/` or a fresh `scripts/seed/`) and
// re-points this re-export at it. For now the constants are inlined so
// e2e fixtures still resolve. See:
//   docs/superpowers/specs/2026-04-28-effect-rewrite-phase-1-design.md

export const SHARED_PASSWORD = "demo-password-123";
export const SEED_USER = {
  email: "denis@example.com",
  password: SHARED_PASSWORD,
} as const;
export const TEST_USER = {
  email: "test-user@example.com",
  password: SHARED_PASSWORD,
} as const;
