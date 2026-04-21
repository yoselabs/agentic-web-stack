---
title: "ADR-0006 — Storybook 9 and visual regression"
status: accepted
date: 2026-04-21
deciders: [denis]
verified_by:
  - apps/web/.storybook/preview.tsx
  - apps/web/src/widgets/navbar.stories.tsx
  - apps/web/lostpixel.config.ts
---

# ADR-0006 — Storybook 9 and Visual Regression

## Context

WS4 (ADR-0004) made every navbar / shell call-site fail compilation
when a slot is dropped. That closes the structural hole but not the
*render-time* one: a slot can be present, typed correctly, yet render
to an empty fragment — or a component's presentation can regress
without anyone noticing because no test rehearses the pixel output.

Three prevention gates are missing from the template:

1. **A render harness** that forces every widget to enumerate its real
   state space — LoggedOut, LoggedInBasic, LoggedInAdmin, WithPending,
   etc. A fork of the template will reuse the shell but the *states*
   it renders diverge per-product. The enumeration has to live beside
   the component so a new state isn't forgotten.
2. **An accessibility gate** that runs against every rendered state
   automatically, not only on the subset covered by BDD.
3. **A visual regression gate** that catches presentation changes —
   not in the edit loop (too slow) but before release.

All three want the *same* rendered surface: one story, exercised by
three consumers (visual inspection in Storybook dev, interaction +
a11y under Vitest, pixel diff under Lost Pixel). The choice is which
consumers to wire, not whether to render.

## Decision

Install **Storybook 9** (`@storybook/react-vite`) in `apps/web` and
wire three consumers against it.

### 1. `addon-vitest` over `@storybook/test-runner`

Storybook 9's `@storybook/addon-vitest` runs stories as Vitest test
cases inside the same worker pool the jsdom unit tests already use
(`apps/web/vitest.config.ts` declares two `projects`: `unit` and
`storybook`). The deprecated `@storybook/test-runner` required a
separate Playwright process plus a running Storybook dev server —
duplicate infra for the same rendering work. Addon-vitest is the
path SB9 ships on and avoids that fan-out.

The `storybook` project does run in **Vitest browser mode**
(`@vitest/browser` + `playwright` chromium headless), because
`@storybook/addon-vitest/vitest-plugin/test-utils` imports
`@vitest/browser/context` at load time — happy-dom and the forks pool
crash on that import. The `unit` project stays on happy-dom; the
browser mode is scoped to the storybook lane only.

`make test-unit` invokes `turbo run test` which hits `vitest run` for
`@project/web` → both projects run in parallel within one pnpm task.
No new Makefile target.

### 2. `addon-a11y` at `test: "error"`

The a11y addon defaults to `test: "todo"` which emits a panel warning
but does not fail the run. We promote it to `error` in
`.storybook/preview.tsx`:

```ts
parameters: {
  a11y: { config: { rules: [] }, options: {}, test: "error" },
}
```

Verified by a temporary probe (`a11y-probe.stories.tsx` rendering
`<button />` without a name) — the `button-name` rule fired, the
story test failed with axe's violation report, probe removed. The
harness guards against a11y drift for every state the stories
enumerate, not just the ones a BDD author thinks to scope.

addon-a11y's `afterEach` hook is registered explicitly in
`.storybook/vitest.setup.ts` via `setProjectAnnotations([a11yPreview,
localPreview])` — in the SB dev server the hook is wired by `main.addons`
auto-discovery, but under Vitest we have to opt in.

### 3. Lost Pixel OSS over Chromatic

Visual regression runs against the static Storybook build
(`pnpm build-storybook`) via `lost-pixel@^3`. Baselines are committed
under `e2e/visual-baselines/` (alongside the BDD artifacts); current +
diff dirs are gitignored.

**Why Lost Pixel over Chromatic:** Chromatic is a paid SaaS with
excellent UX and zero infra effort, but it's a hosted service —
against this template's "no vendor lock-in" constraint. Lost Pixel is
OSS, runs locally and in any CI, and its pixel-diff model is
comparable for widget-scale stories. The tradeoffs (no PR preview UI,
no reviewer UX) are acceptable for a template; downstream products
can migrate to Chromatic without changing story files.

**Why not in `make lint`:** pixel diffs are seconds-to-minutes and
flake on font/antialiasing drift between macOS and linux runners. The
edit loop can't afford either. `make visual-regression` is a separate
gate (docs/qa-strategy.md §3.6) run manually before release or in a
dedicated CI lane.

### 4. Stories run with jsdom tests in one pass

Two vitest projects, one `vitest run` invocation. Stories aren't a
separate lane in `make test-unit` / `make lint` — they are *the*
rendered-state gate, owned by the same pass that runs hook tests. A
forked project sees "tests" in one place, not "tests + stories +
component tests" spread across scripts.

## Consequences

- **Positive.** Every widget's rendered-state space becomes part of
  the test matrix. `check-stories-siblings` (WS1) enforces that a new
  widget lands with stories on day one; addon-a11y ensures those
  stories don't regress on accessibility; Lost Pixel catches
  presentation drift before release.
- **Positive.** Stories double as AI-agent documentation — the
  `satisfies Meta<typeof Component>` contract + CSF3 typed args give
  an agent the *real* prop shape of a component without needing to
  parse JSX. See `docs/storybook-ecosystem-research.md`.
- **Positive.** A story's `parameters.trpc.queries` seed is the same
  shape as a unit test's `renderWithTRPC({ seed })` — mocking is one
  pattern across both surfaces.
- **Negative.** Storybook adds ~30 MB to `node_modules`. Mitigated by
  `turbo prune` in Docker builds — stories are dev-only, the prod
  bundle doesn't carry them.
- **Negative.** The `storybook` vitest project runs in browser mode,
  so the first-time local run downloads chromium via Playwright (~170
  MB). Developers running `make test` already have chromium cached
  from BDD; the overlap is zero-cost.
- **Negative.** `AppNavbar` is tagged `no-test` — `@project/env/client`
  touches `process.env` at module init which crashes in browser-mode
  Vitest. A small cleanup in `packages/env/src/client.ts` (use
  `(globalThis as any).process?.env` guards) would unblock it; tracked
  as follow-up, not blocking this ADR.

## Alternatives considered

- **`@storybook/test-runner`.** Same Playwright + Storybook dev server
  combo as addon-vitest but as a separate test harness. Deprecated in
  the SB9 era in favor of addon-vitest; the handover called it out.
- **Chromatic.** Best-in-class visual review UX but paid SaaS. Revisit
  if a downstream product wants it — story files don't change.
- **reg-suit + Storycap.** OSS alternative to Chromatic that many
  repos use. Lost Pixel's config surface is smaller (single TS file
  vs reg-suit's plugin tree) and its Storybook integration is
  first-class; we picked the smaller moving parts.
- **No stories, just jsdom tests.** Loses the visual/manual review
  surface + the a11y gate (no DOM for axe) + the forced state
  enumeration (`check-stories-siblings` has nothing to enforce).
- **Happy-dom for the storybook project.** Tried first. `@vitest/browser/context`
  crashes at import-time outside browser mode; the addon explicitly
  only ships the browser path.

## References

- `apps/web/.storybook/main.ts` — framework + addons config.
- `apps/web/.storybook/preview.tsx` — `withTRPC` decorator + `a11y.test: "error"`.
- `apps/web/.storybook/vitest.setup.ts` — `setProjectAnnotations` wiring.
- `apps/web/vitest.config.ts` — the `storybook` project (browser mode).
- `apps/web/lostpixel.config.ts` — visual-regression config.
- `apps/web/src/widgets/navbar.stories.tsx` — the exemplar CSF3 story set (LoggedOut / LoggedInBasic / LoggedInAdmin).
- `scripts/check-stories-siblings.ts` — enforces every widget has a `.stories.tsx` sibling.
- `docs/storybook-ecosystem-research.md` — survey of SB9 addons with AI-agent implications.
- `docs/qa-strategy.md` §3.3 + §3.6 — pyramid placement.
- Spec: `docs/superpowers/specs/2026-04-21-template-prevention-foundation-design.md` §4 WS5.
