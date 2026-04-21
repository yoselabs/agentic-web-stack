# Upstream watch

Third-party bugs and version-specific gotchas we've hit and worked around.
Each entry records what broke, where we worked around it, and the
condition under which the workaround can be removed.

This is a **living log**. Add an entry as soon as you work around an
upstream issue — future-you will not remember it in six months.

## Entry format

```md
### <short title>

- **Symptom:** what the bug looks like (error, wrong output, silent misbehavior)
- **Root cause:** upstream bug / quirk, with issue link if known
- **Workaround location:** repo path(s) where the workaround lives, with
  inline markers (`// upstream-watch: <title>`)
- **Remove when:** upstream fix shipped in version X / PR merged / ADR rewritten
```

---

### TanStack Router SSR — `Cannot destructure property '__extends'`

- **Symptom:** Nitro SSR bundle throws `Cannot destructure property '__extends' of 'tslib_1'` during `loadMatches`. Pre-render falls back cleanly so pages still ship, but the stderr is noisy and easy to mistake for a real failure.
- **Root cause:** Nitro's bundler chunks tslib in a way that collides with TanStack Router's SSR entry path. Reproduced under both Node and Bun runtimes — not a runtime bug. No upstream issue filed yet.
- **Workaround location:** `e2e/playwright.config.ts` (comment noting the noise is benign); no code-level fix needed, SSR fallback handles it.
- **Remove when:** TanStack Router ships a Nitro-friendly SSR entry, or we switch away from Nitro. Until then, keep the comment and don't grep for `__extends` as a failure signal in CI.

### `@arethetypeswrong/cli` — not applicable to workspace-only `.ts` packages

- **Symptom:** `attw --pack` on any workspace package reports `Resolution failed` for all node10/node16 scenarios, plus `CJSResolvesToESM` warnings.
- **Root cause:** Every `packages/*` and `apps/*` entry in this repo is `"private": true` with `"exports"` pointing directly at `.ts` source files. attw is designed for **published** packages that ship compiled `.js` + `.d.ts`. Since nothing is published and all consumers are bundlers (Vite, tsc -b, bun), node10/node16 resolution modes never run in practice.
- **Workaround location:** not installed. `make lint` does not run attw. Public-API correctness of the `exports` graph is still covered by `publint` (pack-mode).
- **Remove when:** any `packages/*` is promoted to a **published** package (e.g., an SDK). At that point, add a build step that emits `.js` + `.d.ts` to `dist/`, update `exports` to point at the built artifacts, reinstall `@arethetypeswrong/cli`, and wire it into `make lint` for the published package(s) only.

### Tailwind v4 + TanStack Start — CSS hash mismatch in Linux builds

- **Symptom:** The emitted CSS file's hash differs from the `<link rel="stylesheet" href="/assets/styles-<hash>.css">` reference when the prod bundle is built in Linux (Docker). Browser requests a hashed file that doesn't exist, falls back to unstyled HTML. Does not reproduce on macOS.
- **Root cause:** Tailwind v4's default content-scan base is the styles file's own directory. Under `source("./")` the base becomes the app root, which is what TanStack Start's asset manifest expects. Without it, the build graph disagrees with the runtime manifest on which file hashes into which.
- **Workaround location:** `apps/web/src/styles.css:1` — `@import "tailwindcss" source("./");`.
- **Remove when:** Tailwind v4 stabilizes the content-scan default, or TanStack Start documents the required source() shape. Until then: any new Tailwind entry point in this repo must begin with `source("./")`.
