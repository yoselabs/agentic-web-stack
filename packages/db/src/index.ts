// Phase-1 stub of the Effect-TS rewrite.
//
// During the rewrite (see
// docs/superpowers/specs/2026-04-28-effect-rewrite-phase-1-design.md),
// this file is reduced to a bare re-export of the generated Prisma
// client so kept consumers (notably packages/test-infra/src/fixtures/
// users.ts which imports `PrismaClient` as a type) continue to resolve.
//
// The singleton `db` instance + PrismaPg adapter + globalThis dev cache
// were removed; Phase 3 rebuilds them as part of the Effect `Db` Layer
// per ADR slot 0013.

export * from "./generated/client";
