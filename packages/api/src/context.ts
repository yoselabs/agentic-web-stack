import type { Session } from "@project/auth";
import { db } from "@project/db";
import { abilityFor } from "./authz/index.js";

export async function createContext(opts?: { session: Session | null }) {
  const session = opts?.session ?? null;
  const user = session?.user
    ? {
        id: session.user.id,
        role: (session.user as { role?: string }).role ?? "user",
      }
    : null;
  const ability = abilityFor(user);

  return {
    db,
    session,
    ability,
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
