// @adr 0006
import type { AppRouter } from "@project/api/router";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient } from "@tanstack/react-query";
import {
  createTRPCClient,
  httpBatchLink,
  splitLink,
  type TRPCLink,
} from "@trpc/client";
import { observable } from "@trpc/server/observable";
import { createTRPCOptionsProxy } from "@trpc/tanstack-react-query";
import { expect, within } from "storybook/test";
import { ActivityFeedPanel } from "./activity-feed-panel";

/**
 * `ActivityFeedPanel` renders the activity feed for a todo-list detail
 * page — pure display fed by `useActivityFeed`. Stories cover the four
 * visual states the panel can hit: `Loading` (initial fetch in flight),
 * `Empty` (no events recorded yet), `Single` (one event), and `Many`
 * (ten events — scrollable overflow).
 *
 * Story cache wiring: we seed the paginated list query via
 * `parameters.trpc.queries`. The subscription hook is left inert — no
 * WebSocket connection is required to render the initial state.
 */
const TODO_LIST_ID = "list-story";

// Minimal tRPC client for query-key derivation in stories. The cache is
// seeded, so no network call is made. Subscription ops are routed to a
// no-op link (observable that never emits) so `useSubscription` doesn't
// throw in the preview environment where no WebSocket is available.
// TRPCLink shape: runtime-time `(opts) => ({op, next}) => observable`.
// We never emit and never call `next`, so the subscription stays idle.
const noopSubscriptionLink: TRPCLink<AppRouter> = () => () =>
  observable(() => {
    return () => {
      /* no-op teardown */
    };
  });

const storyTrpcClient = createTRPCClient<AppRouter>({
  links: [
    splitLink({
      condition: (op) => op.type === "subscription",
      true: noopSubscriptionLink,
      false: httpBatchLink({ url: "http://localhost/_story_noop_/trpc" }),
    }),
  ],
});

const storyTrpc = createTRPCOptionsProxy<AppRouter>({
  client: storyTrpcClient,
  queryClient: new QueryClient(),
});

const listQueryKey = storyTrpc.activity.list.queryKey({
  todoListId: TODO_LIST_ID,
});

type Wire = {
  id: string;
  todoListId: string;
  actorId: string;
  kind: string;
  payload: unknown;
  createdAt: string;
  actor: { id: string; name: string };
};

function makeEvent(
  id: string,
  actorName: string,
  title: string,
  offsetMs: number,
): Wire {
  return {
    id,
    todoListId: TODO_LIST_ID,
    actorId: `u-${actorName.toLowerCase()}`,
    kind: "todo-created",
    payload: { kind: "todo-created", todoId: `t-${id}`, title },
    createdAt: new Date(Date.now() - offsetMs).toISOString(),
    actor: { id: `u-${actorName.toLowerCase()}`, name: actorName },
  };
}

// Explicit annotation: tRPC's AppRouter type transitively references
// AppAbility from @project/api/authz, which isn't re-exported from the
// subpath we import. Without the annotation tsc reports TS2883.
const meta: Meta<typeof ActivityFeedPanel> = {
  title: "features/Activity Feed/Panel",
  component: ActivityFeedPanel,
  parameters: { layout: "padded" },
  args: { trpc: storyTrpc, todoListId: TODO_LIST_ID },
};

export default meta;
type Story = StoryObj<typeof ActivityFeedPanel>;

export const Loading: Story = {
  // No seeded data → useQuery stays in loading state.
  parameters: {
    trpc: { queries: [] },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const panel = canvas.getByTestId("activity-feed");
    await expect(panel).toHaveTextContent(/loading activity/i);
  },
};

export const Empty: Story = {
  parameters: {
    trpc: {
      queries: [
        { queryKey: listQueryKey, data: { items: [], nextCursor: null } },
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const panel = canvas.getByTestId("activity-feed");
    await expect(panel).toHaveTextContent(/no activity yet/i);
  },
};

export const Single: Story = {
  parameters: {
    trpc: {
      queries: [
        {
          queryKey: listQueryKey,
          data: {
            items: [makeEvent("e1", "Alice", "buy milk", 60_000)],
            nextCursor: null,
          },
        },
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const panel = canvas.getByTestId("activity-feed");
    await expect(panel).toHaveTextContent(/alice added buy milk/i);
  },
};

const MANY_ACTORS = [
  "Alice",
  "Bob",
  "Carol",
  "Dan",
  "Eve",
  "Frank",
  "Grace",
  "Heidi",
  "Ivan",
  "Judy",
];
const MANY_EVENTS: Wire[] = MANY_ACTORS.map((name, i) =>
  // Descending ids so newest-first ordering matches the wire shape.
  makeEvent(
    `e${String(MANY_ACTORS.length - i).padStart(2, "0")}`,
    name,
    `item ${i + 1}`,
    i * 30_000,
  ),
);

export const Many: Story = {
  parameters: {
    trpc: {
      queries: [
        {
          queryKey: listQueryKey,
          data: { items: MANY_EVENTS, nextCursor: null },
        },
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const panel = canvas.getByTestId("activity-feed");
    await expect(panel).toHaveTextContent(/alice added item 1/i);
    await expect(panel).toHaveTextContent(/judy added item 10/i);
  },
};
