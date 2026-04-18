import type { BetterAuthClientOptions } from "better-auth/client";
import { inferAdditionalFields } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { apiClient } from "#/shared/api-client";

// Schema literal mirroring packages/auth/src/index.ts additionalFields.
// Kept as a literal here (rather than importing the server `auth` value)
// because importing server auth into the client pulls DB + secrets into
// the browser bundle. Drift is cheap to catch — signup form typechecks
// against this shape.
const additionalFieldsSchema = {
  user: {
    role: { type: "string" as const },
    username: { type: "string" as const, required: true },
  },
};

// Portable fallback type cast to avoid TS2742 for the base client —
// createAuthClient's inferred return type references internal pnpm paths
// that TypeScript cannot name portably when compiling in project-references
// mode. We widen signUp.email to accept the additionalFields payload.
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
  baseURL: apiClient.baseUrl,
  plugins: [inferAdditionalFields(additionalFieldsSchema)],
}) as unknown as AuthClient;

export const { signIn, signUp, signOut, useSession } = authClient;
