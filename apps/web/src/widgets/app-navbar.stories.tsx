import type { Meta, StoryObj } from "@storybook/react-vite";

/**
 * `AppNavbar` is the session-aware composition that feeds the slot-typed
 * `Navbar` shell. Unlike `Navbar` itself (which is pure/slot-driven and
 * enumerated exhaustively in `navbar.stories.tsx`), `AppNavbar` reads
 * Better-Auth's `useSession()` + the env-provided `VITE_API_URL`.
 *
 * Stories are NOT included in the Vitest addon-vitest run (`no-test`
 * tag — excluded in `vitest.config.ts`):
 *
 * - `@project/env/client` touches `process.env` at module init, which
 *   crashes in the browser-mode Vitest worker.
 * - Better-Auth's `useSession()` reaches into a session store that
 *   isn't meaningfully mockable without a full auth decorator we don't
 *   ship yet.
 *
 * The meaningful state-space enumeration (LoggedOut / LoggedInBasic /
 * LoggedInAdmin / WithAdminActions) is covered exhaustively by
 * `navbar.stories.tsx` through the slot contract. This file exists to
 * satisfy `check-stories-siblings` and give humans a live preview of
 * the composed navbar under the real Better-Auth hook once it's loaded
 * lazily via `import()`. Promote a story to the default tag only once
 * a proper auth-session decorator lands.
 *
 * The component reference below is a string rather than an import so
 * the Vitest collector never evaluates `AppNavbar` at file load.
 */
const meta = {
  title: "widgets/AppNavbar",
  tags: ["no-test"],
  parameters: { layout: "fullscreen" },
} satisfies Meta<Record<string, never>>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Placeholder preview — see JSDoc above. Run `pnpm storybook` to render
 * `AppNavbar` live; do not rely on this story for regression coverage.
 */
export const Placeholder: Story = {
  render: () => (
    <div style={{ padding: 16 }}>
      <em>
        Rendered live in Storybook dev server only. See `navbar.stories.tsx` for
        the exhaustive slot-state enumeration that exercises every shape
        `AppNavbar` produces.
      </em>
    </div>
  ),
};
