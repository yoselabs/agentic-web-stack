import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { AppShell } from "./app-shell";

/**
 * `AppShell` is the outermost layout wrapper. Stories exercise both
 * required slots (`nav`, `main`) with representative content —
 * intentionally simple so the visual regression baseline is stable
 * regardless of feature churn.
 */
const meta = {
  title: "widgets/AppShell",
  component: AppShell,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof AppShell>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithMinimalSlots: Story = {
  args: {
    slots: {
      nav: (
        <nav aria-label="primary">
          <span>Nav placeholder</span>
        </nav>
      ),
      main: (
        <main>
          <h1>Main content</h1>
        </main>
      ),
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Scope via landmark — same discipline as `check-scoped-landmarks`.
    const main = canvas.getByRole("main");
    await expect(within(main).getByText("Main content")).toBeInTheDocument();
  },
};

export const WithRichContent: Story = {
  args: {
    slots: {
      nav: (
        <nav aria-label="primary" className="border-b px-6 py-3">
          <span>Header bar</span>
        </nav>
      ),
      main: (
        <main className="p-6">
          <h1>Dashboard</h1>
          <p>Welcome back</p>
        </main>
      ),
    },
  },
};
