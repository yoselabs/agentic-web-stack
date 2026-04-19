import { createRequire } from "node:module";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

// Resolve tslib's ESM entry explicitly so the SSR bundler doesn't pick
// up the CJS variant via a transitive `require("tslib")`. The CJS file
// sets `module.exports.__esModule = true`, which makes the bundler's
// `__toESM(...).default` interop shim return undefined — every Radix-
// using route then crashes at module load with
// "Cannot destructure property '__extends' of '__toESM(...).default'".
// Aliasing to the published `.mjs` (real ESM) makes the helpers
// destructure cleanly. Verified by node-loading the SSR chunk after
// `pnpm exec vite build`.
const require = createRequire(import.meta.url);
const tslibEsm = require.resolve("tslib/tslib.es6.mjs");

const config = defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: { tslib: tslibEsm },
  },
  plugins: [nitro(), tailwindcss(), tanstackStart(), viteReact()],
});

export default config;
