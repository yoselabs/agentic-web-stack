import type { AppRouter } from "@project/api/router";
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

// NOTE: hardcoded dev port. Accepted for this spike per root CLAUDE.md's
// "dev port literals are allowed" rule. Production would derive from
// @project/env/client.
const wsUrl =
  typeof window === "undefined"
    ? "ws://localhost:3001/trpc-ws"
    : `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.hostname}:3001/trpc-ws`;

const wsClient = createWSClient({ url: wsUrl });

const trpcClient = createTRPCClient<AppRouter>({
  links: [
    splitLink({
      condition: (op) => op.type === "subscription",
      true: wsLink({ client: wsClient }),
      false: httpBatchLink({
        // NOTE: "/trpc" inlined by design — matches server mount. See zero-conf design spec §D3.
        url: `${apiClient.baseUrl}/trpc`,
        fetch: apiClient.fetch,
      }),
    }),
  ],
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
    context: { trpc, queryClient, session: null },
  });

  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
