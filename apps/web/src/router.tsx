import type { AppRouter } from "@project/api/router";
import { apiClient } from "@project/http/client";
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

// Derive WS URL from the HTTP API base URL (which is env.VITE_API_URL-
// validated via apiClient.baseUrl). Same host, same port, ws(s):// scheme
// — matches the server mount at /trpc-ws. Derivation (not hardcoded
// localhost:3001) is what lets the test suite run on its dynamic
// per-worktree API port.
const wsUrl = `${apiClient.baseUrl.replace(/^http/, "ws")}/trpc-ws`;

const wsClient = createWSClient({
  url: wsUrl,
  lazy: { enabled: true, closeMs: 0 },
});

// Forward the incoming request's cookies when a tRPC call fires during
// SSR (route loaders, server functions). `credentials: "include"` in
// apiClient.fetch is browser-only — on the server there is no cookie
// jar, so without this the Hono server sees no session cookie and every
// protectedProcedure returns UNAUTHORIZED. On the client this is a
// no-op and the browser attaches cookies itself. The
// `getIncomingCookieHeader` createServerFn is the seam: its body only
// bundles into the server chunk, and the tRPC batch link calls it
// inline during SSR (no HTTP round-trip).
import { getIncomingCookieHeader } from "#/features/auth/session";

async function forwardIncomingCookies(): Promise<Record<string, string>> {
  if (typeof window !== "undefined") return {};
  const cookie = await getIncomingCookieHeader();
  return cookie ? { cookie } : {};
}

const trpcClient = createTRPCClient<AppRouter>({
  links: [
    splitLink({
      condition: (op) => op.type === "subscription",
      true: wsLink({ client: wsClient }),
      false: httpBatchLink({
        // NOTE: "/trpc" inlined by design — matches server mount. See zero-conf design spec §D3.
        url: `${apiClient.baseUrl}/trpc`,
        fetch: apiClient.fetch,
        headers: forwardIncomingCookies,
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
    // `trpc` is the React Query adapter (queryOptions/mutationOptions).
    // `trpcClient` is the raw client — used by route loaders that need to
    // await a procedure directly without going through React Query (e.g.
    // the invite-accept flow that redirects on settlement).
    context: { trpc, trpcClient, queryClient, session: null },
  });

  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
