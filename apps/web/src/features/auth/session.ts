// Server-only file: the body runs exclusively inside createServerFn
// handlers, which TanStack Start tree-shakes out of the client bundle.
// This is the one place in apps/web/ that reads from @project/env/server
// — the SSR runtime needs a container-internal API URL that differs from
// the browser-facing VITE_API_URL (see SSR_API_URL in @project/env/server).
import { env } from "@project/env/server";
import { createServerFn } from "@tanstack/react-start";
import {
  deleteCookie,
  getCookie,
  getRequestHeader,
} from "@tanstack/react-start/server";

// Narrow shape: only fields the UI reads. The Better-Auth
// /api/auth/get-session response carries more (emailVerified, image,
// timestamps) but pulling them into router context would force every
// route-tree consumer to re-type on unrelated changes.
export type SessionData = {
  user: { id: string; email: string; name: string | null };
} | null;

// Better-Auth cookie name (confirmed via Set-Cookie probe in Task 0).
// HTTP-only, so JS can't read it — but the server-fn runs in the Nitro
// Node runtime where getCookie reads the incoming Cookie header directly.
const SESSION_COOKIE_NAME = "better-auth.session_token";

/**
 * Returns the incoming request's `Cookie` header so the SSR-side tRPC
 * client can forward it upstream. `credentials: "include"` in
 * apiClient.fetch is a browser-only mechanism; the SSR runtime has
 * no cookie jar. Without this forwarding, every route-loader tRPC
 * call during SSR arrives at Hono with no session cookie and gets
 * UNAUTHORIZED — exactly what broke 15 BDD scenarios that navigate
 * to /todo-lists/$listId as a logged-in user.
 *
 * Returns `""` when the request has no cookie header; the client-side
 * call path never hits this function (gated by `typeof window`).
 */
export const getIncomingCookieHeader = createServerFn({
  method: "GET",
}).handler((): string => getRequestHeader("cookie") ?? "");

export const getSession = createServerFn({ method: "GET" }).handler(
  async (): Promise<SessionData> => {
    // Forward the incoming session cookie to the Hono auth server. Runs
    // server-only; `createServerFn` emits a handler invoked in-process
    // during SSR and over RPC during client-side nav.
    const token = getCookie(SESSION_COOKIE_NAME);
    if (!token) return null;

    // Fail-soft: a broken auth call (network error, server down, DB reset
    // leaving the cookie pointing at a nonexistent session) must not
    // bubble to SSR and produce a 500. Clear the stale cookie and render
    // as signed-out; the _authenticated guard takes the user to /login.
    try {
      const res = await fetch(`${env.SSR_API_URL}/api/auth/get-session`, {
        headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      });
      if (!res.ok) {
        deleteCookie(SESSION_COOKIE_NAME);
        return null;
      }
      const data = (await res.json()) as {
        user?: { id: string; email: string; name: string | null };
      } | null;
      if (!data?.user) {
        deleteCookie(SESSION_COOKIE_NAME);
        return null;
      }
      return { user: data.user };
    } catch {
      deleteCookie(SESSION_COOKIE_NAME);
      return null;
    }
  },
);
