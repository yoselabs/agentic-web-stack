---
title: "ADR-0007 — Browser-mode component tests"
status: accepted
date: 2026-04-21
deciders: [denis]
verified_by:
  - apps/web/vitest.config.ts
  - apps/web/test/browser-render.tsx
# Phase 1 of the Effect-TS rewrite removed apps/web/test/authed-image.browser.test.tsx
# (it tested @project/media which was deleted). Phase 4 re-adds an exemplar
# browser test as the third verified_by entry once a real browser-only invariant
# returns. See docs/superpowers/specs/2026-04-28-effect-rewrite-phase-1-design.md
---

# ADR-0007 — Browser-Mode Component Tests

## Context

WS2 (ADR-0003) picked Vitest + happy-dom as the default web test
runner. WS5 (ADR-0006) added a second Vitest project — `storybook` —
running under `@vitest/browser` + playwright chromium so Storybook
stories execute as Vitest cases with a11y checks. Between them, two
gates cover most of the component-surface state space:

- `unit` (happy-dom) — pure logic + component rendering, hook tests.
- `storybook` (chromium) — enumerated render states + a11y.

A third class of bug escapes both:

1. **Cross-origin `<img>` credential mode.** A jsdom `<img>` never
   actually fetches. A test rendering `<img src="{signedUrl}">` can't
   tell whether the server returns 200, 401, or a CORS-rejected
   response. `naturalWidth > 0` is the only reliable "image decoded
   successfully" signal, and jsdom always returns `0`.
2. **Real CSS layout.** `IntersectionObserver`, `ResizeObserver`,
   flex/grid reflow, `getBoundingClientRect()` numbers — jsdom
   implements these as stubs or noops. A component that positions
   itself relative to a computed rect passes jsdom tests that lie.
3. **Clipboard + drag-and-drop.** The browser clipboard API and real
   pointer-event synthesis have no equivalent in jsdom. `@dnd-kit`
   works under jsdom only because we test the reducer, not the
   gesture.

Storybook stories could in principle cover (1)–(3) since they already
run in chromium, but conflating them breaks the story model: a story
is a *state enumeration + a11y exemplar*, not an invariant check
against a specific page mechanic. Mixing the two makes stories
harder to reason about and couples a11y gate flakes to network-shaped
invariants.

## Decision

Add a **third** Vitest project, `browser`, in
`apps/web/vitest.config.ts`, opt-in per component via the
`*.browser.test.tsx` filename suffix. Expose it via a new Makefile
target — `make test-browser` — that is NOT part of `make test-unit`
(real-browser tests are seconds-per-test; they belong alongside BDD
in the pre-merge lane, not in the edit loop).

### 1. Same chromium provider as `storybook`, different include

The `browser` project reuses `@vitest/browser` + `playwright`
chromium headless — the exact provider the `storybook` project
already starts for every `make test-unit` run. No new binary
downloads on first run for developers who've already run
`make test-unit` or `make test`. The only divergence is:

- `include: ["src/**/*.browser.test.tsx"]` (vs storybook plugin's
  auto-discovery of `*.stories.tsx`).
- Setup file: reuses `./test/setup.ts` (jest-dom + RTL cleanup).
  `vitest-browser-react` registers its own cleanup hooks, so RTL's
  `cleanup()` is a harmless no-op when no RTL tree was rendered.

### 2. `vitest-browser-react` for the render API

The render helper (`apps/web/test/browser-render.tsx`) wraps
`vitest-browser-react`'s `render()` — same `renderWithTRPC({ seed })`
signature as the jsdom helper so a component author working in both
projects doesn't context-switch. The returned locator API differs
from RTL's `getBy*` tree (`.element()` vs synchronous query methods),
but the divergence is intentional: locator properties reflect live
browser state (`el.naturalWidth`, `el.getBoundingClientRect()`),
which is the whole point of using this project.

### 3. Per-component opt-in, not a blanket migration

The default remains `*.test.tsx` in the jsdom `unit` project.
Browser-mode tests are reserved for:

- Components rendering user-content media (`<img>`, `<video>`,
  `<audio>`) through signed short-TTL URLs or cross-origin CDNs.
- Components whose correctness depends on real CSS layout values.
- Components exercising clipboard, drag-and-drop, or other browser
  APIs jsdom stubs away.

Everything else stays jsdom. A typical template fork is expected to
ship ~5–10 `*.browser.test.tsx` files, not hundreds. Scope: narrow
and intentional.

### 4. Relationship to the `storybook` project

Both run in chromium; the scopes do not overlap:

| Project | Purpose | Asserts |
|---|---|---|
| `storybook` | Enumerate render states of a widget | a11y via axe, visual states render without crash |
| `browser` | Real-browser invariant for a specific bug class | `naturalWidth`, computed layout, clipboard |

A widget with browser-mode tests still has stories. A component with
stories rarely needs browser-mode tests — only when (1)–(3) apply.

## Consequences

- **Positive.** The template ships a slot for bugs that were
  previously undetectable pre-merge, at zero cost to developers who
  don't need it (the `browser` project is empty save the exemplar
  until a fork opts in).
- **Positive.** Same chromium binary as `storybook` + BDD — no new
  Playwright install; cold run cost stays identical.
- **Positive.** `vitest-browser-react` keeps the
  `renderWithTRPC({ seed })` mental model intact across all three
  projects. Only the environment changes.
- **Negative.** `vitest-browser-react` is coupled to the vitest
  major (v1 → vitest 3, v2 → vitest 4). A future vitest bump will
  pull this along; annoying but bounded.
- **Negative.** A `.browser.test.tsx` run in the `unit` project would
  fail at `vitest-browser-react` import time (requires browser
  environment). The include glob + filename suffix keeps them
  segregated; no lint check added yet because one misplaced file
  fails fast with a clear error.

## Alternatives considered

- **Playwright component test runner (@playwright/experimental-ct-react).**
  Parallel test runner to vitest-browser-mode; would require a
  separate config, separate harness, and separate CI lane. The
  vitest-browser-mode path shares the runner, setup files, and
  render helpers we already maintain. Less infrastructure for the
  same capability.
- **Promote every jsdom test to browser mode.** ~10× slower per test,
  no incremental benefit for the 90%+ of tests that don't touch the
  bug classes above. Rejected as a blanket policy; available as a
  per-component opt-in.
- **Add invariant checks to stories.** Possible, but conflates the
  story's "state enumeration + a11y" contract with a specific
  invariant assertion. Stories stay declarative; browser-mode tests
  carry the procedural assertions.
- **Skip the gate, rely on BDD.** E2E catches image-load bugs, but
  seconds-per-test BDD overhead to prove `naturalWidth > 0` is
  disproportionate. Component-level is the right scope.

## References

- `apps/web/vitest.config.ts` — `browser` project definition.
- `apps/web/test/browser-render.tsx` — `renderWithTRPC` adapter for
  `vitest-browser-react`.
- `packages/media/src/authed-image.tsx` — reference stub component
  (minimal `<img>` wrapper; no attachment feature yet).
- `apps/web/test/authed-image.browser.test.tsx` — exemplar test
  asserting valid data URL → `naturalWidth > 0`, bogus URL →
  `naturalWidth === 0`, `alt` always rendered.
- `docs/qa-strategy.md` §3.4 — pyramid placement.
- `docs/adrs/0003-web-test-runner.md` — WS2 rationale (why Vitest at
  all).
- `docs/adrs/0006-storybook-and-visual-regression.md` — WS5 rationale
  (why a second chromium project for stories).
- Spec: `docs/superpowers/specs/2026-04-21-template-prevention-foundation-design.md` §4 WS6.
