// Cherry-pick ESLint config — used only for rules Biome doesn't cover.
// Today: `@typescript-eslint/no-deprecated` (full coverage of deprecated
// call / member access, not just imports — see biome.json's
// `noDeprecatedImports` which handles the import site only).
//
// Typed linting requires `parserOptions.projectService: true` so tsc's
// type system is available to the rule — this is what lets us flag
// `obj.deprecatedMethod()` (symbol resolution) on top of
// `import { deprecated }` (name resolution).

import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.output/**",
      "**/.vinxi/**",
      "**/.turbo/**",
      "**/prisma/generated/**",
      "**/src/generated/**",
      "**/routeTree.gen.ts",
      "**/.features-gen/**",
      "**/.vitest-attachments/**",
      "**/__screenshots__/**",
      "**/.tanstack/**",
      "**/storybook-static/**",
      "**/.lost-pixel/**",
      // Not covered by any tsconfig's `include` — would trigger
      // "not found by the project service" errors under typed linting.
      // These files are script-style, not part of the workspace
      // type-check graph; skip them rather than expanding tsconfig.
      "scripts/**",
      "turbo/**",
      "**/scripts/**",
      "**/playwright.config.ts",
      "**/vite.config.ts",
      "**/vitest.config.ts",
      "**/prisma.config.ts",
      "**/.storybook/**",
      // Claude Code's per-agent worktrees live at `.claude/worktrees/`;
      // they contain duplicate source trees that ESLint picks up.
      ".claude/**",
      // gitignore-tracked artifacts
      ".similar-report.json",
      // e2e workspace has no tsconfig — typed linting can't parse it.
      // Playwright's deprecation surface is small enough (it uses
      // explicit deprecation on a few locator methods like `page.$()`)
      // that missing coverage here isn't worth the config cost.
      "e2e/**",
      // Self-reference — eslint.config.ts is outside any tsconfig.
      "eslint.config.ts",
      // Stray test files not in their package's tsconfig include.
      "**/__tests__/contract.test.ts",
      "**/__tests__/rate-limit.test.ts",
    ],
  },
  {
    files: ["**/*.{ts,tsx,mts,cts}"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: {
          // Files outside any tsconfig `include` (stray configs,
          // fixtures, ambient-declaration files) fall back to a default
          // TS project. Listed explicitly — typescript-eslint rejects
          // overly broad globs here (see tseslint.com docs on default
          // project glob width).
          allowDefaultProject: ["packages/realtime/__tests__/contract.test.ts"],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin,
    },
    rules: {
      "@typescript-eslint/no-deprecated": "error",
    },
  },
);
