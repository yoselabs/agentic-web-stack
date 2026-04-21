import { createRequire } from "node:module";
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
// If `mergeConfig` ever becomes viable (e.g., tanstack-start ships a
// `lazy` option), revisit this — the spec WS2 originally called for it.
//
// See docs/adrs/0003-web-test-runner.md.
const require = createRequire(import.meta.url);
const tslibEsm = require.resolve("tslib/tslib.es6.mjs");

// biome-ignore lint/suspicious/noExplicitAny: vitest/config re-exports vite
// types that don't line up with @vitejs/plugin-react's Plugin<any>[] return
// type (rolldown vs rollup context meta). Runtime is fine; the cast keeps
// tsc quiet.
export default defineConfig({
  plugins: [viteReact() as any],
  resolve: {
    alias: { tslib: tslibEsm },
  },
  test: {
    environment: "happy-dom",
    setupFiles: ["./test/setup.ts"],
    globals: false,
    css: false,
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
