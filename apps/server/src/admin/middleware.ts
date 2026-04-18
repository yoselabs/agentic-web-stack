// Hono middleware that gates /admin/* routes. Resolves the SAME CASL
// ability the tRPC context uses — single source of truth for authz.
//
// Order-critical: this MUST run BEFORE Bull Board's mount, otherwise job
// payloads (including single-use password-reset URLs) would be readable
// by unauthenticated users. Acceptance test locks this in.

import { abilityFor } from "@project/api/authz";
import type { auth } from "@project/auth";
import type { MiddlewareHandler } from "hono";

type AuthInstance = typeof auth;

export function requireAdmin(authInstance: AuthInstance): MiddlewareHandler {
  return async (c, next) => {
    const session = await authInstance.api.getSession({
      headers: c.req.raw.headers,
    });
    const user = session?.user
      ? {
          id: session.user.id,
          role: (session.user as { role?: string }).role ?? "user",
        }
      : null;
    const ability = abilityFor(user);
    if (ability.cannot("access", "AdminDashboard")) {
      return c.text("Forbidden", 403);
    }
    await next();
  };
}
