import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { MobileNav } from "./mobile-nav";

/**
 * `MobileNav` owns its own drawer open/close state (`useState`). Stories
 * cannot force the drawer open via props, so `DrawerOpen` uses a
 * `play()` that clicks the hamburger trigger — same pattern a BDD step
 * would follow, exercised in-unit.
 */
const meta = {
  title: "widgets/MobileNav",
  component: MobileNav,
  parameters: { layout: "padded" },
} satisfies Meta<typeof MobileNav>;

export default meta;
type Story = StoryObj<typeof meta>;

export const LoggedOut: Story = {
  args: {
    slots: {
      primaryLinks: null,
      user: (
        <a href="/login" data-testid="sign-in">
          Sign In
        </a>
      ),
    },
  },
};

export const LoggedInBasic: Story = {
  args: {
    slots: {
      primaryLinks: (
        <>
          <a href="/dashboard">Dashboard</a>
          <a href="/todo-lists">Todo Lists</a>
        </>
      ),
      user: <span data-testid="user-block">alice@example.com</span>,
    },
  },
};

export const LoggedInAdmin: Story = {
  args: {
    slots: {
      primaryLinks: (
        <>
          <a href="/dashboard">Dashboard</a>
          <a href="/todo-lists">Todo Lists</a>
        </>
      ),
      adminActions: (
        <a href="/admin/queues" data-testid="jobs-admin">
          Jobs Admin
        </a>
      ),
      user: <span data-testid="user-block">admin@example.com</span>,
    },
  },
};

export const DrawerOpen: Story = {
  args: LoggedInAdmin.args,
  play: async ({ canvasElement }) => {
    // Radix Sheet portals its content to document.body, so the drawer
    // content lives outside canvasElement. Scope the trigger query to
    // the canvas landmark, but query drawer content from the document.
    const canvas = within(canvasElement);
    const trigger = canvas.getByRole("button", { name: /toggle menu/i });
    await userEvent.click(trigger);
    const doc = within(document.body);
    await expect(doc.getByTestId("jobs-admin")).toBeInTheDocument();
  },
};
