import type { AppRouter } from "@project/api/router";
import { env } from "@project/env/client";
import { QueryClient } from "@tanstack/react-query";
import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import {
  createTRPCClient,
  createWSClient,
  httpBatchLink,
  splitLink,
  wsLink,
} from "@trpc/client";
import { createTRPCOptionsProxy } from "@trpc/tanstack-react-query";
import { apiClient } from "#/shared/api-client";
import { routeTree } from "./routeTree.gen";

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60 * 1000,
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

function getQueryClient() {
  if (typeof window === "undefined") {
    // Server: always make a new client to avoid leaking data between requests
    return makeQueryClient();
  }
  // Browser: reuse a single client
  if (!browserQueryClient) browserQueryClient = makeQueryClient();
  return browserQueryClient;
}

const httpLink = httpBatchLink({
  // NOTE: "/trpc" inlined by design — matches server mount. See zero-conf design spec §D3.
  url: `${apiClient.baseUrl}/trpc`,
  fetch: apiClient.fetch,
});

const wsClientInstance = env.VITE_ENABLE_CHAT
  ? createWSClient({ url: env.VITE_WS_URL })
  : null;

const trpcClient = createTRPCClient<AppRouter>({
  links: wsClientInstance
    ? [
        splitLink({
          condition: (op) => op.type === "subscription",
          true: wsLink({ client: wsClientInstance }),
          false: httpLink,
        }),
      ]
    : [httpLink],
});

export function getRouter() {
  const queryClient = getQueryClient();

  const trpc = createTRPCOptionsProxy<AppRouter>({
    client: trpcClient,
    queryClient,
  });

  const router = createTanStackRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: "intent",
    defaultPendingMs: 200,
    defaultPendingMinMs: 300,
    context: { trpc, queryClient },
  });

  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
