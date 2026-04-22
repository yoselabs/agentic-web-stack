import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  type AnyRouter,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { AppNavbar } from "./app-navbar";

/**
 * `AppNavbar` is the session-aware composition that feeds the slot-typed
 * `Navbar` shell. Sessions are injected via `parameters.session` (see
 * `.storybook/preview.tsx`'s `withSession` decorator) — no Better-Auth
 * runtime, no network probe.
 *
 * The slot-contract combinatorics (every nav/user/admin-action shape)
 * stay enumerated in `navbar.stories.tsx`, which exercises the dumb
 * shell directly. These stories assert the session → slot-selection
 * mapping: signed out vs user vs admin.
 */
const rootRoute = createRootRoute({ component: () => <AppNavbar /> });
const router = createRouter({ routeTree: rootRoute });

const meta = {
  title: "widgets/AppNavbar",
  component: AppNavbar,
  decorators: [() => <RouterProvider router={router as AnyRouter} />],
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof AppNavbar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Signed out: only Sign In affordance renders. */
export const LoggedOut: Story = {
  parameters: { session: { data: null, isPending: false } },
};

/** Signed-in non-admin: primary links visible, Jobs Admin suppressed. */
export const LoggedInUser: Story = {
  parameters: {
    session: {
      data: {
        user: {
          id: "u-basic",
          email: "ada@example.com",
          name: "Ada Lovelace",
        },
      },
      isPending: false,
    },
  },
};

/** Signed-in admin: Jobs Admin link visible on desktop + mobile. */
export const LoggedInAdmin: Story = {
  parameters: {
    session: {
      data: {
        user: {
          id: "u-admin",
          email: "admin@example.com",
          name: "Admin",
          role: "admin",
        },
      },
      isPending: false,
    },
  },
};
