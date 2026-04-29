import type { AppRouter } from "@project/api/router";
import { env } from "@project/env/client";
import { QueryClient } from "@tanstack/react-query";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { createTRPCOptionsProxy } from "@trpc/tanstack-react-query";

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 60 * 1000 },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

export function getQueryClient() {
  if (typeof window === "undefined") return makeQueryClient();
  if (!browserQueryClient) browserQueryClient = makeQueryClient();
  return browserQueryClient;
}

export const trpcClient = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: `${env.VITE_API_URL}/trpc`,
      // credentials:"include" lets the Better-Auth session cookie travel
      // cross-origin (web on :3000, API on :3001). The server CORS
      // middleware allows it via credentials:true on env.CORS_ORIGIN.
      fetch(url, init) {
        return fetch(url, { ...init, credentials: "include" });
      },
    }),
  ],
});

export function createTrpcProxy(queryClient: QueryClient) {
  return createTRPCOptionsProxy<AppRouter>({
    client: trpcClient,
    queryClient,
  });
}
