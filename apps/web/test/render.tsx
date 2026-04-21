import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type RenderOptions, render } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";

/**
 * A seed entry for pre-populating the React Query cache before render.
 * `queryKey` is the key (typically `trpc.foo.bar.queryOptions(input).queryKey`).
 * `data` is the value the component should see on first render.
 */
export type QuerySeed = {
  queryKey: readonly unknown[];
  data: unknown;
};

export type RenderWithTRPCOptions = Omit<RenderOptions, "wrapper"> & {
  /** Optional cache seeds — avoid network/request boundary in unit tests. */
  seed?: QuerySeed[];
  /** Supply a custom QueryClient (rare; the default is test-friendly). */
  queryClient?: QueryClient;
};

/**
 * Creates a per-test QueryClient. `retry: false` so failures surface
 * immediately; `gcTime: Infinity` so seeded data never gets collected
 * mid-test. Not a module singleton — every test gets an isolated cache.
 */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: Infinity,
        staleTime: Infinity,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

/**
 * Renders `ui` wrapped in a QueryClientProvider, optionally seeding the
 * cache. The tRPC client is NOT wired by default — components that need
 * it read from route context or get `trpc`/`queryClient` via props
 * (the hook-extraction pattern in apps/web/CLAUDE.md). Seeding the cache
 * is how we mock tRPC calls: the component's `useQuery(trpc.foo.bar
 * .queryOptions())` reads the seeded key and never hits network.
 */
export function renderWithTRPC(
  ui: ReactElement,
  { seed, queryClient, ...options }: RenderWithTRPCOptions = {},
): ReturnType<typeof render> & { queryClient: QueryClient } {
  const client = queryClient ?? createTestQueryClient();

  if (seed) {
    for (const entry of seed) {
      client.setQueryData(entry.queryKey, entry.data);
    }
  }

  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );

  const result = render(ui, { wrapper: Wrapper, ...options });
  return Object.assign(result, { queryClient: client });
}
