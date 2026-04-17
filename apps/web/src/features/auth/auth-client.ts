import { env } from "@project/env/client";
import type { BetterAuthClientOptions } from "better-auth/client";
import { createAuthClient } from "better-auth/react";

// Cast to a portable type to avoid TS2742 — createAuthClient's inferred
// return type references internal pnpm paths that TypeScript cannot name
// portably when compiling in project-references mode.
type BaseAuthClient = ReturnType<
  typeof createAuthClient<BetterAuthClientOptions>
>;
export const authClient = createAuthClient({
  baseURL: env.VITE_API_URL,
}) as unknown as BaseAuthClient;

export const { signIn, signUp, signOut, useSession } = authClient;
