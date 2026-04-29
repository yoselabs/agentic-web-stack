import { auth } from "@project/auth/server";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

// Server-only function. Reads the session via Better-Auth using the
// incoming request's cookies. Used by route loaders / beforeLoad to
// gate _authed routes without paying a tRPC round-trip.

export type SessionData = Awaited<ReturnType<typeof auth.api.getSession>>;

export const getServerSession = createServerFn({ method: "GET" }).handler(
  async (): Promise<SessionData> => {
    const request = getRequest();
    return auth.api.getSession({ headers: request.headers });
  },
);
