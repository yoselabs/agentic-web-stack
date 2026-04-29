import { env } from "@project/env/client";
import type { BetterAuthClientOptions } from "better-auth/client";
import { inferAdditionalFields } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

// Schema literal mirrors packages/auth/src/index.ts additionalFields.
// `role` is `input: false` server-side so the client signUp surface
// doesn't require it. `username` is required.
const additionalFieldsSchema = {
  user: {
    role: { type: "string" as const, input: false as const },
    username: { type: "string" as const, required: true as const },
  },
};

// Portable type cast: createAuthClient's inferred return type references
// internal pnpm paths that TypeScript cannot name portably under
// project-references mode (TS2883). Cast through BetterAuthClientOptions
// gives a portable surface; the additional-fields plugin still narrows
// signUp.email to require `username`.
type BaseAuthClient = ReturnType<
  typeof createAuthClient<BetterAuthClientOptions>
>;
type AuthClient = Omit<BaseAuthClient, "signUp"> & {
  signUp: Omit<BaseAuthClient["signUp"], "email"> & {
    email: (
      data: Parameters<BaseAuthClient["signUp"]["email"]>[0] & {
        username: string;
      },
      options?: Parameters<BaseAuthClient["signUp"]["email"]>[1],
    ) => ReturnType<BaseAuthClient["signUp"]["email"]>;
  };
};

export const authClient = createAuthClient({
  baseURL: env.VITE_API_URL,
  plugins: [inferAdditionalFields(additionalFieldsSchema)],
}) as unknown as AuthClient;

export const { useSession, signIn, signUp, signOut } = authClient;
