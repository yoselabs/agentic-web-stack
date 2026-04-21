import type { AppRouter } from "@project/api/router";
import { Button } from "@project/ui/components/button";
import type { QueryClient } from "@tanstack/react-query";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ErrorComponentProps } from "@tanstack/react-router";
import {
  createRootRouteWithContext,
  HeadContent,
  Link,
  Scripts,
  useRouter,
} from "@tanstack/react-router";
import type { TRPCOptionsProxy } from "@trpc/tanstack-react-query";
import { type ReactNode, useEffect } from "react";
import { Toaster } from "sonner";
import { getSession, type SessionData } from "#/features/auth/session";
import { AppNavbar } from "#/widgets/app-navbar";
import { AppShell } from "#/widgets/app-shell";

import appCss from "../styles.css?url";

export interface RouterContext {
  trpc: TRPCOptionsProxy<AppRouter>;
  queryClient: QueryClient;
  session: SessionData;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  beforeLoad: async () => {
    const session = await getSession();
    return { session };
  },
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Agentic Web Stack" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  shellComponent: RootDocument,
  notFoundComponent: NotFound,
  errorComponent: RootError,
});

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  const { queryClient } = Route.useRouteContext();

  // Playwright waits for [data-hydrated] before clicking. Without it, a
  // click can land on a button whose handler isn't wired yet and the test
  // wedges until the 30s timeout. useEffect runs after React's hydration
  // completes on the client, so the attribute appearing = "interactive".
  useEffect(() => {
    document.documentElement.setAttribute("data-hydrated", "");
  }, []);

  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body className="font-sans antialiased">
        <QueryClientProvider client={queryClient}>
          <AppShell
            slots={{
              nav: <AppNavbar />,
              main: children,
            }}
          />
        </QueryClientProvider>
        <Toaster richColors closeButton />
        <Scripts />
      </body>
    </html>
  );
}

function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4">
      <p className="text-6xl font-bold text-muted-foreground">404</p>
      <h1 className="text-xl font-semibold">Page not found</h1>
      <p className="text-muted-foreground">
        The page you're looking for doesn't exist or has been moved.
      </p>
      <Button asChild variant="outline" className="mt-2">
        <Link to="/">Back to Home</Link>
      </Button>
    </main>
  );
}

function RootError({ error, reset }: ErrorComponentProps) {
  const router = useRouter();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4">
      <p className="text-6xl font-bold text-muted-foreground">500</p>
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="text-sm text-muted-foreground max-w-md text-center">
        {error.message || "An unexpected error occurred."}
      </p>
      <div className="flex gap-3 mt-2">
        <Button
          variant="outline"
          onClick={() => {
            reset();
            router.invalidate();
          }}
        >
          Try Again
        </Button>
        <Button asChild variant="ghost">
          <Link to="/">Back to Home</Link>
        </Button>
      </div>
    </main>
  );
}
