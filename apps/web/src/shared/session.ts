import { createServerFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import { apiClient } from "./api-client";

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

export const getSession = createServerFn({ method: "GET" }).handler(
  async (): Promise<SessionData> => {
    // Forward the incoming session cookie to the Hono auth server. Runs
    // server-only; `createServerFn` emits a handler invoked in-process
    // during SSR and over RPC during client-side nav.
    const token = getCookie(SESSION_COOKIE_NAME);
    if (!token) return null;
    const res = await apiClient.fetch("/api/auth/get-session", {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      user?: { id: string; email: string; name: string | null };
    } | null;
    return data?.user ? { user: data.user } : null;
  },
);
