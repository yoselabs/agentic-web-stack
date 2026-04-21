// @adr 0006
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { Navbar } from "./navbar";

/**
 * `Navbar` is a shell widget — it renders only the slot content handed
 * to it, no session awareness of its own. (Session-aware composition
 * lives in `AppNavbar`, which has its own story file.)
 *
 * Stories enumerate the meaningful state space a call site will hit:
 * `LoggedOut`, `LoggedInBasic`, `LoggedInAdmin`. These are the exact
 * shapes `AppNavbar` produces today — this file is the contract the
 * shell owes `AppNavbar`.
 */
const meta = {
  title: "widgets/Navbar",
  component: Navbar,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof Navbar>;

export default meta;
type Story = StoryObj<typeof meta>;

const logo = <span data-testid="logo">App</span>;

const mobileNavStub = (
  <button type="button" aria-label="Toggle menu">
    ☰
  </button>
);

export const LoggedOut: Story = {
  args: {
    slots: {
      logo,
      primaryLinks: null,
      user: (
        <a href="/login" data-testid="sign-in">
          Sign In
        </a>
      ),
      mobileNav: mobileNavStub,
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const nav = canvas.getByRole("navigation");
    await expect(within(nav).getByTestId("sign-in")).toBeInTheDocument();
  },
};

export const LoggedInBasic: Story = {
  args: {
    slots: {
      logo,
      primaryLinks: (
        <>
          <a href="/dashboard">Dashboard</a>
          <a href="/todo-lists">Todo Lists</a>
        </>
      ),
      user: <span data-testid="user-block">alice@example.com</span>,
      mobileNav: mobileNavStub,
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const nav = canvas.getByRole("navigation");
    await expect(within(nav).getByTestId("user-block")).toBeInTheDocument();
    await expect(
      within(nav).getByRole("link", { name: "Dashboard" }),
    ).toBeInTheDocument();
  },
};

export const LoggedInAdmin: Story = {
  args: {
    slots: {
      logo,
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
      mobileNav: mobileNavStub,
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const nav = canvas.getByRole("navigation");
    await expect(within(nav).getByTestId("jobs-admin")).toBeInTheDocument();
  },
};
