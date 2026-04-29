import { QueryClientProvider } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  HeadContent,
  Link,
  Scripts,
} from "@tanstack/react-router";
import { type ReactNode, useEffect } from "react";
import { getServerSession } from "../lib/session-fn.ts";
import type { RouterContext } from "../router.tsx";

export const Route = createRootRouteWithContext<RouterContext>()({
  beforeLoad: async () => {
    const session = await getServerSession();
    return { session };
  },
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Agentic Web Stack" },
    ],
  }),
  shellComponent: RootDocument,
});

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  const { queryClient, session } = Route.useRouteContext();

  // Playwright waits for [data-hydrated] before clicking. The attribute
  // appears after React hydration completes; its presence == interactive.
  useEffect(() => {
    document.documentElement.setAttribute("data-hydrated", "");
  }, []);

  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <QueryClientProvider client={queryClient}>
          <header
            style={{ padding: "0.75rem 1rem", borderBottom: "1px solid #ddd" }}
          >
            <nav style={{ display: "flex", gap: "1rem" }}>
              <Link to="/">Home</Link>
              {session ? (
                <>
                  <Link to="/dashboard">Dashboard</Link>
                  <span style={{ marginLeft: "auto" }}>
                    {session.user.email}
                  </span>
                </>
              ) : (
                <>
                  <Link to="/sign-in">Sign in</Link>
                  <Link to="/sign-up">Sign up</Link>
                </>
              )}
            </nav>
          </header>
          {children}
        </QueryClientProvider>
        <Scripts />
      </body>
    </html>
  );
}
