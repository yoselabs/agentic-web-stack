# ADR Drafts (Phase 2 of the Effect-TS rewrite)

ADR drafts produced during Phase 2 of the Effect-TS rewrite (per
[Phase 1 design doc](../../superpowers/specs/2026-04-28-effect-rewrite-phase-1-design.md)).

Each draft has status `proposed`. Promotion to a numbered slot
(`docs/adrs/0011-*.md` … `0021-*.md`, status `accepted`) happens in
Phase 3 alongside the code that implements the decision.

The `check-adrs` lint check only enforces `verified_by` on `accepted`
ADRs (see [`packages/lint/src/check-adrs.ts`](../../../packages/lint/src/check-adrs.ts)
line 65), so drafts can land without `verified_by` files existing.

## Drafts (in plan order)

| Slot | Topic | Status | Spike |
|---|---|---|---|
| 0011 | HTTP framework — server-process | **pending** | required (≤4h: `@effect/platform` HttpServer + Better-Auth + Bull Board mountability) |
| 0012 | RPC layer — tRPC + adapter vs `@effect/rpc` | drafted | none (Q5b research) |
| 0013 | DB access — Prisma wrapped vs `@effect/sql` | **pending** | optional (≤2h: 2-procedure example with `Db` Layer) |
| 0014 | Schema validation — Zod 4 vs Effect Schema | **pending** | required (≤4h: representative form bundle measurement) |
| 0015 | Queue — BullMQ wrapped vs `ClusterQueue` | drafted | none (ecosystem state confirmation) |
| 0016 | Frontend Effect adoption — `@effect/rx` vs TanStack Query | **pending** | optional (≤2h: `@effect/rx` ergonomics feel) |
| 0017 | Logger — pino vs Effect `Logger` | drafted | none |
| 0018 | Realtime transport — ws + Channel vs `@effect/platform` Stream | **pending** | required (≤4h: Socket end-to-end with browser ws client) |
| 0019 | Test runner (backend) — Bun vs `@effect/vitest` | **pending** | optional (≤2h: timing same suite under both runners) |
| 0020 | Email send — nodemailer wrapped | drafted | none |
| 0021 | Rate limiting — rate-limiter-flexible wrapped | drafted | none |

**5 drafted in this Phase 2 first batch** (no-spike ADRs whose decisions
are research-validated or follow naturally from the Phase 1 design doc's
Q4 commitment).

**6 pending** — the 4 spike-required ones (0011 HTTP, 0014 Schema, 0018
Realtime) and the 2 optional-spike ones (0013 DB, 0016 Frontend, 0019
Test runner) where the spike findings would materially improve the
draft. These get drafted in a follow-up Phase 2 batch when the spike
time is invested.

## Promotion process (Phase 3)

For each draft promoted to a numbered slot:
1. Move file from `docs/adrs/draft/NNNN-*.md` → `docs/adrs/NNNN-*.md`
2. Flip `status: proposed` → `status: accepted`
3. Fill `verified_by:` with the now-existing file paths
4. Ensure each `verified_by` file contains an `ADR-NNNN` cite (or `@adr NNNN`)
5. Land the promotion commit with the implementing code, not separately
