import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import type { SessionData } from "./lib/session-fn.ts";
import { createTrpcProxy, getQueryClient, trpcClient } from "./lib/trpc.ts";
import { routeTree } from "./routeTree.gen.ts";

export interface RouterContext {
  trpc: ReturnType<typeof createTrpcProxy>;
  trpcClient: typeof trpcClient;
  queryClient: ReturnType<typeof getQueryClient>;
  session: SessionData;
}

export function getRouter() {
  const queryClient = getQueryClient();
  const trpc = createTrpcProxy(queryClient);

  return createTanStackRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: "intent",
    context: {
      trpc,
      trpcClient,
      queryClient,
      session: null,
    } satisfies RouterContext,
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
