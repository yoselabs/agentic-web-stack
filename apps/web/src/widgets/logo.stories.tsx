import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  type AnyRouter,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { Logo } from "./logo";

/**
 * `Logo` uses TanStack Router's `<Link>`, which requires a router
 * context — without it the component throws at render. Stories wire a
 * minimal in-memory router so the component renders in both Storybook
 * (manual inspection) and Vitest (a11y / interaction assertions).
 */
const rootRoute = createRootRoute({ component: () => <Logo /> });
const router = createRouter({ routeTree: rootRoute });

const meta = {
  title: "widgets/Logo",
  component: Logo,
  // The minimal router's generic doesn't line up with the app's
  // RegisteredRouter (which `RouterProvider` defaults to). `AnyRouter` is
  // the framework-provided erased type for exactly this case — story
  // decorators, tests, anywhere the concrete route tree doesn't matter.
  decorators: [() => <RouterProvider router={router as AnyRouter} />],
} satisfies Meta<typeof Logo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
