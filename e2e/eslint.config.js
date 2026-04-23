// ESLint flat config — e2e/ only. Complements Biome (which doesn't know
// Playwright semantics) with playwright-specific lint rules: web-first
// assertions, missing-await, raw-locator hygiene, no nth-methods.
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
      // Opt-ins beyond `recommended` — stricter locator hygiene. Both
      // promoted to `error` after L4 drained the step-def backlog to 0.
      // Inline `eslint-disable-next-line` with a reason is the sanctioned
      // escape for positional assertions (DnD reorder) and WS-handshake
      // settle windows that have no DOM signal.
      "playwright/no-raw-locators": "error",
      "playwright/no-nth-methods": "error",
      // `recommended` rules — promoted from `warn` to `error` together
      // with the opt-ins so the whole gate trips CI on new violations.
      "playwright/no-wait-for-timeout": "error",
      "playwright/missing-playwright-await": "error",
      "playwright/prefer-web-first-assertions": "error",
      "playwright/no-networkidle": "error",
      "playwright/no-useless-not": "error",
      "playwright/no-wait-for-selector": "error",
      // BDD step defs legitimately call `expect` outside `test()` blocks —
      // each step is its own assertion site. This rule is a false positive
      // for the playwright-bdd pattern; keep off (not just `warn`).
      "playwright/no-standalone-expect": "off",
    },
  },
];
