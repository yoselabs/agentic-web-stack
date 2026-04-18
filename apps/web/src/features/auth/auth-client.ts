import type { auth } from "@project/auth";
import type { BetterAuthClientOptions } from "better-auth/client";
import { inferAdditionalFields } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { apiClient } from "#/shared/api-client";

// Cast to a portable type to avoid TS2742 — createAuthClient's inferred
// return type references internal pnpm paths that TypeScript cannot name
// portably when compiling in project-references mode.
type BaseAuthClient = ReturnType<
  typeof createAuthClient<BetterAuthClientOptions>
>;
export const authClient = createAuthClient({
  baseURL: apiClient.baseUrl,
  plugins: [inferAdditionalFields<typeof auth>()],
}) as unknown as BaseAuthClient;

export const { signIn, signUp, signOut, useSession } = authClient;
