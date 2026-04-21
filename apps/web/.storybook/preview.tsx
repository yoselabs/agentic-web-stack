// @adr 0006
import type { Decorator, Preview } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

/**
 * Per-story `QueryClient`. Mirrors `apps/web/test/render.tsx` exactly:
 * `retry: false` so seeded-miss failures surface immediately;
 * `gcTime: Infinity` so seeded data isn't GC'd mid-story.
 *
 * NOT a module singleton — every story render (and every play() call)
 * gets an isolated cache. This is the same discipline the jsdom tests
 * follow (see ADR-0003).
 */
function createStoryQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
}

/**
 * A seed entry for pre-populating the React Query cache before a story
 * renders. `queryKey` is typically `trpc.foo.bar.queryOptions(input).queryKey`.
 *
 * Same shape as `QuerySeed` in `apps/web/test/render.tsx` — intentional:
 * a story's seed and a unit test's seed are interchangeable inputs.
 */
export type StoryQuerySeed = {
  queryKey: readonly unknown[];
  data: unknown;
};

type StoryTRPCParameters = {
  /** Cache seeds — wire tRPC queries without hitting the network. */
  queries?: StoryQuerySeed[];
};

/**
 * Global decorator. Every story renders inside a fresh
 * `QueryClientProvider`, with optional tRPC-cache seeding via
 * `parameters.trpc.queries`.
 *
 * Example:
 *
 * ```ts
 * export const WithPendingInvites: Story = {
 *   parameters: {
 *     trpc: {
 *       queries: [
 *         { queryKey: trpc.invites.list.queryOptions().queryKey, data: [...] },
 *       ],
 *     },
 *   },
 * };
 * ```
 */
const withTRPC: Decorator = (Story, context) => {
  const client = createStoryQueryClient();
  const trpcParams = context.parameters.trpc as StoryTRPCParameters | undefined;
  if (trpcParams?.queries) {
    for (const entry of trpcParams.queries) {
      client.setQueryData(entry.queryKey, entry.data);
    }
  }
  return (
    <QueryClientProvider client={client}>
      {Story() as ReactNode}
    </QueryClientProvider>
  );
};

const preview: Preview = {
  parameters: {
    // Stories fail on a11y violations, not just warn in the panel.
    // Tuning: scope axe to the story root; use the default ruleset
    // (empty `rules` means "use defaults" in addon-a11y).
    a11y: {
      // `context` omitted — under Vitest browser-mode the stories
      // render directly into `document.body` (no Storybook chrome
      // around them), so letting axe crawl the full document is both
      // correct and cheaper than re-declaring a scope.
      config: { rules: [] },
      options: {},
      // Critical: promote violations to test failures (default "todo"
      // only warns in the panel).
      test: "error",
    },
  },
  decorators: [withTRPC],
};

export default preview;
