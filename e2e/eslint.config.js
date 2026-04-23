// ESLint flat config — e2e/ only. Complements Biome (which doesn't know
// Playwright semantics) with playwright-specific lint rules: web-first
// assertions, missing-await, raw-locator hygiene, no nth-methods.
//
// NOTE: Opt-in stricter rules (`no-raw-locators`, `no-nth-methods`) are
// set to `warn` until L4 migration lands. After L4 they flip to `error`.
// See docs/superpowers/plans/2026-04-22-e2e-locator-hygiene.
//
// Wired via root `lint:eslint-e2e` script + `//#lint:eslint-e2e` turbo
// task. Root `eslint.config.ts` intentionally ignores `e2e/**` — typed
// linting isn't configured here; we don't need it for these rules.

import playwright from "eslint-plugin-playwright";
import tseslint from "typescript-eslint";

export default [
  {
    ignores: [
      "node_modules/**",
      ".features-gen/**",
      "test-results/**",
      "visual-baselines/**",
      "playwright-report/**",
    ],
  },
  {
    ...playwright.configs["flat/recommended"],
    files: ["**/*.ts"],
  },
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
      },
    },
    rules: {
      // Opt-ins beyond `recommended` — stricter locator hygiene.
      // `warn` until L4 drains the backlog, then flip to `error`.
      "playwright/no-raw-locators": "warn",
      "playwright/no-nth-methods": "warn",
      // Also downgrade `recommended` rules that today's step defs violate
      // — we want the pipeline green while L4 is in flight.
      "playwright/no-wait-for-timeout": "warn",
      "playwright/missing-playwright-await": "warn",
      "playwright/prefer-web-first-assertions": "warn",
      "playwright/no-networkidle": "warn",
      "playwright/no-useless-not": "warn",
      "playwright/no-wait-for-selector": "warn",
      // BDD step defs legitimately call `expect` outside `test()` blocks —
      // each step is its own assertion site. This rule is a false positive
      // for the playwright-bdd pattern; keep off (not just `warn`).
      "playwright/no-standalone-expect": "off",
    },
  },
];
