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

| Slot | Topic | Decision (proposed) | Spike |
|---|---|---|---|
| 0011 | HTTP framework — server-process | `@effect/platform` HttpServer (cond. on Phase 3 Better-Auth + Bull Board + ws spike) | **pending** — runs in Phase 3 first slice |
| 0013 | DB access | wrap Prisma behind `Db` Layer | optional — first slice IS the spike |
| 0014 | Schema validation | Effect Schema everywhere (cond. on bundle ≤70 KB delta in Phase 3 frontend build) | **pending** — measured in Phase 3 build |
| 0015 | Queue | wrap BullMQ behind `Queue` Layer; `Effect.Schedule` for retries | none |
| 0016 | Frontend Effect adoption | split per data shape — TanStack Query for RPC, `@effect/rx` for streams | optional — first slice IS the spike |
| 0018 | Realtime transport | `@effect/platform/Socket` + `Effect.Stream` (cond. on Phase 4 spike) | **pending** — runs in Phase 4 realtime walk |
| 0019 | Test runner (backend) | keep `bun test` + Effect helpers (per ADR-0003 60× speed) | optional — first slice tests ARE the spike |
| 0020 | Email send | wrap nodemailer behind `Mailer` Layer | none |
| 0021 | Rate limiting | wrap rate-limiter-flexible behind `RateLimiter` Layer | none |

Promoted to numbered slots in Phase 3:
- **0012** (RPC layer) — `docs/adrs/0012-rpc-layer.md`
- **0017** (Logger) — `docs/adrs/0017-logger.md`

**All 11 drafts present.** 5 are no-spike ADRs (research-validated or
synthesis from the Phase 1 design doc Q4). 6 carry an explicit
`spike_status: pending` or `spike_status: optional` in their frontmatter
— the spike now runs *as part of Phase 3 / Phase 4 implementation*
(the slice's code becomes the spike rather than throwaway). Each
pending draft's promotion checklist enumerates the spike outcomes that
must be confirmed before the draft can be flipped to `accepted`.

This is a deliberate workflow change from the original plan. Writing
all 11 ADRs in isolation upfront with throwaway spikes turned out to be
the wrong shape: the spikes are better paired with the code that uses
them. The drafts here capture defensible default leans + measurable
promotion criteria; the final accept happens commit-by-commit alongside
the implementing code.

## Promotion process (Phase 3)

For each draft promoted to a numbered slot:
1. Move file from `docs/adrs/draft/NNNN-*.md` → `docs/adrs/NNNN-*.md`
2. Flip `status: proposed` → `status: accepted`
3. Fill `verified_by:` with the now-existing file paths
4. Ensure each `verified_by` file contains an `ADR-NNNN` cite (or `@adr NNNN`)
5. Land the promotion commit with the implementing code, not separately
