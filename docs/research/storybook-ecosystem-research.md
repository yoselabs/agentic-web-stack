# Storybook ecosystem — AI-agent-first perspective

**Scope.** Survey of the Storybook 9 ecosystem as of 2026-04, filtered
through one question: *what does an AI agent building or maintaining a
component in this template get from each addon / pattern?*

"Agent-specific win" is a high bar. The format for each candidate:

- **Name + version + upstream status.**
- **What it does** (one or two sentences).
- **Agent implication** — concrete mechanism: the agent sees X as
  text, generates Y, avoids Z class of mistake. If we can't articulate
  a mechanism, the honest answer is "human-only" and we say so.
- **Verdict for this template.** Ship / later / skip, with reason.

The template is `apps/web` — TanStack Start + React 19 + Vite. The
"AI agent" is a coding agent (Claude, Cursor, Copilot-class) reading
source + test output + tRPC router types to land a feature.

---

## Shipped in WS5 (baseline)

### CSF3 — Component Story Format 3 (v9.x, stable)

Typed story objects: `const meta = { title, component } satisfies Meta<typeof C>`.
Each story is `StoryObj<typeof meta>` with typed `args`/`argTypes`.

Agent implication: **STRONG.** CSF3 stories are deterministically
parseable from TypeScript types — no JSX scraping, no decorator
archaeology. An agent reading `navbar.stories.tsx` can answer "what
props does `Navbar` accept" from the story metadata alone. Contrast
with CSF2's `default.export = meta; export const Foo = Template.bind({})`
pattern, which required runtime reasoning.

Verdict: **SHIP.** Built into SB9; this is simply "write stories in
CSF3 always." Our exemplars do.

### `@storybook/addon-vitest` (v9.1.20, active)

Runs stories as Vitest test cases — one story = one test. Replaces
the Playwright-backed `@storybook/test-runner` of the SB8 era with
reuse of the project's existing Vitest worker pool.

Agent implication: **STRONG.** Failing a story test surfaces the
same `vitest run` output an agent already reads for unit tests — one
output format, one debugging workflow. No second test-runner to mock,
no second set of locators to learn. Also: `vitest --project storybook`
lets the agent run only the story lane for fast iteration (our config
uses projects).

Verdict: **SHIP.** Installed in WS5; see ADR-0006.

### `@storybook/addon-a11y` (v9.1.20, active)

Runs axe-core against every rendered story. With `test: "error"` in
`preview.parameters`, violations fail the story test, not just emit
panel warnings.

Agent implication: **STRONG.** axe violations come with rule IDs
(`button-name`, `color-contrast`, `label`), file paths to the failing
node, and links to the rule docs. When an agent's story fails on
a11y, the error already tells it *which rule*, *which DOM node*, *how
to fix* — more signal than most lint rules. Also: the agent is
biased to generate `<div>` + `onClick` without realizing; axe
catches that reliably.

Verdict: **SHIP.** Installed in WS5 at `test: "error"` (not the
default `"todo"`). See ADR-0006.

### Play functions + `storybook/test` (v9.x, active)

`play(async ({ canvasElement }) => { … })` runs an interaction
scenario after the story renders. `storybook/test` re-exports Testing
Library queries, `userEvent`, `expect`.

Agent implication: **STRONG.** Play functions are async, step-by-step
interaction scripts — exactly the shape an agent writes for unit
tests. The `within(canvas).getByRole('…')` convention scopes queries
to landmarks, mirroring the BDD step-def discipline
(`check-scoped-landmarks`) so the agent carries one query-writing
habit across both surfaces.

Verdict: **SHIP.** Used by our exemplar stories.

### Lost Pixel 3 (OSS, active)

Pixel-diff visual regression against the built Storybook bundle. Free
alternative to Chromatic.

Agent implication: **MIXED.** An agent gets *text* feedback on a
pixel diff poorly — "this PNG differs by 7%" is hard to act on
without the image in context. Useful as a release-gate but not an
edit-loop signal. See ADR-0006 for the "not in `make lint`" reason.

Verdict: **SHIP for release-gate, not edit loop.** Installed in WS5
behind `make visual-regression`.

---

## Addons worth shipping later

### `@storybook/addon-docs` + auto-docs (v9.x, active)

Auto-generates an MDX "Docs" tab from component TypeScript types +
JSDoc + the story metadata. No MDX hand-authoring; docs come from the
same source of truth the component uses.

Agent implication: **STRONG.** The generated docs are structured
markdown with prop tables derived from `react-docgen-typescript`
(our SB config opts into this parser explicitly). An agent pointing
to the docs page gets the full prop contract + each story's args
rendered in one document — agent-readable ground truth instead of
chasing imports. Crucially, hand-authored MDX is an *agent footgun*:
MDX mixes React + Markdown, parser errors are obscure, and agents
tend to generate invalid MDX.

Verdict: **LATER.** Worth enabling once we have ≥5 widgets. Blocker
today: SB9 auto-includes addon-docs in the bundle, but running it in
CI means a second Vite transform pass. Defer until we feel the pain.

### `@storybook/addon-coverage` (v1.x, active)

Istanbul coverage collected from story test runs. Reports file:line
gaps.

Agent implication: **MEDIUM.** Coverage gaps as `file:line` are in
the same shape lint reports take — an agent reading
`coverage/lcov-report` can identify untested branches. But: React
component coverage is noisy (every conditional-render branch counts)
and agents over-index on it, generating stories to paper over untouched
lines instead of thinking about state space.

Verdict: **LATER, optional.** Ship when we want a coverage ratchet;
skip until then.

### `@storybook/addon-themes` (v9.x, active)

Toggle between theme variants (light/dark/brand) via a toolbar; each
story can enumerate `globals: { theme }`.

Agent implication: **MEDIUM.** Dark-mode is exactly the class of
regression stories forget — an agent writing a component rarely
tests the dark palette. If the template ever ships dark mode, this
addon forces the theme axis into every story's visual test. Without
dark mode, pure overhead.

Verdict: **SKIP now, revisit when dark mode lands.**

---

## Addons that are human-only

### `@storybook/addon-interactions` (merged into core in v9)

Panel showing the play() step trace live. In SB9 this is no longer a
separate addon — the trace surfaces automatically in the test failure
output that addon-vitest emits.

Agent implication: the *panel* is a human debugging tool. The
underlying step-trace output (structured, emitted into
`test-results.json`) is what the agent reads — and that ships with
addon-vitest already. Calling "addon-interactions" out as shippable
double-counts the WS5 install.

Verdict: **SHIP (automatic via addon-vitest).** No separate install.

### `@storybook/addon-actions`

Logs `args` callbacks (e.g. `onClick`) to the panel.

Agent implication: **HUMAN-ONLY.** The panel is a visual affordance
— an agent running `vitest run` headless never sees it. Use `fn()`
from `storybook/test` (Vitest mocks) to assert callback invocations
instead; that surfaces in test output.

Verdict: **SKIP.**

### `@storybook/addon-controls`

Auto-generated knobs to edit `args` at runtime.

Agent implication: **HUMAN-ONLY.** Runtime arg editing matters for
design review, not for CI. Agents express arg variation via
*additional stories*, which is the right abstraction (enumerated,
committed, checked-in) rather than a live slider.

Verdict: **SKIP.**

### `@storybook/addon-backgrounds`, `@storybook/addon-viewport`

Toolbars for background color + viewport size.

Agent implication: **HUMAN-ONLY.** Same pattern — agents encode
these as additional stories (`Mobile`, `Desktop`, `OnDark`) rather
than toolbar affordances.

Verdict: **SKIP.**

### `@storybook/addon-designs` (Figma embed)

Embeds a Figma frame beside each story.

Agent implication: **HUMAN-ONLY.** Agents don't benefit from a Figma
thumbnail; when we need design-intent extractable to an agent, the
pattern is a JSDoc `@figma` cite plus a screenshot in the repo.

Verdict: **SKIP.**

---

## Visual regression comparison

### Lost Pixel vs Chromatic vs reg-suit

| Tool | Cost | Review UX | CI ergonomics | SB9 compat |
|---|---|---|---|---|
| **Lost Pixel** | OSS | Local diff images | One CLI, config file | Partial (LP 3.22 crawler lags SB9 index.json; workaround documented) |
| **Chromatic** | SaaS ($) | Best-in-class PR preview | One `chromatic` binary | First-class |
| **reg-suit** | OSS | Plugin-driven | More moving parts (storycap + publisher + notifier) | Via Storycap wrapper |

Agent implication: agents don't benefit from Chromatic's PR preview
UI (it's visual). All three write comparable machine-readable diff
reports. For a template, OSS wins — downstream products can upgrade
to Chromatic without changing story files. LP has a smaller config
surface than reg-suit.

Verdict: **Ship LP. Leave door open to Chromatic per-product.**

---

## Emerging (2025–2026) — watch, don't ship

### `@storybook/test-runner` (deprecated)

Superseded by `@storybook/addon-vitest` in the SB9 era. Stays in
npm for SB8 users.

Agent implication: using the deprecated runner adds a second test
infra (Playwright + separate `test-storybook` binary) — pure
duplication with Vitest.

Verdict: **SKIP.**

### Story-as-eval / LLM-eval addons

As of 2026-04, no mainstream Storybook addon explicitly exports
stories as LLM evals or integrates with eval harnesses (MLflow,
Langfuse). The Storybook GitHub Discussions and Discord have a
couple of prototypes (see *storybook-llm-snapshot*, *cucumber-sb*)
but nothing stable.

Agent implication: compelling in theory — a story IS a structured
input/output pair with typed args. Worth watching for the prevention
stack.

Verdict: **WATCH.** Revisit Q3 2026.

---

## argTypes: `react-docgen` vs `react-docgen-typescript`

Storybook infers `argTypes` from two possible sources:

- `react-docgen` — default, parses JS/JSX with PropTypes and limited
  TS type inference.
- `react-docgen-typescript` — parses TypeScript types directly via
  the TS compiler API. Slower but accurate.

Agent implication: **STRONG for `react-docgen-typescript`.** An agent
reading auto-generated argTypes trusts them only if they match the
real TS types. `react-docgen` falls back to `any` on non-trivial
generics; `react-docgen-typescript` resolves `ReactNode`, unions,
intersection types. Our `.storybook/main.ts` opts into the TS parser
explicitly.

Our SB config already picks the TS parser.

Verdict: **SHIP the TS parser.** Done.

---

## CSF indexing + bundle size

- **Lazy compilation** — SB9 compiles stories on-demand in the dev
  server; only the story you open is transformed. Ignorable for
  agents (they run headless Vitest, which transforms on test load).
- **Bundle size** — Storybook adds ~30 MB to `node_modules`. In
  `turbo prune`-based Docker builds the prod bundle doesn't carry
  stories.

Agent implication: neither affects agent authoring. Noted for
completeness.

Verdict: no action.

---

## Patterns worth propagating

A few disciplines generalize from WS5 to the broader template:

1. **Landmark-scoped queries.** Every play() function in our exemplar
   stories uses `within(canvas).getByRole('navigation').getBy…(…)`
   — the same `check-scoped-landmarks` rule we enforce on BDD step
   definitions. One query-writing habit; BDD and stories don't
   diverge.

2. **Seed-cache tRPC mocking.** `parameters.trpc.queries` entries
   point at `trpc.foo.bar.queryOptions().queryKey` with a data
   payload. The unit test's `renderWithTRPC({ seed })` takes the
   same shape. A seed authored for a story is interchangeable with
   a unit seed.

3. **CSF3 `satisfies Meta<typeof Component>` over type annotation.**
   `satisfies` preserves the literal arg shape for `StoryObj<typeof meta>`
   inference. A type annotation (`const meta: Meta<typeof C>`) erases
   it. Same rule as tRPC mutation options — `satisfies` wins for
   downstream generic inference.

4. **One assertion per play().** An agent writing 10 assertions in
   one play() gets a single-line failure like "assertion 7 failed"
   that's hard to diagnose. One story per distinct assertion is the
   SB equivalent of "one behavior per scenario" from
   `e2e/CLAUDE.md`.

5. **`no-test` tag for env-dependent stories.** When a story can
   render in the SB dev server but not under Vitest browser-mode
   (because it reads `process.env` at module init — see
   `app-navbar.stories.tsx`), tag it `no-test` and exclude the tag
   in `vitest.config.ts`'s storybook plugin options. The story still
   renders manually; the automated test lane is clean.

---

## Top-5 for the template

1. **addon-vitest** (already shipped).
2. **addon-a11y at `test: "error"`** (already shipped).
3. **`react-docgen-typescript` argTypes parser** (already shipped).
4. **addon-docs + auto-docs** — not yet. Worth revisiting when the
   widget count grows; blocker today is CI transform cost on top of
   the build-storybook step Lost Pixel already needs.
5. **Play-test + `storybook/test` landmark-scoped queries** — ship
   as convention (documented above); add to root `CLAUDE.md`
   alongside the BDD scoping rule so an agent picks up one habit
   across both surfaces.

## References

- `apps/web/.storybook/main.ts`, `preview.tsx` — live config.
- `apps/web/src/widgets/navbar.stories.tsx` — CSF3 + play() + landmark-scoping exemplar.
- ADR-0006 — shipping rationale.
- `docs/qa-strategy.md` §3.3, §3.6 — pyramid placement for stories and visual regression.
- Upstream deprecation note on test-runner: <https://storybook.js.org/blog/storybook-9/>.
