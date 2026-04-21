// @adr 0007 — browser-mode component tests.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement, ReactNode } from "react";
import { render } from "vitest-browser-react";

/**
 * Browser-mode render helper — mirrors `test/render.tsx` but uses
 * `vitest-browser-react` so returned locators reflect **real browser
 * state** (e.g. `element.naturalWidth > 0` actually tracks image
 * decode, not a jsdom stub).
 *
 * Accepts the same `renderWithTRPC(ui, { seed })` signature as the
 * jsdom helper so stories / unit tests / browser tests share one
 * mental model. The only intentional divergence: the return type
 * carries `vitest-browser-react`'s locator API instead of RTL's
 * `getBy*` tree.
 *
 * Use ONLY from `*.browser.test.tsx` files — `vitest-browser-react`
 * requires the `@vitest/browser` environment (chromium via playwright)
 * and will throw at import-time in the `unit` (happy-dom) project.
 */
export type QuerySeed = {
  queryKey: readonly unknown[];
  data: unknown;
};

export type BrowserRenderOptions = {
  /** Optional cache seeds — avoid network/request boundary in tests. */
  seed?: QuerySeed[];
  /** Supply a custom QueryClient (rare; the default is test-friendly). */
  queryClient?: QueryClient;
};

/**
 * Per-test QueryClient with retries disabled and GC/stale set to
 * Infinity so seeded cache entries survive the whole test.
 */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: Number.POSITIVE_INFINITY,
        staleTime: Number.POSITIVE_INFINITY,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

/**
 * Renders `ui` wrapped in a QueryClientProvider via
 * `vitest-browser-react`. Seeds the cache (if provided) before
 * render so components that call `useQuery(...queryOptions())`
 * see data on first render and never hit the network.
 *
 * Returns the full `vitest-browser-react` result plus the
 * `queryClient` for post-render assertions (`client.getQueryData`).
 *
 * Async since `vitest-browser-react@2` (`render` now returns a Promise).
 * Call sites must `await` — previously you could destructure synchronously.
 */
export async function renderWithTRPC(
  ui: ReactElement,
  { seed, queryClient }: BrowserRenderOptions = {},
): Promise<Awaited<ReturnType<typeof render>> & { queryClient: QueryClient }> {
  const client = queryClient ?? createTestQueryClient();

  if (seed) {
    for (const entry of seed) {
      client.setQueryData(entry.queryKey, entry.data);
    }
  }

  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );

  const result = await render(ui, { wrapper: Wrapper });
  return Object.assign(result, { queryClient: client });
}
