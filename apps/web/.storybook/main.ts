import type { StorybookConfig } from "@storybook/react-vite";

/**
 * Storybook 9 config for `@project/web`.
 *
 * Scope: widgets only. Stories live beside their component
 * (`foo.stories.tsx` sibling to `foo.tsx`) — enforced by
 * `scripts/check-stories-siblings.ts`.
 *
 * Addons:
 * - `@storybook/addon-a11y` runs axe-core against every rendered story.
 *   Severity is promoted to `error` in `preview.tsx` so a11y violations
 *   fail story tests (not just the panel warning).
 * - `@storybook/addon-vitest` runs stories through the same Vitest worker
 *   pool as the jsdom unit tests. Stories become test cases; `make
 *   test-unit` picks them up automatically via the vitest projects config.
 *
 * See ADR-0006.
 */
const config: StorybookConfig = {
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  addons: ["@storybook/addon-a11y", "@storybook/addon-vitest"],
  typescript: {
    // `react-docgen-typescript` parses real TS types (not PropTypes) and
    // surfaces them as argTypes — so AI agents reading the generated
    // docs see the real component contract, not a hand-authored subset.
    // See docs/storybook-ecosystem-research.md for the full rationale.
    reactDocgen: "react-docgen-typescript",
  },
};

export default config;
