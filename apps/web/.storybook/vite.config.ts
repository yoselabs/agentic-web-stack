import { createRequire } from "node:module";
import tailwindcss from "@tailwindcss/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Dedicated Vite config for Storybook's builder.
//
// `apps/web/vite.config.ts` wires `@tanstack/react-start` + `nitro` +
// `@tanstack/router-plugin`, all of which assume one app-entry client
// build. Storybook's builder emits one entry per story, which crashes
// the TanStack-Start `capture-bundle` hook and the router-generator's
// config-context discovery.
//
// Stories only need: React transform + Tailwind (styles shared with
// the app) + the `tslib` ESM alias (see the app's vite.config.ts for
// the `__toESM` interop rationale — transitively pulled through Radix
// via the shadcn Sheet used by `MobileNav`).
//
// See docs/adrs/0006-storybook-and-visual-regression.md.
const require = createRequire(import.meta.url);
const tslibEsm = require.resolve("tslib/tslib.es6.mjs");

export default defineConfig({
  resolve: {
    alias: { tslib: tslibEsm },
  },
  plugins: [viteReact(), tailwindcss()],
});
