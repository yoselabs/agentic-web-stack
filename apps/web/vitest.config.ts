import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { storybookTest } from "@storybook/addon-vitest/vitest-plugin";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Vitest config for apps/web.
//
// NOT a `mergeConfig(viteConfig, ...)` — the app's `vite.config.ts` pulls in
// `nitro` and `tanstack-start`, both of which start long-lived workers
// (SSR server, generators) that prevent Vitest from exiting cleanly
// ("close timed out after 10000ms"). For unit tests we only need JSX
// transform + the `tslib` ESM alias (see `vite.config.ts` for the
// `__toESM` interop rationale).
//
// See docs/adrs/0003-web-test-runner.md.
//
// This config declares TWO test projects that run in the same Vitest
// worker pool via `test.projects`:
//
// 1. `unit`    — jsdom-style unit tests (`src/**/*.test.{ts,tsx}`) under happy-dom.
// 2. `storybook` — Storybook 9 stories executed via `@storybook/addon-vitest`.
//
// Both run in one `make test-unit` pass. See ADR-0006 for the rationale
// (single worker pool avoids the duplicate-infra cost of the deprecated
// `@storybook/test-runner`).

const require = createRequire(import.meta.url);
const tslibEsm = require.resolve("tslib/tslib.es6.mjs");
const dirname = fileURLToPath(new URL(".", import.meta.url));

// Shared Vite-level config — resolve aliases + React plugin. Both
// projects need these so story files + unit tests agree on module
// resolution.
const sharedPlugins = [
  // biome-ignore lint/suspicious/noExplicitAny: vitest/config re-exports vite
  // types that don't line up with @vitejs/plugin-react's Plugin<any>[] return
  // type (rolldown vs rollup context meta). Runtime is fine; the cast keeps
  // tsc quiet.
  viteReact() as any,
];
const sharedResolve = { alias: { tslib: tslibEsm } };

// `storybookTest()` is async in SB 9.1 — it imports the Storybook config
// to derive per-story test entries before returning a plugin list. We
// resolve the Promise once at module init and pass the result into the
// projects `plugins` array.
const storybookPlugins = await storybookTest({
  configDir: `${dirname}/.storybook`,
  // Stories tagged `no-test` are excluded from the Vitest run. Use this
  // for stories that render fine in the SB dev server but require
  // browser-only APIs (e.g. `@project/env/client` reads `import.meta.env`
  // which Vite handles, but the session-aware `AppNavbar` reaches into
  // Better-Auth state that has no sensible mock yet).
  tags: { exclude: ["no-test"] },
});

export default defineConfig({
  plugins: sharedPlugins,
  resolve: sharedResolve,
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "happy-dom",
          setupFiles: ["./test/setup.ts"],
          globals: false,
          css: false,
          include: ["src/**/*.test.{ts,tsx}"],
        },
      },
      {
        extends: true,
        // biome-ignore lint/suspicious/noExplicitAny: the storybook plugin's
        // Plugin<any>[] type targets an older vite range; runtime is fine.
        plugins: storybookPlugins as any,
        test: {
          name: "storybook",
          // Storybook's addon-vitest requires Vitest browser mode — its
          // runtime `@vitest/browser/context` dependency can't boot in
          // the forks pool. We use `@vitest/browser` + `playwright`,
          // which this repo already carries (see `@vitest/browser` in
          // the root catalog; `playwright` from `e2e/`). Headless by
          // default; the CI lane still runs this pass alongside the
          // `unit` project, so stories + jsdom hook tests remain one
          // `make test-unit` invocation.
          browser: {
            enabled: true,
            provider: "playwright",
            headless: true,
            // biome-ignore lint/suspicious/noExplicitAny: browser.instances is
            // typed on @vitest/browser for the v3 surface but the vitest
            // re-export lags; runtime contract matches.
            instances: [{ browser: "chromium" }] as any,
          },
          setupFiles: ["./.storybook/vitest.setup.ts"],
          globals: false,
        },
      },
    ],
  },
});
