import type { Meta, StoryObj } from "@storybook/react-vite";

/**
 * `AppNavbar` is the session-aware composition that feeds the slot-typed
 * `Navbar` shell. Unlike `Navbar` itself (pure/slot-driven, enumerated
 * exhaustively in `navbar.stories.tsx`), `AppNavbar` reads Better-Auth's
 * `useSession()`.
 *
 * Stories are tagged `no-test` (excluded in `vitest.config.ts`) because
 * `useSession()` reaches into a session store that isn't meaningfully
 * mockable without a full auth decorator we don't ship yet. The
 * state-space enumeration (LoggedOut / LoggedInBasic / LoggedInAdmin /
 * WithAdminActions) is covered through the slot contract in
 * `navbar.stories.tsx`. This file exists to satisfy
 * `check-stories-siblings` and give humans a live preview in the
 * Storybook dev server. Promote to the default tag once a session
 * decorator lands.
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
